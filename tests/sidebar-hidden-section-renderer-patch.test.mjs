// Regression cover for the 0.71.2 inline Hidden Bots sidebar section and
// "Show in sidebar" context-menu flip.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "acorn";

import { patchOriginalSidebarRenameMenu } from "../scripts/lib/sidebar-rename-menu-renderer-patch.mjs";
import {
  applyOriginalRendererSidebarHiddenSection,
  assertSidebarHiddenSectionStylesResolve,
  patchOriginalSidebarHiddenSection,
  SIDEBAR_HIDDEN_SECTION_ANCHORS,
  SIDEBAR_HIDDEN_SECTION_EVIDENCE,
} from "../scripts/lib/sidebar-hidden-section-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const PINNED_CSS_DIR = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const run = promisify(execFile);

const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedSkip =
  pinnedChunk == null
    ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
    : false;
const renamed = pinnedChunk == null ? null : patchOriginalSidebarRenameMenu(pinnedChunk);
const patched = renamed == null ? null : patchOriginalSidebarHiddenSection(renamed);

function moduleLevelBindings(source) {
  const names = new Set();
  const addPattern = node => {
    if (node == null) return;
    if (node.type === "Identifier") names.add(node.name);
    else if (node.type === "ObjectPattern") for (const prop of node.properties) addPattern(prop.type === "RestElement" ? prop.argument : prop.value);
    else if (node.type === "ArrayPattern") for (const el of node.elements) addPattern(el);
    else if (node.type === "AssignmentPattern") addPattern(node.left);
    else if (node.type === "RestElement") addPattern(node.argument);
  };
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) names.add(node.id.name);
    else if (node.type === "VariableDeclaration") for (const decl of node.declarations) addPattern(decl.id);
    else if (node.type === "ImportDeclaration") for (const spec of node.specifiers) names.add(spec.local.name);
  }
  return names;
}

function functionSource(source, head) {
  const start = source.indexOf(head);
  assert.ok(start >= 0, `missing ${head}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${head}`);
}

const SENTINEL = Symbol.for("react.memo_cache_sentinel");

test("evidence record names the 0.71.2 section and show-in-sidebar anchors", () => {
  assert.match(SIDEBAR_HIDDEN_SECTION_EVIDENCE.section, /YD/);
  assert.match(SIDEBAR_HIDDEN_SECTION_EVIDENCE.showInSidebar, /rf\+5cn/);
  assert.match(SIDEBAR_HIDDEN_SECTION_EVIDENCE.showInSidebar, /在侧边栏显示/);
});

test("every hidden-section anchor resolves exactly once after the rename pass", { skip: pinnedSkip }, () => {
  for (const [label, before] of SIDEBAR_HIDDEN_SECTION_ANCHORS) {
    assert.equal(renamed.split(before).length - 1, 1, label);
  }
});

test("the patched chunk parses as an ES module with node --check", { skip: pinnedSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sidebar-hidden-"));
  const file = path.join(dir, "chunk.js");
  await writeFile(file, patched);
  await run(process.execPath, ["--check", file]);
});

