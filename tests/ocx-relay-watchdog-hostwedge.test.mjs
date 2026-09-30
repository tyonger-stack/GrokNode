import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const WATCHDOG = new URL("../tools/ocx-relay/turn-watchdog.mjs", import.meta.url).pathname;

// Fake `docker exec`: answers the handful of probes the watchdog issues,
// driven by fixture files/env so each test controls the container's "state".
// Every invocation is appended to $FAKE_DOCKER_LOG for call assertions.
const FAKE_DOCKER = `#!/bin/sh
# $5 is the full sh -c command string (execFile argv: $1=exec $2=box $3=sh
# $4=-c $5=command; $0 is the script itself and takes no number). Branch on
# it - matching any other position silently falls through to exit 0 and the
# ingestion path would never be exercised while every test still passed.
echo "$5" >> "$FAKE_DOCKER_LOG"
case "$5" in
  *"wc -c <"*) echo "\${FAKE_HOST_LOG_SIZE:-1000}" ;;
  *"tail -c +"*) if [ -n "$FAKE_SPAWN_FILE" ]; then cat "$FAKE_SPAWN_FILE" 2>/dev/null; fi ;;
  *"agent-transcripts"*) cat "\$FAKE_TRANSCRIPT_FILE" 2>/dev/null ;;
  *"profile.json"*) echo '{"name":"测试Bot"}' ;;
  *"127.0.0.1:10100"*|*"host.internal:11010"*)
    # Faithful to mac-forwarder.mjs: no/wrong token -> 403, not 200. The fake
    # only answers with the fixture code when the probe carries auth.
    case "$5" in
      *"-H"*) echo "\${FAKE_RELAY_CODE:-200}" ;;
      *) echo "403" ;;
    esac ;;
  *"RELAY_UPSTREAM_HOST=//p"*) echo "\${FAKE_UPSTREAM_ENV:-host.internal}" ;;
  *"automations/"*"webhook.json"*) echo '{"key":"test-key-123"}' ;;
  *"pgrep"*)
    if [ -n "\$FAKE_PGREP_EMPTY" ]; then exit 1; fi
    if [ -n "\$FAKE_PGREP_POISON" ]; then echo "\$FAKE_PGREP_POISON"; exit 0; fi
    n=$(cat "\$FAKE_PID_COUNTER" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "\$FAKE_PID_COUNTER"
    echo $((100 + n))
    ;;
  *"kill -TERM"*)
    if [ -n "\$FAKE_KILL_FAILS" ]; then exit 1; fi
    exit 0 ;;
  *) exit 0 ;;
esac
`;

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";
const CANARY_AGENT_ID = "70e22ee1-4b23-4860-a598-9e39f47ddc19";

async function makeFixtures() {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-hostwedge-"));
  const fakeDocker = path.join(dir, "fake-docker.sh");
  await writeFile(fakeDocker, FAKE_DOCKER);
  await chmod(fakeDocker, 0o755);
  return {
    dir,
    fakeDocker,
    log: path.join(dir, "docker-calls.log"),
    stateFile: path.join(dir, "state.json"),
    alerts: path.join(dir, "alerts.log"),
    forwarderLog: path.join(dir, "forwarder.log"),
    transcriptFile: path.join(dir, "transcripts.txt"),
    pidCounter: path.join(dir, "pid-counter"),
    repairScript: path.join(dir, "repair.sh"),
  };
}

function transcriptLine(agentId, minutesAgo) {
  const seconds = (Date.now() - minutesAgo * 60_000) / 1000;
  return `${seconds.toFixed(6)} /home/box/sand-data/agent-transcripts/${agentId}/${agentId}.jsonl`;
}

async function seedState(fx, spawnMinutesAgo, hostLogSize = 1000) {
  const seenAt = Date.now() - spawnMinutesAgo * 60_000;
  await writeFile(fx.stateFile, JSON.stringify({
    hostLogBytes: hostLogSize,
    lastSpawnSeen: { [AGENT_A]: seenAt, [AGENT_B]: seenAt },
    lastAlert: {},
  }));
}

