import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyOpenRouterError, openRouterOkStatus, type OpenRouterChannelStatus } from "../../shared/openrouter-channel-status.js";
import { OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS, OPENCODEX_CONTAINER_RELAY_PORT, resolveOpenRouterTransport } from "../../shared/node/openrouter-proxy.js";
import { GROK_NODE_DOCKER_CONTAINER, isGrokNodePackagedApp } from "../../shared/node/grok-node-identity.js";
import type { SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";
import {
  SAND_BOX_DEPS_DIR,
  SAND_BOX_EXEC_DAEMON_DIR,
  SAND_BOX_HOST_BUNDLE_ROOT,
  SAND_BOX_HOST_ENTRY,
} from "../../packages/constants/sand-supervisor.js";
import type { RecreateResult } from "./box-recreate-commands.js";
import { createLocalDockerSnapshotStore, snapshotImageRepo, type LocalDockerSnapshotStore } from "./local-docker-snapshot.js";
import type { GatewayConnection } from "./gateway-descriptor-cache.js";
import { libraryDockerForwardingArgs, resolveLibraryDockerForwarding, type LibraryDockerForwarding } from "./library-docker-config.js";

// PINNED BY DIGEST — do not "upgrade" back to the moving :sand-box-latest tag.
//
// The digest and the in-box host bundle root are ONE fact: the image's own
// /usr/local/bin/sand-supervisor-contract.mjs hardcodes the host dir and
// spawns `node <HOST_DIR>/host-main.cjs` with that path (no env override, no
// fallback), so a reconstructed bundle mounted anywhere else is a dead file
// while the upstream host keeps serving :1340.
//
// Current pairing: universal@sha256:8c489b5f… → root /opt/sand.
//
// BEFORE CHANGING EITHER VALUE: read the target image's
// /usr/local/bin/sand-supervisor-contract.mjs and confirm its host dir and
// deps dir, then move the digest and SAND_BOX_HOST_BUNDLE_ROOT in the same
// commit.
export const LOCAL_DOCKER_BOX_IMAGE_DIGEST = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal@sha256:8c489b5f7f690b38acbf991e584a474bcc15cf81ebfe858c60235761191df1bd";
// Kept for diagnostics display and backward-compatible status reporting; the
// container is created from LOCAL_DOCKER_BOX_IMAGE_DIGEST above.
export const LOCAL_DOCKER_BOX_IMAGE = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest";
export const LOCAL_DOCKER_BOX_CONTAINER = isGrokNodePackagedApp() ? GROK_NODE_DOCKER_CONTAINER : "grok-bot-local-vm";
export const LOCAL_DOCKER_WORKSPACE_VOLUME = `${LOCAL_DOCKER_BOX_CONTAINER}-workspace`;
export const LOCAL_DOCKER_DATA_VOLUME = `${LOCAL_DOCKER_BOX_CONTAINER}-data`;
export const LOCAL_DOCKER_GATEWAY_URL = "http://127.0.0.1:1340";
export const LOCAL_DOCKER_OWNER_LABEL = "com.grok-bot.local-vm=1";
// v7: SCREEN_WIDTH/HEIGHT 1920×1200 (P2-8 / 0.68.1). Forces recreate so Xvfb picks up geometry.
// v8: the in-box host bundle root moved to /opt/sand (upstream image
// git-sha 726deab) and the image pin moved to a8813ae….
// v9: reverted to the older image (git-sha 12c7367) and back to the
// /home/box layout. The schema version tracks "which in-box layout this
// build expects", so a container left over from a different layout is
// replaced automatically instead of being rejected as an unexpected image.
// v10: the in-box host bundle root is /opt/sand and the image pin is 8c489b5f….
export const LOCAL_DOCKER_SCHEMA_VERSION = "10";
const READY_TIMEOUT_MS = 180_000;

export interface LocalDockerStatus {
  readonly available: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly containerName: string;
  readonly image: string;
  readonly detail: string;
}

export type HostIdentityStatus =
  | { readonly kind: "verified"; readonly pid: number; readonly cmdline: string; readonly sha256: string }
  | { readonly kind: "foreign-host"; readonly pid: number; readonly cmdline: string; readonly expectedSha256: string }
  | { readonly kind: "unknown"; readonly reason: string };

// Pure decision helper for the host-identity check: given the gateway pid's
// /proc cmdline and the sha256 of the file that cmdline points at, decide
// whether the reconstructed host is the process actually serving :1340.
// Exported for tests (tests/local-docker-host-identity.test.mjs).
export function classifyHostIdentity(args: {
  readonly gatewayPid: number | null;
  readonly cmdline: string | null;
  readonly runningBundleSha256: string | null;
  readonly expectedSha256: string;
  readonly hostEntryPath: string;
}): HostIdentityStatus {
  const { gatewayPid, cmdline, runningBundleSha256, expectedSha256, hostEntryPath } = args;
  if (gatewayPid == null) return { kind: "unknown", reason: "gateway.json has no pid" };
  if (cmdline == null) return { kind: "unknown", reason: `could not read /proc/${gatewayPid}/cmdline (process exited?)` };
  if (!cmdline.includes(hostEntryPath)) {
    return { kind: "foreign-host", pid: gatewayPid, cmdline, expectedSha256: expectedSha256 };
  }
  if (runningBundleSha256 == null) return { kind: "unknown", reason: "could not sha256 the mounted bundle inside the container" };
  if (runningBundleSha256 !== expectedSha256) {
    return { kind: "foreign-host", pid: gatewayPid, cmdline, expectedSha256: expectedSha256 };
  }
  return { kind: "verified", pid: gatewayPid, cmdline, sha256: runningBundleSha256 };
}

// After the gateway answers we verify *which* host is actually serving: read
// the pid from the container's gateway.json, read /proc/<pid>/cmdline, and
// require the reconstructed bundle's sha256. A mount point merely existing
// proves nothing — the 2026-10-01 image swap served :1340 from the upstream
// /opt/sand host while our bundle sat unread at /home/box/sand-host.
// The expected entry path is the image's own host dir (SAND_BOX_HOST_ENTRY),
// so this check follows the upstream layout instead of hardcoding it.
// Default is WARN, not throw: the upstream host can still serve the desktop
// shell, so a mismatch is an observability problem, not an availability one.
// Set SAND_STRICT_HOST_IDENTITY=1 to turn mismatches into a connect failure.
async function verifyHostIdentity(hostBundle: LocalHostBundle): Promise<HostIdentityStatus> {
  const readJson = async (): Promise<{ pid?: unknown } | null> => {
    const result = await runDocker(["exec", LOCAL_DOCKER_BOX_CONTAINER, "cat", "/home/box/sand-data/gateway.json"]);
    if (!result.ok) return null;
    try { return JSON.parse(result.output) as { pid?: unknown }; } catch { return null; }
  };
  const gateway = await readJson();
  const gatewayPid = typeof gateway?.pid === "number" ? gateway.pid : null;
  if (gatewayPid == null) return { kind: "unknown", reason: "gateway.json unreadable or has no pid" };
  const cmdlineResult = await runDocker(["exec", LOCAL_DOCKER_BOX_CONTAINER, "sh", "-c", `tr '\\0' ' ' < /proc/${gatewayPid}/cmdline`]);
  const cmdline = cmdlineResult.ok ? cmdlineResult.output.trim() : null;
  const shaResult = await runDocker(["exec", LOCAL_DOCKER_BOX_CONTAINER, "sha256sum", SAND_BOX_HOST_ENTRY]);
  const runningBundleSha256 = shaResult.ok ? (shaResult.output.trim().split(/\s+/)[0] ?? null) : null;
  return classifyHostIdentity({ gatewayPid, cmdline, runningBundleSha256, expectedSha256: hostBundle.sha256, hostEntryPath: SAND_BOX_HOST_ENTRY });
}

interface CommandResult { readonly ok: boolean; readonly code: number | null; readonly output: string }
interface LocalHostBundle { readonly path: string; readonly sha256: string; readonly boxExecDaemonPath: string; readonly boxExecDaemonSha256: string }

export interface LocalDockerHostConnector {
  connect(): Promise<GatewayConnection>;
  recreate?(args: { readonly preserveData: boolean; readonly force?: boolean }): Promise<RecreateResult>;
  forceRecreate?(): Promise<RecreateResult>;
}

// GUI apps launched from Finder inherit launchd's minimal PATH, which does not
// include OrbStack's or Docker Desktop's install locations. Probe the common
// macOS install paths once and prepend the hit so `docker` resolves.
const DOCKER_BIN_CANDIDATES = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Applications/Docker.app/Contents/Resources/bin"
] as const;

