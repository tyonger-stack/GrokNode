// Turn watchdog for Grok Node local-docker boxes: detect stalled bot inference
// and make it visible. v1 is notify-only — it never touches bots or the app.
//
// Two independent stall signals, both derived from files this deployment
// already produces (no app or container modifications):
//   1. forwarder.log  — `POST ... started id=X` lines never followed by a
//      `POST ... -> <code> ... id=X` completion: an inference request is
//      hanging at the upstream.
//   2. container host log vs transcripts — a `spawned worker for agent <id>`
//      line seen recently while that agent's transcript has had NO write since
//      the spawn sighting (tolerating polling lag): the dispatched turn has
//      produced nothing for TRANSCRIPT_STALL_MS. Silence is measured from the
//      spawn, never from the previous turn's last write — idle time between
//      turns must not read as a stall.
//
// Alerts go to watchdog-alerts.log, optionally to macOS notifications and to
// ALERT_COMMAND (a shell template with {agent} {name} {message} placeholders,
// e.g. a lark-cli send). Everything is best-effort; the watchdog must never
// crash because a check failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile, execFileSync } from "node:child_process";

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
const TRANSCRIPT_STALL_MS = Number(process.env.TRANSCRIPT_STALL_MS ?? "600000");
const SPAWN_WINDOW_MS = Number(process.env.SPAWN_WINDOW_MS ?? "1800000");
const SPAWN_READ_LAG_MS = Number(process.env.SPAWN_READ_LAG_MS ?? "180000");
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? "1800000");
// The repair re-pushes files into the box and restarts its relay, so it gets
// its own budget: a rebuild plus probe has to fit well inside the check
// interval, and a failed attempt must not be retried on the very next loop.
const REPAIR_COOLDOWN_MS = Number(process.env.REPAIR_COOLDOWN_MS ?? String(ALERT_COOLDOWN_MS));
const REPAIR_TIMEOUT_MS = Number(process.env.REPAIR_TIMEOUT_MS ?? "90000");
const REPAIR_SCRIPT = process.env.REPAIR_SCRIPT || path.join(RELAY_DIR, "container-relay-push.sh");
const LOG_TAIL_BYTES = Number(process.env.LOG_TAIL_BYTES ?? String(256 * 1024));
const RUN_ONCE = process.env.RUN_ONCE === "1";
const MACOS_NOTIFY = process.env.MACOS_NOTIFY !== "0";
const ALERT_COMMAND = process.env.ALERT_COMMAND || "";
const CONTAINER_TIMEOUT_MS = Number(process.env.CONTAINER_TIMEOUT_MS ?? "20000");
// Clickable notifications: terminal-notifier opens the alerts log on click.
// Bare `osascript display notification` posts get attributed to Script
// Editor, whose click action only opens a blank untitled document — no way
// through to the details. Resolved once at startup; osascript stays as the
// fallback when the binary is absent.
const NOTIFIER_BIN = [
  "/opt/homebrew/bin/terminal-notifier",
  "/usr/local/bin/terminal-notifier",
].find((candidate) => fs.existsSync(candidate));

const state = loadState();
const nameCache = new Map();

