import type { Context } from "../../../packages/context/core.js";
import { boxApplyEnvironment, boxDescription, boxIsAvailable, boxIsPreparing, boxLoadMcpServers, boxMaxWindows, boxMcpResourceAccessor, boxTerminalsFolder } from "../../box/box-capabilities.js";

export class SandBoxCapabilityError extends Error {}
export const RUN_STATE_PROBE_AGENT_ID = "";

/**
 * The fork noVNC URL carries the display it streams as a `token=` query value
 * (`.../vnc.html?path=websockify%3Ftoken%3D4`). That token is the only thing
 * tying a panel to a display, so it is the one value that can prove a panel is
 * showing the window the agent actually owns.
 */
export function vncUrlDisplayToken(vncUrl: string | null | undefined): number | undefined {
  if (typeof vncUrl !== "string") return undefined;
  const match = /[?&]token=(\d+)/.exec(vncUrl) ?? /token%3D(\d+)/.exec(vncUrl);
  if (match?.[1] === undefined) return undefined;
  const token = Number.parseInt(match[1], 10);
  return Number.isInteger(token) && token > 0 ? token : undefined;
}

export interface BoxStatus { agentId: string; state: string; vncUrl: string | null; windows?: Array<{ windowIndex: number; vncUrl: string }>; imageUpdateAvailable?: boolean; pull?: { percent: number } }

/**
 * Raised when the desktop panel would stream a display other than the one this
 * agent holds. Fail-closed on purpose: a panel showing the wrong screen is
 * indistinguishable from a broken agent, so surface it instead of shipping a
 * mismatched URL.
 */
export class SandBoxWindowSeatMismatchError extends Error {
  constructor(readonly agentId: string, readonly seatIndex: number, readonly panelIndex: number, readonly urlToken: number) {
    super(`Box window seat mismatch for agent ${agentId}: it holds display :${seatIndex} but the panel would stream :${panelIndex} (url token ${urlToken}).`);
    this.name = "SandBoxWindowSeatMismatchError";
  }
}
export interface BoxConnection { vncUrl: string; imageUpdateAvailable?: boolean; remoteAccessor?: unknown }
export interface HostBoxInner { ensureReady(ctx: Context, agentId: string): Promise<BoxConnection>; runState(ctx: Context, agentId: string): Promise<string>; listBoxes(): Promise<Array<{ agentId: string; running?: boolean }>>; uploadFile(ctx: Context, agentId: string, path: string, data: Uint8Array): Promise<void>; downloadFile(ctx: Context, agentId: string, path: string): Promise<Uint8Array>; ensureWindow?(ctx: Context, agentId: string, windowIndex: number, options?: unknown): Promise<{ windowIndex: number; vncUrl: string }>; releaseWindow?(ctx: Context, agentId: string): Promise<void>; recreateInBox?(ctx: Context, options: { preserveData: boolean; force?: boolean }): Promise<{ started: boolean; reason?: string }>; getAgentWindowIndex?(agentId: string): number | undefined; maxWindows?(): number; getTerminalsFolder?(): string | undefined; isAvailable?(): boolean | Promise<boolean>; isPreparing?(agentId: string): boolean; describe?(): unknown; applyEnvironment?(ctx: Context, update: unknown): Promise<void>; loadMcpServers?(ctx: Context, configJson: string): Promise<unknown>; mcpResourceAccessor?(ctx: Context): Promise<unknown> }
interface BoxStartup {
  ctx: Context;
  cancel(reason?: unknown): void;
  waiters: Set<symbol>;
  promise: Promise<unknown>;
}

