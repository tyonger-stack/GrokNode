// Regression cover: a message sent WITH an attachment failed to dispatch at all.
//
// Symptom (2026-09-30): the composer staged and uploaded the file fine — the send then
// failed with 发送失败 after the 120s ack window, and the box never recorded the send.
// The box answered `POST /api/sendPrompt` with HTTP 500 and
//   The "paths[0]" argument must be of type string. Received undefined
// for every send that carried an attachment, regardless of prompt text, file type, or
// whether the file existed. A send with no attachment returned `{"accepted":true}`.
//
// Cause: `createUserAttachmentEntry` called the attachments port as
// `attachments.readImageDimensions(filePath)`, but the real service port takes a request
// object (`{ path, agentId }`) and reads `args.path`. A string argument therefore made
// `path` undefined, `reanchorSandPath(undefined)` hit a `path.*` call, and the rejection
// escaped the port's `try/catch` because that guard returned an `async` callee without
// awaiting. The rejection propagated out of `sendPromptOnce`, so the whole send 500'd.
//
// The port double below reproduces the real service's shape, including the exact Node
// error text, so this test fails on the old call shape rather than merely differing.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await import("node:fs/promises").then((fs) => fs.mkdir(path.join(root, "node_modules", ".cache"), { recursive: true }));
const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null;
    });
  },
};
const cacheDir = path.join(root, "node_modules", ".cache");
const out = path.join(cacheDir, "send-attachment-entry-shape.cjs");
await build({
  entryPoints: [path.join(root, "source/host/extensions/transcript/send-message-shaping.ts")],
  bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "error", plugins: [jsToTs],
});
const { createUserAttachmentEntry } = createRequire(import.meta.url)(out);

const AGENT = "8c5c2c9c-14bb-415b-9d86-416a6ce7266e";
const FILE = `/home/box/sand-data/agents/${AGENT}/attachments/deadbeef.md`;

/**
 * Mirrors `attachments-service.ts`: it takes a request object and dereferences
 * `args.path`. A non-object argument reproduces the production failure verbatim.
 */
function serviceShapedPort(calls) {
  return {
    readImageDimensions(request) {
      calls.push(request);
      const { path: requestPath } = request ?? {};
      if (typeof requestPath !== "string") {
        // Exactly what `reanchorSandPath(undefined)` raised in the box.
        throw new TypeError('The "paths[0]" argument must be of type string. Received undefined');
      }
      return Promise.resolve({ width: 12, height: 34 });
    },
  };
}

test("attachment entry reads dimensions through the service's object request shape", async () => {
  const calls = [];
  const entry = await createUserAttachmentEntry(serviceShapedPort(calls), "pending-user-attachment-id", FILE, {
    fileName: "wechat-steward-bot-template.md",
    batchId: "batch-1",
    clientNonce: "nonce-1",
    byteSize: 4154,
    agentId: AGENT,
  });

  assert.deepEqual(calls, [{ path: FILE, agentId: AGENT }]);
  assert.equal(entry.kind, "user-attachment");
  assert.equal(entry.file_path, FILE);
  assert.equal(entry.file_name, "wechat-steward-bot-template.md");
  assert.equal(entry.byteSize, 4154);
  assert.deepEqual({ width: entry.width, height: entry.height }, { width: 12, height: 34 });
});

test("a non-image attachment still resolves when the port reports no dimensions", async () => {
  const calls = [];
  const entry = await createUserAttachmentEntry({
    readImageDimensions(request) { calls.push(request); return Promise.resolve(null); },
  }, "pending-user-attachment-id", FILE, { agentId: AGENT });

  assert.equal(calls.length, 1);
  assert.equal(entry.width, undefined);
  assert.equal(entry.height, undefined);
});

test("the attachment read is scoped to the owning agent", async () => {
  const calls = [];
  await createUserAttachmentEntry(serviceShapedPort(calls), "pending-user-attachment-id", FILE, {});
  // No agentId supplied: still an object request, so the port never dereferences undefined.
  assert.equal(typeof calls[0], "object");
  assert.equal(calls[0].path, FILE);
  assert.equal(calls[0].agentId, null);
});

// The port's own guard is the second half of the bug: it wrapped an `async` reader in a
// synchronous `try`, so `return readImageDimensions(...)` handed the rejection straight to
// the caller. Assert the shipped source really awaits inside the try.
test("attachments-service read ports await inside their guard", async () => {
  const source = await readFile(path.join(root, "source/host/extensions/attachments/attachments-service.ts"), "utf8");
  for (const name of ["readImageDimensions", "readMediaDimensions", "readVideoBytes"]) {
    const block = new RegExp(`${name}: async \\(args[\\s\\S]{0,160}?try \\{ return await `).test(source);
    assert.equal(block, true, `${name} must await its reader inside the try so rejections are caught`);
  }
});

// Keep the caller honest: a bare-path call is exactly the regression, so pin the shape.
test("the call site never passes a bare path to the port", async () => {
  const source = await readFile(path.join(root, "source/host/extensions/transcript/send-message-shaping.ts"), "utf8");
  assert.equal(/readImageDimensions\(\s*filePath\s*\)/.test(source), false);
  assert.equal(/readImageDimensions\(\s*\{\s*path: filePath/.test(source), true);
});
