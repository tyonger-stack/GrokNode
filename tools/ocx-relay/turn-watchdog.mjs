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
const TURN_REPORT_PATH = process.env.TURN_REPORT_PATH || "/tmp/sand-host-turns.json";
// The host rewrites this file every 15s. Older than three beats means the
// process stopped answering, and the transcript check stays in force.
const TURN_REPORT_MAX_AGE_MS = Number(process.env.TURN_REPORT_MAX_AGE_MS ?? "45000");
const TRANSCRIPT_ROOT = process.env.TRANSCRIPT_ROOT || "/home/box/sand-data/agent-transcripts";
const AGENT_ROOT = process.env.AGENT_ROOT || "/home/box/sand-data/agents";

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS ?? "120000");
const INFLIGHT_STALL_MS = Number(process.env.INFLIGHT_STALL_MS ?? "600000");
const TRANSCRIPT_STALL_MS = Number(process.env.TRANSCRIPT_STALL_MS ?? "600000");
const SPAWN_WINDOW_MS = Number(process.env.SPAWN_WINDOW_MS ?? "1800000");
const SPAWN_READ_LAG_MS = Number(process.env.SPAWN_READ_LAG_MS ?? "180000");
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? "180000");
// Stall alerts need a tighter loop than the 30-minute catch-all: a real stall
// must be reported while it is still actionable. 2026-09-29: the 30-minute
// cooldown swallowed every repeat of a live incident, so the user saw one
// alert hours after the bots had already recovered.
const STALL_ALERT_COOLDOWN_MS = Number(process.env.STALL_ALERT_COOLDOWN_MS ?? "180000");
// Slow-turn notices are background information: the box is working, nobody
// has to act. Reporting them as often as real stalls buries the actionable
// signal (2026-09-29: 40+ notifications in one afternoon).
const SLOW_STALL_ALERT_COOLDOWN_MS = Number(process.env.SLOW_STALL_ALERT_COOLDOWN_MS ?? "1800000");
// An outage notice is a condition, not an event: it persists for as long as
// the network is down, so it reports on a long cadence instead of every loop.
const OUTAGE_ALERT_COOLDOWN_MS = Number(process.env.OUTAGE_ALERT_COOLDOWN_MS ?? "3600000");
// A live forwarder always finishes a chat request by this age (relay-run.sh
// sets 900000). Anything older is a missing terminal line, not a request.
const UPSTREAM_MAX_TOTAL_MS = Number(process.env.UPSTREAM_MAX_TOTAL_MS ?? "900000");
const ACCOUNTING_GRACE_MS = Number(process.env.ACCOUNTING_GRACE_MS ?? "120000");
// Wall-clock jump bigger than this means the Mac slept (or this process was
// not scheduled). Ages computed across that gap are not evidence.
const SLEEP_GAP_MS = Number(process.env.SLEEP_GAP_MS ?? String(INTERVAL_MS * 3));
// Reminders after the first notice, then silence until recovery. A class
// cooldown below is a floor so a slow-turn or outage reminder is never
// *more* frequent than it was before this schedule existed.
const REMINDER_GAPS_MS = (process.env.REMINDER_GAPS_MS ?? "900000,3600000,14400000")
  .split(",")
  .map((part) => Number(part.trim()))
  .filter((part) => Number.isFinite(part) && part >= 0);
