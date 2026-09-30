import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// The watchdog's outage handling lives in an external script; exercise it the
// way it runs in production — one process per loop, state carried in a file.
const WATCHDOG = new URL("../tools/ocx-relay/turn-watchdog.mjs", import.meta.url).pathname;

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

const FAKE_DOCKER = `#!/bin/sh
echo "$5" >> "$FAKE_DOCKER_LOG"
case "$5" in
  *"wc -c <"*) echo "\${FAKE_HOST_LOG_SIZE:-1000}" ;;
  *"agent-transcripts"*) cat "\$FAKE_TRANSCRIPT_FILE" 2>/dev/null ;;
  *"profile.json"*) echo '{"name":"测试Bot"}' ;;
  *"127.0.0.1:10100"*) echo "\${FAKE_RELAY_CODE:-200}" ;;
  *"host.internal:11010"*) echo "\${FAKE_STABLE_CODE:-200}" ;;
  *) exit 0 ;;
esac
`;

async function makeFixtures() {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-outage-"));
  const fakeDocker = `${dir}/fake-docker.sh`;
  await writeFile(fakeDocker, FAKE_DOCKER);
  await chmod(fakeDocker, 0o755);
  return {
    dir,
    fakeDocker,
    log: `${dir}/docker-calls.log`,
    stateFile: `${dir}/state.json`,
    alerts: `${dir}/alerts.log`,
    forwarderLog: `${dir}/forwarder.log`,
    transcriptFile: `${dir}/transcripts.txt`,
  };
}

function transcriptLine(agentId, minutesAgo) {
  const seconds = (Date.now() - minutesAgo * 60_000) / 1000;
  return `${seconds.toFixed(6)} /home/box/sand-data/agent-transcripts/${agentId}/${agentId}.jsonl`;
}

async function runLoop(fx, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [WATCHDOG],
      {
        timeout: 30_000,
        env: {
          ...process.env,
          RUN_ONCE: "1",
          MACOS_NOTIFY: "0",
          ALERT_COMMAND: "",
          HOST_RESTART_ENABLED: "0",
          DOCKER: fx.fakeDocker,
          RELAY_DIR: fx.dir,
          WATCHDOG_STATE: fx.stateFile,
          WATCHDOG_ALERTS: fx.alerts,
          FORWARDER_LOG: fx.forwarderLog,
          FAKE_DOCKER_LOG: fx.log,
          FAKE_TRANSCRIPT_FILE: fx.transcriptFile,
          ...extraEnv,
        },
      },
      (error, stdout) => {
        if (error && error.code !== 1) reject(new Error(String(error.message).slice(0, 300)));
        else resolve(stdout);
      },
    );
  });
}

// A full outage: two requests started long ago, NOTHING completed since.
function outageLog() {
  return [
    `${isoMinutesAgo(30)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(28)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(26)} POST /v1/chat/completions started id=bbbb2222 try=0 queued=0ms`,
    "",
  ].join("\n");
}

test("a full outage raises one aggregated notice, not one per request", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.forwarderLog, outageLog());
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 40)}\n`);

  const stdout = await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");

  assert.ok(alerts.includes("upstream-outage"), `expected an outage notice, got: ${alerts}`);
  assert.ok(alerts.includes("上游无响应"), "the outage notice must name the condition");
  assert.ok(!alerts.includes("inflight:aaaa1111"), "per-request inflight notices must be suppressed during an outage");
  assert.ok(!alerts.includes("inflight:bbbb2222"), "per-request inflight notices must be suppressed during an outage");
  assert.equal(
    (alerts.match(/\[upstream-outage\]/g) || []).length,
    1,
    "one outage, one notice",
  );
  assert.ok(stdout.includes("upstream outage"), "the outage is logged with its duration");
});

test("an outage keeps quiet on later loops until it recovers", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.forwarderLog, outageLog());
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 40)}\n`);

  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const first = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.equal((first.match(/\[upstream-outage\]/g) || []).length, 1);

  // Two more loops while still down: the long outage cooldown keeps it to one.
  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const later = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.equal(
    (later.match(/\[upstream-outage\]/g) || []).length,
    1,
    "a continuing outage must not re-alert on every loop",
  );
});

