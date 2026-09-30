import { renameSync, writeFileSync } from "node:fs";

// The Mac watchdog used to decide a turn was dead because a transcript file
// had not been written. The host already knows which turns are in flight
// (`RunLifecycle.inFlightRunCounts`); this file is that set, refreshed on a
// heartbeat so "host alive, nothing running" is distinguishable from "host
// stopped answering".
export const DEFAULT_TURN_REPORT_PATH = "/tmp/sand-host-turns.json";
export const TURN_REPORT_HEARTBEAT_MS = 15_000;

export interface HostTurnReportTurn {
  agentId: string;
  startedAt: number;
  inFlight: number;
}

export interface HostTurnReport {
  writtenAt: number;
  pid: number;
  turns: HostTurnReportTurn[];
}

export function turnReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SAND_TURN_REPORT === "0") return false;
  return env.SAND_TURN_REPORT === "1" || env.SAND_HOST_IN_BOX === "1";
}

export function turnReportPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SAND_TURN_REPORT_PATH?.trim();
  return configured ? configured : DEFAULT_TURN_REPORT_PATH;
}

export function buildTurnReport(
  turns: readonly HostTurnReportTurn[],
  now = Date.now(),
  pid = process.pid,
): HostTurnReport {
  return {
    writtenAt: now,
    pid,
    turns: turns.filter((turn) => typeof turn.agentId === "string" && turn.agentId.length > 0),
  };
}

export function writeTurnReport(report: HostTurnReport, path: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(report));
  renameSync(tmp, path);
}