// How recently the forwarder must have seen inference traffic for a stalled
// turn to count as "slow upstream" rather than "dead". Sized to cover a
// legitimately long turn (multi-step tool chains run 90s+ per step).
const STALL_UPSTREAM_EXEMPT_MS = Number(process.env.STALL_UPSTREAM_EXEMPT_MS ?? String(TRANSCRIPT_STALL_MS));
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
// 2026-09-29: 1 agent is enough. The original "2" was a guard against
// false positives, but the false-positive source (a slow turn reading as
// dead) is now excluded upstream by the inference-activity exemption, so a
// silently-stalled single agent is real evidence — and waiting for a second
// one left a genuinely wedged agent alerting for 3 hours without a restart.
const HOST_WEDGE_MIN_AGENTS = Number(process.env.HOST_WEDGE_MIN_AGENTS ?? "1");
const HOST_WEDGE_STALL_MS = Number(process.env.HOST_WEDGE_STALL_MS ?? String(TRANSCRIPT_STALL_MS));
// 2026-09-29: 30min -> 8min. A successful restart only proves the box was
// clear at that instant, not that every stalled turn thawed with it: live
// today, a restart cleared 3 agents while 6 others stayed wedged, and the
// survivors' next wedge signature waited out the remaining 20 minutes of the
// old cooldown while alerting every 3 minutes. 8 minutes still exceeds one
// detection round (2min) plus the restart itself, so it cannot storm.
const HOST_RESTART_COOLDOWN_MS = Number(process.env.HOST_RESTART_COOLDOWN_MS ?? "480000");
const HOST_RESTART_RETRY_COOLDOWN_MS = Number(process.env.HOST_RESTART_RETRY_COOLDOWN_MS ?? String(INTERVAL_MS * 2));
const HOST_RESTART_RESPAWN_MS = Number(process.env.HOST_RESTART_RESPAWN_MS ?? "25000");
// Post-restart canary. 2026-09-30: the canary used to WAKE a bot over its
// webhook, and the only bot with a feishu-p2p webhook was the one that kept
// wedging — so the self-heal fed itself: restart -> wake -> that bot wedged
// again while handling the wake -> 10 minutes later it looked dead again.
// 42 restarts in one night, each interrupting the rest of the fleet.
//
// The wake is now optional. When it is off (the default) the canary is
// PASSIVE: after a restart, ANY agent being dispatched (or writing) proves
// the run queue handed a turn out, which is exactly what the probe is for.
// Nothing is injected into a bot, so the canary can no longer cause the
// failure it is watching for. Set CANARY_WAKE_AGENT to re-enable the old
// active probe against a bot that is known to be stable.
const CANARY_WAKE_AGENT = process.env.CANARY_WAKE_AGENT || "";
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
  const fresh = { hostLogBytes: 0, lastSpawnSeen: {}, lastAlert: {}, lastRepair: {}, lastRepairOk: {}, lastHostRestart: {}, canary: null, outageSince: null, lastProbeOkAt: 0, lastProbeFailAt: 0, conditions: {}, lastLoopAt: 0 };
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
      outageSince: parsed.outageSince ?? null,
      // The relay probe runs AFTER the inflight/outage check in the same loop,
      // so its verdict must survive to the next loop - the watchdog is
      // long-lived, but it also restarts, and a restart must not forget that
      // the relay was already seen failing.
      lastProbeOkAt: Number(parsed.lastProbeOkAt ?? 0),
      lastProbeFailAt: Number(parsed.lastProbeFailAt ?? 0),
      conditions: parsed.conditions ?? {},
      lastLoopAt: Number(parsed.lastLoopAt ?? 0),
    };
  } catch {
    return fresh;
  }
}

