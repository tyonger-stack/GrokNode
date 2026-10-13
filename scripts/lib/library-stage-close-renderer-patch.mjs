import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const MEMBER = "dist/renderer/assets/index-UbX-y3il.js";
const ANCHOR = 'p.jsx(fr,{"aria-label":"Close preview",icon:"close",onClick:d,shape:"square",size:"sm",variant:"ghost"})';
const REPLACEMENT = 'p.jsx(RLibraryStageClose,{"aria-label":"Close preview",onClick:d})';
const MARKER = "/* sand-library-stage-close */";
const STYLE_ID = "sand-library-stage-close-style";
const component = String.raw`
function RLibraryStageClose(n){return p.jsx("button",{"aria-label":n["aria-label"],className:"sand-library-stage-icon-button","data-size":"md","data-variant":"elevated","data-stage-resting-focus":"",onClick:n.onClick,title:typeof RLocT==="function"?RLocT("Close","关闭"):"Close",type:"button",children:p.jsx("span",{"aria-hidden":!0,"data-icon-name":"close",style:{fontFamily:"cursor-icons",fontSize:16,lineHeight:1,color:"inherit"},children:"\ued82"})})}
`;
const sha = source => createHash("sha256").update(source).digest("hex");

export function patchOriginalLibraryStageClose(source, css) {
  if (source.includes(MARKER)) throw new Error("Library stage close already patched");
  const tree = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  const viewer = tree.body.find(n => n.type === "FunctionDeclaration" && n.id.name === "lkn");
  if (!viewer) throw new Error("Original shared file viewer lkn is missing");
  const body = source.slice(viewer.start, viewer.end);
  const at = body.indexOf(ANCHOR);
  if (at < 0 || body.indexOf(ANCHOR, at + 1) >= 0) throw new Error("Original viewer close anchor missing or ambiguous");
  if (!css.includes(".sand-library-stage-icon-button")) throw new Error("Scoped stage button CSS is missing");
  const patchedBody = body.slice(0, at) + REPLACEMENT + body.slice(at + ANCHOR.length);
  const style = `;(()=>{if(document.getElementById(${JSON.stringify(STYLE_ID)}))return;const style=document.createElement("style");style.id=${JSON.stringify(STYLE_ID)};style.textContent=${JSON.stringify(css)};document.head.append(style)})();`;
  const patched = source.slice(0, viewer.start) + patchedBody + source.slice(viewer.end) + "\n" + MARKER + "\n" + component + style;
  parse(patched, { sourceType: "module", ecmaVersion: "latest" });
  return patched;
}

export async function applyOriginalRendererLibraryStageClose({ stageRoot }) {
  const target = path.join(stageRoot, MEMBER);
  const source = await readFile(target, "utf8");
  const css = await readFile(new URL("../../frontend/src/extensions/library-stage-close.css", import.meta.url), "utf8");
  const patched = patchOriginalLibraryStageClose(source, css);
  await writeFile(target, patched);
  await writeFile(path.join(stageRoot, "dist/renderer-library-stage-close-extension.json"), JSON.stringify({
    schemaVersion: 1, reference: { version: "0.70.2", member: "dist/renderer/assets/index-CjjO5fU0.js", function: "fa", byteRange: [318008,318313], asarSha256: "8dd7b6c4a58439d626a9a7b3766982b7c725db2bc1f6ff68a29fc1ec62ca4cf7" },
    changes: [{ path: MEMBER, original: { sha256: sha(source), bytes: Buffer.byteLength(source) }, patched: { sha256: sha(patched), bytes: Buffer.byteLength(patched) } }],
    adaptations: ["Node theme token fallbacks", "pinned icon font", "native title tooltip"],
  }, null, 2) + "\n");
}
