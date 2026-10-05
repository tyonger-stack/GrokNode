// Regression cover for the 0.62.0 activity-label visibility port.
//
// The failure mode this guards is entirely invisible to the build: the label's class set is
// chosen by an index expression, so a wrong index still parses, still typechecks, still
// passes every chunk through `node --check`, and still renders a plausible row — it just
// renders the transparent variant. The tests therefore evaluate the real expression against
// the real class sets and compare the *resolved class*, not the text of the edit.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  applyOriginalRendererActivityLabelVisibility,
  assertActivityLabelStylesResolve,
  LABEL_CLASS_SETS,
  LABEL_HIDDEN_CLASS,
  LABEL_SHARED_CLASSES,
  LABEL_VISIBLE_CLASS,
  patchOriginalActivityLabelVisibility,
} from "../scripts/lib/activity-label-visibility-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const PINNED_CSS = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-lCyB53CO.css");

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
// 2026-10-05 补：本文件此前硬读该产物，而 CI 从不执行 `npm run bootstrap`（bootstrap 用的是
// macOS 专有的 hdiutil），于是 13 个依赖产物的文件里有 7 个在 CI 上 ENOENT —— main 的 CI
// 已因此连续红 10 次。写法照抄仓库另外 6 个已守卫的文件，不新造模式。守卫对象取「声明的用例名
// ∩ 实测失败名」，不是靠猜哪个用例读了产物。
const pinnedChunk = await readPinnedChunk().catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const readPinnedCss = () => readFile(PINNED_CSS, "utf8");

const HOVER_GATED_INDEX = '[!!(ce&&H!=="idle")<<0]';
const STATE_ONLY_INDEX = '[!!(H!=="idle")<<0]';

/** The activity-mark component only, so assertions cannot match a neighbour. */
function extractActivityMark(source) {
  const start = source.indexOf("function SJn(");
  assert.ok(start >= 0, "SJn not found in the chunk");
  const next = source.indexOf("function ", start + 12);
  return source.slice(start, next < 0 ? undefined : next);
}

/**
 * Evaluate the row's class-set selection for real.
 *
 * The expression is taken out of the chunk verbatim, both halves of it — the `{0:…,1:…}`
 * class sets and the index that picks one — and run with the mark's own two inputs: the
 * pointer-hover flag (`ce`) and the resolved state (`H`). A string assertion on the index
 * would pass on an expression that is syntactically fine and semantically wrong; this
 * cannot, because the return value is the className the row would actually carry.
 */
function resolveLabelClasses(source) {
  const component = extractActivityMark(source);
  const assignment = component.match(/Ne=\{0:\{className:"[^"]+"\},1:\{className:"[^"]+"\}\}/);
  assert.ok(assignment, "activity label class sets not found");
  const classSets = assignment[0].slice("Ne=".length);
  const index = component.match(/\[\!\!\((?:ce&&)?H!=="idle"\)<<0\]/);
  assert.ok(index, "activity label visibility index not found");
  const expression = `${classSets}${index[0]}`;
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const select = new Function("ce", "H", `return (${expression}).className;`);
  return (hovered, state) => select(hovered, state);
}

