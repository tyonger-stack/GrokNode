// Grok Bot 0.62.0 "learn from demonstration" SUCCESS PATH, ported onto the
// checksum-pinned 0.18 renderer chunk.
//
// This is the second half of the port that skill-detail-renderer-patch.mjs starts.
// That patch made the skill-detail pane itself byte-match 0.62.0's; this patch makes
// the rest of the successful demonstration round-trip match, which is the three
// things the 0.62.0 transcript screenshot shows and 0.18 could not produce at all.
//
// Evidence (byte-sourced 2026-09-30 from the official Grok Bot 0.62.0 macOS app,
// bundle com.anysphere.sand at /Applications/Grok Bot.app, read out of its app.asar
// with the four-uint32 header — @0=4, @4=headerSize, @8=pickle size, @12=JSON byte
// count, so the data section starts at `8 + readUInt32LE(4)` and the JSON tree at
// offset 16 for `readUInt32LE(12)` bytes):
//
//   1. THE PUBLISH BUTTON IS NOT MISSING — IT IS GATED, AND THE BACKEND SERVES IT
//      ON. 0.62.0's skill detail reads the gate as `u = Qt("publish_user_skills")`
//      (dist/renderer/assets/chunk-view-CUl9t9OA.js, component `mi`, the only
//      `publish_user_skills` occurrence in the whole 595-file 0.62.0 asar) and
//      renders `de = z ? null : l.jsx(ci, {agentId:s, isEnabled:u, …})` into the
//      header actions group — structurally identical to the 0.18 `Hi` the round-1
//      patch already produces. 0.18 does the same thing: `Hi` computes
//      `o = Ta()` (imported as `c4 as Ta` from the main chunk, where
//      `pWn() { return es(Qe().experiments.snapshots)?.featureGates
//                    ?.publish_user_skills ?? !1 }` — the gate name occurs exactly
//      once in the chunk) and hands it to `Bi` as `isEnabled`, whose first line is
//      `if (!l) return null`.
//
//      So the button was never absent: 0.18's local-only build ships
//      `createElectronProductionExperimentsBinding()` — snapshot `Object.freeze({})`,
//      `checkFeatureGate: () => false` — so every gate reads its bundled `?? !1`
//      default, while 0.62.0 runs the real Statsig client and gets the served value.
//      The served value for THIS account was read straight out of the official app's
//      own cache: `~/Library/Application Support/Grok Bot/sand-statsig-bootstrap.json`
//      (fetched 2026-09-29T18:14:20Z, user `grok|user_01M2Z119CZ6K0YY89Q3KJDD362`)
//      keys its gates by Statsig's djb2 (seed 0, ×31, int32-truncated) and holds
//      `publish_user_skills → true` under rule `3IGQyKuV6D5ivz5foBOikC` — a named
//      rule, not `default`. The same lookup returns `sand_teach_by_demonstration →
//      true` under `4YUfsPeH2QgwSdYNcUbGSV:100.00:1`, which is the finding the
//      existing teach-gate patch already documents, so the hash function is
//      self-checking. This patch therefore flips the bundled fallback to `?? !0`,
//      exactly as teach-gate-restore-patch.mjs does for its gate, and nothing else
//      about the publish path changes. It IS a feature-gate behaviour change and is
//      called out as such in the provenance record.
//
//   2. THE "recording is finished" LINE IS DROPPED BECAUSE 0.18's MESSAGE RENDERER
//      HAS NO `contentBeforeRichText`. The host genuinely sends the message —
//      source/host/extensions/teach-recording/teach-recording-service.ts:139 sends
//      `content: "The recording is finished. Learn the task from it."`, a
//      `clientNonce` of `teach-recording:<sha256(agentId)>:<session>.json`
//      (learningPromptNonce), and a `richText` doc whose only child is a
//      `workflowReference` node (source/shared/workflows.ts:
//      `WORKFLOW_REFERENCE_NODE_TYPE = "workflowReference"`). 0.62.0 classifies it:
//
//        function KSe(e) {                                   // index.eager-app
//          return e.clientNonce?.startsWith("teach-recording:") === !0
//              && e.content === "The recording is finished. Learn the task from it."
//            ? {kind: "teach-recording", content: q._({id: "/WKm9a"})}
//            : {kind: "verbatim", content: e.content}
//        }
//
//      and the message component (`$_e`, d=678) then renders
//      `<E$ content={f.content} contentBeforeRichText={E} … />` where
//      `E = f.kind === "teach-recording" ? f.content : void 0`.
//
//      `E$` (d=712) is where the line comes from: with rich text present it builds
//      the `sand-message-prose` container and puts
//      `<p className={"sand-message-content " + x.className}>{_m(v, i, "content")}</p>`
//      — `v = l?.trim()`, `l = contentBeforeRichText` — as the FIRST child, with the
//      rich-text prose as the second. 0.18's counterpart `BPn` has no such prop and
//      renders `children: l` (the rich text alone), so the line simply is not on
//      screen even though the message arrives intact.
//
//      Ported 1:1: the classifier, the exact two-part predicate (nonce prefix AND
//      exact content), the `contentBeforeRichText` prop on `BPn`, the
//      `"content"` React-key prefix, and `[before, richText]` as the children.
//      `RLocT` carries the localized string; the pair values are 0.62.0's own —
//      `/WKm9a` = "The recording is finished. Learn the task from it." in English and
//      「录制已完成。请从中学习这项任务。」 in zh-Hans (read out of
//      dist/renderer/assets/chunk-chat-CS_S59iU.js, the zh-Hans message table; the
//      zh-Hant twin 「錄製已完成。請從中學習這項任務。」 lives in chunk-chat-DPNMDvuk).
//
//   3. THE MANAGED-SKILL CHIP IS NEVER LOCALIZED IN 0.18. The chip in the screenshot
//      is not a separate concept: it is the `workflowReference` node the host just
//      sent, rendered by 0.18's `Pon` (0.62.0's `b$`, d=1260) and by the shared chip
//      shell `Sle`. 0.62.0's `b$` localizes the label before rendering:
//
//        function QSe(e, t = q) {                            // index.eager-app
//          return e.id === "learn-from-demonstration"
//              && e.label === "Learn from demonstration"
//            ? t._({id: "3Fgqpv"})
//            : e.label
//        }
//
//      `3Fgqpv` = "Learn from demonstration" (en) / 「从演示中学习」 (zh-Hans, read out
//      of dist/renderer/assets/chunk-core-dNaCtJM1.js; the zh-Hant twin
//      「從示範中學習」 is in chunk-core-CI9G95jy). 0.18 ships neither literal —
//      `learn-from-demonstration` and `Learn from demonstration` occur ZERO times in
//      its whole renderer tree — so the chip always reads in English. 0.18's `Pon`
//      is patched at its destructuring so the localized label flows into every
//      downstream use (the openReference callback, the icon, the chip label and the
//      `Open …` title), which is what 0.62.0's `b$` does with `u`.
//
//   Everything the 0.62.0 screenshot shows that is NOT changed here, because 0.18
//   already has it byte-for-byte: the inline skill pill in the assistant message
//   (`sand-workflow:` href parsing via `AAe`, the pill `mPn`/`h5n`, the click
//   navigation to `{kind:"skill", workflowId}`) and the host system prompt that tells
//   the agent to emit `[name](sand-workflow:<id>)`
//   (source/shared/workflow-model.ts:33). Neither the pill nor the skill itself
//   appeared locally only because the agent failed to produce a skill — a
//   model/runtime capability gap, not a UI gap.
//
// Memo-cache discipline. `he.c(N)` is React's `useMemoCache(N)`, which lazily
// allocates one `Array(N)` of sentinels PER COMPONENT INSTANCE on the fiber's
// updateQueue (verified in the pinned chunk: `function Sye(g){ … C = w.data[w.index] =
// Array(g); for (M=0;M<g;M++) C[M] = _; … }`, where `_` is
// `Symbol.for("react.memo_cache_sentinel")`). Bumping the size of ONE component's
// `c(N)` therefore cannot disturb any other component. `BPn` needs 26 (0.18 already
// used all 22) and `KWn` needs 45 (0.18 used all 44). Both bumps are anchored on the
// component's own unique signature so they cannot drift onto a neighbour.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// --- 1. The publish gate's bundled fallback ------------------------------------------------
//
// `pWn` is the only reader of `publish_user_skills` in 0.18's renderer tree, and the
// gate name itself occurs exactly once, so this anchor cannot be ambiguous. `??!1` is
// `?? false` and `??!0` is `?? true`; the tests evaluate the patched reader for real
// instead of trusting string equality, because a polarity mistake compiles fine and
// just leaves the button hidden.
const PUBLISH_GATE_BEFORE =
  "function pWn(){return es(Qe().experiments.snapshots)?.featureGates?.publish_user_skills??!1}";