let dockerBinaryPath: string | undefined;

// Returns an absolute path to a usable `docker` binary when one of the common
// macOS install locations is present, so a Finder-launched app with launchd's
// minimal PATH can still reach Docker Desktop or OrbStack. Falls back to the
// bare command name and lets PATH resolution do its job.
function resolveDockerBinary(): string {
  if (dockerBinaryPath !== undefined) return dockerBinaryPath;
  // Test seam: point the connector at a recorder script without touching the
  // machine's real candidate list.
  if (process.env.SAND_DOCKER_BINARY != null && process.env.SAND_DOCKER_BINARY.length > 0) return process.env.SAND_DOCKER_BINARY;
  const hit = DOCKER_BIN_CANDIDATES.map((candidate) => join(candidate, "docker")).find((candidate) => existsSync(candidate));
  dockerBinaryPath = hit ?? "docker";
  return dockerBinaryPath;
}

function runDocker(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const binary = resolveDockerBinary();
    const installDir = dirname(binary);
    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${installDir}${delimiter}${process.env.PATH ?? ""}` }
    });
    let output = "";
    const append = (chunk: Buffer): void => { output += chunk.toString(); if (output.length > 200_000) output = output.slice(-200_000); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => resolve({ ok: false, code: null, output: `${output}\n${error.message}`.trim() }));
    child.once("close", (code) => resolve({ ok: code === 0, code, output: output.trim() }));
  });
}

// Save-time endpoint probe, run INSIDE the local Docker box (2026-10-05). The
// desktop-side probes (preload fetchEndpointModels, probeOpenRouterChannel)
// prove the MAC can reach the endpoint — but inference dials FROM THE
// CONTAINER, whose network position differs (host.docker.internal rewrites,
// relay hops). 2026-10-04: a whole-day incident ran on a config the desktop
// validated and the container could not use. This probe dials the exact
// transport the host will use (resolveOpenRouterTransport with inDocker=true)
// so a save is only allowed through when the box itself can reach the
// endpoint with the current key.
export type BoxEndpointProbeVerdict = "pass" | "unreachable" | "auth-rejected" | "odd-status" | "skipped";

export interface BoxEndpointProbeResult {
  readonly verdict: BoxEndpointProbeVerdict;
  readonly httpStatus: number | null;
  readonly detail: string;
}

export interface RawDockerProbeOutcome {
  readonly spawnError: string | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function tail(text: string, maxChars = 300): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? normalized.slice(-maxChars) : normalized;
}

// Pure verdict mapping, unit-testable without docker: exit 0 reads the -w
// %{http_code} from stdout; curl failures (6/7/28/…) mean unreachable; exit
// 125 and spawn errors mean docker itself could not run the probe, which must
// not block a save (the sandbox may simply be stopped).
export function interpretBoxEndpointProbe(outcome: RawDockerProbeOutcome): BoxEndpointProbeResult {
  if (outcome.spawnError != null) return { verdict: "skipped", httpStatus: null, detail: `docker 不可用（${tail(outcome.spawnError)}）` };
  if (outcome.exitCode === 125) return { verdict: "skipped", httpStatus: null, detail: `docker exec 失败，容器可能未运行（${tail(outcome.stderr)}）` };
  const codeMatch = /(\d{3})\s*$/.exec(outcome.stdout.trim());
  const httpStatus = codeMatch == null ? null : Number(codeMatch[1]);
  if (outcome.exitCode === 0) {
    if (httpStatus != null && httpStatus >= 200 && httpStatus <= 299) return { verdict: "pass", httpStatus, detail: "" };
    if (httpStatus === 401 || httpStatus === 403) return { verdict: "auth-rejected", httpStatus, detail: `端点拒绝了当前 API Key（HTTP ${httpStatus}）` };
    return { verdict: "odd-status", httpStatus, detail: httpStatus == null ? "端点已应答但响应码不可解析" : `端点已应答，HTTP ${httpStatus}（未实现 /models 或临时错误，不阻断保存）` };
  }
  return { verdict: "unreachable", httpStatus, detail: tail(outcome.stderr) || `curl 退出码 ${outcome.exitCode}` };
}

function runDockerWithStdin(args: readonly string[], stdin: string, timeoutMs: number): Promise<RawDockerProbeOutcome> {
  return new Promise((resolve) => {
    const binary = resolveDockerBinary();
    const installDir = dirname(binary);
    const child = spawn(binary, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: `${installDir}${delimiter}${process.env.PATH ?? ""}` }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (spawnError: string | null, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve({ spawnError, exitCode, stdout: stdout.trim(), stderr: stderr.trim() });
    };
    const killer = setTimeout(() => { child.kill(); finish(null, null); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish(error.message, null));
    child.once("close", (code) => finish(null, code));
    // The Authorization header travels through stdin as a curl config
    // (-K -): it must never appear in argv, where `ps` on the Mac could
    // read it back off the docker CLI process.
    child.stdin?.on("error", () => { /* EPIPE when the child dies first */ });
    child.stdin?.end(stdin);
  });
}

export async function probeEndpointFromBox(
  persistedBaseUrl: string | null | undefined,
  apiKey: string | null | undefined,
  options?: { readonly timeoutMs?: number },
): Promise<BoxEndpointProbeResult> {
  const timeoutMs = options?.timeoutMs ?? OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS + 2_000;
  const transport = resolveOpenRouterTransport(persistedBaseUrl ?? null, true);
  let target: URL;
  try {
    target = new URL(`${transport.baseUrl.replace(/\/+$/, "")}/models`);
  } catch {
    return { verdict: "odd-status", httpStatus: null, detail: "baseUrl 无法解析为 URL，已跳过容器探测" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { verdict: "odd-status", httpStatus: null, detail: `不支持的协议 ${target.protocol}，已跳过容器探测` };
  }
  const config = [
    ...(apiKey != null && apiKey.trim().length > 0 ? [`header = "Authorization: Bearer ${apiKey.trim()}"`] : []),
    ...(transport.hostHeader != null ? [`header = "Host: ${transport.hostHeader}"`] : []),
  ].join("\n") + "\n";
  const outcome = await runDockerWithStdin(
    ["exec", "-i", LOCAL_DOCKER_BOX_CONTAINER, "/usr/bin/curl", "-sS", "-m", String(Math.ceil(timeoutMs / 1000)), "-o", "/dev/null", "-w", "%{http_code}", "-K", "-", target.toString()],
    config,
    timeoutMs + 8_000,
  );
  return interpretBoxEndpointProbe(outcome);
}


export interface ParsedLocalDockerRelayOutput {
  readonly body: string;
  readonly httpStatus: number | null;
  readonly elapsedSeconds: number | null;
}

export function parseLocalDockerRelayOutput(output: string): ParsedLocalDockerRelayOutput {
  const normalized = output.replace(/\r\n/g, "\n").trimEnd();
  const matched = /\n(\d{3})\s+(\d+(?:\.\d+)?)\s*$/.exec(normalized);
  if (matched == null) return { body: normalized, httpStatus: null, elapsedSeconds: null };
  const elapsedSeconds = Number(matched[2]);
  return {
    body: normalized.slice(0, matched.index).trimEnd(),
    httpStatus: Number(matched[1]),
    elapsedSeconds: Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : null,
  };
}

function relayNetworkError(body: string): Error & { code: string } {
  const text = body.toLowerCase();
  if (/timed out|timeout|operation too slow|exit 28/.test(text)) {
    return Object.assign(new Error("Local Docker relay request timed out."), { code: "ETIMEDOUT" });
  }
  if (/connection refused|failed to connect|exit 7/.test(text)) {
    return Object.assign(new Error("Local Docker relay refused the connection."), { code: "ECONNREFUSED" });
  }
  if (/could not resolve host|no address associated|temporary failure in name resolution/.test(text)) {
    return Object.assign(new Error("Local Docker relay DNS lookup failed."), { code: "ENOTFOUND" });
  }
  if (/connection reset|reset by peer/.test(text)) {
    return Object.assign(new Error("Local Docker relay reset the connection."), { code: "ECONNRESET" });
  }
  return Object.assign(new Error("Local Docker relay request failed."), { code: "EHOSTUNREACH" });
}

function relayHttpErrorRecord(httpStatus: number, body: string): Record<string, unknown> {
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 300);
  const lower = detail.toLowerCase();
  const code = httpStatus === 403
    ? lower.includes("relay token required")
      ? "RelayTokenRequired"
      : "OpenCodexUpstreamForbidden"
    : undefined;
  return {
    name: "OpenRouterChannelError",
    ...(code == null ? {} : { code }),
    message: `Local Docker relay returned HTTP ${httpStatus}.` + (detail.length === 0 ? "" : ` Response: ${detail}`),
    statusCode: httpStatus,
    responseBody: body,
  };
}

export function localDockerRelayStatusFromProbe(result: ParsedLocalDockerRelayOutput, startedAt: number): OpenRouterChannelStatus {
  let status: OpenRouterChannelStatus;
  if (result.httpStatus === 200) {
    try {
      const parsed = JSON.parse(result.body) as { data?: unknown };
      if (!Array.isArray(parsed.data) || parsed.data.length === 0) throw new SyntaxError("Local Docker relay returned an empty model list.");
      const valid = parsed.data.some((model) => typeof model === "object" && model != null && typeof (model as { id?: unknown }).id === "string" && (model as { id: string }).id.trim().length > 0);
      if (!valid) throw new SyntaxError("Local Docker relay returned model entries without valid ids.");
      status = openRouterOkStatus("model_list", startedAt, 200);
    } catch (error) {
      status = classifyOpenRouterError(error, "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt);
    }
  } else if (result.httpStatus != null && result.httpStatus > 0) {
    status = classifyOpenRouterError({
      ...relayHttpErrorRecord(result.httpStatus, result.body),
    }, "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt, result.httpStatus);
  } else {
    status = classifyOpenRouterError(relayNetworkError(result.body), "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt);
  }
  const latencyMs = result.elapsedSeconds == null ? status.latencyMs : Math.round(result.elapsedSeconds * 1000);
  return { ...status, latencyMs };
}

export async function probeLocalDockerRelay(timeoutMs = OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS): Promise<OpenRouterChannelStatus> {
  const startedAt = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const result = await runDocker([
    "exec", LOCAL_DOCKER_BOX_CONTAINER, "/usr/bin/curl", "-sS", "-m", String(timeoutSeconds),
    "-w", "\n%{http_code} %{time_total}", `http://127.0.0.1:${OPENCODEX_CONTAINER_RELAY_PORT}/v1/models`,
  ]);
  const output = result.ok ? result.output : result.output + "\n[docker-exit " + (result.code ?? "unknown") + "]";
  return localDockerRelayStatusFromProbe(parseLocalDockerRelayOutput(output), startedAt);
}

