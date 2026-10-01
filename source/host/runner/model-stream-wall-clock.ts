import { OutputTokensLimitExceededError } from "../../packages/chat-inference/prompt-executor.js";

// Per-stream ceiling for ONE model call, matching the official harness
// (packages/grok-bot-harness/src/runner/stream-tuning.ts in the sand-box host
// bundle). It bounds a provider that keeps trickling output and never
// finishes; the run-level idle deadline cannot see that case because the
// trickle counts as progress.
export const DEFAULT_MODEL_STREAM_WALL_CLOCK_LIMIT_MS = 15 * 60_000;

export function resolveModelStreamWallClockLimitMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.SAND_MODEL_STREAM_WALL_CLOCK_LIMIT_MS?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MODEL_STREAM_WALL_CLOCK_LIMIT_MS;
}

/** First cut in a turn: rides the output-token-limit path, so the agent gets
 * the "your response was cut off, continue" reminder and tries again. */
export class ModelStreamWallClockCutError extends OutputTokensLimitExceededError {
  constructor(readonly limitMs: number) {
    super(`Model stream exceeded the ${limitMs} ms wall-clock limit`);
    this.name = "ModelStreamWallClockCutError";
  }
}

/** Second cut in the same turn: terminal, never retried. */
export class ModelStreamWallClockLimitError extends Error {
  readonly isModelStreamWallClockLimit = true;
  constructor(readonly limitMs: number) {
    super(`Model stream exceeded the ${limitMs} ms wall-clock limit again after one retry`);
    this.name = "ModelStreamWallClockLimitError";
  }
}

export function isModelStreamWallClockLimitError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const fields = current as { isModelStreamWallClockLimit?: unknown; cause?: unknown };
    if (fields.isModelStreamWallClockLimit === true) return true;
    current = fields.cause;
  }
  return false;
}

interface CancellableContext {
  withCancel(): readonly [unknown, (reason?: unknown) => void];
}

interface StreamResult {
  readonly fullStream: AsyncIterable<unknown>;
  readonly response: PromiseLike<unknown>;
  readonly [key: string]: unknown;
}

interface InnerExecutor {
  getMessages(): any;
  getState(): any;
  clearMessages(): void;
  appendMessages(messages: any): void;
  stream(...args: any[]): unknown;
}

function isCancellableContext(value: unknown): value is CancellableContext {
  return typeof value === "object" && value != null && typeof (value as { withCancel?: unknown }).withCancel === "function";
}

function isStreamResult(value: unknown): value is StreamResult {
  if (typeof value !== "object" || value == null) return false;
  const record = value as { fullStream?: unknown; response?: unknown };
  return record.fullStream != null
    && typeof (record.fullStream as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
    && typeof (record.response as PromiseLike<unknown> | undefined)?.then === "function";
}

export class ModelStreamWallClockMiddleware<TInner extends InnerExecutor> {
  constructor(
    readonly innerExecutor: TInner,
    readonly limitMs: number,
    private readonly cuts: { count: number },
  ) {}
  getMessages(): ReturnType<TInner["getMessages"]> { return this.innerExecutor.getMessages(); }
  getState(): ReturnType<TInner["getState"]> { return this.innerExecutor.getState(); }
  clearMessages(): void { this.innerExecutor.clearMessages(); }
  appendMessages(messages: Parameters<TInner["appendMessages"]>[0]): void { this.innerExecutor.appendMessages(messages); }

  stream(...args: any[]): unknown {
    const [ctx, ...rest] = args;
    if (!isCancellableContext(ctx)) return this.innerExecutor.stream(...args);
    const [streamCtx, cancel] = ctx.withCancel();
    let limitError: Error | undefined;
    const timer = setTimeout(() => {
      this.cuts.count += 1;
      limitError = this.cuts.count === 1
        ? new ModelStreamWallClockCutError(this.limitMs)
        : new ModelStreamWallClockLimitError(this.limitMs);
      console.warn(`[model-stream] wall-clock limit hit after ${this.limitMs}ms (${this.cuts.count === 1 ? "retried" : "failed"})`);
      cancel(limitError);
    }, this.limitMs);
    timer.unref?.();
    const disarm = (): void => clearTimeout(timer);
    let result: unknown;
    try {
      result = this.innerExecutor.stream(streamCtx, ...rest);
    } catch (error) {
      disarm();
      throw error;
    }
    if (!isStreamResult(result)) {
      disarm();
      return result;
    }
    const inner = result;
    const fullStream = async function* () {
      try {
        for await (const part of inner.fullStream) yield part;
      } catch (error) {
        throw limitError ?? error;
      } finally {
        disarm();
      }
      if (limitError !== undefined) throw limitError;
    };
    const response = Promise.resolve(inner.response).then(
      (value) => {
        disarm();
        return limitError === undefined ? value : { ...(value as object), error: limitError };
      },
      (error: unknown) => {
        disarm();
        throw limitError ?? error;
      },
    );
    // Consumers that only drain fullStream never await response; an unhandled
    // rejection here would take the whole host process down.
    response.catch(() => {});
    return { ...inner, fullStream: fullStream(), response };
  }
}

/** The cut counter is shared by every executor this factory wraps, so create
 * one factory per turn: the second cut within the turn is terminal. */
export function createModelStreamWallClockMiddleware(limitMs: number) {
  if (limitMs <= 0) return <TInner extends InnerExecutor>(executor: TInner): TInner => executor;
  const cuts = { count: 0 };
  return <TInner extends InnerExecutor>(executor: TInner): TInner =>
    new ModelStreamWallClockMiddleware(executor, limitMs, cuts) as unknown as TInner;
}
