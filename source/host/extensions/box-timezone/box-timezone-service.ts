import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { errorLogTag } from "../../../shared/errors.js";

const runCommand = promisify(execFile);
export const SAND_BOX_TIMEZONE_COMMAND = "/usr/local/bin/sand-box-timezone";
const COMMAND_TIMEOUT_MS = 15_000;

export type ApplyBoxTimeZone = (timeZone: string) => Promise<void>;

export function createBoxTimezoneApplier(options: { log(message: string): void; commandPath?: string }): ApplyBoxTimeZone | undefined {
  const commandPath = options.commandPath ?? SAND_BOX_TIMEZONE_COMMAND;
  if (!existsSync(commandPath)) return undefined;
  return async (timeZone) => {
    const { stdout } = await runCommand(commandPath, ["apply", timeZone], { timeout: COMMAND_TIMEOUT_MS });
    const line = stdout.trim();
    if (line.length > 0) options.log(`box-timezone: ${line}`);
  };
}

export interface BoxTimezoneServiceDeps {
  getUserTimeZone(): string | undefined;
  subscribeToUserTimeZone(listener: (timeZone: string | undefined) => void): () => void;
  applyZone: ApplyBoxTimeZone;
  log(message: string): void;
}

export function createBoxTimezoneService(deps: BoxTimezoneServiceDeps): { start(): void; dispose(): void; settled(): Promise<void> } {
  let unsubscribe: (() => void) | undefined;
  let applied: string | undefined;
  let pending: string | undefined;
  let inFlight: Promise<void> | undefined;
  let disposed = false;
  const drain = async (): Promise<void> => {
    while (!disposed && pending !== undefined && pending !== applied) {
      const timeZone = pending;
      try {
        await deps.applyZone(timeZone);
        applied = timeZone;
      } catch (error) {
        deps.log(`box-timezone: could not set the box clock to ${timeZone} (${errorLogTag(error)})`);
        if (pending === timeZone) pending = undefined;
      }
    }
  };
  const request = (timeZone: string | undefined): void => {
    if (disposed || timeZone === undefined) return;
    pending = timeZone;
    if (inFlight === undefined) inFlight = drain().finally(() => { inFlight = undefined; });
  };
  return {
    start() {
      unsubscribe = deps.subscribeToUserTimeZone(request);
      request(deps.getUserTimeZone());
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
    settled: () => inFlight ?? Promise.resolve(),
  };
}
