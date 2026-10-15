// Regression cover for the 0.71.2 "Not delivered yet" port.
//
// The patch rewrites 0.18's send-journal state machine, so text assertions are not enough: a
// branch can be spliced in syntactically fine and still never fire. The journal factory
// (MHn) is therefore lifted out of the patched chunk together with its helpers and driven
// through real sends, ACK expiries, host verdicts and restores against a recording fake of
// the transcript overlay.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Parser, parse } from "acorn";

import {
  applyOriginalRendererUndeliveredSend,
  assertUndeliveredStylesResolve,
  patchOriginalUndeliveredSend,
  UNDELIVERED_COPY,
  UNDELIVERED_ROW_CLASSES,
  UNDELIVERED_TEXT_CLASSES,
  UNDELIVERED_TRANSFORMS,
} from "../scripts/lib/undelivered-send-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_ASSETS = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const PINNED_CHUNK = path.join(PINNED_ASSETS, "index-UbX-y3il.js");
const PINNED_CSS = path.join(PINNED_ASSETS, "index-lCyB53CO.css");
const run = promisify(execFile);

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const patched = pinnedChunk == null ? null : patchOriginalUndeliveredSend(pinnedChunk);

function sliceDeclaration(source, head) {
  const start = source.indexOf(head);
  assert.ok(start >= 0 && source.indexOf(head, start + 1) < 0, `${head} missing or ambiguous`);
  const exprStart = head.startsWith("const ") ? start + head.length : start;
  const node = Parser.parseExpressionAt(source, exprStart, { ecmaVersion: "latest" });
  return `${source.slice(start, node.end)}${head.startsWith("const ") ? ";" : ""}`;
}

const JOURNAL_HELPERS = [
  "function MHn(", "function THn(", "function bHn(", "function fKe(", "function Kie(", "function SHn(",
  "function xHn(", "function ED(", "function mKe(", "function dKe(", "function PHn(", "function Pu(",
  "function VY(", "function pHn(", "function gHn(", "function SSe(", "function yHn(", "function wHn(",
  "function vHn(", "const kHn=", "function sc(", "function PTe(", "function Dn(", "class wn extends Error{",
];

/** Lift the send journal out of a (patched or pristine) chunk into a callable factory. */
function loadJournalFactory(source) {
  const body = [
    'const Z0t={slice:"send-journal",schemaVersion:2,scope:"client-persisted",accountSensitive:!0};',
    'const o9e="host",TSe="sand-resend-v1:",h2="source/capability-unavailable",bSe="send/nonce-digest-mismatch";',
    'const dPe="send/empty-input",mPe="send/attachments-unavailable",fPe="send/attachment-commit-failed",lde="send/journal-write-failed",QGe="send/journal-parked",l3="send/superseded",nOn="send/sand-access-blocked";',
    'const Upt=12e4,NHn={persist:"p",clear:"c","discard-staged":"d","restore-dispatch":"r"},hKe={ok:!0},l9e="optimistic:";',
    "const QY=new Proxy({},{get:(_,name)=>()=>({code:String(name)})});",
    "const hne=n=>n.agentId;",
    ...JOURNAL_HELPERS.map(head => sliceDeclaration(source, head)),
    "return {MHn,wn,sc,h2};",
  ].join("\n");
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  return new Function(body)();
}

