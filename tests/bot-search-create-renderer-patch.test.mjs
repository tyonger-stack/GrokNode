import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";
import { patchOriginalSidebarTopBarSearch } from "../scripts/lib/sidebar-search-renderer-patch.mjs";
import { patchMainAgentRenderer } from "../scripts/lib/main-agent-renderer-patch.mjs";
import { BOT_CREATE_STYLE, patchBotCreateDialogRenderer } from "../scripts/lib/bot-create-dialog-renderer-extension.mjs";
import { SEARCH_PALETTE_STYLE, patchSearchPaletteRenderer } from "../scripts/lib/search-palette-renderer-patch.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const baseline = path.join(repo, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const skip = existsSync(baseline) ? false : "pinned bundle not hydrated";

test("0.75.3 search and create surfaces compose on the pinned renderer", { skip }, async () => {
  let source = await readFile(baseline, "utf8");
  source = patchOriginalSidebarTopBarSearch(source);
  source = patchMainAgentRenderer(source);
  source = patchSearchPaletteRenderer(source);
  source = patchBotCreateDialogRenderer(source);
  parse(source, { ecmaVersion: "latest", sourceType: "module" });

  assert.match(source, /className:RSearchPaletteMode\(\)\?"sand-command-palette r-search-palette":"sand-command-palette"/);
  assert.match(source, /\(_\|\|RSearchPaletteMode\(\)\)\?null:p\.jsx\("div",\{"aria-label":"Filter results"/);
  assert.match(source, /onClick:\(\)=>\{RSearchPaletteSet\(true\),t\(\)\}/);
  assert.match(source, /p\.jsx\(RSidebarSearchButton,\{onOpenSearch:Op\}\),p\.jsx\(yo,\{content:"New Bot"/);
  assert.match(source, /iconSize:"xl",onClick:RCreateBotOpen,shape:"circle"/);
  assert.match(source, /p\.jsx\(RCreateBotHost,\{\}\)/);
  assert.match(source, /function RCreateBotHost\(\)/);
  assert.match(source, /n5n\(roster,launcher,/);
  assert.match(source, /selection\.select\(result\.agentId\)/);
  assert.match(source, /RCreateBotShapeRows/);
  assert.match(source, /PQ\.map\(candidate=>/);
  assert.match(source, /p\.jsx\(sd,\{color,shape,sizePx:96\}\)/);
  assert.match(source, /p\.jsx\(sd,\{color,shape:candidate,sizePx:36,paused:true\}\)/);
  assert.match(source, /const outline=typeof RCompAvatarOutline==='function'\?RCompAvatarOutline\(candidate\):null/);
  assert.match(source, /className:'r-create-bot-shape-outline',style:outline/);
  assert.match(source, /RCompPumpkinStem/);
  assert.match(BOT_CREATE_STYLE, /r-create-bot-shape-mark\{position:relative/);
  assert.match(SEARCH_PALETTE_STYLE, /402px/);
  assert.match(BOT_CREATE_STYLE, /r-create-bot-shape-row/);
  assert.match(BOT_CREATE_STYLE, /var\(--sand-border-primary-translucent/);
  assert.match(BOT_CREATE_STYLE, /--sand-border-primary-translucent:#f5f5f538/);
  assert.match(BOT_CREATE_STYLE, /--sand-border-secondary-translucent:#f5f5f51a/);
  assert.match(BOT_CREATE_STYLE, /r-create-bot-name::placeholder\{color:rgba\(245,245,245,\.54\)\}/);
  assert.match(BOT_CREATE_STYLE, /border:\.5px solid rgba\(245,245,245,\.1\)/);
  assert.doesNotMatch(BOT_CREATE_STYLE, /r-create-bot-shape-outline\{position:absolute;inset:-4px/);
  assert.throws(() => patchSearchPaletteRenderer(source), /already applied/);
  assert.throws(() => patchBotCreateDialogRenderer(source), /already applied/);
});

test("search mode fails closed after the source has already been patched", { skip }, async () => {
  const source = await readFile(baseline, "utf8");
  const patched = patchBotCreateDialogRenderer(patchSearchPaletteRenderer(patchMainAgentRenderer(patchOriginalSidebarTopBarSearch(source))));
  assert.throws(() => patchSearchPaletteRenderer(patched), /already applied/);
  assert.throws(() => patchBotCreateDialogRenderer(patched), /already applied/);
});

test("collapsed and expanded plus buttons open the same Bot dialog without creating a chat", { skip }, async () => {
  const archive = process.env.GROK_NODE_COLLAPSED_CREATE_TEST_ASAR;
  let source = archive
    ? createRequire(import.meta.url)("@electron/asar").extractFile(archive, "dist/renderer/assets/index-UbX-y3il.js").toString()
    : patchBotCreateDialogRenderer(patchSearchPaletteRenderer(patchMainAgentRenderer(patchOriginalSidebarTopBarSearch(await readFile(baseline, "utf8")))));
  if (!archive) {
    for (const [en, zh] of [["New chat", "新建聊天"], ["New Bot", "新建 Bot"], ["New", "新"]]) {
      source = applyPair(source, en, zh, "FULL").patched;
    }
  }
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const functions = ast.body.filter(node => node.type === "FunctionDeclaration");
  const pick = name => {
    const node = functions.find(candidate => candidate.id.name === name);
    assert.ok(node, `Missing renderer function ${name}`);
    return source.slice(node.start, node.end);
  };
  const routes = [];
  function visit(node) {
    if (node?.type === "CallExpression" && node.arguments[0]?.name === "n0n") routes.push(node.arguments[1]);
    for (const value of Object.values(node ?? {})) {
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child); });
      else if (value?.type) visit(value);
    }
  }
  visit(ast);
  assert.equal(routes.length, 1);
  const route = source.slice(routes[0].start, routes[0].end);
  const code = ["n0n", "pcn", "RCreateBotPublish", "RCreateBotOpen", "RCreateBotClose", "RCreateBotSnapshot", "RCreateBotT"].map(pick).join("\n");
  for (const language of ["en", "zh"]) {
    let chats = 0;
    const context = vm.createContext({
      p: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      he: { c: size => Array(size).fill(Symbol.for("react.memo_cache_sentinel")) },
      re: (...values) => values.filter(Boolean).join(" "),
      yo: "tooltip", fr: "button", RSidebarSearchButton: "search", Ete: {}, Xbe: {},
      RSidebarElevated: {}, RSidebarTopBarButton: {},
      F: () => { chats++; },
      RLocT: (en, zh) => language === "zh" ? zh : en,
    });
    vm.runInContext(`let RCreateBotOpenValue=false;const RCreateBotListeners=new Set();${code};globalThis.rail=n0n(${route});globalThis.header=pcn({isSelecting:false,onNewChat:F});`, context);
    const findPlus = node => {
      if (node?.type === "button" && node.props.icon === "plus") return node;
      const children = node?.props?.children;
      return (Array.isArray(children) ? children : [children]).filter(Boolean).map(findPlus).find(Boolean);
    };
    for (const entry of [context.rail, context.header]) {
      const button = findPlus(entry);
      assert.ok(button);
      button.props.onClick();
      assert.equal(vm.runInContext("RCreateBotSnapshot()", context), true, "plus must open the Bot dialog");
      assert.equal(chats, 0, "plus must not invoke the legacy chat callback");
      assert.equal(button.props["aria-label"], language === "zh" ? "新建 Bot" : "New Bot");
      vm.runInContext("RCreateBotClose()", context);
      assert.equal(vm.runInContext("RCreateBotSnapshot()", context), false);
    }
    assert.equal(context.rail.props.children.props.content, language === "zh" ? "新建 Bot" : "New Bot");
  }
});
