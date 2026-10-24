import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(repoRoot, "scripts/clean-build.mjs"), "utf8");

test("the fidelity pipeline mounts both source-derived runtime ports before renderer patches", () => {
  const overlay = source.indexOf("await overlayCleanDistribution(");
  const agentData = source.indexOf("await applyAgentDataRuntimePort({ stageRoot });");
  const memoryImport = source.indexOf("await applyMemoryImportRuntimePort({ stageRoot });");
  const router = source.indexOf("await applyOriginalRendererRouterPatch({ stageRoot });");

  assert.ok(overlay !== -1 && agentData !== -1 && memoryImport !== -1 && router !== -1);
  assert.ok(overlay < agentData, "runtime ports must patch the overlaid Electron outputs");
  assert.ok(agentData < memoryImport, "memory import extends the main output already carrying agent data methods");
  assert.ok(memoryImport < router, "renderer patches must not invalidate runtime provenance ordering");
});
