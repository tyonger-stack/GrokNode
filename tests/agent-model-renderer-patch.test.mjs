import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import {
  COMPONENT_SOURCE,
  H3N_RETURN_AFTER,
  H3N_RETURN_BEFORE,
  MODEL_CONTROL_CLASSES,
  MODEL_CONTROL_MAX_WIDTH,
  MODEL_TEXT_CLASSES,
  MODEL_TRIGGER_CLASSES,
  MODEL_TRIGGER_ROOT_STYLE,
  REQUIRED_CHUNK_BINDINGS,
  REUSED_CLASSES,
  assertAgentModelClassesResolve,
  patchOriginalAgentModelCard,
} from "../scripts/lib/agent-model-renderer-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const bundle = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

async function readPinnedStylesheets() {
  let sheets = "";
  for (const name of await readdir(assetsRoot).catch(() => [])) {
    if (name.endsWith(".css")) sheets += await readFile(path.join(assetsRoot, name), "utf8");
  }
  return sheets;
}

function topLevelBindings(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  const collect = (node) => {
    if (!node) return;
    if (node.type === "Identifier") names.add(node.name);
    else if (node.type === "ObjectPattern") for (const property of node.properties) collect(property.type === "RestElement" ? property.argument : property.value);
    else if (node.type === "ArrayPattern") for (const element of node.elements) collect(element);
    else if (node.type === "AssignmentPattern") collect(node.left);
    else if (node.type === "RestElement") collect(node.argument);
  };
  for (const statement of ast.body) {
    if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) names.add(statement.id.name);
    else if (statement.type === "VariableDeclaration") for (const declarator of statement.declarations) collect(declarator.id);
    else if (statement.type === "ImportDeclaration") for (const specifier of statement.specifiers) names.add(specifier.local.name);
  }
  return names;
}

test("the injected source carries no backticks and no template syntax", () => {
  assert.equal(COMPONENT_SOURCE.includes("`"), false);
  assert.equal(COMPONENT_SOURCE.includes("${"), false);
});

test("the injected component parses on its own (with the i18n runtime stubbed)", () => {
  const harness = `const p={},S={},re=()=>"",vt=null,so=null;function RLocT(a){return a}\n${COMPONENT_SOURCE}\nexport{RAgentModelCard};`;
  assert.doesNotThrow(() => parse(harness, { ecmaVersion: "latest", sourceType: "module" }));
});

test("the card is appended once to h3n and the chunk still parses as a module", { skip: bundleSkip }, () => {
  const patched = patchOriginalAgentModelCard(bundle);
  assert.equal(patched.split("function RAgentModelCard(").length - 1, 1);
  assert.equal(patched.split(H3N_RETURN_AFTER).length - 1, 1);
  assert.equal(patched.includes(H3N_RETURN_BEFORE), false);
  // main-i18n appends the RLocT runtime after this pass; mimic that before parsing for real.
  const dir = mkdtempSync(path.join(tmpdir(), "agent-model-chunk-"));
  const file = path.join(dir, "chunk.mjs");
  writeFileSync(file, `${patched}\nfunction RLocT(en,zh){return en}\n`);
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
});

test("a second application fails closed instead of injecting twice", { skip: bundleSkip }, () => {
  const patched = patchOriginalAgentModelCard(bundle);
  assert.throws(() => patchOriginalAgentModelCard(patched), /already injected/);
});

test("every chunk identifier the card reaches for is a module-level binding", { skip: bundleSkip }, () => {
  const bindings = topLevelBindings(patchOriginalAgentModelCard(bundle));
  for (const name of [...REQUIRED_CHUNK_BINDINGS, "RAgentModelCard", "RAgentModelDefault"]) {
    assert.ok(bindings.has(name), `${name} must be bound on the module Program body`);
  }
});

test("the reused card classes all resolve in the pinned CSS", { skip: bundleSkip }, async () => {
  const css = await readPinnedStylesheets();
  assert.equal(assertAgentModelClassesResolve(css), REUSED_CLASSES.length);
  assert.throws(() => assertAgentModelClassesResolve(css.replaceAll(".sand-cq4si4", ".sand-zzzzzz")), /sand-cq4si4/);
});

test("the card hides itself for group bots and disables the select on Codex", () => {
  assert.match(COMPONENT_SOURCE, /if\(t\.isGroup\)return null;/);
  assert.match(COMPONENT_SOURCE, /disabled:s\.busy\|\|s\.provider==="codex"/);
  // "Use default" maps to null so the bot's override is removed rather than pinned to today's default.
  assert.match(COMPONENT_SOURCE, /const m=v===RAgentModelDefault\?null:v;/);
});

test("the row adapts to the panel width instead of letting the select crush the text", { skip: bundleSkip }, async () => {
  const css = await readPinnedStylesheets();
  const declaration = (name) => new RegExp(`\\.${name}(?::[^{]*)?\\{([^}]*)\\}`).exec(css)?.[1];
  const declarations = (classes) => classes.split(" ").map(declaration);
  // Text column grows from a zero basis and may shrink below its content.
  assert.ok(declarations(MODEL_TEXT_CLASSES).includes("flex-grow:1"));
  assert.ok(declarations(MODEL_TEXT_CLASSES).includes("flex-basis:0%"));
  assert.ok(declarations(MODEL_TEXT_CLASSES).includes("min-width:0"));
  // Control column may shrink; the Notifications toggle's flex-shrink:0 must not be inherited.
  const control = declarations(MODEL_CONTROL_CLASSES);
  assert.ok(control.includes("flex-shrink:1"));
  assert.ok(control.includes("min-width:0"));
  assert.ok(!control.includes("flex-shrink:0"));
  // The trigger is bounded by its column, so the select label's own ellipsis can truncate.
  assert.deepEqual(declarations(MODEL_TRIGGER_CLASSES).sort(), ["max-width:100%", "min-width:0"]);
  assert.ok(COMPONENT_SOURCE.includes(`style:{maxWidth:"${MODEL_CONTROL_MAX_WIDTH}"}`));
  // `so` replaces className with its own, so the bound must ride on rootStyle.
  assert.ok(COMPONENT_SOURCE.includes(`p.jsx(so,{rootStyle:${MODEL_TRIGGER_ROOT_STYLE}`));
  assert.ok(!/p\.jsx\(so,\{className:/.test(COMPONENT_SOURCE));
  for (const name of MODEL_TRIGGER_CLASSES.split(" ")) assert.ok(MODEL_TRIGGER_ROOT_STYLE.includes(`"${name}"`));
});

test("the rootStyle keys are the chunk's own stylex keys for those classes, and so drops className", { skip: bundleSkip }, () => {
  assert.match(bundle, /ks0D6T:"ui-193iq5w"/);
  assert.match(bundle, /k7Eaqz:"(ui|sand)-euugli"/);
  assert.match(bundle, /function so\(n\)\{[^}]*p\.jsx\(\$in,\{\.\.\.n,className:xme,/);
});

test("mutation: dropping the card from the h3n children is caught", { skip: bundleSkip }, () => {
  const patched = patchOriginalAgentModelCard(bundle);
  const mutated = patched.replace(H3N_RETURN_AFTER, H3N_RETURN_BEFORE);
  assert.equal(mutated.includes("p.jsx(RAgentModelCard,{agent:t})"), false);
  assert.notEqual(mutated, patched);
});
