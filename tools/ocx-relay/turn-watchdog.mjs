// Turn watchdog for Grok Node local-docker boxes: detect stalled bot inference
// and make it visible. v1 is notify-only — it never touches bots or the app.
//
// Two independent stall signals, both derived from files this deployment
// already produces (no app or container modifications):
//   1. forwarder.log  — `POST ... started id=X` lines never followed by a
//      `POST ... -> <code> ... id=X` completion: an inference request is
//      hanging at the upstream.
//   2. container host log vs transcripts — a `spawned worker for agent <id>`
//      line seen recently while that agent's transcript has not been written
//      for TRANSCRIPT_STALL_MS: the bot's turn started but produced nothing.
//
// Alerts go to watchdog-alerts.log, optionally to macOS notifications and to
// ALERT_COMMAND (a shell template with {agent} {name} {message} placeholders,
// e.g. a lark-cli send). Everything is best-effort; the watchdog must never
// crash because a check failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";

const RELAY_DIR = process.env.RELAY_DIR || path.join(os.homedir(), ".grokbot", "ocx-relay");
const FORWARDER_LOG = process.env.FORWARDER_LOG || path.join(RELAY_DIR, "forwarder.log");
const STATE_FILE = process.env.WATCHDOG_STATE || path.join(RELAY_DIR, "watchdog-state.json");
const ALERTS_LOG = process.env.WATCHDOG_ALERTS || path.join(RELAY_DIR, "watchdog-alerts.log");
const DOCKER = process.env.DOCKER || "/usr/local/bin/docker";
const CONTAINER = process.env.CONTAINER || "grok-node-local-vm";
const HOST_LOG = process.env.HOST_LOG || "/tmp/sand-host.log";
const TRANSCRIPT_ROOT = process.env.TRANSCRIPT_ROOT || "/home/box/sand-data/agent-transcripts";
const AGENT_ROOT = process.env.AGENT_ROOT || "/home/box/sand-data/agents";

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS ?? "120000");
const INFLIGHT_STALL_MS = Number(process.env.INFLIGHT_STALL_MS ?? "600000");
const TRANSCRIPT_STALL_MS = Number(process.env.TRANSCRIPT_STALL_MS ?? "1200000");
const SPAWN_WINDOW_MS = Number(process.env.SPAWN_WINDOW_MS ?? "1800000");
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? "1800000");
const LOG_TAIL_BYTES = Number(process.env.LOG_TAIL_BYTES ?? String(256 * 1024));
const RUN_ONCE = process.env.RUN_ONCE === "1";
const MACOS_NOTIFY = process.env.MACOS_NOTIFY !== "0";
const ALERT_COMMAND = process.env.ALERT_COMMAND || "";
const CONTAINER_TIMEOUT_MS = Number(process.env.CONTAINER_TIMEOUT_MS ?? "20000");

const state = loadState();
const nameCache = new Map();

function loadState() {
  const fresh = { hostLogBytes: 0, lastSpawnSeen: {}, lastAlert: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      hostLogBytes: Number(parsed.hostLogBytes ?? 0),
      lastSpawnSeen: parsed.lastSpawnSeen ?? {},
      lastAlert: parsed.lastAlert ?? {},
    };
  } catch {
    return fresh;
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  } catch { /* alerts still fire without persistence */ }
}

