import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const callOut = path.join(repoRoot, "node_modules", ".cache", "device-tool-call.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/packages/local-exec/device-tool-call.ts")],
  bundle: true, platform: "node", format: "cjs", outfile: callOut, logLevel: "error",
});
const {
  DEVICE_TOOL_MISSING_CONVERSATION, deviceToolCallServerMessage, isDeviceToolCallShape, parseDeviceToolCall,
} = require(callOut);

const providerOut = path.join(repoRoot, "node_modules", ".cache", "local-exec-provider-device.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/host/local-exec/local-exec-provider.ts")],
  bundle: true, platform: "node", format: "cjs", outfile: providerOut, logLevel: "error",
});
const { SandLocalExecProvider } = require(providerOut);

test("envelope parsing reproduces the cmr validation copies", () => {
  const valid = parseDeviceToolCall(deviceToolCallServerMessage("mac_read_notes", { query: "x" }, "conv-9"));
  assert.equal(valid.kind, "valid");
  assert.equal(valid.toolId, "mac_read_notes");
  assert.deepEqual(valid.input, { query: "x" });
  assert.equal(valid.conversationId, "conv-9");

  assert.equal(parseDeviceToolCall({ toolId: "not_a_tool", conversationId: "c", inputJson: "{}" }).error,
    'This Mac has no "not_a_tool" tool.');
  const noConversation = parseDeviceToolCall({ toolId: "mac_read_notes", conversationId: "", inputJson: "{}" });
  assert.equal(noConversation.error, DEVICE_TOOL_MISSING_CONVERSATION);
  assert.equal(noConversation.error, "The call names no conversation to run it for.");
  assert.equal(parseDeviceToolCall({ toolId: "mac_read_notes", conversationId: "c", inputJson: "[1]" }).error,
    "The mac_read_notes arguments are not a JSON object.");
  assert.deepEqual(parseDeviceToolCall({ toolId: "mac_read_notes", conversationId: "c", inputJson: undefined }).input, {});
  assert.equal(isDeviceToolCallShape({ toolId: "x", conversationId: "c" }), false);
  assert.equal(isDeviceToolCallShape(deviceToolCallServerMessage("x", {}, "c")), true);
});

function stubExecutor() {
  return {
    decodeServerMessage: (value) => { throw new Error(`codec must not see device calls: ${JSON.stringify(value)}`); },
    throwControl: (reason) => ({ error: reason }),
    execute: async function* () {},
    cancel: () => {},
  };
}

async function makeProvider(deviceTools) {
  const posted = [];
  const provider = new SandLocalExecProvider({
    resolveConnection: async () => ({ baseUrl: "http://127.0.0.1:9" }),
    executor: stubExecutor(),
    fetch: async (url, init) => {
      posted.push(...JSON.parse(init.body).frames);
      return { ok: true } ;
    },
    ...(deviceTools === undefined ? {} : { deviceTools }),
  });
  return { provider, posted };
}

test("a device-tool exec frame routes to the runner and returns its outcome as a client frame", async () => {
  const calls = [];
  const { provider, posted } = await makeProvider({
    callTool: async (toolId, input, options) => {
      calls.push({ toolId, input, conversationId: options.conversationId });
      return { status: "completed", value: { notes: [{ id: "n1" }] } };
    },
  });
  await provider.handleRequest({
    kind: "exec", requestId: "req-1",
    serverMessage: deviceToolCallServerMessage("mac_read_notes", { query: "groceries" }, "conv-42"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ toolId: "mac_read_notes", input: { query: "groceries" }, conversationId: "conv-42" }]);
  const reply = posted.find((frame) => frame.kind === "client" && frame.requestId === "req-1");
  assert.deepEqual(reply.message, { status: "completed", value: { notes: [{ id: "n1" }] } });
});

test("invalid envelopes and runner failures come back fail-visible", async () => {
  const { provider, posted } = await makeProvider({
    callTool: async () => ({ status: "failed", error: { code: "sidecar_missing", message: "sidecar_missing no helper." } }),
  });
  await provider.handleRequest({ kind: "exec", requestId: "req-bad", serverMessage: { toolId: "whatever", conversationId: "c", inputJson: "{}" } });
  await provider.handleRequest({
    kind: "exec", requestId: "req-fail",
    serverMessage: deviceToolCallServerMessage("mac_read_notes", {}, "conv-42"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const bad = posted.find((frame) => frame.kind === "client" && frame.requestId === "req-bad");
  assert.deepEqual(bad.message, { status: "failed", error: { code: "unsupported", message: 'This Mac has no "whatever" tool.' } });
  const failed = posted.find((frame) => frame.kind === "client" && frame.requestId === "req-fail");
  assert.deepEqual(failed.message, { status: "failed", error: { code: "sidecar_missing", message: "sidecar_missing no helper." } });
});

test("without the deviceTools port the envelope falls through to the codec like before", async () => {
  const { provider, posted } = await makeProvider(undefined);
  await provider.handleRequest({
    kind: "exec", requestId: "req-legacy",
    serverMessage: deviceToolCallServerMessage("mac_read_notes", {}, "conv-1"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const control = posted.find((frame) => frame.kind === "control" && frame.requestId === "req-legacy");
  assert.match(control.message.error, /codec must not see device calls/);
});
