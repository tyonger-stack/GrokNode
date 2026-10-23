import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
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
