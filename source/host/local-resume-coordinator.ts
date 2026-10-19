import { setTimeout as delay } from "node:timers/promises";

export interface LocalResumeDependencies {
  setAllowed(allowed: boolean): void;
  runDuringRecovery<T>(run: () => Promise<T>): Promise<T>;
  isReady(): Promise<boolean>;
  suspendWakes(): Promise<void>;
  resumeTurns(): Promise<void>;
  unacceptedAgentIds(): readonly string[];
  rearmWakes(): Promise<boolean>;
  afterRelease(): Promise<void>;
  report(event: { readonly outcome: "waiting" | "released" | "failed"; readonly errorType?: string }): void;
  sleep?(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export class LocalResumeCoordinator {
  private generation = 0;
  private lane: Promise<boolean> = Promise.resolve(false);
  private retry: AbortController | undefined;
  private disposed = false;
  constructor(private readonly deps: LocalResumeDependencies) {}

  request(prepare?: () => Promise<void>): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const generation = ++this.generation;
    this.retry?.abort();
    this.deps.setAllowed(false);
    let prepared = false;
    const attempt = async (): Promise<boolean> => {
      if (this.disposed || generation !== this.generation) return false;
      try {
        await this.deps.suspendWakes();
        const recovered = await this.deps.runDuringRecovery(async () => {
          if (!await this.deps.isReady()) return false;
          if (!prepared) { await prepare?.(); prepared = true; }
          await this.deps.resumeTurns();
          if (this.deps.unacceptedAgentIds().length > 0) return false;
          return this.deps.rearmWakes();
        });
        if (this.disposed || generation !== this.generation) return false;
        if (!recovered) { this.deps.report({ outcome: "waiting" }); return false; }
        this.deps.setAllowed(true);
        await this.deps.afterRelease();
        this.deps.report({ outcome: "released" });
        return true;
      } catch (error) {
        if (!this.disposed && generation === this.generation) this.deps.setAllowed(false);
        this.deps.report({ outcome: "failed", errorType: error instanceof Error ? error.name : "UnknownError" });
        return false;
      }
    };
    const enqueue = () => { this.lane = this.lane.then(attempt, attempt); return this.lane; };
    const first = enqueue();
    const controller = new AbortController();
    this.retry = controller;
    void (async () => {
      let released = await first;
      let waitMs = 5_000;
      while (!released && !this.disposed && generation === this.generation && !controller.signal.aborted) {
        try {
          await (this.deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal, ref: false })))(waitMs, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          this.deps.report({ outcome: "failed", errorType: error instanceof Error ? error.name : "UnknownError" });
          return;
        }
        if (controller.signal.aborted || generation !== this.generation) return;
        released = await enqueue();
        waitMs = Math.min(30_000, waitMs * 2);
      }
    })();
    return first;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.retry?.abort();
    this.deps.setAllowed(false);
  }
}
