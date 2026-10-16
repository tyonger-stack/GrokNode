// Grok Bot 0.71.2 prompt auto-lists (`-` / `1.`), ported onto the checksum-pinned
// 0.18 renderer chunk (index-UbX-y3il.js).
//
// Evidence (0.71.2 chunk-prompt-editor-A2oxbQX4.js @58869 / @58882 / @62171):
//   Bn={HTMLAttributes:fr($e.promptList)}
//   function Vl(t){return t?{bulletList:Bn,orderedList:Bn,trailingNode:!1}:{bulletList:!1,orderedList:!1}}
//   Kl=new Set(["bulletList","orderedList","listItem"])
//   ql=Er.extend({addExtensions(){return(this.parent?.()??[]).map(t=>Kl.has(t.name)?t.extend({addKeyboardShortcuts:()=>({})}):t)}})
//   ai(t): ql.configure({…, ...Vl(t.surface==="prompt")})
//
// 0.18 today (index-UbX-y3il.js function hft):
//   grn.configure({…,bulletList:!1,…,orderedList:!1,…})
// so StarterKit never installs bulletList/orderedList (input rules SFe=/^\s*([-+*])\s$/
// and the ordered twin exist on dlt/vlt but stay disabled for every surface).
//
// CSS: 0.71's $e.promptList has no counterpart in 0.18's pinned stylesheet
// (no promptList / sand-* / ui-* class). Enable with !0 (default HTMLAttributes)
// — do not invent a class. trailingNode is a real StarterKit option on 0.18's
// grn/prn, so prompt gets trailingNode:!1 like Vl.
//
// Enter-to-send: listItem's Enter splits the item. Mirror 0.71's empty
// addKeyboardShortcuts on bulletList/orderedList/listItem via an extended kit.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONFIGURE_BEFORE =
  "grn.configure({blockquote:!1,bold:!1,bulletList:!1,code:!1,codeBlock:!1,heading:!1,horizontalRule:!1,italic:!1,link:!1,orderedList:!1,paragraph:{HTMLAttributes:e.paragraph==null?{}:{class:e.paragraph}},strike:!1,undoRedo:{newGroupDelay:100}})";

export const CONFIGURE_AFTER =
  "RPromptStarterKit.configure({blockquote:!1,bold:!1,code:!1,codeBlock:!1,heading:!1,horizontalRule:!1,italic:!1,link:!1,paragraph:{HTMLAttributes:e.paragraph==null?{}:{class:e.paragraph}},strike:!1,undoRedo:{newGroupDelay:100},...RPromptListOpts(n.surface===\"prompt\")})";

export const INJECT_BEFORE = "function hft(n){";

export const INJECT_AFTER =
  'const RPromptListNames=new Set(["bulletList","orderedList","listItem"]);'
  + "const RPromptStarterKit=grn.extend({addExtensions(){return(this.parent?.()??[]).map(t=>RPromptListNames.has(t.name)?t.extend({addKeyboardShortcuts:()=>({})}):t)}});"
  + "function RPromptListOpts(isPrompt){return isPrompt?{bulletList:!0,orderedList:!0,trailingNode:!1}:{bulletList:!1,orderedList:!1}}"
  + "function hft(n){";

/** 0.18 pinned CSS has no promptList recipe — recorded so provenance stays honest. */
export const PROMPT_LIST_CSS_DECISION = Object.freeze({
  promptListClassInPinnedCss: false,
  htmlAttributes: "omitted",
  reason: "pinned index-*.css has no promptList / sand-* / ui-* prompt-list class; enable with !0 defaults rather than inventing HTMLAttributes",
});

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer prompt-auto-lists ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchPromptAutoLists(source) {
  // CONFIGURE_BEFORE is unique to hft's list-disabled StarterKit; re-apply fails closed here.
  let patched = replaceExactlyOnce(source, CONFIGURE_BEFORE, CONFIGURE_AFTER, "hft StarterKit configure");
  patched = replaceExactlyOnce(patched, INJECT_BEFORE, INJECT_AFTER, "RPromptStarterKit inject");
  if (patched.includes("bulletList:!1,code:!1") || /grn\.configure\(\{[^}]*bulletList:!1/.test(patched)) {
    throw new Error("Prompt-auto-lists patch left hft StarterKit with bulletList:!1.");
  }
  if (!patched.includes("RPromptListOpts(n.surface===\"prompt\")")) {
    throw new Error("Prompt-auto-lists patch lost surface-gated list opts.");
  }
  if (!patched.includes("trailingNode:!1")) {
    throw new Error("Prompt-auto-lists patch lost trailingNode:!1 for prompt.");
  }
  if (!patched.includes("addKeyboardShortcuts:()=>({})")) {
    throw new Error("Prompt-auto-lists patch lost list keyboard-shortcut strip (Enter-to-send).");
  }
  return patched;
}

export async function applyOriginalRendererPromptAutoLists({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(CONFIGURE_BEFORE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one chunk with hft list-disabled StarterKit configure, found ${candidates.length}.`);
  }
  const candidate = candidates[0];

  let sawCss = false;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    sawCss = true;
    const css = await readFile(path.join(assetsRoot, name), "utf8");
    // Fail closed if a real promptList recipe appears — then HTMLAttributes must match 0.71 Bn.
    if (css.includes("promptList")) {
      throw new Error(
        "Pinned CSS now contains promptList; update prompt-auto-lists patch to pass HTMLAttributes like 0.71 Bn.",
      );
    }
  }
  if (!sawCss) {
    throw new Error("Prompt-auto-lists found no renderer stylesheet to validate against.");
  }

  const patched = patchPromptAutoLists(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-prompt-auto-lists",
    upstream: {
      version: "0.71.2",
      chunk: "dist/renderer/assets/chunk-prompt-editor-A2oxbQX4.js",
      symbols: ["Vl", "Bn", "ql", "Kl", "ai"],
      offsets: { Bn: 58869, Vl: 58882, qlConfigure: 62171 },
    },
    cssDecision: PROMPT_LIST_CSS_DECISION,
    chunks: [
      {
        role: "prompt-extensions",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
      },
    ],
    transformations: [
      "hft-prompt-enables-bulletList-orderedList",
      "hft-prompt-trailingNode-false",
      "strip-list-keyboard-shortcuts-for-enter-to-send",
      "workflow-mention-keeps-lists-disabled",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-prompt-auto-lists-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