function saveState() {
  state.lastProbeOkAt = forwarderActivity.lastProbeOkAt;
  state.lastProbeFailAt = forwarderActivity.lastProbeFailAt;
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
// Seeded from persisted state: the probe runs after the checks that read
// these, so a fresh process must inherit the previous loop's verdict.
const forwarderActivity = {
  inflight: 0,
  lastPostAt: 0,
  recentTerminal: [],
  lastProbeOkAt: state.lastProbeOkAt,
  lastProbeFailAt: state.lastProbeFailAt,
};
// Window for the capacity-failure exemption: terminal outcomes younger than
// this count toward the "all failures are capacity" verdict. It must cover
// the wedge signature's own quiet window (HOST_WEDGE_STALL_MS of zero POST
// traffic), or the two gates can never agree: terminals old enough to trip
// the wedge would already have aged out of a shorter capacity window.
const CAPACITY_WINDOW_MS = Number(process.env.CAPACITY_WINDOW_MS ?? "1800000");

function fetchLiveInflight() {
  if (process.env.INFLIGHT_SOURCE === "log") return Promise.resolve(null);
  if (process.env.INFLIGHT_SOURCE === "json" || process.env.FORWARDER_INFLIGHT_JSON) {
    const raw = process.env.FORWARDER_INFLIGHT_JSON;
    if (!raw) return Promise.resolve(null);
    try { return Promise.resolve(JSON.parse(raw)); } catch { return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    let token = "";
    try { token = fs.readFileSync(path.join(RELAY_DIR, "token"), "utf8").trim(); } catch { /* probe unauthenticated */ }
    const req = http.get(
      {
        host: "127.0.0.1",
        port: Number(process.env.FORWARDER_PORT ?? "11010"),
        path: "/v1/relay/inflight",
        headers: token ? { "x-relay-token": token } : {},
        timeout: 2000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { resolve(null); }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

async function checkInflightStalls(now) {
  const live = await fetchLiveInflight();
  const tail = readTail(FORWARDER_LOG, LOG_TAIL_BYTES);
  const startedAt = new Map();
  const finished = new Set();
  let lastPostAt = 0;
  let capFromLog = 0;
  const terminals = [];
  for (const line of tail.split("\n")) {
    const totalMatch = line.match(/\btotal=(\d+)ms\b/);
    if (line.includes("relay listening") && totalMatch) capFromLog = Number(totalMatch[1]);
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
      if (Number.isFinite(doneTs)) {
        lastPostAt = Math.max(lastPostAt, doneTs);
        // Terminal outcome for the capacity verdict: `-> <code>` lines carry
        // the status; anything else (upstream-error, handler-error) is an
        // infrastructure failure, not upstream capacity.
        const codeMatch = line.match(/->\s*(\d{3})\b/);
        if (codeMatch) terminals.push({ at: doneTs, code: Number(codeMatch[1]) });
        else terminals.push({ at: doneTs, code: -1 });
      }
    }
  }
  forwarderActivity.lastPostAt = lastPostAt;
  forwarderActivity.recentTerminal = terminals.filter((t) => now - t.at < CAPACITY_WINDOW_MS);
  const cap = Number(live?.maxTotalMs) || capFromLog || UPSTREAM_MAX_TOTAL_MS;
  const accountingAfter = cap + ACCOUNTING_GRACE_MS;
  // 2026-10-01: a missing terminal line is not a live request. The forwarder
  // finishes every chat request by `cap` (and GET /v1/relay/inflight lists
  // only what the process still holds). Older than that — 2026-09-30
  // id=4209373a was still "hung" at 633 minutes — is an accounting error.
  // It must not count as in flight, or it blocks the host-wedge restart and
  // gets re-reported every loop.
  const accounting = [];
  const hung = [];
  const seenAccounting = new Set();
  function noteAccounting(id, ts) {
    if (seenAccounting.has(id) || finished.has(id)) return;
    seenAccounting.add(id);
    accounting.push({ id, ts });
  }
  if (live && Array.isArray(live.entries)) {
    const liveIds = new Set();
    for (const entry of live.entries) {
      if (!entry || typeof entry.id !== "string") continue;
      liveIds.add(entry.id);
      const age = Number.isFinite(entry.ageMs) ? entry.ageMs : now - Number(entry.started);
      const ts = now - age;
      if (age > accountingAfter) noteAccounting(entry.id, ts);
      else if (age >= INFLIGHT_STALL_MS) hung.push({ id: entry.id, ts });
    }
    forwarderActivity.inflight = live.entries.length - accounting.filter((item) => liveIds.has(item.id)).length;
    for (const [id, ts] of startedAt) {
      if (finished.has(id) || liveIds.has(id)) continue;
      if (now - ts >= INFLIGHT_STALL_MS) noteAccounting(id, ts);
    }
  } else {
    let inflight = 0;
    for (const [id, ts] of startedAt) {
      if (finished.has(id)) continue;
      if (now - ts > accountingAfter) noteAccounting(id, ts);
      else {
        inflight += 1;
        if (now - ts >= INFLIGHT_STALL_MS) hung.push({ id, ts });
      }
    }
    forwarderActivity.inflight = inflight;
  }
  for (const { id, ts } of accounting) {
    const minutes = Math.round((now - ts) / 60000);
    alert(
      `inflight-accounting:${id}`,
      `推理请求 id=${id} 在记录里已 ${minutes} 分钟没有终态，超过转发器 ${Math.round(cap / 60000)} 分钟硬上限，或转发器内存里已经没有它。这是记账错误，不是仍在进行的推理；不再计入 in-flight，也不会挡住 host 重启。`,
    );
  }
  const lastStartAt = [...startedAt.values()].reduce((max, ts) => Math.max(max, ts), 0);
  const recentActivity = now - Math.max(lastStartAt, lastPostAt) < INFLIGHT_STALL_MS;
  const hungIds = new Set(hung.map((item) => item.id));
  for (const key of Object.keys(state.conditions ?? {})) {
    if (key.startsWith("inflight-accounting:")) {
      const id = key.slice("inflight-accounting:".length);
      if (!seenAccounting.has(id)) clearCondition(key, `推理请求 id=${id} 的日志缺口已消失。`);
    } else if (key.startsWith("inflight:")) {
      const id = key.slice("inflight:".length);
      if (!hungIds.has(id)) clearCondition(key, `推理请求 id=${id} 已结束，不再挂起。`);
    }
  }
  if (hung.length === 0) {
    if (state.outageSince != null) {
      const minutes = Math.round((now - state.outageSince) / 60000);
      state.outageSince = null;
      clearCondition("upstream-outage");
      console.log(`${new Date(now).toISOString()} upstream recovered after ${minutes}min`);
      alert("upstream-recovered", `上游已恢复响应（中断持续约 ${minutes} 分钟），推理链路重新可用。`);
    }
    return;
  }
  // An outage is a POSITIVE finding, never an absence of evidence: the
  // relay probe has to be seen failing. Silence alone must never open an
  // outage, because "no traffic" is also what an idle night looks like, and
  // a fleet that simply stopped dispatching is not a broken network.
  // The relay probe answers while chat requests hang, so a RELAY that
  // answers during hung requests is the clearest proof of a stuck request
  // rather than a dead path.
  const probeFailing =
    forwarderActivity.lastProbeFailAt > 0
    && now - forwarderActivity.lastProbeFailAt < INFLIGHT_STALL_MS * 2;
  const probeAlive =
    forwarderActivity.lastProbeOkAt > 0
    && now - forwarderActivity.lastProbeOkAt < INFLIGHT_STALL_MS * 2;
  if (!probeFailing && (recentActivity || probeAlive || lastPostAt === 0 || now - lastPostAt < INFLIGHT_STALL_MS)) {
    // The upstream is demonstrably alive: requests are flowing, or a request
    // finished recently enough to prove it. Report the stuck ones by id and
    // leave outage state alone.
    state.outageSince = null;
    for (const { id, ts } of hung) {
      console.log(
        `${new Date(now).toISOString()} inflight stalled id=${id} age=${Math.round((now - ts) / 1000)}s`,
      );
      alert(
        `inflight:${id}`,
        `有推理请求已挂起 ${Math.round((now - ts) / 60000)} 分钟未返回（id=${id}，自 ${new Date(ts).toLocaleTimeString()}）——上游可能限流或挂死。`,
      );
    }
    return;
  }
  // Nothing at all is completing. One notice for the whole outage, refreshed
  // on a long cadence, naming the likely cause instead of the symptom.
  if (state.outageSince == null) state.outageSince = now;
  const minutes = Math.round((now - state.outageSince) / 60000);
  console.log(
    `${new Date(now).toISOString()} upstream outage ${minutes}min: ${hung.length} request(s) hung, none completing`,
  );
  alert(
    "upstream-outage",
    `上游无响应已持续 ${minutes} 分钟：${hung.length} 个推理请求全部挂起、无一完成（最早自 ${new Date(hung[0].ts).toLocaleTimeString()}）。`
    + `这是网络或上游整体中断的典型表现，不是单个 bot 的问题——请先检查本机网络与容器到上游的连通性；恢复后系统会自动继续，无需逐个干预 bot。`,
  );
}

// Signal 2: worker spawned recently but the agent transcript went quiet.
// The per-agent stall findings are also collected for the systemic host-wedge
// check below (several stalled spawns + zero forwarder traffic = the host
// process itself is wedged, not just one slow bot).
const stallReport = [];
let lastTranscriptMtimes = new Map();

async function readHostTurnReport(now) {
  const pinned = process.env.TURN_REPORT_JSON;
  let parsed = null;
  if (pinned === "missing") return null;
  if (pinned) {
    try { parsed = JSON.parse(pinned); } catch { return null; }
  } else {
    try {
      parsed = JSON.parse(await execInContainer(`cat ${TURN_REPORT_PATH}`));
    } catch {
      return null;
    }
  }
  const writtenAt = Number(parsed?.writtenAt);
  if (!Number.isFinite(writtenAt) || now - writtenAt > TURN_REPORT_MAX_AGE_MS) return null;
  const turns = new Map();
  for (const turn of parsed.turns ?? []) {
    if (turn && typeof turn.agentId === "string" && turn.agentId.length > 0) turns.set(turn.agentId, turn);
  }
  return turns;
}

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
  // null: the host did not answer, so a quiet transcript still counts.
  // a Map (possibly empty): the host answered, and only listed turns are alive.
  const reportedTurns = await readHostTurnReport(now);

  for (const [agentId, tracked] of Object.entries(state.lastSpawnSeen)) {
    const { seenAt, baselineMtime } =
      typeof tracked === "number"
        ? { seenAt: tracked, baselineMtime: -1 }
        : { seenAt: tracked.seenAt ?? 0, baselineMtime: tracked.baselineMtime ?? -1 };
    const reported = reportedTurns?.get(agentId) ?? null;
    if (reportedTurns && !reported) {
      // The host is up and this agent has no in-flight turn. A spawned worker
      // plus a quiet transcript is not a stalled turn.
      delete state.lastSpawnSeen[agentId];
      const short = agentId.slice(0, 8);
      clearCondition(`stall:${agentId}`, `bot ${short} 当前没有在跑的回合。`);
      clearCondition(`stall-slow:${agentId}`);
      continue;
    }
    if (!reported && now - seenAt > SPAWN_WINDOW_MS) {
      delete state.lastSpawnSeen[agentId];
      continue;
    }
    const turnOrigin = Number.isFinite(reported?.startedAt) ? reported.startedAt : seenAt;
    const mtime = mtimes.get(agentId);
    if (mtime === undefined) {
      // A spawned agent with NO transcript file at all is the most wedged
      // shape there is (dispatch without even a first write). Previously it
      // was skipped silently and never entered the wedge count; now it
      // counts with a stale epoch so a never-written turn still trips the
      // stall timer from its spawn sighting.
      const turnAge = now - turnOrigin;
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
      const short = agentId.slice(0, 8);
      clearCondition(`stall:${agentId}`, `bot ${short} 已恢复写入 transcript。`);
      clearCondition(`stall-slow:${agentId}`, `bot ${short} 的长回合已有 transcript 写入。`);
      continue;
    }
    // Stall: the turn dispatched at seenAt has produced NOTHING for
    // TRANSCRIPT_STALL_MS, measured from the spawn sighting. v1 measured
    // silence from the previous transcript write, which is usually idle time
    // BEFORE the turn — that made every routine wake-up on an idle bot look
    // like a 60+ minute stall (the 2026-09-26 false-alarm storm).
    const turnAge = now - turnOrigin;
    if (turnAge >= TRANSCRIPT_STALL_MS) {
      // Slow-not-dead exemption (2026-09-29): a turn legitimately writes
      // nothing between dispatch and its first token, and a multi-step turn
      // can run minutes upstream without a transcript write. Treating that
      // silence as death produced an alert storm (7 in one afternoon) and,
      // worse, each alert fed the wedge signature that RESTARTED the host
      // mid-turn. If the forwarder has seen inference traffic inside the
      // stall window, the box is working, not wedged.
      const inferring = forwarderActivity.lastPostAt > 0
        && now - forwarderActivity.lastPostAt < STALL_UPSTREAM_EXEMPT_MS;
      const name = await agentName(agentId);
      if (inferring) {
        stallReport.push({ agentId, seenAt, turnAge, inferring: true });
        // Slow-but-working is information, not an incident: report it on the
        // long cadence. 2026-09-29: at the 3-minute stall cadence this fired
        // 40+ notifications in an afternoon for a fleet that was mid-turn and
        // healthy, burying the real stalls in noise.
        alert(
          `stall-slow:${agentId}`,
          `bot「${name}」(${agentId.slice(0, 8)}) 回合派出后 ${Math.round(turnAge / 60000)} 分钟 transcript 零写入，但中继 ${Math.round((now - forwarderActivity.lastPostAt) / 1000)} 秒前还有推理流量——判定为上游慢/长回合，未重启任何进程。`,
          { agent: agentId, name, slow: true },
        );
        continue;
      }
      stallReport.push({ agentId, seenAt, turnAge });
      alert(`stall:${agentId}`, `bot「${name}」(${agentId.slice(0, 8)}) 疑似卡死：回合派出后 ${Math.round(turnAge / 60000)} 分钟 transcript 零写入（该 bot 最后一次写入 ${new Date(mtime).toLocaleString()}，早于本回合派出），且同期无任何推理流量。`, { agent: agentId, name });
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
  // Test seam: the outage verdict depends on this probe, and the probe is a
  // real socket to 11010 that a test cannot stand up. FORWARDER_PROBE_RESULT
  // pins the outcome ("ok" | "fail") for tests; unset in production.
  const pinned = process.env.FORWARDER_PROBE_RESULT;
  if (pinned === "ok") {
    forwarderActivity.lastProbeOkAt = Date.now();
    return Promise.resolve();
  }
  if (pinned === "fail") {
    forwarderActivity.lastProbeFailAt = Date.now();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let token = "";
    try { token = fs.readFileSync(path.join(RELAY_DIR, "token"), "utf8").trim(); } catch { /* probe unauthenticated */ }
    const req = http.get(
      { host: "127.0.0.1", port: 11010, path: "/v1/models", headers: token ? { "x-relay-token": token } : {}, timeout: 5000 },
      (res) => {
        res.resume();
        // The probe answers while chat requests hang, so it separates a stuck
        // request from a dead path. Both directions are recorded: an outage is
        // only declared when the relay has been seen FAILING.
        if (res.statusCode === 200) {
          forwarderActivity.lastProbeOkAt = Date.now();
          clearCondition("forwarder-down", "中继 11010 已恢复响应。");
        } else forwarderActivity.lastProbeFailAt = Date.now();
        if (res.statusCode !== 200) {
          alert("forwarder-down", `中继 11010 探活异常（HTTP ${res.statusCode}）——所有 bot 推理可能已断。`);
        }
        resolve();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      forwarderActivity.lastProbeFailAt = Date.now();
      alert("forwarder-down", `中继 11010 探活超时——所有 bot 推理可能已断（${new Date(now).toLocaleTimeString()}）。`);
      resolve();
    });
    req.on("error", (e) => {
      forwarderActivity.lastProbeFailAt = Date.now();
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
async function repairContainerRelay(now, key = "container-relay", options = {}) {
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
  // Token-only resync (403 auth-mismatch): the credential is stale but the
  // upstream is fine, so there is nothing to re-derive — skip address
  // resolution entirely and re-push with the current Mac-side token. The
  // push script falls back to the running relay's own upstream when no
  // override is given, leaving the healthy hop untouched. (This path must
  // not depend on en0/ipconfig: Linux CI runners have neither, and the
  // token resync must work there too.)
  let address = "";
  let source = "";
  if (options.tokenOnly) {
    source = "仅重同步 token（上游不动）";
  } else if (await stableUpstreamReachable()) {
    address = STABLE_UPSTREAM;
    source = "稳定主机名";
  } else {
    const en0 = currentMacAddress();
    if (en0) {
      address = en0;
      source = "en0 现场 IP（稳定主机名不可达，已回退）";
    }
  }
  if (!address && !options.tokenOnly) {
    return { attempted: false, ok: false, detail: `稳定主机名 ${STABLE_UPSTREAM} 与本机 en0/en1 均不可达，无法确定上游（网络未就绪？）` };
  }
  // Stamp before the attempt so a repair that hangs past REPAIR_TIMEOUT_MS is
  // not retried on the very next loop, but only as a *failed* one; the long
  // cooldown is earned by an attempt that is known to have worked.
  state.lastRepair = { ...(state.lastRepair ?? {}), [key]: now };
  state.lastRepairOk = { ...(state.lastRepairOk ?? {}), [key]: false };
  console.log(`${new Date(now).toISOString()} repairing container relay -> ${address || "(upstream unchanged)"} (${source}) via ${REPAIR_SCRIPT}`);
  // Always hand the CURRENT Mac-side token to the push script (the forwarder
  // compares against the token file live): the old relay's environ token may
  // be the very credential a 403 just told us is stale.
  const currentToken = relayToken();
  try {
    const stdout = await new Promise((resolve, reject) => {
      // Execute via shebang, not a hardcoded interpreter: /bin/zsh exists on
      // macOS but not on Linux CI runners. In tokenOnly mode the upstream
      // override is left empty on purpose: the push script then keeps the
      // running relay's own upstream and only rotates the credential.
      execFile(REPAIR_SCRIPT, [], {
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
    clearCondition("container-relay-down", "容器内 10100 已恢复响应。");
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
    ? await repairContainerRelay(now, "container-relay-token", { tokenOnly: true })
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
  // A network outage stalls every turn at once and looks exactly like a wedge,
  // but restarting the host cannot restore connectivity — it would only kill
  // the turns that are waiting to resume. The outage notice is the report.
  if (state.outageSince != null) {
    const minutes = Math.round((now - state.outageSince) / 60000);
    console.log(
      `${new Date(now).toISOString()} wedge signature ignored: upstream outage active for ${minutes}min (restarting cannot fix connectivity)`,
    );
    return;
  }
  // Verify the previous restart's canary first — a wake that never produced a
  // transcript write means the run queue is still stuck after a respawn, which
  // deserves a (very loud) human look rather than another blind restart.
  if (state.canary && state.canary.sentAt) {
    // Passive canary (no wake injected): ANY agent dispatched after the
    // restart proves the run queue handed a turn out, and any transcript
    // write proves work completed. With an active wake, also require that
    // specific agent. Either signal clears the canary.
    const SKEW_TOLERANCE_MS = 120_000;
    const wakeAgent = state.canary.agentId;
    let dispatched = false;
    let seenAt = 0;
    if (wakeAgent) {
      const tracked = state.lastSpawnSeen?.[wakeAgent];
      seenAt = typeof tracked === "number" ? tracked : tracked?.seenAt ?? 0;
      dispatched = seenAt >= state.canary.sentAt;
    } else {
      for (const tracked of Object.values(state.lastSpawnSeen ?? {})) {
        const at = typeof tracked === "number" ? tracked : tracked?.seenAt ?? 0;
        if (at >= state.canary.sentAt) {
          dispatched = true;
          if (at > seenAt) seenAt = at;
        }
      }
    }
    let wrote = false;
    for (const [agentId, mtime] of lastTranscriptMtimes) {
      if (wakeAgent && agentId !== wakeAgent) continue;
      if (mtime >= state.canary.sentAt + SKEW_TOLERANCE_MS) wrote = true;
    }
    const subject = wakeAgent ? wakeAgent.slice(0, 8) : "任意 bot";
    if (dispatched) {
      console.log(`${new Date(now).toISOString()} canary ok: ${subject} was dispatched after restart`);
      state.canary = null;
    } else if (wrote) {
      console.log(`${new Date(now).toISOString()} canary ok: ${subject} wrote after restart`);
      state.canary = null;
    } else if (now - state.canary.sentAt >= CANARY_VERIFY_MS) {
      const detail = seenAt > 0
        ? `最近一次派发在 ${new Date(seenAt).toLocaleTimeString()}（早于本次重启）`
        : "重启后未见任何回合派发记录";
      alert(
        "host-restart-canary-failed",
        `host 重启后 ${Math.round((now - state.canary.sentAt) / 60000)} 分钟，${subject} 既未写入 transcript 也没有新的回合派发（${detail}）——run 队列可能仍未恢复，需要人工排查（重启不能治的僵死）。`,
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

  // Only genuinely silent turns count toward the wedge: entries the stall
  // check already excused as "slow upstream" (forwarder traffic inside the
  // window) prove the box is inferring, and restarting it would kill a turn
  // that is making progress. 2026-09-29: four restarts in one afternoon came
  // from counting slow turns as dead ones.
  const deadLong = stallReport.filter((entry) => entry.turnAge >= HOST_WEDGE_STALL_MS && entry.inferring !== true);
  const stalledLong = stallReport.filter((entry) => entry.turnAge >= HOST_WEDGE_STALL_MS);
  if (deadLong.length < HOST_WEDGE_MIN_AGENTS) return;
  if (forwarderActivity.inflight > 0) return; // something IS inferring — slow, not wedged
  if (forwarderActivity.lastPostAt > 0 && now - forwarderActivity.lastPostAt < HOST_WEDGE_STALL_MS) return;
  // Capacity-failure exemption (rakazo rule: capacity errors never restart
  // the process): when every recent terminal outcome is upstream 429/5xx,
  // the system is not wedged — the upstream is broke. Restarting the host
  // would only murder the queued requests without producing a single reply.
  // Alert (so a human sees the outage) but do not touch the host.
  const terms = forwarderActivity.recentTerminal;
  if (terms.length > 0 && terms.every((t) => t.code === 429 || (t.code >= 500 && t.code <= 599))) {
    alert(
      "host-wedge-capacity",
      `上游容量不足（近 ${Math.round(CAPACITY_WINDOW_MS / 60000)} 分钟 ${terms.length} 个终态全是 ${[...new Set(terms.map((t) => t.code))].join("/")}），${stalledLong.length} 个 bot 回合停滞但属上游原因——不重启 host（重启也变不出回复），请检查模型配额或切换模型。`,
    );
    return;
  }
  // A broken relay hop mimics this signature; that is the repair path's case
  // and a host restart would not fix it. Only act when the hop is healthy.
  const relay = await probeContainerRelay();
  if (!relay.ok) {
    console.log(`${new Date(now).toISOString()} host-wedge signature present but relay hop unhealthy (${relay.code}); leaving it to the relay repair path`);
    return;
  }

  const names = stalledLong.slice(0, 4).map((entry) => entry.agentId.slice(0, 8)).join(", ");
  console.log(`${new Date(now).toISOString()} host-wedge signature: ${deadLong.length} silently-stalled spawns (${names}), 0 in-flight, no POST traffic ${Math.round(HOST_WEDGE_STALL_MS / 60000)}+ min, relay ok -> restarting host`);
  state.lastHostRestart = { ...(state.lastHostRestart ?? {}), [key]: { at: now, ok: false } };
  const result = await restartHostProcess();
  state.lastHostRestart = { ...(state.lastHostRestart ?? {}), [key]: { at: now, ok: result.ok, detail: redactSecrets(result.detail) } };
  if (result.ok) {
    // Passive by default: arm the canary without waking anything. It is
    // cleared by the next real dispatch, which a live fleet produces on its
    // own. Only arm it at all when a fleet may be idle — otherwise there is
    // nothing to observe and no restart to stack.
    state.canary = { agentId: CANARY_WAKE_AGENT || null, sentAt: now };
    if (CANARY_WAKE_AGENT) {
      const sent = await sendCanaryWake(CANARY_WAKE_AGENT, now);
      if (!sent) {
        console.log(`${new Date(now).toISOString()} canary wake not sent (webhook key missing or app listener down); falling back to passive`);
        state.canary = { agentId: null, sentAt: now };
      }
    }
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

const ACTION_KEYS = new Set([
  "host-wedge-restarted",
  "host-wedge-restart-failed",
  "host-wedge-capacity",
  "host-restart-canary-failed",
  "upstream-recovered",
]);

function conditionFloor(key) {
  if (key === "upstream-outage") return OUTAGE_ALERT_COOLDOWN_MS;
  if (key.startsWith("stall-slow:")) return SLOW_STALL_ALERT_COOLDOWN_MS;
  if (key.startsWith("stall:")) return STALL_ALERT_COOLDOWN_MS;
  return ALERT_COOLDOWN_MS;
}

function emitAlert(key, message, fields = {}) {
  const line = `${new Date().toISOString()} [${key}] ${message}`;
  console.log(`ALERT ${line}`);
  try { fs.appendFileSync(ALERTS_LOG, line + "\n"); } catch { /* non-fatal */ }
  if (MACOS_NOTIFY) notifyMacOS(message);
  if (ALERT_COMMAND) {
    // Security: fields.agent/name arrive from the container (profile.json),
    // so they must NEVER be interpolated into a shell string — a bot named
    // `$(curl …)` would execute on the Mac. Pass values via argv/env on the
    // expanded template; keep the template itself a static operator string.
    const safe = (value) => String(value ?? "unknown").replace(/[^\w.:/-]/g, "_").slice(0, 128);
    const parts = [ALERT_COMMAND, safe(key), safe(message).slice(0, 512), safe(fields.agent), safe(fields.name ?? fields.agent)];
    const shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
    execFile(shell, ["-c", '"$0" "$1" "$2" "$3" "$4"', ...parts], { timeout: 15000 }, () => {});
  }
}

function clearCondition(key, recoveryMessage) {
  const cond = state.conditions?.[key];
  if (!cond?.open) return;
  cond.open = false;
  if (recoveryMessage) emitAlert(`${key}-recovered`, recoveryMessage);
}

function alert(key, message, fields = {}) {
  const now = Date.now();
  // While an outage is active, its single notice IS the diagnosis. Every
  // stall/inflight below it is a symptom of the same cause, and an hour of
  // network loss must not produce an hour of per-bot notices.
  if (
    state.outageSince != null
    && (key.startsWith("stall:") || key.startsWith("stall-slow:") || key.startsWith("inflight:") || key.startsWith("inflight-accounting:"))
  ) return;
  // A restart or a recovery is an event. Ongoing conditions open once, remind
  // a few times on a lengthening gap, then stay quiet until they clear.
  if (ACTION_KEYS.has(key)) {
    if (now - (state.lastAlert[key] ?? 0) < ALERT_COOLDOWN_MS) return;
    state.lastAlert[key] = now;
    emitAlert(key, message, fields);
    return;
  }
  if (!state.conditions) state.conditions = {};
  const cond = state.conditions[key];
  if (!cond?.open) {
    state.conditions[key] = { open: true, since: now, lastSent: now, reminders: 0 };
    state.lastAlert[key] = now;
    emitAlert(key, message, fields);
    return;
  }
  const scheduled = REMINDER_GAPS_MS[cond.reminders];
  if (scheduled == null) return;
  const gap = Math.max(scheduled, conditionFloor(key));
  if (now - cond.lastSent < gap) return;
  cond.reminders += 1;
  cond.lastSent = now;
  state.lastAlert[key] = now;
  emitAlert(key, message, fields);
}

async function runOnce() {
  const now = Date.now();
  const prevLoop = Number(state.lastLoopAt ?? 0);
  const gap = prevLoop ? now - prevLoop : 0;
  state.lastLoopAt = now;
  if (prevLoop && gap > SLEEP_GAP_MS) {
    // The stall clock is "now minus seenAt". A lid-sleep makes every
    // pre-sleep spawn look hours dead on the wake-up loop, and the log-tail
    // ages jump with the wall clock too. Re-pin spawn clocks and decide
    // nothing this round — including not restarting the host.
    console.log(`${new Date(now).toISOString()} clock gap ${Math.round(gap / 1000)}s, re-baseline only`);
    for (const [agentId, tracked] of Object.entries(state.lastSpawnSeen ?? {})) {
      if (typeof tracked === "number") state.lastSpawnSeen[agentId] = now;
      else state.lastSpawnSeen[agentId] = { ...tracked, seenAt: now };
    }
    saveState();
    return;
  }
  try { await checkInflightStalls(now); } catch (e) { console.log(`checkInflightStalls failed: ${e.message}`); }
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
