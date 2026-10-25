import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outfile = path.join(repoRoot, "node_modules", ".cache", "apple-apps-runner.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/local-exec-daemon/apple-apps/runner.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const { AppleAppsToolRunner, appleAppsEnabled, resolveAppleSidecarLaunch } = require(outfile);

const HELPER = `
let line = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  line += chunk;
  for (;;) {
    const n = line.indexOf("\\n"); if (n < 0) break;
    const raw = line.slice(0, n); line = line.slice(n + 1);
    if (!raw.trim()) continue;
    const msg = JSON.parse(raw);
    const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
    if (msg.method === "initialize") {
      say({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } });
    } else if (msg.method === "tools/call") {
      const call = msg.params;
      if (call.name === "apple-events/run" && call.arguments?.op === "search") {
        say({ jsonrpc: "2.0", id: msg.id, result: { structuredContent: { notes: [{ id: "n1", title: call.arguments.args.query }] } } });
      } else {
        say({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "unexpected tool" } });
      }
    }
  }
});
`;

test("runner walks toolId → est dispatch → MCP apple-events/run → structured reply", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = path.join(dir, "helper.mjs");
  await writeFile(helper, HELPER);

  const runner = new AppleAppsToolRunner({
    launch: async () => ({ command: process.execPath, args: [helper] }),
    spawnImpl: (c, a, o) => spawn(c, a, o),
  });
  t.after(() => runner.close());

  const outcome = await runner.callTool("mac_read_notes", { query: "groceries" }, { conversationId: "conv-1" });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.value, { notes: [{ id: "n1", title: "groceries" }] });

  const unsupported = await runner.callTool("ios_read_reminders", {}, { conversationId: "conv-1" });
  assert.equal(unsupported.status, "failed");
  assert.equal(unsupported.error.code, "unsupported");
  assert.equal(unsupported.error.message, 'This Mac has no "ios_read_reminders" tool.');

  const invalid = await runner.callTool("mac_write_notes", {}, { conversationId: "conv-1" });
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.error.code, "invalid_input");
});

test("the grok_bot_apple_apps gate resolves through the 0721 feature table", () => {
  assert.equal(appleAppsEnabled({}), true);
  assert.equal(appleAppsEnabled({ GROK_NODE_0721_FEATURES: "0" }), false);
  assert.equal(appleAppsEnabled({ SAND_FEATURE_GATE_OVERRIDES: "grok_bot_apple_apps=0" }), false);
  assert.equal(appleAppsEnabled({ SAND_FEATURE_GATE_OVERRIDES: "grok_bot_apple_apps=1" }), true);
});

test("sidecar launch resolution honors GROK_NODE_SIDECAR_APP and app-name descriptors", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-launch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(resolveAppleSidecarLaunch({}), undefined);
  assert.equal(resolveAppleSidecarLaunch({ GROK_NODE_SIDECAR_APP: "/no/such.app" }), undefined);

  const fakeApp = path.join(dir, "Grok Bot Computer Use.app", "Contents", "MacOS");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(fakeApp, { recursive: true });
  await writeFile(path.join(fakeApp, "CUGrokBotService"), "#!/bin/sh\nexit 0\n");
  const launch = resolveAppleSidecarLaunch({ GROK_NODE_SIDECAR_APP: path.join(dir, "Grok Bot Computer Use.app") });
  assert.deepEqual(launch, { command: path.join(fakeApp, "CUGrokBotService"), args: [] });

  const missing = resolveAppleSidecarLaunch({ GROK_NODE_SIDECAR_APP: path.join(dir, "Unknown Helper.app") });
  assert.equal(missing, undefined);
});

test("a missing sidecar surfaces sidecar_missing without spawning anything", async () => {
  let spawned = 0;
  const runner = new AppleAppsToolRunner({
    env: {},
    spawnImpl: (c, a, o) => { spawned += 1; return spawn(c, a, o); },
  });
  const outcome = await runner.callTool("mac_read_notes", { query: "x" });
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.error.message.startsWith("sidecar_not_running"), outcome.error.message);
  assert.ok(outcome.error.message.includes("could not be prepared"), outcome.error.message);
  assert.equal(spawned, 0);
});