function fakeTranscript() {
  const calls = [];
  const record = name => (...args) => {
    calls.push([name, ...args]);
    return name === "confirmOptimistic" ? true : undefined;
  };
  return {
    calls,
    names: () => calls.map(c => c[0]),
    insertOptimistic: record("insertOptimistic"),
    confirmOptimistic: record("confirmOptimistic"),
    markOptimisticFailed: record("markOptimisticFailed"),
    markOptimisticUndelivered: record("markOptimisticUndelivered"),
    removeOptimistic: record("removeOptimistic"),
    refresh: record("refresh"),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * One journal with a sent, host-accepted, not-yet-echoed record.
 * `status(nonce)` is the host's promptAcceptanceStatus verdict (or a thrown failure).
 */
async function acceptedSend(source, { status, transportDown = () => false, persisted = null } = {}) {
  const { MHn, wn, sc } = loadJournalFactory(source);
  let clock = 1_000;
  let written = null;
  const restored = [];
  const transcript = fakeTranscript();
  const journal = MHn({
    source: {
      sendPrompt: async () => ({ accepted: true }),
      promptAcceptanceStatus: async ({ clientNonce }) => status(clientNonce, { wn, sc }),
    },
    drafts: { recoverDraft() {}, clearDraftIfCurrent() {} },
    transcript,
    registry: {
      register: () => ({
        write: async ({ value }) => { written = value; },
        clear: async () => {},
        read: async () =>
          persisted == null
            ? { kind: "absent" }
            : { kind: "ok", envelope: { schemaVersion: 2, value: persisted }, receipt: { classify() {} } },
      }),
    },
    now: () => clock,
    mintNonce: (() => { let n = 0; return () => `nonce-${++n}`; })(),
    isTransportDown: transportDown,
    onRestored: info => restored.push(info.nonce),
  });
  await journal.restore("slot-1");
  return {
    journal,
    transcript,
    restored,
    wn,
    sc,
    advance: ms => { clock += ms; },
    records: () => journal.snapshots.get().records,
    written: () => written,
  };
}

async function sendAndExpire(source, options) {
  const env = await acceptedSend(source, options);
  await env.journal.sendPrompt({ agentId: "agent-1", prompt: "hello" });
  const [record] = env.records();
  assert.equal(record.phase, "accepted-awaiting-echo");
  assert.ok(env.transcript.names().includes("confirmOptimistic"), "the send was confirmed accepted");
  env.advance(options.advanceMs ?? 130_000);
  env.journal.markAckTimedOut(record.nonce);
  await flush();
  await flush();
  return { ...env, nonce: record.nonce };
}

const found = echoEntryId => () => ({ outcome: "found", record: { status: "accepted", echoEntryId } });
const notFound = () => ({ outcome: "not-found" });

test("the patched chunk parses as an ES module", { skip: pinnedSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "undelivered-send-"));
  const file = path.join(dir, "chunk.mjs");
  await writeFile(file, patched, "utf8");
  await run(process.execPath, ["--check", file]);
});

test("every anchor exists exactly once and a second application fails closed", { skip: pinnedSkip }, () => {
  for (const [role, before] of UNDELIVERED_TRANSFORMS) {
    const first = pinnedChunk.indexOf(before);
    assert.ok(first >= 0 && pinnedChunk.indexOf(before, first + 1) < 0, role);
  }
  assert.throws(() => patchOriginalUndeliveredSend(patched), /already applied/);
});

test("injected module-level identifiers resolve to top-level bindings", { skip: pinnedSkip }, () => {
  const names = new Set();
  for (const node of parse(patched, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") names.add(node.id?.name);
    else if (node.type === "VariableDeclaration") for (const d of node.declarations) if (d.id.type === "Identifier") names.add(d.id.name);
  }
  for (const id of ["S", "p", "Pu", "RSendUndeliveredFooter", "RSendUndeliveredPublish", "RSendUndeliveredSubscribe", "RSendUndeliveredSnapshot"]) {
    assert.ok(names.has(id), `${id} must be a chunk top-level binding`);
  }
});

test("pristine 0.18 fails an accepted-but-unechoed send outright (the gap this port closes)", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(pinnedChunk, { status: found(null) });
  assert.ok(env.records()[0].failedAtMs != null);
  assert.ok(!env.transcript.names().includes("markOptimisticUndelivered"));
});