function execInContainer(command) {
  return new Promise((resolve, reject) => {
    execFile(DOCKER, ["exec", CONTAINER, "sh", "-c", command], { timeout: CONTAINER_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

function readTail(file, bytes) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return ""; }
  const start = Math.max(0, size - bytes);
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

// Signal 1: started-without-completion lines in the forwarder log.
function checkInflightStalls(now) {
  const tail = readTail(FORWARDER_LOG, LOG_TAIL_BYTES);
  const startedAt = new Map();
  const finished = new Set();
  for (const line of tail.split("\n")) {
    const idMatch = line.match(/\bid=([0-9a-f]{8})\b/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (line.includes(" started ")) {
      const ts = Date.parse(line.slice(0, line.indexOf("Z") + 1));
      if (Number.isFinite(ts)) startedAt.set(id, ts);
    } else if (line.includes(" -> ")) {
      finished.add(id);
    }
  }
  for (const [id, ts] of startedAt) {
    if (finished.has(id)) continue;
    const age = now - ts;
    if (age >= INFLIGHT_STALL_MS) {
      alert(`inflight:${id}`, `有推理请求已挂起 ${Math.round(age / 60000)} 分钟未返回（id=${id}，自 ${new Date(ts).toLocaleTimeString()}）——上游可能限流或挂死。`);
    }
  }
}

// Signal 2: worker spawned recently but the agent transcript went quiet.
async function checkStalledTurns(now) {
  const sizeText = await execInContainer(`wc -c < ${HOST_LOG}`);
  const size = Number(sizeText.trim());
  if (Number.isFinite(size) && size > 0) {
    if (size < state.hostLogBytes) {
      state.hostLogBytes = 0; // log truncated/rotated
    }
    if (state.hostLogBytes === 0) {
      // First sight of this log: baseline only. Replaying history would mark
      // every past spawn as fresh and false-alarm every idle bot.
      state.hostLogBytes = size;
    } else if (size > state.hostLogBytes) {
      const from = state.hostLogBytes + 1;
      const fresh = await execInContainer(`tail -c +${from} ${HOST_LOG}`);
      state.hostLogBytes = size;
      for (const line of fresh.split("\n")) {
        const match = line.match(/spawned worker for agent ([0-9a-f-]{36})/);
        if (match) state.lastSpawnSeen[match[1]] = now;
      }
    }
  }

  const listing = await execInContainer(
    `find ${TRANSCRIPT_ROOT} -mindepth 2 -maxdepth 2 -name '*.jsonl' -printf '%T@ %p\\n' 2>/dev/null`,
  );
  const mtimes = new Map();
  for (const line of listing.split("\n")) {
    const [seconds, file] = line.trim().split(" ");
    if (!seconds || !file) continue;
    const agentId = path.basename(path.dirname(file));
    if (agentId.startsWith("sand-subagent-")) continue;
    mtimes.set(agentId, Number(seconds) * 1000);
  }

  for (const [agentId, seenAt] of Object.entries(state.lastSpawnSeen)) {
    if (now - seenAt > SPAWN_WINDOW_MS) {
      delete state.lastSpawnSeen[agentId];
      continue;
    }
    const mtime = mtimes.get(agentId);
    if (mtime === undefined) continue;
    const silentFor = now - mtime;
    if (silentFor >= TRANSCRIPT_STALL_MS) {
      const name = await agentName(agentId);
      alert(`stall:${agentId}`, `bot「${name}」(${agentId.slice(0, 8)}) 疑似卡死：回合已派出但 transcript 已 ${Math.round(silentFor / 60000)} 分钟无写入（最后活动 ${new Date(mtime).toLocaleString()}）。`, { agent: agentId, name });
    }
  }
}

async function agentName(agentId) {
  if (nameCache.has(agentId)) return nameCache.get(agentId);
  let name = agentId.slice(0, 8);
  try {
    const profile = await execInContainer(`cat ${AGENT_ROOT}/${agentId}/profile.json`);
    const parsed = JSON.parse(profile);
    if (parsed.name) name = parsed.name;
  } catch { /* keep the short id */ }
  nameCache.set(agentId, name);
  return name;
}

// Liveness: if the Mac-side forwarder is down every bot goes silent at once.
function checkForwarderLiveness(now) {
  return new Promise((resolve) => {
    let token = "";
    try { token = fs.readFileSync(path.join(RELAY_DIR, "token"), "utf8").trim(); } catch { /* probe unauthenticated */ }
    const req = http.get(
      { host: "127.0.0.1", port: 11010, path: "/v1/models", headers: token ? { "x-relay-token": token } : {}, timeout: 5000 },
      (res) => {
        res.resume();
        if (res.statusCode !== 200) {
          alert("forwarder-down", `中继 11010 探活异常（HTTP ${res.statusCode}）——所有 bot 推理可能已断。`);
        }
        resolve();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      alert("forwarder-down", `中继 11010 探活超时——所有 bot 推理可能已断（${new Date(now).toLocaleTimeString()}）。`);
      resolve();
    });
    req.on("error", (e) => {
      alert("forwarder-down", `中继 11010 探活失败（${e.message}）——所有 bot 推理可能已断。`);
      resolve();
    });
  });
}

function alert(key, message, fields = {}) {
  const now = Date.now();
  if (now - (state.lastAlert[key] ?? 0) < ALERT_COOLDOWN_MS) return;
  state.lastAlert[key] = now;
  const line = `${new Date(now).toISOString()} [${key}] ${message}`;
  console.log(`ALERT ${line}`);
  try { fs.appendFileSync(ALERTS_LOG, line + "\n"); } catch { /* non-fatal */ }
  if (MACOS_NOTIFY) {
    execFile("osascript", ["-e", `display notification "${message.replace(/["\\]/g, "")}" with title "GrokNode watchdog"`], { timeout: 5000 }, () => {});
  }
  if (ALERT_COMMAND) {
    const command = ALERT_COMMAND
      .replaceAll("{message}", JSON.stringify(message))
      .replaceAll("{agent}", JSON.stringify(fields.agent ?? "unknown"))
      .replaceAll("{name}", JSON.stringify(fields.name ?? fields.agent ?? "unknown"));
    execFile("/bin/zsh", ["-c", command], { timeout: 15000 }, () => {});
  }
}

async function runOnce() {
  const now = Date.now();
  try { checkInflightStalls(now); } catch (e) { console.log(`checkInflightStalls failed: ${e.message}`); }
  try { await checkStalledTurns(now); } catch (e) { console.log(`checkStalledTurns failed: ${e.message}`); }
  await checkForwarderLiveness(now);
  saveState();
}

if (RUN_ONCE) {
  await runOnce();
} else {
  console.log(`${new Date().toISOString()} turn-watchdog started (interval=${INTERVAL_MS}ms, transcript-stall=${TRANSCRIPT_STALL_MS}ms, inflight-stall=${INFLIGHT_STALL_MS}ms)`);
  let loops = 0;
  for (;;) {
    loops += 1;
    await runOnce();
    if (loops % 30 === 0) console.log(`${new Date().toISOString()} heartbeat: ${loops} loops, no crash`);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}
