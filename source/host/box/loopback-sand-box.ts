import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createContext, type Context } from "../../packages/context/core.js";
import { findSystemErrno } from "../../shared/system-errno.js";
import { SAND_BOX_FORK_NOVNC_PORT, SAND_BOX_PRIMARY_NOVNC_PORT } from "../../packages/constants/sand-box.js";
import { SandBoxDaemonUnreachableError, isPrimaryWindowIndex } from "../ports/box.js";
import { agentMediaReadScopeKey, assertPathOutsideProtectedRoots } from "./protected-path-guard.js";
import type { BoxEnvironmentUpdate } from "./box-env.js";
import { BoxFileUnreadableError, resolveBoxWorkspacePath } from "./box-transfer.js";
import { SAND_BOX_DISPLAY_HEADER, SAND_BOX_FORK_ROUTER_PORT, SAND_BOX_MAX_WINDOWS, SAND_BOX_WINDOW_OWNER_HEADER, clearAgentWindowConnections, primarySandBoxWindow, runStartWindow, runStopWindow, sandBoxDisplayToken, sandBoxWindowKey, type ShellAccessor } from "./box-windows.js";
import type { WindowSeatProbe } from "./shared-desktop-sand-box.js";

export const EXEC_DAEMON_PORT = 1337;
export const VNC_PORT = SAND_BOX_PRIMARY_NOVNC_PORT;
export const DEFAULT_AUTH_TOKEN = "local";
export const BOX_TERMINALS_FOLDER = "/root/.cursor/projects/workspace/terminals";
export const DAEMON_READY_TIMEOUT_MS = 90_000;
export const DAEMON_WATCHDOG_INTERVAL_MS = 30_000;

export type DaemonPingOutcome = "ok" | "refused" | "timeout" | "dns" | "disconnected" | string;
export interface BoxEndpoint { host: string; port: number; authToken: string; headers?: Record<string, string> }
export interface PingResult { outcome: DaemonPingOutcome; causeSummary?: string }
export interface DaemonPingReport { outcome: string; attempts: number; durationMs: number; unreadyDurationMs: number; readinessState: string; target: string; causeSummary?: string }
export interface LoopbackTelemetry { reportDaemonPing(report: DaemonPingReport): void }
export interface LoopbackOperations<Accessor extends ShellAccessor = ShellAccessor> { ping(ctx: Context, endpoint: BoxEndpoint): Promise<PingResult>; createRemoteAccessor(endpoint: BoxEndpoint): Accessor; protectRemoteAccessor(accessor: Accessor, assertFileReadAllowed: (path: string, ctx: Context) => Promise<void>): Accessor; applyEnvironment?(ctx: Context, endpoint: BoxEndpoint, update: BoxEnvironmentUpdate): Promise<void>; loadMcpServers?(ctx: Context, endpoint: BoxEndpoint, configJson: string): Promise<string[]>; uploadFile?(ctx: Context, accessor: Accessor, path: string, data: Uint8Array): Promise<void>; sleep?(ms: number, signal?: AbortSignal): Promise<void>; now?(): number }
export interface LoopbackSandBoxOptions<Accessor extends ShellAccessor = ShellAccessor> { host?: string; authToken?: string; telemetry?: LoopbackTelemetry; readyTimeoutMs?: number; pollIntervalMs?: number; watchdogIntervalMs?: number; protectedBoxPaths?: readonly string[]; operations: LoopbackOperations<Accessor> }
export function daemonPingReadinessState(outcome: string): string { if (outcome === "refused") return "up_but_exec_refused"; if (outcome === "timeout") return "up_but_exec_unresponsive"; return "up_but_exec_disconnected"; }

