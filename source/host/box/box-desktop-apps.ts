import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { findSystemErrno } from "../../shared/system-errno.js";
import { writeFileAtomic } from "../../shared/node/atomic-write.js";

/**
 * Declarative box app installs.
 *
 * The box container's root filesystem is disposable: a `docker rm` + recreate
 * (Settings → Updates → "Update Grok Bot's Computer", or the app's own
 * content-addressed container rebuild) drops everything the agent installed with
 * `dpkg`, while `/workspace` and `/home/box/sand-data` come back on their named
 * volumes. `/workspace/box-apps.d/*.sh` is the intent that survives, and this
 * reconciler re-applies it in-box on every host boot so a rebuilt box lands on
 * the same desktop the user had before.
 *
 * The box image owns no hook for user scripts, and the desktop here is plank,
 * which only puts a running window in the dock when the window's WM_CLASS
 * matches some `.desktop`'s `StartupWMClass` (the vendor `wechat.desktop` ships
 * without that key, so an installed WeChat used to run with an empty dock slot).
 * Re-running the declaration on boot is therefore what restores the icon, not a
 * container flag.
 */

/** The intent lives on the persistent workspace volume, so it survives a rebuild. */
export const BOX_DESKTOP_APPS_DIR = "/workspace/box-apps.d";
/**
 * The stamp describes the box ROOT filesystem (what the scripts install), so it
 * deliberately does NOT live on a volume: a rebuild that keeps the stamp would
 * skip the very install the rebuild wiped. `/var/lib/sand` is root-owned,
 * created by the shipped image, and lost with the container.
 */
export const BOX_DESKTOP_APPS_STAMP_PATH = "/var/lib/sand/box-desktop-apps.stamp.json";
export const BOX_DESKTOP_APPS_SCRIPT_SUFFIX = ".sh";
/**
 * `dpkg -i` of the ~230MB WeChat deb unpacks ~770MB on a container's first
 * boot, so the ceiling is deliberately generous; a slow unpack must not be
 * mistaken for a hung one.
 */
export const BOX_DESKTOP_APPS_SCRIPT_TIMEOUT_MS = 900_000;
const STAMP_VERSION = 1;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const OUTPUT_TAIL_CHARS = 400;
/** Keeps the joined path inside the scripts dir: no separators, no dotfiles. */
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/;

export type BoxDesktopAppScriptState =
  | "applied"
  | "skipped"
  | "failed"
  | "rejected"
  | "timed-out";

export interface BoxDesktopAppScriptFile {
  readonly name: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly uid: number;
}

export interface BoxDesktopAppScriptOutcome {
  readonly name: string;
  readonly state: BoxDesktopAppScriptState;
  readonly exitCode?: number;
  readonly detail?: string;
}

export interface BoxDesktopAppReconcileResult {
  readonly status: "no-scripts-dir" | "no-scripts" | "reconciled";
  readonly applied: number;
  readonly skipped: number;
  readonly failed: number;
  readonly rejected: number;
  readonly outcomes: readonly BoxDesktopAppScriptOutcome[];
  /** A stamp that could not be persisted is reported, never thrown: the scripts already ran. */
  readonly stampError?: string;
}

export interface BoxDesktopAppsScriptListing {
  readonly present: boolean;
  readonly files: readonly BoxDesktopAppScriptFile[];
}

interface ScriptRunResult {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly output: string;
}

export interface BoxDesktopAppsReconcilerOptions {
  readonly scriptsDir?: string;
  readonly stampPath?: string;
  readonly scriptTimeoutMs?: number;
  readonly readScripts?: (dir: string) => Promise<BoxDesktopAppsScriptListing>;
  readonly readStamp?: (path: string) => Promise<string | undefined>;
  readonly writeStamp?: (path: string, contents: string) => Promise<void>;
  readonly runScript?: (path: string, timeoutMs: number) => Promise<ScriptRunResult>;
  /**
   * The host runs as uid 0 in-box, so a script the `box` user can write is a
   * privilege-escalation path. Root-owned files only; a non-root host has no
   * escalation to offer, so the check is skipped (and said out loud) there.
   */
  readonly enforceRootOwnership?: boolean;
  readonly getuid?: () => number | undefined;
  readonly log?: (message: string) => void;
}

