import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "acorn";
import { extractFile } from "@electron/asar";
import { patchOriginalDownloadAll } from "../scripts/lib/download-all-renderer-patch.mjs";
import { patchMessageCopy0753 } from "../scripts/lib/message-copy-0753-patch.mjs";
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";
import { bundleServerPort } from "./server-port-bundle.mjs";

const source = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(() => null);
const skip = source == null ? "pinned renderer not hydrated" : false;
const packagedAsar = process.env.GROK_NODE_MESSAGE_COPY_TEST_ASAR;
const patched = packagedAsar == null
  ? source == null ? null : patchMessageCopy0753(patchOriginalDownloadAll(source)).text
  : extractFile(packagedAsar, "dist/renderer/assets/index-UbX-y3il.js").toString();

function componentRuntime({ canReply = false } = {}) {
  const node = parse(patched, { ecmaVersion: "latest", sourceType: "module" }).body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "mCn");
  let component = patched.slice(node.start, node.end);
  for (const [en, zh] of [["Copy", "复制"], ["Reply", "回复"]]) {
    if (!component.includes(`RLocT("${en}","${zh}")`)) component = applyPair(component, en, zh, "FULL").patched;
  }
  const copied = [];
  const states = [];
  const setters = [];
  const cache = [];
  let hook = 0;
  const jsx = (type, props) => ({ type, props });
  const copyRequest = value => copied.push(value);
  const noop = () => {};
  const schedule = callback => callback();
  const menu = name => Object.assign(() => {}, { Item: `${name}.Item`, Content: `${name}.Content`, Trigger: `${name}.Trigger`, Section: `${name}.Section` });
  const globals = {
    he: { c: size => { if (cache.length === 0) cache.push(...Array(size).fill(Symbol.for("react.memo_cache_sentinel"))); return cache; } },
    S: {
      useState(initial) {
        const index = hook++;
        if (!(index in states)) {
          states[index] = index === 0 ? {} : index === 1 ? true : initial;
          setters[index] = value => { states[index] = typeof value === "function" ? value(states[index]) : value; };
        }
        return [states[index], setters[index]];
      },
      isValidElement: value => value?.props != null,
      Children: { only: value => value },
      cloneElement: (value, props) => jsx(value.type, { ...value.props, ...props }),
      Fragment: "Fragment",
    },
    p: { jsx, jsxs: jsx, Fragment: "Fragment" },
    cCn: () => ({ isThreadActionVisible: canReply, isReadOnly: false, hasActions: true, handleReply: noop, handleThread: noop }),
    ome: () => [false, copyRequest],
    Ide: () => ({ schedule }),
    ZAe: entry => entry.role ?? "assistant",
    iCn: () => "arrow-u-up-left",
    hCn: () => false,
    fCn: value => value,
    re: (...classes) => classes.filter(Boolean).join(" "),
    aCn: () => "Message actions",
    rCn: () => "Reply",
    bt: "Icon",
    It: menu("hover"),
    no: menu("context"),
    mGe: "ReactionPicker",
    dGe: "Reactions",
    dCn: noop,
    Wr: { createPortal: value => value },
    RDownloadLabel: () => "下载",
    RLocT: (_en, zh) => zh,
  };
  const render = new Function(...Object.keys(globals), `${component};return mCn;`)(...Object.values(globals));
  const child = jsx("article", { children: "message" });
  const copyMessage = () => copied.push("正文原文");
  return {
    copied,
    render(entry, onCopy = copyMessage) { hook = 0; return render({ entry, onCopy, children: child }); },
  };
}

function items(tree, type) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(node => items(node, type));
  return [...(tree.type === type ? [tree.props] : []), ...items(tree.props?.children, type)];
}

test("official copy and copy request ID items copy different exact values on both menus", { skip }, () => {
  const runtime = componentRuntime();
  const tree = runtime.render({ id: "entry-1", kind: "send-message", requestId: "real-request-1" });
  for (const surface of ["hover.Item", "context.Item"]) {
    const actions = items(tree, surface);
    assert.deepEqual(actions.map(item => item.children), ["复制", "复制请求 ID"]);
    actions[0].onSelect();
    actions[1].onSelect();
  }
  assert.deepEqual(runtime.copied, ["正文原文", "real-request-1", "正文原文", "real-request-1"]);
});

test("legacy messages keep a disabled request ID item without inventing an ID", { skip }, () => {
  for (const entry of [
    { kind: "message", id: "message-id" },
    { kind: "send-message", id: "message-id", requestId: "" },
    { kind: "user-attachment", id: "message-id", requestId: "not-a-message-request" },
  ]) {
    const runtime = componentRuntime();
    const tree = runtime.render(entry);
    for (const surface of ["hover.Item", "context.Item"]) {
      const actions = items(tree, surface);
      if (entry.kind === "user-attachment") assert.deepEqual(actions.map(item => item.children), ["复制"]);
      else {
        assert.deepEqual(actions.map(item => item.children), ["复制", "复制请求 ID"]);
        assert.equal(actions[1].disabled, true);
        actions[1].onSelect();
        assert.deepEqual(runtime.copied, []);
      }
    }
  }
});