export class LoopbackSandBox<Accessor extends ShellAccessor = ShellAccessor> {
  readonly host: string; readonly authToken: string; readonly readyTimeoutMs: number; readonly pollIntervalMs: number; readonly watchdogIntervalMs: number; readonly protectedBoxPaths: readonly string[]; private telemetry: LoopbackTelemetry = { reportDaemonPing() {} }; private hasTelemetry = false; private daemonWatchdogStarted = false; private readonly daemonWatchdogAbort = new AbortController(); private daemonWatchdogRun: Promise<void> | undefined; private daemonWatchdogPoll: Promise<void> | undefined; private daemonForegroundReadyWaits = 0; private daemonWatchdogState: "ready" | "unready" | undefined; private daemonWatchdogUnreadySince: number | undefined; private daemonWatchdogUnreadyAttempts = 0; private readonly windowConnections = new Map<string, { window: { windowIndex: number; computerUse: Accessor; vncUrl: string }; endpoint: BoxEndpoint; ownerToken?: string }>();
  constructor(readonly options: LoopbackSandBoxOptions<Accessor>) { this.host = options.host ?? "127.0.0.1"; this.authToken = options.authToken ?? DEFAULT_AUTH_TOKEN; if (options.telemetry != null) this.setTelemetry(options.telemetry); this.readyTimeoutMs = options.readyTimeoutMs ?? DAEMON_READY_TIMEOUT_MS; this.pollIntervalMs = options.pollIntervalMs ?? 500; this.watchdogIntervalMs = options.watchdogIntervalMs ?? DAEMON_WATCHDOG_INTERVAL_MS; this.protectedBoxPaths = options.protectedBoxPaths ?? []; }
  private now(): number { return this.options.operations.now?.() ?? Date.now(); } private async sleep(ms: number, signal?: AbortSignal): Promise<void> { if (this.options.operations.sleep != null) return this.options.operations.sleep(ms, signal); await delay(ms, undefined, signal == null ? { ref: false } : { ref: false, signal }); }
  private async waitFor<T>(ctx: Context, promise: Promise<T>): Promise<T> {
    let onAbort: () => void = () => {};
    try {
      const result = await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(ctx.signal.reason);
        promise.then(resolve, reject);
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        if (ctx.signal.aborted) onAbort();
      });
      ctx.signal.throwIfAborted();
      return result;
    } finally { ctx.signal.removeEventListener("abort", onAbort); }
  }
  setTelemetry(telemetry: LoopbackTelemetry): void { this.telemetry = telemetry; this.hasTelemetry = true; }
  async assertFileReadAllowed(boxPath: string, ctx?: Context): Promise<void> { await assertPathOutsideProtectedRoots(this.protectedBoxPaths, boxPath, "/workspace", ctx?.get(agentMediaReadScopeKey)); }
  protectRemoteAccessor(remoteAccessor: Accessor): Accessor { return this.options.operations.protectRemoteAccessor(remoteAccessor, (path, ctx) => this.assertFileReadAllowed(path, ctx)); }
  describe(): { backend: "loopback" } { return { backend: "loopback" }; } getTerminalsFolder(): string { return BOX_TERMINALS_FOLDER; } async isAvailable(): Promise<true> { return true; }
  primaryEndpoint(): BoxEndpoint { return { host: this.host, port: EXEC_DAEMON_PORT, authToken: this.authToken }; }
  async ensureReady(ctx: Context, _agentId: string): Promise<{ remoteAccessor: Accessor; vncUrl: string; terminalsFolder: string }> { ctx.signal.throwIfAborted(); const endpoint = this.primaryEndpoint(); await this.waitUntilReady(ctx, endpoint); ctx.signal.throwIfAborted(); return { remoteAccessor: this.protectRemoteAccessor(this.options.operations.createRemoteAccessor(endpoint)), vncUrl: `http://${this.host}:${VNC_PORT}/vnc.html`, terminalsFolder: BOX_TERMINALS_FOLDER }; }
  async applyEnvironment(ctx: Context, update: BoxEnvironmentUpdate): Promise<void> { const endpoint = this.primaryEndpoint(); await this.waitUntilReady(ctx, endpoint); if (this.options.operations.applyEnvironment == null) throw new Error("loopback environment transport is unavailable"); await this.options.operations.applyEnvironment(ctx, endpoint, update); }
  async loadMcpServers(ctx: Context, configJson: string): Promise<string[]> { const endpoint = this.primaryEndpoint(); await this.waitUntilReady(ctx, endpoint); if (this.options.operations.loadMcpServers == null) throw new Error("loopback MCP transport is unavailable"); return this.options.operations.loadMcpServers(ctx, endpoint, configJson); }
  async mcpResourceAccessor(ctx: Context): Promise<Accessor> { const endpoint = this.primaryEndpoint(); await this.waitUntilReady(ctx, endpoint); return this.options.operations.createRemoteAccessor(endpoint); }
  maxWindows(): number { return SAND_BOX_MAX_WINDOWS; }
  async ensureWindow(ctx: Context, agentId: string, windowIndex: number, opts?: { ownerToken?: string }): Promise<{ windowIndex: number; computerUse: Accessor; vncUrl: string }> {
    ctx.signal.throwIfAborted();
    if (isPrimaryWindowIndex(windowIndex)) {
      const primary = await this.ensureReady(ctx, agentId);
      ctx.signal.throwIfAborted();
      return primarySandBoxWindow(primary);
    }
    const ownerToken = opts?.ownerToken, key = sandBoxWindowKey(agentId, windowIndex), cached = this.windowConnections.get(key);
    if (cached != null && cached.ownerToken === ownerToken) {
      const ping = await this.waitFor(ctx, this.options.operations.ping(ctx, cached.endpoint));
      ctx.signal.throwIfAborted();
      if (ping.outcome === "ok") return cached.window;
    }
    this.windowConnections.delete(key);
    const primary = await this.ensureReady(ctx, agentId);
    ctx.signal.throwIfAborted();
    await runStartWindow(ctx, primary.remoteAccessor, windowIndex, ownerToken);
    ctx.signal.throwIfAborted();
    const token = sandBoxDisplayToken(windowIndex), headers: Record<string, string> = { [SAND_BOX_DISPLAY_HEADER]: token };
    if (ownerToken != null) headers[SAND_BOX_WINDOW_OWNER_HEADER] = ownerToken;
    const endpoint = { host: this.host, port: SAND_BOX_FORK_ROUTER_PORT, authToken: this.authToken, headers };
    await this.waitUntilReady(ctx, endpoint);
    ctx.signal.throwIfAborted();
    const window = { windowIndex, computerUse: this.protectRemoteAccessor(this.options.operations.createRemoteAccessor(endpoint)), vncUrl: `http://${this.host}:${SAND_BOX_FORK_NOVNC_PORT}/vnc.html?path=${encodeURIComponent(`websockify?token=${token}`)}` };
    ctx.signal.throwIfAborted();
    this.windowConnections.set(key, ownerToken == null ? { window, endpoint } : { window, endpoint, ownerToken });
    return window;
  }
  async probeWindow(ctx: Context, agentId: string, windowIndex: number): Promise<WindowSeatProbe> {
    if (isPrimaryWindowIndex(windowIndex)) return "unknown";
    const cached = this.windowConnections.get(sandBoxWindowKey(agentId, windowIndex));
    const headers: Record<string, string> = { [SAND_BOX_DISPLAY_HEADER]: sandBoxDisplayToken(windowIndex) };
    if (cached?.ownerToken != null) headers[SAND_BOX_WINDOW_OWNER_HEADER] = cached.ownerToken;
    const endpoint: BoxEndpoint = { host: this.host, port: SAND_BOX_FORK_ROUTER_PORT, authToken: this.authToken, headers };
    try { const probe = await this.waitFor(ctx, this.options.operations.ping(ctx, endpoint)); return probe.outcome === "ok" ? "reachable" : "unreachable"; }
    catch (error) { return ctx.signal.aborted ? "unknown" : "unreachable"; }
  }
  async releaseWindow(ctx: Context, agentId: string, windowIndex: number): Promise<void> {
    if (windowIndex == null || isPrimaryWindowIndex(windowIndex)) return;
    this.windowConnections.delete(sandBoxWindowKey(agentId, windowIndex));
    // Never make deletion pay a full ready timeout when the daemon is already
    // unreachable: a quick liveness probe decides whether stop can run. When the
    // probe fails the seat may still be holding a display, so report it instead
    // of returning silently - a skipped stop leaves a zombie seat that the next
    // turn keeps colliding with, and nothing else would record that it happened.
    let probe: PingResult | undefined;
    try { probe = await this.waitFor(ctx, this.options.operations.ping(ctx, this.primaryEndpoint())); }
    catch (error) { this.logSeatRelease(windowIndex, "probe-threw", error); return; }
    if (probe.outcome !== "ok") {
      this.logSeatRelease(windowIndex, "primary-unreachable", undefined, probe.outcome);
      // The primary daemon is what runs stop-window, so there is nothing left to
      // run it with. Clearing the cached connection is still correct and done
      // above; the box-level owner keeps the seat out of the allocator.
      return;
    }
    try { await runStopWindow(ctx, (await this.ensureReady(ctx, agentId)).remoteAccessor, windowIndex); }
    catch (error) { this.logSeatRelease(windowIndex, "stop-window-failed", error); }
  }
  private logSeatRelease(windowIndex: number, reason: string, error?: unknown, probeOutcome?: string): void {
    if (!this.hasTelemetry) return;
    this.telemetry.reportDaemonPing({ outcome: "seat_release_skipped", attempts: 1, durationMs: 0, unreadyDurationMs: 0, readinessState: `window_${reason}`, target: `${this.host}:window-${windowIndex}`, ...(probeOutcome == null ? {} : { causeSummary: `primary_ping=${probeOutcome}` }), ...(error == null ? {} : { causeSummary: `error=${error instanceof Error ? error.message : String(error)}` }) });
  }
  async hibernate(_ctx: Context, agentId: string): Promise<void> { clearAgentWindowConnections(this.windowConnections, agentId); } async runState(): Promise<"running"> { return "running"; } async listBoxes(): Promise<Array<{ agentId: string; running: boolean }>> { return [{ agentId: "", running: true }]; }
  async dispose(): Promise<void> { this.daemonWatchdogAbort.abort(); await this.daemonWatchdogRun; }
  async uploadFile(ctx: Context, agentId: string, boxPath: string, data: Uint8Array): Promise<void> { const connection = await this.ensureReady(ctx, agentId); if (this.options.operations.uploadFile == null) throw new Error("loopback upload transport is unavailable"); await this.options.operations.uploadFile(ctx, connection.remoteAccessor, resolveBoxWorkspacePath(boxPath), data); }
  async downloadFile(ctx: Context, _agentId: string, boxPath: string): Promise<Buffer> {
    const resolved = resolveBoxWorkspacePath(boxPath);
    let handle;
    try {
      // No-follow open plus a post-open guard re-check: a concurrent symlink
      // swap between the pre-open check and this read must not widen access.
      handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (findSystemErrno(error) === "ENOENT") throw new BoxFileUnreadableError(`download from box ${resolved} failed (file missing)`, { cause: error });
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new BoxFileUnreadableError(`download from box ${resolved} failed (not a file)`);
      await this.assertFileReadAllowed(resolved, ctx);
      ctx.signal.throwIfAborted();
      return await handle.readFile({ signal: ctx.signal });
    } catch (error) {
      if (error instanceof BoxFileUnreadableError) throw error;
      if (findSystemErrno(error) === "ENOENT") throw new BoxFileUnreadableError(`download from box ${resolved} failed (file missing)`, { cause: error });
      throw error;
    } finally { await handle.close(); }
  }
  async waitUntilReady(ctx: Context, endpoint: BoxEndpoint, timeoutMs = this.readyTimeoutMs): Promise<void> {
    ctx.signal.throwIfAborted();
    if (endpoint.port !== EXEC_DAEMON_PORT) return this.waitUntilReadyUncoordinated(ctx, endpoint, timeoutMs);
    this.daemonForegroundReadyWaits += 1;
    try {
      if (this.daemonWatchdogPoll != null) await this.waitFor(ctx, this.daemonWatchdogPoll);
      ctx.signal.throwIfAborted();
      return await this.waitUntilReadyUncoordinated(ctx, endpoint, timeoutMs);
    } finally { this.daemonForegroundReadyWaits -= 1; }
  }
  async waitUntilReadyUncoordinated(ctx: Context, endpoint: BoxEndpoint, timeoutMs: number): Promise<void> {
    ctx.signal.throwIfAborted();
    const start = this.now(), target = `${endpoint.host}:${endpoint.port}`;
    let attempts = 0, last: PingResult | undefined, unreadySince: number | undefined;
    while (this.now() - start < timeoutMs) {
      ctx.signal.throwIfAborted();
      attempts += 1;
      last = await this.waitFor(ctx, this.options.operations.ping(ctx, endpoint));
      ctx.signal.throwIfAborted();
      if (last.outcome === "ok") {
        const primary = endpoint.port === EXEC_DAEMON_PORT, watchdogOutage = primary && this.daemonWatchdogState === "unready";
        if (attempts > 1 || watchdogOutage) {
          const episodeStart = watchdogOutage ? this.daemonWatchdogUnreadySince ?? start : unreadySince ?? start;
          this.telemetry.reportDaemonPing({ outcome: "ok", attempts: watchdogOutage ? this.daemonWatchdogUnreadyAttempts + attempts : attempts, durationMs: this.now() - (watchdogOutage ? episodeStart : start), unreadyDurationMs: this.now() - episodeStart, readinessState: "ready_after_retry", target });
        }
        if (primary) {
          this.daemonWatchdogState = "ready";
          this.daemonWatchdogUnreadySince = undefined;
          this.daemonWatchdogUnreadyAttempts = 0;
          this.startDaemonWatchdog(endpoint);
        }
        return;
      }
      unreadySince ??= this.now();
      await this.waitFor(ctx, this.sleep(this.pollIntervalMs, ctx.signal));
    }
    ctx.signal.throwIfAborted();
    const outcome = last == null || last.outcome === "ok" ? "refused" : last.outcome, now = this.now();
    this.telemetry.reportDaemonPing({ outcome, attempts, durationMs: now - start, unreadyDurationMs: now - (unreadySince ?? start), readinessState: daemonPingReadinessState(outcome), target, ...(last?.causeSummary == null ? {} : { causeSummary: last.causeSummary }) });
    if (endpoint.port === EXEC_DAEMON_PORT && this.daemonWatchdogStarted) {
      if (this.daemonWatchdogState === "ready") { this.daemonWatchdogUnreadySince = unreadySince ?? start; this.daemonWatchdogUnreadyAttempts = attempts; }
      else this.daemonWatchdogUnreadyAttempts += attempts;
      this.daemonWatchdogState = "unready";
    }
    throw new SandBoxDaemonUnreachableError(outcome, `loopback sand box exec-daemon at ${target} not ready within ${timeoutMs}ms (last ping: ${outcome}${last?.causeSummary == null ? "" : ` [${last.causeSummary}]`})`);
  }
  private startDaemonWatchdog(endpoint: BoxEndpoint): void { if (!this.hasTelemetry || this.daemonWatchdogStarted || this.watchdogIntervalMs <= 0) return; this.daemonWatchdogState = "ready"; this.daemonWatchdogStarted = true; this.daemonWatchdogRun = this.runDaemonWatchdog(endpoint); }
  private async runDaemonWatchdog(endpoint: BoxEndpoint): Promise<void> { try { while (!this.daemonWatchdogAbort.signal.aborted) { await this.sleep(this.watchdogIntervalMs, this.daemonWatchdogAbort.signal); if (this.daemonForegroundReadyWaits > 0) continue; const poll = this.pollDaemonWatchdog(endpoint); this.daemonWatchdogPoll = poll; try { await poll; } finally { if (this.daemonWatchdogPoll === poll) this.daemonWatchdogPoll = undefined; } } } catch (error) { if (!this.daemonWatchdogAbort.signal.aborted) throw error; } }
  async pollDaemonWatchdog(endpoint: BoxEndpoint): Promise<void> { const started = this.now(), result = await this.options.operations.ping(createContext(), endpoint), now = this.now(), target = `${endpoint.host}:${endpoint.port}`; if (result.outcome === "ok") { if (this.daemonWatchdogState === "unready") { const since = this.daemonWatchdogUnreadySince ?? started; this.telemetry.reportDaemonPing({ outcome: "ok", attempts: this.daemonWatchdogUnreadyAttempts + 1, durationMs: now - since, unreadyDurationMs: now - since, readinessState: "ready_after_retry", target }); } this.daemonWatchdogState = "ready"; this.daemonWatchdogUnreadySince = undefined; this.daemonWatchdogUnreadyAttempts = 0; return; } if (this.daemonWatchdogState === "ready") { this.daemonWatchdogState = "unready"; this.daemonWatchdogUnreadySince = started; this.daemonWatchdogUnreadyAttempts = 1; this.telemetry.reportDaemonPing({ outcome: result.outcome, attempts: 1, durationMs: now - started, unreadyDurationMs: now - started, readinessState: daemonPingReadinessState(result.outcome), target, ...(result.causeSummary == null ? {} : { causeSummary: result.causeSummary }) }); } else this.daemonWatchdogUnreadyAttempts += 1; }
}