// Probes only answer 200 when they carry auth (faithful to the forwarder),
// so every test that needs a green hop writes the token file first.
async function seedToken(fx, token = "fixture-token-abc") {
  await writeFile(`${fx.dir}/token`, `${token}\n`);
}

async function runWatchdog(fx, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [WATCHDOG],
      {
        timeout: 60_000,
        env: {
          ...process.env,
          RUN_ONCE: "1",
          MACOS_NOTIFY: "0",
          ALERT_COMMAND: "",
          DOCKER: fx.fakeDocker,
          RELAY_DIR: fx.dir,
          WATCHDOG_STATE: fx.stateFile,
          WATCHDOG_ALERTS: fx.alerts,
          FORWARDER_LOG: fx.forwarderLog,
          HOST_RESTART_RESPAWN_MS: "400",
          REPAIR_SCRIPT: fx.repairScript,
          FAKE_DOCKER_LOG: fx.log,
          FAKE_TRANSCRIPT_FILE: fx.transcriptFile,
          FAKE_PID_COUNTER: fx.pidCounter,
          INFLIGHT_SOURCE: "log",
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        // A crash must never read as a successful suppression: the guard
        // tests assert ABSENCE of kill/alert, which a dead process trivially
        // satisfies. Non-zero exit is always a failure here.
        if (error) reject(new Error(`watchdog exited ${error.code ?? "?"}: ${String(stderr || error.message).slice(0, 400)}`));
        else resolve(stdout);
      },
    );
  });
}

test("systemic wedge (2 stalled spawns, no traffic, relay ok) restarts the host and sends a canary", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    transcriptLine(CANARY_AGENT_ID, 30),
    "",
  ].join("\n"));

  // Passive canary by default: no wake is injected, so nothing can be
  // delivered and the self-heal cannot feed the failure it watches for.
  const stdout = await runWatchdog(fx);

  const alerts = await readFile(fx.alerts, "utf8");
  assert.ok(alerts.includes("host-wedge-restarted"), `expected restart alert, got: ${alerts}`);
  assert.ok(stdout.includes("host pid 101 -> 102"), `expected respawn log, got: ${stdout}`);
  assert.ok(stdout.includes("host-wedge signature"), `expected signature log, got: ${stdout}`);
  const calls = await readFile(fx.log, "utf8");
  assert.ok(calls.includes("kill -TERM 101"), `expected TERM against pgrep'd pid, got: ${calls}`);

  // Restart cooldown is persisted with its outcome, and the canary is armed
  // passively (agentId null = watch any agent, wake nobody).
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(state.lastHostRestart["host-main"].ok, true);
  assert.ok(state.canary, "a successful restart must arm the canary");
  assert.equal(state.canary.agentId, null, "the default canary must not target a specific agent");
  assert.ok(!calls.includes("webhook/"), "the passive canary must not send a webhook wake");

  // Second pass: any fresh transcript write clears the canary; the success
  // cooldown must prevent a second restart. The stamp is set in the FUTURE:
  // the verdict demands mtime >= sentAt + the 120s clock-skew tolerance.
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    transcriptLine(AGENT_A, -5),
    "",
  ].join("\n"));
  const stdout2 = await runWatchdog(fx).catch(() => "");
  const calls2 = await readFile(fx.log, "utf8");
  assert.equal((calls2.match(/kill -TERM/g) || []).length, 1, "cooldown must block a second restart");
  const state2 = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(state2.canary, null, "a fresh transcript write must clear the pending canary");
});

test("a dispatched canary clears the pending canary before it ever writes", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  // No transcript write for the canary agent at all — the queue handing
  // the turn out is enough proof it recovered. This is the 2026-09-29
  // false alarm: a long turn that wrote eight minutes after the canary
  // had already declared failure.
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(13)} POST /v1/chat/completions -> 400 1000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  // First pass: wedge fires, canary armed passively (nobody is woken).
  await runWatchdog(fx);
  const first = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.ok(first.canary, "the restart must arm a canary");
  assert.equal(first.canary.agentId, null, "the default canary watches any agent without waking one");

  // Second pass: any agent is seen spawning AFTER the restart, while every
  // transcript is still untouched.
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  state.lastSpawnSeen[AGENT_B] = { seenAt: first.canary.sentAt + 1000, baselineMtime: -1 };
  await writeFile(fx.stateFile, JSON.stringify(state));

  await runWatchdog(fx);
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-restart-canary-failed"), "a dispatched turn must not be reported as failed");
  const calls = await readFile(fx.log, "utf8");
  assert.equal((calls.match(/kill -TERM/g) || []).length, 1, "the canary verdict must not stack a second restart");
});