function credentialPath(settingsPath: string): string {
  return join(dirname(settingsPath), "local-docker-vm.json");
}

/** One snapshot store per settings path: a shared instance is what serializes saves against restores (review life-4). */
const snapshotStores = new Map<string, LocalDockerSnapshotStore>();
/** Snapshot store for the app's local VM; the helper image is the pinned digest the container already runs, so snapshotting never pulls anything. */
export function localDockerSnapshotStoreFor(settingsPath: string): LocalDockerSnapshotStore {
  const existing = snapshotStores.get(settingsPath);
  if (existing != null) return existing;
  const store = createLocalDockerSnapshotStore({
    runDocker,
    container: LOCAL_DOCKER_BOX_CONTAINER,
    workspaceVolume: LOCAL_DOCKER_WORKSPACE_VOLUME,
    dataVolume: LOCAL_DOCKER_DATA_VOLUME,
    helperImage: LOCAL_DOCKER_BOX_IMAGE_DIGEST,
    root: join(dirname(settingsPath), "local-docker-snapshots"),
    boxSchemaVersion: LOCAL_DOCKER_SCHEMA_VERSION,
    log: (message) => console.log(`[sand] ${message}`),
  });
  snapshotStores.set(settingsPath, store);
  return store;
}

/** Scheduler predicate: snapshot only an owned, running container (a stopped one has no newer state than the last snapshot). */
export async function isLocalDockerBoxSnapshotCandidate(): Promise<boolean> {
  const inspected = await inspectContainer();
  return inspected.exists && inspected.running && inspected.owned;
}