function loadState() {
  const fresh = { hostLogBytes: 0, lastSpawnSeen: {}, lastAlert: {}, lastRepair: {} };
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

// The relay token travels in a shell command inside these checks, and
// execFile's error message quotes the whole command back. Anything that
// reaches an alert line, the alerts log or a notification has to be scrubbed
// first, or a failed probe publishes the token.
function redactSecrets(text) {
  return String(text).replace(/x-relay-token:\s*[^\s'"]+/gi, "x-relay-token: <redacted>");
}

function execInContainer(command) {
  return new Promise((resolve, reject) => {
    execFile(DOCKER, ["exec", CONTAINER, "sh", "-c", command], { timeout: CONTAINER_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) reject(new Error(redactSecrets(String(stderr || error.message).trim())));
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
    if (line.includes("relay listening")) {
      // Forwarder (re)start: every request still marked in-flight belonged to
      // the previous process, which died without ever logging their terminal
      // lines (the 2026-09-26 22:17 restart left started-only entries that
      // re-alerted forever). Those terminal lines will never appear - drop
      // the ghosts instead of tracking them.
      startedAt.clear();
      finished.clear();
      continue;
    }
    const idMatch = line.match(/\bid=([0-9a-f]{8})\b/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (line.includes(" started ")) {
      const ts = Date.parse(line.slice(0, line.indexOf("Z") + 1));
      if (Number.isFinite(ts)) startedAt.set(id, ts);
    } else if (line.includes(" retry ")) {
      // re-dispatch of the same id; still in flight, keep the original start
    } else {
      // any other terminal line for this id (-> code, upstream-error, ...)
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
    // The dispatched turn produced output: its transcript write landed at or
    // after the spawn sighting (within the polling-lag tolerance). Healthy —
    // stop tracking so a completed turn followed by idle time never alerts.
    if (mtime >= seenAt - SPAWN_READ_LAG_MS) {
      delete state.lastSpawnSeen[agentId];
      continue;
    }
    // Stall: the turn dispatched at seenAt has produced NOTHING for
    // TRANSCRIPT_STALL_MS, measured from the spawn sighting. v1 measured
    // silence from the previous transcript write, which is usually idle time
    // BEFORE the turn — that made every routine wake-up on an idle bot look
    // like a 60+ minute stall (the 2026-09-26 false-alarm storm).
    const turnAge = now - seenAt;
    if (turnAge >= TRANSCRIPT_STALL_MS) {
      const name = await agentName(agentId);
      alert(`stall:${agentId}`, `bot「${name}」(${agentId.slice(0, 8)}) 疑似卡死：回合派出后 ${Math.round(turnAge / 60000)} 分钟 transcript 零写入（该 bot 最后一次写入 ${new Date(mtime).toLocaleString()}，早于本回合派出）。`, { agent: agentId, name });
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

// The Mac address the container relay has to dial. It comes from DHCP and has
// already moved once, and the platform bakes its own value into the relay it
// launches — so it is re-derived from the live interface on every repair
// rather than trusted from any stored configuration.
function currentMacAddress() {
  // /sbin/ipconfig does not exist on this macOS; the binary lives in
  // /usr/sbin. Try the absolute path first, then fall back to a PATH lookup so
  // a future layout change degrades to a warning rather than a silent no-op.
  for (const binary of ["/usr/sbin/ipconfig", "ipconfig"]) {
    for (const iface of ["en0", "en1"]) {
      try {
        const out = execFileSync(binary, ["getifaddr", iface], { encoding: "utf8", timeout: 5000 }).trim();
        if (out) return out;
      } catch { /* binary or interface not present */ }
    }
  }
  return "";
}

function relayToken() {
  try { return fs.readFileSync(path.join(RELAY_DIR, "token"), "utf8").trim(); } catch { return ""; }
}

async function probeContainerRelay() {
  const token = relayToken();
  const auth = token ? ` -H 'x-relay-token: ${token.replace(/'/g, "'\\''")}'` : "";
  try {
    const code = (await execInContainer(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 10${auth} http://127.0.0.1:10100/v1/models`,
    )).trim();
    return { ok: code === "200", code: code || "无响应" };
  } catch (e) {
    return { ok: false, code: `探活失败：${e.message}` };
  }
}

// The one self-healing action in the watchdog. It re-pushes the container
// relay against the Mac address that is actually current, which covers both
// causes seen in the field: a container rebuild restoring the stock relay on a
// stale address, and the Mac simply moving. It never touches a bot.
// container-relay-push.sh is idempotent — backs up, copies, restarts, probes
// with the real token and exits non-zero on failure — so a bad attempt is
// visible in the log rather than silent.
async function repairContainerRelay(now) {
  const key = "container-relay";
  if (now - (state.lastRepair?.[key] ?? 0) < REPAIR_COOLDOWN_MS) {
    return { attempted: false, ok: false, detail: `距上次自愈不足 ${Math.round(REPAIR_COOLDOWN_MS / 60000)} 分钟，本轮不再尝试` };
  }
  const address = currentMacAddress();
  if (!address) {
    return { attempted: false, ok: false, detail: "取不到本机 en0/en1 地址，无法确定上游（网络未就绪？）" };
  }
  state.lastRepair = { ...(state.lastRepair ?? {}), [key]: now };
  console.log(`${new Date(now).toISOString()} repairing container relay -> ${address} via ${REPAIR_SCRIPT}`);
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile("/bin/zsh", [REPAIR_SCRIPT], {
        timeout: REPAIR_TIMEOUT_MS,
        env: { ...process.env, RELAY_UPSTREAM_HOST: address },
      }, (error, out, err) => error ? reject(new Error(redactSecrets(String(err || error.message).trim()))) : resolve(out));
    });
    const lines = stdout.trim().split("\n");
    return { attempted: true, ok: true, detail: lines[lines.length - 1] || "中继已重建" };
  } catch (e) {
    return { attempted: true, ok: false, detail: e.message };
  }
}

async function checkContainerRelayLiveness(now) {
  const first = await probeContainerRelay();
  if (first.ok) return;
  console.log(`${new Date(now).toISOString()} container hop probe failed (${first.code}); attempting repair`);
  const repair = await repairContainerRelay(now);
  if (repair.attempted) {
    const again = await probeContainerRelay();
    if (again.ok) {
      console.log(`${new Date(now).toISOString()} container hop self-healed: ${repair.detail}`);
      return;
    }
    alert(
      "container-relay-down",
      `容器内 10100 探活仍失败（${again.code}）——bot 回合会卡在这一跳。已尝试自愈但未成功：${repair.detail}`,
    );
    return;
  }
  alert(
    "container-relay-down",
    `容器内 10100 探活失败（${first.code}）——bot 回合会卡在这一跳。未执行自愈：${repair.detail}`
      + `手工执行：RELAY_UPSTREAM_HOST="$(ipconfig getifaddr en0)" ${REPAIR_SCRIPT}`,
  );
}

function osascriptNotify(message) {
  execFile("osascript", ["-e", `display notification "${message.replace(/["\\]/g, "")}" with title "GrokNode watchdog"`], { timeout: 5000 }, () => {});
}

function notifyMacOS(message) {
  // macOS 26 denies terminal-notifier's permission request outright (tested:
  // exit 3), so osascript stays the working sender and every notification
  // carries the details path in its body - Notification Center shows the full
  // text even when the banner truncates. If terminal-notifier is ever
  // permitted, its -open makes the click jump straight to the alerts log.
  const withPointer = `${message}\n详情: ${ALERTS_LOG}`;
  if (NOTIFIER_BIN) {
    execFile(
      NOTIFIER_BIN,
      ["-title", "GrokNode watchdog", "-message", withPointer, "-group", "groknode.watchdog", "-open", `file://${ALERTS_LOG}`],
      { timeout: 5000 },
      (error) => {
        if (error) osascriptNotify(withPointer);
      },
    );
    return;
  }
  osascriptNotify(withPointer);
}

function alert(key, message, fields = {}) {
  const now = Date.now();
  if (now - (state.lastAlert[key] ?? 0) < ALERT_COOLDOWN_MS) return;
  state.lastAlert[key] = now;
  const line = `${new Date(now).toISOString()} [${key}] ${message}`;
  console.log(`ALERT ${line}`);
  try { fs.appendFileSync(ALERTS_LOG, line + "\n"); } catch { /* non-fatal */ }
  if (MACOS_NOTIFY) notifyMacOS(message);
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
  try { await checkContainerRelayLiveness(now); } catch (e) { console.log(`checkContainerRelayLiveness failed: ${e.message}`); }
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