test("a log ghost older than the forwarder cap does not block the host restart", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  // The only unfinished id is impossibly old. A real in-flight request would
  // suppress the restart; this one must not, or a leaked slot blocks recovery
  // of every wedged bot (2026-09-30, id=4209373a).
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(50)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4 total=900000ms)`,
    `${isoMinutesAgo(40)} POST /v1/chat/completions started id=4209373a try=0 queued=0ms`,
    `${isoMinutesAgo(40)} POST /v1/chat/completions retry id=4209373a attempt=1 in=2295ms`,
    `${isoMinutesAgo(20)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(19)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const calls = await readFile(fx.log, "utf8");
  assert.ok(calls.includes("kill -TERM"), "a ghost started-line must not suppress the host restart");
  const alerts = await readFile(fx.alerts, "utf8");
  assert.ok(alerts.includes("host-wedge-restarted"), `expected a restart, got: ${alerts}`);
  assert.ok(alerts.includes("inflight-accounting:4209373a"), "the ghost is reported as accounting");
  assert.ok(!alerts.includes("[inflight:4209373a]"), "the ghost must not be reported as in flight");
});

test("a clock gap re-baselines spawn clocks and does not restart", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  state.lastLoopAt = Date.now() - 3 * 60 * 60_000;
  await writeFile(fx.stateFile, JSON.stringify(state));
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  const stdout = await runWatchdog(fx);
  assert.ok(stdout.includes("re-baseline only"), `expected a re-baseline, got: ${stdout}`);
  const calls = await readFile(fx.log, "utf8").catch(() => "");
  assert.ok(!calls.includes("kill -TERM"), "the wake-up loop must not restart the host");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.equal(alerts, "", `the wake-up loop must not alert, got: ${alerts}`);
  const after = JSON.parse(await readFile(fx.stateFile, "utf8"));
  const seenAt = after.lastSpawnSeen[AGENT_A];
  const pinned = typeof seenAt === "number" ? seenAt : seenAt.seenAt;
  assert.ok(Date.now() - pinned < 60_000, "spawn clocks are re-pinned to the wake-up");
});

test("a fresh host report with no turns is not a stall", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx, {
    TURN_REPORT_JSON: JSON.stringify({ writtenAt: Date.now(), pid: 1, turns: [] }),
  });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "an idle host must not be restarted");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("疑似卡死"), `a quiet transcript is not a stall when the host says nothing is running, got: ${alerts}`);
});

test("a fresh host report listing the turn still restarts a silent one", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));
  const startedAt = Date.now() - 12 * 60_000;

  await runWatchdog(fx, {
    TURN_REPORT_JSON: JSON.stringify({
      writtenAt: Date.now(),
      pid: 1,
      turns: [
        { agentId: AGENT_A, startedAt, inFlight: 1 },
        { agentId: AGENT_B, startedAt, inFlight: 1 },
      ],
    }),
  });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(calls.includes("kill -TERM"), "a turn the host still lists as running can restart the host");
});

test("a stale host report does not hide a stalled turn", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx, {
    TURN_REPORT_JSON: JSON.stringify({
      writtenAt: Date.now() - 10 * 60_000,
      pid: 1,
      turns: [],
    }),
  });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(calls.includes("kill -TERM"), "a report the host stopped updating must not clear a stall");
});