test("the pinned stylesheet keeps the label transparent at rest and opaque when revealed", { skip: pinnedSkip }, async () => {
  const css = await readPinnedCss();
  const declarations = className => {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\.${escaped}(?![\\w-])[^{}]*\\{([^}]*)\\}`, "g");
    const found = [];
    let match = pattern.exec(css);
    while (match !== null) {
      found.push(match[1].trim().replace(/\s+/g, " "));
      match = pattern.exec(css);
    }
    return found;
  };
  // This is the whole mechanism: the row is not hidden by a conditional render, it is hidden
  // by opacity, so these two declarations are what "always visible" has to mean.
  assert.deepEqual(declarations(LABEL_HIDDEN_CLASS), ["opacity:0"]);
  assert.deepEqual(declarations(LABEL_VISIBLE_CLASS), ["opacity:1"]);
  for (const className of LABEL_SHARED_CLASSES) {
    assert.ok(declarations(className).length > 0, `${className} is missing from the pinned stylesheet`);
  }
});

test("0.18 gates the label on pointer hover — the reported defect", { skip: pinnedSkip }, async () => {
  const resolve = resolveLabelClasses(await readPinnedChunk());
  // The bug, stated as a fact about the artefact: working agent, pointer elsewhere ->
  // transparent. The label only exists on screen while the mouse is over the row.
  assert.ok(resolve(false, "working").includes(LABEL_HIDDEN_CLASS));
  assert.ok(resolve(false, "thinking").includes(LABEL_HIDDEN_CLASS));
  // Hovering reveals it, which is why it looks fine under the cursor and blank elsewhere.
  assert.ok(resolve(true, "working").includes(LABEL_VISIBLE_CLASS));
  // An idle agent is transparent either way.
  assert.ok(resolve(false, "idle").includes(LABEL_HIDDEN_CLASS));
  assert.ok(resolve(true, "idle").includes(LABEL_HIDDEN_CLASS));
});

test("the patch makes the label follow the agent state instead of the pointer", { skip: pinnedSkip }, async () => {
  const resolve = resolveLabelClasses(patchOriginalActivityLabelVisibility(await readPinnedChunk()));

  // The reported case: agent working, pointer anywhere -> opaque.
  assert.ok(resolve(false, "working").includes(LABEL_VISIBLE_CLASS));
  assert.ok(resolve(true, "working").includes(LABEL_VISIBLE_CLASS));
  assert.ok(resolve(false, "thinking").includes(LABEL_VISIBLE_CLASS));

  // An idle agent keeps the transparent variant in 0.62.0 too — its index has no hover term
  // at all — so the patch must not quietly turn the resting row into a permanent label.
  assert.ok(resolve(false, "idle").includes(LABEL_HIDDEN_CLASS));
  assert.ok(resolve(true, "idle").includes(LABEL_HIDDEN_CLASS));

  // The rest of the class set is carried over untouched, so the row still animates and
  // still lays out identically; only the opacity class may differ from 0.18.
  const strip = value => value.replace(LABEL_HIDDEN_CLASS, "").replace(LABEL_VISIBLE_CLASS, "").replace(/\s+/g, " ").trim();
  assert.equal(strip(resolve(true, "idle")), strip(resolve(false, "working")));
});

test("the rewrite is exactly the removal of the hover term", { skip: pinnedSkip }, async () => {
  const component = extractActivityMark(patchOriginalActivityLabelVisibility(await readPinnedChunk()));
  assert.ok(component.includes(STATE_ONLY_INDEX), "patched index is not the state-only form");
  assert.ok(!component.includes(HOVER_GATED_INDEX), "the hover gate survived the patch");
  // `ce` is still the eye's emphasis flag, so the mark keeps its hover feedback.
  assert.ok(component.includes("emphasis:ce"), "hover emphasis on the mark's eye was removed");
  assert.ok(component.includes("onPointerEnter:()=>{xe(!0),se(!0)}"), "pointer enter handler was removed");
  assert.ok(component.includes("onPointerLeave:()=>{xe(!1),se(!1)}"), "pointer leave handler was removed");
});

test("a drifted or duplicated anchor fails closed instead of patching the wrong row", { skip: pinnedSkip }, async () => {
  const chunk = await readPinnedChunk();
  assert.throws(
    () => patchOriginalActivityLabelVisibility(chunk.replace(HOVER_GATED_INDEX, '[!!(H!=="idle")<<0]')),
    /anchor is missing or ambiguous/,
    "a chunk that already carries the rewritten index must not patch again",
  );
  assert.throws(
    () => patchOriginalActivityLabelVisibility(chunk.replace(HOVER_GATED_INDEX, '[!!(H!=="idle")<<1]')),
    /anchor is missing or ambiguous/,
    "an index that drifted must not patch",
  );
  assert.throws(
    () =>
      patchOriginalActivityLabelVisibility(
        chunk.replace(LABEL_CLASS_SETS, LABEL_CLASS_SETS.replace(LABEL_VISIBLE_CLASS, "sand-1hc1fz-drifted")),
      ),
    /anchor is missing or ambiguous/,
    "a class set that drifted must not patch",
  );
});

test("re-applying the patch fails closed instead of stacking", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalActivityLabelVisibility(await readPinnedChunk());
  assert.throws(() => patchOriginalActivityLabelVisibility(patched), /anchor is missing or ambiguous/);
});

test("the stylesheet gate refuses a row whose visibility classes stopped meaning opacity", { skip: pinnedSkip }, async () => {
  const css = await readPinnedCss();
  assert.doesNotThrow(() => assertActivityLabelStylesResolve(css));
  assert.throws(
    () => assertActivityLabelStylesResolve(css.replace(`.${LABEL_VISIBLE_CLASS}`, ".sand-not-the-visible-one")),
    new RegExp(`missing classes: ${LABEL_VISIBLE_CLASS}`),
  );
  // The dangerous drift: both classes still exist but their meaning is swapped, so an
  // unpatched build would show the label permanently and a patched one would hide it.
  assert.throws(
    () =>
      assertActivityLabelStylesResolve(
        css
          .replace(`.${LABEL_HIDDEN_CLASS}:not(#\\#):not(#\\#):not(#\\#){opacity:0}`, `.${LABEL_HIDDEN_CLASS}:not(#\\#):not(#\\#):not(#\\#){opacity:1}`)
          .replace(`.${LABEL_VISIBLE_CLASS}:not(#\\#):not(#\\#):not(#\\#){opacity:1}`, `.${LABEL_VISIBLE_CLASS}:not(#\\#):not(#\\#):not(#\\#){opacity:0}`),
      ),
    /must declare exactly one opacity:0 declaration, found opacity:1/,
  );
  // Dropping a shared transition class would make the label pop instead of fade.
  assert.throws(
    () => assertActivityLabelStylesResolve(css.replace(".sand-9i6iqp", ".sand-gone")),
    /missing classes: sand-9i6iqp/,
  );
});

