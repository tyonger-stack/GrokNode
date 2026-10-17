// Grok Bot 0.71.2 "Scroll to bottom" floating button, ported onto the checksum-pinned 0.18
// renderer chunk (index-UbX-y3il.js).
//
// Evidence (byte-sourced 2026-10-16 from the 0.71.2 renderer extracted under
// rea-grokbot-0712/app/dist/renderer/assets/):
//
//   * Button component `CK` (index-wlkGG389.js @1482951). States hidden/entered/exiting;
//     `open` flipping false while entered moves to "exiting", and `onAnimationEnd` on the
//     button itself moves "exiting" to "hidden" (unmount). It renders the shared icon button
//     with {"aria-label": i18n("oOi11l"), "data-exiting", icon:"arrow-down", iconSize:"xl",
//     onAnimationEnd, onClick:onJump, ref, shape:"circle", style:[p2.button, p2.dock(px),
//     exiting ? p2.exit : p2.enter]}. `p2.dock` is byte-identical in shape to 0.18's own
//     new-messages pill `Qae.pillBottom` (`[{krVfgx:"sand-1nqzi6q"}, {"--x-bottom":
//     calc(<px>px + var(--cursor-spacing-2))}]`), so the port reuses `Qae.pillBottom`.
//   * Mount site: transcript plane `RK` (index-wlkGG389.js @1500923), the 0.71.2 twin of
//     0.18's `WJn`. It portals `CK` into `pillPortalTarget` with dockInsetPx:pillDockInsetPx,
//     onJump:view.scrollToBottom, open:iue({...}), and only while the "jump to latest" pill
//     is NOT showing (`i!=null&&!nt`, where nt is exactly 0.18's down-pill condition
//     `i!=null&&rt>0&&!ht.hasDismissed&&!J`).
//   * Open predicate `iue` = eager-app `dze` (index.eager-app-DSuGVQNC.js @1033978):
//     `!isPinnedToBottom && distanceFromBottomPx > 80 && !isCovered && !showsJumpToLatestPill`.
//   * `view.distanceFromBottomPx` (index-wlkGG389.js @1698355) =
//     `Math.max(0, totalSizePx - geometry.viewport.scrollTopPx - geometry.viewport.viewportHeightPx)`.
//     0.18's view builder `rpt` reads the same geometry engine (`E.geometry.viewport`) but never
//     exported the distance, so the port adds that one field.
//   * Copy: en `"oOi11l":["Scroll to bottom"]` (index.eager-app-DSuGVQNC.js), zh-Hans
//     `"oOi11l":["滚动到底部"]` (chunk-chat-oYCOIqHR.js).
//
// Not ported (no 0.18 counterpart to anchor them on):
//   * `buttonRef` / `onCommitted` focus hand-off (0.71.2 `aze().handOff`, which moves focus to
//     the last message group after the button unmounts under keyboard focus).
//   * The hover tint `sand-101ryrv` — it paints `var(--sand-bg-hover)`, a token 0.18's theme
//     never defines, so lifting it would ship a dead rule.
//
// Styles: every `p2` class is checked against the pinned stylesheet. Classes 0.18 already
// ships are reused; the ones it lacks (two keyframe animations, the motion curve, and its
// reduced-motion override) cannot be expressed as inline style, so their 0.71.2 rules are
// lifted verbatim into a <style> element — the same mechanism the chat-header and
// library-stage patches use.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const VIEW_ANCHOR_BEFORE = "le={transcriptRows:z,rows:V,totalSizePx:W,isPinnedToBottom:H,mountedRange:G,";
const VIEW_ANCHOR_AFTER =
  "le={transcriptRows:z,rows:V,totalSizePx:W,isPinnedToBottom:H,distanceFromBottomPx:Math.max(0,W-E.geometry.viewport.scrollTopPx-E.geometry.viewport.viewportHeightPx),mountedRange:G,";

const PLANE_ANCHOR = "function WJn(n){";
const PLANE_MEMO_BEFORE = "function WJn(n){const e=he.c(140),";
const PLANE_MEMO_AFTER = "function WJn(n){const e=he.c(147),";

const PLANE_RETURN_BEFORE =
  "let pt;return e[135]!==$e||e[136]!==tt||e[137]!==ct||e[138]!==lt?(pt=p.jsxs(p.Fragment,{children:[$e,tt,ct,lt]}),e[135]=$e,e[136]=tt,e[137]=ct,e[138]=lt,e[139]=pt):pt=e[139],pt}";