test("an in-flight inference suppresses the wedge restart (slow, not wedged)", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(12)} POST /v1/chat/completions started id=bbbb2222 try=0 queued=0ms`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "in-flight request must suppress the restart");
  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "no TERM may be issued while inference is in flight");
});

test("all-capacity terminal outcomes exempt the host restart (alert only)", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  // Two stalled spawns, zero in-flight, but every recent terminal is an
  // upstream 429/503: the upstream is broke, not the host. Terminals sit
  // 12+ minutes back so the wedge signature's no-traffic gate is met.
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions started id=cccc0001 try=0 queued=0ms`,
    `${isoMinutesAgo(13)} POST /v1/chat/completions -> 429 60000ms queued=0ms try=2 id=cccc0001`,
    `${isoMinutesAgo(13)} POST /v1/chat/completions started id=cccc0002 try=0 queued=0ms`,
    `${isoMinutesAgo(12)} POST /v1/chat/completions -> 503 60000ms queued=0ms try=0 id=cccc0002`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "capacity outage must not restart the host");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "capacity outage must not claim a restart");
  assert.ok(alerts.includes("host-wedge-capacity"), "capacity outage must raise its own alert");
});

test("a single success among capacity failures keeps the restart path", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions started id=dddd0001 try=0 queued=0ms`,
    `${isoMinutesAgo(13)} POST /v1/chat/completions -> 429 60000ms queued=0ms try=2 id=dddd0001`,
    `${isoMinutesAgo(13)} POST /v1/chat/completions started id=dddd0002 try=0 queued=0ms`,
    `${isoMinutesAgo(12)} POST /v1/chat/completions -> 200 60000ms queued=0ms try=0 id=dddd0002`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-capacity"), "a mixed outcome is not a capacity outage");
});

test("a single stalled bot never triggers a host restart", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  const seenAt = Date.now() - 12 * 60_000;
  await writeFile(fx.stateFile, JSON.stringify({
    hostLogBytes: 1000,
    lastSpawnSeen: { [AGENT_A]: seenAt },
    lastAlert: {},
  }));
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=dddd4444 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=dddd4444`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 20)}\n`);

  await runWatchdog(fx);

  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "one stalled bot must not restart the host");
  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "no TERM for a single-bot stall");
});

test("fresh forwarder traffic suppresses the wedge restart", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(11)} POST /v1/chat/completions started id=eeee5555 try=0 queued=0ms`,
    `${isoMinutesAgo(5)} POST /v1/chat/completions -> 200 300000ms queued=0ms try=0 id=eeee5555`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "recent POST traffic must suppress the restart");
});

test("empty pgrep output is refused without touching the container", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=ffff6666 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=ffff6666`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  const stdout = await runWatchdog(fx, { FAKE_PGREP_EMPTY: "1" });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "no TERM may be issued when pgrep finds nothing");
});

test("a poisoned pgrep output is refused without touching the container", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=abab7777 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=abab7777`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx, { FAKE_PGREP_POISON: "1; touch /tmp/pwned" });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "poisoned pgrep output must never reach a kill line");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "a refused restart must not be reported as done");
  assert.ok(alerts.includes("host-wedge-restart-failed"), "a refused restart must raise its own alert");
});

test("a 403 probe resyncs the token on its own cooldown key", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, `#!/bin/sh\necho "push $RELAY_UPSTREAM_HOST token:$RELAY_TOKEN_OVERRIDE" >> "${fx.log}.pushes"\nexit 0\n`);
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 1);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(2)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 1)}\n`);

  await runWatchdog(fx, { FAKE_RELAY_CODE: "403" });

  const pushes = (await readFile(`${fx.log}.pushes`, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  assert.ok(pushes.length >= 1, "a 403 must trigger a token resync push");
  assert.ok(pushes.every((line) => line.includes("token:")), "every resync must carry the current token override");
  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "a 403 must not suppress wedge logic by killing the host");
});

test("spawn ingestion reads the tail file and seeds tracking from it", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  const spawnFile = `${fx.dir}/spawns.txt`;
  await writeFile(spawnFile, `irrelevant preamble\n[agent-isolation] spawned worker for agent ${AGENT_A} on thread 9 (pid 349, active workers: 1)\n`);
  // hostLogBytes=1 forces a tail read; the wedge itself is not the point here.
  await writeFile(fx.stateFile, JSON.stringify({ hostLogBytes: 1, lastSpawnSeen: {}, lastAlert: {} }));
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(2)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 20)}\n`);

  await runWatchdog(fx, { FAKE_SPAWN_FILE: spawnFile, FAKE_HOST_LOG_SIZE: "1000" });

  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.ok(state.lastSpawnSeen[AGENT_A] !== undefined, "the tail-read spawn must seed tracking");
  assert.ok(state.lastSpawnSeen[AGENT_A].seenAt > 0, "spawn tracking must carry a sighting time");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "one freshly-ingested spawn must not restart anything");
});

