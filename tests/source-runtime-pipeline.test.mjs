import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(repoRoot, "scripts/clean-build.mjs"), "utf8");

const mainEdge = await readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8");
const preload = await readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
const rpcTable = await readFile(path.join(repoRoot, "source/shared/rpc/main.ts"), "utf8");

test("agent data and memory import compile from their canonical source owners", () => {
  for (const method of ["getAgentDataOverview", "getAgentMemoryLog", "getAgentWorkflowContent", "importAgentMemory"]) {
    assert.match(mainEdge, new RegExp(method + ":\\s+async\\s+\\("), method + " must be owned by the main edge");
    assert.match(preload, new RegExp(method + ":\\s+\\("), method + " must be exposed by the preload bridge");
    assert.match(rpcTable, new RegExp(method + ":\\s*\\{\\s*args:\\s*\"object\"\\s*\\}"), method + " must be registered in the RPC table");
  }
  assert.doesNotMatch(source, /apply(AgentData|MemoryImport)RuntimePort/, "the clean-source pipeline must not re-inject methods it already compiled");
});
