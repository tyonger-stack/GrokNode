import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outfile = path.join(repoRoot, "node_modules", ".cache", "messages-consent.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/host/local-exec/messages-consent.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const { runMessagesOpConsent } = require(outfile);

function harness() {
  const events = [];
  return {
    events,
    emit: (event) => events.push(event.kind === "messages-accepted" ? "accepted" : event.kind === "messages-consent-result" ? `consent:${JSON.stringify(event.verdict)}` : event.kind === "messages-error" ? `error:${event.error}` : `result:${JSON.stringify(event.result)}`),
  };
}
const send = { kind: "send", text: "hi", to: "+15550100" };
const findChats = { kind: "find-chats", limit: 5 };

test("send without approval emits accepted, then consent-result blocks a non-allow verdict and never performs", async () => {
  const h = harness();
  let performed = false;
  const outcome = await runMessagesOpConsent({ op: send }, {
    emit: h.emit,
    decideLocalUse: async () => ({ kind: "deny" }),
    perform: async () => { performed = true; return { ok: true }; },
  });
  assert.equal(outcome.performed, false);
  assert.equal(performed, false);
  assert.deepEqual(h.events, ["accepted", 'consent:{"kind":"deny"}']);
});

test("an allow verdict performs and emits the result after accepted", async () => {
  const h = harness();
  const outcome = await runMessagesOpConsent({ op: send }, {
    emit: h.emit,
    decideLocalUse: async () => ({ kind: "allow" }),
    perform: async (op) => ({ sent: op.text }),
  });
  assert.equal(outcome.performed, true);
  assert.deepEqual(h.events, ["accepted", 'result:{"sent":"hi"}']);
});

test("an undecided verdict falls through to the blocked check before performing", async () => {
  const h = harness();
  const outcome = await runMessagesOpConsent({ op: send }, {
    emit: h.emit,
    decideLocalUse: async () => undefined,
    isLocalUseBlocked: async () => "local tools are disabled",
    perform: async () => ({ ok: true }),
  });
  assert.equal(outcome.performed, false);
  assert.deepEqual(h.events, ["accepted", "error:local tools are disabled"]);
});

test("send with an approvalId skips consent and performs directly", async () => {
  const h = harness();
  const outcome = await runMessagesOpConsent({ op: send, approvalId: "appr_1" }, {
    emit: h.emit,
    decideLocalUse: async () => { throw new Error("consent must not run"); },
    perform: async () => ({ ok: true }),
  });
  assert.equal(outcome.performed, true);
  assert.deepEqual(h.events, ['result:{"ok":true}']);
});

test("non-send ops run the blocked check only, then perform", async () => {
  const h = harness();
  const outcome = await runMessagesOpConsent({ op: findChats }, {
    emit: h.emit,
    isLocalUseBlocked: async () => undefined,
    perform: async (op) => ({ chats: op.limit }),
  });
  assert.equal(outcome.performed, true);
  assert.deepEqual(h.events, ['result:{"chats":5}']);

  const blocked = harness();
  const stopped = await runMessagesOpConsent({ op: findChats }, {
    emit: blocked.emit,
    isLocalUseBlocked: async () => "not approved",
    perform: async () => ({ ok: true }),
  });
  assert.equal(stopped.performed, false);
  assert.deepEqual(blocked.events, ["error:not approved"]);
});

test("without a decideLocalUse port a send performs without the accepted event (upstream: host without a decider)", async () => {
  const h = harness();
  const outcome = await runMessagesOpConsent({ op: send }, {
    emit: h.emit,
    perform: async () => ({ ok: true }),
  });
  assert.equal(outcome.performed, true);
  assert.deepEqual(h.events, ['result:{"ok":true}']);
});