test("ACK expiry on an accepted send asks the host; accepted-without-echo shows Not delivered yet", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: found(null) });
  const [record] = env.records();
  assert.equal(record.awaitingHostDecision, true);
  assert.equal(record.failedAtMs, undefined);
  assert.deepEqual(env.transcript.calls.filter(c => c[0] === "markOptimisticUndelivered").map(c => c[1]), [{ agentId: "agent-1", nonce: env.nonce }]);
  assert.ok(!env.transcript.names().includes("markOptimisticFailed"));
  assert.equal(env.written().records[0].awaitingHostDecision, true, "the flag is persisted");
});

test("host has never seen the send and the transport is up: the existing failed path runs", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: notFound });
  assert.ok(env.records()[0].failedAtMs != null);
  assert.ok(env.transcript.names().includes("markOptimisticFailed"));
  assert.ok(!env.transcript.names().includes("markOptimisticUndelivered"));
});

test("host has never seen the send and the transport is down: parked as undelivered, not failed", { skip: pinnedSkip }, async () => {
  let down = false;
  const env = await sendAndExpire(patched, {
    status: () => { down = true; return { outcome: "not-found" }; },
    transportDown: () => down,
  });
  assert.equal(env.records()[0].failedAtMs, undefined);
  assert.ok(env.transcript.names().includes("markOptimisticUndelivered"));
  assert.ok(!env.transcript.names().includes("markOptimisticFailed"));
});

test("the status query itself fails: undelivered, parked", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, {
    status: (_nonce, { wn, sc }) => { throw new wn(sc("source/transport-failure", !1)); },
  });
  assert.equal(env.records()[0].failedAtMs, undefined);
  assert.ok(env.transcript.names().includes("markOptimisticUndelivered"));
});

test("durability unknown: undelivered, parked", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: () => ({ outcome: "unknown-durability" }) });
  assert.equal(env.records()[0].failedAtMs, undefined);
  assert.ok(env.transcript.names().includes("markOptimisticUndelivered"));
});

test("host found it with an echo: refreshed, never marked undelivered", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: found("entry-9") });
  assert.ok(env.transcript.names().includes("refresh"));
  assert.ok(!env.transcript.names().includes("markOptimisticUndelivered"));
  assert.equal(env.records()[0].failedAtMs, undefined);
});

test("host rejected it: the awaiting record goes through the expiry decision (failed while online)", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: () => ({ outcome: "found", record: { status: "rejected", echoEntryId: null } }) });
  assert.ok(env.records()[0].failedAtMs != null, "kept as a failed record so Resend is offered");
  assert.ok(env.transcript.names().includes("markOptimisticFailed"));
  assert.ok(!env.transcript.names().includes("removeOptimistic"));
});

test("a failed awaiting record resends without the flag", { skip: pinnedSkip }, async () => {
  const env = await sendAndExpire(patched, { status: notFound });
  const failedNonce = env.records()[0].nonce;
  await env.journal.resendFailed({ nonce: failedNonce });
  const [resent] = env.records();
  assert.notEqual(resent.nonce, failedNonce);
  assert.equal("awaitingHostDecision" in resent, false);
});

test("an echo for one send re-reconciles the agent's other awaiting sends", { skip: pinnedSkip }, async () => {
  const asked = [];
  const env = await sendAndExpire(patched, { status: nonce => { asked.push(nonce); return found(null)(); } });
  await env.journal.sendPrompt({ agentId: "agent-1", prompt: "second" });
  const second = env.records().find(r => r.nonce !== env.nonce);
  asked.length = 0;
  env.journal.noteEchoReconciled({ agentId: "agent-1", nonce: second.nonce, echoedNonce: second.nonce });
  await flush();
  assert.deepEqual(asked, [env.nonce]);
});

