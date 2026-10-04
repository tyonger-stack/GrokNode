import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Requirement A — 「官方页 2 的私有技能行可以点进详情页（第三界面），支持删除/编辑」 — was guarded
 * ONLY by source assertions: `plugins-marketplace-renderer-patch.test.mjs` greps the patch text
 * for `onOpenSkill` / `onDeleteSkill` / `onSaveSkill`, and the two runtime DOM tests stub those
 * handlers to no-ops. A green suite therefore said nothing about whether a click on a 私有技能 row
 * reaches the third page, or whether that page's 删除 and 保存 buttons call back with anything real.
 *
 * This mounts the REAL `createMarketplaceDialog`, clicks a real row, and asserts the tree and the
 * handler payloads that come out. It says nothing about pixels — `npm run marketplace:css` and the
 * CDP probes own that. What it owns is: the page pushes, the controls exist exactly where
 * upstream has them, and each control hands back the skill it was about.
 */

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function loadEntry(entry, outName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
  });
  return import(pathToFileURL(outfile).href);
}

const VIEWS = await loadEntry(
  "frontend/src/extensions/marketplace/view.ts",
  "tests-mkt-skill-detail-runtime.mjs",
);

const calls = { open: [], del: [], save: [] };
const HANDLERS = {
  close: () => {}, openManage: () => {}, backToMarket: () => {}, onQuery: () => {},
  onToggleInstalledExpanded: () => {}, onAdd: () => {}, onAuthenticate: () => {}, onOpenRow: () => {},
  onViewAll: () => {}, onBack: () => {}, onUninstall: () => {}, onShare: () => {},
  onOpenSkill: (skill) => calls.open.push(skill),
  onDeleteSkill: (skill) => calls.del.push(skill),
  onSaveSkill: (skill, draft) => calls.save.push([skill, draft]),
};
const resetCalls = () => { calls.open.length = 0; calls.del.length = 0; calls.save.length = 0; };

const emptyModel = () => ({
  rows: [], featured: [], team: [], forYou: [], categoryGroups: [], showsTrailingBrowse: false,
});

/** Typed to the real `PrivateSkill`. A fixture that under-specifies its subject fails inside the
 *  renderer for a reason that has nothing to do with the structure under test — the first pass of
 *  the page-2 suite lost a day to `location` where the field is `filePath`. */
const skill = (over) => ({
  id: "wk-1",
  name: "写周报",
  description: "每周五生成周报",
  source: "workflow",
  body: "# 周报\n\n写周报。",
  filePath: "/home/box/sand-data/workflows/weekly/SKILL.md",
  enabled: true,
  pluginId: null,
  ...over,
});

const WORKFLOW = skill();
const MANAGED = skill({
  id: "mg-1",
  name: "翻译",
  source: "managed",
  filePath: "/home/box/sand-data/managed-skills/skills/translate/SKILL.md",
  pluginId: "gmail",
});

const baseState = (over) => ({
  model: emptyModel(),
  installed: [], skills: [WORKFLOW, MANAGED],
  servers: [],
  page: "manage",
  sectionGroup: null,
  detailRow: null,
  skillDetail: null,
  query: "",
  installedExpanded: false,
  busy: false,
  loading: false,
  catalogError: null,
  skillsError: null,
  ...over,
});

