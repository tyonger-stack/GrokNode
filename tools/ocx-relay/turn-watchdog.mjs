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
// A repair that FAILED must not silence the self-heal for the full cooldown.
// 2026-09-28: the repair ran inside a WiFi-switch window, read a link-local
// address, pushed it, failed — and still stamped lastRepair, so the next five
// probe cycles (12 minutes of dead bots) were skipped by the cooldown without a
// word. The long cooldown now applies only to repairs that actually worked,
// where re-pushing would be pure churn; a failure costs two intervals.
const REPAIR_RETRY_COOLDOWN_MS = Number(process.env.REPAIR_RETRY_COOLDOWN_MS ?? String(INTERVAL_MS * 2));
const REPAIR_TIMEOUT_MS = Number(process.env.REPAIR_TIMEOUT_MS ?? "90000");
const REPAIR_SCRIPT = process.env.REPAIR_SCRIPT || path.join(RELAY_DIR, "container-relay-push.sh");
// 2026-09-28: the DHCP-drift class is dead upstream — `host.internal` is
// OrbStack's built-in host name, resolves inside the box to a network-independent
// address and reaches the Mac forwarder directly (verified HTTP 200 in ~0.1s).
// The en0 derivation below is only the fallback for the day OrbStack changes it.
const STABLE_UPSTREAM = process.env.STABLE_UPSTREAM ?? "host.internal";
// Host-wedge auto-remediation (2026-09-28 third incident): turns can wedge
// INSIDE the container host process — re-dispatched workers never even open a
// socket to the relay (zero forwarder POSTs, zero transcript writes, no error,
// forever), and only killing host-main.cjs clears it; sand-supervisor respawns
// the host in ~16s. Signature: several freshly-spawned agents stalled AND no
// in-flight inference AND no forwarder traffic for the same window AND the
// relay hop healthy (a broken relay is the repair path's problem, and killing
// the host would not fix it anyway).
const HOST_RESTART_ENABLED = process.env.HOST_RESTART_ENABLED !== "0";
const HOST_WEDGE_MIN_AGENTS = Number(process.env.HOST_WEDGE_MIN_AGENTS ?? "2");
const HOST_WEDGE_STALL_MS = Number(process.env.HOST_WEDGE_STALL_MS ?? String(TRANSCRIPT_STALL_MS));
const HOST_RESTART_COOLDOWN_MS = Number(process.env.HOST_RESTART_COOLDOWN_MS ?? "1800000");
const HOST_RESTART_RETRY_COOLDOWN_MS = Number(process.env.HOST_RESTART_RETRY_COOLDOWN_MS ?? String(INTERVAL_MS * 2));
const HOST_RESTART_RESPAWN_MS = Number(process.env.HOST_RESTART_RESPAWN_MS ?? "25000");
// Post-restart canary: wake one webhook bot with a selftest payload and expect
// a transcript write within CANARY_VERIFY_MS. This is the only probe that
// exercises the full run-queue path (spawn -> inference -> transcript) —
// /v1/models probes stay green through a wedged host.
const CANARY_AGENT = process.env.CANARY_AGENT || "70e22ee1-4b23-4860-a598-9e39f47ddc19";
const CANARY_ROUTINE = process.env.CANARY_ROUTINE || "feishu-p2p";
const CANARY_PORT = Number(process.env.CANARY_PORT ?? "17901");
// 10 minutes, not less: a busy agent's canary can legitimately queue behind
// a long turn, and a too-tight window would report a healthy recovery as a
// failed one.
const CANARY_VERIFY_MS = Number(process.env.CANARY_VERIFY_MS ?? "600000");
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
  const fresh = { hostLogBytes: 0, lastSpawnSeen: {}, lastAlert: {}, lastRepair: {}, lastRepairOk: {}, lastHostRestart: {}, canary: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      hostLogBytes: Number(parsed.hostLogBytes ?? 0),
      lastSpawnSeen: parsed.lastSpawnSeen ?? {},
      lastAlert: parsed.lastAlert ?? {},
      // Repair/restart cooldown state has to survive a watchdog restart, or a
      // crash-looping watchdog re-fires the (heavy) self-heal every start.
      lastRepair: parsed.lastRepair ?? {},
      lastRepairOk: parsed.lastRepairOk ?? {},
      lastHostRestart: parsed.lastHostRestart ?? {},
      canary: parsed.canary ?? null,
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
// Also records system-wide inference activity for the host-wedge check: a
// wedged host produces neither in-flight requests nor fresh POST lines, while
// a healthy-but-slow system shows at least an open `started` entry.
const forwarderActivity = { inflight: 0, lastPostAt: 0 };
function checkInflightStalls(now) {
  const tail = readTail(FORWARDER_LOG, LOG_TAIL_BYTES);
  const startedAt = new Map();
  const finished = new Set();
  let lastPostAt = 0;
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
      if (Number.isFinite(ts)) {
        startedAt.set(id, ts);
        lastPostAt = Math.max(lastPostAt, ts);
      }
    } else if (line.includes(" retry ")) {
      // re-dispatch of the same id; still in flight, keep the original start
      const retryTs = Date.parse(line.slice(0, line.indexOf("Z") + 1));
      if (Number.isFinite(retryTs)) lastPostAt = Math.max(lastPostAt, retryTs);
    } else {
      // any other terminal line for this id (-> code, upstream-error, ...)
      finished.add(id);
      const doneTs = Date.parse(line.slice(0, line.indexOf("Z") + 1));
      if (Number.isFinite(doneTs)) lastPostAt = Math.max(lastPostAt, doneTs);
    }
  }
  forwarderActivity.inflight = [...startedAt.keys()].filter((id) => !finished.has(id)).length;
  forwarderActivity.lastPostAt = lastPostAt;
  for (const [id, ts] of startedAt) {
    if (finished.has(id)) continue;
    const age = now - ts;
    if (age >= INFLIGHT_STALL_MS) {
      alert(`inflight:${id}`, `有推理请求已挂起 ${Math.round(age / 60000)} 分钟未返回（id=${id}，自 ${new Date(ts).toLocaleTimeString()}）——上游可能限流或挂死。`);
    }
  }
}