test("restore shows a persisted awaiting record as undelivered and does not re-arm its ACK timer", { skip: pinnedSkip }, async () => {
  const base = {
    accountSlot: "slot-1",
    agentId: "agent-1",
    input: { agentId: "agent-1", prompt: "hi", attachmentPaths: [], attachmentNames: [] },
    digest: "d",
    draftRecovery: { prompt: "hi", attachments: [] },
    attachments: [],
    createdAtMs: 10,
    ackTimeoutStartedAtMs: 10,
    phase: "accepted-awaiting-echo",
  };
  const env = await acceptedSend(patched, {
    status: notFound,
    persisted: {
      records: [
        { ...base, nonce: "n-awaiting", awaitingHostDecision: true },
        { ...base, nonce: "n-failed", awaitingHostDecision: true, failedAtMs: 20 },
        { ...base, nonce: "n-plain" },
      ],
    },
  });
  const inserted = Object.fromEntries(env.transcript.calls.filter(c => c[0] === "insertOptimistic").map(c => [c[2].nonce, c[2]]));
  assert.equal(inserted["n-awaiting"].status, "accepted");
  assert.equal(inserted["n-awaiting"].isUndelivered, true);
  assert.equal(inserted["n-failed"].status, "failed");
  assert.equal(inserted["n-failed"].isUndelivered, undefined);
  assert.equal(inserted["n-plain"].status, "pending");
  assert.deepEqual(env.restored, ["n-plain"]);
  assert.equal(env.records().find(r => r.nonce === "n-failed").awaitingHostDecision, undefined, "parser drops the flag on failed records");
});

test("overlay: undelivered never overrides failed, and failed now reaches an accepted bubble", { skip: pinnedSkip }, () => {
  const start = patched.indexOf("markOptimisticFailed:({agentId:j,nonce:Z})=>");
  const end = patched.indexOf(",removeOptimistic:", start);
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const methods = new Function("t", "d", "O", "Pu", `return {${patched.slice(start, end)}};`);
  const overlay = new Map();
  const agents = new Map([["a", { overlay }]]);
  const m = methods(agents, false, () => {}, n => n);
  overlay.set("n1", { nonce: "n1", status: "accepted" });
  m.markOptimisticUndelivered({ agentId: "a", nonce: "n1" });
  assert.deepEqual(overlay.get("n1"), { nonce: "n1", status: "accepted", isUndelivered: true });
  m.markOptimisticFailed({ agentId: "a", nonce: "n1" });
  assert.equal(overlay.get("n1").status, "failed");
  m.markOptimisticUndelivered({ agentId: "a", nonce: "n1" });
  assert.equal(overlay.get("n1").status, "failed");
});