/** Identity of a script revision: same bytes and same mtime means same intent. */
export function boxDesktopAppScriptKey(file: BoxDesktopAppScriptFile): string {
  return `${Math.trunc(file.mtimeMs)}:${file.size}`;
}

export function isBoxDesktopAppScriptName(name: string): boolean {
  return SAFE_SCRIPT_NAME.test(name);
}

/** Tolerant by design: a corrupt or absent stamp means "apply everything". */
export function parseBoxDesktopAppsStamp(contents: string | undefined): Record<string, string> {
  if (contents == null || contents.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {};
    const entries = Reflect.get(parsed, "entries");
    if (typeof entries !== "object" || entries == null || Array.isArray(entries)) return {};
    const stamp: Record<string, string> = {};
    for (const [name, key] of Object.entries(entries)) {
      if (typeof key === "string" && isBoxDesktopAppScriptName(name)) stamp[name] = key;
    }
    return stamp;
  } catch {
    return {};
  }
}

export function formatBoxDesktopAppsStamp(entries: Record<string, string>): string {
  return `${JSON.stringify({ version: STAMP_VERSION, entries })}\n`;
}

export function summarizeBoxDesktopAppReconcile(
  result: BoxDesktopAppReconcileResult
): string {
  if (result.status === "no-scripts-dir") return "no box-apps.d directory";
  if (result.status === "no-scripts") return "no app declaration scripts";
  const parts = [`applied ${result.applied}`, `skipped ${result.skipped}`];
  if (result.failed > 0) parts.push(`failed ${result.failed}`);
  if (result.rejected > 0) parts.push(`rejected ${result.rejected}`);
  const details = result.outcomes
    .filter((outcome) => outcome.state === "failed" || outcome.state === "timed-out" || outcome.state === "rejected")
    .map((outcome) => `${outcome.name}: ${outcome.state}${outcome.detail == null ? "" : ` (${outcome.detail})`}`);
  const line = `box desktop apps: ${parts.join(", ")}`;
  return details.length === 0 ? line : `${line} — ${details.join("; ")}`;
}

async function defaultReadScripts(dir: string): Promise<BoxDesktopAppsScriptListing> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (findSystemErrno(error) === "ENOENT") return undefined;
    throw error;
  });
  if (entries === undefined) return { present: false, files: [] };
  const files: BoxDesktopAppScriptFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isBoxDesktopAppScriptName(entry.name)) continue;
    const stats = await stat(join(dir, entry.name)).catch(() => undefined);
    // A file can vanish between readdir and stat; the next boot sees it.
    if (stats == null || !stats.isFile()) continue;
    files.push({
      name: entry.name,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      uid: stats.uid
    });
  }
  // Deterministic order so two boots with the same inputs do the same thing.
  files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { present: true, files };
}

async function defaultReadStamp(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch((error: unknown) => {
    if (findSystemErrno(error) === "ENOENT") return undefined;
    throw error;
  });
}

async function defaultWriteStamp(path: string, contents: string): Promise<void> {
  await writeFileAtomic(path, contents);
}

function defaultRunScript(path: string, timeoutMs: number): Promise<ScriptRunResult> {
  return new Promise<ScriptRunResult>(resolve => {
    execFile(
      "bash",
      [path],
      { timeout: timeoutMs, maxBuffer: OUTPUT_LIMIT, encoding: "utf8" },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
        if (error == null) {
          resolve({ code: 0, timedOut: false, output });
          return;
        }
        const failure = error as Error & { code?: number | string; killed?: boolean; signal?: string };
        const timedOut = failure.killed === true || failure.signal === "SIGTERM";
        const code = typeof failure.code === "number" ? failure.code : null;
        resolve({ code, timedOut, output });
      }
    );
  });
}

