import { serveMainEdge, type MainEdgeWiringDeps } from "../main-edge-wiring.js";
import {
  MAIN_METHOD_TABLE,
  mainRpcContract,
  serveEdge as generatedServeEdge,
} from "../generated/main-rpc.js";
import type { MainEdge } from "../main.js";
import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import type { ProductionDisposable, ProductionServiceContext } from "../main-production-services.js";
import { probeEndpointFromBox } from "../box/local-docker-host-connector.js";
import { getHardwareAccelerationEnabledAtLaunch } from "../../shared/node/hardware-acceleration.js";
import { createElectronProductionIpcMainBinding, type ElectronProductionIpcMainSource } from "./ipc.js";
import { requireFunction, requireObject } from "./provider-guards.js";
import { prepareDesktop0721, readDesktop0721 } from "../desktop-runtime-0721.js";
import { getLocal0721Backends } from "../local-backends-0721.js";
import { dirname, join } from "node:path";
import { ComputerUpgradeScheduler } from "../box/computer-upgrade-scheduler.js";
import type { RecreateResult } from "../box/box-recreate-commands.js";

type ExistingMainRpcCoreDeps = Pick<MainEdgeWiringDeps,
  "settingsStore"
  | "agentPrefsStore"
  | "boxToggleStore"
  | "onboardingSeen"
  | "shell"
  | "boxRecovery"
  | "windowChrome"
  | "syncHostSettingsToBox"
  | "probeBoxEndpoint"
  | "broadcast"
  | "platform"
  | "avatarImages"
  | "attachments"
  | "ensureTranscriptionManager"
  | "fetchAvailableModels"
  | "recordLocalToolApproval"
  | "clearLocalToolApprovals"
  | "experiments"
  | "getComputerUseModelOverride"
  | "getAutomationWebhookCredential"
  | "callLibrary"
>;

type MainRpcResolverDeps = Omit<MainEdgeWiringDeps,
  keyof ExistingMainRpcCoreDeps
  | "serveEdge"
  | "mainRpcContract"
  | "mainMethodTable"
> & Partial<Pick<MainEdgeWiringDeps,
  keyof ExistingMainRpcCoreDeps
  | "serveEdge"
  | "mainRpcContract"
  | "mainMethodTable"
>>;

export interface ProductionMainRpcPorts {
  readonly beforeServe?: (context: ProductionServiceContext, deps: MainEdgeWiringDeps) => void;
  readonly resolveDeps: (
    context: ProductionServiceContext,
  ) => MainRpcResolverDeps;
}

/**
 * Zero-input root join for the immutable MainEdge constructor. The generated
 * serve/contract/table defaults remain local to this adapter; Electron's
 * ipcMain is the only native input and may be substituted only by tests.
 */