// Signal 2: worker spawned recently but the agent transcript went quiet.
// The per-agent stall findings are also collected for the systemic host-wedge
// check below (several stalled spawns + zero forwarder traffic = the host
// process itself is wedged, not just one slow bot).
const stallReport = [];
let lastTranscriptMtimes = new Map();
async function checkStalledTurns(now) {
  stallReport.length = 0;
  // Stale mtimes would let the canary verdict read a pre-restart write as
  // post-restart proof; if this round cannot read them, carry none forward.
  lastTranscriptMtimes = new Map();
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
        // Record the spawn sighting together with the transcript's mtime at
        // that moment: health is judged against writes NEWER than the spawn,
        // never against the previous turn's tail sitting under the same file.
        if (match) state.lastSpawnSeen[match[1]] = { seenAt: now, baselineMtime: -1 };
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
    // An agent dir can hold more than one jsonl (rotation); the agent is as
    // fresh as its NEWEST file, so keep the max instead of whatever find
    // happens to list last.
    const ts = Number(seconds) * 1000;
    mtimes.set(agentId, Math.max(mtimes.get(agentId) ?? 0, ts));
  }
  lastTranscriptMtimes = mtimes;

  for (const [agentId, tracked] of Object.entries(state.lastSpawnSeen)) {
    const { seenAt, baselineMtime } =
      typeof tracked === "number"
        ? { seenAt: tracked, baselineMtime: -1 }
        : { seenAt: tracked.seenAt ?? 0, baselineMtime: tracked.baselineMtime ?? -1 };
    if (now - seenAt > SPAWN_WINDOW_MS) {
      delete state.lastSpawnSeen[agentId];
      continue;
    }
    const mtime = mtimes.get(agentId);
    if (mtime === undefined) {
      // A spawned agent with NO transcript file at all is the most wedged
      // shape there is (dispatch without even a first write). Previously it
      // was skipped silently and never entered the wedge count; now it
      // counts with a stale epoch so a never-written turn still trips the
      // stall timer from its spawn sighting.
      const turnAge = now - seenAt;
      if (turnAge >= TRANSCRIPT_STALL_MS) {
        const name = await agentName(agentId);
        stallReport.push({ agentId, seenAt, turnAge, noTranscript: true });
        alert(`stall:${agentId}`, `bot「${name}」(${agentId.slice(0, 8)}) 疑似卡死：回合派出后 ${Math.round(turnAge / 60000)} 分钟且从未产生 transcript 文件。`, { agent: agentId, name });
      }
      continue;
    }
    // First sight of this tracking entry: pin the current mtime as the
    // baseline. A write the spawn already saw is the previous turn's tail.
    const record = typeof tracked === "number" || baselineMtime < 0
      ? { seenAt, baselineMtime: mtime }
      : { seenAt, baselineMtime };
    state.lastSpawnSeen[agentId] = record;
    // Healthy only when the transcript moved past the spawn-time baseline:
    // any write newer than what the spawn already saw is this turn's output.
    // (Older readings tolerated the polling lag by accepting the tail; that
    // acceptance is exactly what hid a wedged turn on a busy bot.)
    if (mtime > record.baselineMtime) {
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
      stallReport.push({ agentId, seenAt, turnAge });
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
// already moved twice, and the platform bakes its own value into the relay it
// launches — so it is re-derived from the live interface on every repair
// rather than trusted from any stored configuration.
//
// Validating it is not optional. `ipconfig getifaddr` answers with whatever the
// interface currently holds, and during a WiFi switch that is briefly a
// self-assigned link-local 169.254.x address before DHCP completes. On
// 2026-09-28 the self-heal ran inside exactly that window, read 169.254.10.9
// and pushed it as the relay upstream; the relay then dialled an address that
// accepts TCP and swallows every byte, so every bot turn hung at "model
// provider did not start responding within 150s". A non-empty string from
// ipconfig is not a routable address, and the one moment this value is most
// needed is the one moment it is least trustworthy.
function isRoutableAddress(value) {
  const parts = String(value).trim().split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return false;
  const [first, second] = octets;
  if (first === 0 || first === 127) return false;      // unspecified / loopback
  if (first === 169 && second === 254) return false;   // link-local autoconfig
  if (first >= 224) return false;                      // multicast + broadcast
  return true;
}

function currentMacAddress() {
  // /sbin/ipconfig does not exist on this macOS; the binary lives in
  // /usr/sbin. Try the absolute path first, then fall back to a PATH lookup so
  // a future layout change degrades to a warning rather than a silent no-op.
  const rejected = [];
  for (const binary of ["/usr/sbin/ipconfig", "ipconfig"]) {
    for (const iface of ["en0", "en1"]) {
      try {
        const out = execFileSync(binary, ["getifaddr", iface], { encoding: "utf8", timeout: 5000 }).trim();
        if (!out) continue;
        if (isRoutableAddress(out)) return out;
        rejected.push(`${iface}=${out}`);
      } catch { /* binary or interface not present */ }
    }
  }
  if (rejected.length) {
    console.log(`skipping non-routable Mac address from ipconfig: ${rejected.join(", ")} (link-local autoconfig during a network switch)`);
  }
  return "";
}

function relayToken() {
  try { return fs.readFileSync(path.join(RELAY_DIR, "token"), "utf8").trim(); } catch { return ""; }
}

// Does the stable OrbStack host name actually reach the Mac forwarder from
// inside the box right now? Verified live on 2026-09-28; re-checked at repair
// time so a future OrbStack networking change degrades to the en0 fallback
// instead of pushing a dead name into the relay.
async function stableUpstreamReachable() {
  const token = relayToken();
  const auth = token ? ` -H 'x-relay-token: ${token.replace(/'/g, "'\\''")}'` : "";
  try {
    const code = (await execInContainer(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 8${auth} http://${STABLE_UPSTREAM}:11010/v1/models`,
    )).trim();
    return code === "200";
  } catch {
    return false;
  }
}

// The upstream the running container relay currently dials, read from its own
// environment. Used to normalize a freshly (re)built container: the platform
// bakes a DHCP-derived address into its relay, which works until the next
// network switch — normalizing it to the stable name the moment we see it
// removes that time bomb even while the probe is still green.
async function relayUpstreamEnv() {
  try {
    const out = await execInContainer(
      `pid=$(cat /tmp/ocx-relay.pid 2>/dev/null); [ -n "$pid" ] && tr '\\0' '\\n' < /proc/$pid/environ | sed -n 's/^RELAY_UPSTREAM_HOST=//p'`,
    );
    return out.trim();
  } catch {
    return "";
  }
}

async function probeContainerRelay() {
  const token = relayToken();
  const auth = token ? ` -H 'x-relay-token: ${token.replace(/'/g, "'\\''")}'` : "";
  try {
    const code = (await execInContainer(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 10${auth} http://127.0.0.1:10100/v1/models`,
    )).trim();
    // 403 is an auth mismatch, not a broken hop: the Mac-side token file was
    // rotated while the running relay still carries the old one (the push
    // script reuses the old relay's environ). Rebuilding the relay on a 403
    // treats the wrong disease; the cure is re-pushing with the CURRENT
    // token, which the repair path now does unconditionally.
    return { ok: code === "200", code: code || "无响应", authMismatch: code === "403" };
  } catch (e) {
    return { ok: false, code: `探活失败：${e.message}`, authMismatch: false };
  }
}

// The one self-healing action in the watchdog. It re-pushes the container
// relay against the Mac address that is actually current, which covers both
// causes seen in the field: a container rebuild restoring the stock relay on a
// stale address, and the Mac simply moving. It never touches a bot.
// container-relay-push.sh is idempotent — backs up, copies, restarts, probes
// with the real token and exits non-zero on failure — so a bad attempt is
// visible in the log rather than silent.
async function repairContainerRelay(now, key = "container-relay") {
  const lastAttempt = state.lastRepair?.[key] ?? 0;
  const lastSucceeded = state.lastRepairOk?.[key] === true;
  const cooldown = lastSucceeded ? REPAIR_COOLDOWN_MS : REPAIR_RETRY_COOLDOWN_MS;
  if (now - lastAttempt < cooldown) {
    return {
      attempted: false,
      ok: false,
      detail: `距上次${lastSucceeded ? "成功" : "失败"}自愈不足 ${Math.max(1, Math.round(cooldown / 60000))} 分钟，本轮不再尝试`,
    };
  }
  // Prefer the WiFi-independent OrbStack host name; en0 is only the fallback
  // for the day that name stops resolving. Both paths validate before use —
  // the DHCP window where en0 briefly holds a 169.254 link-local address is
  // exactly when a repair would otherwise poison the relay again.
  let address = "";
  let source = "";
  if (await stableUpstreamReachable()) {
    address = STABLE_UPSTREAM;
    source = "稳定主机名";
  } else {
    const en0 = currentMacAddress();
    if (en0) {
      address = en0;
      source = "en0 现场 IP（稳定主机名不可达，已回退）";
    }
  }
  if (!address) {
    return { attempted: false, ok: false, detail: `稳定主机名 ${STABLE_UPSTREAM} 与本机 en0/en1 均不可达，无法确定上游（网络未就绪？）` };
  }
  // Stamp before the attempt so a repair that hangs past REPAIR_TIMEOUT_MS is
  // not retried on the very next loop, but only as a *failed* one; the long
  // cooldown is earned by an attempt that is known to have worked.
  state.lastRepair = { ...(state.lastRepair ?? {}), [key]: now };
  state.lastRepairOk = { ...(state.lastRepairOk ?? {}), [key]: false };
  console.log(`${new Date(now).toISOString()} repairing container relay -> ${address} (${source}) via ${REPAIR_SCRIPT}`);
  // Always hand the CURRENT Mac-side token to the push script (the forwarder
  // compares against the token file live): the old relay's environ token may
  // be the very credential a 403 just told us is stale.
  const currentToken = relayToken();
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile("/bin/zsh", [REPAIR_SCRIPT], {
        timeout: REPAIR_TIMEOUT_MS,
        env: { ...process.env, RELAY_UPSTREAM_HOST: address, RELAY_TOKEN_OVERRIDE: currentToken },
      }, (error, out, err) => error ? reject(new Error(redactSecrets(String(err || error.message).trim()))) : resolve(out));
    });
    state.lastRepairOk = { ...state.lastRepairOk, [key]: true };
    const lines = stdout.trim().split("\n");
    return { attempted: true, ok: true, detail: lines[lines.length - 1] || "中继已重建" };
  } catch (e) {
    return { attempted: true, ok: false, detail: e.message };
  }
}

