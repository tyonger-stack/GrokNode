import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { createDesktop0721 } from "./desktop-0721/index.js";
import type { Desktop0721, Desktop0721Options, DesktopRoster } from "../shared/desktop-0721.js";
import { createMainEdgeHandlers, type MainEdgeDeps } from "./main-edge.js";
import { resolveDesktopLocale } from "./i18n/desktop-messages.js";
import { getSandRootDir } from "../host/host-paths.js";
import { isPngBytes, isRosterAvatarKey, rosterAvatarStoreDir } from "../node-agent-coordinator/gateway/roster-avatar-store.js";
import { createDesktopMount0721, type DesktopMount0721Options } from "./desktop-mount/index.js";
import { createVisualizationProtocol, loadVisualizationDocumentStore, registerVisualizationScheme } from "./visualization-protocol.js";
import type { ProductionServiceContext } from "./main-production-services.js";
import { resolveLocal0721Feature } from "../shared/node/port-0721-features.js";

type Attachments = DesktopMount0721Options["attachments"];
let desktop: Desktop0721 | undefined;
export function readDesktop0721(): Desktop0721 | undefined { return desktop; }

export function createDesktop0721RosterPhotos(dataDir: string): Desktop0721Options["rosterPhotos"] {
  return { async serve(request) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (request.method !== "GET" || url.protocol !== "sand-roster-photo:" || url.hostname !== "photo" || !isRosterAvatarKey(key)) {
      return new Response(null, { status: 400 });
    }
    try {
      const bytes = await readFile(join(rosterAvatarStoreDir(dataDir), key));
      if (!isPngBytes(bytes)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png" } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  } };
}

function definedFields<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

const rosterAgent = z.object({
  id: z.string().min(1), name: z.string(), updatedAt: z.number().finite(),
  hasUnread: z.boolean(), isRunning: z.boolean(), isComposingMessage: z.boolean(),
  purpose: z.string().optional(), lastActivityAt: z.number().finite().optional(),
  isGroup: z.boolean().optional(), isHiddenFromSidebar: z.boolean().optional(),
  viewerIsOwner: z.boolean().optional(), isTeamDefault: z.boolean().optional(),
  isRunningTurn: z.boolean().optional(), harness: z.string().optional(),
  snapshotEpoch: z.string().optional(), snapshotSeq: z.number().finite().optional(),
  avatarShape: z.string().optional(), avatarColor: z.string().optional(),
  avatarDataUrl: z.string().optional(), avatarVersion: z.string().optional(),
  avatarPhoto: z.object({ key: z.string(), retry: z.number().optional() }).transform(definedFields).optional(),
}).transform(definedFields);
const rosterSeed = z.object({ agents: z.array(rosterAgent) });
const rosterEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agents"), event: rosterSeed }),
  z.object({ kind: z.literal("agent-upserted"), event: z.object({ agent: rosterAgent }) }),
  z.object({ kind: z.literal("agent-activity"), event: z.object({ agentId: z.string(), live: z.object({
    isRunning: z.boolean(), isRunningTurn: z.boolean().optional(), isComposingMessage: z.boolean(),
  }).transform(definedFields).nullable() }) }),
]);

export function createDesktop0721RosterFeed(readRoster: () => DesktopRoster | undefined = () => readDesktop0721()?.roster) {
  return {
    onAgentsEvent(payload: unknown) {
      const parsed = rosterEvent.safeParse(payload);
      if (!parsed.success) return;
      const roster = readRoster();
      switch (parsed.data.kind) {
        case "agents": roster?.handleAgentsEvent(parsed.data.event); break;
        case "agent-upserted": roster?.handleAgentUpsertedEvent(parsed.data.event); break;
        case "agent-activity": roster?.handleAgentActivity(parsed.data.event); break;
      }
    },
    onAgentsRosterSeed(payload: unknown) {
      const parsed = rosterSeed.safeParse(payload);
      if (parsed.success) readRoster()?.seedRoster(parsed.data.agents);
    },
  };
}

const catalogsSchema = z.object({ en: z.record(z.array(z.union([z.string(), z.tuple([z.string()])]))),
  "zh-CN": z.record(z.array(z.union([z.string(), z.tuple([z.string()])]))), });
export function createDesktop0721Translator(catalogs: unknown, locale: () => "en" | "zh-CN"): Desktop0721Options["translate"] {
  const messages = catalogsSchema.parse(catalogs);
  return ({ id, values }) => {
    const message = messages[locale()][id];
    if (!message) throw new Error(`Missing desktop translation: ${id}`);
    return message.map((part) => {
      if (typeof part === "string") return part;
      const value = values?.[part[0]];
      if (value === undefined) throw new Error(`Missing desktop interpolation: ${id}/${part[0]}`);
      return String(value);
    }).join("");
  };
}

const rulesSchema = z.object({ isEnabled: z.boolean(), allowInstructions: z.array(z.string()), blockInstructions: z.array(z.string()) });
export function createDesktop0721Rules(deps: MainEdgeDeps): Desktop0721Options["rules"] {
  const handlers = createMainEdgeHandlers(deps);
  return {
    async getAutoReviewInstructions() { return rulesSchema.parse(await handlers.getAutoReviewInstructions!({})); },
    async setAutoReviewInstructions(args) { return rulesSchema.parse(await handlers.setAutoReviewInstructions!(args)); },
  };
}
function isAttachments(value: unknown): value is Attachments {
  return typeof value === "object" && value !== null && "stageBytes" in value && typeof value.stageBytes === "function" &&
    "commitStaged" in value && typeof value.commitStaged === "function" &&
    "discardStaged" in value && typeof value.discardStaged === "function";
}

export function prepareDesktop0721(electron: typeof import("electron") = require("electron")) {
  registerVisualizationScheme(electron.protocol);
  return {
    create(context: ProductionServiceContext, deps: MainEdgeDeps) {
      if (desktop) throw new Error("Desktop 0721 is already connected");
      const attachments = context.attachments;
      if (!isAttachments(attachments)) throw new Error("Desktop mount requires the attachment service");
      const dist = dirname(dirname(context.resources.preloadPath));
      const mainRoot = join(dist, "electron-main");
      const generated: { createDesktop0721Upstream: Desktop0721Options["transplant"]; desktopCatalogs: unknown } =
        require(join(mainRoot, "desktop-0721/upstream.cjs"));
      if (typeof generated.createDesktop0721Upstream !== "function") throw new Error("Desktop 0721 upstream factory is missing");
      const showApp = () => {
        const window = context.getMainWindow();
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show(); window.focus();
      };
      const service = createDesktop0721({
        electron, platform: process.platform, transplant: generated.createDesktop0721Upstream,
        assetsDir: join(mainRoot, "menubar-tray/assets"),
        loadNotificationNative: () => require(join(dist, "deps/sand-notification-settings")),
        translate: createDesktop0721Translator(generated.desktopCatalogs, () => resolveDesktopLocale({
          getPreference: () => context.settings.settingsStore.getLanguagePreference(),
          systemTags: electron.app.getPreferredSystemLanguages(),
        })),
        reportFailure: context.reportFailure,
        storage: { read: () => context.settings.settingsStore.getDesktopNotificationPreferences(),
          write: (preferences) => context.settings.settingsStore.setDesktopNotificationPreferences(preferences) },
        rosterPhotoUrl: (key) => `sand-roster-photo://photo/${encodeURIComponent(key)}`,
        rosterPhotos: createDesktop0721RosterPhotos(getSandRootDir()),
        showApp,
        onSelectBot: (id) => {
          void (async () => {
            const open = context.coordinatorLegs.legs.openAgent;
            if (!open) throw new Error("Desktop bot selection is unavailable");
            await open({ id });
            showApp(); context.requireMainEdge().emit("focus-agent", { id });
          })().catch((error: unknown) => context.reportFailure("menubar-tray", "open-agent", error));
        },
        openSettings: () => { showApp(); context.requireMainEdge().emit("open-settings", {}); },
        rules: createDesktop0721Rules(deps),
      });
      desktop = service;
      let protocol: ReturnType<typeof createVisualizationProtocol> | undefined;
      try {
        protocol = createVisualizationProtocol(electron.protocol,
          loadVisualizationDocumentStore(() => resolveLocal0721Feature("sand_enable_visualizations") === true));
        const mount = createDesktopMount0721({ electron,
          getMainWindow: () => {
            const window = context.getMainWindow();
            return window instanceof electron.BrowserWindow ? window : null;
          },
          isEnabled: () => resolveLocal0721Feature("sand_desktop_mount") === true,
          attachments,
          generatedPath: join(mainRoot, "desktop-mount/upstream-0721.cjs"),
          rendererRoot: join(dist, "renderer/upstream-0721"),
          preloadRoot: dirname(context.resources.preloadPath),
          nativeRoot: join(dist, "deps/sand-window-capture"),
          reportWarning: (message) => context.reportFailure("desktop-mount", "upstream", new Error(message)),
          onPromptSubmitted: () => {},
          onPromptSubmissionError: (error) => {
            context.reportFailure("desktop-mount", "send", error);
          },
        });
        let disposed = false;
        return { stageVisualizationDocument: protocol.stage, mount,
          dispose() {
            if (disposed) return;
            disposed = true;
            mount.dispose(); protocol?.dispose(); service.dispose(); if (desktop === service) desktop = undefined;
          } };
      } catch (error) {
        protocol?.dispose(); service.dispose(); desktop = undefined; throw error;
      }
    },
  };
}