export function createBoxDesktopAppsReconciler(
  options: BoxDesktopAppsReconcilerOptions = {}
): { reconcile: () => Promise<BoxDesktopAppReconcileResult> } {
  const scriptsDir = options.scriptsDir ?? BOX_DESKTOP_APPS_DIR;
  const stampPath = options.stampPath ?? BOX_DESKTOP_APPS_STAMP_PATH;
  const timeoutMs = options.scriptTimeoutMs ?? BOX_DESKTOP_APPS_SCRIPT_TIMEOUT_MS;
  const readScripts = options.readScripts ?? defaultReadScripts;
  const readStamp = options.readStamp ?? defaultReadStamp;
  const writeStamp = options.writeStamp ?? defaultWriteStamp;
  const runScript = options.runScript ?? defaultRunScript;
  const getuid = options.getuid ?? (() => process.getuid?.());
  const enforceRootOwnership = options.enforceRootOwnership ?? true;

  return {
    async reconcile(): Promise<BoxDesktopAppReconcileResult> {
      const listing = await readScripts(scriptsDir);
      if (!listing.present) {
        return { status: "no-scripts-dir", applied: 0, skipped: 0, failed: 0, rejected: 0, outcomes: [] };
      }
      if (listing.files.length === 0) {
        return { status: "no-scripts", applied: 0, skipped: 0, failed: 0, rejected: 0, outcomes: [] };
      }

      // Only a uid-0 host needs the ownership guard: without root there is no
      // escalation for a box-writable script to buy.
      const ownershipEnforced = enforceRootOwnership && getuid() === 0;
      if (enforceRootOwnership && !ownershipEnforced) {
        options.log?.(
          `box desktop apps: host is not uid 0, so the script-ownership check is off for ${scriptsDir}`
        );
      }

      const stamp = parseBoxDesktopAppsStamp(await readStamp(stampPath));
      const nextStamp: Record<string, string> = {};
      const outcomes: BoxDesktopAppScriptOutcome[] = [];
      let applied = 0;
      let skipped = 0;
      let failed = 0;
      let rejected = 0;

      for (const file of listing.files) {
        const key = boxDesktopAppScriptKey(file);
        if (stamp[file.name] === key) {
          // Carry the key forward so a rewritten stamp does not re-run work.
          nextStamp[file.name] = key;
          skipped += 1;
          outcomes.push({ name: file.name, state: "skipped" });
          continue;
        }
        if (ownershipEnforced && file.uid !== 0) {
          // Never stamp a rejection: fixing the ownership must re-run it.
          rejected += 1;
          outcomes.push({
            name: file.name,
            state: "rejected",
            detail: `uid ${file.uid} is not 0`
          });
          continue;
        }
        const run = await runScript(join(scriptsDir, file.name), timeoutMs);
        if (run.timedOut) {
          failed += 1;
          const detail = tailOutput(run.output);
          outcomes.push({
            name: file.name,
            state: "timed-out",
            ...(detail == null ? {} : { detail })
          });
          continue;
        }
        if (run.code !== 0) {
          failed += 1;
          const detail = tailOutput(run.output);
          outcomes.push({
            name: file.name,
            state: "failed",
            ...(run.code == null ? {} : { exitCode: run.code }),
            ...(detail == null ? {} : { detail })
          });
          continue;
        }
        applied += 1;
        nextStamp[file.name] = key;
        outcomes.push({ name: file.name, state: "applied", exitCode: 0 });
      }

      const result: BoxDesktopAppReconcileResult = {
        status: "reconciled",
        applied,
        skipped,
        failed,
        rejected,
        outcomes
      };
      try {
        await writeStamp(stampPath, formatBoxDesktopAppsStamp(nextStamp));
        return result;
      } catch (error) {
        // The scripts already ran; losing the stamp only costs a re-run next
        // boot, so report it instead of failing the reconcile.
        return {
          ...result,
          stampError: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

function tailOutput(output: string): string | undefined {
  if (output === "") return undefined;
  const flattened = output.replace(/\s+/g, " ").trim();
  return flattened.length <= OUTPUT_TAIL_CHARS
    ? flattened
    : `…${flattened.slice(-OUTPUT_TAIL_CHARS)}`;
}

/**
 * The in-box entry point. Fire-and-forget at the call site: a missing or broken
 * declaration must never delay or fail the host boot.
 */
export async function provisionBoxDesktopApps(
  options: BoxDesktopAppsReconcilerOptions = {}
): Promise<BoxDesktopAppReconcileResult> {
  return await createBoxDesktopAppsReconciler(options).reconcile();
}
