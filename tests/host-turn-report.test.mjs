import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = "11111111-1111-4111-8111-111111111111";

async function bundle(entry, outName) {
  const out = path.join(repoRoot, "node_modules", ".cache", outName);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: out,
    logLevel: "error",
    external: ["node:*"],
  });
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)(out);
}

test("a turn report is the in-flight set, rewritten in place", async () => {
  const { buildTurnReport, writeTurnReport } = await bundle(
    "source/host/extensions/transcript/turn-report.ts",
    "host-turn-report.cjs",
  );
  const dir = await mkdtemp(path.join(tmpdir(), "turn-report-"));
  const file = path.join(dir, "sand-host-turns.json");
  try {
    const report = buildTurnReport(
      [{ agentId: AGENT, startedAt: 10, inFlight: 1 }, { agentId: "", startedAt: 10, inFlight: 1 }],
      50,
      7,
    );
    writeTurnReport(report, file);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      writtenAt: 50,
      pid: 7,
      turns: [{ agentId: AGENT, startedAt: 10, inFlight: 1 }],
    });
    writeTurnReport(buildTurnReport([], 80, 7), file);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).turns, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("begin and end of a session run publish the host's in-flight set", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "turn-report-live-"));
  const file = path.join(dir, "sand-host-turns.json");
  const previous = {
    SAND_TURN_REPORT: process.env.SAND_TURN_REPORT,
    SAND_TURN_REPORT_PATH: process.env.SAND_TURN_REPORT_PATH,
    SAND_DISABLE_RUN_SCHEDULER: process.env.SAND_DISABLE_RUN_SCHEDULER,
  };
  process.env.SAND_TURN_REPORT = "1";
  process.env.SAND_TURN_REPORT_PATH = file;
  process.env.SAND_DISABLE_RUN_SCHEDULER = "1";
  try {
    const { RunLifecycle } = await bundle(
      "source/host/extensions/transcript/run-lifecycle.ts",
      "host-turn-report-lifecycle.cjs",
    );
    const session = {
      id: AGENT,
      db: { close() {} },
      agentStore: { async dispose() {} },
    };
    const tm = {
      sendPipeline: { sendAttachmentBatchIds: new Map() },
      roster: { emitAgentUpdate() {}, liveSubagentParentIds: () => new Set() },
      sessions: {
        liveSessions: new Map(),
        activeSession: null,
        pendingSessionOpens: new Map(),
        async settledOpen() { return null; },
      },
      turnRuntime: { activeRequestPrompts: new Map(), activeRequestSources: new Map() },
      productAnalytics: { trackEvent() {} },
      groupChat: { isGroupSession: () => false },
      ackObligations: { scheduleAckRedriveAfterIdle() {} },
      runnerRegistry: { runners: new Map() },
    };
    const lifecycle = new RunLifecycle(tm);
    lifecycle.beginSessionRun(session);
    const running = JSON.parse(await readFile(file, "utf8"));
    assert.equal(running.turns.length, 1);
    assert.equal(running.turns[0].agentId, AGENT);
    assert.equal(running.turns[0].inFlight, 1);
    assert.ok(running.writtenAt > 0);
    lifecycle.endSessionRun(session);
    const idle = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(idle.turns, []);
    clearInterval(lifecycle.turnReportTimer);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
