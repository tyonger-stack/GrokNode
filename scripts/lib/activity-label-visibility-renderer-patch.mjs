// Grok Bot 0.62.0 activity-label visibility, ported onto the checksum-pinned 0.18
// renderer chunk.
//
// Evidence (byte-sourced 2026-09-29). Reference is the official Grok Bot macOS app at
// /Applications/Grok Bot.app, bundle com.anysphere.sand, version 0.62.0 (asar SHA-256
// read on 2026-09-29), renderer chunk dist/renderer/assets/index-BYEktDeR.js inside its
// app.asar. The target is the pinned 0.18 chunk index-UbX-y3il.js.
//
// The row in the report is not the chat header. 0.18's `aSn` renders avatar + name only —
// `sand-chat-header__title` wraps a single `sand-chat-header__name` span, and there is no
// `sand-chat-header__status` class anywhere in the chunk. The "<agent> is working" line is
// the transcript's activity mark, `SJn`, rendered in its `sand-activity-mark` branch.
//
// Text provenance, 0.18 chunk @5230493:
//     function gJn(n,e){if(n==="working"){const t=e?.trim();return t!=null&&t.length>0?`${t} is working`:null}return"Typing…"}
// so the reported string is `${agentName} is working`, fed in as `fallbackText: R` to the
// animated label `TJn`. That span is the third and last child of the mark:
//     p.jsx("span",{"aria-hidden":!0,className:Ne.className,style:Ne.style,children:p.jsx(TJn,{activity:P?h:null,elapsedMs:y,fallbackText:R,mode:t})})
// and `Ne` is the class set this patch rewrites. The row itself only renders when
// `bubbleLayer` is non-null, i.e. while typing or working.
//
// The defect is the index into that class set: the class sets sit at @5237754 and the index
// that selects one of them at @5238087 (verbatim):
//     Ne={0:{className:"… sand-g01cxk …"},1:{className:"… sand-1hc1fzr …"}}[!!(ce&&H!=="idle")<<0]
// where `ce` is the pointer-hover flag driven by the mark's own
// `onPointerEnter/onPointerLeave`, and `H` is the resolved mark state. Resolved against the
// pinned stylesheet index-lCyB53CO.css:
//     .sand-g01cxk  { opacity: 0 }
//     .sand-1hc1fzr { opacity: 1 }
// so 0.18 only reaches the visible variant while the pointer is *over* the row. That is the
// reported behaviour: "工作管家 is working" appears on hover and disappears when the pointer
// leaves.
//
// 0.62.0 keys the same class set on the agent state alone — its class sets sit at @1398853 in
// index-BYEktDeR.js:
//     le={0:{className:"… sand-g01cxk …"},2:{className:"… sand-1hc1fzr …"},
//         1:{className:"… sand-g01cxk … sand-1kuakbf"},
//         3:{className:"… sand-1hc1fzr … sand-1kuakbf"}}[!!Y<<1|!!oe<<0]
// with `Y=ee!=="idle"` and `oe=hasSpawnEntrance`. Hover does not appear in the index at all:
// 0.62.0's label is visible whenever the agent is non-idle, and it never peeks in on hover.
// Both opacity classes are byte-identical between the two stylesheets (stylex hashes a class
// name from its declarations, so the same names carry the same meaning across versions),
// which is what makes the 0.18 index rewrite the whole fix rather than a style override.
//
// On whether dropping the hover term can make the label vanish. The ordinary path cannot:
// `mct` @2296092 is `if(rosterAgent?.awaitingUserResponse!=null) return "idle"; const
// t=wbe(rosterAgent); return t==="idle" ? wbe(surfaceFacts) : t`, and the mark passes
// `surfaceFacts = {isRunning:!0, isComposingMessage: mode==="typing", awaitingUserResponse:null,…}`
// @5236580, so `wbe(surfaceFacts)` resolves through `nln(null)` to "working" — never idle.
//
// One path is NOT ruled out, and is stated here rather than papered over: `mct` returns "idle"
// *before* consulting `surfaceFacts` whenever the roster agent is awaiting a user response.
// The row, meanwhile, renders off the external `indicatorMode` prop (typing/working) and is
// independent of that field — so an awaiting-response agent can in principle render the row
// with `H==="idle"`, where 0.18 pre-patch still revealed the label on hover and this build
// leaves it transparent. 0.62.0 resolves the same way — `Nhe` in index.eager-app-C20nv6Dx.js
// is byte-identical in shape, `if(e?.awaitingUserResponse!=null)return Qu; const n=Mm(e);
// return n===Qu?Mm(t):n` — so the patch reproduces the official behaviour including that
// edge, rather than inventing a safer one. Reaching it needs an agent that is both awaiting a
// reply and marked working, which is a contradictory pair this audit did not observe live.
//
// Scope: the index expression only. The class sets, the transition classes, the pointer
// handlers and the eye's hover emphasis (`emphasis:ce`) are untouched — hover still emphasises
// the mark's eye and still peeks the row open for an idle agent, exactly as 0.62.0 does.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// The activity-mark component. Present exactly once in the pinned chunk; it is also what
// locates the target file, so a chunk rename or a second copy both fail closed.
const COMPONENT_ANCHOR = "function SJn(n){const e=he.c(23),";