test("ordinary Bot copy menus omit legacy thread creation and keep the separate Reply action", { skip }, () => {
  const runtime = componentRuntime({ canReply: true });
  const tree = runtime.render({ id: "replyable", kind: "send-message", requestId: "reply-request" });
  assert.deepEqual(items(tree, "hover.Item").map(item => item.children), ["复制", "复制请求 ID"]);
  assert.deepEqual(items(tree, "context.Item").map(item => item.children), ["回复", "复制", "复制请求 ID"]);
});

test("memoized menus follow request changes even with the same entry and copy callback", { skip }, () => {
  const runtime = componentRuntime();
  const entry = { id: "same-entry", kind: "message", requestId: "first-request" };
  runtime.render(entry);
  entry.requestId = "second-request";
  const tree = runtime.render(entry);
  for (const surface of ["hover.Item", "context.Item"]) items(tree, surface).find(item => item.children === "复制请求 ID").onSelect();
  assert.deepEqual(runtime.copied, ["second-request", "second-request"]);
  delete entry.requestId;
  for (const surface of ["hover.Item", "context.Item"]) {
    const actions = items(runtime.render(entry), surface);
    assert.deepEqual(actions.map(item => item.children), ["复制", "复制请求 ID"]);
    assert.equal(actions[1].disabled, true);
  }
});

test("request ID alone can expose its action when message text cannot be copied", { skip }, () => {
  const runtime = componentRuntime();
  const tree = runtime.render({ id: "card", kind: "send-message", requestId: "request-for-card" }, null);
  for (const surface of ["hover.Item", "context.Item"]) assert.deepEqual(items(tree, surface).map(item => item.children), ["复制请求 ID"]);
});

test("port composes with the download menu and rejects a changed compiler cache", { skip }, () => {
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  assert.equal(patchMessageCopy0753(patched).applied, false);
  assert.throws(() => patchMessageCopy0753(patchOriginalDownloadAll(source).replace("he.c(160)", "he.c(159)")), /missing or ambiguous/);
});

test("port accepts existing localized menu labels after the translation pass", { skip }, () => {
  let localized = patchOriginalDownloadAll(source);
  for (const [en, zh] of [["Copy", "复制"], ["Start a thread", "开始线程"]]) localized = applyPair(localized, en, zh, "FULL").patched;
  const result = patchMessageCopy0753(localized);
  const node = parse(result.text, { ecmaVersion: "latest", sourceType: "module" }).body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "mCn");
  const component = result.text.slice(node.start, node.end);
  assert.ok(component.includes('RLocT("Copy","复制")'));
  assert.ok(component.includes('RLocT("Copy request ID","复制请求 ID")'));
  assert.ok(!component.includes("Start a thread"));
});

const { TurnRuntime, SandAgentDb } = await bundleServerPort(["host/extensions/transcript/turn-runtime", "host/extensions/session/agent-db"]);

test("assistant messages persist the owning session's real request ID across requests", async t => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "message-request-id-"));
  const db = new SandAgentDb(join(root, "store.db"));
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const session = { id: "owner", db, dbPath: join(root, "store.db") };
  const requestIds = new Map([["other-agent", "wrong-request"]]);
  const manager = {
    sessions: {},
    runLifecycle: {
      lastRequestIdBySession: requestIds,
      trackProgressFromUpdate() {}, trackComposingFromUpdate() {}, trackRetryingFromUpdate() {}, trackActivityFromUpdate() {},
      trackTurnRequestId() {}, async recordRequestId() {},
    },
    roster: { async emitAgentUpdate() {} },
    ackObligations: { fulfillAckObligation() {} },
    sessionStore: { markSessionActivity() {} },
    sendPipeline: { validateAiReplyTarget: value => value, applyAutoReplyThread: value => value },
  };
  const runtime = new TurnRuntime(manager);
  const send = content => runtime.handleAgentUpdate({ type: "send-message", message: { type: "text", content }, timestampMs: 123 }, session);
  const noRequest = send("before request");
  assert.equal(db.getEntryById(noRequest).requestId, undefined);
  runtime.handleAgentUpdate({ type: "request-id", requestId: "actual-request-1" }, session);
  const first = send("first");
  runtime.handleAgentUpdate({ type: "request-id", requestId: "actual-request-2" }, session);
  const second = send("second");
  assert.equal(db.getEntryById(first).requestId, "actual-request-1");
  assert.equal(db.getEntryById(second).requestId, "actual-request-2");
  assert.equal(requestIds.get("other-agent"), "wrong-request");
});