async function checkContainerRelayLiveness(now) {
  const first = await probeContainerRelay();
  if (first.ok) {
    // Probe green is not the whole story: after a container rebuild the
    // platform relaunches the relay with a DHCP-derived address baked in. That
    // address happens to work right now and dies on the next network switch —
    // the exact 2026-09-28 incident shape. Normalize it to the stable name
    // while it still works, so the switch never gets a chance to bite.
    const upstream = await relayUpstreamEnv();
    if (upstream && upstream !== STABLE_UPSTREAM) {
      // Its own cooldown key on purpose: normalization is preventive (the
      // probe is green, the upstream is merely a landmine), while the
      // repair cooldown is earned by fixing an outage and is deliberately
      // long. Sharing one key let a successful repair silence normalization
      // for 30 minutes - exactly the window in which a freshly rebuilt
      // container would sit on a DHCP address waiting for the next network
      // switch to kill every bot.
      const repair = await repairContainerRelay(now, "container-relay-normalize");
      if (repair.attempted && repair.ok) {
        console.log(`${new Date(now).toISOString()} normalized relay upstream ${upstream} -> ${STABLE_UPSTREAM}`);
      } else if (repair.attempted) {
        console.log(`${new Date(now).toISOString()} relay upstream normalization failed (${repair.detail}); probe stays green on ${upstream}`);
      } else {
        console.log(`${new Date(now).toISOString()} relay upstream ${upstream} still wants normalizing to ${STABLE_UPSTREAM}, deferred: ${repair.detail}`);
      }
    }
    return;
  }
  console.log(`${new Date(now).toISOString()} container hop probe failed (${first.code}); attempting repair`);
  const repair = first.authMismatch
    ? await repairContainerRelay(now, "container-relay-token")
    : await repairContainerRelay(now);
  if (repair.attempted) {
    const again = await probeContainerRelay();
    if (again.ok) {
      console.log(`${new Date(now).toISOString()} container hop self-healed${first.authMismatch ? " (token re-synced)" : ""}: ${repair.detail}`);
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
    + `手工执行：RELAY_UPSTREAM_HOST="${STABLE_UPSTREAM}" ${REPAIR_SCRIPT}`,
  );
}

// ---------------------------------------------------------------------------
// Host-wedge remediation (2026-09-28 third incident). Turns can wedge INSIDE
// the container host process: re-dispatched workers never open a socket to the
// relay (zero POSTs at the forwarder, zero transcript writes, no error, the
// retry engine cycles them forever). Nothing below the host process can see or
// fix that — but the host is supervised by sand-supervisor, so a TERM is a
// ~16s respawn that clears the wedge. The signature below is deliberately
// systemic so one slow bot can never trigger it.
async function restartHostProcess() {
  // `[.]` keeps pgrep's own `sh -c` carrier (whose cmdline contains the
  // bracketed pattern literally) from matching itself; `| head -1` makes the
  // pipeline exit 0 even when pgrep finds nothing, and kill failures (process
  // already gone) must not reject the whole restart path.
  const pidBefore = (await execInContainer(`pgrep -f 'host-main[.]cjs' | head -1`)).trim();
  // pgrep output goes straight into a kill command: demand a bare pid
  // (digits only) before trusting it, or a poisoned container could smuggle
  // a shell fragment into the kill line.
  if (!/^\d+$/.test(pidBefore)) {
    return { ok: false, detail: `容器内 host pid 非法（pgrep 返回 "${pidBefore.slice(0, 64)}"）——拒绝拼接执行` };
  }
  await execInContainer(`kill -TERM ${pidBefore} 2>/dev/null || true`);
  await new Promise((resolve) => setTimeout(resolve, HOST_RESTART_RESPAWN_MS));
  const pidAfter = (await execInContainer(`pgrep -f 'host-main[.]cjs' | head -1`)).trim();
  if (!pidAfter || pidAfter === pidBefore) {
    return { ok: false, detail: `TERM 后 ${Math.round(HOST_RESTART_RESPAWN_MS / 1000)}s 内未见重生（旧 pid=${pidBefore}，新 pid=${pidAfter || "无"}）——sand-supervisor 可能没有接管，需要人工检查容器` };
  }
  return { ok: true, detail: `host pid ${pidBefore} -> ${pidAfter}（sand-supervisor 已重生）` };
}

// Fire the webhook wake used to verify (and if needed re-kick) the run queue.
// Same contract the feishu ingress delivers: flat JSON + selftest flag so the
// routine runs its turn but never sends a real Feishu reply.
function sendCanaryWake(agentId, nowMs) {
  return new Promise((resolve) => {
    const keyPromise = execInContainer(
      `cat ${AGENT_ROOT}/${agentId}/automations/${CANARY_ROUTINE}/webhook.json`,
    )
      .then((out) => JSON.parse(out).key)
      .catch(() => "");
    keyPromise.then((key) => {
      if (!key) return resolve(false);
      const payload = JSON.stringify({
        message_id: `canary-${nowMs}`,
        chat_id: "selftest",
        chat_type: "p2p",
        sender_type: "user",
        sender_id: "watchdog",
        message_type: "text",
        content: "selftest: reply hi",
        text: "selftest: reply hi",
        create_time: nowMs,
        source: "watchdog-hostrestart",
        selftest: true,
      });
      const req = http.request(
        {
          host: "127.0.0.1",
          port: CANARY_PORT,
          path: `/webhook/${agentId}/${CANARY_ROUTINE}`,
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
          timeout: 8000,
        },
        (res) => { res.resume(); resolve(res.statusCode !== undefined && res.statusCode < 500); },
      );
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.on("error", () => resolve(false));
      req.end(payload);
    });
  });
}

async function checkHostWedge(now) {
  if (!HOST_RESTART_ENABLED) return;
  // Verify the previous restart's canary first — a wake that never produced a
  // transcript write means the run queue is still stuck after a respawn, which
  // deserves a (very loud) human look rather than another blind restart.
  if (state.canary && state.canary.agentId) {
    const mtime = lastTranscriptMtimes.get(state.canary.agentId);
    // The mtime comes from the container clock and sentAt from the Mac
    // clock; demand a full tolerance window of fresh writes, not a bare
    // equal timestamp crossing two unsynchronized clocks.
    const SKEW_TOLERANCE_MS = 120_000;
    if (mtime !== undefined && mtime >= state.canary.sentAt + SKEW_TOLERANCE_MS) {
      console.log(`${new Date(now).toISOString()} canary ok: ${state.canary.agentId.slice(0, 8)} wrote after restart`);
      state.canary = null;
    } else if (now - state.canary.sentAt >= CANARY_VERIFY_MS) {
      alert(
        "host-restart-canary-failed",
        `host 重启后自检唤醒 ${Math.round((now - state.canary.sentAt) / 60000)} 分钟仍无 transcript 写入——run 队列可能仍未恢复，需要人工排查（重启不能治的僵死）。`,
      );
      state.canary = null;
    } else {
      return; // canary verdict pending; never stack a second restart on top
    }
  }

  const key = "host-main";
  const record = state.lastHostRestart?.[key];
  const lastAttempt = record?.at ?? 0;
  const lastSucceeded = record?.ok === true;
  const cooldown = lastSucceeded ? HOST_RESTART_COOLDOWN_MS : HOST_RESTART_RETRY_COOLDOWN_MS;
  if (now - lastAttempt < cooldown) return;

  const stalledLong = stallReport.filter((entry) => entry.turnAge >= HOST_WEDGE_STALL_MS);
  if (stalledLong.length < HOST_WEDGE_MIN_AGENTS) return;
  if (forwarderActivity.inflight > 0) return; // something IS inferring — slow, not wedged
  if (forwarderActivity.lastPostAt > 0 && now - forwarderActivity.lastPostAt < HOST_WEDGE_STALL_MS) return;
  // A broken relay hop mimics this signature; that is the repair path's case
  // and a host restart would not fix it. Only act when the hop is healthy.
  const relay = await probeContainerRelay();
  if (!relay.ok) {
    console.log(`${new Date(now).toISOString()} host-wedge signature present but relay hop unhealthy (${relay.code}); leaving it to the relay repair path`);
    return;
  }

  const names = stalledLong.slice(0, 4).map((entry) => entry.agentId.slice(0, 8)).join(", ");
  console.log(`${new Date(now).toISOString()} host-wedge signature: ${stalledLong.length} stalled spawns (${names}), 0 in-flight, no POST traffic ${Math.round(HOST_WEDGE_STALL_MS / 60000)}+ min, relay ok -> restarting host`);
  state.lastHostRestart = { ...(state.lastHostRestart ?? {}), [key]: { at: now, ok: false } };
  const result = await restartHostProcess();
  state.lastHostRestart = { ...(state.lastHostRestart ?? {}), [key]: { at: now, ok: result.ok, detail: redactSecrets(result.detail) } };
  if (CANARY_AGENT && result.ok) {
    const sent = await sendCanaryWake(CANARY_AGENT, now);
    state.canary = sent ? { agentId: CANARY_AGENT, sentAt: now } : null;
    if (!sent) console.log(`${new Date(now).toISOString()} canary wake not sent (webhook key missing or app listener down)`);
  }
  // The alert must tell the truth about what happened: a failed restart is
  // a different incident from a completed one, and claiming a restart that
  // never ran sends the human down the wrong path.
  if (result.ok) {
    alert(
      "host-wedge-restarted",
      `检测到 host 进程僵死（${stalledLong.length} 个 bot 回合派出后 ${Math.round(HOST_WEDGE_STALL_MS / 60000)}+ 分钟零推理零写入、无 in-flight 请求、中继正常）——已自动重启容器内 host：${result.detail}${state.canary ? "，并已发自检唤醒验证恢复。" : "。"}僵死回合不会自动恢复，相关消息需要重发。`,
    );
  } else {
    alert(
      "host-wedge-restart-failed",
      `检测到 host 进程僵死（${stalledLong.length} 个 bot 回合派出后 ${Math.round(HOST_WEDGE_STALL_MS / 60000)}+ 分钟零推理零写入、无 in-flight 请求、中继正常），但自动重启失败：${result.detail}——需要人工处理容器内 host。`,
    );
  }
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
    // Security: fields.agent/name arrive from the container (profile.json),
    // so they must NEVER be interpolated into a shell string — a bot named
    // `$(curl …)` would execute on the Mac. Pass values via argv/env on the
    // expanded template; keep the template itself a static operator string.
    // {message} {agent} {name} are substituted with sanitized id-safe tokens.
    const safe = (value) => String(value ?? "unknown").replace(/[^\w.:/-]/g, "_").slice(0, 128);
    const parts = [ALERT_COMMAND, safe(key), safe(message).slice(0, 512), safe(fields.agent), safe(fields.name ?? fields.agent)];
    execFile("/bin/zsh", ["-c", '"$0" "$1" "$2" "$3" "$4"', ...parts], { timeout: 15000 }, () => {});
  }
}