export function createElectronProductionMainRpcBinding(
  electron?: ElectronProductionIpcMainSource,
): ElectronProductionAdapterBindings["mainRpc"] {
  const ipcMain = createElectronProductionIpcMainBinding(electron);
  const preparedDesktop = electron === undefined ? prepareDesktop0721() : undefined;
  let desktop: ReturnType<ReturnType<typeof prepareDesktop0721>["create"]> | undefined;
  const adapter = createProductionMainRpcAdapter({
    beforeServe(context, deps) { desktop = preparedDesktop?.create(context, deps); },
    resolveDeps(context) {
      return {
        ipcMain,
        local0721: () => getLocal0721Backends(context),
        ...{ desktop0721: () => readDesktop0721() },
        stageVisualizationDocument: (input) => {
          if (!desktop) throw new Error("Visualization protocol is not connected");
          return desktop.stageVisualizationDocument(input);
        },
        readLiveUpdateService: () => {
          try {
            return context.requireUpdate().updateService as unknown as ReturnType<MainEdgeWiringDeps["readLiveUpdateService"]>;
          } catch {
            return null;
          }
        },
        readThemeController: () => {
          try {
            return context.settings.getThemeController() as unknown as ReturnType<MainEdgeWiringDeps["readThemeController"]>;
          } catch {
            return null;
          }
        },
        readLanguageController: () => {
          try {
            return context.settings.getLanguageController() as unknown as ReturnType<MainEdgeWiringDeps["readLanguageController"]>;
          } catch {
            return null;
          }
        },
        readEgressTunnelController: () => {
          try {
            return context.requireEgressTunnelController() as unknown as ReturnType<MainEdgeWiringDeps["readEgressTunnelController"]>;
          } catch {
            return null;
          }
        },
        requestMainAgent: async (method, args) => {
          const call = context.coordinatorLegs.legs[method];
          if (typeof call !== "function") throw new Error("Main Bot host command is unavailable.");
          const result: unknown = await call(args);
          if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("Invalid Main Bot host response.");
          return Object.fromEntries(Object.entries(result));
        },
        readHostSettingsFromBox: async () => {
          const settings = await context.coordinatorResync.readHostSettings();
          if (typeof settings !== "object" || settings == null || Array.isArray(settings)) {
            throw new Error("Electron production MainEdge received an invalid host-settings response.");
          }
          return settings as Record<string, unknown>;
        },
        emitEgressTunnelChanged: (enabled) => context.requireMainEdge().emit("egress-tunnel-changed", enabled),
        emitWebauthnProxyChanged: (enabled) => context.requireMainEdge().emit("webauthn-proxy-changed", enabled),
        getTrustedContents: () => {
          const contents = context.getTrustedContents();
          return contents == null ? null : contents as unknown as NonNullable<ReturnType<MainEdgeWiringDeps["getTrustedContents"]>>;
        },
        broadcast: context.broadcast,
        platform: process.platform,
        // 0.71.2 hardware-acceleration edge: launch snapshot + GPU status + relaunch.
        hardwareAccelerationEnabledAtLaunch: getHardwareAccelerationEnabledAtLaunch(),
        getGpuFeatureStatus: () => {
          try {
            const electron = require("electron") as { app?: { getGPUFeatureStatus?: () => Record<string, string> } };
            return electron.app?.getGPUFeatureStatus?.() ?? {};
          } catch {
            return {};
          }
        },
        relaunchDesktop: () => {
          const electron = require("electron") as {
            app: { relaunch: () => void; quit: () => void };
          };
          electron.app.relaunch();
          electron.app.quit();
        },
        applySpellCheckEnabled: (enabled: boolean) => {
          try {
            const electron = require("electron") as {
              session?: { defaultSession?: { setSpellCheckerEnabled?: (enabled: boolean) => void } };
            };
            electron.session?.defaultSession?.setSpellCheckerEnabled?.(enabled);
          } catch { /* spell checker API unavailable in this Electron build */ }
        },
      };
    },
  });
  return {
    create(context) {
      try {
        const edge = adapter.create(context);
        return { ...edge, dispose() { desktop?.dispose(); return edge.dispose?.(); } };
      } catch (error) {
        desktop?.dispose();
        throw error;
      }
    },
  };
}

