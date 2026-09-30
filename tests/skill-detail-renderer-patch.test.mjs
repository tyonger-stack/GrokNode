import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import {
  SKILL_DETAIL_CLASS_NAMES,
  SKILL_DETAIL_UNSUPPORTED_CLASS_NAMES,
  assertSkillDetailClassesResolve,
  patchOriginalSkillDetail,
} from "../scripts/lib/skill-detail-renderer-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const chunkName = "view-B5Ug8wEm.js";
const bundle = await readFile(path.join(assetsRoot, chunkName), "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

async function readPinnedStylesheets() {
  let sheets = "";
  for (const name of await readdir(assetsRoot).catch(() => [])) {
    if (name.endsWith(".css")) sheets += await readFile(path.join(assetsRoot, name), "utf8");
  }
  return sheets;
}

/** Names bound on the module's Program body — the only ones a module-level injection may reference. */
function topLevelBindings(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  const collectPattern = node => {
    if (!node) return;
    switch (node.type) {
      case "Identifier": names.add(node.name); break;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") collectPattern(property.argument);
          else collectPattern(property.value);
        }
        break;
      case "ArrayPattern":
        for (const element of node.elements) collectPattern(element);
        break;
      case "AssignmentPattern": collectPattern(node.left); break;
      case "RestElement": collectPattern(node.argument); break;
      default: break;
    }
  };
  for (const statement of ast.body) {
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      if (statement.id) names.add(statement.id.name);
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) collectPattern(declarator.id);
      continue;
    }
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) names.add(specifier.local.name);
    }
  }
  return names;
}

test("the 0.62.0 skill-detail port applies once to the pinned chunk and stays parseable", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  for (const recipe of ["RSkillDetailHeaderActions", "RSkillDetailBody", "RSkillDetailActionBar", "RSkillDetailDeleteDanger"]) {
    assert.equal(patched.split(`const ${recipe}=`).length - 1, 1, recipe + " must be injected exactly once");
  }
});

test("every identifier the injected recipes depend on is a module-level binding", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  const bindings = topLevelBindings(patched);
  // The four recipes themselves, plus the chunk bindings the new JSX reaches for.
  // `nl` (scroll pane), `ve` (Button) and `Bi` (publish trigger) are the identifiers the
  // port newly references from inside Hi's body, so they must be reachable at module
  // scope — a function-local binding of the same name elsewhere would be a runtime
  // ReferenceError that typecheck, npm test and the packaging all pass straight through.
  for (const name of ["RSkillDetailHeaderActions", "RSkillDetailBody", "RSkillDetailActionBar", "RSkillDetailDeleteDanger", "nl", "ve", "Bi", "t"]) {
    assert.ok(bindings.has(name), name + " must be bound on the module Program body");
  }
});

test("the instructions textarea sizes to its content instead of a draggable 80px box", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  const recipe = /Ne=k\("([^"]+)"\)/.exec(patched);
  assert.ok(recipe, "the textarea recipe is missing");
  const classes = recipe[1].split(/\s+/);
  // 0.62.0's Mn.textarea: field-sizing:content, min-height 106, max-height 320,
  // resize:none, overflow-y:auto, plus its thin-scrollbar recipe.
  for (const name of ["sand-5f5z56", "sand-tt52l0", "sand-1odjw0f", "sand-1sslpiy"]) {
    assert.ok(classes.includes(name), "textarea recipe lost " + name);
  }
  for (const name of ["sand-1597r2g", "sand-xkn5u1", "sand-y2251v", "sand-122zoth", "sand-1ch4u7m", "sand-1nh7un5", "sand-9xsh1y"]) {
    assert.ok(classes.includes(name), "textarea recipe lost thin-scrollbar class " + name);
  }
  // 0.18's min-height:80px / resize:vertical pair is what produced the clipped box with
  // a drag handle, and both classes must be gone from this recipe.
  for (const stale of ["sand-seoqlg", "sand-288g5"]) {
    assert.ok(!classes.includes(stale), stale + " is the 0.18 textarea sizing the port replaces");
  }
  // sand-jgen18 (min-height:106px) has no 0.18 twin, so it rides the style prop.
  assert.match(
    patched,
    /t\.jsx\("textarea",\{className:Ne,[^}]*style:\{minHeight:"106px"\}[^}]*value:m\}\)/,
    "the textarea needs an inline min-height floor",
  );
});