test("stall alerts are suppressed while the outage is active", async () => {
  const fx = await makeFixtures();
  // Outage plus two agents that look stalled: the outage already explains it.
  await writeFile(fx.forwarderLog, [
    ...outageLog().trimEnd().split("\n"),
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 40),
    transcriptLine(AGENT_B, 42),
    "",
  ].join("\n"));
  const seenAt = Date.now() - 20 * 60_000;
  await writeFile(fx.stateFile, JSON.stringify({
    hostLogBytes: 1000,
    lastSpawnSeen: { [AGENT_A]: seenAt, [AGENT_B]: seenAt },
    lastAlert: {},
  }));

  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");

  assert.ok(alerts.includes("upstream-outage"), "the root cause is still reported");
  assert.ok(
    !alerts.includes("疑似卡死"),
    `stall spam must be suppressed during an outage, got: ${alerts}`,
  );
});

test("a completed request means a slow upstream, not an outage", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(30)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(28)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(3)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=aaaa1111`,
    // A different request is still stuck, but the upstream as a whole is
    // demonstrably completing work — so this is not an outage.
    `${isoMinutesAgo(27)} POST /v1/chat/completions started id=cccc3333 try=0 queued=0ms`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 40)}\n`);

  await runLoop(fx, { FORWARDER_PROBE_RESULT: "ok" });
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");

  assert.ok(!alerts.includes("upstream-outage"), "a completing request rules out an outage");
  assert.ok(alerts.includes("inflight:cccc3333"), "the still-hung request keeps its own notice");
});

test("silence alone never opens an outage — it needs a seen-failing relay", async () => {
  const fx = await makeFixtures();
  // 2026-09-30 production false positive: one request wedged 40 minutes ago
  // and the fleet then went quiet on its own, with the relay answering the
  // whole time. Reporting that as an outage named the wrong cause.
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(60)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(40)} POST /v1/chat/completions started id=35ce8716 try=2 queued=0ms`,
    "",
  ].join("\n"));
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 40)}\n`);
  await writeFile(fx.stateFile, JSON.stringify({ hostLogBytes: 1000, lastSpawnSeen: {}, lastAlert: {} }));

  // The relay-probe signal is recorded from the PREVIOUS loop (this check
  // runs before the probe), so run twice before judging: an answering relay
  // must keep the outage shut no matter how long the chat side is silent.
  await runLoop(fx, { FORWARDER_PROBE_RESULT: "ok" });
  await runLoop(fx, { FORWARDER_PROBE_RESULT: "ok" });
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(state.outageSince, null, "an answering relay must not open an outage");

  // With the relay failing, the same silence IS an outage.
  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(alerts.includes("upstream-outage"), `a failing relay must open an outage, got: ${alerts}`);
});

test("recovery is announced and clears the outage state", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.forwarderLog, outageLog());
  await writeFile(fx.transcriptFile, `${transcriptLine(AGENT_A, 40)}\n`);

  await runLoop(fx, { FORWARDER_PROBE_RESULT: "fail" });
  const during = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.ok(typeof during.outageSince === "number", "an active outage is persisted");

  // Network back: a request completes, nothing is hung any more.
  await writeFile(fx.forwarderLog, [
    `${isoMinutesAgo(30)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(28)} POST /v1/chat/completions started id=aaaa1111 try=0 queued=0ms`,
    `${isoMinutesAgo(1)} POST /v1/chat/completions -> 200 5000ms queued=0ms try=0 id=aaaa1111`,
    "",
  ].join("\n"));

  const stdout = await runLoop(fx, { FORWARDER_PROBE_RESULT: "ok" });
  const alerts = await readFile(fx.alerts, "utf8").catch(() => "");
  assert.ok(stdout.includes("upstream recovered"), "recovery is logged");
  assert.ok(alerts.includes("upstream-recovered"), "recovery is announced once");
  const after = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(after.outageSince, null, "the outage state clears on recovery");
});