const PUBLISH_GATE_AFTER =
  "function pWn(){return es(Qe().experiments.snapshots)?.featureGates?.publish_user_skills??!0}";

// The read side must survive, and the teach gate must stay exactly as it was.
const TEACH_GATE_READ = "featureGates?.sand_teach_by_demonstration??!1";

// --- 2. The teach-recording message classifier ----------------------------------------------
//
// Anchored on `BPn`'s own signature, which is unique in the chunk.
const MESSAGE_ANCHOR = 'function BPn(n){const e=he.c(22),{richText:t,content:s,matcher:r}=n;';
const MESSAGE_REPLACEMENT =
  'const RTeachRecordingNoncePrefix="teach-recording:";'
  + 'const RTeachRecordingContent="The recording is finished. Learn the task from it.";'
  + 'const RTeachContentClass='
  + JSON.stringify("sand-10im51j sand-rxpjvj sand-1heor9g sand-126k92a sand-j0a0fe") + ";"
  + "function RTeachIsRecording(e){"
  + "return e.clientNonce?.startsWith(RTeachRecordingNoncePrefix)===!0"
  + "&&e.content===RTeachRecordingContent}"
  + "function RTeachRecordingText(){"
  + 'return RLocT("The recording is finished. Learn the task from it.","录制已完成。请从中学习这项任务。")'
  + "}"
  + "function RTeachSkillLabel(e,t){"
  + 'return e==="learn-from-demonstration"&&t==="Learn from demonstration"'
  + '?(RLocT("Learn from demonstration","从演示中学习")):t'
  + "}"
  + 'function BPn(n){const e=he.c(26),{richText:t,content:s,contentBeforeRichText:RTeachBefore,matcher:r}=n;';