test("the detail root fills the pane and owns its own scroll region", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  // 0.18's root was gap-24 with no growth, which is what left the empty band under the form.
  assert.doesNotMatch(patched, /V=k\("sand-plugins-skill-detail","sand-9f619 sand-78zum5 sand-dt5ytf sand-1665zp3"\)/);
  assert.match(patched, /V=k\("sand-plugins-skill-detail","[^"]*sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-dt5ytf sand-2lwn1j"\)/);
  // The header+form pair moves into the detail's own scroll pane over a gap-24 column,
  // with the action bar beside that scroll pane rather than inside it.
  assert.match(patched, /t\.jsx\(nl,\{children:t\.jsxs\("div",\{className:RSkillDetailBody,children:\[G,Ae\]\}\)\}\),Ce\]\}/);
  assert.match(patched, /className:ee,children:\[oe,fe,Se\]\}/);
  // 0.62.0 returns a skill detail straight from the pane's dispatch, so the detail must
  // not stay wrapped in the pane-level scroll pane as well.
  assert.match(patched, /Le=Me!=null\?Rs:t\.jsx\(nl,\{ref:Es,children:Rs\},_s\)/);
  assert.doesNotMatch(patched, /Le=t\.jsx\(nl,\{ref:Es,children:Rs\},_s\)/);
});

