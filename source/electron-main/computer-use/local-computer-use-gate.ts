import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getSandRootDir } from "../../host/host-paths.js";

/**
 * Cross-process marker for the `sand_enable_local_cua` feature gate.
 *
 * The local-exec daemon runs outside the Electron main process and cannot read
 * the Statsig-backed gate, so the desktop publishes the resolved gate value
 * here and the daemon reads this file instead of doing a gate lookup itself.
 * The wire shape is `{ isOn: boolean }`, matching the official helper's schema.
 * An unreadable or malformed marker reads back as `isOn: false`, so a damaged
 * file leaves the capability off rather than silently granting it.
 */
export const LOCAL_COMPUTER_USE_GATE_FILENAME = "local-computer-use-gate.json";
export const LOCAL_COMPUTER_USE_GATE_NAME = "sand_enable_local_cua";

export interface LocalComputerUseGate {
  readonly isOn: boolean;
}

export function getLocalComputerUseGatePath(homeDir?: string): string {
  return join(getSandRootDir(homeDir), LOCAL_COMPUTER_USE_GATE_FILENAME);
}

export function readLocalComputerUseGate(path = getLocalComputerUseGatePath()): LocalComputerUseGate {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { isOn: false };
    const isOn = (parsed as { isOn?: unknown }).isOn;
    return { isOn: isOn === true };
  } catch {
    return { isOn: false };
  }
}

export function writeLocalComputerUseGateSync(isOn: boolean, path = getLocalComputerUseGatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify({ isOn }), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

export interface LocalComputerUseGateSource {
  checkFeatureGate(name: string): boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * Publish the resolved `sand_enable_local_cua` gate to the marker the
 * local-exec daemon reads. The marker is written once up front and rewritten
 * whenever the gate source reports a change, so the daemon never has to reach
 * the Statsig client itself.
 */
export function publishLocalComputerUseGate(
  source: LocalComputerUseGateSource,
  reportFailure: (area: string, leg: string, error: unknown) => void,
  path = getLocalComputerUseGatePath(),
): { dispose(): void } {
  const write = (): void => {
    try { writeLocalComputerUseGateSync(source.checkFeatureGate(LOCAL_COMPUTER_USE_GATE_NAME), path); }
    catch (error) { reportFailure("local-exec", "marker-write", error); }
  };
  write();
  const unsubscribe = source.subscribe(write);
  return { dispose: () => { unsubscribe(); } };
}
