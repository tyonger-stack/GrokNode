import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyOpenRouterError, openRouterOkStatus, type OpenRouterChannelStatus } from "../../shared/openrouter-channel-status.js";
import { OPENCODEX_CONTAINER_RELAY_PORT } from "../../shared/node/openrouter-proxy.js";
import type { SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";
import type { RecreateResult } from "./box-recreate-commands.js";
import type { GatewayConnection } from "./gateway-descriptor-cache.js";

export const LOCAL_DOCKER_BOX_IMAGE = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest";
export const LOCAL_DOCKER_BOX_CONTAINER = "grok-bot-local-vm";
export const LOCAL_DOCKER_GATEWAY_URL = "http://127.0.0.1:1340";
export const LOCAL_DOCKER_OWNER_LABEL = "com.grok-bot.local-vm=1";
export const LOCAL_DOCKER_SCHEMA_VERSION = "6";
const READY_TIMEOUT_MS = 180_000;

export interface LocalDockerStatus {
  readonly available: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly containerName: string;
  readonly image: string;
  readonly detail: string;
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

export async function probeLocalDockerRelay(timeoutMs = 2500): Promise<OpenRouterChannelStatus> {
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

async function inspectContainer(): Promise<{ exists: boolean; running: boolean; owned: boolean; image: string; hostSha256: string; schemaVersion: string }> {
  const result = await runDocker(["inspect", "--format", "{{json .}}", LOCAL_DOCKER_BOX_CONTAINER]);
  if (!result.ok) return { exists: false, running: false, owned: false, image: "", hostSha256: "", schemaVersion: "" };
  try {
    const value = JSON.parse(result.output) as { State?: { Running?: unknown }; Config?: { Image?: unknown; Labels?: Record<string, unknown> } };
    return {
      exists: true,
      running: value.State?.Running === true,
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

async function ensureLocalDockerBox(settingsPath: string): Promise<GatewayConnection> {
  const token = await readOrCreateToken(settingsPath);
  const hostBundle = await stageCurrentHostBundle(settingsPath);
  const daemon = await runDocker(["info", "--format", "{{.ServerVersion}}"]).catch(() => ({ ok: false, output: "Docker is not installed." }));
  if (!daemon.ok) throw new Error(`Local Docker VM is selected, but Docker is unavailable: ${daemon.output || "start Docker and try again"}`);
  const inspected = await inspectContainer();
  if (inspected.exists && !inspected.owned) throw new Error(`Local Docker VM cannot use ${LOCAL_DOCKER_BOX_CONTAINER}: an unowned container already has that name.`);
  if (inspected.exists && inspected.image !== LOCAL_DOCKER_BOX_IMAGE) throw new Error(`Local Docker VM container uses unexpected image ${inspected.image}. Remove it explicitly before changing images.`);
  if (inspected.exists && (inspected.schemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION || inspected.hostSha256 !== hostBundle.sha256)) {
    const removed = await runDocker(["rm", "--force", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!removed.ok) throw new Error(`Could not replace the local VM with the current app runtime: ${removed.output}`);
  }
  const shouldReplace = inspected.exists && (inspected.schemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION || inspected.hostSha256 !== hostBundle.sha256);
  const current = shouldReplace ? await inspectContainer() : inspected;
  if (current.exists && !current.running) {
    const started = await runDocker(["start", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!started.ok) throw new Error(`Could not start the local Docker VM: ${started.output}`);
  } else if (!current.exists) {
    const authMounts = await localAuthMountArguments();
    const created = await runDocker([
      "run", "--detach", "--name", LOCAL_DOCKER_BOX_CONTAINER,
      "--label", LOCAL_DOCKER_OWNER_LABEL, "--label", `com.grok-bot.local-vm.host-sha256=${hostBundle.sha256}`,
      "--label", `com.grok-bot.local-vm.box-exec-daemon-sha256=${hostBundle.boxExecDaemonSha256}`,
      "--label", `com.grok-bot.local-vm.schema-version=${LOCAL_DOCKER_SCHEMA_VERSION}`,
      "--platform", "linux/amd64", "--restart", "unless-stopped",
      "--env", "SAND_SUPERVISOR_ENABLED=1", "--env", "SAND_BOX_AUTO_UPDATE=0", "--env", "SAND_USE_EXISTING_BOX_EXEC_DAEMON=1", "--env", "SAND_TREE_SITTER_NODE_DEPS=/home/box/deps", "--env", "NODE_PATH=/home/box/deps", "--env", "SAND_GATEWAY_BIND_HOST=0.0.0.0", "--env", "SAND_HOST_PORT=1340", "--env", `SAND_GATEWAY_TOKEN=${token}`,
      "--publish", "127.0.0.1:1337:1337", "--publish", "127.0.0.1:1339:1339", "--publish", "127.0.0.1:1340:1340",
      "--publish", "127.0.0.1:6080:6080", "--publish", "127.0.0.1:6081:6081", "--publish", "127.0.0.1:8790:8790",
      "--volume", "grok-bot-local-vm-workspace:/workspace", "--volume", "grok-bot-local-vm-data:/home/box/sand-data",
      "--mount", `type=bind,src=${hostBundle.path},dst=/home/box/sand-host/host-main.cjs,readonly`,
      "--mount", `type=bind,src=${dirname(hostBundle.boxExecDaemonPath)},dst=/home/box/box-exec-daemon,readonly`,
      ...authMounts,
      LOCAL_DOCKER_BOX_IMAGE,
    ]);
    if (!created.ok) throw new Error(`Could not create the local Docker VM: ${created.output}`);
  }
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await gatewayReady(token)) return { baseUrl: LOCAL_DOCKER_GATEWAY_URL, token };
    const state = await inspectContainer();
    if (!state.running) {
      const logs = await runDocker(["logs", "--tail", "80", LOCAL_DOCKER_BOX_CONTAINER]);
      throw new Error(`Local Docker VM stopped before its gateway became ready.\n${logs.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Local Docker VM did not expose its gateway within three minutes.");
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
  const localConnect = (): Promise<GatewayConnection> => {
    if (ensureInFlight == null) ensureInFlight = ensureLocalDockerBox(settings.settingsPath).finally(() => { ensureInFlight = undefined; });
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
      const removed = await runDocker(["rm", "--force", LOCAL_DOCKER_BOX_CONTAINER]);
      if (!removed.ok && !/no such container/i.test(removed.output)) return { status: "rejected", reason: removed.output };
      await localConnect();
      return { status: "started-untrackable" };
    },
  };
}
