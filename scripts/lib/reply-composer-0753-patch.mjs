import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, tokenizer } from "acorn";
import official from "./reply-composer-0753-official.json" with { type: "json" };

const BINDINGS = {
  ULt: "Kvn", KX: "R0753ReplyQuotePill", uS: "R0753ReplyIconButton", HLt: "R0753ReplyMouseDown", f0: "Xlt",
  Z: "R0753ReplyCompiler", X: "R0753ReplyReact", Y: "R0753ReplyJsx", ga: "R0753ReplyStyle", $: "R0753ReplyClasses",
  J: "R0753ReplyLocale", VLt: "R0753ReplyLayout", GX: "R0753ReplyPillStyles", Jb: "R0753ReplyTextStyles",
  sS: "R0753ReplyFocusStyles", cS: "R0753ReplyButtonStyles", lS: "R0753ReplyButtonSizes", sLe: "R0753ReplyButtonVariants",
  cLe: "R0753ReplyGlyphSizes", aS: "R0753ReplyGlyph", Tt: "yo", Agt: "R0753ReplyTooltipOffset", RX: "R0753ReplyPreview",
  Iht: "R0753ReplyTextPreview", Fht: "R0753ReplyPreviewContent", Vn: "vt", Vt: "R0753ReplyGlyph", Sm: "o5e", LX: "LAe", IX: "OAe",
  d0: "R0753ComposerFrameStyles", a_t: "R0753ComposerBorderWidth",
};

