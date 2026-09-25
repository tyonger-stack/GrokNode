#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let CONTAINER_NAME = "grok-bot-local-vm";
const KNOWN_CONTAINER_NAMES = ["grok-node-local-vm", "grok-bot-local-vm"];
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MAC_FORWARDER_URL = "http://127.0.0.1:11010/v1";
const CONTAINER_RELAY_URL = "http://127.0.0.1:10100/v1";
// A healthy `/models` answers at ~5.1s p99 because opencodex refreshes every enabled provider first.
const MODEL_LIST_TIMEOUT_MS = 12_000;
const STABLE_RENDERER_MS = 5 * 60_000;

const jsonMode = process.argv.includes("--json");

function runCommand(file, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(file, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ ok: false, code: null, stdout, stderr: error.message }));
    child.once("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

function resolveDockerBinary() {
  const candidates = [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "docker";
}

async function resolveContainerName(dockerBinary) {
  for (const name of KNOWN_CONTAINER_NAMES) {
    const probed = await runCommand(dockerBinary, ["inspect", "-f", "{{.Name}}", name]);
    if (probed.ok) return name;
  }
  return KNOWN_CONTAINER_NAMES[0];
}

function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function codexHome() {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function readCodexConfigValue(key) {
  try {
    const config = readFileSync(join(codexHome(), "config.toml"), "utf8");
    const matched = new RegExp("^\\s*" + key + "\\s*=\\s*[\"']([^\"']+)[\"']", "m").exec(config);
    const value = matched?.[1]?.trim();
    return value == null || value.length === 0 ? null : value;
  } catch { return null; }
}

function resolveBaseUrl(macSettings) {
  const persisted = typeof macSettings?.openRouterBaseUrl === "string" ? macSettings.openRouterBaseUrl.trim() : "";
  return persisted || process.env.OPENROUTER_BASE_URL?.trim() || readCodexConfigValue("openai_base_url") || DEFAULT_BASE_URL;
}

function isLocalMacForwarder(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "11010";
  } catch { return false; }
}

function check(id, name, status, detail, data = {}) {
  return { id, name, status, detail, ...(Object.keys(data).length === 0 ? {} : { data }) };
}

async function containerCheck(dockerBinary) {
  const result = await runCommand(dockerBinary, ["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
  const running = result.ok && result.stdout.trim() === "true";
  return check(
    "container",
    "本地容器",
    running ? "ok" : "down",
    running ? "容器正在运行" : result.stderr.trim() || `容器未运行（${CONTAINER_NAME}）`,
    { running }
  );
}

function relayIsListening(output) {
  return output.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1];
    const state = columns[3];
    if (state !== "0A" || typeof localAddress !== "string") return false;
    const [addressHex, portHex] = localAddress.split(":");
    return portHex === "2774" && (addressHex === "0100007F" || addressHex === "00000000000000000000000001000000");
  });
}

async function relayCheck(dockerBinary, useLocalForwarder, containerRunning) {
  if (!useLocalForwarder) {
    return check("relay", "本地中继", "skipped", "当前 API 地址不经过本地 OpenCodex relay");
  }
  if (!containerRunning) return check("relay", "本地中继", "down", "容器未运行，无法检查中继监听");
  const result = await runCommand(dockerBinary, ["exec", CONTAINER_NAME, "cat", "/proc/net/tcp", "/proc/net/tcp6"]);
  const listening = relayIsListening(result.stdout);
  return check(
    "relay",
    "本地中继",
    listening ? "ok" : "down",
    listening ? "容器内 127.0.0.1:10100 正在监听" : "容器内未发现 127.0.0.1:10100 LISTEN",
    { port: 10100, listening }
  );
}

function parseCurlOutput(result) {
  const raw = (result.stdout + (result.ok || result.stdout.length > 0 ? "" : result.stderr)).replace(/\r\n/g, "\n").trimEnd();
  const output = result.ok ? raw : raw + "\n[docker-exit " + (result.code ?? "unknown") + "]";
  const matched = /\n(\d{3})\s+(\d+(?:\.\d+)?)\s*$/.exec(output);
  if (matched == null) return { body: output, httpStatus: null, elapsedSeconds: null };
  const elapsedSeconds = Number(matched[2]);
  return {
    body: output.slice(0, matched.index).trimEnd(),
    httpStatus: Number(matched[1]),
    elapsedSeconds: Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : null,
  };
}

function hasQuotaText(value) {
  return /quota|balance|insufficient|payment|exhausted|额度|余额|余量/.test(value.toLowerCase());
}

function networkFailure(body) {
  const text = body.toLowerCase();
  if (/timed out|timeout|operation too slow|exit 28/.test(text)) {
    return { state: "response_timeout", detail: "容器内模型列表请求超时", code: "ETIMEDOUT" };
  }
  if (/connection refused|failed to connect|exit 7/.test(text)) {
    return { state: "connection_failed", detail: "容器内 relay 拒绝连接", code: "ECONNREFUSED" };
  }
  if (/could not resolve host|no address associated|temporary failure in name resolution/.test(text)) {
    return { state: "connection_failed", detail: "容器内 DNS 解析失败", code: "ENOTFOUND" };
  }
  if (/connection reset|reset by peer/.test(text)) {
    return { state: "connection_failed", detail: "容器内 relay 重置连接", code: "ECONNRESET" };
  }
  return { state: "connection_failed", detail: "无法连接容器内 relay", code: "EHOSTUNREACH" };
}

async function localRelayModelListCheck(dockerBinary, containerRunning) {
  if (!containerRunning) {
    return check("models", "模型列表", "down", "容器未运行，无法通过 relay 请求模型列表", {
      requestUrl: CONTAINER_RELAY_URL + "/models",
    });
  }
  const result = await runCommand(dockerBinary, [
    "exec", CONTAINER_NAME, "/usr/bin/curl", "-sS", "-m", String(Math.ceil(MODEL_LIST_TIMEOUT_MS / 1000)),
    "-w", "\n%{http_code} %{time_total}", join(CONTAINER_RELAY_URL, "models"),
  ]);
  const probe = parseCurlOutput(result);
  const latencyMs = probe.elapsedSeconds == null ? null : Math.round(probe.elapsedSeconds * 1000);
  const baseData = { requestUrl: CONTAINER_RELAY_URL + "/models", httpStatus: probe.httpStatus, latencyMs };

  if (probe.httpStatus === 200) {
    let modelCount = 0;
    try {
      const body = JSON.parse(probe.body);
      modelCount = Array.isArray(body?.data)
        ? body.data.filter((model) => typeof model?.id === "string" && model.id.trim().length > 0).length
        : 0;
    } catch {}
    if (modelCount === 0) {
      return check("models", "模型列表", "down", "/models 返回成功但 data 为空或缺少模型 id", { ...baseData, modelCount });
    }
    return check("models", "模型列表", "ok", `HTTP 200，${modelCount} 个模型，耗时 ${latencyMs ?? "unknown"} ms`, { ...baseData, modelCount });
  }

  if (probe.httpStatus === 402 || hasQuotaText(probe.body)) {
    return check("models", "模型列表", "degraded", "OpenCodex Token Plan 无额度", { ...baseData, channelState: "out_of_quota" });
  }
  if (probe.httpStatus === 429) {
    return check("models", "模型列表", "degraded", "OpenCodex 通道限流中", { ...baseData, channelState: "rate_limited" });
  }
  if (probe.httpStatus === 403) {
    return check("models", "模型列表", "degraded", "OpenCodex 上游返回 403", { ...baseData, channelState: "upstream_403" });
  }
  if (probe.httpStatus === 408 || probe.httpStatus === 504 || probe.httpStatus === 524) {
    return check("models", "模型列表", "degraded", "OpenCodex 上游响应超时", { ...baseData, channelState: "response_timeout" });
  }
  if (probe.httpStatus != null) {
    return check("models", "模型列表", "degraded", `OpenCodex 模型列表返回 HTTP ${probe.httpStatus}`, { ...baseData, channelState: "model_list_abnormal" });
  }
  const failure = networkFailure(probe.body + "\n" + result.stderr);
  return check("models", "模型列表", "down", failure.detail, { ...baseData, code: failure.code, channelState: failure.state });
}

async function directModelListCheck(baseUrl) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  try {
    const headers = baseUrl === DEFAULT_BASE_URL
      ? (process.env.OPENROUTER_API_KEY ? { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : {})
      : { authorization: "Bearer local-proxy" };
    const response = await fetch(new URL("models", `${baseUrl.replace(/\/+$/, "")}/`), { signal: controller.signal, headers });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return check("models", "模型列表", "degraded", `HTTP ${response.status}，通道可达但当前请求被拒绝`, { httpStatus: response.status, latencyMs });
    }
    const body = await response.json();
    const modelCount = Array.isArray(body?.data)
      ? body.data.filter((model) => typeof model?.id === "string" && model.id.trim().length > 0).length
      : 0;
    if (modelCount === 0) {
      return check("models", "模型列表", "down", "/models 返回成功但 data 为空或缺少模型 id", { httpStatus: response.status, latencyMs, modelCount });
    }
    return check("models", "模型列表", "ok", `HTTP 200，${modelCount} 个模型，耗时 ${latencyMs} ms`, { httpStatus: response.status, latencyMs, modelCount });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return check("models", "模型列表", "down", timedOut ? `模型列表 ${MODEL_LIST_TIMEOUT_MS} ms 超时` : (error?.message || String(error)), {
      code: error?.code ?? error?.name ?? null,
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timer);
  }
}

function elapsedToSeconds(value) {
  let days = 0;
  let clock = value;
  if (value.includes("-")) {
    const [dayPart, ...rest] = value.split("-");
    days = Number(dayPart);
    clock = rest.join("-");
  }
  const parts = clock.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return days * 86_400 + parts[0] * 60 + parts[1];
  if (parts.length === 3) return days * 86_400 + parts[0] * 3_600 + parts[1] * 60 + parts[2];
  return 0;
}

function rendererCheck() {
  const output = spawn("ps", ["-axo", "pid=,etime=,command="], { stdio: ["ignore", "pipe", "ignore"] });
  let text = "";
  output.stdout.on("data", (chunk) => { text += chunk; });
  return new Promise((resolve) => {
    output.once("close", () => {
      const renderers = [];
      let appProcessCount = 0;
      for (const line of text.split(/\r?\n/)) {
        const matched = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
        if (matched == null) continue;
        const command = matched[3];
        if (!command.includes("Grok Node.app/Contents")) continue;
        appProcessCount += 1;
        if (!/(?:^|\s)--type=renderer(?:\s|$)/.test(command)) continue;
        renderers.push({ pid: Number(matched[1]), ageSeconds: elapsedToSeconds(matched[2]) });
      }
      if (appProcessCount === 0) {
        resolve(check("renderer", "渲染进程", "down", "未发现 Grok Node 进程"));
        return;
      }
      if (renderers.length === 0) {
        resolve(check("renderer", "渲染进程", "down", "Grok Node 主进程存在，但未发现 renderer 进程"));
        return;
      }
      const stableRenderers = renderers.filter((renderer) => renderer.ageSeconds * 1000 >= STABLE_RENDERER_MS);
      const oldest = Math.max(...renderers.map((renderer) => renderer.ageSeconds));
      resolve(check(
        "renderer",
        "渲染进程",
        stableRenderers.length > 0 ? "ok" : "degraded",
        stableRenderers.length > 0 ? `已有稳定 renderer，最久运行 ${oldest} 秒` : `renderer 启动未满 ${STABLE_RENDERER_MS / 1000} 秒`,
        { rendererCount: renderers.length, stableRendererCount: stableRenderers.length, oldestAgeSeconds: oldest }
      ));
    });
  });
}

function routingSettings(raw) {
  return {
    inferenceProvider: raw?.inferenceProvider === "codex" ? "codex" : "openrouter",
    openRouterModel: typeof raw?.openRouterModel === "string" && raw.openRouterModel.trim().length > 0 ? raw.openRouterModel.trim() : null,
    openRouterBaseUrl: typeof raw?.openRouterBaseUrl === "string" && raw.openRouterBaseUrl.trim().length > 0 ? raw.openRouterBaseUrl.trim() : null,
    boxRuntime: raw?.boxRuntime === "remote" ? "remote" : "local-docker",
  };
}

async function settingsConsistencyCheck(dockerBinary, containerRunning) {
  const macSettingsPath = join(homedir(), ".grokbot", "settings.json");
  const macSettings = routingSettings(readJsonObject(macSettingsPath));
  if (!containerRunning) {
    return check("settings", "设置一致性", "down", "容器未运行，无法读取容器侧设置", { macSettingsPath, macSettings });
  }
  const result = await runCommand(dockerBinary, ["exec", CONTAINER_NAME, "cat", "/home/box/sand-data/settings.json"]);
  let boxRaw = null;
  try { boxRaw = JSON.parse(result.stdout); } catch { boxRaw = null; }
  if (!result.ok || boxRaw == null) {
    return check("settings", "设置一致性", "down", result.stderr.trim() || "容器侧 settings.json 无法读取或解析", { macSettingsPath, macSettings });
  }
  const boxSettings = routingSettings(boxRaw);
  const mismatches = Object.keys(macSettings).filter((key) => JSON.stringify(macSettings[key]) !== JSON.stringify(boxSettings[key]));
  return check(
    "settings",
    "设置一致性",
    mismatches.length === 0 ? "ok" : "degraded",
    mismatches.length === 0 ? "两侧 provider、模型、API 地址和运行模式一致" : `不一致字段：${mismatches.join(", ")}`,
    { macSettingsPath, macSettings, boxSettings, mismatches }
  );
}

function conclusionFromChecks(checks) {
  const statuses = checks.map((item) => item.status).filter((status) => status !== "skipped");
  if (statuses.includes("down")) return { conclusion: "DOWN", exitCode: 2 };
  if (statuses.includes("degraded")) return { conclusion: "DEGRADED", exitCode: 1 };
  return { conclusion: "OK", exitCode: 0 };
}

function printHuman(result) {
  console.log(result.conclusion);
  console.log("Mac endpoint: " + result.macEndpoint);
  console.log("Container relay: " + result.containerRelayUrl);
  for (const item of result.checks) {
    const label = item.status.toUpperCase().padEnd(8);
    console.log(label + item.name + " - " + item.detail);
  }
}

async function main() {
  const macSettingsPath = join(homedir(), ".grokbot", "settings.json");
  const macSettings = readJsonObject(macSettingsPath);
  const baseUrl = resolveBaseUrl(macSettings);
  const useLocalForwarder = isLocalMacForwarder(baseUrl);
  const dockerBinary = resolveDockerBinary();
  CONTAINER_NAME = await resolveContainerName(dockerBinary);
  const container = await containerCheck(dockerBinary);
  const containerRunning = container.data?.running === true;
  const checks = [
    container,
    await relayCheck(dockerBinary, useLocalForwarder, containerRunning),
    useLocalForwarder ? await localRelayModelListCheck(dockerBinary, containerRunning) : await directModelListCheck(baseUrl),
    await rendererCheck(),
    await settingsConsistencyCheck(dockerBinary, containerRunning),
  ];
  const verdict = conclusionFromChecks(checks);
  const result = {
    ...verdict,
    checkedAt: new Date().toISOString(),
    baseUrl,
    macEndpoint: MAC_FORWARDER_URL,
    containerRelayUrl: CONTAINER_RELAY_URL,
    checks,
  };
  if (jsonMode) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exitCode = result.exitCode;
}

void main();