async function runOnce() {
  const now = Date.now();
  try { checkInflightStalls(now); } catch (e) { console.log(`checkInflightStalls failed: ${e.message}`); }
  try { await checkStalledTurns(now); } catch (e) { console.log(`checkStalledTurns failed: ${e.message}`); }
  // Order matters: the wedge check consumes stallReport (from stalled turns)
  // and forwarderActivity (from inflight), so it must run after both — and it
  // takes the relay probe itself, so it also has to be robust to its failure.
  try { await checkHostWedge(now); } catch (e) { console.log(`checkHostWedge failed: ${e.message}`); }
  try { await checkForwarderLiveness(now); } catch (e) { console.log(`checkForwarderLiveness failed: ${e.message}`); }
  try { await checkContainerRelayLiveness(now); } catch (e) { console.log(`checkContainerRelayLiveness failed: ${e.message}`); }
  saveState();
}

if (RUN_ONCE) {
  await runOnce();
} else {
  console.log(`${new Date().toISOString()} turn-watchdog started (interval=${INTERVAL_MS}ms, transcript-stall=${TRANSCRIPT_STALL_MS}ms, inflight-stall=${INFLIGHT_STALL_MS}ms, host-restart=${HOST_RESTART_ENABLED ? `on (wedge=${HOST_WEDGE_MIN_AGENTS} agents/${Math.round(HOST_WEDGE_STALL_MS / 60000)}min)` : "off"})`);
  let loops = 0;
  for (;;) {
    loops += 1;
    await runOnce();
    if (loops % 30 === 0) console.log(`${new Date().toISOString()} heartbeat: ${loops} loops, no crash`);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}
