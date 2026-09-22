import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compositionPath = path.join(repoRoot, "source/host/host-runner-composition.ts");

const TASK_INPUTS_PATTERN = /createTaskToolInputs: \(turn\): TurnTaskToolFactoryInput/;
const TASK_CONFIG_PATTERN = /subagentConfigs: \(turn\.subagentConfigs/;
const BASE_TURN_PATTERN = /subagentConfigs: builtinSubagentConfigs\(method\(remoteBox, "isAvailable"\)\?\.\(\) !== false\)/;

test("the production turn toolset provider supplies Task inputs", async () => {
  const source = await readFile(compositionPath, "utf8");
  assert.match(
    source,
    TASK_INPUTS_PATTERN,
    "createTurnToolsetFactoryProvider must build Task inputs from the turn subagent configs",
  );
  assert.match(
    source,
    TASK_CONFIG_PATTERN,
    "the Task inputs must read subagentConfigs from the turn rather than a literal",
  );
});

test("the production turn seeds subagent configs from the box availability probe", async () => {
  const source = await readFile(compositionPath, "utf8");
  assert.match(
    source,
    BASE_TURN_PATTERN,
    "baseTurn.subagentConfigs must be seeded from builtinSubagentConfigs",
  );
  assert.doesNotMatch(source, /subagentConfigs: \[\]/, "the hardcoded empty subagent config list must not return");
});