const PLANE_RETURN_AFTER =
  "const RSbPill=i!=null&&rt>0&&!ht.hasDismissed&&!J,RSbOpen=RScrollToBottomOpen({isPinnedToBottom:xe,distanceFromBottomPx:t.distanceFromBottomPx,isCovered:J,showsJumpToLatestPill:RSbPill});let RSb;e[140]!==o||e[141]!==i||e[142]!==RSbOpen||e[143]!==RSbPill||e[144]!==t.scrollToBottom?(RSb=i!=null&&!RSbPill?Wr.createPortal(p.jsx(RScrollToBottomButton,{dockInsetPx:o===void 0?0:o,onJump:t.scrollToBottom,open:RSbOpen}),i):null,e[140]=o,e[141]=i,e[142]=RSbOpen,e[143]=RSbPill,e[144]=t.scrollToBottom,e[145]=RSb):RSb=e[145];" +
  "let pt;return e[135]!==$e||e[136]!==tt||e[137]!==ct||e[138]!==lt||e[146]!==RSb?(pt=p.jsxs(p.Fragment,{children:[$e,tt,ct,lt,RSb]}),e[135]=$e,e[136]=tt,e[137]=ct,e[138]=lt,e[146]=RSb,e[139]=pt):pt=e[139],pt}";

/** 0.71.2 `p2` classes that the pinned 0.18 stylesheet already ships with identical declarations. */
export const SCROLL_TO_BOTTOM_REUSED_CLASSES = Object.freeze([
  "sand-10l6tqk",
  "sand-1nrll8i",
  "sand-uuh30",
  "sand-zkaem6",
  "sand-1td3qas",
  "sand-10w6t97",
  "sand-10e981r",
  "sand-18o3ruo",
  "sand-tyxrsu",
  "sand-12sv23o",
  "sand-1nqzi6q",
  "sand-tsvl71",
  "sand-dn7m2a",
  "sand-skzprw",
  "sand-47corl",
  "sand-10e4vud",
]);

/** 0.71.2 `p2` classes (and keyframes) absent from 0.18; their rules are lifted verbatim. */
export const SCROLL_TO_BOTTOM_LIFTED_CLASSES = Object.freeze(["sand-1oltyw9", "sand-1s1hzzc", "sand-vjiv3b", "sand-1mq3suv"]);
export const SCROLL_TO_BOTTOM_LIFTED_KEYFRAMES = Object.freeze(["sand-13qd1cp-B", "sand-10dagxi-B"]);

// Verbatim from 0.71.2 index-DkV65EBE.css.
export const SCROLL_TO_BOTTOM_LIFTED_CSS = [
  String.raw`.sand-1oltyw9:not(#\#):not(#\#):not(#\#){animation-name:sand-13qd1cp-B}`,
  String.raw`.sand-1s1hzzc:not(#\#):not(#\#):not(#\#){animation-name:sand-10dagxi-B}`,
  String.raw`.sand-vjiv3b:not(#\#):not(#\#):not(#\#){animation-timing-function:cubic-bezier(.2,0,0,1)}`,
  String.raw`@media(prefers-reduced-motion:reduce){.sand-1mq3suv.sand-1mq3suv:not(#\#):not(#\#):not(#\#){animation-timing-function:linear}}`,
  "@keyframes sand-13qd1cp-B{0%{opacity:0;transform:translate(-50%) translatey(6px)}to{opacity:1;transform:translate(-50%) translatey(0)}}",
  "@keyframes sand-10dagxi-B{0%{opacity:1;transform:translate(-50%) translatey(0)}to{opacity:0;transform:translate(-50%) translatey(6px)}}",
].join("");

const STYLE_ID = "sand-scroll-to-bottom-style";

// 0.71.2 `p2.button` minus the `sand-101ryrv` hover tint (see header), `p2.enter`, `p2.exit`
// — same stylex keys, so they override the icon button's base recipe exactly as in 0.71.2.
const INJECTED_SOURCE = String.raw`
const RScrollToBottomThresholdPx=80;
function RScrollToBottomOpen(n){return!n.isPinnedToBottom&&n.distanceFromBottomPx>RScrollToBottomThresholdPx&&!n.isCovered&&!n.showsJumpToLatestPill}
const RScrollToBottomStyles={button:{kVAEAm:"sand-10l6tqk",kbCHJM:"sand-1nrll8i",k3aq6I:"sand-uuh30",kY2c9j:"sand-zkaem6",kzqmXN:"sand-1td3qas",kZKoxP:"sand-10w6t97",kWkggS:"sand-10e981r",kKwaWg:"sand-18o3ruo",kMwMTN:"sand-tyxrsu",kGVxlE:"sand-12sv23o",$$css:!0},enter:{kKVMdj:"sand-1oltyw9",k44tkh:"sand-tsvl71 sand-dn7m2a",kyAemX:"sand-vjiv3b sand-1mq3suv",kWV6AL:"sand-skzprw",$$css:!0},exit:{kfzvcC:"sand-47corl",kKVMdj:"sand-1s1hzzc",k44tkh:"sand-tsvl71 sand-dn7m2a",kyAemX:"sand-vjiv3b sand-1mq3suv",kWV6AL:"sand-10e4vud",$$css:!0}};
function RScrollToBottomButton(n){const{dockInsetPx:t,open:s,onJump:r}=n,[i,o]=S.useState(s?"entered":"hidden"),[l,c]=S.useState(s);if(s!==l&&(c(s),s?o("entered"):i==="entered"&&o("exiting")),i==="hidden")return null;const u=i==="exiting";return p.jsx(fr,{"aria-label":RLocT("Scroll to bottom","滚动到底部"),"data-exiting":u?"":void 0,icon:"arrow-down",iconSize:"xl",onAnimationEnd:d=>{u&&d.target===d.currentTarget&&o("hidden")},onClick:r,shape:"circle",style:[RScrollToBottomStyles.button,Qae.pillBottom(t),u?RScrollToBottomStyles.exit:RScrollToBottomStyles.enter]})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalScrollToBottom(source) {
  let next = replaceExactlyOnce(source, VIEW_ANCHOR_BEFORE, VIEW_ANCHOR_AFTER, "transcript view distance");
  next = replaceExactlyOnce(next, PLANE_MEMO_BEFORE, PLANE_MEMO_AFTER, "transcript plane memo cache");
  next = replaceExactlyOnce(next, PLANE_RETURN_BEFORE, PLANE_RETURN_AFTER, "transcript plane fragment");
  const style = `;(()=>{if(document.getElementById(${JSON.stringify(STYLE_ID)}))return;const s=document.createElement("style");s.id=${JSON.stringify(STYLE_ID)};s.textContent=${JSON.stringify(SCROLL_TO_BOTTOM_LIFTED_CSS)};document.head.append(s)})();\n`;
  next = replaceExactlyOnce(next, PLANE_ANCHOR, `${INJECTED_SOURCE}${style}${PLANE_ANCHOR}`, "transcript plane component");
  return next;
}

function hasClassRule(cssText, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])[^{}]*\\{`).test(cssText);
}

