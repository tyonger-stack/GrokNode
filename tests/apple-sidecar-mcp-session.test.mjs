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
const outfile = path.join(repoRoot, "node_modules", ".cache", "apple-sidecar-mcp-session.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/local-exec-daemon/sidecar/mcp-session.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const {
  MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION, SIDECAR_CANCEL_REASON, SIDECAR_IDLE_STOP_MESSAGE,
  SIDECAR_IDLE_STOP_MS, SIDECAR_STOPPED_ANSWERING_MESSAGE, SIDECAR_REQUEST_TIMEOUT_MS,
  SidecarMcpSession,
} = require(outfile);

const PROTOCOL = MCP_PROTOCOL_VERSION;

/** 假 helper：initialize 回 result；tools/call 回显参数；其余回空 result。 */
function fakeHelperSource({ swallowToolCalls = false } = {}) {
  return `
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
      say({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "${PROTOCOL}", capabilities: {} } });
    } else if (msg.method === "tools/call") {
      ${swallowToolCalls ? "/* 故意不回复，制造挂起 */" : `
      say({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(msg.params) }] } });`}
    } else if (msg.id !== undefined) {
      say({ jsonrpc: "2.0", id: msg.id, result: {} });
    }
  }
});
`;
}

async function writeHelper(dir, name, source) {
  const file = path.join(dir, name);
  await writeFile(file, source);
  return file;
}

function manualClock() {
  const timers = [];
  let now = 0;
  return {
    clock: {
      schedule(delayMs, run) {
        const entry = { at: now + delayMs, run, disposed: false };
        timers.push(entry);
        return { dispose() { entry.disposed = true; } };
      },
    },
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => !t.disposed && t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.disposed = true;
        await due.run();
      }
    },
  };
}

/** onClosed 挂在子进程 close 事件上，异步到达；轮询等它而不是睡等。 */
function closedWatcher() {
  const messages = [];
  return {
    messages,
    onClosed: (message) => { messages.push(message); },
    async waitFor(message) {
      for (let i = 0; i < 200 && !messages.includes(message); i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return messages;
    },
  };
}

/** 用可观测 spawn 替身包装真 spawn：截获写出的每行 JSON-RPC。 */
function recordingSpawn(seen) {
  return (command, args, options) => {
    const child = spawn(command, args, options);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk, ...rest) => {
      for (const line of String(chunk).split("\n")) if (line.trim()) seen.push(JSON.parse(line));
      return write(chunk, ...rest);
    };
    seen.spawnArgs = child.spawnargs;
    return child;
  };
}

test("initialize handshake matches upstream bytes, then tools/call round-trips", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-sidecar-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = await writeHelper(dir, "helper.mjs", fakeHelperSource());
  const seen = [];
  const session = new SidecarMcpSession({
    conversationId: "conv-42",
    launch: async () => ({ command: process.execPath, args: [helper] }),
    spawnImpl: recordingSpawn(seen),
  });
  t.after(() => session.stop("test done"));
  await session.ready;

  const init = seen.find((m) => m.method === "initialize");
  assert.deepEqual(init.params, { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: MCP_CLIENT_INFO });
  assert.deepEqual(seen.spawnArgs.slice(-3), ["--mcp-stdio", "--conversation-id", "conv-42"]);
  assert.ok(seen.some((m) => m.method === "notifications/initialized"));

  const { reply } = session.request("tools/call", {
    name: "apple-events/run", arguments: { app: "notes", op: "search", args: { query: "x" } },
  });
  const outcome = await reply;
  assert.equal(outcome.kind, "result");
  assert.deepEqual(JSON.parse(outcome.result.content[0].text).arguments,
    { app: "notes", op: "search", args: { query: "x" } });
});

test("request timeout settles timed-out and later requests see the stopped-answering exit", async () => {
  const { clock, advance } = manualClock();
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-sidecar-timeout-"));
  try {
    const helper = await writeHelper(dir, "helper.mjs", fakeHelperSource({ swallowToolCalls: true }));
    const session = new SidecarMcpSession({
      conversationId: "c",
      launch: async () => ({ command: process.execPath, args: [helper] }),
      clock,
      spawnImpl: (c, a, o) => spawn(c, a, o),
    });
    try {
      await session.ready;
      const first = session.request("tools/call", { name: "apple-events/run", arguments: {} });
      await advance(SIDECAR_REQUEST_TIMEOUT_MS);
      assert.equal((await first.reply).kind, "timed-out");
      const second = session.request("tools/call", { name: "apple-events/run", arguments: {} });
      const outcome = await second.reply;
      assert.equal(outcome.kind, "exited");
      assert.equal(outcome.message, SIDECAR_STOPPED_ANSWERING_MESSAGE);
    } finally {
      session.stop("test done");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idle lease stops the helper after ten minutes with the upstream copy", async () => {
  const { clock, advance } = manualClock();
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-sidecar-idle-"));
  try {
    const helper = await writeHelper(dir, "helper.mjs", fakeHelperSource());
    const watcher = closedWatcher();
    const session = new SidecarMcpSession({
      conversationId: "c",
      launch: async () => ({ command: process.execPath, args: [helper] }),
      clock,
      onClosed: watcher.onClosed,
      spawnImpl: (c, a, o) => spawn(c, a, o),
    });
    try {
      await session.ready;
      session.lease();
      session.release();
      await advance(SIDECAR_IDLE_STOP_MS);
      await watcher.waitFor(SIDECAR_IDLE_STOP_MESSAGE);
      assert.deepEqual(watcher.messages, [SIDECAR_IDLE_STOP_MESSAGE]);
    } finally {
      session.stop("test done");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancel settles cancelled and emits notifications/cancelled with the upstream reason", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-sidecar-cancel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = await writeHelper(dir, "helper.mjs", fakeHelperSource({ swallowToolCalls: true }));
  const seen = [];
  const session = new SidecarMcpSession({
    conversationId: "c",
    launch: async () => ({ command: process.execPath, args: [helper] }),
    spawnImpl: recordingSpawn(seen),
  });
  t.after(() => session.stop("test done"));
  await session.ready;
  const { id, reply } = session.request("tools/call", { name: "apple-events/run", arguments: {} });
  session.cancel(id);
  assert.equal((await reply).kind, "cancelled");
  const notice = seen.find((m) => m.method === "notifications/cancelled");
  assert.deepEqual(notice.params, { requestId: id, reason: SIDECAR_CANCEL_REASON });
});

test("initialize error reply stops the session with the refused-to-start copy", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apple-sidecar-refuse-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = await writeHelper(dir, "helper.mjs", `
let line = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  line += chunk;
  for (;;) {
    const n = line.indexOf("\\n"); if (n < 0) break;
    const raw = line.slice(0, n); line = line.slice(n + 1);
    if (!raw.trim()) continue;
    const msg = JSON.parse(raw);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "not today" } }) + "\\n");
    }
  }
});
`);
  const watcher = closedWatcher();
  const session = new SidecarMcpSession({
    conversationId: "c",
    launch: async () => ({ command: process.execPath, args: [helper] }),
    onClosed: watcher.onClosed,
    spawnImpl: (c, a, o) => spawn(c, a, o),
  });
  await session.ready;
  await watcher.waitFor("The computer-use helper refused to start: not today");
  assert.deepEqual(watcher.messages, ["The computer-use helper refused to start: not today"]);
});
