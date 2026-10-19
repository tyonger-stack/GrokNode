import { AsyncLocalStorage } from "node:async_hooks";

export class LocalRecoveryDisposedError extends Error { override name = "LocalRecoveryDisposedError"; }
export class LocalRecoveryGate {
  private readonly scope = new AsyncLocalStorage<{ active: boolean }>();
  private allowed: boolean;
  private disposed = false;
  private readonly waiters = new Set<{ readonly resolve: () => void; readonly reject: (error: Error) => void }>();
  constructor(initiallyAllowed = true) { this.allowed = initiallyAllowed; }
  get isAllowed(): boolean { return !this.disposed && this.allowed; }
  get isRecovery(): boolean { return this.scope.getStore()?.active === true; }
  setAllowed(value: boolean): void {
    if (this.disposed) return;
    this.allowed = value;
    if (value) { for (const waiter of this.waiters) waiter.resolve(); this.waiters.clear(); }
  }
  runRecovery<T>(run: () => Promise<T>): Promise<T> {
    const lease = { active: true };
    return this.scope.run(lease, async () => { try { return await run(); } finally { lease.active = false; } });
  }
  async wait(): Promise<void> {
    if (this.disposed) throw new LocalRecoveryDisposedError("Host recovery gate is disposed");
    if (this.allowed || this.isRecovery) return;
    await new Promise<void>((resolve, reject) => this.waiters.add({ resolve, reject }));
    if (this.disposed) throw new LocalRecoveryDisposedError("Host stopped during recovery");
    if (!this.allowed) await this.wait();
  }
  dispose(): void {
    this.disposed = true; this.allowed = false;
    for (const waiter of this.waiters) waiter.reject(new LocalRecoveryDisposedError("Host stopped during recovery"));
    this.waiters.clear();
  }
}