test("inline Hidden section replaces the dialog standalone row", { skip: pinnedSkip }, () => {
  assert.match(patched, /function RHiddenSection\(/);
  assert.match(patched, /jsx\(RHiddenSection,\{/);
  assert.equal(patched.includes('isStandalone:!0,label:"Hidden Bots"'), false);
  assert.equal(patched.includes('aria-haspopup":"dialog",count:N'), false);
  assert.match(patched, /!i&&N>0\?p\.jsx\(RHiddenSection/);
  assert.match(patched, /RLocT\("Hidden Bots","已隐藏的 Bot"\)/);
});

test("context menu offers Show in sidebar when the agent is hidden", { skip: pinnedSkip }, () => {
  assert.match(patched, /function RShowInSidebarItem\(/);
  assert.match(patched, /RLocT\("Show in sidebar","在侧边栏显示"\)/);
  assert.match(patched, /t\.isHiddenFromSidebar===!0\?p\.jsx\(RShowInSidebarItem/);
  assert.match(patched, /RLocT\("Hide from sidebar","从侧边栏隐藏"\)/);
  assert.match(patched, /unhideFromSidebar:O/);
  assert.match(patched, /onShowInSidebar:\$i\.unhideFromSidebar/);
});

test("injected helpers are module-level bindings", { skip: pinnedSkip }, () => {
  const top = moduleLevelBindings(patched);
  assert.equal(top.has("RHiddenSection"), true);
  assert.equal(top.has("RShowInSidebarItem"), true);
  assert.equal(top.has("Crn"), true);
  assert.equal(top.has("Zbe"), true);
});

test("RHiddenSection renders a fold header and Crn reveal body", { skip: pinnedSkip }, () => {
  const body = functionSource(patched, "function RHiddenSection(");
  assert.match(body, /jsx\(Zbe,/);
  assert.match(body, /jsx\(Crn,/);
  assert.match(body, /sand-agents-section__reveal/);
  assert.match(body, /isLocked:!0/);
});

test("pinned CSS resolves every class the section mounts", { skip: pinnedSkip }, async () => {
  const files = await (await import("node:fs/promises")).readdir(PINNED_CSS_DIR);
  const cssFile = files.find(name => name.startsWith("index") && name.endsWith(".css"));
  assert.ok(cssFile);
  assertSidebarHiddenSectionStylesResolve(await readFile(path.join(PINNED_CSS_DIR, cssFile), "utf8"));
});

test("applyOriginalRendererSidebarHiddenSection writes provenance", { skip: pinnedSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sidebar-hidden-stage-"));
  const assets = path.join(dir, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "index-UbX-y3il.js"), renamed);
  const cssFiles = await (await import("node:fs/promises")).readdir(PINNED_CSS_DIR);
  const cssFile = cssFiles.find(name => name.startsWith("index") && name.endsWith(".css"));
  await cp(path.join(PINNED_CSS_DIR, cssFile), path.join(assets, cssFile));
  const provenance = await applyOriginalRendererSidebarHiddenSection({ stageRoot: dir });
  assert.equal(provenance.mode, "sidebar-inline-hidden-section");
  const written = await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8");
  assert.match(written, /function RHiddenSection\(/);
  const json = JSON.parse(await readFile(path.join(dir, "dist", "renderer-sidebar-hidden-section-extension.json"), "utf8"));
  assert.equal(json.file, "dist/renderer/assets/index-UbX-y3il.js");
});

test("mutation: restoring the dialog row fails the parity assertion shape", { skip: pinnedSkip }, () => {
  const mutated = patched.replace(
    "!i&&N>0?p.jsx(RHiddenSection,{agents:RHiddenAgents,isDragActive:be!=null,isFolded:RHiddenFolded,onToggleFolded:()=>RSetHiddenFolded(RPrev=>!RPrev),renderAgent:F})",
    'N>0?p.jsx(Zbe,{"aria-haspopup":"dialog",count:N,isFolded:!1,isStandalone:!0,label:"Hidden Bots",onClick:()=>{}})',
  );
  assert.notEqual(mutated, patched);
  assert.equal(mutated.includes("jsx(RHiddenSection,{"), false);
  assert.equal(mutated.includes('isStandalone:!0,label:"Hidden Bots"'), true);
});

test("mutation: always offering Hide (never Show) fails the flip gate", { skip: pinnedSkip }, () => {
  const gate = "t.isHiddenFromSidebar===!0?p.jsx(RShowInSidebarItem,{id:t.id,onShowInSidebar:RShowIn}):p.jsx(ccn,{id:t.id,onHideFromSidebar:E})";
  assert.match(patched, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const mutated = patched.replace(gate, "p.jsx(ccn,{id:t.id,onHideFromSidebar:E})");
  assert.notEqual(mutated, patched);
  assert.equal(mutated.includes("t.isHiddenFromSidebar===!0?p.jsx(RShowInSidebarItem"), false);
});