function createExistingMainRpcCoreDeps(
  context: ProductionServiceContext,
  supplied: MainRpcResolverDeps,
): ExistingMainRpcCoreDeps {
  const shell = requireObject(
    supplied.shell === undefined ? context.shell : supplied.shell,
    "mainRpc.shell",
  );
  const settingsStore = requireObject(
    supplied.settingsStore === undefined ? context.settings?.settingsStore : supplied.settingsStore,
    "mainRpc.settingsStore",
  );
  const agentPrefsStore = requireObject(
    supplied.agentPrefsStore === undefined ? context.settings?.settingsStore : supplied.agentPrefsStore,
    "mainRpc.agentPrefsStore",
  );
  const boxToggleStore = requireObject(
    supplied.boxToggleStore === undefined ? context.settings?.settingsStore : supplied.boxToggleStore,
    "mainRpc.boxToggleStore",
  );
  const onboardingSeen = requireObject(
    supplied.onboardingSeen === undefined
      ? context.hostSettingsFields.onboardingSeen
      : supplied.onboardingSeen,
    "mainRpc.onboardingSeen",
  );
  const windowChrome = requireObject(
    supplied.windowChrome === undefined ? context.windowChrome : supplied.windowChrome,
    "mainRpc.windowChrome",
  );
  const boxRecovery = requireObject(
    supplied.boxRecovery === undefined ? context.boxRecovery : supplied.boxRecovery,
    "mainRpc.boxRecovery",
  ) as MainEdgeWiringDeps["boxRecovery"];
  const attachments = requireObject(
    supplied.attachments === undefined
      ? (typeof context.attachments === "object" && context.attachments != null ? context.attachments : undefined)
      : supplied.attachments,
    "mainRpc.attachments",
  );
  const avatarImages = requireObject(
    supplied.avatarImages === undefined
      ? (typeof context.avatarImages === "object" && context.avatarImages != null ? context.avatarImages : undefined)
      : supplied.avatarImages,
    "mainRpc.avatarImages",
  );
  const ensureTranscriptionManager = requireFunction(
    supplied.ensureTranscriptionManager === undefined ? context.ensureTranscriptionManager : supplied.ensureTranscriptionManager,
    "mainRpc.ensureTranscriptionManager",
  );
  const fetchAvailableModels = requireFunction(
    supplied.fetchAvailableModels === undefined ? context.fetchAvailableModels : supplied.fetchAvailableModels,
    "mainRpc.fetchAvailableModels",
  );
  const recordLocalToolApproval = requireFunction(
    supplied.recordLocalToolApproval === undefined ? context.recordLocalToolApproval : supplied.recordLocalToolApproval,
    "mainRpc.recordLocalToolApproval",
  );
  const clearLocalToolApprovals = requireFunction(
    supplied.clearLocalToolApprovals === undefined ? context.clearLocalToolApprovals : supplied.clearLocalToolApprovals,
    "mainRpc.clearLocalToolApprovals",
  );
  const experiments = {
    ensureService: () => context.requireExperiments().ensureService(),
    isTelemetryDisabled: () => context.requireExperiments().isTelemetryDisabled(),
    startRpcTraceWindow: () => context.requireExperiments().startRpcTraceWindow(),
  };
  const getComputerUseModelOverride = () => context.requireExperiments().getComputerUseModelOverride();
  const callLibrary = async (method: string, args: Record<string, unknown>) => {
    const legs = context.coordinatorLegs.legs as Record<string, (first?: unknown) => Promise<unknown>>;
    const credential = await legs.libraryMainCredential?.();
    if (typeof credential !== "string" || credential.length === 0) throw new Error("Library service credential is unavailable.");
    const leg = legs[method];
    if (typeof leg !== "function") throw new Error(`Library method ${method} is not connected.`);
    return leg({ ...args, credential });
  };
  const getAutomationWebhookCredential = requireFunction(
    supplied.getAutomationWebhookCredential === undefined
      ? ((agentId: string, automationId: string) => context.coordinatorLegs.legs.getAutomationWebhookCredential!({ id: agentId, automationId }) as Promise<unknown>)
      : supplied.getAutomationWebhookCredential,
    "mainRpc.getAutomationWebhookCredential",
  );
  const syncHostSettingsToBox = requireFunction(
    supplied.syncHostSettingsToBox === undefined
      ? context.coordinatorResync?.pushHostSettings
      : supplied.syncHostSettingsToBox,
    "mainRpc.syncHostSettingsToBox",
  );
  // Save-time container-side endpoint gate (see MainEdgeDeps.probeBoxEndpoint).
  // Production default reads the CURRENT key from the secrets store so the
  // probe exercises exactly what the host would send; reveal failures degrade
  // to a keyless probe (connectivity still validated, auth cannot be).
  const probeBoxEndpoint: MainEdgeWiringDeps["probeBoxEndpoint"] = async (baseUrl) => {
    let apiKey: string | null = null;
    try { apiKey = await context.secretsStores.userSecretsStore.reveal("OPENROUTER_API_KEY"); } catch { apiKey = null; }
    return probeEndpointFromBox(baseUrl, apiKey);
  };
  const broadcast = requireFunction(
    supplied.broadcast === undefined ? context.broadcast : supplied.broadcast,
    "mainRpc.broadcast",
  );
  const platform = supplied.platform === undefined ? process.platform : supplied.platform;
  if (typeof platform !== "string") throw new TypeError("Missing Electron production adapter port: mainRpc.platform.");
  return {
    // MainEdgeDeps models these exact shared-object slots as indexable
    // records; the assertions are erased and preserve the SandSettingsStore
    // identity used by the immutable constructor.
    settingsStore: settingsStore as unknown as MainEdgeWiringDeps["settingsStore"],
    agentPrefsStore: agentPrefsStore as unknown as MainEdgeWiringDeps["agentPrefsStore"],
    boxToggleStore: boxToggleStore as unknown as MainEdgeWiringDeps["boxToggleStore"],
    onboardingSeen: onboardingSeen as MainEdgeWiringDeps["onboardingSeen"],
    shell,
    boxRecovery,
    windowChrome,
    // The attachment gateway is an exact runtime object but its production
    // context intentionally keeps the public field opaque.
    attachments: attachments as MainEdgeWiringDeps["attachments"],
    avatarImages: avatarImages as MainEdgeWiringDeps["avatarImages"],
    ensureTranscriptionManager: ensureTranscriptionManager as MainEdgeWiringDeps["ensureTranscriptionManager"],
    fetchAvailableModels,
    recordLocalToolApproval,
    clearLocalToolApprovals,
    experiments,
    getComputerUseModelOverride,
    getAutomationWebhookCredential,
    callLibrary,
    syncHostSettingsToBox,
    probeBoxEndpoint,
    broadcast,
    platform,
  };
}

