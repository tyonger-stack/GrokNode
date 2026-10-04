import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");
const INDEX = read("frontend", "src", "extensions", "marketplace", "index.ts");
const VIEW = read("frontend", "src", "extensions", "marketplace", "view.ts");

/** Source with every comment removed. The defect is described in prose two lines above the code,
 *  and a prose-aware check "passes" forever: the first version of this file asserted
 *  `doesNotMatch(/loading:\s*true\b/)` and matched the sentence explaining the bug. Assert on code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The body of `open()`. Bounded by the next top-level `};` at the same indentation, NOT by
 *  `indexOf("const close =")` — `close` is defined ABOVE `open` in this file, so that bound lands
 *  before the start and silently produces an empty string, which makes every assertion below
 *  vacuously true or false for reasons that have nothing to do with the code. */
function openBody() {
  const src = code(INDEX);
  const start = src.indexOf("const open = async");
  assert.ok(start >= 0, "index.ts has an open()");
  const end = src.indexOf("\n  };", start);
  assert.ok(end > start, "open() has an end");
  return src.slice(start, end);
}

/**
 * Opening the marketplace used to block the first paint on a network round-trip, and the loading
 * state it showed covered the whole body — so a perfectly good model left over from the previous
 * open was replaced by a spinner for four seconds. Measured five opens per app:
 *
 *   official     55 / 58 / 55 / 59 / 58 ms, loading state seen 0/5
 *   this build  5003 / 5309 / 3449 / 4790 / 4264 ms, 「正在加载市场…」 seen 5/5
 *
 * This is a SOURCE guard, and that is normally the weak choice in this repo — a source assertion
 * cannot tell whether a node really received a class list. But this defect is not about a class
 * list or a pixel: it is a single boolean passed to a single early-return in the renderer, and the
 * pairing that matters (flag set here, early return there) is exactly what source CAN see. The
 * behavioural counterpart is `probe-open-latency.mjs` over CDP, which is the measurement these
 * numbers come from.
 *
 * The three assertions below are the ones whose absence would bring the 4-second spinner back.
 */

test("open() only shows the loading state when there is genuinely nothing to paint", () => {
  // The regression is the UNCONDITIONAL flag. `state.model.rows.length === 0` is the cold-start
  // test: with no model yet there is nothing to show, and the status block is correct.
  const open = openBody();
  assert.match(
    open,
    /const cold = state\.model\.rows\.length === 0;/,
    "open() must decide `loading` from whether a model already exists, not set it unconditionally",
  );
  // Guard the flag itself: `loading:` must be assigned from `cold`, never a bare `true`. A bare
  // `true` is the defect, and it would sail past the check above if someone kept the const around.
  const loadingAssign = /loading:\s*([^,\n]+),/.exec(open);
  assert.ok(loadingAssign, "open() assigns `loading`");
  assert.equal(loadingAssign[1].trim(), "cold", "`loading` must be the cold-start predicate");
  assert.doesNotMatch(open, /loading:\s*true\b/);
});

test("a warm model is painted before the round-trip, and the refresh still happens", () => {
  const open = openBody();
  // `createMarketplaceDialog` + `append` + `paint` must all come BEFORE `await reload()`. Moving
  // the await up is the other way to reintroduce the blank first paint.
  const iCreate = open.indexOf("createMarketplaceDialog(");
  const iPaint = open.indexOf("paint();");
  const iAwait = open.indexOf("await reload();");
  assert.ok(iCreate >= 0, "open() creates the dialog");
  assert.ok(iPaint > iCreate, "the dialog is painted after it is created");
  assert.ok(iAwait > iPaint, "and the round-trip is awaited only after that first paint");
  // And the refresh must not simply have been dropped to make the test pass.
  assert.match(open, /await reload\(\);/, "open() still refreshes behind the first paint");
});

test("the view really does replace the whole body while loading — that is why the flag matters", () => {
  // If this ever stops being an early return, the loading flag becomes cosmetic and the guard
  // above would be guarding nothing. Assert the coupling, not just the flag.
  const idx = VIEW.indexOf("if (state.loading || state.catalogError != null) {");
  assert.ok(idx >= 0, "renderBrowse short-circuits on loading/error");
  const tail = VIEW.slice(idx, idx + 700);
  assert.match(tail, /groups\.replaceChildren\(root\);/, "the early return replaces the groups host");
  assert.match(tail, /return;/, "and returns before the model is rendered");
  // The status copy is upstream's, so the loading text is not ours to invent.
  assert.match(read("frontend", "src", "extensions", "marketplace", "model.ts"), /正在加载市场…/);
});

test("the measured baseline this guard encodes", () => {
  // Numbers, not code. If a future change makes the open fast for a different reason this file
  // becomes wrong — which is the point of writing it down rather than leaving it in a comment
  // that nobody will diff against reality.
  const evidence = read("docs", "evidence", "marketplace-open-latency.md");
  assert.match(evidence, /官方[^\n]*55/);
  assert.match(evidence, /5003|5309/);
  assert.ok(existsSync(path.join(repoRoot, "docs", "evidence", "marketplace-open-latency.md")));
});