async function readOrCreateToken(settingsPath: string): Promise<string> {
  const target = credentialPath(settingsPath);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length >= 32) return parsed.token;
  } catch {}
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ schemaVersion: 1, token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
  return token;
}

async function gatewayReady(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_DOCKER_GATEWAY_URL}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch { return false; }
}

async function inspectContainer(): Promise<{ exists: boolean; running: boolean; paused: boolean; owned: boolean; image: string; hostSha256: string; schemaVersion: string }> {
  const result = await runDocker(["inspect", "--format", "{{json .}}", LOCAL_DOCKER_BOX_CONTAINER]);
  if (!result.ok) return { exists: false, running: false, paused: false, owned: false, image: "", hostSha256: "", schemaVersion: "" };
  try {
    const value = JSON.parse(result.output) as { State?: { Running?: unknown; Paused?: unknown }; Config?: { Image?: unknown; Labels?: Record<string, unknown> } };
    return {
      exists: true,
      running: value.State?.Running === true,
      paused: value.State?.Paused === true,
      owned: value.Config?.Labels?.["com.grok-bot.local-vm"] === "1",
      image: typeof value.Config?.Image === "string" ? value.Config.Image : "",
      hostSha256: typeof value.Config?.Labels?.["com.grok-bot.local-vm.host-sha256"] === "string" ? value.Config.Labels["com.grok-bot.local-vm.host-sha256"] as string : "",
      schemaVersion: typeof value.Config?.Labels?.["com.grok-bot.local-vm.schema-version"] === "string" ? value.Config.Labels["com.grok-bot.local-vm.schema-version"] as string : "",
    };
  } catch { throw new Error("Docker returned malformed container inspection data."); }
}

