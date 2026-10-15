// Regression cover for the 0.71.2 "load failed → Retry, keep the old content" port.
//
// The injected surfaces are lifted out of the patched chunk and rendered against fake stores
// with a tiny element walker, so the assertions are about what the user would see (which
// copy, whether a Retry exists, whether the list is still there) rather than about text.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Parser, parse } from "acorn";

import {
  applyOriginalRendererReadFailureRetry,
  assertReadFailureStylesResolve,
  patchOriginalReadFailureRetry,
  READ_COPY,
  READ_FAILURE_TRANSFORMS,
  READ_INLINE_ONLY_CLASSES,
} from "../scripts/lib/read-failure-retry-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_ASSETS = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const PINNED_CHUNK = path.join(PINNED_ASSETS, "index-UbX-y3il.js");
const PINNED_CSS = path.join(PINNED_ASSETS, "index-lCyB53CO.css");
// The computer-sleep pass runs earlier in clean-build and appends these rules to the stage.
const SLEEP_CSS = path.join(REPO_ROOT, "scripts/lib/computer-sleep-official/asleep-stage.css");
const run = promisify(execFile);

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const patched = pinnedChunk == null ? null : patchOriginalReadFailureRetry(pinnedChunk);
const stagedCss = async () => `${await readFile(PINNED_CSS, "utf8")}\n${await readFile(SLEEP_CSS, "utf8")}`;

function sliceDeclaration(source, head) {
  const start = source.indexOf(head);
  assert.ok(start >= 0 && source.indexOf(head, start + 1) < 0, `${head} missing or ambiguous`);
  const exprStart = head.startsWith("const ") ? start + head.length : start;
  const node = Parser.parseExpressionAt(source, exprStart, { ecmaVersion: "latest" });
  return `${source.slice(start, node.end)}${head.startsWith("const ") ? ";" : ""}`;
}

const SURFACES = ["RReadIsParked", "RReadFailure", "RReadTranscriptTray", "RReadRoutinesPanel", "K2n"];

/**
 * Lift the injected surfaces out of `source` with React, the 0.18 kit components and the
 * stores replaced by fakes. Elements are plain {type, props}; `render` expands function
 * components so a test sees the final host tree.
 */
function loadSurfaces(source, { transcript = null, automations = null } = {}) {
  const start = source.indexOf("const R_READ_PARKED=");
  const end = source.indexOf("function K2n(n){return");
  assert.ok(start >= 0 && end > start, "injected component block present");
  const block = source.slice(start, end);
  const k2n = sliceDeclaration(source, "function K2n(n){return");
  const state = { slots: [], cursor: 0 };
  const env = {
    S: {
      useState: init => {
        const slot = state.cursor++;
        if (slot >= state.slots.length) state.slots.push(init);
        return [state.slots[slot], value => { state.slots[slot] = value; }];
      },
      useSyncExternalStore: (_subscribe, get) => get(),
    },
    p: {
      Fragment: "Fragment",
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    vt: "Text",
    As: "Button",
    fr: "IconButton",
    RK2nList: "RoutinesList",
    RLocT: (en, zh) => ({ en, zh }),
    Qe: () => ({ transcript, automations }),
    Dtt: agentId => automations.snapshotsFor(agentId).get(),
  };
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const surfaces = new Function(...names, `${block}${k2n}return {${SURFACES.join(",")}};`)(...names.map(n => env[n]));
  const expand = element => {
    if (element == null || typeof element !== "object") return element;
    if (Array.isArray(element)) return element.map(expand);
    if (typeof element.type === "function") return expand(element.type(element.props));
    if (element.props?.children === undefined) return element;
    return { ...element, props: { ...element.props, children: expand(element.props.children) } };
  };
  const render = element => {
    state.cursor = 0;
    return expand(element);
  };
  return { ...surfaces, render };
}

function collect(node, predicate, out = []) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  collect(node.props?.children, predicate, out);
  return out;
}
const alerts = tree => collect(tree, n => n.props?.role === "alert");
const texts = tree => collect(tree, n => n.props?.children != null && typeof n.props.children === "object" && "en" in n.props.children)
  .map(n => n.props.children.en);
