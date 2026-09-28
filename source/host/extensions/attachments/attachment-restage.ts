import { realClock, type Clock } from "../../../internal/scheduling.js";
import type { Context } from "../../../packages/context/core.js";
import { isSafeFolderId } from "../../storage/folder-id.js";
import { attachmentStagingPath, type AttachmentStageResult } from "./box-staging.js";

export const ATTACHMENT_RESTAGE_DELAYS_MS = [30_000, 90_000] as const;
export const ATTACHMENT_STAGE_DEADLINE_MS = 20_000;
const MAX_AGENTS = 128;
const MAX_PATHS = 256;
const MAX_WAITERS = 32;
const RESULT_TTL_MS = 5 * 60_000;

export interface AttachmentRestageOptions {
  readonly clock?: Clock;
  readonly retryDelaysMs?: readonly [number, number];
  readonly deadlineMs?: number;
}
export interface AttachmentRestageDependencies extends AttachmentRestageOptions {
  readonly ctx: Context;
  readonly stage: (ctx: Context, agentId: string, paths: readonly string[], onResult: (result: AttachmentStageResult) => void) => Promise<Map<string, string>>;
  readonly report?: (diagnostic: Record<string, unknown>) => void;
}
interface PendingPath { attempt: number; due: number }
interface RememberedPath { boxPath: string | null; expires: number }
interface AgentState {
  readonly id: string;
  readonly pending: Map<string, PendingPath>;
  readonly remembered: Map<string, RememberedPath>;
  readonly cancels: Set<() => void>;
  readonly waiters: Set<() => void>;
  inFlight: Promise<void> | undefined;
  timer: { dispose(): void } | undefined;
  retrying: boolean;
  forgotten: boolean;
}

