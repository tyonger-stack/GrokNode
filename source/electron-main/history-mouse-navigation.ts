/**
 * Logitech / mouse browser-back and browser-forward history navigation.
 *
 * Evidence: Grok Bot 0.71.2 `main-app.cjs` @1641313–1643200
 *   - NAe / LAe / UAe / DAe direction maps
 *   - FAe debounce + Linux pairCommands state machine
 *   - VAe before-mouse-event on webContents
 *   - uMt app-command on BrowserWindow
 *   - pMt swipe on BrowserWindow
 *   - guest IPC `sand:mouse-history-navigation`
 *   - emit `mouse-history-navigation` { direction: -1 | 1 }
 */

export const MOUSE_HISTORY_GUEST_IPC_CHANNEL = "sand:mouse-history-navigation";
export const MOUSE_HISTORY_NAVIGATION_EVENT = "mouse-history-navigation";

export type HistoryDirection = -1 | 1;

/** DAe — only ±1 are history directions. */
export function isHistoryDirection(value: unknown): value is HistoryDirection {
  return value === -1 || value === 1;
}

/** NAe — Electron before-mouse-event button names. */
export function directionFromMouseButton(button: string): HistoryDirection | null {
  return button === "back" ? -1 : button === "forward" ? 1 : null;
}

/** LAe — Electron app-command names (browser-backward / browser-forward). */
export function directionFromAppCommand(command: string): HistoryDirection | null {
  return command === "browser-backward" ? -1 : command === "browser-forward" ? 1 : null;
}

/** UAe — macOS swipe directions. */
export function directionFromSwipe(direction: string): HistoryDirection | null {
  return direction === "left" ? -1 : direction === "right" ? 1 : null;
}

export type MouseHistoryPhase = "mouseDown" | "mouseUp" | string;

export interface MouseHistoryDebouncer {
  consumeMouse(phase: MouseHistoryPhase, direction: HistoryDirection): boolean;
  consumeCommand(direction: HistoryDirection): boolean;
  consumeSwipe(direction: HistoryDirection): boolean;
  consumeGuest(direction: HistoryDirection): boolean;
}

/**
 * FAe — shared debounce / Linux pairCommands state machine.
 * Returns true when the navigation should be emitted.
 */
export function createMouseHistoryDebouncer(
  now: () => number = Date.now,
  options?: { readonly pairCommands?: boolean },
): MouseHistoryDebouncer {
  const pairCommands = options?.pairCommands === true;
  let pendingMouseDown: HistoryDirection | null = null;
  let lastMouseUp: { readonly direction: HistoryDirection; readonly at: number } | null = null;
  const commandSeen: Record<HistoryDirection, boolean> = { [-1]: false, [1]: false };

  const consumeSwipeOrCommand = (direction: HistoryDirection): boolean => {
    const pairedWithRecentMouseUp =
      lastMouseUp != null && lastMouseUp.direction === direction && now() - lastMouseUp.at < 50;
    if (pendingMouseDown === direction || pairedWithRecentMouseUp) {
      if (pendingMouseDown !== direction) lastMouseUp = null;
      return false;
    }
    lastMouseUp = null;
    return true;
  };

  return {
    consumeMouse(phase, direction) {
      if (phase === "mouseUp") {
        if (pendingMouseDown === direction) {
          pendingMouseDown = null;
          lastMouseUp = { direction, at: now() };
        }
        return false;
      }
      if (phase !== "mouseDown" || pendingMouseDown === direction) return false;
      pendingMouseDown = direction;
      lastMouseUp = null;
      return true;
    },
    consumeCommand(direction) {
      if (pairCommands && commandSeen[direction]) {
        commandSeen[direction] = false;
        return false;
      }
      if (pairCommands) commandSeen[direction] = true;
      return consumeSwipeOrCommand(direction);
    },
    consumeSwipe: consumeSwipeOrCommand,
    consumeGuest(direction) {
      return pendingMouseDown !== direction && !commandSeen[direction];
    },
  };
}

export interface PreventableMouseEvent {
  preventDefault(): void;
}

export interface MouseButtonEventDetail {
  readonly type: string;
  readonly button: string;
}

export interface HistoryWebContents {
  getType(): string;
  on(
    event: "before-mouse-event",
    listener: (event: PreventableMouseEvent, details: MouseButtonEventDetail) => void,
  ): void;
}

export interface HistoryBrowserWindow {
  readonly webContents: HistoryWebContents;
  on(
    event: "app-command",
    listener: (event: PreventableMouseEvent, command: string) => void,
  ): void;
  on(event: "swipe", listener: (event: unknown, direction: string) => void): void;
}

const installedMouseWebContents = new WeakSet<object>();
const installedAppCommandWindows = new WeakSet<object>();