export async function getLocalDockerStatus(settingsPath: string): Promise<LocalDockerStatus> {
  const daemon = await runDocker(["info", "--format", "{{.ServerVersion}}"]).catch(() => ({ ok: false, output: "Docker is not installed." }));
  if (!daemon.ok) return { available: false, running: false, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: LOCAL_DOCKER_BOX_IMAGE, detail: daemon.output || "Docker is not running." };
  const inspected = await inspectContainer();
  if (!inspected.exists) return { available: true, running: false, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: LOCAL_DOCKER_BOX_IMAGE, detail: "Ready to create the local VM." };
  if (!inspected.owned) return { available: true, running: inspected.running, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: inspected.image, detail: `Container ${LOCAL_DOCKER_BOX_CONTAINER} exists but is not owned by Grok Bot.` };
  if (inspected.paused) return { available: true, running: true, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: inspected.image, detail: `Container ${LOCAL_DOCKER_BOX_CONTAINER} is paused; connecting again will auto-unpause it.` };
  const ready = inspected.running && await gatewayReady(await readOrCreateToken(settingsPath));
  return { available: true, running: inspected.running, ready, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: inspected.image, detail: ready ? "Local Docker VM is ready." : inspected.running ? "Container is starting." : "Local Docker VM is stopped." };
}

