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

function runWatchdog(dir) {
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
