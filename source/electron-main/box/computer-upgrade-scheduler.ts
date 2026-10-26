import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { RecreateResult } from "./box-recreate-commands.js";

export const COMPUTER_UPGRADE_GRACE_MS = 15 * 60_000;
export const computerUpgradeRequestSchema = z.object({ scheduledAtMs: z.number().int().nonnegative().max(8.64e15) }).strict();
const scheduleSchema = computerUpgradeRequestSchema.extend({
  id: z.string().uuid(),
  state: z.enum(["scheduled", "running", "completed", "failed", "missed", "cancelled"]),
  detail: z.string().optional(),
});
export type ComputerUpgradeSchedule = z.infer<typeof scheduleSchema>;
export interface ComputerUpgradeSchedulerOptions {
  readonly filename: string;
  readonly perform: () => Promise<RecreateResult>;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => () => void;
}

export class ComputerUpgradeScheduler {
  private readonly now: () => number;
  private readonly setTimer: NonNullable<ComputerUpgradeSchedulerOptions["setTimer"]>;
  private cancelTimer: (() => void) | undefined;
  private stopped = false;

  constructor(private readonly options: ComputerUpgradeSchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => { const timer = setTimeout(callback, ms); timer.unref(); return () => clearTimeout(timer); });
  }
  get(): { schedule: ComputerUpgradeSchedule | null } {
    let raw: string;
    try { raw = readFileSync(this.options.filename, "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return { schedule: null }; throw error; }
    return { schedule: scheduleSchema.nullable().parse(JSON.parse(raw)) };
  }
  private write(schedule: ComputerUpgradeSchedule | null): void {
    mkdirSync(dirname(this.options.filename), { recursive: true });
    const temporary = `${this.options.filename}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(schedule) + "\n", { mode: 0o600 });
    renameSync(temporary, this.options.filename);
  }
  start(): void {
    this.stopped = false;
    const { schedule } = this.get();
    // A crash may occur after Docker restarted but before the result was saved.
    if (schedule?.state === "running") this.write({ ...schedule, state: "failed", detail: "The app stopped during the update. Check the computer before trying again." });
    this.arm();
  }
  stop(): void { this.stopped = true; this.cancelTimer?.(); this.cancelTimer = undefined; }
  schedule(raw: unknown, reschedule = false): { schedule: ComputerUpgradeSchedule | null } {
    const request = computerUpgradeRequestSchema.parse(raw);
    if (this.stopped) throw new Error("Computer update scheduling has stopped.");
    if (request.scheduledAtMs <= this.now()) throw new Error("Choose a future update time.");
    const current = this.get().schedule;
    if (current?.state === "running") throw new Error("The computer update has already started.");
    if (!reschedule && current?.state === "scheduled") throw new Error("A computer update is already scheduled. Reschedule or cancel it first.");
    if (reschedule && current == null) throw new Error("There is no computer update to reschedule.");
    const schedule: ComputerUpgradeSchedule = { ...request, id: randomUUID(), state: "scheduled" };
    this.write(schedule); this.arm(); return { schedule };
  }
  cancel(dismissTerminalOutcome = false): { schedule: ComputerUpgradeSchedule | null } {
    const current = this.get().schedule;
    if (current?.state === "running") throw new Error("The computer update has already started.");
    if (dismissTerminalOutcome && current?.state === "scheduled") throw new Error("Cancel the scheduled update before dismissing it.");
    const schedule = current == null || dismissTerminalOutcome ? null : { ...current, state: "cancelled" as const };
    this.write(schedule); this.arm(); return { schedule };
  }
  private arm(): void {
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (this.stopped) return;
    const schedule = this.get().schedule;
    if (schedule?.state !== "scheduled") return;
    this.cancelTimer = this.setTimer(() => { void this.runDue(schedule.id).catch(error => { console.error("Computer update schedule failed:", error); }); }, Math.min(2_147_483_647, Math.max(0, schedule.scheduledAtMs - this.now())));
  }
  async runDue(expectedId: string): Promise<void> {
    const schedule = this.get().schedule;
    if (this.stopped || schedule?.id !== expectedId || schedule.state !== "scheduled") return;
    if (schedule.scheduledAtMs > this.now()) { this.arm(); return; }
    if (this.now() - schedule.scheduledAtMs > COMPUTER_UPGRADE_GRACE_MS) { this.write({ ...schedule, state: "missed", detail: "The update window passed while the app was closed or asleep. Reschedule the update." }); return; }
    this.write({ ...schedule, state: "running" });
    try {
      const result = await this.options.perform();
      if (result.status === "rejected") throw new Error(result.reason);
      if (result.status === "dev-fallback") throw new Error("The local computer update is unavailable.");
      this.write({ ...schedule, state: "completed" });
    } catch (error) {
      this.write({ ...schedule, state: "failed", detail: error instanceof Error ? error.message.slice(0, 1000) : "The computer update failed." });
    }
  }
}