/** VAe — intercept mouse back/forward on a webContents (window or webview). */
export function installWebContentsMouseHistory(
  contents: HistoryWebContents,
  navigate: (direction: HistoryDirection) => void,
  debouncer: MouseHistoryDebouncer,
): void {
  if (installedMouseWebContents.has(contents as object)) return;
  installedMouseWebContents.add(contents as object);
  contents.on("before-mouse-event", (event, details) => {
    const direction = directionFromMouseButton(details.button);
    if (direction == null) return;
    event.preventDefault();
    if (debouncer.consumeMouse(details.type, direction)) navigate(direction);
  });
}

/** uMt — intercept browser-backward / browser-forward app-commands on a BrowserWindow. */
export function installWindowAppCommandHistory(
  window: HistoryBrowserWindow,
  navigate: (direction: HistoryDirection) => void,
  debouncer: MouseHistoryDebouncer,
): void {
  if (installedAppCommandWindows.has(window as object)) return;
  installedAppCommandWindows.add(window as object);
  window.on("app-command", (event, command) => {
    const direction = directionFromAppCommand(command);
    if (direction == null) return;
    event.preventDefault();
    if (debouncer.consumeCommand(direction)) navigate(direction);
  });
}

/** pMt — macOS trackpad swipe → history. */
export function installWindowSwipeHistory(
  window: HistoryBrowserWindow,
  navigate: (direction: HistoryDirection) => void,
  debouncer: MouseHistoryDebouncer,
): void {
  window.on("swipe", (_event, swipeDirection) => {
    const direction = directionFromSwipe(swipeDirection);
    if (direction == null) return;
    if (debouncer.consumeSwipe(direction)) navigate(direction);
  });
}

/** fMt — guest IPC from webview preload (button 3/4). */
export function consumeGuestMouseHistoryIpc(
  senderType: string,
  payload: unknown,
  navigate: (direction: HistoryDirection) => void,
  debouncer: MouseHistoryDebouncer,
): void {
  if (senderType !== "webview" || !isHistoryDirection(payload)) return;
  if (debouncer.consumeGuest(payload)) navigate(payload);
}

export interface MouseHistoryNavigationPorts {
  readonly app: {
    on(
      event: "web-contents-created",
      listener: (event: unknown, contents: HistoryWebContents) => void,
    ): void;
  };
  readonly ipcMain: {
    on(
      channel: string,
      listener: (event: { readonly sender: { getType(): string } }, payload: unknown) => void,
    ): void;
  };
  readonly emitNavigation: (direction: HistoryDirection) => void;
  /** Shared FAe instance; created when omitted. */
  readonly debouncer?: MouseHistoryDebouncer;
  readonly pairCommands?: boolean;
  readonly now?: () => number;
}

let mouseHistoryInstalled = false;

/**
 * gMt / $Ae — process-lifetime webview + guest IPC install (idempotent).
 * pairCommands defaults to Linux-only, matching 0.71.2.
 * Returns the shared debouncer so onWindowCreated can attach the main window.
 */
export function installMouseHistoryNavigation(ports: MouseHistoryNavigationPorts): MouseHistoryDebouncer {
  const pairCommands = ports.pairCommands ?? process.platform === "linux";
  const debouncer =
    ports.debouncer ?? createMouseHistoryDebouncer(ports.now ?? Date.now, { pairCommands });
  const navigate = (direction: HistoryDirection): void => {
    ports.emitNavigation(direction);
  };

  if (!mouseHistoryInstalled) {
    mouseHistoryInstalled = true;
    ports.app.on("web-contents-created", (_event, contents) => {
      if (contents.getType() === "webview") {
        installWebContentsMouseHistory(contents, navigate, debouncer);
      }
    });
    ports.ipcMain.on(MOUSE_HISTORY_GUEST_IPC_CHANNEL, (event, payload) => {
      consumeGuestMouseHistoryIpc(event.sender.getType(), payload, navigate, debouncer);
    });
  }

  return debouncer;
}

/** Attach main-window listeners (VAe + uMt + pMt). Call from onWindowCreated. */
export function attachMainWindowMouseHistory(
  window: HistoryBrowserWindow,
  emitNavigation: (direction: HistoryDirection) => void,
  debouncer: MouseHistoryDebouncer,
): void {
  installWebContentsMouseHistory(window.webContents, emitNavigation, debouncer);
  installWindowAppCommandHistory(window, emitNavigation, debouncer);
  installWindowSwipeHistory(window, emitNavigation, debouncer);
}

/** Test-only: reset the process-lifetime install guard. */
export function resetMouseHistoryNavigationForTests(): void {
  mouseHistoryInstalled = false;
}
