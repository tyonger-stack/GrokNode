import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outfile = path.join(repoRoot, "node_modules", ".cache", "apple-events-dispatch.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/local-exec-daemon/apple-apps/dispatch.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const {
  DeviceToolError, MacWriteUnconfirmedError, compactArgs, dispatchAppleTool,
  firstWord, withMacWriteConfirmation,
} = require(outfile);

function recordingCall(log, reply = {}) {
  return async (app, op, args) => {
    log.push({ app, op, args });
    return reply;
  };
}

test("notes read routes by id presence and clamps limits like upstream", async () => {
  const log = [];
  const call = recordingCall(log, { search: [] });
  await dispatchAppleTool("mac_read_notes", { id: "NOTE1" }, call);
  await dispatchAppleTool("mac_read_notes", { query: "groceries", folder: "Lists", limit: 9999 }, call);
  assert.deepEqual(log, [
    { app: "notes", op: "get", args: { id: "NOTE1", maxChars: 20000 } },
    { app: "notes", op: "search", args: { query: "groceries", folder: "Lists", limit: 500 } },
  ]);
});

test("notes write requires body, guards append with currentTitle, and echoes the reply record", async () => {
  await assert.rejects(dispatchAppleTool("mac_write_notes", {}, recordingCall([])), (error) => {
    assert.ok(error instanceof DeviceToolError);
    assert.equal(error.code, "invalid_input");
    assert.equal(error.message, "mac_write_notes: body is required");
    return true;
  });

  await assert.rejects(dispatchAppleTool("mac_write_notes", { id: "N1", body: "x" }, recordingCall([])), (error) => {
    assert.equal(error.message, "mac_write_notes: currentTitle is required with id");
    return true;
  });

  await assert.rejects(dispatchAppleTool("mac_write_notes", { body: "x" }, recordingCall([])), (error) => {
    assert.equal(error.message, "mac_write_notes: a new note needs a title");
    return true;
  });

  const log = [];
  const note = { id: "N2", title: "ok" };
  const appendCall = recordingCall(log, { appended: note });
  const outcome = await dispatchAppleTool("mac_write_notes", { id: "N1", currentTitle: "old", body: "more" }, appendCall);
  assert.deepEqual(outcome, { action: "appended", note });
  assert.deepEqual(log, [{ app: "notes", op: "append", args: { id: "N1", currentTitle: "old", body: "more" } }]);

  const createLog = [];
  const created = await dispatchAppleTool("mac_write_notes", { title: "t", body: "b", folder: "F" },
    recordingCall(createLog, { created: note }));
  assert.deepEqual(created, { action: "created", note });
  assert.deepEqual(createLog, [{ app: "notes", op: "create", args: { title: "t", body: "b", folder: "F" } }]);
});

test("mail read and draft mirror the upstream arg shaping", async () => {
  const log = [];
  await dispatchAppleTool("mac_read_mail", { id: "M1" }, recordingCall(log, {}));
  await dispatchAppleTool("mac_read_mail", { query: "invoice", mailbox: "Inbox", unreadOnly: true, days: 7, limit: 0 }, recordingCall(log, {}));
  assert.deepEqual(log, [
    { app: "mail", op: "get", args: { id: "M1", maxChars: 20000 } },
    { app: "mail", op: "search", args: { query: "invoice", mailbox: "Inbox", unreadOnly: true, days: 7, limit: 1 } },
  ]);

  await assert.rejects(dispatchAppleTool("mac_draft_mail", { body: "hi" }, recordingCall([])), (error) => {
    assert.equal(error.message, "mac_draft_mail: a new email needs to");
    return true;
  });

  const draftLog = [];
  await dispatchAppleTool("mac_draft_mail",
    { replyToId: "M1", body: "hi", subject: "ignored-on-reply", cc: ["a@x.io"] }, recordingCall(draftLog, {}));
  assert.deepEqual(draftLog, [{ app: "mail", op: "draft", args: { replyToId: "M1", cc: ["a@x.io"], body: "hi" } }]);

  const freshLog = [];
  await dispatchAppleTool("mac_draft_mail", { to: ["b@x.io"], subject: "s", body: "hi" }, recordingCall(freshLog, {}));
  assert.deepEqual(freshLog, [{ app: "mail", op: "draft", args: { to: ["b@x.io"], subject: "s", body: "hi" } }]);
});

test("unknown tool keys hit the est() unsupported fallback verbatim", async () => {
  await assert.rejects(dispatchAppleTool("ios_read_reminders", {}, recordingCall([])), (error) => {
    assert.ok(error instanceof DeviceToolError);
    assert.equal(error.code, "unsupported");
    assert.equal(error.message, 'This Mac has no "ios_read_reminders" tool.');
    return true;
  });
});

test("write paths surface sidecar_timeout/sidecar_closed as MacWriteUnconfirmedError", async () => {
  const failWith = async (message) => {
    const seen = [];
    try {
      await dispatchAppleTool("mac_write_notes", { title: "t", body: "b" }, async (app, op, args) => {
        seen.push({ app, op, args });
        throw new Error(message);
      });
    } catch (error) {
      return error;
    }
    throw new Error("expected dispatch to throw");
  };
  const unconfirmed = await failWith("sidecar_timeout the helper stopped answering");
  assert.ok(unconfirmed instanceof MacWriteUnconfirmedError);
  assert.equal(unconfirmed.name, "MacWriteUnconfirmedError");
  assert.equal(unconfirmed.message, "sidecar_timeout the helper stopped answering");
  assert.ok(unconfirmed.cause instanceof Error);

  const closed = await failWith("sidecar_closed socket hung up");
  assert.ok(closed instanceof MacWriteUnconfirmedError);

  const other = await failWith("something_else broke");
  assert.ok(!(other instanceof MacWriteUnconfirmedError));
  assert.equal(other.message, "something_else broke");

  const deviceError = new DeviceToolError("note_locked", "That note is locked");
  const wrapped = await (async () => {
    try {
      await withMacWriteConfirmation(() => Promise.reject(deviceError));
    } catch (error) { return error; }
  })();
  assert.equal(wrapped, deviceError);
});

test("compactArgs drops undefined entries and firstWord matches upstream W7", () => {
  assert.deepEqual(compactArgs({ a: 1, b: undefined, c: "x" }), { a: 1, c: "x" });
  assert.equal(firstWord("sidecar_timeout the helper"), "sidecar_timeout");
  assert.equal(firstWord("single"), "single");
});