let ensureInFlight: Promise<GatewayConnection> | undefined;

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function stageCurrentHostBundle(settingsPath: string): Promise<LocalHostBundle> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const readRuntime = async (relative: string): Promise<Buffer> => {
    const candidates = [resolve(moduleDirectory, `../${relative}`), resolve(moduleDirectory, `../../${relative}`)];
    for (const candidate of candidates) {
      try { return await readFile(candidate); } catch {}
    }
    throw new Error(`The reconstructed runtime is unavailable at ${candidates.join(" or ")}; refusing to start a stock local VM.`);
  };
  const hostBytes = await readRuntime("host/host-main.cjs");
  const boxExecDaemonBytes = await readRuntime("box-exec-daemon/main.cjs");
  const sha256 = createHash("sha256").update(hostBytes).digest("hex");
  const boxExecDaemonSha256 = createHash("sha256").update(boxExecDaemonBytes).digest("hex");
  const directory = join(dirname(settingsPath), "local-docker-runtime", `${sha256}-${boxExecDaemonSha256}`);
  const persistRuntime = async (name: string, bytes: Buffer): Promise<string> => {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Content-addressed local runtime ${target} has unexpected bytes.`);
    } catch (error) {
      if (error instanceof Error && !Reflect.has(error, "code")) throw error;
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    }
    return target;
  };
  await mkdir(directory, { recursive: true });
  return {
    path: await persistRuntime("host-main.cjs", hostBytes),
    sha256,
    boxExecDaemonPath: await persistRuntime("box-exec-daemon/main.cjs", boxExecDaemonBytes),
    boxExecDaemonSha256,
  };
}

async function localAuthMountArguments(): Promise<string[]> {
  const mounts: string[] = [];
  for (const [source, destination] of [[join(homedir(), ".codex"), "/root/.codex"]] as const) {
    if (await isDirectory(source)) mounts.push("--mount", `type=bind,src=${source},dst=${destination},readonly`);
  }
  return mounts;
}

export function buildLocalDockerBoxRunArgs(args: {
  readonly token: string;
  readonly hostBundle: LocalHostBundle;
  readonly authMounts: readonly string[];
  readonly library: LibraryDockerForwarding | null;
  /** Snapshot restore path: create the container from a committed snapshot image instead of the pinned digest. */
  readonly imageOverride?: string;
}): string[] {
  const { token, hostBundle, authMounts, library } = args;
  return [
    "run", "--detach", "--name", LOCAL_DOCKER_BOX_CONTAINER,
    "--label", LOCAL_DOCKER_OWNER_LABEL, "--label", `com.grok-bot.local-vm.host-sha256=${hostBundle.sha256}`,
    "--label", `com.grok-bot.local-vm.box-exec-daemon-sha256=${hostBundle.boxExecDaemonSha256}`,
    "--label", `com.grok-bot.local-vm.schema-version=${LOCAL_DOCKER_SCHEMA_VERSION}`,
    "--platform", "linux/amd64", "--restart", "unless-stopped",
    "--env", "SAND_SUPERVISOR_ENABLED=1",
    // SAND_BOX_AUTO_UPDATE=0 is LOAD-BEARING: it is the only opt-out the
    // upstream supervisor's shouldBootFetchHostBundle() honours. Without it,
    // a freshly booted container whose image-baked host matches the image
    // git-sha fetches the newest upstream host bundle from the vendor S3 and
    // swaps it in, replacing whatever we mounted. Do not remove this env
    // when "cleaning up" the docker run arguments.
    "--env", "SAND_BOX_AUTO_UPDATE=0",
    // P2-8: official 0.68.1/0.71.2 computer display (start-desktop.sh SCREEN_WIDTH/HEIGHT).
    "--env", "SCREEN_WIDTH=1920",
    "--env", "SCREEN_HEIGHT=1200",
    "--env", "SAND_USE_EXISTING_BOX_EXEC_DAEMON=1", "--env", `SAND_TREE_SITTER_NODE_DEPS=${SAND_BOX_DEPS_DIR}`, "--env", `NODE_PATH=${SAND_BOX_DEPS_DIR}`, "--env", `SAND_BOX_HOST_BUNDLE_ROOT=${SAND_BOX_HOST_BUNDLE_ROOT}`, "--env", "SAND_GATEWAY_BIND_HOST=0.0.0.0", "--env", "SAND_HOST_PORT=1340", "--env", `SAND_GATEWAY_TOKEN=${token}`,
    "--publish", "127.0.0.1:1337:1337", "--publish", "127.0.0.1:1339:1339", "--publish", "127.0.0.1:1340:1340",
    "--publish", "127.0.0.1:6080:6080", "--publish", "127.0.0.1:6081:6081", "--publish", "127.0.0.1:8790:8790",
    "--volume", `${LOCAL_DOCKER_WORKSPACE_VOLUME}:/workspace`, "--volume", `${LOCAL_DOCKER_DATA_VOLUME}:/home/box/sand-data`,
    // The mount target is the image's own host entry path (the supervisor
    // spawns `node <HOST_DIR>/host-main.cjs` with HOST_DIR taken from the
    // image's sand-supervisor-contract.mjs). Mounting anywhere else leaves our
    // bundle as a dead file while the upstream host keeps serving :1340.
    "--mount", `type=bind,src=${hostBundle.path},dst=${SAND_BOX_HOST_ENTRY},readonly`,
    "--mount", `type=bind,src=${dirname(hostBundle.boxExecDaemonPath)},dst=${SAND_BOX_EXEC_DAEMON_DIR},readonly`,
    ...authMounts,
    ...(library == null ? [] : libraryDockerForwardingArgs(library)),
    args.imageOverride ?? LOCAL_DOCKER_BOX_IMAGE_DIGEST,
  ];
}

async function ensureLocalDockerBox(settingsPath: string, imageOverride?: string): Promise<GatewayConnection> {
  const libraryForwarding = resolveLibraryDockerForwarding(process.env);
  const token = await readOrCreateToken(settingsPath);
  const hostBundle = await stageCurrentHostBundle(settingsPath);
  const daemon = await runDocker(["info", "--format", "{{.ServerVersion}}"]).catch(() => ({ ok: false, output: "Docker is not installed." }));
  if (!daemon.ok) throw new Error(`Local Docker VM is selected, but Docker is unavailable: ${daemon.output || "start Docker and try again"}`);
  const inspected = await inspectContainer();
  if (inspected.exists && !inspected.owned) throw new Error(`Local Docker VM cannot use ${LOCAL_DOCKER_BOX_CONTAINER}: an unowned container already has that name.`);
  // A snapshot-restored container runs from a committed image (docker commit
  // preserves the ownership/host-sha/schema labels), so it stays acceptable
  // here; the host bundle itself is bind-mounted at run time regardless.
  const isSnapshotImage = inspected.image.startsWith(`${snapshotImageRepo(LOCAL_DOCKER_BOX_CONTAINER)}:`);
  // A schema-version bump means this build expects a different in-box layout
  // (different host bundle root, different image pin). A container left over
  // from the previous build is then replaced automatically below instead of
  // being rejected as an "unexpected image"; without that bump an unexpected
  // image stays a hard error that asks for an explicit removal.
  const layoutChanged = inspected.schemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION;
  if (inspected.exists && !isSnapshotImage && inspected.image !== LOCAL_DOCKER_BOX_IMAGE_DIGEST && inspected.image !== LOCAL_DOCKER_BOX_IMAGE && !layoutChanged) {
    throw new Error(`Local Docker VM container uses unexpected image ${inspected.image}. Remove it explicitly before changing images.`);
  }
  if (inspected.exists && (layoutChanged || inspected.hostSha256 !== hostBundle.sha256)) {
    // Best-effort snapshot before the destructive auto-replace so the
    // in-container state of the superseded runtime survives in a Reset target.
    if (inspected.owned) await localDockerSnapshotStoreFor(settingsPath).save().then((outcome) => { if (!outcome.ok) console.warn(`[local-docker-host-connector] pre-replace snapshot skipped: ${outcome.error}`); }, () => undefined);
    const removed = await runDocker(["rm", "--force", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!removed.ok) throw new Error(`Could not replace the local VM with the current app runtime: ${removed.output}`);
  }
  const shouldReplace = inspected.exists && (layoutChanged || inspected.hostSha256 !== hostBundle.sha256);
  const current = shouldReplace ? await inspectContainer() : inspected;
  if (current.exists && !current.running) {
    const started = await runDocker(["start", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!started.ok) throw new Error(`Could not start the local Docker VM: ${started.output}`);
  } else if (!current.exists) {
    const authMounts = await localAuthMountArguments();
    const created = await runDocker(buildLocalDockerBoxRunArgs({ token, hostBundle, authMounts, library: libraryForwarding, ...(imageOverride == null ? {} : { imageOverride }) }));
    if (!created.ok) throw new Error(`Could not create the local Docker VM: ${created.output}`);
  }
  // A snapshot save interrupted mid-flight (app exit while committing) can
  // leave the container daemon-side paused; every later `docker exec` then
  // fails with "Container ... is paused". Heal before probing readiness.
  if (current.running && current.paused) {
    const unpaused = await runDocker(["unpause", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!unpaused.ok) throw new Error(`Could not unpause ${LOCAL_DOCKER_BOX_CONTAINER}: ${unpaused.output}`);
    console.warn(`[local-docker-host-connector] healed a leaked pause on ${LOCAL_DOCKER_BOX_CONTAINER}`);
  }
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let gatewayUp = false;
  while (Date.now() < deadline) {
    if (await gatewayReady(token)) { gatewayUp = true; break; }
    const state = await inspectContainer();
    if (!state.running) {
      const logs = await runDocker(["logs", "--tail", "80", LOCAL_DOCKER_BOX_CONTAINER]);
      throw new Error(`Local Docker VM stopped before its gateway became ready.\n${logs.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!gatewayUp) throw new Error("Local Docker VM did not expose its gateway within three minutes.");
  const identity = await verifyHostIdentity(hostBundle);
  if (identity.kind === "foreign-host") {
    const message = `Local Docker VM gateway is served by a foreign host (pid ${identity.pid}: ${identity.cmdline}); the reconstructed bundle (sha256 ${identity.expectedSha256.slice(0, 12)}…) is NOT running. Host-side rebuild features (Router/OpenRouter/Effort) are silently disabled. Likely cause: the pinned image digest no longer launches ${SAND_BOX_HOST_ENTRY}.`;
    if (process.env.SAND_STRICT_HOST_IDENTITY === "1") throw new Error(message);
    console.warn(`[local-docker-host-connector] WARNING: ${message}`);
  } else if (identity.kind === "unknown") {
    console.warn(`[local-docker-host-connector] host identity could not be verified: ${identity.reason}`);
  }
  return { baseUrl: LOCAL_DOCKER_GATEWAY_URL, token };
}