// The two variants of the label class set, verbatim from the pinned chunk @5237754. Kept in
// the patch as a gate: if a future chunk changes which class means hidden vs visible, the
// index below would silently pick the wrong one and this comparison stops matching.
export const LABEL_CLASS_SETS =
  'Ne={0:{className:"sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-6s0dn4 sand-euugli sand-g01cxk sand-1uqg51p sand-19991ni sand-9i6iqp sand-12w9bfk sand-9lcvmn"},1:{className:"sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-6s0dn4 sand-euugli sand-1uqg51p sand-19991ni sand-9i6iqp sand-12w9bfk sand-9lcvmn sand-1hc1fzr"}}';

// 0.18 gates visibility on hover AND on the agent state; 0.62.0 gates it on the agent state
// only. The fix is exactly the removal of `ce&&` — the terms are otherwise identical, so the
// rewritten expression is 0.62.0's `Y` term in 0.18's own variable spelling.
const VISIBILITY_INDEX_BEFORE = '[!!(ce&&H!=="idle")<<0]';
const VISIBILITY_INDEX_AFTER = '[!!(H!=="idle")<<0]';

/** opacity of the resting variant, and the class that carries it. */
export const LABEL_HIDDEN_CLASS = "sand-g01cxk";
/** opacity of the visible variant, and the class that carries it. */
export const LABEL_VISIBLE_CLASS = "sand-1hc1fzr";

/**
 * The rest of the label's class set. These carry no visibility decision, but dropping any of
 * them upstream would change how the row animates (the -1px nudge, the 0.16s opacity
 * transition, its timing function), so they are gated with the two that decide visibility.
 */