/**
 * Reused classes must resolve in the pinned stylesheet; lifted classes and keyframes must be
 * absent from it, so a future stylesheet that grows them forces the lifted copy to be retired
 * instead of silently shadowing the shipped rule.
 */
export function assertScrollToBottomStylesResolve(cssText) {
  const missing = SCROLL_TO_BOTTOM_REUSED_CLASSES.filter(name => !hasClassRule(cssText, name));
  const present = [
    ...SCROLL_TO_BOTTOM_LIFTED_CLASSES.filter(name => hasClassRule(cssText, name)),
    ...SCROLL_TO_BOTTOM_LIFTED_KEYFRAMES.filter(name => cssText.includes(`@keyframes ${name}`)),
  ];
  const problems = [];
  if (missing.length > 0) problems.push(`missing reused classes: ${missing.join(", ")}`);
  if (present.length > 0) problems.push(`lifted rules already shipped: ${present.join(", ")}`);
  if (problems.length > 0) {
    throw new Error(`Scroll-to-bottom styles do not match the pinned renderer stylesheet — ${problems.join("; ")}`);
  }
  return { reused: SCROLL_TO_BOTTOM_REUSED_CLASSES.length, lifted: SCROLL_TO_BOTTOM_LIFTED_CLASSES.length };
}

export async function applyOriginalRendererScrollToBottom({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  const stylesheets = [];
  for (const name of await readdir(assetsRoot)) {
    const target = path.join(assetsRoot, name);
    if (name.endsWith(".css")) stylesheets.push(await readFile(target, "utf8"));
    if (!name.endsWith(".js")) continue;
    const source = await readFile(target, "utf8");
    if (source.includes(PLANE_MEMO_BEFORE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk for the scroll-to-bottom patch, found ${candidates.length}.`);
  }
  if (stylesheets.length === 0) throw new Error("Scroll-to-bottom found no renderer stylesheet to validate against.");
  assertScrollToBottomStylesResolve(stylesheets.join("\n"));
  const candidate = candidates[0];
  const patched = patchOriginalScrollToBottom(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-scroll-to-bottom",
    evidence: {
      reference: "Grok Bot 0.71.2 renderer (rea-grokbot-0712/app/dist/renderer/assets)",
      button: "index-wlkGG389.js @1482951 CK",
      mount: "index-wlkGG389.js @1509493 (RK portals CK)",
      openPredicate: "index.eager-app-DSuGVQNC.js @1033978 dze (threshold 80px)",
      viewDistance: "index-wlkGG389.js @1698355 distanceFromBottomPx",
      copy: { id: "oOi11l", en: "Scroll to bottom", zhHans: "滚动到底部 (chunk-chat-oYCOIqHR.js)" },
      notPorted: ["buttonRef/onCommitted focus hand-off", "sand-101ryrv hover tint (--sand-bg-hover undefined in 0.18)"],
    },
    chunks: [
      {
        role: "transcript-plane",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        reusedStyleClasses: [...SCROLL_TO_BOTTOM_REUSED_CLASSES],
        liftedStyleClasses: [...SCROLL_TO_BOTTOM_LIFTED_CLASSES],
        liftedKeyframes: [...SCROLL_TO_BOTTOM_LIFTED_KEYFRAMES],
        memoCache: { component: "WJn", before: 140, after: 147 },
      },
    ],
    features: ["transcript-scroll-to-bottom-button"],
    transformations: ["view-exports-distance-from-bottom", "plane-portals-scroll-to-bottom-button"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-scroll-to-bottom-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