// `BPn`'s guard: the new prop joins the outer dependency check, and the new local
// joins the declaration list.
const BPN_GUARD_BEFORE = "let i,o,l,c;if(e[0]!==s||e[1]!==r||e[2]!==t){";
const BPN_GUARD_AFTER = "let i,o,l,c,RTeachNode;if(e[0]!==s||e[1]!==r||e[2]!==t||e[22]!==RTeachBefore){";

// The rich-text branch: compute the `contentBeforeRichText` paragraph and memoise it.
// 0.62.0's `E$` does exactly this with `v = l?.trim()` and renders
// `<p className={"sand-message-content " + x.className}>{_m(v, i, "content")}</p>`,
// using the SAME class string 0.18 already uses on its no-rich-text path and the
// "content" key prefix 0.62.0 uses (`h_e = "content"`).
const BPN_BRANCH_BEFORE =
  'o=f.style,l=ypt(m.content,{parent:"root",listDepth:LPn},"b",r)}'
  + "e[0]=s,e[1]=r,e[2]=t,e[3]=i,e[4]=o,e[5]=l,e[6]=c}else i=e[3],o=e[4],l=e[5],c=e[6];";
const BPN_BRANCH_AFTER =
  'o=f.style,l=ypt(m.content,{parent:"root",listDepth:LPn},"b",r);'
  + "if(e[23]!==RTeachBefore||e[24]!==r){"
  + "const b=RTeachBefore?.trim();"
  + "e[23]=RTeachBefore,e[24]=r,"
  + 'e[25]=b!=null&&b.length>0?p.jsx("p",{className:re("sand-message-content",RTeachContentClass),'
  + 'children:gpt(b,r,"content")}):null}'
  + "RTeachNode=e[25]}"
  + "e[0]=s,e[1]=r,e[2]=t,e[3]=i,e[4]=o,e[5]=l,e[6]=c,e[22]=RTeachBefore}"
  + "else i=e[3],o=e[4],l=e[5],c=e[6],RTeachNode=e[25];";