test("exec failures and the token never surface in alerts", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\necho boom >&2\nexit 1\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=acac8888 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=acac8888`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  const broken = `${fx.dir}/broken-docker.sh`;
  await writeFile(broken, "#!/bin/sh\nexit 127\n");
  await chmod(broken, 0o755);
  await runWatchdog(fx, { DOCKER: broken }).catch(() => {});

  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  // The header name may appear redacted; the secret value must never appear.
  assert.ok(!alerts.includes("test-key-123"), "alerts must never carry the raw key material");
  assert.ok(!alerts.includes("fixture-token-abc"), "alerts must never carry the fixture token value");
  assert.ok(!alerts.match(/x-relay-token:\s+(?!<redacted>)/), "any relay token in alerts must be redacted");
});

test("a broken relay hop suppresses the wedge restart (relay repair owns that case)", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 1\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(15)} POST /v1/chat/completions started id=cccc3333 try=0 queued=0ms`,
    `${isoMinutesAgo(14)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=cccc3333`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx, { FAKE_RELAY_CODE: "000", FAKE_STABLE_CODE: "000" });

  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "relay outage must not trigger a host restart");
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(!alerts.includes("host-wedge-restarted"), "relay outage is the repair path's case");
});

test("a stalled turn with recent inference traffic is reported as slow, not dead", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
  await seedToken(fx);
  // Stall is old, but the forwarder saw inference 2 minutes ago: the box is
  // working on a long turn, so this must NOT read as a wedge.
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(2)} POST /v1/chat/completions started id=efef0001 try=0 queued=0ms`,
    `${isoMinutesAgo(1)} POST /v1/chat/completions -> 200 90000ms queued=0ms try=0 id=efef0001`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    "",
  ].join("\n"));

  await runWatchdog(fx);

  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(alerts.includes("未重启任何进程"), `slow turn must be reported as such, got: ${alerts}`);
  assert.ok(!alerts.includes("host-wedge-restarted"), "slow turns must never trigger a host restart");
  const calls = await readFile(fx.log, "utf8");
  assert.ok(!calls.includes("kill -TERM"), "no TERM for a slow-but-inferring turn");
});

test("a green probe on a DHCP-baked upstream gets normalized to the stable name", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, `#!/bin/sh\necho "push $RELAY_UPSTREAM_HOST" >> "${fx.log}.pushes"\nexit 0\n`);
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 1);
  await seedToken(fx);
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(2)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 1)}\n`);

  const stdout = await runWatchdog(fx, { FAKE_UPSTREAM_ENV: "192.168.5.216" });

  assert.ok(stdout.includes("normalized relay upstream 192.168.5.216 -> host.internal"), `expected normalization log, got: ${stdout}`);
  const pushes = (await readFile(`${fx.log}.pushes`, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  assert.deepEqual(pushes, ["push host.internal"], "the push script must receive the stable upstream");
});

test("a recent successful outage repair does not silence upstream normalization", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, `#!/bin/sh\necho "push $RELAY_UPSTREAM_HOST" >> "${fx.log}.pushes"\nexit 0\n`);
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 1);
  await seedToken(fx);
  // The repair cooldown (30 min after success) is still running from an
  // earlier outage fix - normalization must not be silenced by it.
  const justNow = Date.now() - 60_000;
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  state.lastRepair = { "container-relay": justNow };
  state.lastRepairOk = { "container-relay": true };
  await writeFile(fx.stateFile, JSON.stringify(state));
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(2)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 1)}\n`);

  const stdout = await runWatchdog(fx, { FAKE_UPSTREAM_ENV: "192.168.5.216" });

  assert.ok(stdout.includes("normalized relay upstream 192.168.5.216 -> host.internal"), `normalization must not wait for the repair cooldown, got: ${stdout}`);
});