test("mutation controls move where 0.62.0 puts them", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  const hi = patched.slice(patched.indexOf("function Hi(n)"), patched.indexOf("const Wi={authBlocked:[]}"));
  // Delete leaves the bottom of the form and joins the publish trigger in a header
  // actions group, as a secondary button carrying the deleteDanger root style.
  assert.doesNotMatch(hi, /children:\[oe,fe,Se,Ce,Pe\]/);
  assert.doesNotMatch(hi, /(?<![A-Za-z0-9_$])Pe(?![A-Za-z0-9_$])/);
  assert.match(hi, /className:RSkillDetailHeaderActions,children:\[g\?null:t\.jsx\(Bi,\{/);
  assert.match(hi, /rootStyle:RSkillDetailDeleteDanger,size:"sm",type:"button",variant:"secondary",children:\(RLocT\("Delete Skill","删除技能"\)\)/);
  // Save keeps its position relative to the form but becomes a footer action bar with
  // 0.62.0's top rule and 12/12/16 padding.
  assert.match(hi, /className:RSkillDetailActionBar,style:\{paddingInlineEnd:"12px"\},children:t\.jsx\(ve,\{disabled:!T/);
  assert.match(patched, /const RSkillDetailActionBar="[^"]*sand-t8cgyo sand-13fuv20 sand-s351rv"/);
  // The delete button stays hidden for managed and plugin skills, exactly as 0.18 did.
  assert.match(hi, /a!=null&&!w&&!g\?t\.jsx\(ve,\{"aria-busy":S/);
});

// 0.62.0 reads the Delete label and the provenance badge through i18n keys
// (`rvJGTw`, `V1Vjra`, `7eKKjp`, `quCEII`); 0.18 hard-codes English. The zh-Hans
// values below are 0.62.0's own (chunk-core-dNaCtJM1.js): 删除技能 / 私有技能 /
// 由 Cursor 管理 / 已与你的团队共享.
test("the delete label and the provenance badge are localized like 0.62.0", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  for (const [en, zh] of [
    ["Delete Skill", "删除技能"],
    ["Private skill", "私有技能"],
    ["Managed by Cursor", "由 Cursor 管理"],
    ["Shared with your team", "已与你的团队共享"],
  ]) {
    assert.ok(
      patched.includes(`(RLocT("${en}","${zh}"))`),
      `expected the RLocT pair for ${en}`,
    );
  }
  // The badge's source/managed/plugin branching must survive the rewrite.
  assert.match(patched, /w=s\.source==="plugin",g=s\.source==="managed";/);
  assert.match(patched, /g\?A=\(RLocT\("Managed by Cursor","由 Cursor 管理"\)\):w&&\(A=\(RLocT\("Shared with your team","已与你的团队共享"\)\)\);/);
  // 0.62.0 has no raw English badge left to leak into a Chinese UI.
  assert.doesNotMatch(patched, /let A="Private skill"/);
});

test("no React Compiler memo slot is claimed by two statements", { skip: bundleSkip }, () => {
  // The port reuses the memo slots 89-92 that the deleted delete-button block owned, so
  // the new header-actions dependencies cannot collide with a neighbour. Each slot must
  // appear in exactly one statement (a guard plus its two branch reads/writes).
  const patched = patchOriginalSkillDetail(bundle);
  const hi = patched.slice(patched.indexOf("function Hi(n)"), patched.indexOf("const Wi={authBlocked:[]}"));
  const statements = hi.split(/(?<=;)(?=let |const |var |return )/);
  // One memo statement legitimately mentions a slot three times (guard, then-branch
  // write, else-branch read), so ownership is counted per statement, not per mention.
  const owners = new Map();
  statements.forEach((statement, index) => {
    for (const match of statement.matchAll(/e\[(\d+)\]/g)) {
      if (!owners.has(match[1])) owners.set(match[1], new Set());
      owners.get(match[1]).add(index);
    }
  });
  const shared = [...owners].filter(([, uses]) => uses.size > 1);
  assert.deepEqual(
    shared.map(([slot]) => "e[" + slot + "]"),
    [],
    "memo slots reused by more than one statement",
  );
  // The cache array is sized 104, so nothing may index past 103.
  for (const slot of owners.keys()) {
    assert.ok(Number(slot) <= 103, "e[" + slot + "] is past the end of the component's memo cache");
  }
});

test("the labels main-i18n localises are left untouched", { skip: bundleSkip }, () => {
  const patched = patchOriginalSkillDetail(bundle);
  for (const literal of ['children:"Name"', 'children:"Description"', 'children:"Instructions"', 'children:"Save"']) {
    assert.ok(patched.includes(literal), "the i18n passes lose their anchor: " + literal);
  }
  // The 0.18 instructions placeholder is deliberately kept so main-i18n's pair table is
  // not stranded; the port only changes the field's box, not its copy.
  assert.ok(patched.includes('placeholder:"Markdown instructions the agent follows when it runs this skill"'));
});

test("every class the ported pane relies on is defined by the pinned stylesheet", { skip: bundleSkip }, async () => {
  const sheets = await readPinnedStylesheets();
  assert.ok(sheets.length > 0, "the pinned renderer stylesheet is missing");
  assert.equal(assertSkillDetailClassesResolve(sheets), SKILL_DETAIL_CLASS_NAMES.length);
  assert.throws(() => assertSkillDetailClassesResolve(sheets, ["sand-2lwn1j", "sand-not-in-the-pin"]), /missing from the pinned renderer stylesheet/);
});

test("the two 0.62.0-only declarations stay off the className strings", { skip: bundleSkip }, async () => {
  const patched = patchOriginalSkillDetail(bundle);
  const sheets = await readPinnedStylesheets();
  for (const name of SKILL_DETAIL_UNSUPPORTED_CLASS_NAMES) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(patched), name + " must not be referenced by the ported chunk");
    // 0.18 never shipped these rules; if a future stylesheet grows one, the inline
    // fallbacks in the patch should be retired rather than silently duplicated.
    assert.ok(!new RegExp(`\\.${name}(?![\\w-])`).test(sheets), name + " unexpectedly exists in the pinned stylesheet");
  }
  assert.ok(patched.includes('style:{minHeight:"106px"}'));
  assert.ok(patched.includes('style:{paddingInlineEnd:"12px"}'));
});

test("the skill detail port fails closed when an anchor is missing or already applied", { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalSkillDetail("function Hi(n){}"), /anchor is missing or ambiguous/);
  assert.throws(() => patchOriginalSkillDetail(patchOriginalSkillDetail(bundle)), /anchor is missing or ambiguous/);
});

test("the patch module records where every 0.62.0 claim came from", async () => {
  const source = await readFile(path.resolve(import.meta.dirname, "../scripts/lib/skill-detail-renderer-patch.mjs"), "utf8");
  for (const claim of [
    "chunk-view-CUl9t9OA.js",
    "index.eager-app-C20nv6Dx.js",
    "view-B5Ug8wEm.js",
    "field-sizing: content",
    "min-height: 106px",
    "min-height: 80px",
    "resize: vertical",
    "S.target.kind === \"skill\"",
    "sand-pdmqnj",
    "sand-jgen18",
  ]) {
    assert.ok(source.includes(claim), "missing documented provenance: " + claim);
  }
});
