import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyOriginalRendererAppColumns0758Css } from "../scripts/lib/app-columns-0758-css-patch.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const portCssPath = path.join(repoRoot, "scripts/lib/app-columns-0758-official.css");
const portCss = await readFile(portCssPath, "utf8");

const pristineCssPath = path.join(repoRoot, "src/app/dist/renderer/assets/index-lCyB53CO.css");
const pristineCss = await readFile(pristineCssPath, "utf8").catch(() => null);
const pristineSkip = pristineCss == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; pristine-stylesheet assertions skipped."
  : false;

/** (pseudo-ids, classes, types) for a simple selector list — enough for the stylix
 * shapes in these stylesheets: one class plus N :not(#\#) pseudo-ids. */
function specificity(selector) {
  const pseudoIds = (selector.match(/:not\(#\\#\)/g) || []).length;
  const classes = (selector.match(/\.[A-Za-z0-9_-]+/g) || []).length;
  const types = (selector.match(/(^|[\s>+~])(main|header|aside)/g) || []).length;
  return [pseudoIds, classes, types];
}

async function makeStage(css) {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "app-columns-stage-"));
  const assetsDir = path.join(stageRoot, "dist/renderer/assets");
  await mkdir(assetsDir, { recursive: true });
  // The patch locates the stylesheet by the pinned 0.18 chunk name, so the sentinel
  // file must carry that name too.
  await writeFile(path.join(assetsDir, "index-UbX-y3il.js"), "");
  await writeFile(path.join(assetsDir, "index-test.css"), css);
  return stageRoot;
}

test("app-columns CSS port applies once to the staged stylesheet and records evidence", async () => {
  const baseline = [
    '.sand-1ua6jya:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-editor)}',
    '.sand-1ys0zz1:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-chrome)}',
  ].join("\n");
  const stageRoot = await makeStage(baseline);
  try {
    const evidence = await applyOriginalRendererAppColumns0758Css({ stageRoot });
    assert.equal(evidence.surfaces.length, 3);
    assert.match(evidence.file, /^dist\/renderer\/assets\/index-.*\.css$/);
    const patched = await readFile(path.join(stageRoot, evidence.file), "utf8");
    assert.equal(patched, baseline + "\n" + portCss);
    const recorded = JSON.parse(await readFile(path.join(stageRoot, "dist/renderer-app-columns-0758-extension.json"), "utf8"));
    assert.equal(recorded.portCssSha256, evidence.portCssSha256);
    // Idempotence: a second application must fail closed, not double-append.
    await assert.rejects(
      () => applyOriginalRendererAppColumns0758Css({ stageRoot }),
      /already applied/,
    );
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
});

test("app-columns CSS port fails closed when the 0.18 rules it must outrank are absent", async () => {
  const stageRoot = await makeStage("body{margin:0}");
  try {
    await assert.rejects(
      () => applyOriginalRendererAppColumns0758Css({ stageRoot }),
      /found no 0\.18 rule to outrank/,
    );
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
});

test("the ported CSS carries official 0.75.8's tokens and the verbatim toolbar gradient", () => {
  // Dark values read from the running official app's #sand-cursor-theme runtime style.
  assert.ok(portCss.includes("--sand-bg-chrome:#121212"));
  assert.ok(portCss.includes("--sand-bg-pane:#161616"));
  assert.ok(portCss.includes("--sand-bg-sidebar:#0e0e0e"));
  // Light values from official's static :root set.
  assert.ok(portCss.includes("--sand-bg-chrome:#fcfcfc"));
  assert.ok(portCss.includes("--sand-bg-pane:#fff"));
  assert.ok(portCss.includes("--sand-bg-sidebar:#f5f5f5"));
  // The toolbar scrim declaration, verbatim from official's stylesheet.
  assert.ok(portCss.includes(
    "{background-image:linear-gradient(to bottom, var(--sand-bg-chrome), transparent)}",
  ));
  // The three painted surfaces.
  for (const selector of [
    ".sand-shell:not(#\\#):not(#\\#):not(#\\#):not(#\\#){background-color:var(--sand-bg-chrome)}",
    ".sand-agents-sidebar:not(#\\#):not(#\\#):not(#\\#):not(#\\#){background-color:var(--sand-bg-sidebar)}",
  ]) {
    assert.ok(portCss.includes(selector), selector);
  }
  assert.match(portCss, /main\.sand-chat header\.sand-toolbar:not\(#\\#\):not\(#\\#\):not\(#\\#\):not\(#\\#\)\{background-image:/);
});

test("the port outranks the 0.18 rules on specificity, not on order", { skip: pristineSkip }, () => {
  // The counterparty rules really exist in the pristine 0.18 stylesheet, exactly once.
  for (const anchor of [
    '.sand-1ua6jya:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-editor)}',
    '.sand-1ys0zz1:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-chrome)}',
  ]) {
    assert.equal(pristineCss.split(anchor).length - 1, 1, anchor);
  }
  // The port's selectors strictly beat them, so stylesheet order cannot flip the winner.
  const shellPort = ".sand-shell:not(#\\#):not(#\\#):not(#\\#):not(#\\#)";
  const railPort = ".sand-agents-sidebar:not(#\\#):not(#\\#):not(#\\#):not(#\\#)";
  const shell018 = ".sand-1ua6jya:not(#\\#):not(#\\#):not(#\\#)";
  const rail018 = ".sand-1ys0zz1:not(#\\#):not(#\\#):not(#\\#)";
  assert.ok(specificity(shellPort) > specificity(shell018), "shell port must outrank the 0.18 shell rule");
  assert.ok(specificity(railPort) > specificity(rail018), "rail port must outrank the 0.18 rail rule");
});

test("the three token names are dormant in the 0.18 baseline", { skip: pristineSkip }, () => {
  // Defining them cannot change any 0.18 rule that never referenced them.
  for (const token of ["var(--sand-bg-chrome)", "var(--sand-bg-sidebar)", "var(--sand-bg-pane)"]) {
    assert.equal(pristineCss.split(token).length - 1, 0, token);
  }
  // And the official classes the port replaces are genuinely absent from 0.18.
  for (const cls of [".sand-1qj4qm9", ".sand-1p3z83a", ".sand-1z0swcc"]) {
    assert.equal(pristineCss.split(cls).length - 1, 0, cls);
  }
});