export class HostBox {
  readonly vncUrls = new Map<string, string>(); readonly forkVncUrls = new Map<string, Map<number, string>>(); private readonly listeners = new Set<(status: BoxStatus) => void>(); private readonly lastReported = new Map<string, BoxStatus>(); private readonly releaseEpochs = new Map<string, number>(); private imageUpdateAvailable: boolean | undefined;
  private readonly startups = new Map<string, Map<string, BoxStartup>>();
  private readonly releases = new Map<string, Promise<void>>();
  constructor(readonly inner: HostBoxInner) {}
  subscribe(listener: (status: BoxStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /**
   * Resolve the window list the panel renders.
   *
   * `forkVncUrls` accumulates one entry per window index an agent has ever
   * held, so after a re-assignment it holds both the stale and the live index.
   * Handing all of them to the panel left it picking a window the agent no
   * longer owned — the panel then streamed a different display than the one
   * computer_use drove. Only the index the agent currently holds is returned.
   */
  buildWindows(agentId: string): Array<{ windowIndex: number; vncUrl: string }> | undefined {
    const forks = this.forkVncUrls.get(agentId);
    const current = this.inner.getAgentWindowIndex?.(agentId);
    if (forks != null && forks.size > 0) {
      if (current != null) {
        const url = forks.get(current);
        if (url != null) return [{ windowIndex: current, vncUrl: url }];
      }
      // No live seat (released, or the inner box cannot report one): fall back
      // to the highest index so the panel still has something to show.
      const indexes = [...forks.keys()].sort((a, b) => a - b);
      const highest = indexes[indexes.length - 1];
      if (highest != null) {
        const url = forks.get(highest);
        if (url != null) return [{ windowIndex: highest, vncUrl: url }];
      }
    }
    const main = this.vncUrls.get(agentId);
    return main == null ? undefined : [{ windowIndex: 0, vncUrl: main }];
  }
  recordConnection(agentId: string, connection: BoxConnection): void { this.vncUrls.set(agentId, connection.vncUrl); if (connection.imageUpdateAvailable !== undefined) this.imageUpdateAvailable = connection.imageUpdateAvailable; }
  recordImageUpdateAvailable(value: boolean | undefined): void { if (value === undefined || value === this.imageUpdateAvailable) return; this.imageUpdateAvailable = value; for (const agentId of this.lastReported.keys()) { const url = this.vncUrls.get(agentId), last = this.lastReported.get(agentId); if (url != null) this.notify(this.runningStatus(agentId, url)); else if (last != null) this.notify({ ...last, imageUpdateAvailable: value }); } }
  runningStatus(agentId: string, vncUrl: string): BoxStatus { const windows = this.buildWindows(agentId); this.assertWindowMatchesSeat(agentId, windows); return { agentId, state: "running", vncUrl, ...(windows === undefined ? {} : { windows }), ...(this.imageUpdateAvailable === undefined ? {} : { imageUpdateAvailable: this.imageUpdateAvailable }) }; }
  /**
   * A fork panel is correct only when the URL it will stream names the display
   * the agent actually holds. This is the check that has to live on the
   * consuming side: the URL is minted from the same `windowIndex` that routes
   * computer_use, so asserting at mint time would be tautologically true and
   * would pass while the panel still pointed at a re-assigned seat.
   */
  private assertWindowMatchesSeat(agentId: string, windows: Array<{ windowIndex: number; vncUrl: string }> | undefined): void {
    if (windows == null) return;
    const current = this.inner.getAgentWindowIndex?.(agentId);
    if (current == null || current <= 0) return; // primary seat: no token to match
    for (const { windowIndex, vncUrl } of windows) {
      const token = vncUrlDisplayToken(vncUrl);
      if (token != null && token !== current) {
        throw new SandBoxWindowSeatMismatchError(agentId, current, windowIndex, token);
      }
    }
  }
  private async coalesceStartup<T>(ctx: Context, agentId: string, key: string, start: (ctx: Context) => Promise<T>, record: (value: T) => void): Promise<T> {
    ctx.signal.throwIfAborted();
    const epoch = this.releaseEpochs.get(agentId) ?? 0;
    const checkCurrent = () => {
      ctx.signal.throwIfAborted();
      if ((this.releaseEpochs.get(agentId) ?? 0) !== epoch) throw new Error("Box window was released during startup");
    };
    for (;;) {
      checkCurrent();
      const releasing = this.releases.get(agentId);
      if (releasing != null) { await releasing; continue; }
      const operations = this.startups.get(agentId) ?? new Map<string, BoxStartup>();
      let startup = operations.get(key);
      // Keep canceled work in the map until the raw operation and its rollback settle.
      if (startup?.ctx.signal.aborted) { await startup.promise.catch(() => {}); continue; }
      if (startup == null) {
        const [operationCtx, cancel] = ctx.withDetached().withCancel();
        startup = { ctx: operationCtx, cancel, waiters: new Set(), promise: Promise.resolve() };
        const current = startup;
        operations.set(key, current);
        this.startups.set(agentId, operations);
        current.promise = Promise.resolve().then(async () => {
          operationCtx.signal.throwIfAborted();
          const value = await start(operationCtx);
          operationCtx.signal.throwIfAborted();
          record(value);
          return value;
        }).finally(() => {
          if (operations.get(key) === current) operations.delete(key);
          if (operations.size === 0 && this.startups.get(agentId) === operations) this.startups.delete(agentId);
        });
      }
      const current = startup, waiter = Symbol();
      current.waiters.add(waiter);
      const onAbort = () => {
        current.waiters.delete(waiter);
        if (current.waiters.size === 0) current.cancel(ctx.signal.reason);
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const value = await current.promise as T;
        checkCurrent();
        return value;
      } catch (error) {
        checkCurrent();
        throw error;
      } finally {
        ctx.signal.removeEventListener("abort", onAbort);
        current.waiters.delete(waiter);
      }
    }
  }
  async ensureReady(ctx: Context, agentId: string): Promise<BoxConnection> {
    return this.coalesceStartup(ctx, agentId, "ready", operationCtx => this.inner.ensureReady(operationCtx, agentId), connection => {
      this.recordConnection(agentId, connection);
      this.notify(this.runningStatus(agentId, connection.vncUrl));
    });
  }
  async hibernate(): Promise<void> {} runState(ctx: Context, agentId: string): Promise<string> { return this.inner.runState(ctx, agentId); } describe(): unknown { return boxDescription(this.inner); } isAvailable(): Promise<boolean> { return boxIsAvailable(this.inner); } isPreparing(agentId: string): boolean { return boxIsPreparing(this.inner, agentId); } getTerminalsFolder(): string | undefined { return boxTerminalsFolder(this.inner); } listBoxes() { return this.inner.listBoxes(); } maxWindows(): number { return boxMaxWindows(this.inner); }
  async ensureWindow(ctx: Context, agentId: string, windowIndex: number, options?: unknown): Promise<{ windowIndex: number; vncUrl: string }> {
    if (this.inner.ensureWindow == null) throw new SandBoxCapabilityError("This box does not support multiple desktop windows.");
    return this.coalesceStartup(ctx, agentId, `window:${windowIndex}`, async operationCtx => {
      if (!this.vncUrls.has(agentId)) await this.ensureReady(operationCtx, agentId);
      operationCtx.signal.throwIfAborted();
      return this.inner.ensureWindow!(operationCtx, agentId, windowIndex, options);
    }, window => {
      if (window.windowIndex === 0) this.vncUrls.set(agentId, window.vncUrl);
      else {
        const forks = this.forkVncUrls.get(agentId) ?? new Map<number, string>();
        forks.set(window.windowIndex, window.vncUrl);
        this.forkVncUrls.set(agentId, forks);
      }
      this.notify(this.runningStatus(agentId, this.vncUrls.get(agentId) ?? window.vncUrl));
    });
  }
  async releaseWindow(ctx: Context, agentId: string): Promise<void> {
    const releasing = this.releases.get(agentId);
    if (releasing != null) return releasing;
    this.releaseEpochs.set(agentId, (this.releaseEpochs.get(agentId) ?? 0) + 1);
    const startups = [...(this.startups.get(agentId)?.values() ?? [])];
    const reason = new Error("Box window was released during startup");
    for (const startup of startups) startup.cancel(reason);
    this.vncUrls.delete(agentId);
    this.forkVncUrls.delete(agentId);
    const cleanup = Promise.allSettled(startups.map(startup => startup.promise)).then(async () => {
      // Stop only after start-window has settled; otherwise a late start can resurrect the seat.
      try { await this.inner.releaseWindow?.(ctx.withDetached(), agentId); } catch {}
      this.notify({ agentId, state: "absent", vncUrl: null });
      this.lastReported.delete(agentId);
    }).finally(() => {
      if (this.releases.get(agentId) === cleanup) this.releases.delete(agentId);
    });
    this.releases.set(agentId, cleanup);
    return cleanup;
  }
  async applyEnvironment(ctx: Context, update: unknown): Promise<void> { await boxApplyEnvironment(this.inner, ctx, update); }
  async loadMcpServers(ctx: Context, configJson: string): Promise<unknown> { return await boxLoadMcpServers(this.inner, ctx, configJson); }
  async mcpResourceAccessor(ctx: Context): Promise<unknown> { return await boxMcpResourceAccessor(this.inner, ctx); }
  uploadFile(ctx: Context, agentId: string, path: string, data: Uint8Array): Promise<void> { return this.inner.uploadFile(ctx, agentId, path, data); } downloadFile(ctx: Context, agentId: string, path: string): Promise<Uint8Array> { return this.inner.downloadFile(ctx, agentId, path); }
  async getStatus(ctx: Context, agentId: string): Promise<BoxStatus> { const state = await this.inner.runState(ctx, agentId); if (state !== "running") { this.vncUrls.delete(agentId); this.forkVncUrls.delete(agentId); return this.report({ agentId, state, vncUrl: null, ...(this.imageUpdateAvailable === undefined ? {} : { imageUpdateAvailable: this.imageUpdateAvailable }) }); } const cached = this.vncUrls.get(agentId); return cached != null ? this.report(this.runningStatus(agentId, cached)) : this.report({ agentId, state: "absent", vncUrl: null, ...(this.imageUpdateAvailable === undefined ? {} : { imageUpdateAvailable: this.imageUpdateAvailable }) }); }
  getImageUpdateAvailable(): boolean | undefined { return this.imageUpdateAvailable; } async isBoxRunning(ctx: Context): Promise<boolean> { return await this.inner.runState(ctx, RUN_STATE_PROBE_AGENT_ID) === "running"; } async ensure(ctx: Context, agentId: string): Promise<BoxStatus> { const connection = await this.ensureReady(ctx, agentId); return this.runningStatus(agentId, connection.vncUrl); }
  async recreateInBox(ctx: Context, options: { preserveData: boolean; force?: boolean }): Promise<{ started: boolean; reason?: string }> { if (this.inner.recreateInBox == null) throw new SandBoxCapabilityError("This computer can't be recreated from inside the box."); return this.inner.recreateInBox(ctx, options); }
  getAgentWindowIndex(agentId: string): number | undefined { return this.inner.getAgentWindowIndex?.(agentId); }
  private notify(status: BoxStatus): void { this.lastReported.set(status.agentId, status); for (const listener of this.listeners) listener(status); } private report(status: BoxStatus): BoxStatus { this.lastReported.set(status.agentId, status); return status; }
}
