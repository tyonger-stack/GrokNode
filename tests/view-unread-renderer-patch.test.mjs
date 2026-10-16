import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalViewUnread } from "../scripts/lib/view-unread-renderer-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const bundle = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = bundle == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;

const patched = bundle == null ? null : patchOriginalViewUnread(bundle);

function moduleLevelBindings(source) {
  const names = new Set();
  const addPattern = (node) => {
    if (node == null) return;
    switch (node.type) {
      case "Identifier":
        names.add(node.name);
        return;
      case "ObjectPattern":
        for (const prop of node.properties) addPattern(prop.type === "RestElement" ? prop.argument : prop.value);
        return;
      case "ArrayPattern":
        for (const el of node.elements) addPattern(el);
        return;
      case "AssignmentPattern":
        addPattern(node.left);
        return;
      case "RestElement":
        addPattern(node.argument);
        return;
      default:
        return;
    }
  };
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      if (node.id != null) names.add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) addPattern(decl.id);
    } else if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) names.add(spec.local.name);
    }
  }
  return names;
}

function extractUnreadRuntime(source) {
  const start = source.indexOf("const RUnreadEmptyHidden=[]");
  assert.ok(start >= 0, "unread runtime missing");
  const end = source.indexOf("const $X=", start);
  assert.ok(end > start, "unread runtime end anchor missing");
  return source.slice(start, end);
}

test("view-unread patch applies once and stays parseable", { skip: bundleSkip }, () => {
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RUnreadFilterRoster(").length - 1, 1);
  assert.ok(patched.split("RUnreadOnlySubscribe").length - 1 >= 2);
  const topLevel = moduleLevelBindings(patched);
  for (const id of ["RUnreadFilterRoster", "RUnreadOnlySet", "RUnreadOnlyGet", "RUnreadOnlySubscribe", "S"]) {
    assert.ok(topLevel.has(id), `${id} must be a module-level binding`);
  }
});

test("RUnreadFilterRoster keeps unread and current agent only when filter is on", { skip: bundleSkip }, () => {
  const runtime = extractUnreadRuntime(patched);
  const api = new Function(`${runtime}; return { RUnreadOnlySet, RUnreadFilterRoster, RUnreadOnlyGet };`)();
  const roster = {
    visibleAgents: [
      { id: "a", hasUnread: true },
      { id: "b", hasUnread: false },
      { id: "c", hasUnread: false },
    ],
    hiddenAgents: [{ id: "h", hasUnread: true }],
  };
  assert.deepEqual(api.RUnreadFilterRoster(roster, "c"), roster);
  api.RUnreadOnlySet(true);
  assert.equal(api.RUnreadOnlyGet(), true);
  const filtered = api.RUnreadFilterRoster(roster, "c");
  assert.deepEqual(
    filtered.visibleAgents.map((a) => a.id),
    ["a", "c"],
  );
  assert.deepEqual(filtered.hiddenAgents, []);
});

test("sFn memo and event/bridge wiring land exactly once", { skip: bundleSkip }, () => {
  assert.match(
    patched,
    /S\.useMemo\(\(\)=>RUnreadFilterRoster\(lmt\(H\),e\),\[H,e,RUnreadOnly\]\)/,
  );
  assert.equal(
    patched.split('"unread-filter-menu-clicked":({isChecked:Be})=>RUnreadOnlySet(Be===!0)').length - 1,
    1,
  );
  assert.equal(patched.split("onUnreadFilterMenuClicked").length - 1, 1);
  assert.doesNotMatch(
    patched,
    /const H=_On\(n,r\),\{visibleAgents:G,hiddenAgents:Y\}=S\.useMemo\(\(\)=>lmt\(H\),\[H\]\)/,
  );
});

test("MUTATION: reverting the sFn memo anchor makes the patch fail closed", { skip: bundleSkip }, () => {
  const broken = bundle.replace(
    "const H=_On(n,r),{visibleAgents:G,hiddenAgents:Y}=S.useMemo(()=>lmt(H),[H])",
    "const H=_On(n,r),{visibleAgents:G,hiddenAgents:Y}=S.useMemo(()=>lmt(H),[H,n])",
  );
  assert.throws(() => patchOriginalViewUnread(broken), /sFn unread roster memo/);
});

test("MUTATION: reverting the Ie open-about neighbour makes the patch fail closed", { skip: bundleSkip }, () => {
  const broken = bundle.replace(
    '"open-about":()=>y.ingestOpenIntent(),"focus-agent"',
    '"open-about":()=>y.ingestOpenIntent(),"focus-agent-x"',
  );
  assert.throws(() => patchOriginalViewUnread(broken), /Ie unread-filter-menu-clicked/);
});
