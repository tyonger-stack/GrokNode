import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compositionPath = path.join(repoRoot, "source/host/host-runner-composition.ts");

test("the tool projections inject the turn toolset factory provider into props", async () => {
  const source = await readFile(compositionPath, "utf8");
  assert.match(
    source,
    /const projection = \{\s+turnToolsetFactoryProvider: createTurnToolsetFactoryProvider\(\s+hostDependencies\(\),\s+input,?\s*\)/,
    "createTurnToolProjections must inject a provider built with the turn inputs",
  );
});

test("the projection provider is the one carrying Task inputs", async () => {
  const source = await readFile(compositionPath, "utf8");
  assert.match(
    source,
    /createTaskToolInputs: \(turn\): TurnTaskToolFactoryInput/,
    "createTurnToolsetFactoryProvider must build Task inputs",
  );
  assert.match(
    source,
    /subagentConfigs: \(turn\.subagentConfigs/,
    "Task inputs must read subagentConfigs from the turn",
  );
});