const retries = tree => collect(tree, n => n.type === "Button" || n.type === "IconButton");

const retryable = { code: "x", retry: { owner: "host", command: "listAutomations" }, display: { detail: "boom" } };
const noRetry = { code: "x", retry: null };
const parked = { code: "sand-box-blocked", retry: null, sandBoxBlockReason: "SAND_CLIENT_PAUSE" };

function transcriptStore(snapshot) {
  const loads = [];
  return { loads, snapshotsFor: () => ({ get: () => snapshot, subscribe: () => () => {} }), load: id => loads.push(id) };
}
function automationsStore(snapshot) {
  const refreshes = [];
  return { refreshes, snapshotsFor: () => ({ get: () => snapshot, subscribe: () => () => {} }), refresh: id => refreshes.push(id) };
}

test("the patched chunk parses as an ES module", { skip: pinnedSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "read-failure-"));
  const file = path.join(dir, "chunk.mjs");
  await writeFile(file, patched, "utf8");
  await run(process.execPath, ["--check", file]);
});

test("every anchor exists exactly once and a second application fails closed", { skip: pinnedSkip }, () => {
  for (const [role, before] of READ_FAILURE_TRANSFORMS) {
    const first = pinnedChunk.indexOf(before);
    assert.ok(first >= 0 && pinnedChunk.indexOf(before, first + 1) < 0, role);
  }
  assert.throws(() => patchOriginalReadFailureRetry(patched), /already applied/);
});

