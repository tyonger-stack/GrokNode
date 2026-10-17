// Mirrors Grok Bot 0.71.2 `lmt` (dist/electron-main/main-app.cjs): a renderer
// that goes away for any reason other than "clean-exit" is reloaded on the next
// task; the fourth crash inside a minute is a crash loop and asks the user to
// reload or quit instead of reloading forever.

export const RENDERER_CRASH_LOOP_RELOADS = 3;
export const RENDERER_CRASH_LOOP_WINDOW_MS = 60_000;

export interface RendererCrashRecoveryContents {
  isDestroyed(): boolean;
  isCrashed(): boolean;
  on(
    event: "render-process-gone",
    listener: (event: unknown, details: { readonly reason: string }) => void,
  ): void;
}

export interface RendererCrashRecoveryOptions {
  readonly isQuitting: () => boolean;
  readonly reload: () => void;
  readonly askToReloadOrQuit: () => Promise<"reload" | "quit">;
  readonly quit: () => void;
  readonly reportAskFailure: (error: unknown) => void;
  readonly reportCrashLoop: (record: { readonly kind: "crash_loop"; readonly reloads: number }) => void;
  readonly now?: () => number;
  readonly schedule?: (task: () => void) => void;
}

export function installRendererCrashRecovery(
  contents: RendererCrashRecoveryContents,
  options: RendererCrashRecoveryOptions,
): void {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((task: () => void) => void setTimeout(task, 0));
  let reloads: number[] = [];
  let asking = false;

  const reload = (): void => {
    if (!options.isQuitting() && !contents.isDestroyed()) options.reload();
  };
  const ask = async (): Promise<void> => {
    try {
      if (options.isQuitting() || contents.isDestroyed()) return;
      if ((await options.askToReloadOrQuit()) === "quit") options.quit();
      else reload();
    } catch (error) {
      options.reportAskFailure(error);
    } finally {
      asking = false;
    }
  };
  const onGone = (): void => {
    if (asking || options.isQuitting() || contents.isDestroyed()) return;
    const at = now();
    reloads = reloads.filter((stamp) => at - stamp < RENDERER_CRASH_LOOP_WINDOW_MS);
    if (reloads.length < RENDERER_CRASH_LOOP_RELOADS) {
      reloads = [...reloads, at];
      schedule(reload);
      return;
    }
    asking = true;
    options.reportCrashLoop({ kind: "crash_loop", reloads: reloads.length });
    schedule(() => void ask());
  };

  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") onGone();
  });
  if (contents.isCrashed()) onGone();
}
