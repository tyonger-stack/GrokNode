import type { Menu, NativeImage, Notification, Tray, shell } from "electron";
import type { SandAutoReviewInstructions } from "./sand-auto-review-instructions.js";

export interface DesktopNotificationPreferences {
  readonly playSound: boolean;
  readonly sound: "ping-1-open-blip" | "ping-2-tick" | "ping-3-double-tick" | "ping-4-chime-a" | "ping-5-chime-b";
}

export type DesktopPermissionReading =
  | { kind: "known"; osPermission: "undetermined" | "denied" | "granted"; osSetting: string; macosAlertSetting?: string }
  | { kind: "unknown"; reason: "unsupported_platform" | "native_unavailable" | "read_failed"; readError?: string };

export interface DesktopNotificationPermission {
  readonly status: "unavailable" | "undetermined" | "denied" | "granted";
  readonly canOpenSettings: boolean;
  readonly reading: DesktopPermissionReading;
}

export interface DesktopRosterAgent {
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly updatedAt: number;
  readonly lastActivityAt?: number;
  readonly hasUnread: boolean;
  readonly isGroup?: boolean;
  readonly isHiddenFromSidebar?: boolean;
  readonly viewerIsOwner?: boolean;
  readonly isTeamDefault?: boolean;
  readonly isRunning: boolean;
  readonly isRunningTurn?: boolean;
  readonly isComposingMessage: boolean;
  readonly harness?: string;
  readonly snapshotEpoch?: string;
  readonly snapshotSeq?: number;
  readonly avatarShape?: string;
  readonly avatarColor?: string;
  readonly avatarDataUrl?: string;
  readonly avatarVersion?: string;
  readonly avatarPhoto?: { readonly key: string; readonly retry?: number };
}

export interface DesktopRoster {
  handleAgentsEvent(event: { agents: readonly DesktopRosterAgent[] }): void;
  handleAgentUpsertedEvent(event: { agent: DesktopRosterAgent }): void;
  handleAgentActivity(event: { agentId: string; live: { isRunning: boolean; isRunningTurn?: boolean; isComposingMessage: boolean } | null }): void;
  seedRoster(agents: readonly DesktopRosterAgent[]): void;
  noteServerRosterChanged(): void;
  activate(): void;
  beginServerRosterRead(): number;
  installServerRoster(result: { status: "ready"; agents: readonly DesktopRosterAgent[] } | { status: "unavailable" }, generation: number): void;
  reset(): void;
  snapshot(): readonly { summary: DesktopRosterAgent; isBusy: boolean }[];
  onChange(listener: () => void): () => void;
}

export interface DesktopClock {
  now(): number;
  monotonicNow(): number;
  schedule(ms: number, callback: () => void, options?: { keepEventLoopAlive?: boolean }): { dispose(): void };
}

export interface DesktopElectronPorts {
  Tray: typeof Tray;
  Menu: Pick<typeof Menu, "buildFromTemplate">;
  Notification: typeof Notification;
  nativeImage: {
    createFromPath(path: string): NativeImage;
    createFromDataURL(url: string): NativeImage;
    createFromBuffer(buffer: Buffer): NativeImage;
    createEmpty(): NativeImage;
  };
  shell: Pick<typeof shell, "openExternal">;
  app: { name: string; quit(): void };
}

export interface Desktop0721Ports {
  electron: DesktopElectronPorts;
  clock?: DesktopClock;
  translate(message: { id: string; values?: Record<string, unknown> }): string;
  reportFailure(area: string, operation: string, error: unknown): void;
  loadNotificationNative(name: string): unknown;
  rosterPhotoUrl(key: string): string;
}

export interface Desktop0721Upstream {
  createRoster(options?: { requestServerRoster?: () => Promise<void> }): DesktopRoster;
  startMenubarTray(options: {
    assetsDir: string;
    roster: DesktopRoster;
    rosterPhotos: { serve(request: Request): Promise<Response> };
    showApp(): void;
    openAgent(agentId: string): void;
    openSettings(): void;
  }): { dispose(): void } | null;
  readPermission(options: { platform: string; native: ReturnType<Desktop0721Upstream["loadNative"]> }): () => Promise<DesktopPermissionReading>;
  loadNative(): { kind: "loaded"; native: { notification_settings_async(): Promise<unknown> } } | { kind: "unavailable"; loadError: string };
  createPermission(options: {
    platform: string;
    read(): Promise<DesktopPermissionReading>;
    showProbe(): boolean;
    openExternal(url: string): Promise<unknown>;
    clock?: DesktopClock;
  }): { get(): Promise<{ status: string; canOpenSettings: boolean }>; request(): Promise<{ status: string; canOpenSettings: boolean }>; openSettings(): Promise<boolean> };
  showProbe(ctor: typeof Notification): boolean;
  defaultPreferences: DesktopNotificationPreferences;
  isPreferences(value: unknown): value is DesktopNotificationPreferences;
}

export interface Desktop0721Options extends Desktop0721Ports {
  transplant(ports: Desktop0721Ports): Desktop0721Upstream;
  platform: string;
  assetsDir: string;
  storage: {
    read(): unknown | Promise<unknown>;
    write(preferences: DesktopNotificationPreferences): void | Promise<void>;
  };
  rosterPhotos: { serve(request: Request): Promise<Response> };
  requestServerRoster?: () => Promise<void>;
  showApp(): void;
  onSelectBot(agentId: string): void;
  openSettings(): void;
  rules: {
    getAutoReviewInstructions(): Promise<SandAutoReviewInstructions>;
    setAutoReviewInstructions(args: { instructions: SandAutoReviewInstructions }): Promise<SandAutoReviewInstructions>;
  };
}

export interface Desktop0721 {
  readonly roster: DesktopRoster;
  readonly trayAvailable: boolean;
  getDesktopNotificationPreferences(): Promise<DesktopNotificationPreferences>;
  setDesktopNotificationPreferences(args: { preferences: DesktopNotificationPreferences }): Promise<DesktopNotificationPreferences>;
  getDesktopNotificationPermission(): Promise<DesktopNotificationPermission>;
  requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission>;
  openDesktopNotificationSettings(): Promise<boolean>;
  getAutoReviewInstructions(): Promise<SandAutoReviewInstructions>;
  setAutoReviewInstructions(args: { instructions: SandAutoReviewInstructions }): Promise<SandAutoReviewInstructions>;
  reset(): void;
  dispose(): void;
}

