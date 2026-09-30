import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const WATCHDOG = new URL("../tools/ocx-relay/turn-watchdog.mjs", import.meta.url).pathname;

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function runWatchdog(dir, extraEnv = {}) {
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
          DOCKER: "/bin/false",
          RELAY_DIR: dir,
          WATCHDOG_STATE: path.join(dir, "state.json"),
          WATCHDOG_ALERTS: path.join(dir, "alerts.log"),
          FORWARDER_LOG: path.join(dir, "forwarder.log"),
          INFLIGHT_SOURCE: "log",
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

test("inflight check drops requests started before a forwarder restart marker", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  await writeFile(
    path.join(dir, "forwarder.log"),
    [
      `${isoMinutesAgo(25)} POST /v1/chat/completions started id=deadbeef try=0 queued=0ms`,
      `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
      "",
    ].join("\n"),
  );
  await runWatchdog(dir);
  const alerts = await readFile(path.join(dir, "alerts.log"), "utf8").catch(() => "");
  assert.ok(!alerts.includes("deadbeef"), "pre-restart started-only entry must not alert");
});

test("a lone hung request with no completions is reported as an upstream outage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  await writeFile(
    path.join(dir, "forwarder.log"),
    [
      `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
      `${isoMinutesAgo(15)} POST /v1/chat/completions started id=cafe1234 try=0 queued=0ms`,
      "",
    ].join("\n"),
  );
  await runWatchdog(dir);
  const alerts = await readFile(path.join(dir, "alerts.log"), "utf8");
  // 2026-09-30: one request that never completes while nothing else does is
  // indistinguishable from an upstream/network outage, and reporting it as
  // such names the cause instead of the symptom.
  assert.ok(
    alerts.includes("upstream-outage"),
    `a lone silent request must report as an outage, got: ${alerts}`,
  );
});

test("inflight check stays silent for ids with terminal lines", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  await writeFile(
    path.join(dir, "forwarder.log"),
    [
      `${isoMinutesAgo(15)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
      `${isoMinutesAgo(14)} POST /v1/chat/completions started id=face0123 try=0 queued=0ms`,
      `${isoMinutesAgo(12)} POST /v1/chat/completions -> 200 30000ms queued=0ms try=0 id=face0123`,
      "",
    ].join("\n"),
  );
  await runWatchdog(dir);
  const alerts = await readFile(path.join(dir, "alerts.log"), "utf8").catch(() => "");
  assert.ok(!alerts.includes("face0123"), "completed request must not alert");
});

test("the forwarder's live inflight table overrides a ghost started-line", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  await writeFile(
    path.join(dir, "forwarder.log"),
    [
      `${isoMinutesAgo(60)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4 total=900000ms)`,
      `${isoMinutesAgo(40)} POST /v1/chat/completions started id=4209373a try=0 queued=0ms`,
      `${isoMinutesAgo(40)} POST /v1/chat/completions retry id=4209373a attempt=1 in=2295ms`,
      `${isoMinutesAgo(1)} POST /v1/chat/completions started id=dddd0001 try=0 queued=0ms`,
      `${new Date().toISOString()} POST /v1/chat/completions -> 200 1000ms queued=0ms try=0 id=dddd0001`,
      "",
    ].join("\n"),
  );
  await runWatchdog(dir, {
    INFLIGHT_SOURCE: "json",
    FORWARDER_INFLIGHT_JSON: JSON.stringify({
      maxTotalMs: 900000,
      entries: [{ id: "abcd1234", started: Date.now() - 12 * 60_000, ageMs: 12 * 60_000, try: 0, phase: "upstream" }],
    }),
  });
  const alerts = await readFile(path.join(dir, "alerts.log"), "utf8");
  assert.ok(alerts.includes("[inflight:abcd1234]"), `the live entry must be reported, got: ${alerts}`);
  assert.ok(alerts.includes("inflight-accounting:4209373a"), "the log ghost must be named as accounting");
  assert.ok(!alerts.includes("[inflight:4209373a]"), "the log ghost must not be reported as in flight");
});

test("an open condition reminds on the schedule and then stops", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  const id = "cafe1234";
  await writeFile(
    path.join(dir, "forwarder.log"),
    [
      `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
      `${isoMinutesAgo(12)} POST /v1/chat/completions started id=${id} try=0 queued=0ms`,
      `${isoMinutesAgo(1)} POST /v1/chat/completions -> 200 5000ms queued=0ms try=0 id=dddd0001`,
      `${isoMinutesAgo(2)} POST /v1/chat/completions started id=dddd0001 try=0 queued=0ms`,
      "",
    ].join("\n"),
  );
  // The completion is listed before its start so the tail parser still pairs
  // them: started sets the id, the earlier line is a different id's terminal.
  await writeFile(path.join(dir, "state.json"), JSON.stringify({
    hostLogBytes: 0,
    lastSpawnSeen: {},
    lastAlert: {},
    conditions: {
      [`inflight:${id}`]: { open: true, since: Date.now() - 20 * 60_000, lastSent: Date.now() - 16 * 60_000, reminders: 0 },
    },
  }));
  await runWatchdog(dir, { REMINDER_GAPS_MS: "900000,3600000,14400000" });
  const reminded = await readFile(path.join(dir, "alerts.log"), "utf8");
  assert.equal((reminded.match(/\[inflight:cafe1234\]/g) || []).length, 1, "one reminder once the gap has elapsed");

  const remindedState = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
  remindedState.conditions[`inflight:${id}`].reminders = 3;
  remindedState.conditions[`inflight:${id}`].lastSent = Date.now() - 24 * 60 * 60_000;
  await writeFile(path.join(dir, "state.json"), JSON.stringify(remindedState));
  await runWatchdog(dir, { REMINDER_GAPS_MS: "900000,3600000,14400000" });
  const stopped = await readFile(path.join(dir, "alerts.log"), "utf8");
  assert.equal((stopped.match(/\[inflight:cafe1234\]/g) || []).length, 1, "reminders stop after the schedule is exhausted");
});

test("a finished request closes the inflight condition with one recovery", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wd-inflight-"));
  const openLog = [
    `${isoMinutesAgo(20)} relay listening on 0.0.0.0:11010 -> 127.0.0.1:10100 (chat slots=2 queue=4)`,
    `${isoMinutesAgo(12)} POST /v1/chat/completions started id=cafe1234 try=0 queued=0ms`,
    `${isoMinutesAgo(1)} POST /v1/chat/completions -> 200 4000ms queued=0ms try=0 id=dddd0001`,
    `${isoMinutesAgo(2)} POST /v1/chat/completions started id=dddd0001 try=0 queued=0ms`,
    "",
  ].join("\n");
  await writeFile(path.join(dir, "forwarder.log"), openLog);
  await runWatchdog(dir);
  await writeFile(
    path.join(dir, "forwarder.log"),
    openLog + `${isoMinutesAgo(0)} POST /v1/chat/completions -> 200 8000ms queued=0ms try=0 id=cafe1234\n`,
  );
  await runWatchdog(dir);
  const alerts = await readFile(path.join(dir, "alerts.log"), "utf8");
  assert.ok(alerts.includes("[inflight:cafe1234-recovered]"), `expected a recovery notice, got: ${alerts}`);
  assert.equal((alerts.match(/\[inflight:cafe1234\]/g) || []).length, 1, "the hang itself was one event");
});