const SWAPPED = ["document", "navigator", "HTMLElement", "Node", "Event", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"];

function mount(state) {
  const win = new Window({ url: "file:///renderer/index.html" });
  const prior = SWAPPED.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const put = (key, value) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
  put("window", win);
  for (const key of SWAPPED) {
    const v = win[key];
    if (v !== undefined) put(key, v);
  }
  let dialog;
  try {
    dialog = VIEWS.createMarketplaceDialog(state, HANDLERS);
    win.document.body.append(dialog.root);
    dialog.render(state);
  } catch (e) {
    for (const [key, desc] of prior) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
    throw e;
  }
  const restore = () => {
    for (const [key, desc] of prior) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  return {
    root: dialog.root,
    doc: win.document,
    win,
    render: (next) => dialog.render(next),
    destroy() { try { dialog.destroy(); } finally { restore(); } },
  };
}

const text = (n) => String(n.textContent ?? "").replace(/\s+/g, " ").trim();
const buttonByText = (doc, label) =>
  [...doc.querySelectorAll("button")].find((b) => text(b) === label);
const detailRoot = (root) => root.querySelector("[id='sand-plugins-detail-heading']");
const byLabel = (root, label) =>
  [...root.querySelectorAll("input,textarea")].find((n) => n.getAttribute("aria-label") === label);

test("clicking a 私有技能 row hands the exact skill to onOpenSkill", () => {
  resetCalls();
  const h = mount(baseState());
  try {
    const rows = [...h.root.querySelectorAll("button")]
      .filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("打开 "));
    assert.equal(rows.length, 2, "页 2 renders one openable row per private skill");
    rows[1].dispatchEvent(new h.win.Event("click"));
    assert.equal(calls.open.length, 1, "exactly one navigation, not one per row");
    // Identity, not a name match: a handler that receives a re-derived copy would drop `filePath`
    // and `pluginId`, and the detail page renders both.
    assert.equal(calls.open[0], MANAGED, "the handler gets the very object the row was built from");
  } finally { h.destroy(); }
});

test("the third page renders the skill, and 删除 calls back with that skill", () => {
  resetCalls();
  const h = mount(baseState({ page: "skill", skillDetail: WORKFLOW }));
  try {
    const heading = detailRoot(h.root);
    assert.ok(heading, "the skill detail page mounts its heading");
    assert.equal(heading.tagName, "H3");
    assert.equal(text(heading), WORKFLOW.name);

    const del = buttonByText(h.doc, "删除");
    assert.ok(del, "the skill detail page has a 删除 control");
    del.dispatchEvent(new h.win.Event("click"));
    assert.deepEqual(calls.del, [WORKFLOW], "删除 hands back the skill it is about");

    // 信息 · 来源 / 位置 / 状态 — the three rows the brief's page 2 is expected to show.
    const body = text(h.root);
    for (const label of ["信息", "来源", "位置", "状态"]) {
      assert.ok(body.includes(label), `the detail page shows ${label}`);
    }
    assert.ok(body.includes("workflows/"), "a user-written skill reports the workflows/ root");
  } finally { h.destroy(); }
});

test("a managed-skills skill reports its own root and offers no edit affordance", () => {
  const h = mount(baseState({ page: "skill", skillDetail: MANAGED }));
  try {
    const body = text(h.root);
    assert.ok(body.includes("managed-skills/skills/"), "a platform skill reports the managed-skills/ root");
    assert.equal(body.includes("workflows/"), false, "and not the user-written root");
    // Upstream does not render the control at all — a disabled 保存 would be an invention.
    assert.equal(buttonByText(h.doc, "保存"), undefined, "no 保存 on a platform-installed skill");
    assert.equal(h.root.querySelectorAll("input,textarea").length, 0, "and no form fields at all");
    assert.ok(body.includes("无法在此编辑"), "the read-only state is stated, not implied by absence");
  } finally { h.destroy(); }
});

test("保存 stays disabled until the draft is both valid and different, then saves the draft", () => {
  resetCalls();
  const h = mount(baseState({ page: "skill", skillDetail: WORKFLOW }));
  try {
    const save = buttonByText(h.doc, "保存");
    assert.ok(save, "a user-written skill has an edit form with 保存");
    assert.equal(save.disabled, true, "an unchanged draft must not be savable");

    const nameInput = byLabel(h.root, "技能名称");
    const bodyInput = byLabel(h.root, "技能内容");
    assert.ok(nameInput && bodyInput, "the form carries the name and body fields");

    // Changed but INVALID (blank name) — still disabled. This is the branch a `!==` only check
    // gets wrong, and it is the one that would let a user erase their own skill.
    nameInput.value = "   ";
    nameInput.dispatchEvent(new h.win.Event("input"));
    assert.equal(save.disabled, true, "a blank name must keep 保存 disabled");

    nameInput.value = "写月报";
    nameInput.dispatchEvent(new h.win.Event("input"));
    assert.equal(save.disabled, false, "a valid, changed draft enables 保存");

    bodyInput.value = "# 月报\n\n写月报。";
    bodyInput.dispatchEvent(new h.win.Event("input"));
    save.dispatchEvent(new h.win.Event("click"));

    assert.equal(calls.save.length, 1);
    const [original, draft] = calls.save[0];
    assert.equal(original, WORKFLOW, "the original skill is passed through untouched");
    assert.equal(draft.name, "写月报", "and the draft carries the edited field values");
    assert.equal(draft.body, "# 月报\n\n写月报。");
    assert.equal(draft.filePath, WORKFLOW.filePath, "fields the form does not own are carried over");
  } finally { h.destroy(); }
});

test("a skill with an empty SKILL.md renders no body block rather than an empty one", () => {
  const h = mount(baseState({ page: "skill", skillDetail: skill({ body: "", description: "只有描述" }) }));
  try {
    const body = text(h.root);
    assert.ok(body.includes("只有描述"), "the description still renders");
    assert.equal(h.root.querySelectorAll("pre").length, 0, "no empty <pre> standing in for a body");
  } finally { h.destroy(); }
});
