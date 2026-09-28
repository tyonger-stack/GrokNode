import { createDeadlinePolicy, createRetryPolicy, realClock, type Clock, type DeadlinePolicy, type RetryPolicy } from "../../internal/scheduling.js";
import type { Context } from "../../packages/context/core.js";
import { isSafeFolderId } from "../storage/folder-id.js";

export const AGENT_BOX_PREWARM_ATTEMPTS = 3;
export const AGENT_BOX_PREWARM_RETRY_DELAY_MS = 10_000;
export const AGENT_BOX_PREWARM_ATTEMPT_TIMEOUT_MS = 120_000;
export const AGENT_BOX_PREWARM_MAX_CONCURRENCY = 2;
export const AGENT_BOX_PREWARM_MAX_PENDING = 32;

/** The HostBox API takes a Context and an id, unlike the extension's ensure({ id }). */
export interface AgentBoxEnsure {
  (ctx: Context, agentId: string): Promise<unknown>;
}

export interface AgentBoxPrewarmOptions {
  readonly ctx: Context;
  readonly ensure: AgentBoxEnsure;
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly maxPending?: number;
  readonly clock?: Clock;
  readonly log?: (message: string) => void;
  readonly warn?: (message: string) => void;
}

interface PrewarmJob {
  readonly id: string;
  readonly abort: AbortController;
  running: boolean;
}

/** Best-effort queue with an explicit owner; ForeverBoxService owns its lifetime. */
export class AgentBoxPrewarmScheduler {
  private readonly jobs = new Map<string, PrewarmJob>();
  private readonly pending: PrewarmJob[] = [];
  private readonly maxConcurrency: number;
  private readonly maxPending: number;
  private readonly retry: RetryPolicy;
  private readonly deadline: DeadlinePolicy;
  private readonly attempts: number;
  private active = 0;
  private stopped = false;
  private readonly onParentAbort = () => this.dispose();

  constructor(private readonly options: AgentBoxPrewarmOptions) {
    this.maxConcurrency = options.maxConcurrency ?? AGENT_BOX_PREWARM_MAX_CONCURRENCY;
    this.maxPending = options.maxPending ?? AGENT_BOX_PREWARM_MAX_PENDING;
    if (!Number.isSafeInteger(this.maxConcurrency) || this.maxConcurrency < 1) throw new RangeError("maxConcurrency must be a positive integer");
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 0) throw new RangeError("maxPending must be a non-negative integer");
    this.attempts = options.attempts ?? AGENT_BOX_PREWARM_ATTEMPTS;
    const clock = options.clock ?? realClock;
    const delay = options.retryDelayMs ?? AGENT_BOX_PREWARM_RETRY_DELAY_MS;
    this.retry = createRetryPolicy(clock, {
      name: "agent-box-prewarm-retry",
      maxAttempts: this.attempts,
      initialDelayMs: delay,
      maxDelayMs: delay,
    });
    this.deadline = createDeadlinePolicy(clock, {
      name: "agent-box-prewarm-attempt",
      timeoutMs: options.attemptTimeoutMs ?? AGENT_BOX_PREWARM_ATTEMPT_TIMEOUT_MS,
    });
    if (options.ctx.signal.aborted) this.dispose();
    else options.ctx.signal.addEventListener("abort", this.onParentAbort, { once: true });
  }

  prewarm(id: string): void {
    if (this.stopped || !isSafeFolderId(id) || id.trim().length === 0 || this.jobs.has(id)) return;
    if (this.active >= this.maxConcurrency && this.pending.length >= this.maxPending) {
      this.report(`box prewarm queue is full; skipped agent ${id}`, true);
      return;
    }
    const job: PrewarmJob = { id, abort: new AbortController(), running: false };
    this.jobs.set(id, job);
    this.pending.push(job);
    this.pump();
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    job.abort.abort();
    if (!job.running) {
      this.pending.splice(this.pending.indexOf(job), 1);
      this.jobs.delete(id);
    }
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.options.ctx.signal.removeEventListener("abort", this.onParentAbort);
    for (const id of this.jobs.keys()) this.cancel(id);
  }

  private pump(): void {
    while (!this.stopped && this.active < this.maxConcurrency) {
      const job = this.pending.shift();
      if (job === undefined) return;
      job.running = true;
      this.active += 1;
      void this.run(job).catch((error: unknown) => {
        this.report(`box prewarm for agent ${job.id} stopped: ${String(error)}`, true);
      }).finally(() => {
        this.jobs.delete(job.id);
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(job: PrewarmJob): Promise<void> {
    for (let attempt = 1; attempt <= this.attempts && !job.abort.signal.aborted; attempt += 1) {
      let work: Promise<unknown> | undefined;
      let settled = true;
      try {
        await this.deadline.run((signal) => {
          // Detach the Context signal before linking this short-lived attempt.
          // Context.withCancel itself retains its listener on the parent signal.
          const [ctx, cancel] = this.options.ctx.withDetached().withName("agentBoxPrewarm").withCancel();
          const abort = () => cancel(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          settled = false;
          work = (async () => {
            try {
              ctx.signal.throwIfAborted();
              return await this.options.ensure(ctx, job.id);
            } finally {
              settled = true;
              signal.removeEventListener("abort", abort);
              cancel();
            }
          })();
          return work;
        }, job.abort.signal);
        if (!job.abort.signal.aborted) this.report(`box prewarm for agent ${job.id} completed on attempt ${attempt}`);
        return;
      } catch (error) {
        // A deadline bounds the attempt's authority, not the lifetime of a
        // Promise that ignores abort. Retain its slot until it really settles;
        // otherwise a retry could allocate a second desktop for the same agent.
        if (!settled) {
          this.report(`box prewarm for agent ${job.id} canceled or timed out; underlying ensure is still settling`, true);
          await work?.catch(() => {});
        }
        if (job.abort.signal.aborted) return;
        if (attempt === this.attempts) {
          this.report(`box prewarm for agent ${job.id} gave up after ${attempt} attempts: ${String(error)}`, true);
          return;
        }
        const delay = this.retry.schedule(attempt, job.abort.signal);
        try { await delay.elapsed; }
        catch { return; }
        finally { delay.dispose(); }
      }
    }
  }

  private report(message: string, warn = false): void {
    // Logging is best effort too; a logging failure must not reject an unobserved task.
    try { (warn ? this.options.warn ?? this.options.log : this.options.log)?.(message); } catch {}
  }
}