type ResolvedMainRpcDeps = Omit<MainEdgeWiringDeps, "serveEdge" | "mainRpcContract" | "mainMethodTable">
  & Partial<Pick<MainEdgeWiringDeps, "serveEdge" | "mainRpcContract" | "mainMethodTable">>;

function withGeneratedMainRpc(
  deps: ResolvedMainRpcDeps & Pick<MainEdgeWiringDeps, "shell">,
): MainEdgeWiringDeps {
  return {
    ...deps,
    serveEdge: deps.serveEdge ?? generatedServeEdge as unknown as MainEdgeWiringDeps["serveEdge"],
    mainRpcContract: deps.mainRpcContract ?? mainRpcContract,
    mainMethodTable: deps.mainMethodTable ?? MAIN_METHOD_TABLE,
  };
}

function validateMainRpcDeps(deps: MainEdgeWiringDeps): MainEdgeWiringDeps {
  requireObject(deps, "mainRpc.deps");
  requireObject(deps.shell, "mainRpc.shell");
  for (const name of ["settingsStore", "agentPrefsStore", "boxToggleStore", "windowChrome"] as const) {
    requireObject(deps[name], `mainRpc.${name}`);
  }
  requireFunction(deps.syncHostSettingsToBox, "mainRpc.syncHostSettingsToBox");
  if (typeof deps.platform !== "string") throw new TypeError("Missing Electron production adapter port: mainRpc.platform.");
  requireObject(deps.ipcMain, "mainRpc.ipcMain");
  requireFunction(deps.ipcMain.handle, "mainRpc.ipcMain.handle");
  requireFunction(deps.ipcMain.removeHandler, "mainRpc.ipcMain.removeHandler");
  requireFunction(deps.getTrustedContents, "mainRpc.getTrustedContents");
  requireFunction(deps.broadcast, "mainRpc.broadcast");
  requireFunction(deps.serveEdge, "mainRpc.generatedServeEdge");
  if (deps.mainRpcContract == null) throw new TypeError("Missing Electron production adapter port: mainRpc.generatedContract.");
  if (deps.mainMethodTable == null) throw new TypeError("Missing Electron production adapter port: mainRpc.generatedMethodTable.");
  return deps;
}

/** Artifact anchor: main.cjs:506198, `const mainEdge = serveMainEdge({`. */
export function createProductionMainRpcAdapter(
  ports: ProductionMainRpcPorts,
): ElectronProductionAdapterBindings["mainRpc"] {
  requireFunction(ports?.resolveDeps, "mainRpc.resolveDeps");
  return {
    create(context): MainEdge & Partial<ProductionDisposable> {
      const supplied = requireObject(ports.resolveDeps(context), "mainRpc.resolveDeps.result");
      const resolved = { ...createExistingMainRpcCoreDeps(context, supplied), ...supplied };
      const settingsPath = resolved.settingsStore.settingsPath;
      const scheduler = resolved.computerUpgrade ?? (typeof settingsPath === "string" ? new ComputerUpgradeScheduler({
        filename: join(dirname(settingsPath), "computer-upgrade-schedule.json"),
        perform: async () => {
          const recreate = resolved.boxRecovery.recreateComputer;
          if (typeof recreate !== "function") throw new Error("The local computer update is unavailable.");
          return await Reflect.apply(recreate, resolved.boxRecovery, [{ preserveData: true, force: false }]) as RecreateResult;
        },
      }) : undefined);
      if (scheduler !== undefined) resolved.computerUpgrade = scheduler;
      const deps = validateMainRpcDeps(withGeneratedMainRpc(resolved));
      ports.beforeServe?.(context, deps);
      const edge = serveMainEdge(deps);
      requireObject(edge as object | null, "mainRpc.edge");
      requireFunction((edge as { emit?: (...args: never[]) => unknown }).emit, "mainRpc.edge.emit");
      if (scheduler !== undefined) {
        try { scheduler.start(); } catch (error) { console.error("Could not restore the computer update schedule:", error); }
        const previousDispose = (edge as Partial<ProductionDisposable>).dispose;
        Object.assign(edge as MainEdge, { dispose() { scheduler.stop(); return previousDispose?.call(edge); } });
      }
      return edge as MainEdge & Partial<ProductionDisposable>;
    },
  };
}
