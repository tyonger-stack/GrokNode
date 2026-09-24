import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compositionPath = path.join(repoRoot, "source/host/host-runner-composition.ts");
const toolsetPath = path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts");

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

test("the production turn provider exposes MCP discovery and invocation tools", async () => {
  const source = await readFile(compositionPath, "utf8");
  const providerStart = source.indexOf("const provider: TurnToolsetHostFactoryProvider = {");
  const providerEnd = source.indexOf("if (state === undefined) return provider;", providerStart);
  assert.notEqual(providerStart, -1, "the production turn provider must exist");
  assert.notEqual(providerEnd, -1, "the production turn provider must have a bounded definition");
  const provider = source.slice(providerStart, providerEnd);
  assert.match(
    provider,
    /createMcpMetaToolInputs:[\s\S]{0,700}getMcpTools:\s*\(\)\s*=>\s*props\.mcpTools\s*\?\?\s*turn\.mcpTools\s*\?\?\s*\[\]/,
    "the model toolset must receive this step's discovered MCP descriptors",
  );
  assert.match(
    provider,
    /validateMcpToolDescriptors:\s*true/,
    "MCP calls must be validated against the descriptors exposed for the current turn",
  );
});

test("the production turn resource accessor contains the host MCP executor", async () => {
  const source = await readFile(compositionPath, "utf8");
  assert.ok(
    /const mcpForTurn:\s*TurnMcpProjectionInput\["mcpForTurn"\]\s*\|\s*undefined\s*=[\s\S]{0,900}createExecutor:\s*\(persistImage, spillLargeText, auditIdentity\)/.test(source),
    "the per-turn accessor must bind the host MCP executor and state executor",
  );
  assert.ok(
    /mcpProjection === undefined \? \{\} : \{ mcp: mcpProjection \}/.test(source),
    "the host MCP projection must be included in the returned per-turn resource inputs",
  );
});

test("the turn tool placement gate activates for discovered MCP descriptors", async () => {
  const source = await readFile(toolsetPath, "utf8");
  assert.ok(
    /props\?\.mcpTools\?\.length\s*\?\?\s*0\)\s*>\s*0/.test(source),
    "discovered MCP tools must activate the GetMcpTools and CallMcpTool pair",
  );
});
