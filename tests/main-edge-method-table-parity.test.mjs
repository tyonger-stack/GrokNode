// Parity guard between the desktop RPC exposure table and what the preload actually calls.
//
// `serveEdge(contract, MAIN_METHOD_TABLE, { handlers })` publishes only the methods named
// in MAIN_METHOD_TABLE. The preload then calls them as `mainEdge[method]!(...)` — a
// non-null assertion that TypeScript cannot check across the IPC boundary, so a handler
// that exists in `createMainEdgeHandlers` but is missing from the table is a RUNTIME
// throw in the renderer, not a compile error.
//
// This exact gap shipped once: the main Bot methods were wired through the preload bridge
// and the main-edge handler map, and the only thing missing was three lines in the table,
// so the chooser failed with `mainEdge[method] is not a function` on first use. Nothing in
// typecheck, `npm test` or the packaging gates noticed, because the code is all correct —
// it is just never published.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PRELOAD = path.join(REPO_ROOT, "source/electron-preload/preload.ts");
const METHOD_TABLE = path.join(REPO_ROOT, "source/shared/rpc/main.ts");
const MAIN_EDGE = path.join(REPO_ROOT, "source/electron-main/main-edge.ts");

const read = file => readFile(file, "utf8");

/** Every method the preload reaches through the edge runtime. */
async function preloadEdgeCalls() {
  const source = await read(PRELOAD);
  return new Set([...source.matchAll(/\bedge\("([A-Za-z][\w]*)"/g)].map(match => match[1]));
}

/** Every method the edge publishes. */
async function publishedMethods() {
  const source = await read(METHOD_TABLE);
  const start = source.indexOf("export const MAIN_METHOD_TABLE = {");
  assert.ok(start >= 0, "could not find MAIN_METHOD_TABLE");
  const end = source.indexOf("} as const", start);
  const body = source.slice(start, end);
  return new Set([...body.matchAll(/^\s{2}([A-Za-z][\w]*):/gm)].map(match => match[1]));
}

/** Every method `createMainEdgeHandlers` actually implements. */
async function implementedHandlers() {
  const source = await read(MAIN_EDGE);
  const start = source.indexOf("export function createMainEdgeHandlers");
  assert.ok(start >= 0, "could not find createMainEdgeHandlers");
  return new Set([...source.slice(start).matchAll(/^\s{4}([A-Za-z][\w]*):/gm)].map(match => match[1]));
}

test("every method the preload calls is published by the edge method table", async () => {
  const called = await preloadEdgeCalls();
  const published = await publishedMethods();
  const missing = [...called].filter(method => !published.has(method)).sort();
  assert.deepEqual(missing, [],
    `the preload calls these methods but MAIN_METHOD_TABLE never publishes them, so each one throws "mainEdge[method] is not a function" at its first use: ${missing.join(", ")}`);
  assert.ok(called.size > 50, `expected the preload to reach a broad edge surface, saw ${called.size}`);
});

test("the main Bot methods are published on both sides of the edge", async () => {
  const called = await preloadEdgeCalls();
  const published = await publishedMethods();
  const implemented = await implementedHandlers();
  for (const method of ["getHostMainAgent", "setHostMainAgent", "ensureHostMainAgent"]) {
    assert.ok(implemented.has(method), `${method} is missing from createMainEdgeHandlers`);
    assert.ok(published.has(method), `${method} is missing from MAIN_METHOD_TABLE`);
    assert.ok(called.has(method), `${method} is missing from the preload bridge`);
  }
});

test("MUTATION: dropping a table entry is what the first test catches", async () => {
  // Reproduce the shipped defect in miniature: a handler and a bridge call that exist,
  // with the table entry removed. The handler is still implemented and the bridge still
  // calls it — the only symptom is the runtime throw.
  const source = await read(METHOD_TABLE);
  const broken = source.replace("  getHostMainAgent: { args: \"none\" },\n", "");
  assert.notEqual(broken, source, "sanity: the mutation applied");
  const start = broken.indexOf("export const MAIN_METHOD_TABLE = {");
  const body = broken.slice(start, broken.indexOf("} as const", start));
  const published = new Set([...body.matchAll(/^\s{2}([A-Za-z][\w]*):/gm)].map(m => m[1]));
  assert.ok(!published.has("getHostMainAgent"), "the mutated table must drop the method");
  assert.ok((await implementedHandlers()).has("getHostMainAgent"),
    "while the handler is still implemented — which is exactly why nothing else complained");
  assert.ok((await preloadEdgeCalls()).has("getHostMainAgent"),
    "and the bridge still calls it");
});
