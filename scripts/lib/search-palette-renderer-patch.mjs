// Grok Bot 0.75.3 sidebar search presentation, ported onto the pinned 0.18 command palette.
//
// 0.75.3's sidebar search button opens the same command palette but without the
// Anysphere-only developer tabs. The visible rows, row height, search icon, and
// "Bot" type label are the palette's shipped 0.18 primitives; the only new
// behaviour is the source flag and the 402px no-tab list height.
//
// @evidence /Applications/Grok Bot.app 0.75.3 renderer assets/index.eager-app-DjFE9lSq.js
//   QFn, 5528358-5532769: dialog has class sand-command-palette, the tablist is
//   gated by _?null, and "Agent" is the 0.18 label being replaced with "Bot".
// @evidence rea-grokbot-0753/bot-search-create-0753/official-popup-interactions.json
//   search dialog 560x455, listbox 402px, option 49px, no role=tablist.

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const TYPE_LABEL_BEFORE = 'case"agent":return n.agent.isGroup?"Group":"Agent"';
const TYPE_LABEL_AFTER = 'case"agent":return n.agent.isGroup?"Group":"Bot"';
const CLOSE_BEFORE = "onOpenChange:Z=>{Z||i()},open:r,rootStylexStyles:";
const CLOSE_AFTER = "onOpenChange:Z=>{if(!Z){RSearchPaletteSet(false);i()}},open:r,rootStylexStyles:";
const TABLIST_BEFORE = '_?null:p.jsx("div",{"aria-label":"Filter results"';
const TABLIST_AFTER = '(_||RSearchPaletteMode())?null:p.jsx("div",{"aria-label":"Filter results"';
const CLASS_BEFORE = 'className:"sand-command-palette",initialFocus:';
const CLASS_AFTER = 'className:RSearchPaletteMode()?"sand-command-palette r-search-palette":"sand-command-palette",initialFocus:';
const COMPONENT_ANCHOR = "function QFn(";
const HEIGHT_BEFORE = "ne=_?XFn:j0t;";
const HEIGHT_AFTER = "ne=(_||RSearchPaletteMode())?XFn:j0t;";
const SEARCH_CLICK_BEFORE = 'className:"sand-agents-sidebar__search",focusAppearance:"none",icon:"search",iconSize:"xl",onClick:t,onKeyDown:o';
const SEARCH_CLICK_AFTER = 'className:"sand-agents-sidebar__search",focusAppearance:"none",icon:"search",iconSize:"xl",onClick:()=>{RSearchPaletteSet(true),t()},onKeyDown:o';
const SEARCH_KEY_BEFORE = 'u.altKey||(u.preventDefault(),t())};return p.jsx(yo,{content:"Search"';
const SEARCH_KEY_AFTER = 'u.altKey||(u.preventDefault(),RSearchPaletteSet(true),t())};return p.jsx(yo,{content:"Search"';
const PLUS_CONTENT_BEFORE = 'p.jsx(RSidebarSearchButton,{onOpenSearch:Op}),p.jsx(yo,{content:"New chat",children:p.jsx(fr,{"aria-label":"New"';
const PLUS_CONTENT_AFTER = 'p.jsx(RSidebarSearchButton,{onOpenSearch:Op}),p.jsx(yo,{content:"New Bot",children:p.jsx(fr,{"aria-label":"New Bot"';
const PLUS_CLICK_BEFORE = 'iconSize:"xl",onClick:h,shape:"circle"';
const PLUS_CLICK_AFTER = 'iconSize:"xl",onClick:RCreateBotOpen,shape:"circle"';

export const SEARCH_PALETTE_COMPONENT = String.raw`
let RSearchPaletteModeValue=false;
function RSearchPaletteSet(next){RSearchPaletteModeValue=next===true}
function RSearchPaletteMode(){return RSearchPaletteModeValue}
`;

export const SEARCH_PALETTE_STYLE = `
.r-search-palette > [role="listbox"] { height: 402px; }
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error("Search palette " + label + " anchor is missing or ambiguous.");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchSearchPaletteRenderer(source) {
  if (source.includes("function RSearchPaletteMode(")) throw new Error("Search palette patch was already applied.");
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, SEARCH_PALETTE_COMPONENT + COMPONENT_ANCHOR, "component insertion");
  patched = replaceExactlyOnce(patched, TYPE_LABEL_BEFORE, TYPE_LABEL_AFTER, "Bot type label");
  patched = replaceExactlyOnce(patched, CLOSE_BEFORE, CLOSE_AFTER, "close reset");
  patched = replaceExactlyOnce(patched, TABLIST_BEFORE, TABLIST_AFTER, "tablist hide");
  patched = replaceExactlyOnce(patched, CLASS_BEFORE, CLASS_AFTER, "search class");
  patched = replaceExactlyOnce(patched, HEIGHT_BEFORE, HEIGHT_AFTER, "search height");
  patched = replaceExactlyOnce(patched, SEARCH_CLICK_BEFORE, SEARCH_CLICK_AFTER, "search click");
  patched = replaceExactlyOnce(patched, SEARCH_KEY_BEFORE, SEARCH_KEY_AFTER, "search key");
  patched = replaceExactlyOnce(patched, PLUS_CONTENT_BEFORE, PLUS_CONTENT_AFTER, "plus label");
  patched = replaceExactlyOnce(patched, PLUS_CLICK_BEFORE, PLUS_CLICK_AFTER, "plus click");
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

const sha256 = text => createHash("sha256").update(text).digest("hex");

export async function applySearchPaletteRendererPatch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = await readdir(assets);
  const candidates = [];
  for (const file of files.filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error("Search palette patch: expected one command palette chunk, found " + candidates.length + ".");
  const cssFiles = files.filter(file => /^index-.*[.]css$/.test(file));
  if (cssFiles.length !== 1) throw new Error("Search palette patch: expected one main stylesheet.");
  const [{ file, source }] = candidates;
  const patched = patchSearchPaletteRenderer(source);
  await writeFile(path.join(assets, file), patched);
  const cssFile = cssFiles[0];
  const css = await readFile(path.join(assets, cssFile), "utf8");
  const patchedCss = css + SEARCH_PALETTE_STYLE;
  await writeFile(path.join(assets, cssFile), patchedCss);
  const provenance = {
    mode: "sidebar-search-palette-0753",
    files: [
      { file: "dist/renderer/assets/" + file, originalSha256: sha256(source), patchedSha256: sha256(patched) },
      { file: "dist/renderer/assets/" + cssFile, originalSha256: sha256(css), patchedSha256: sha256(patchedCss) },
    ],
    features: ["sidebar-search-no-tabs", "bot-row-label"],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-search-palette-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
