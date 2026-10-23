import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, "node_modules", ".cache", "visualize-tool-0721");
await mkdir(cacheDir, { recursive: true });
async function bundleModules(names, outfile) {
  await build({
    stdin: {
      resolveDir: repoRoot,
      contents: names.map((name) => `export * from "./source/${name}.ts";`).join("\n"),
    },
    bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent",
    mainFields: ["module", "main"],
    banner: { js: `import { createRequire as createVisualizeTestRequire } from "node:module"; const require = createVisualizeTestRequire(${JSON.stringify(path.join(repoRoot, "package.json"))});` },
  });
  return import(pathToFileURL(outfile).href);
}
const m = await bundleModules([
  "host/extensions/session/agent-db",
  "host/extensions/transcript/turn-runtime",
  "host/extensions/transcript/visualization-pages",
  "host/extensions/transcript/send-thread-stamping",
  "host/runner/tools/turn-toolset",
  "host/runner/tools/send-message-encoding",
  "packages/context/core",
], path.join(cacheDir, "bundle.mjs"));

const AGENT_ID = "agent-a";
const root = await mkdtemp(path.join(tmpdir(), "visualize-tool-0721-"));
const agentDir = path.join(root, "agents", AGENT_ID);
await mkdir(agentDir, { recursive: true });
const dbPath = path.join(agentDir, "store.db");
const db = new m.SandAgentDb(dbPath);
const session = { id: AGENT_ID, db, dbPath };

let runtime;
const manager = {
  sessions: { activeSession: undefined },
  sessionStore: { markSessionActivity() {} },
  roster: { applyAgentUpdateToOutline() {}, emitAgentUpdate: async () => {} },
  runLifecycle: {
    trackProgressFromUpdate() {}, trackComposingFromUpdate() {},
    trackRetryingFromUpdate() {}, trackActivityFromUpdate() {},
  },
  ackObligations: { fulfillAckObligation() {} },
  backgroundWakes: { deliverToChannel() { throw new Error("visualization must not deliver to a channel"); } },
  sendPipeline: {
    validateAiReplyTarget: (message, inFlightId, entries) => m.validateAiReplyTarget(message, inFlightId, entries),
    applyAutoReplyThread: (message, runSession, entries) => m.applyAutoReplyThread({ turnRuntime: runtime }, message, runSession, entries),
  },
};
runtime = new m.TurnRuntime(manager);

