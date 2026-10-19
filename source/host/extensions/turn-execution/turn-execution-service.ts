import { LocalRecoveryGate } from "./local-recovery-gate.js";

export const UNBOUND_EXECUTION_MESSAGE = "Sand turn execution is not bound: the host asked for a runner before the composition root handed the turn-execution extension its executor.";
export const DOUBLE_BIND_MESSAGE = "Sand turn execution is already bound: a second executor would mint a second runner for the same agent.";

export interface TurnExecutor {
  isInferenceReady(): Promise<boolean>;
  createRunner(session: unknown, hooks: unknown): unknown;
  createGroupMemberRunner(session: unknown, hooks: unknown, overrides: unknown): unknown;
}

export class TurnExecutionRegistry {
  private executor: TurnExecutor | undefined;
  private readonly recovery: LocalRecoveryGate;
  constructor(initiallyAllowed = true) { this.recovery = new LocalRecoveryGate(initiallyAllowed); }
  get isLocalWorkAllowed(): boolean { return this.recovery.isAllowed; }
  setLocalWorkAllowed(allowed: boolean): void { this.recovery.setAllowed(allowed); }
  waitForLocalWork(): Promise<void> { return this.recovery.wait(); }
  runDuringRecovery<T>(run: () => Promise<T>): Promise<T> { return this.recovery.runRecovery(run); }
  dispose(): void { this.recovery.dispose(); }
  get canExecute(): boolean { return this.executor !== undefined; }
  bindExecutor(executor: TurnExecutor): void {
    if (this.executor !== undefined) throw new Error(DOUBLE_BIND_MESSAGE);
    this.executor = executor;
  }
  async isRunReady(): Promise<boolean> { return this.executor === undefined || !this.recovery.isAllowed && !this.recovery.isRecovery ? false : await this.executor.isInferenceReady(); }
  createRunner(session: unknown, hooks: unknown): unknown { return this.require().createRunner(session, hooks); }
  createGroupMemberRunner(session: unknown, hooks: unknown, overrides: unknown): unknown { return this.require().createGroupMemberRunner(session, hooks, overrides); }
  private require(): TurnExecutor { if (this.executor === undefined) throw new Error(UNBOUND_EXECUTION_MESSAGE); return this.executor; }
}

