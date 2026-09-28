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
echo "$5" >> "$FAKE_DOCKER_LOG"
case "$5" in
  *"wc -c <"*) echo "\${FAKE_HOST_LOG_SIZE:-1000}" ;;
  *"tail -c +"/"sand-host.log"*) cat "\$FAKE_SPAWN_FILE" 2>/dev/null ;;
  *"agent-transcripts"*) cat "\$FAKE_TRANSCRIPT_FILE" 2>/dev/null ;;
  *"profile.json"*) echo '{"name":"测试Bot"}' ;;
  *"127.0.0.1:10100"*) echo "\${FAKE_RELAY_CODE:-200}" ;;
  *"host.internal:11010"*) echo "\${FAKE_STABLE_CODE:-200}" ;;
  *"RELAY_UPSTREAM_HOST=//p"*) echo "\${FAKE_UPSTREAM_ENV:-host.internal}" ;;
  *"automations/"*"webhook.json"*) echo '{"key":"test-key-123"}' ;;
  *"pgrep"*)
    n=$(cat "\$FAKE_PID_COUNTER" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "\$FAKE_PID_COUNTER"
    echo $((100 + n))
    ;;
  *"kill -TERM"*) exit 0 ;;
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
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        if (error && error.code !== 1) reject(new Error(String(stderr || error.message)));
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

  // Ephemeral receiver for the canary webhook wake.
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(202, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const stdout = await runWatchdog(fx, { CANARY_PORT: String(port) });
  server.close();

  const alerts = await readFile(fx.alerts, "utf8");
  assert.ok(alerts.includes("host-wedge-restarted"), `expected restart alert, got: ${alerts}`);
  assert.ok(stdout.includes("host pid 101 -> 102"), `expected respawn log, got: ${stdout}`);
  assert.ok(stdout.includes("host-wedge signature"), `expected signature log, got: ${stdout}`);
  const calls = await readFile(fx.log, "utf8");
  assert.ok(calls.includes("kill -TERM 101"), `expected TERM against pgrep'd pid, got: ${calls}`);

  // Canary wake actually left the watchdog and carried the selftest contract.
  assert.equal(received.length, 1, "canary wake must be delivered exactly once");
  assert.ok(received[0].url.includes(`/webhook/${CANARY_AGENT_ID}/feishu-p2p`));
  assert.equal(received[0].auth, "Bearer test-key-123");
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.selftest, true);
  assert.equal(payload.source, "watchdog-hostrestart");

  // Restart cooldown is persisted with its outcome.
  const state = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(state.lastHostRestart["host-main"].ok, true);
  assert.ok(state.canary && state.canary.agentId === CANARY_AGENT_ID);

  // Second pass: canary transcript now fresh -> canary verdict resolves; the
  // success cooldown must prevent a second restart.
  await writeFile(fx.transcriptFile, [
    transcriptLine(AGENT_A, 20),
    transcriptLine(AGENT_B, 22),
    transcriptLine(CANARY_AGENT_ID, 0),
    "",
  ].join("\n"));
  const stdout2 = await runWatchdog(fx, { CANARY_PORT: String(port) }).catch(() => "");
  const calls2 = await readFile(fx.log, "utf8");
  assert.equal((calls2.match(/kill -TERM/g) || []).length, 1, "cooldown must block a second restart");
  const state2 = JSON.parse(await readFile(fx.stateFile, "utf8"));
  assert.equal(state2.canary, null, "fresh canary transcript must clear the pending canary");
});

test("an in-flight inference suppresses the wedge restart (slow, not wedged)", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 0\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
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

test("a broken relay hop suppresses the wedge restart (relay repair owns that case)", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, "#!/bin/sh\nexit 1\n");
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 12);
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

test("a green probe on a DHCP-baked upstream gets normalized to the stable name", async () => {
  const fx = await makeFixtures();
  await writeFile(fx.repairScript, `#!/bin/sh\necho "push $RELAY_UPSTREAM_HOST" >> "${fx.log}.pushes"\nexit 0\n`);
  await chmod(fx.repairScript, 0o755);
  await seedState(fx, 1);
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