/** A bounded best-effort queue shared by initial transfers and delayed retries. */
export function createAttachmentRestager(deps: AttachmentRestageDependencies) {
  const clock = deps.clock ?? realClock;
  const delays = deps.retryDelaysMs ?? ATTACHMENT_RESTAGE_DELAYS_MS;
  const deadlineMs = deps.deadlineMs ?? ATTACHMENT_STAGE_DEADLINE_MS;
  if (delays.some(delay => !Number.isFinite(delay) || delay < 0) || !Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new RangeError("Invalid attachment staging timing");
  const agents = new Map<string, AgentState>();
  let disposed = false;
  const report = (kind: string, extra: Record<string, unknown> = {}) => {
    try { deps.report?.({ extension: "attachments", kind, ...extra }); } catch { /* Telemetry is best effort. */ }
  };
  const remember = (state: AgentState, path: string, boxPath: string | null) => {
    state.remembered.delete(path);
    state.remembered.set(path, { boxPath, expires: clock.monotonicNow() + RESULT_TTL_MS });
    if (state.remembered.size > MAX_PATHS) state.remembered.delete(state.remembered.keys().next().value!);
    state.pending.delete(path);
  };
  const known = (state: AgentState, path: string) => {
    const result = state.remembered.get(path);
    if (result !== undefined && result.expires <= clock.monotonicNow()) { state.remembered.delete(path); return undefined; }
    return result;
  };
  const stateFor = (agentId: string): AgentState | undefined => {
    if (disposed || !isSafeFolderId(agentId) || agentId.trim() !== agentId) return undefined;
    let state = agents.get(agentId);
    if (state?.forgotten) return undefined;
    if (state === undefined) {
      if (agents.size >= MAX_AGENTS) {
        const idle = [...agents.values()].find(item => item.inFlight === undefined && item.cancels.size === 0 && item.pending.size === 0 && !item.retrying);
        if (idle === undefined) { report("stage_capacity", { scope: "agents" }); return undefined; }
        idle.timer?.dispose();
        agents.delete(idle.id);
      }
      state = { id: agentId, pending: new Map(), remembered: new Map(), cancels: new Set(), waiters: new Set(), inFlight: undefined, timer: undefined, retrying: false, forgotten: false };
    }
    // Old idle records are evicted first; active lanes are never evicted.
    agents.delete(agentId);
    agents.set(agentId, state);
    return state;
  };
  const pathsFor = (paths: readonly string[]) => {
    const selected = new Map<string, string>();
    for (const path of paths) {
      if (selected.size >= MAX_PATHS) { report("stage_capacity", { scope: "paths" }); break; }
      if (typeof path !== "string" || path.length === 0 || path.length > 4096) continue;
      selected.set(path, attachmentStagingPath(path));
    }
    return selected;
  };
  const resultFor = (state: AgentState, paths: Map<string, string>, partial = new Map<string, string>()) => {
    const result = new Map<string, string>();
    if (disposed || state.forgotten) return result;
    for (const [original, path] of paths) {
      const boxPath = partial.get(path) ?? known(state, path)?.boxPath;
      if (boxPath != null) result.set(original, boxPath);
    }
    return result;
  };
  const waitForLane = (state: AgentState, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const cleanup = () => { state.waiters.delete(wake); signal.removeEventListener("abort", abort); };
    const wake = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    state.waiters.add(wake);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (state.inFlight === undefined) wake();
  });

  const arm = (state: AgentState) => {
    state.timer?.dispose();
    state.timer = undefined;
    if (disposed || state.forgotten || state.retrying || state.pending.size === 0) return;
    const due = Math.min(...[...state.pending.values()].map(item => item.due));
    state.timer = clock.schedule(Math.max(0, due - clock.monotonicNow()), () => {
      state.timer = undefined;
      void retry(state);
    });
  };

  async function stageIntoBox(agentId: string, paths: readonly string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const state = stateFor(agentId);
    if (state === undefined) return new Map();
    const selected = pathsFor(paths);
    if ([...selected.values()].every(path => known(state, path) !== undefined)) return resultFor(state, selected);
    if (state.cancels.size >= MAX_WAITERS) { report("stage_capacity", { scope: "waiters" }); return resultFor(state, selected); }
    // Context.withCancel() leaves its parent listener attached. Detach each
    // attempt and link cancellation explicitly so a long-lived host cannot leak.
    const [ctx, cancel] = deps.ctx.withDetached().withName("attachmentStaging").withCancel();
    const cancelAttempt = () => cancel(new Error("Attachment staging canceled"));
    state.cancels.add(cancelAttempt);
    let timedOut = false;
    const timer = clock.schedule(deadlineMs, () => { timedOut = true; cancel(new Error("Attachment staging deadline exceeded")); });
    const partial = new Map<string, string>();
    let removeAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(ctx.reason);
      ctx.signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => ctx.signal.removeEventListener("abort", abort);
    });
    // A cancellation can happen while waiting for the lane, before the race.
    void aborted.catch(() => {});
    try {
      while (state.inFlight !== undefined) await waitForLane(state, ctx.signal);
      ctx.signal.throwIfAborted();
      const missing = [...new Set(selected.values())].filter(path => known(state, path) === undefined);
      if (missing.length === 0) return resultFor(state, selected);
      const onResult = (result: AttachmentStageResult) => {
        if (ctx.canceled || state.forgotten || disposed) return;
        if (result.kind === "staged") {
          partial.set(result.path, result.boxPath);
          remember(state, result.path, result.boxPath);
        } else {
          if (!result.retryable) remember(state, result.path, null);
          report(result.kind === "skipped" ? "stage_file_skipped" : "stage_file_failed", { reason: result.reason, retryable: result.retryable });
        }
      };
      const work = Promise.resolve().then(() => {
        ctx.signal.throwIfAborted();
        return deps.stage(ctx, agentId, missing, onResult);
      });
      const lane = work.then(result => {
        if (!ctx.canceled && !state.forgotten && !disposed) {
          for (const [path, boxPath] of result) onResult({ path, kind: "staged", boxPath });
        }
      }, () => {}).finally(() => {
        if (state.inFlight === lane) state.inFlight = undefined;
        for (const wake of [...state.waiters]) wake();
      });
      // Keep the lane until the transport actually settles, even if it ignores
      // cancellation. A deadline must never permit overlapping uploads.
      state.inFlight = lane;
      await Promise.race([work, aborted]);
      return resultFor(state, selected, partial);
    } catch {
      if (!disposed && !state.forgotten) report(timedOut ? "stage_deadline" : "stage_failed", { count: selected.size });
      return resultFor(state, selected, partial);
    } finally {
      timer.dispose();
      removeAbort();
      state.cancels.delete(cancelAttempt);
      cancelAttempt();
      arm(state);
    }
  }

  async function retry(state: AgentState): Promise<void> {
    if (disposed || state.forgotten || state.retrying) return;
    const due = [...state.pending].filter(([, item]) => item.due <= clock.monotonicNow());
    if (due.length === 0) { arm(state); return; }
    state.retrying = true;
    try {
      await stageIntoBox(state.id, due.map(([path]) => path));
      if (disposed || state.forgotten) return;
      let exhausted = 0;
      for (const [path, item] of due) {
        if (state.pending.get(path) !== item) continue;
        item.attempt += 1;
        const delay = delays[item.attempt];
        if (delay === undefined) { remember(state, path, null); exhausted += 1; }
        else item.due += delay; // +30s, then +90s = 120s from admission.
      }
      if (exhausted > 0) report("restage_exhausted", { count: exhausted });
    } finally { state.retrying = false; arm(state); }
  }

  function scheduleRestage(agentId: string, paths: readonly string[]): void {
    if (paths.length === 0) return;
    const state = stateFor(agentId);
    if (state === undefined) return;
    for (const path of new Set(pathsFor(paths).values())) {
      if (known(state, path) !== undefined || state.pending.has(path)) continue;
      if (state.pending.size >= MAX_PATHS) { report("restage_capacity", { scope: "paths" }); break; }
      state.pending.set(path, { attempt: 0, due: clock.monotonicNow() + delays[0] });
    }
    arm(state);
  }
  function forgetAgent(agentId: string): void {
    const state = agents.get(agentId);
    if (state === undefined) return;
    state.forgotten = true;
    state.timer?.dispose();
    state.timer = undefined;
    state.pending.clear();
    state.remembered.clear();
    for (const cancel of state.cancels) cancel();
    // Keep a bounded, idle-evictable tombstone so stale producers cannot
    // immediately recreate timers after deletion. Unsettled lanes cannot evict.
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    deps.ctx.signal.removeEventListener("abort", dispose);
    for (const agentId of agents.keys()) forgetAgent(agentId);
  }
  deps.ctx.signal.addEventListener("abort", dispose, { once: true });
  if (deps.ctx.canceled) dispose();
  return { stageIntoBox, scheduleRestage, forgetAgent, dispose };
}