const capturedUpdates = [];
let lastEntryId;
const turn = {
  emitUpdate: (update) => { capturedUpdates.push(update); lastEntryId = runtime.handleAgentUpdate(update, session); },
  autoReviewModes: { hostShell: "off", boxShell: "off", mcp: "off", computer: "off", automationWrite: "off", cloudAgent: "off", subagentLaunch: "off" },
};
const boxFiles = new Map();
const props = {
  hostDependencies: {
    visualization: {
      agentId: AGENT_ID,
      agentDir,
      readBoxFile: async (_ctx, boxPath, maxBytes) => {
        const bytes = boxFiles.get(boxPath);
        if (bytes === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        if (bytes.byteLength > maxBytes) throw Object.assign(new Error("too large"), { name: "BoxFileTooLargeError" });
        return bytes;
      },
    },
  },
};
const factories = m.createTurnToolsetFactoriesForTurn({}, turn, props);
const tool = factories.visualize();

const interactionHandler = {
  emitPartialToolCall() {},
  async executeToolCall(ctx, _initial, _toolCallId, execute, complete) {
    const result = await execute(ctx);
    complete(result);
    return result;
  },
};
function streamArgs(value) {
  return { async *[Symbol.asyncIterator]() { yield typeof value === "string" ? value : JSON.stringify(value); } };
}
async function call(args, toolCallId = "call-1") {
  return tool.execute(m.createContext(), interactionHandler, streamArgs(args), { toolCallId });
}
const sha256Of = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const HTML = '<div id="demo">quarterly revenue chart</div>';
const SHA = sha256Of(HTML);
let successResult;

test("Visualize tool call saves the fragment and persists the card through the send-message path", async () => {
  assert.equal(tool.name, "Visualize");
  successResult = await call({ title: "Revenue", summary: "Quarterly revenue.", height: 200, html: HTML }, "call-abc");
  assert.equal(successResult.result.case, "success");
  assert.match(successResult.result.value.currentStep, /^Shown inline as visual viz-[0-9a-f]{10}\.$/);

  assert.equal(capturedUpdates.length, 1);
  const update = capturedUpdates[0];
  assert.equal(update.type, "send-message");
  assert.deepEqual(Object.keys(update.message).sort(), ["documentSha256", "heightPx", "summary", "title", "type", "visualId"]);
  assert.deepEqual(update.message, {
    type: "visualization", title: "Revenue", summary: "Quarterly revenue.",
    documentSha256: SHA, heightPx: 200,
    visualId: `viz-${sha256Of("call-abc").slice(0, 10)}`,
  });

  const stored = Buffer.from(await readFile(path.join(agentDir, "visualizations", `${SHA}.html`)));
  assert.equal(stored.toString("utf8"), HTML);
  assert.equal(sha256Of(stored.toString("utf8")), SHA);

  assert.equal(typeof lastEntryId, "string");
  const entries = db.getTranscriptEntries();
  const entry = entries.find((candidate) => candidate.id === lastEntryId);
  assert.equal(entry.kind, "send-message");
  assert.deepEqual(entry.message, update.message);
  assert.equal(entry.timestampMs, update.timestampMs);
});

test("history encoding summarizes the visualization without HTML", () => {
  const encoded = m.encodeSendMessage(capturedUpdates[0].message);
  assert.equal(encoded.message.case, "text");
  assert.equal(encoded.message.value.content, `Showed the user inline visual ${capturedUpdates[0].message.visualId} "Revenue", 200 px tall: Quarterly revenue.`);
  assert.ok(!encoded.message.value.content.includes("chart"));
});

test("box path source is read through the injected box reader", async () => {
  boxFiles.set("/workspace/viz.html", Buffer.from(HTML, "utf8"));
  const result = await call({ title: "From file", summary: "Read from the box.", height: 320, path: "/workspace/viz.html" }, "call-path");
  assert.equal(result.result.case, "success");
  assert.equal(capturedUpdates[1].message.documentSha256, SHA);
});

test("malformed arguments are rejected before anything is saved or sent", async () => {
  const before = { updates: capturedUpdates.length, entries: db.getTranscriptEntries().length };
  await assert.rejects(call({ title: "T", summary: "S", height: 200, html: HTML, path: "/workspace/viz.html" }), /Pass exactly one of html or path/);
  await assert.rejects(call({ title: "T", summary: "S", height: 200, html: "   " }), /It is empty/);
  await assert.rejects(call({ title: "T", summary: "S", height: 100, html: HTML }), /height/);
  await assert.rejects(call({ title: "two\nlines", summary: "S", height: 200, html: HTML }), /title must be one line/);
  await assert.rejects(call({ title: "T", summary: "S", height: 200 }), /Pass exactly one of html or path/);
  assert.equal(capturedUpdates.length, before.updates);
  assert.equal(db.getTranscriptEntries().length, before.entries);
});

test("fragment rules reject oversized HTML and three.js misuse without emitting", async () => {
  const before = capturedUpdates.length;
  const oversized = await call({ title: "T", summary: "S", height: 200, html: `<div id="x">${"a".repeat(1024 * 1024)}</div>` });
  assert.equal(oversized.result.case, "error");
  assert.match(oversized.result.value.error, /over the 1048576-byte limit/);
  const three = await call({ title: "T", summary: "S", height: 200, html: '<div id="x"><script>THREE.Scene.call(this)</script></div>' });
  assert.equal(three.result.case, "error");
  assert.match(three.result.value.error, /ES classes/);
  assert.equal(capturedUpdates.length, before);
});

test("visualId edits are rejected while no revision store exists, and channel delivery is refused", async () => {
  const before = capturedUpdates.length;
  const edit = await call({ title: "T", summary: "S", height: 200, html: HTML, visualId: `viz-${sha256Of("call-abc").slice(0, 10)}` });
  assert.equal(edit.result.case, "error");
  assert.match(edit.result.value.error, /can't change a visual in place/);
  await assert.rejects(call({ title: "T", summary: "S", height: 200, html: HTML, visualId: "viz-0123456789", channel: "slack:C1" }), /Pass channel or visualId, not both/);
  const channel = await call({ title: "T", summary: "S", height: 200, html: HTML, channel: "slack:C1" });
  assert.equal(channel.result.case, "error");
  assert.match(channel.result.value.error, /cannot be delivered to a channel by this host/);
  assert.equal(capturedUpdates.length, before);
});

test("a restarted process reads the saved fragment back by entry and hash", async () => {
  db.close();
  const childBundle = path.join(cacheDir, "child-bundle.mjs");
  await bundleModules([
    "host/extensions/session/agent-db",
    "host/extensions/transcript/visualization-pages",
  ], childBundle);
  const childSource = [
    'import assert from "node:assert/strict";',
    "const bundle = await import(process.argv[2]);",
    "const { agentId, agentDir, dbPath, entryId, sha256, html } = JSON.parse(process.argv[3]);",
    "const db = new bundle.SandAgentDb(dbPath);",
    "const entry = db.getTranscriptEntries().find((candidate) => candidate.id === entryId);",
    'assert.equal(entry.kind, "send-message");',
    'assert.equal(entry.message.type, "visualization");',
    "assert.equal(entry.message.documentSha256, sha256);",
    "db.close();",
    "const pages = bundle.createVisualizationPages({ agentId, agentDir });",
    "const fragment = await pages.read({ agentId, entryId, documentSha256: sha256 });",
    "assert.equal(fragment.html, html);",
    "console.log(JSON.stringify({ restartedRead: true, sha256, entryId }));",
  ].join("\n");
  const childScript = path.join(root, "restart-read.mjs");
  await writeFile(childScript, childSource);
  const nodeBin = path.join(repoRoot, "..", ".tools", "node-26", "bin", "node");
  const out = execFileSync(nodeBin, [childScript, childBundle, JSON.stringify({ agentId: AGENT_ID, agentDir, dbPath, entryId: lastEntryId, sha256: SHA, html: HTML })], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out.trim()), { restartedRead: true, sha256: SHA, entryId: lastEntryId });
});

test("foreign, malformed and tampered reads fail closed", async () => {
  const pages = m.createVisualizationPages({ agentId: AGENT_ID, agentDir });
  await assert.rejects(pages.read({ agentId: "someone-else", entryId: lastEntryId, documentSha256: SHA }), TypeError);
  await assert.rejects(pages.read({ agentId: AGENT_ID, entryId: "", documentSha256: SHA }), TypeError);
  await assert.rejects(pages.read({ agentId: AGENT_ID, entryId: lastEntryId, documentSha256: "abcd" }), TypeError);
  assert.equal(await pages.read({ agentId: AGENT_ID, entryId: lastEntryId, documentSha256: "0".repeat(64) }), null);

  const otherDir = path.join(root, "agents", "agent-b");
  await mkdir(otherDir, { recursive: true });
  const foreign = m.createVisualizationPages({ agentId: "agent-b", agentDir: otherDir });
  assert.equal(await foreign.read({ agentId: "agent-b", entryId: lastEntryId, documentSha256: SHA }), null);

  await writeFile(path.join(agentDir, "visualizations", `${SHA}.html`), "tampered");
  await assert.rejects(pages.read({ agentId: AGENT_ID, entryId: lastEntryId, documentSha256: SHA }), /hash mismatch/);
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });


