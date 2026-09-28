import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "../../packages/context/core.js";
import { boxApplyEnvironment, boxDescription, boxIsAvailable, boxIsPreparing, boxLoadMcpServers, boxMaxWindows, boxMcpResourceAccessor, boxTerminalsFolder, type CapableBox } from "./box-capabilities.js";
import { SAND_BOX_FIRST_FORK_WINDOW_INDEX, SAND_BOX_PRIMARY_WINDOW_INDEX, isPrimaryWindowIndex } from "../ports/box.js";
import { BoxFileUnreadableError } from "./box-transfer.js";
import { mintSandWindowOwnerToken } from "./box-windows.js";

export class SandBoxCapabilityError extends Error { constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "SandBoxCapabilityError"; } }
export const ASSIGNMENTS_LOAD_TIMEOUT_MS = 30_000;
export const ASSIGNMENTS_LOAD_RETRY_INTERVAL_MS = 1_000;
export const DEFAULT_SHARED_BOX_ID = "shared";
export const SHARED_DESKTOP_ASSIGNMENTS_BOX_PATH = "/home/box/.sand-window-assignments.json";
export interface ParsedAssignments { assignments: Map<string, number>; tokens: Map<string, string>; isCorrupt: boolean }
export function parseAssignments(bytes: Uint8Array, maxWindowCount: number): ParsedAssignments { const assignments = new Map<string, number>(), tokens = new Map<string, string>(); let parsed: unknown; try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { return { assignments, tokens, isCorrupt: true }; } if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return { assignments, tokens, isCorrupt: false }; const root = parsed as Record<string, unknown>, raw = root.assignments; if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return { assignments, tokens, isCorrupt: false }; const rawTokens = typeof root.tokens === "object" && root.tokens != null && !Array.isArray(root.tokens) ? root.tokens as Record<string, unknown> : undefined, usedForks = new Set<number>(); for (const agentId of Object.keys(raw).sort()) { const index = (raw as Record<string, unknown>)[agentId]; if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > maxWindowCount) continue; if (index >= SAND_BOX_FIRST_FORK_WINDOW_INDEX) { if (usedForks.has(index)) continue; usedForks.add(index); } assignments.set(agentId, index); const token = rawTokens?.[agentId]; if (typeof token === "string" && token.length > 0) tokens.set(agentId, token); } return { assignments, tokens, isCorrupt: false }; }
export function resolveSharedBoxId(explicit?: string, env: Record<string, string | undefined> = process.env): string { if (explicit) return explicit; return env.SAND_SHARED_BOX_ID?.trim() || DEFAULT_SHARED_BOX_ID; }

export interface SharedInnerBox<Accessor = unknown> extends CapableBox { ensureReady(ctx: Context, agentId: string): Promise<{ remoteAccessor: Accessor; vncUrl: string; terminalsFolder?: string }>; ensureWindow?(ctx: Context, agentId: string, windowIndex: number, options?: { ownerToken?: string }): Promise<{ windowIndex: number; computerUse: Accessor; vncUrl: string }>; releaseWindow?(ctx: Context, agentId: string, windowIndex: number): Promise<void>; recreateInBox?(ctx: Context, options: { preserveData: boolean; force?: boolean }): Promise<{ started: boolean; reason?: string }>; runState(ctx: Context, agentId: string): Promise<string>; listBoxes(): Promise<Array<{ agentId: string; running: boolean }>>; uploadFile(ctx: Context, agentId: string, path: string, data: Uint8Array): Promise<void>; downloadFile(ctx: Context, agentId: string, path: string): Promise<Uint8Array>; dispose?(): Promise<void> }
export interface SharedDesktopOptions<Accessor> { sharedBoxId?: string; persistAssignments?: boolean; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; gateComputerUse?: (primary: { remoteAccessor: Accessor; vncUrl: string; terminalsFolder?: string }) => { remoteAccessor: Accessor; vncUrl: string; terminalsFolder?: string }; reportPersistFailure?: (error: unknown) => void }
interface AssignmentsLoad { ctx: Context; cancel(reason?: unknown): void; waiters: Set<symbol>; promise: Promise<void> }