test("row footer: last overlay entry is published per agent and shown only for that row", { skip: pinnedSkip }, () => {
  const names = ["RSendUndeliveredPublish", "RSendUndeliveredSubscribe", "RSendUndeliveredSnapshot", "RSendUndeliveredRowHas"];
  const prelude = patched.slice(patched.indexOf("const RSendUndeliveredEmpty="), patched.indexOf("function RSendUndeliveredPublish("));
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const store = new Function(`${prelude}${names.map(n => sliceDeclaration(patched, `function ${n}(`)).join("\n")}return {${names.join(",")}};`)();
  let notified = 0;
  store.RSendUndeliveredSubscribe(() => { notified += 1; });
  store.RSendUndeliveredPublish("a", ["optimistic:n1"]);
  store.RSendUndeliveredPublish("a", ["optimistic:n1"]);
  assert.equal(notified, 1, "identical publishes do not re-render");
  const ids = store.RSendUndeliveredSnapshot();
  assert.ok(store.RSendUndeliveredRowHas(ids, { kind: "entry", entry: { id: "optimistic:n1" } }));
  assert.ok(store.RSendUndeliveredRowHas(ids, { kind: "attachment-group", entries: [{ id: "x" }, { id: "optimistic:n1" }] }));
  assert.ok(!store.RSendUndeliveredRowHas(ids, { kind: "entry", entry: { id: "optimistic:n2" } }));
  store.RSendUndeliveredPublish("b", []);
  assert.equal(notified, 1);
  store.RSendUndeliveredPublish("a", []);
  assert.equal(store.RSendUndeliveredSnapshot().size, 0);
  assert.equal(notified, 2);

  assert.match(patched, /ue\.status==="accepted"&&ue\.isUndelivered===!0&&de!=null&&RUndIds\.push\(de\.id\)/);
  assert.match(patched, /RSendUndeliveredPublish\(j\.agentId,RUndIds\);j\.snapshots\.set\(/);
  assert.match(patched, /On=p\.jsx\(RSendUndeliveredFooter,\{row:Yt,children:p\.jsx\(UMn,/);
  assert.ok(patched.includes(`RLocT(${JSON.stringify(UNDELIVERED_COPY.en)},${JSON.stringify(UNDELIVERED_COPY.zh)})`));
  assert.doesNotMatch(patched, /RSendUndeliveredFooter[^;]*children:\[/, "JSX children go through props");
});

test("the status row reuses classes the pinned stylesheet defines", { skip: pinnedSkip }, async () => {
  const css = await readFile(PINNED_CSS, "utf8");
  assert.equal(assertUndeliveredStylesResolve(css), UNDELIVERED_ROW_CLASSES.length + UNDELIVERED_TEXT_CLASSES.length);
  assert.throws(() => assertUndeliveredStylesResolve(css.replaceAll(".sand-1om1abp", ".sand-gone")), /sand-1om1abp/);
});

// Mutation checks: dropping one transform must turn a behavioural test red.
for (const [role, scenario] of [
  ["ack-expiry-accepted-awaits-host", { status: found(null), expectUndelivered: true }],
  ["reconcile-own-awaiting-branch", { status: () => ({ outcome: "unknown-durability" }), expectUndelivered: true }],
  // The ACK timer runs on its own clock; an expiry that lands before the journal's own
  // 120s window must still decide, which only the awaiting short-circuit in THn allows.
  ["expiry-predicate-awaiting", { status: notFound, downAfterQuery: true, advanceMs: 30_000, expectUndelivered: true }],
]) {
  test(`mutation: without ${role} the undelivered state is never reached`, { skip: pinnedSkip }, async () => {
    for (const [source, expectReached] of [[patched, true], [patchOriginalUndeliveredSend(pinnedChunk, { skip: [role] }), false]]) {
      let down = false;
      const options = scenario.downAfterQuery
        ? { ...scenario, status: (...args) => { down = true; return scenario.status(...args); }, transportDown: () => down }
        : scenario;
      const env = await sendAndExpire(source, options).catch(error => ({ error }));
      const reached = env.error == null && env.transcript.names().includes("markOptimisticUndelivered") && env.records()[0].failedAtMs == null;
      assert.equal(reached, expectReached, `${role} must be load-bearing`);
    }
  });
}

test("mutation: without the restore transform an awaiting record restores as pending", { skip: pinnedSkip }, async () => {
  const mutated = patchOriginalUndeliveredSend(pinnedChunk, { skip: ["restore-awaiting-undelivered", "overlay-status-awaiting-accepted"] });
  const env = await acceptedSend(mutated, {
    status: notFound,
    persisted: {
      records: [{
        nonce: "n-awaiting", accountSlot: "slot-1", agentId: "agent-1", awaitingHostDecision: true,
        input: { agentId: "agent-1", prompt: "hi", attachmentPaths: [], attachmentNames: [] }, digest: "d",
        draftRecovery: { prompt: "hi", attachments: [] }, attachments: [], createdAtMs: 10, phase: "accepted-awaiting-echo",
      }],
    },
  });
  const inserted = env.transcript.calls.find(c => c[0] === "insertOptimistic")[2];
  assert.notEqual(inserted.isUndelivered, true);
  assert.deepEqual(env.restored, ["n-awaiting"]);
});

test("apply writes the stage and provenance", { skip: pinnedSkip }, async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "undelivered-stage-"));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  await cp(PINNED_CSS, path.join(assets, "index-lCyB53CO.css"));
  const record = await applyOriginalRendererUndeliveredSend({ stageRoot });
  assert.equal(record.transformations.length, UNDELIVERED_TRANSFORMS.length);
  assert.equal(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"), patched);
  await assert.rejects(applyOriginalRendererUndeliveredSend({ stageRoot }), /found 0|already applied/);
});
