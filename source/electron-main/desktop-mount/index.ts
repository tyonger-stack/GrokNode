import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { isSafeFilename, type createAttachmentEdgePort } from "../attachments/attachments.js";
import { attachmentByteLimitForName } from "../../shared/media/attachment-limits.js";

type Electron = Pick<typeof import("electron"),
  "app" | "BrowserWindow" | "screen" | "shell" | "systemPreferences" | "globalShortcut" | "ipcMain">;
type Attachments = Pick<ReturnType<typeof createAttachmentEdgePort>, "stageBytes" | "discardStaged" | "commitStaged">;
type StageResult = Awaited<ReturnType<Attachments["stageBytes"]>>;

const promptSchema = z.object({
  agentId: z.string(), prompt: z.string(),
  attachments: z.array(z.object({ path: z.string(), name: z.string(), size: z.number() })),
});
export type DesktopMountPrompt = z.infer<typeof promptSchema>;
export interface DesktopMountTarget { agentId: string; name: string; markSvgDataUrl: string }
export interface DesktopMountState { mount: DesktopMountTarget | null }
interface CaptureImage { filename: string; bytes: Uint8Array }
export type DesktopCaptureOutcome = { kind: "attached" | "cancelled" | "disabled" | "not-mounted" }
  | { kind: "failed"; reason: string; detail?: string };
interface Mount {
  read(): DesktopMountState;
  attachCapture(image: CaptureImage): boolean;
  setCaptureEnabled(enabled: boolean): void;
  dispose(): void;
}
interface Capture {
  picker: { dispose(): void; isOpen(): boolean; overlayWindows(): import("electron").BrowserWindow[] };
  capture(): Promise<DesktopCaptureOutcome>;
  service(): { ensureAccess(): Promise<string>; listWindows(): unknown[] };
}
interface Factories {
  createMount(options: {
    getMainWindow: DesktopMount0721Options["getMainWindow"];
    focusMainWindow(): void;
    readAccountSlot(): string | null;
    isGateOn(): boolean;
    attachments: Attachments & { stagePath(request: { filename: string; sourcePath: string }): Promise<StageResult> };
    positionStore: { load(): { x: number; y: number } | null; save(position: { x: number; y: number }): void };
    startCapture(): void;
    onMountChanged(state: DesktopMountState): void;
  }): Mount;
  createCapture(options: { getMainWindow: DesktopMount0721Options["getMainWindow"];
    isEnabled(): boolean; attachCapture(image: CaptureImage): boolean }): Capture;
  createPositionStore(): Parameters<Factories["createMount"]>[0]["positionStore"];
  createCaptureGate(options: { isSupported(): boolean; isGateOn(): boolean; isMounted(): boolean;
    exposeGate(): void; setButtonEnabled(enabled: boolean): void;
    hotkey: { setActive(active: boolean): void } }): { refresh(): void; isEnabled(): boolean };
  createHotkey(options: { registrar: Electron["globalShortcut"]; onPress(): void }): {
    setActive(active: boolean): void; dispose(): void;
  };
  isCaptureSupported(options: { platform: string; systemVersion: string }): boolean;
}

export interface DesktopMount0721Options {
  electron: Electron;
  getMainWindow(): import("electron").BrowserWindow | null;
  readAccountSlot(): string | null;
  isEnabled(): boolean;
  exposeCaptureGate?: () => void;
  attachments: Attachments;
  onPromptSubmitted(prompt: DesktopMountPrompt): void | Promise<void>;
  onPromptSubmissionError(error: unknown, prompt: DesktopMountPrompt): void;
  reportWarning(message: string): void;
  generatedPath: string;
  rendererRoot: string;
  preloadRoot: string;
  nativeRoot: string;
  systemVersion?: string;
}

export function createDesktopMountStagingPort(attachments: Attachments) {
  return {
    ...attachments,
    async stagePath({ filename, sourcePath }: { filename: string; sourcePath: string }): Promise<StageResult> {
      if (!isSafeFilename(filename) || !path.isAbsolute(sourcePath)) return { ok: false, reason: "failed" };
      let file;
      try {
        file = await open(sourcePath, "r");
        const stat = await file.stat();
        if (!stat.isFile()) return { ok: false, reason: "failed" };
        if (stat.size === 0) return { ok: false, reason: "empty" };
        if (stat.size > attachmentByteLimitForName(filename)) return { ok: false, reason: "too-large" };
        const bytes = Buffer.alloc(stat.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await file.read(bytes, offset, bytes.length - offset, offset);
          if (read.bytesRead === 0) break;
          offset += read.bytesRead;
        }
        if (offset !== stat.size) return { ok: false, reason: "failed" };
        return await attachments.stageBytes(filename, bytes.subarray(0, offset));
      } catch {
        return { ok: false, reason: "failed" };
      } finally {
        await file?.close();
      }
    },
  };
}