export async function startLocalDockerBox(settingsPath: string): Promise<GatewayConnection> {
  return await ensureLocalDockerBox(settingsPath);
}

export async function stopLocalDockerBox(): Promise<void> {
  const inspected = await inspectContainer();
  if (!inspected.exists || !inspected.running) return;
  if (!inspected.owned) throw new Error(`Refusing to stop unowned container ${LOCAL_DOCKER_BOX_CONTAINER}.`);
  const stopped = await runDocker(["stop", LOCAL_DOCKER_BOX_CONTAINER]);
  if (!stopped.ok) throw new Error(`Could not stop the local Docker VM: ${stopped.output}`);
}

export function createSettingsRoutedHostConnector(settings: SandSettingsStore): LocalDockerHostConnector {
  // The single-flight promise is shared by every caller, so a snapshot-restore
  // recreate and a concurrent connect can never race two `docker run --name`
  // creations against each other (review life-4).
  const localConnect = (imageOverride?: string): Promise<GatewayConnection> => {
    if (ensureInFlight == null) ensureInFlight = ensureLocalDockerBox(settings.settingsPath, imageOverride).finally(() => { ensureInFlight = undefined; });
    return ensureInFlight;
  };
  return {
    connect: async () => await localConnect(),
    recreate: async (_args): Promise<RecreateResult> => {
      const restarted = await runDocker(["restart", LOCAL_DOCKER_BOX_CONTAINER]);
      if (!restarted.ok) throw new Error("Could not restart the local Docker VM: " + restarted.output);
      await localConnect();
      return { status: "started-untrackable" };
    },
    forceRecreate: async (): Promise<RecreateResult> => {
      // Reset Bot's Computer: with a saved snapshot, rebuild from it (the
      // hosted product's semantics — recent unsaved changes are discarded);
      // without one, fall back to the factory image. A snapshot taken under a
      // different box layout (schema version) is refused here: restoring it
      // would recreate the recorded dead-mount incident, so Reset falls back
      // to the factory image instead. The volumes are restored by the store;
      // the container itself is recreated by ensureLocalDockerBox from the
      // snapshot's committed image, which carries the ownership and host-sha
      // labels forward.
      const snapshotStore = localDockerSnapshotStoreFor(settings.settingsPath);
      let latest = await snapshotStore.latest().catch(() => null);
      if (latest != null && latest.boxSchemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION) {
        console.warn(`[local-docker-host-connector] snapshot ${latest.id} was taken under box schema ${latest.boxSchemaVersion}, not the current ${LOCAL_DOCKER_SCHEMA_VERSION}; resetting from the factory image instead`);
        latest = null;
      }
      if (latest != null) {
        const restored = await snapshotStore.restoreVolumes(latest);
        if (!restored.ok) return { status: "rejected", reason: restored.error };
        await localConnect(latest.imageTag);
        return { status: "started-untrackable" };
      }
      const removed = await runDocker(["rm", "--force", LOCAL_DOCKER_BOX_CONTAINER]);
      if (!removed.ok && !/no such container/i.test(removed.output)) return { status: "rejected", reason: removed.output };
      await localConnect();
      return { status: "started-untrackable" };
    },
  };
}