function bindSource(source) {
  const edits = [];
  for (const token of tokenizer(source, { ecmaVersion: "latest" })) {
    if (token.type.label === "name" && BINDINGS[token.value]) edits.push({ start: token.start, end: token.end, value: BINDINGS[token.value] });
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

const js = value => JSON.stringify(value);
const RUNTIME = `
const R0753ReplyCompiler=he,R0753ReplyReact=S,R0753ReplyJsx=p,R0753ReplyStyle=Fe,R0753ReplyClasses=re;
const R0753ReplyLayout=${js(official.styles.layout)},R0753ReplyPillStyles=${js(official.styles.pill)},R0753ReplyTextStyles=${js(official.styles.text)},R0753ReplyFocusStyles=${js(official.styles.focus)};
const R0753ReplyButtonStyles=${js(official.styles.button)},R0753ReplyButtonSizes=${js(official.styles.buttonSizes)},R0753ReplyButtonVariants=${js(official.styles.buttonVariants)},R0753ReplyGlyphSizes=${js(official.styles.glyphSizes)};
const R0753ReplyMargin=${js(official.styles.margin)},R0753ReplyTooltipOffset=4,R0753ComposerBorderWidth=${official.frameBorderWidth},R0753ComposerFrameStyles=${official.frameStyles};
function R0753ReplyTranslate(message){return message.id==="AnRu/j"?RLocT("Cancel reply","取消回复"):message.id==="ncwQad"?RLocT("(empty)","（空）"):RLocT("Jump to replied message","跳转到被回复的消息")}
function R0753ReplyLocale(){return{_:R0753ReplyTranslate}}
function R0753ReplyGlyph({capTrim,style,...props}){return p.jsx(bt,{...props,rootStyle:style})}
function R0753ReplyPreviewContent(preview,variant){return preview.kind==="user-text"||preview.kind==="assistant-text"?p.jsx(R0753ReplyTextPreview,{text:preview.text,variant}):$vn(preview,variant)}
${bindSource(official.sources.HLt)}
${bindSource(official.sources.KX)}
${bindSource(official.sources.uS)}
${bindSource(official.sources.RX)}
${bindSource(official.sources.Iht)}
`;

const declarations = record => Object.entries(record).map(([key, value]) => `${key}:${value}`).join(";");
export const REPLY_COMPOSER_0753_CSS = `
.r0753-composer{${declarations(official.constants)};${declarations(official.themes.light)}}
.sand-shell[data-theme="cursor-dark"] .r0753-composer{${declarations(official.themes.dark)}}
${official.css}
`;

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Reply composer anchor missing or ambiguous: ${before.slice(0, 100)}`);
  return source.replace(before, after);
}

function replaceComponent(source, name, replacement) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const nodes = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  if (nodes.length !== 1) throw new Error(`Reply composer expected one ${name}, found ${nodes.length}.`);
  const [node] = nodes;
  return source.slice(0, node.start) + replacement + source.slice(node.end);
}

export function patchReplyComposer0753(source) {
  if (source.includes("const R0753ReplyCompiler=")) return { text: source, applied: false };
  let next = replaceComponent(source, "Kvn", bindSource(official.sources.ULt));
  const frame = bindSource(official.sources.f0).replace("sand-kit-message-input-frame", "sand-kit-message-input-frame r0753-composer");
  next = replaceComponent(next, "Xlt", frame);
  next = replaceOnce(next, 'function LAe(n){return n==="quote"?Dvn:n==="pill"?Rvn:Fvn}', 'function LAe(n){return n==="quote"?Dvn:n==="pill"?1/0:Fvn}');
  next = replaceOnce(next, 'function zvn(n){return n==="quote"?16:n==="pill"?28:20}', 'function zvn(n){return n==="quote"?16:n==="pill"?16:20}');
  next = replaceOnce(next, 'function S9n(n){const e=he.c(215),', 'function S9n(n){const e=he.c(217),');
  next = replaceOnce(next, "replyTarget:y,onClearReplyTarget:k,", "replyTarget:y,onClearReplyTarget:k,onOpenReplyTarget:R0753OnOpen,");
  next = replaceOnce(next, "e[88]!==ot||e[89]!==ae){", "e[88]!==ot||e[89]!==ae||e[215]!==R0753OnOpen){");
  next = replaceOnce(next, "e[88]=ot,e[89]=ae,", "e[88]=ot,e[89]=ae,e[215]=R0753OnOpen,");
  next = replaceOnce(next, "e[146]!==k||e[147]!==y?", "e[146]!==k||e[147]!==y||e[216]!==R0753OnOpen?");
  next = replaceOnce(next, "p.jsx(Kvn,{onClear:k,preview:y})", "p.jsx(Kvn,{onClear:k,onOpen:R0753OnOpen,preview:y,style:R0753ReplyMargin})");
  next = replaceOnce(next, "e[146]=k,e[147]=y,e[148]=ri", "e[146]=k,e[147]=y,e[216]=R0753OnOpen,e[148]=ri");
  next = replaceOnce(next, "onClearReplyTarget:e.clearReplyTarget,", "onClearReplyTarget:e.clearReplyTarget,onOpenReplyTarget:()=>{const target=e.replyTargetId;target!=null&&(e.isEntryInScope(target)?e.scrollToEntry(target):e.revealEntry(target))},");
  next += RUNTIME;
  parse(next, { ecmaVersion: "latest", sourceType: "module" });
  return { text: next, applied: true };
}

const hash = value => createHash("sha256").update(value).digest("hex");
export async function applyReplyComposer0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const names = await readdir(assets);
  const candidates = [];
  for (const file of names.filter(name => name.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("function Kvn(")) candidates.push({ file, source });
  }
  const stylesheets = names.filter(name => /^index-.*\.css$/.test(name));
  if (candidates.length !== 1 || stylesheets.length !== 1) throw new Error("Reply composer expected one main renderer and stylesheet.");
  const [{ file, source }] = candidates;
  const result = patchReplyComposer0753(source);
  if (!result.applied) return { applied: false };
  const cssFile = stylesheets[0];
  const beforeCss = await readFile(path.join(assets, cssFile), "utf8");
  const css = beforeCss + REPLY_COMPOSER_0753_CSS;
  await writeFile(path.join(assets, file), result.text);
  await writeFile(path.join(assets, cssFile), css);
  const provenance = {
    mode: "reply-composer-0753",
    reference: official.reference,
    referenceFiles: official.files,
    referenceSha256: official.sha256,
    components: ["ULt", "KX", "uS", "f0", "RX", "Iht"],
    features: ["outlined-reply-pill", "jump-to-replied-message", "separate-cancel-button", "composer-frame", "css-ellipsis", "light-and-dark-theme"],
    files: [
      { file, originalSha256: hash(source), patchedSha256: hash(result.text) },
      { file: cssFile, originalSha256: hash(beforeCss), patchedSha256: hash(css) },
    ],
  };
  await writeFile(path.join(stageRoot, "dist/renderer-reply-composer-0753-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