// The container: `[contentBeforeRichText, richText]` instead of `[richText]`.
// No extra memo dependency is needed — every outer-guard miss recomputes `l` as a
// fresh array, so the existing `e[20]!==l` check already invalidates this cache, and
// an outer-guard hit by definition changed nothing.
const BPN_RETURN_BEFORE =
  'let u;return e[18]!==i||e[19]!==o||e[20]!==l?'
  + '(u=p.jsx("div",{className:i,style:o,children:l}),e[18]=i,e[19]=o,e[20]=l,e[21]=u):u=e[21],u}';
const BPN_RETURN_AFTER =
  'let u;return e[18]!==i||e[19]!==o||e[20]!==l?'
  + '(u=p.jsx("div",{className:i,style:o,children:[RTeachNode,l]}),e[18]=i,e[19]=o,e[20]=l,e[21]=u):u=e[21],u}';

// --- 2b. The call site: classify the entry, then hand both strings to `BPn` ------------------
//
// `KWn` is 0.62.0's `$_e`. Its memo already has all 44 slots in use, so one more is
// added for the `clientNonce` dependency (the classifier's only other input,
// `content`, is already guarded by `e[23]`).
const CALLER_SIGNATURE = "function KWn(n){const e=he.c(44);";
const CALLER_SIGNATURE_AFTER = "function KWn(n){const e=he.c(45);";
const CALL_SITE_BEFORE =
  "let N;e[23]!==r.content||e[24]!==r.richText||e[25]!==u?"
  + "(N=p.jsx(BPn,{content:r.content,matcher:u,richText:r.richText}),"
  + "e[23]=r.content,e[24]=r.richText,e[25]=u,e[26]=N):N=e[26];";
const CALL_SITE_AFTER =
  "let N;e[23]!==r.content||e[24]!==r.richText||e[25]!==u||e[44]!==r.clientNonce?"
  + "(N=p.jsx(BPn,{content:RTeachIsRecording(r)?RTeachRecordingText():r.content,"
  + "contentBeforeRichText:RTeachIsRecording(r)?RTeachRecordingText():void 0,"
  + "matcher:u,richText:r.richText}),"
  + "e[23]=r.content,e[24]=r.richText,e[25]=u,e[44]=r.clientNonce,e[26]=N):N=e[26];";

// --- 3. The managed-skill chip label -----------------------------------------------------------
//
// 0.18's `Pon` destructures `label` straight into `s` and uses `s` for the
// openReference callback, the icon, the chip label and the `Open …` title — exactly
// the four places 0.62.0's `b$` uses its localized `u`. Renaming the destructured
// binding and re-binding `s` to the localized label therefore ports `QSe` in one
// surgical edit, with no slot renumbering and no risk to the rest of the component.
const CHIP_BEFORE = "{id:t,label:s,iconId:r,iconUrl:i}=n,o=ict();";
const CHIP_AFTER =
  "{id:t,label:RTeachRawLabel,iconId:r,iconUrl:i}=n,o=ict(),s=RTeachSkillLabel(t,RTeachRawLabel);";

