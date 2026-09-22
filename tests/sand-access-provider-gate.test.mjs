import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSharedModule(relativePath) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("sand access is local-only for both supported inference providers", async () => {
  const { sandAccessForInferenceProvider, SAND_ACCESS_GRANTED } = await loadSharedModule("source/shared/sand-access.ts");
  const blocked = { state: "unavailable", reason: "freeTrialAvailable" };
  for (const provider of ["codex", "openrouter"]) {
    assert.deepEqual(sandAccessForInferenceProvider(provider, blocked), SAND_ACCESS_GRANTED);
    assert.deepEqual(sandAccessForInferenceProvider(provider, { state: "checking", reason: "unspecified" }), SAND_ACCESS_GRANTED);
  }
});

test("the production account adapter is local-only", async () => {
  const adapter = await readFile(path.join(repoRoot, "source/electron-main/adapters/account-edge.ts"), "utf8");
  assert.doesNotMatch(adapter, /cursor-auth-wiring|SandAccess|DashboardService/);
  assert.match(adapter, /LocalTranscriptionManager/);
  assert.doesNotMatch(adapter, /getInferenceProvider/);
});
