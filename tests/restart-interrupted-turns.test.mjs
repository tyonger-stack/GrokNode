import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, outName) {
  const out = path.join(repoRoot, "node_modules", ".cache", outName);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, platform: "node", format: "cjs", outfile: out,
    logLevel: "error", external: ["node:*"],
  });
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)(out);
}

const lifecycle = await bundle(
  "source/host/extensions/transcript/run-lifecycle.ts",
  "restart-notice-lifecycle.cjs",
);
const { RunLifecycle } = lifecycle;

function fakeTranscriptManager(agentIds) {
  const appended = [];
  const sessions = new Map();
  for (const id of agentIds)
    sessions.set(id, { id, db: { appendTranscriptEntry: (e) => appended.push(e) } });
  return {
    appended,
    sessions,
    tm: {
      sendPipeline: { sendAttachmentBatchIds: new Map() },
      roster: { emitAgentUpdate() {}, liveSubagentParentIds: () => new Set() },
      sessions: { liveSessions: sessions, activeSession: null },
      appendEntry: (e) => appended.push(e),
      runnerRegistry: { isAwaitingUserSelection: () => false, interruptWedgedRunForWatchdog: () => true },
    },
  };
}

test("a restart announces every in-flight turn instead of dropping it silently", async () => {
  const { tm, appended, sessions } = fakeTranscriptManager(["agent-a", "agent-b"]);
  const manager = new RunLifecycle(tm);
  const sessionA = sessions.get("agent-a");
  const sessionB = sessions.get("agent-b");

  // Two turns in flight, plus one agent that is idle.
  manager.beginSessionRun(sessionA);
  manager.beginSessionRun(sessionB);

  const interrupted = manager.announceInterruptedRunsForRestart();
  assert.equal(interrupted, 2, "both in-flight turns must be reported");
  const notice = appended.filter((e) => typeof e.text === "string" && e.text.includes("ended without a reply"));
  assert.equal(notice.length, 2, "each interrupted turn gets its own transcript notice");
  assert.ok(
    notice.every((n) => n.text.includes("source: restart")),
    "the notice must name the restart as the cause",
  );
  assert.ok(
    appended.some((e) => e.role === "assistant" && String(e.content).includes("ended without a reply")),
    "a journal mirror entry keeps the failure visible to transcript readers",
  );
  // Each notice was routed to its own session (the text itself carries no id —
  // it lands in that agent's transcript).
  assert.equal(notice.length, 2, "one notice per interrupted agent, not one shared notice");
});

test("an idle fleet produces no notice at all", () => {
  const { tm, appended } = fakeTranscriptManager(["agent-a"]);
  const manager = new RunLifecycle(tm);
  assert.equal(manager.announceInterruptedRunsForRestart(), 0);
  assert.equal(appended.length, 0, "a clean shutdown must stay silent");
});

test("a notice failure never blocks the shutdown sweep", () => {
  const { tm, sessions } = fakeTranscriptManager(["agent-a"]);
  const manager = new RunLifecycle(tm);
  manager.beginSessionRun(sessions.get("agent-a"));
  // Break the session so the notice write throws.
  sessions.get("agent-a").db.appendTranscriptEntry = () => {
    throw new Error("db gone");
  };
  assert.doesNotThrow(() => manager.announceInterruptedRunsForRestart());
});