// Classes the new `contentBeforeRichText` paragraph depends on. They are the same five
// 0.18 already renders on its no-rich-text path, so they are asserted present in the
// pinned stylesheet rather than trusted.
export const TEACH_SUCCESS_PATH_CLASS_NAMES = Object.freeze([
  "sand-10im51j",
  "sand-rxpjvj",
  "sand-1heor9g",
  "sand-126k92a",
  "sand-j0a0fe",
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer teach-success-path ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Fail closed unless every class the ported transcript line relies on is really
 * defined by the pinned stylesheet. A stylesheet change would otherwise render the
 * line unstyled with nothing in the build failing.
 */
export function assertTeachSuccessPathClassesResolve(cssText, classNames = TEACH_SUCCESS_PATH_CLASS_NAMES) {
  const unresolved = classNames.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText);
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Teach success-path classes are missing from the pinned renderer stylesheet: ${unresolved.join(", ")}`,
    );
  }
  return classNames.length;
}

export function patchOriginalTeachSuccessPath(source) {
  let patched = replaceExactlyOnce(source, PUBLISH_GATE_BEFORE, PUBLISH_GATE_AFTER, "publish gate fallback");
  patched = replaceExactlyOnce(patched, BPN_GUARD_BEFORE, BPN_GUARD_AFTER, "message guard");
  patched = replaceExactlyOnce(patched, BPN_BRANCH_BEFORE, BPN_BRANCH_AFTER, "message contentBeforeRichText");
  patched = replaceExactlyOnce(patched, BPN_RETURN_BEFORE, BPN_RETURN_AFTER, "message prose children");
  patched = replaceExactlyOnce(patched, CALLER_SIGNATURE, CALLER_SIGNATURE_AFTER, "caller memo size");
  patched = replaceExactlyOnce(patched, CALL_SITE_BEFORE, CALL_SITE_AFTER, "message call site");
  patched = replaceExactlyOnce(patched, MESSAGE_ANCHOR, MESSAGE_REPLACEMENT, "classifier insertion");
  patched = replaceExactlyOnce(patched, CHIP_BEFORE, CHIP_AFTER, "managed-skill chip label");
  if (!patched.includes(TEACH_GATE_READ)) {
    throw new Error("Teach success-path patch lost the sand_teach_by_demonstration gate read.");
  }
  if (patched.includes(PUBLISH_GATE_BEFORE)) {
    throw new Error("Teach success-path patch left the publish_user_skills fallback unflipped.");
  }
  return patched;
}

export async function applyOriginalRendererTeachSuccessPath({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(MESSAGE_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original transcript chunk for the 0.62.0 port, found ${candidates.length}.`);
  }
  const candidate = candidates[0];

  let checkedClasses = 0;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    checkedClasses += assertTeachSuccessPathClassesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checkedClasses === 0) {
    throw new Error("Teach success-path port found no renderer stylesheet to validate its classes against.");
  }

  const patched = patchOriginalTeachSuccessPath(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-teach-success-path",
    upstream: {
      version: "0.62.0",
      bundleId: "com.anysphere.sand",
      detailChunk: "dist/renderer/assets/chunk-view-CUl9t9OA.js",
      detailComponent: "mi",
      messageChunk: "dist/renderer/assets/index-BYEktDeR.js",
      messageComponents: ["$_e", "E$"],
      classifierChunk: "dist/renderer/assets/index.eager-app-C20nv6Dx.js",
      classifierComponents: ["KSe", "QSe"],
      zhHansMessageTable: "dist/renderer/assets/chunk-chat-CS_S59iU.js",
      zhHansCoreTable: "dist/renderer/assets/chunk-core-dNaCtJM1.js",
    },
    gateEvidence: {
      source: "~/Library/Application Support/Grok Bot/sand-statsig-bootstrap.json",
      fetchedAt: "2026-09-29T18:14:20.985Z",
      account: "grok|user_01M2Z119CZ6K0YY89Q3KJDD362",
      lookup: "Statsig djb2, seed 0, multiply 31, int32-truncated",
      publish_user_skills: { hash: "3826951174", value: true, ruleId: "3IGQyKuV6D5ivz5foBOikC" },
      controlGate: { name: "sand_teach_by_demonstration", hash: "2253049356", value: true, ruleId: "4YUfsPeH2QgwSdYNcUbGSV:100.00:1" },
      behaviourChange: "publish_user_skills is a Statsig feature gate; this patch turns it on in a build that cannot receive server-side gates.",
    },
    chunks: [
      {
        role: "transcript",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: TEACH_SUCCESS_PATH_CLASS_NAMES,
      },
    ],
    features: [
      "publish-user-skills-gate",
      "teach-recording-message-classifier",
      "content-before-rich-text",
      "managed-skill-chip-localised-label",
    ],
    transformations: [
      "publish-gate-fallback-false-to-true",
      "teach-recording-classifier-by-nonce-prefix-and-exact-content",
      "message-renderer-contentBeforeRichText-prop",
      "message-prose-children-content-then-rich-text",
      "managed-skill-chip-label-localised",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-teach-success-path-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
