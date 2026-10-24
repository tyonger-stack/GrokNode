import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(repoRoot, "scripts/clean-build.mjs"), "utf8");

test("the fidelity pipeline mounts both source-derived runtime ports after audit overlay", () => {
  const overlay = source.indexOf("await overlayAuditMetadata(clean, { stageRoot });");
  const agentData = source.indexOf("await applyAgentDataRuntimePort({ stageRoot });");
  const memoryImport = source.indexOf("await applyMemoryImportRuntimePort({ stageRoot });");
  const pack = source.indexOf("await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });");

  assert.ok(overlay !== -1 && agentData !== -1 && memoryImport !== -1 && pack !== -1);
  assert.ok(overlay < agentData, "runtime ports must run after the clean Electron main overlay");
  assert.ok(agentData < memoryImport, "memory import extends the main output already carrying agent data methods");
  assert.ok(memoryImport < pack, "runtime provenance must be present before the archive is packed");
});