test("injected code only references module-level bindings of the chunk", { skip: pinnedSkip }, () => {
  const ast = parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  const topLevel = new Set();
  for (const node of ast.body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (decl == null) continue;
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") topLevel.add(decl.id.name);
    if (decl.type === "VariableDeclaration") for (const d of decl.declarations) if (d.id.type === "Identifier") topLevel.add(d.id.name);
    if (decl.type === "ImportDeclaration") for (const s of decl.specifiers) topLevel.add(s.local.name);
  }
  for (const name of ["S", "p", "vt", "As", "fr", "Qe", "Dtt", "he", "RReadFailure", "RReadTranscriptTray", "RReadRoutinesPanel", "RK2nList", "K2n", "R_READ_PARKED"]) {
    assert.ok(topLevel.has(name), `${name} must be a top-level binding`);
  }
  assert.ok(!patched.includes("`RLoc") && !/RRead[A-Za-z]*\([^)]*`/.test(patched.slice(patched.indexOf("const R_READ_PARKED="), patched.indexOf("function RK2nList("))), "no backticks in injected source");
});

test("box-blocked failures keep the kill-switch reason (0.71.2 c8)", { skip: pinnedSkip }, () => {
  const load = source =>
    // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
    new Function(`const l0e="sand-box-blocked";class wn extends Error{constructor(f,m){super(m);this.failure=f}}${sliceDeclaration(source, "function HBn(")}return HBn;`)();
  const HBn = load(patched);
  assert.equal(HBn({ reason: "SAND_CLIENT_PAUSE", title: "t", detail: "d" }).failure.sandBoxBlockReason, "SAND_CLIENT_PAUSE");
  assert.deepEqual(HBn({ reason: "SAND_CLIENT_PAUSE", title: "t", detail: "d" }).failure.display, { title: "t", detail: "d" });
  assert.equal("sandBoxBlockReason" in HBn({ reason: "", title: "t", detail: "d" }).failure, false);
  assert.equal("sandBoxBlockReason" in HBn(null).failure, false);
  assert.equal("sandBoxBlockReason" in load(pinnedChunk)({ reason: "SAND_CLIENT_PAUSE", title: "t", detail: "d" }).failure, false);
});

test("parked predicate matches 0.71.2 nd", { skip: pinnedSkip }, () => {
  const { RReadIsParked } = loadSurfaces(patched);
  for (const reason of ["SAND_AWAY_PARK", "SAND_PRESENT_PARK", "SAND_CLIENT_PAUSE"]) assert.ok(RReadIsParked({ sandBoxBlockReason: reason }));
  assert.ok(!RReadIsParked({ sandBoxBlockReason: "OTHER" }));
  assert.ok(!RReadIsParked(retryable));
  assert.ok(!RReadIsParked(null));
});

test("transcript tray: a failed refresh with entries on screen says Couldn't refresh and retries the load", { skip: pinnedSkip }, () => {
  const transcript = transcriptStore({ loadState: "ready", entries: [{ id: "e1" }], failure: retryable });
  const s = loadSurfaces(patched, { transcript });
  const tree = s.render({ type: s.RReadTranscriptTray, props: { agentId: "a1" } });
  const [alert] = alerts(tree);
  assert.equal(alert.props["data-read-state"], "stale");
  assert.deepEqual(texts(tree), [READ_COPY.stale.en, READ_COPY.retry.en]);
  const [button] = retries(tree);
  assert.equal(button.type, "Button");
  assert.equal(button.props.variant, "secondary");
  button.props.onClick();
  assert.deepEqual(transcript.loads, ["a1"]);
  const after = s.render({ type: s.RReadTranscriptTray, props: { agentId: "a1" } });
  assert.equal(retries(after)[0].props.disabled, true, "pending until the failure object changes");
});

test("transcript tray: hidden without a failure, for parked boxes, and Retry hidden when not retryable", { skip: pinnedSkip }, () => {
  const render = snapshot => {
    const s = loadSurfaces(patched, { transcript: transcriptStore(snapshot) });
    return s.render({ type: s.RReadTranscriptTray, props: { agentId: "a1" } });
  };
  assert.equal(render({ loadState: "ready", entries: [{ id: "e1" }], failure: null }), null);
  assert.equal(render({ loadState: "ready", entries: [{ id: "e1" }], failure: parked }), null);
  assert.equal(render(null), null);
  const tree = render({ loadState: "ready", entries: [{ id: "e1" }], failure: noRetry });
  assert.equal(alerts(tree).length, 1);
  assert.equal(retries(tree).length, 0);
  const fresh = render({ loadState: "loading", entries: [], failure: retryable });
  assert.equal(texts(fresh)[0], READ_COPY.transcript.en, "no previous data → the resource's own copy");
});

test("routines panel: first load failure shows Couldn't load routines + refresh icon above the (empty) list", { skip: pinnedSkip }, () => {
  const automations = automationsStore({ status: "failed", failure: retryable });
  const s = loadSurfaces(patched, { automations });
  const tree = s.render({ type: s.K2n, props: { agentId: "a1", other: 1 } });
  const children = tree.props.children;
  assert.equal(children[0].props.role, "alert", "panel layout puts the failure first");
  assert.equal(children[1].type, "RoutinesList");
  assert.deepEqual(children[1].props, { agentId: "a1", other: 1 }, "the original list receives its props unchanged");
  assert.deepEqual(texts(tree), [READ_COPY.routines.en]);
  const [button] = retries(tree);
  assert.equal(button.type, "IconButton");
  assert.deepEqual([button.props.icon, button.props.shape, button.props.size, button.props.variant], ["refresh", "circle", "sm", "ghost"]);
  assert.equal(button.props["aria-label"].en, READ_COPY.retry.en);
  button.props.onClick();
  assert.deepEqual(automations.refreshes, ["a1"]);
});

test("routines panel: stale list stays with a Couldn't refresh notice; nothing extra otherwise", { skip: pinnedSkip }, () => {
  const render = snapshot => {
    const s = loadSurfaces(patched, { automations: automationsStore(snapshot) });
    return s.render({ type: s.K2n, props: { agentId: "a1" } });
  };
  const stale = render({ status: "failed", previous: [{ id: "r1" }], failure: retryable });
  assert.deepEqual(texts(stale), [READ_COPY.stale.en]);
  assert.equal(stale.props.children[1].type, "RoutinesList");
  for (const snapshot of [{ status: "ready", value: [] }, { status: "unavailable" }, { status: "failed", failure: parked }]) {
    const tree = render(snapshot);
    assert.equal(alerts(tree).length, 0, JSON.stringify(snapshot));
    assert.equal(tree.props.children[1].type, "RoutinesList");
  }
});

test("copy is wrapped with 0.71.2's zh-Hans strings", { skip: pinnedSkip }, () => {
  for (const { en, zh } of Object.values(READ_COPY)) assert.ok(patched.includes(`RLocT(${JSON.stringify(en)},${JSON.stringify(zh)})`), en);
  assert.doesNotMatch(patched.slice(patched.indexOf("const R_READ_PARKED="), patched.indexOf("function RK2nList(")), /p\.jsxs?\([^()]*\{[^{}]*\},[^)]/, "JSX children go through props");
});

test("surface classes resolve in the staged stylesheet; inline-only classes stay absent", { skip: pinnedSkip }, async () => {
  const css = await stagedCss();
  assert.ok(assertReadFailureStylesResolve(css) > 0);
  assert.throws(() => assertReadFailureStylesResolve(css.replaceAll(".sand-1lliihq", ".sand-gone")), /sand-1lliihq/);
  const pinnedCss = await readFile(PINNED_CSS, "utf8");
  assert.throws(() => assertReadFailureStylesResolve(pinnedCss), /sand-mzvs34/, "needs the computer-sleep rule");
  const [inlineOnly] = Object.keys(READ_INLINE_ONLY_CLASSES);
  assert.throws(() => assertReadFailureStylesResolve(`${css}.${inlineOnly}{}`), /retire the inline fallback/);
});

// Mutation checks: dropping one transform must turn a behavioural test red.
test("mutation: without the trays transform the stale tray is never mounted", { skip: pinnedSkip }, () => {
  const tray = "RReadTranscriptTray,{agentId:n.currentAgentId}";
  assert.ok(patched.includes(tray));
  assert.ok(!patchOriginalReadFailureRetry(pinnedChunk, { skip: ["chat-trays-stale-transcript"] }).includes(tray));
});

test("mutation: without the K2n wrapper a failed routines load renders no failure", { skip: pinnedSkip }, () => {
  const mutated = patchOriginalReadFailureRetry(pinnedChunk, { skip: ["routines-list-failure-panel"] });
  assert.throws(() => loadSurfaces(mutated, { automations: automationsStore({ status: "failed", failure: retryable }) }), /injected component block/);
  assert.ok(mutated.includes("function K2n(n){const e=he.c(25)"), "the pristine list is all that renders");
});

test("mutation: without the HBn transform a client-pause failure is not recognised as parked", { skip: pinnedSkip }, () => {
  const run = source => {
    // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
    const HBn = new Function(`const l0e="sand-box-blocked";class wn extends Error{constructor(f,m){super(m);this.failure=f}}${sliceDeclaration(source, "function HBn(")}return HBn;`)();
    const failure = HBn({ reason: "SAND_CLIENT_PAUSE", title: "Paused", detail: "d" }).failure;
    const s = loadSurfaces(patched, { automations: automationsStore({ status: "failed", failure }) });
    return alerts(s.render({ type: s.K2n, props: { agentId: "a1" } })).length;
  };
  assert.equal(run(patched), 0, "parked boxes show no failure surface");
  assert.equal(run(patchOriginalReadFailureRetry(pinnedChunk, { skip: ["box-blocked-failure-keeps-reason"] })), 1);
});

test("apply writes the stage and provenance", { skip: pinnedSkip }, async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "read-failure-stage-"));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  await writeFile(path.join(assets, "index-lCyB53CO.css"), await stagedCss());
  const record = await applyOriginalRendererReadFailureRetry({ stageRoot });
  assert.equal(record.transformations.length, READ_FAILURE_TRANSFORMS.length);
  assert.equal(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"), patched);
  const provenance = JSON.parse(await readFile(path.join(stageRoot, "dist", "renderer-read-failure-retry-extension.json"), "utf8"));
  assert.equal(provenance.mode, "original-renderer-read-failure-retry");
  await assert.rejects(applyOriginalRendererReadFailureRetry({ stageRoot }), /found 0|already applied/);
});