export function createDesktopMount0721(options: DesktopMount0721Options) {
  const require = createRequire(options.generatedPath);
  const artifact: unknown = require(options.generatedPath);
  if (typeof artifact !== "object" || artifact === null || !("createUpstream" in artifact)
    || typeof artifact.createUpstream !== "function") throw new Error("Invalid desktop mount 0.72.1 artifact");
  const pending = new Set<Promise<void>>();
  const factories: unknown = artifact.createUpstream({
    electron: options.electron, zod: z, preloadRoot: options.preloadRoot,
    panelDocument: path.join(options.rendererRoot, "src/electron-renderer/desktop-mount/panel/panel.html"),
    overlayDocument: path.join(options.rendererRoot, "src/electron-renderer/desktop-mount/capture-overlay/capture-overlay.html"),
    nativeRequire: (name: string) => {
      if (name !== "sand-window-capture") throw new Error(`Unexpected native module: ${name}`);
      return require(path.join(options.nativeRoot, "index.js"));
    },
    reportWarning: options.reportWarning,
    onPromptSubmitted: (value: unknown) => {
      const prompt = promptSchema.parse(value);
      const work = Promise.resolve().then(() => options.onPromptSubmitted(prompt))
        .catch((error: unknown) => options.onPromptSubmissionError(error, prompt));
      pending.add(work);
      void work.finally(() => pending.delete(work));
    },
  });
  if (typeof factories !== "object" || factories === null) throw new Error("Missing desktop factories");
  for (const name of ["createMount", "createCapture", "createPositionStore", "createCaptureGate", "createHotkey", "isCaptureSupported"]) {
    if (!(name in factories) || typeof Reflect.get(factories, name) !== "function") throw new Error(`Missing desktop factory: ${name}`);
  }
  const upstream = factories as Factories;
  let capture: Capture | undefined;
  let gate: ReturnType<Factories["createCaptureGate"]> | undefined;
  let disposed = false;
  const runCapture = () => {
    void capture?.capture().catch((error: unknown) => options.reportWarning(String(error)));
  };
  const mount = upstream.createMount({
    getMainWindow: options.getMainWindow, isGateOn: options.isEnabled,
    readAccountSlot: options.readAccountSlot,
    focusMainWindow: () => options.getMainWindow()?.focus(),
    attachments: createDesktopMountStagingPort(options.attachments),
    positionStore: upstream.createPositionStore(), startCapture: runCapture,
    onMountChanged: () => refresh(),
  });
  const hotkey = upstream.createHotkey({ registrar: options.electron.globalShortcut, onPress: runCapture });
  gate = upstream.createCaptureGate({
    isSupported: () => upstream.isCaptureSupported({ platform: process.platform,
      systemVersion: options.systemVersion ?? process.getSystemVersion?.() ?? "" }),
    isGateOn: options.isEnabled,
    isMounted: () => mount.read().mount !== null,
    exposeGate: options.exposeCaptureGate ?? (() => {}),
    setButtonEnabled: mount.setCaptureEnabled, hotkey,
  });
  capture = upstream.createCapture({ getMainWindow: options.getMainWindow,
    isEnabled: () => !disposed && gate?.isEnabled() === true && mount.read().mount !== null,
    attachCapture: mount.attachCapture });
  function refresh() {
    if (disposed) return;
    gate?.refresh();
    if (!gate?.isEnabled() || mount.read().mount === null) {
      for (const window of capture?.picker.overlayWindows() ?? []) if (!window.isDestroyed()) window.destroy();
    }
  }
  refresh();
  return {
    read: mount.read, refresh,
    capture: () => capture?.capture() ?? Promise.resolve<DesktopCaptureOutcome>({ kind: "disabled" }),
    whenIdle: () => Promise.all([...pending]).then(() => {}),
    dispose() {
      if (disposed) return;
      disposed = true;
      hotkey.dispose();
      capture?.picker.dispose();
      mount.dispose();
    },
  };
}

