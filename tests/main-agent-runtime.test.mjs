import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const cache = path.resolve("node_modules/.cache/main-agent-runtime.mjs");
mkdirSync(path.dirname(cache), { recursive: true });
await build({ stdin: { contents: 'export { createMainEdgeHandlers } from "./source/electron-main/main-edge.ts";', resolveDir: process.cwd() }, outfile: cache, bundle: true, platform: "node", format: "esm", packages: "external", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, logLevel: "error" });
const { createMainEdgeHandlers } = await import(pathToFileURL(cache).href);

test("explicit default-main creation reaches the host creation command", async () => {
  const calls = [];
  const handlers = createMainEdgeHandlers({
    readHostSettingsFromBox: async () => ({ mainAgentId: null }),
    requestMainAgent: async (method, args) => {
      calls.push({ method, args });
      return { agentId: "new-primary", outcome: "created" };
    }
  });
  assert.deepEqual(await handlers.ensureHostMainAgent({}), { agentId: "new-primary", outcome: "created" });
  assert.deepEqual(calls, [{ method: "ensureDefaultMainAgent", args: {} }]);
});

test("setting the main bot uses the validating host command", async () => {
  const calls = [];
  const handlers = createMainEdgeHandlers({
    requestMainAgent: async (method, args) => { calls.push({ method, args }); return { agentId: args.agentId }; }
  });
  assert.equal(await handlers.setHostMainAgent({ agentId: "bot-one" }), "bot-one");
  assert.deepEqual(calls, [{ method: "setMainAgent", args: { agentId: "bot-one" } }]);
});