test("the patched chunk is still parseable JavaScript", { skip: pinnedSkip }, async () => {
  const { writeFile, rm } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const tmp = path.join(REPO_ROOT, ".tmp-activity-label-patched.js");
  try {
    await writeFile(tmp, patchOriginalActivityLabelVisibility(await readPinnedChunk()), "utf8");
    await run(process.execPath, ["--check", tmp]);
  } finally {
    await rm(tmp, { force: true });
  }
});

test("the staged renderer gets exactly one patched chunk plus provenance", { skip: pinnedSkip }, async (t) => {
  const { mkdtemp, readFile: rf, cp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const stageRoot = await mkdtemp(path.join(tmpdir(), "grok-node-activity-label-"));
  t.after(() => rm(stageRoot, { recursive: true, force: true }));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  // A second chunk carrying the same anchor must be left alone — and because the gate
  // requires exactly one candidate, staging two of them has to fail the build instead.
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  await cp(PINNED_CHUNK, path.join(assets, "decoy-AAAA.js"));
  await cp(PINNED_CSS, path.join(assets, "index-lCyB53CO.css"));
  await assert.rejects(
    applyOriginalRendererActivityLabelVisibility({ stageRoot }),
    /Expected one original renderer chunk .* found 2/,
  );
  await rm(path.join(assets, "decoy-AAAA.js"), { force: true });

  const record = await applyOriginalRendererActivityLabelVisibility({ stageRoot });
  assert.equal(record.chunks.length, 1);
  assert.equal(record.chunks[0].role, "activity-mark");
  assert.deepEqual(record.features, ["activity-label-always-visible-while-working"]);
  const patched = await rf(path.join(assets, "index-UbX-y3il.js"), "utf8");
  assert.ok(extractActivityMark(patched).includes(STATE_ONLY_INDEX), "staged chunk was not patched");
  const provenance = JSON.parse(
    await rf(path.join(stageRoot, "dist", "renderer-activity-label-visibility-extension.json"), "utf8"),
  );
  assert.equal(provenance.mode, "original-renderer-activity-label-visibility");
  assert.notEqual(provenance.chunks[0].original.sha256, provenance.chunks[0].patched.sha256);
  assert.ok(record.provenanceBytes > 0);
});

test("clean-build runs the activity-label patch with the renderer extensions", async () => {
  const source = await readFile(path.join(REPO_ROOT, "scripts/clean-build.mjs"), "utf8");
  const importIndex = source.indexOf('from "./lib/activity-label-visibility-renderer-patch.mjs"');
  assert.ok(importIndex > 0, "clean-build does not import the activity-label patch");
  const callIndex = source.indexOf("await applyOriginalRendererActivityLabelVisibility({ stageRoot });");
  assert.ok(callIndex > 0, "clean-build never calls the activity-label patch");
  const i18nIndex = source.indexOf("await applyOriginalRendererMainI18n({ stageRoot });");
  assert.ok(callIndex < i18nIndex, "the activity-label patch must run before the i18n passes");
});