export class SharedDesktopSandBox<Accessor = unknown> {
  readonly sharedBoxId: string; readonly maxWindowCount: number; readonly persistAssignments: boolean; private readonly agentWindows = new Map<string, number>(); private readonly agentWindowTokens = new Map<string, string>(); private readonly establishedForks = new Set<string>(); private readonly windowsTearingDown = new Set<number>(); private assignmentsLoad: AssignmentsLoad | undefined; private persistChain = Promise.resolve();
  private readonly agentOperations = new Map<string, Promise<unknown>>();
  private readonly bringupCancels = new Map<string, Set<(reason?: unknown) => void>>();
  private readonly releasedAssignments = new Set<string>();
  private static readonly RELEASED_ASSIGNMENT_CAP = 4_096;
  constructor(readonly inner: SharedInnerBox<Accessor>, readonly options: SharedDesktopOptions<Accessor> = {}) { this.sharedBoxId = resolveSharedBoxId(options.sharedBoxId); this.maxWindowCount = Math.max(1, boxMaxWindows(inner)); this.persistAssignments = options.persistAssignments ?? false; }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.options.sleep != null) await this.options.sleep(ms, signal);
    else await delay(ms, undefined, { signal });
    signal.throwIfAborted();
  }
  private async serializeAgent<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.agentOperations.get(agentId);
    const operation = (previous ?? Promise.resolve()).catch(() => {}).then(work);
    this.agentOperations.set(agentId, operation);
    try { return await operation; }
    finally { if (this.agentOperations.get(agentId) === operation) this.agentOperations.delete(agentId); }
  }
  async ensureAssignmentsLoaded(ctx: Context): Promise<void> {
    ctx.signal.throwIfAborted();
    if (!this.persistAssignments) return;
    while (this.assignmentsLoad?.ctx.signal.aborted) {
      const stale = this.assignmentsLoad;
      await stale.promise.catch(() => {});
      if (this.assignmentsLoad === stale) this.assignmentsLoad = undefined;
      ctx.signal.throwIfAborted();
    }
    if (this.assignmentsLoad == null) {
      const [loadCtx, cancel] = ctx.withDetached().withCancel();
      const load: AssignmentsLoad = { ctx: loadCtx, cancel, waiters: new Set(), promise: Promise.resolve() };
      this.assignmentsLoad = load;
      load.promise = Promise.resolve().then(() => this.loadAssignments(loadCtx)).catch(error => {
        if (this.assignmentsLoad === load) this.assignmentsLoad = undefined;
        throw error;
      });
    }
    const load = this.assignmentsLoad, waiter = Symbol();
    load.waiters.add(waiter);
    const onAbort = () => {
      load.waiters.delete(waiter);
      if (load.waiters.size === 0) load.cancel(ctx.signal.reason);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try { await load.promise; }
    finally {
      ctx.signal.removeEventListener("abort", onAbort);
      load.waiters.delete(waiter);
      ctx.signal.throwIfAborted();
    }
  }
  private async loadAssignments(ctx: Context): Promise<void> {
    const deadline = this.now() + ASSIGNMENTS_LOAD_TIMEOUT_MS;
    for (;;) {
      ctx.signal.throwIfAborted();
      let persisted: Map<string, number>, persistedTokens = new Map<string, string>(), bytesLength = 0, isCorrupt = false;
      try {
        const bytes = await this.inner.downloadFile(ctx, this.sharedBoxId, SHARED_DESKTOP_ASSIGNMENTS_BOX_PATH);
        ctx.signal.throwIfAborted();
        bytesLength = bytes.length;
        const parsed = parseAssignments(bytes, this.maxWindowCount);
        persisted = parsed.assignments;
        persistedTokens = parsed.tokens;
        isCorrupt = parsed.isCorrupt;
      } catch (error) {
        ctx.signal.throwIfAborted();
        if (error instanceof BoxFileUnreadableError) return;
        if (this.now() < deadline) { await this.sleep(ASSIGNMENTS_LOAD_RETRY_INTERVAL_MS, ctx.signal); continue; }
        throw error;
      }
      if (persisted.size === 0 && (bytesLength === 0 || isCorrupt) && this.now() < deadline) {
        await this.sleep(ASSIGNMENTS_LOAD_RETRY_INTERVAL_MS, ctx.signal);
        continue;
      }
      ctx.signal.throwIfAborted();
      const used = new Set(this.agentWindows.values());
      for (const [agentId, index] of persisted) {
        if (this.releasedAssignments.has(agentId) || this.agentWindows.has(agentId) || used.has(index)) continue;
        this.agentWindows.set(agentId, index);
        used.add(index);
        const token = persistedTokens.get(agentId);
        if (token != null && !this.agentWindowTokens.has(agentId)) this.agentWindowTokens.set(agentId, token);
      }
      return;
    }
  }
  queuePersistAssignments(ctx: Context): void {
    if (!this.persistAssignments) return;
    const snapshot = JSON.stringify({ assignments: Object.fromEntries(this.agentWindows),
      tokens: Object.fromEntries([...this.agentWindows].flatMap(([id]) => {
        const token = this.agentWindowTokens.get(id);
        return token == null ? [] : [[id, token]];
      })) });
    // Persist from a detached replay of this snapshot: a caller that cancels
    // after a successful startup must not lose the seat it just created, and a
    // later retry can replay the same bytes without allocating again.
    const replayCtx = ctx.withDetached();
    this.persistChain = this.persistChain.then(async () => {
      try { await this.inner.uploadFile(replayCtx, this.sharedBoxId, SHARED_DESKTOP_ASSIGNMENTS_BOX_PATH, new TextEncoder().encode(snapshot)); }
      catch (error) { this.options.reportPersistFailure?.(error); }
    });
  }
  takeFreeForkIndex(agentId: string): number | undefined { const used = new Set(this.agentWindows.values()); for (let index = SAND_BOX_FIRST_FORK_WINDOW_INDEX; index <= this.maxWindowCount; index += 1) if (!used.has(index) && !this.windowsTearingDown.has(index)) { this.agentWindows.set(agentId, index); return index; } return undefined; }
  assignWindow(agentId: string): number | undefined { return this.agentWindows.get(agentId) ?? this.takeFreeForkIndex(agentId); }
  migrateLegacyPrimarySeat(agentId: string, assigned: number): number { if (!isPrimaryWindowIndex(assigned) || this.inner.ensureWindow == null) return assigned; const current = this.agentWindows.get(agentId) ?? assigned; return !isPrimaryWindowIndex(current) ? current : this.takeFreeForkIndex(agentId) ?? current; }
  private async restorePrimarySeat(ctx: Context, agentId: string, forkIndex: number): Promise<void> { await this.rollbackFailedBringup(ctx, agentId, { isNewAssignment: false, forkBringupAttempted: true }); if (this.agentWindows.get(agentId) !== forkIndex) return; this.agentWindows.set(agentId, SAND_BOX_PRIMARY_WINDOW_INDEX); this.agentWindowTokens.delete(agentId); this.queuePersistAssignments(ctx); }
  private async rollbackFailedBringup(ctx: Context, agentId: string, opts: { isNewAssignment: boolean; forkBringupAttempted: boolean }): Promise<void> {
    const cleanupCtx = ctx.withDetached();
    const index = this.agentWindows.get(agentId), isFork = index != null && index >= SAND_BOX_FIRST_FORK_WINDOW_INDEX;
    // Existing successful seats belong to healthy callers, even if this later ensure was canceled.
    if (this.establishedForks.has(agentId)) return;
    if (opts.forkBringupAttempted && isFork && index != null) {
      this.windowsTearingDown.add(index);
      try { await this.inner.releaseWindow?.(cleanupCtx, this.sharedBoxId, index); } catch {}
      finally { this.windowsTearingDown.delete(index); }
    }
    if (opts.isNewAssignment) {
      this.agentWindows.delete(agentId);
      this.agentWindowTokens.delete(agentId);
      this.queuePersistAssignments(cleanupCtx);
    }
  }
  private gateComputerUse(primary: { remoteAccessor: Accessor; vncUrl: string; terminalsFolder?: string }) { return this.options.gateComputerUse?.(primary) ?? primary; }
  async ensureReady(ctx: Context, agentId: string) {
    ctx.signal.throwIfAborted();
    const [operationCtx, cancel] = ctx.withDetached().withCancel();
    const onAbort = () => cancel(ctx.signal.reason);
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const cancels = this.bringupCancels.get(agentId) ?? new Set<(reason?: unknown) => void>();
    cancels.add(cancel);
    this.bringupCancels.set(agentId, cancels);
    try {
      return await this.serializeAgent(agentId, async () => {
        const connection = await this.ensureAgentReady(operationCtx, agentId);
        operationCtx.signal.throwIfAborted();
        return connection;
      });
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
      cancels.delete(cancel);
      if (cancels.size === 0 && this.bringupCancels.get(agentId) === cancels) this.bringupCancels.delete(agentId);
    }
  }
  private async ensureAgentReady(ctx: Context, agentId: string) {
    ctx.signal.throwIfAborted();
    await this.ensureAssignmentsLoaded(ctx);
    ctx.signal.throwIfAborted();
    // Deletion is a tombstone for this layer too: a late ensure for a released
    // agent must not resurrect its seat, even before the release cleanup runs.
    if (this.releasedAssignments.has(agentId)) throw new Error("Box window was released during startup");
    const isNewAssignment = !this.agentWindows.has(agentId), assigned = this.assignWindow(agentId);
    let index = assigned, isMigration = false, forkBringupAttempted = false;
    try {
      ctx.signal.throwIfAborted();
      const primary = await this.inner.ensureReady(ctx, this.sharedBoxId);
      ctx.signal.throwIfAborted();
      if (assigned == null) return this.gateComputerUse(primary);
      index = this.migrateLegacyPrimarySeat(agentId, assigned);
      isMigration = index !== assigned;
      if (isPrimaryWindowIndex(index)) return primary;
      let tokenIsNew = false;
      if (!this.agentWindowTokens.has(agentId)) {
        this.agentWindowTokens.set(agentId, mintSandWindowOwnerToken());
        tokenIsNew = true;
      }
      if (isNewAssignment || tokenIsNew || isMigration) this.queuePersistAssignments(ctx);
      if (this.inner.ensureWindow == null) {
        await this.rollbackFailedBringup(ctx, agentId, { isNewAssignment, forkBringupAttempted: false });
        ctx.signal.throwIfAborted();
        return this.gateComputerUse(primary);
      }
      ctx.signal.throwIfAborted();
      forkBringupAttempted = true;
      let window;
      try {
        window = await this.inner.ensureWindow(ctx, this.sharedBoxId, index, { ownerToken: this.agentWindowTokens.get(agentId)! });
        ctx.signal.throwIfAborted();
      } catch (error) {
        if (!ctx.signal.aborted && isMigration && !this.establishedForks.has(agentId)) {
          await this.restorePrimarySeat(ctx.withDetached(), agentId, index);
          ctx.signal.throwIfAborted();
          return primary;
        }
        throw error;
      }
      this.establishedForks.add(agentId);
      return { remoteAccessor: window.computerUse, vncUrl: window.vncUrl, terminalsFolder: primary.terminalsFolder };
    } catch (error) {
      await this.rollbackFailedBringup(ctx, agentId, { isNewAssignment, forkBringupAttempted });
      if (isMigration && this.agentWindows.get(agentId) === index && !this.establishedForks.has(agentId)) {
        this.agentWindows.set(agentId, SAND_BOX_PRIMARY_WINDOW_INDEX);
        this.agentWindowTokens.delete(agentId);
        this.queuePersistAssignments(ctx.withDetached());
      }
      ctx.signal.throwIfAborted();
      throw error;
    }
  }
  async hibernate(): Promise<void> {} async recreateInBox(ctx: Context, options: { preserveData: boolean; force?: boolean }): Promise<{ started: boolean; reason?: string }> { if (this.inner.recreateInBox == null) throw new SandBoxCapabilityError("This box backend does not support an in-box recreate."); return this.inner.recreateInBox(ctx, options); } async applyEnvironment(ctx: Context, update: unknown): Promise<void> { await boxApplyEnvironment(this.inner, ctx, update); } async loadMcpServers(ctx: Context, configJson: string): Promise<unknown> { return boxLoadMcpServers(this.inner, ctx, configJson); } async mcpResourceAccessor(ctx: Context): Promise<unknown> { return boxMcpResourceAccessor(this.inner, ctx); }
  async releaseWindow(ctx: Context, agentId: string): Promise<void> {
    this.releasedAssignments.add(agentId);
    while (this.releasedAssignments.size > SharedDesktopSandBox.RELEASED_ASSIGNMENT_CAP) {
      const oldest = this.releasedAssignments.values().next();
      if (oldest.done) break;
      this.releasedAssignments.delete(oldest.value);
    }
    for (const cancel of this.bringupCancels.get(agentId) ?? []) cancel(new Error("Shared desktop window was released during startup"));
    return this.serializeAgent(agentId, async () => {
      const cleanupCtx = ctx.withDetached(), index = this.agentWindows.get(agentId);
      this.agentWindows.delete(agentId);
      this.agentWindowTokens.delete(agentId);
      this.establishedForks.delete(agentId);
      if (index != null) this.queuePersistAssignments(cleanupCtx);
      if (index != null && index >= SAND_BOX_FIRST_FORK_WINDOW_INDEX) {
        this.windowsTearingDown.add(index);
        try { await this.inner.releaseWindow?.(cleanupCtx, this.sharedBoxId, index); }
        finally { this.windowsTearingDown.delete(index); }
      }
    });
  }
  getAgentWindowIndex(agentId: string): number | undefined { return this.agentWindows.get(agentId); } getTerminalsFolder(): string | undefined { return boxTerminalsFolder(this.inner); } async runState(ctx: Context): Promise<string> { return this.inner.runState(ctx, this.sharedBoxId); } async isAvailable(): Promise<boolean> { return boxIsAvailable(this.inner); } describe(): unknown { return boxDescription(this.inner); } isPreparing(): boolean { return boxIsPreparing(this.inner, this.sharedBoxId); }
  async listBoxes(): Promise<Array<{ agentId: string; running: boolean }>> { const running = (await this.inner.listBoxes()).some((box) => box.running); return [...this.agentWindows.keys()].map((agentId) => ({ agentId, running })); } async uploadFile(ctx: Context, _agentId: string, path: string, data: Uint8Array): Promise<void> { await this.inner.uploadFile(ctx, this.sharedBoxId, path, data); } async downloadFile(ctx: Context, _agentId: string, path: string): Promise<Uint8Array> { return this.inner.downloadFile(ctx, this.sharedBoxId, path); }
  async flushPersistence(): Promise<void> {
    // Drain to quiescence: new assignments queued while flushing join the same
    // run instead of being lost behind a snapshot taken at call time.
    for (;;) {
      const pending = this.persistChain;
      await pending;
      if (this.persistChain === pending) return;
    }
  }
  async dispose(): Promise<void> { await this.flushPersistence(); await this.inner.dispose?.(); }
}
