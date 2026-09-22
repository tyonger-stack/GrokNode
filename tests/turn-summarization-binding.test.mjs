import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

test("local provider turns expose the summarization session consumed by the production Agent", async () => {
  const cache = path.join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, "turn-summary-"));
  const keys = ["SAND_DATA_ROOT", "SAND_OPENROUTER_MODEL", "SAND_CODEX_MODEL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.SAND_DATA_ROOT = temporary;
    process.env.SAND_OPENROUTER_MODEL = "fixture/openrouter";
    process.env.SAND_CODEX_MODEL = "fixture-codex";
    const outfile = path.join(temporary, "turn.cjs");
    await build({ entryPoints: [path.join(root, "source/host/runner/turn-run-shell.ts")], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const { createTurnAgentRunContext } = createRequire(import.meta.url)(outfile);
    for (const provider of ["openrouter", "codex"]) {
      await writeFile(path.join(temporary, "settings.json"), JSON.stringify({ version: 1, inferenceProvider: provider }));
      const run = await createTurnAgentRunContext({
        context: {}, conversationId: "fixture", requestId: "fixture",
        inference: { resolvePrivacyMode: () => 0 }, onRequestId() {},
        isSubagentRunner: false, isSilenceAllowed: false,
        canUseSelfSummary: () => false, cancelThisRun() {}, emittedConnectorCards: new Set(),
      });
      try {
        assert.ok(run.summarizationSession, provider + " must bind the production summarization owner");
        assert.equal(run.summarizationSession, run.sessions.summarization);
        assert.equal(typeof run.summarizationSession.getExecutor, "function");
      } finally { run.dispose(); }
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(temporary, { recursive: true });
  }
});