export const LABEL_SHARED_CLASSES = Object.freeze([
  "sand-78zum5",
  "sand-1iyjqo2",
  "sand-s83m0k",
  "sand-dl72j9",
  "sand-6s0dn4",
  "sand-euugli",
  "sand-1uqg51p",
  "sand-19991ni",
  "sand-9i6iqp",
  "sand-12w9bfk",
  "sand-9lcvmn",
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/** Body of the activity-mark component, so an edit elsewhere in the chunk cannot match. */
function activityMarkComponent(source) {
  const start = source.indexOf(COMPONENT_ANCHOR);
  if (start < 0 || source.indexOf(COMPONENT_ANCHOR, start + 1) >= 0) {
    throw new Error("Original renderer activity-mark component anchor is missing or ambiguous.");
  }
  let depth = 0;
  const bodyStart = source.indexOf("{", start);
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Original renderer activity-mark component did not brace-balance.");
}

export function patchOriginalActivityLabelVisibility(source) {
  const component = activityMarkComponent(source);
  // Both anchors have to live inside the activity mark, and the class set they index has to
  // be the one this patch was written against.
  replaceExactlyOnce(component, LABEL_CLASS_SETS, LABEL_CLASS_SETS, "activity label class set");
  const patchedComponent = replaceExactlyOnce(
    component,
    VISIBILITY_INDEX_BEFORE,
    VISIBILITY_INDEX_AFTER,
    "activity label visibility index",
  );
  return source.replace(component, patchedComponent);
}

function declarationsFor(cssText, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\.${escaped}(?![\\w-])[^{}]*\\{([^}]*)\\}`, "g");
  const declarations = [];
  let match = pattern.exec(cssText);
  while (match !== null) {
    for (const part of match[1].split(";")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) declarations.push(trimmed.replace(/\s+/g, " "));
    }
    match = pattern.exec(cssText);
  }
  return declarations;
}

/**
 * Fail closed unless the pinned stylesheet still defines the label's visibility classes the
 * way this patch assumes: the resting variant must be the one that is transparent and the
 * hovered variant the one that is opaque. A stylesheet that renamed, dropped or re-valued
 * either class would otherwise ship a row whose label is invisible at every state — or,
 * worse, one that is always visible in a state 0.62.0 keeps hidden.
 */
export function assertActivityLabelStylesResolve(
  cssText,
  { hiddenClass = LABEL_HIDDEN_CLASS, visibleClass = LABEL_VISIBLE_CLASS, sharedClasses = LABEL_SHARED_CLASSES } = {},
) {
  const missingClasses = [];
  for (const name of [hiddenClass, visibleClass, ...sharedClasses]) {
    if (declarationsFor(cssText, name).length === 0) missingClasses.push(name);
  }
  const hiddenOpacity = declarationsFor(cssText, hiddenClass).filter(d => d.startsWith("opacity:"));
  const visibleOpacity = declarationsFor(cssText, visibleClass).filter(d => d.startsWith("opacity:"));
  const problems = [];
  if (missingClasses.length > 0) problems.push(`missing classes: ${missingClasses.join(", ")}`);
  if (hiddenOpacity.length !== 1 || hiddenOpacity[0] !== "opacity:0") {
    problems.push(
      `${hiddenClass} must declare exactly one opacity:0 declaration, found ${
        hiddenOpacity.length > 0 ? hiddenOpacity.join(", ") : "none"
      }`,
    );
  }
  if (visibleOpacity.length !== 1 || visibleOpacity[0] !== "opacity:1") {
    problems.push(
      `${visibleClass} must declare exactly one opacity:1 declaration, found ${
        visibleOpacity.length > 0 ? visibleOpacity.join(", ") : "none"
      }`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Activity-label visibility styles do not match the assumption in the pinned renderer stylesheet — ${problems.join("; ")}`,
    );
  }
  return { classes: 2 + sharedClasses.length };
}

export async function applyOriginalRendererActivityLabelVisibility({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one original renderer chunk for the activity-label visibility patch, found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  let checkedClasses = 0;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    checkedClasses += assertActivityLabelStylesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checkedClasses === 0) {
    throw new Error("Activity-label visibility found no renderer stylesheet to validate against.");
  }
  const patched = patchOriginalActivityLabelVisibility(candidate.source);
  // Assert the outcome, not just the edit: the row must key on the agent state, must no
  // longer mention the hover flag, and must still be driven by the pointer handlers so the
  // mark keeps its hover emphasis and its idle peek.
  for (const [needle, what] of [
    [VISIBILITY_INDEX_AFTER, "state-only visibility index"],
    ["onPointerEnter:()=>{xe(!0),se(!0)}", "pointer enter handler"],
    ["onPointerLeave:()=>{xe(!1),se(!1)}", "pointer leave handler"],
    ["emphasis:ce", "eye hover emphasis"],
  ]) {
    if (!patched.includes(needle)) {
      throw new Error(`Activity-label visibility patch lost its ${what}.`);
    }
  }
  if (activityMarkComponent(patched).includes(VISIBILITY_INDEX_BEFORE)) {
    throw new Error("Activity-label visibility patch still gates the label on pointer hover.");
  }
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-activity-label-visibility",
    chunks: [
      {
        role: "activity-mark",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: [LABEL_HIDDEN_CLASS, LABEL_VISIBLE_CLASS, ...LABEL_SHARED_CLASSES],
      },
    ],
    features: ["activity-label-always-visible-while-working"],
    transformations: ["activity-label-visibility-drops-hover-gate"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-activity-label-visibility-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
