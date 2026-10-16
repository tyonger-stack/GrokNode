// Grok Bot 0.71.2 working-status phrases without a Bot-name prefix (P1-2).
//
// Evidence (0.71.2 index.eager-app-DSuGVQNC.js @858420):
//   Wre = thinking phrases [np8SXe, h3LL7E, Px2Nkv]
//   CP  = working phrases  [dfCCPD, ZVMmJH, RQqcwV, 2z3X8R, p0demG]
//   bb  = textKind → copy map (incl. waiting_on_command → MsZyH5)
//   TP(list, draw) picks list[floor(draw * length)]; bWe(draw)=TP(CP,draw).
//
// Evidence (0.71.2 index-wlkGG389.js @1336575 / @1337183):
//   tOe / aOe: when mode is working and there is no richer activity label,
//   the bubble mark shows k6(phraseDraw) (= bWe) — a rotating phrase with NO
//   bot-name prefix. Typing still uses PxYAul.
//
// 0.18 today: gJn("working", name) → `${name} is working` (MAIN_I18N_LOCAL_ANCHORED
// then wraps the "is working" / "Typing…" literals). This patch replaces that
// with CP phrases + RLocT (zh-Hans from chunk-shared-DwNCHcV3.js), and feeds
// phraseDraw from activityElapsedMs at the SJn call site
// (`Math.min(.999, (elapsedMs ?? 0) / 180000)` — same 0..1 draw domain as TP).
//
// P2-2 (MsZyH5 "Waiting on results" / waiting_on_command): 0.18's host never
// emits a textKind on activity (renderer has no textKind reads; host maps Await
// tools to Ja("waiting","Waiting on a command") only). So the bb map path is
// not ported — report only. sand_hide_working_dot is untouched.
//
// Ordering: runs before the four i18n passes. MAIN_I18N_LOCAL_ANCHORED's gJn
// entry is updated to match the post-this-patch bytes (Typing already RLocT'd
// here, so that LOCAL entry becomes a no-op identity on the new signature).

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// CP ids → en (eager-app) / zh-Hans (chunk-shared-DwNCHcV3.js)
const WORKING_PHRASES = Object.freeze([
  ["Getting it done", "正在完成"],
  ["Making progress", "正在推进"],
  ["Working on it", "正在处理"],
  ["Handling it", "正在搞定"],
  ["Chipping away", "正在一点点推进"],
]);

const GJN_BEFORE =
  'function gJn(n,e){if(n==="working"){const t=e?.trim();return t!=null&&t.length>0?`${t} is working`:null}return"Typing…"}';

const GJN_AFTER =
  "const RWorkingPhrases=" + JSON.stringify(WORKING_PHRASES) + ";"
  + "function RWorkingPhrase(draw){"
  + "const t=typeof draw==\"number\"&&isFinite(draw)?draw:0;"
  + "const i=Math.min(RWorkingPhrases.length-1,Math.max(0,Math.floor(t*RWorkingPhrases.length)));"
  + "const p=RWorkingPhrases[i]??RWorkingPhrases[0];"
  + "return RLocT(p[0],p[1])}"
  + 'function gJn(n,e,draw){if(n==="working")return RWorkingPhrase(draw);'
  + 'return(RLocT("Typing…","正在输入…"))}';

// SJn call site: pass a 0..1 draw derived from activityElapsedMs (`y`).
const CALL_BEFORE = "R=gJn(t,B??_),q=_pt(t,v,_),";
const CALL_AFTER =
  "R=gJn(t,B??_,Math.min(.999,(y??0)/18e4)),q=_pt(t,v,_),";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer working-status-phrases ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchWorkingStatusPhrases(source) {
  let patched = replaceExactlyOnce(source, GJN_BEFORE, GJN_AFTER, "gJn");
  patched = replaceExactlyOnce(patched, CALL_BEFORE, CALL_AFTER, "SJn gJn call");
  if (patched.includes("${t} is working") || patched.includes("` is working`")) {
    throw new Error("Working-status-phrases patch left a bot-name-prefixed working label.");
  }
  for (const [en] of WORKING_PHRASES) {
    if (!patched.includes(JSON.stringify(en))) {
      throw new Error(`Working-status-phrases patch dropped phrase ${en}.`);
    }
  }
  return patched;
}

export async function applyOriginalRendererWorkingStatusPhrases({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(GJN_BEFORE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one chunk with gJn for working-status phrases, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchWorkingStatusPhrases(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-working-status-phrases",
    upstream: {
      version: "0.71.2",
      phraseTable: { chunk: "dist/renderer/assets/index.eager-app-DSuGVQNC.js", offset: 858420, names: ["Wre", "CP", "bb"] },
      markLabel: { chunk: "dist/renderer/assets/index-wlkGG389.js", components: ["tOe", "aOe"], offset: 1336575 },
      zhHansTable: "dist/renderer/assets/chunk-shared-DwNCHcV3.js",
      workingPhraseIds: ["dfCCPD", "ZVMmJH", "RQqcwV", "2z3X8R", "p0demG"],
    },
    notPorted: {
      p2_2_waiting_on_results: "0.18 host does not emit activity.textKind; Await tools still use Ja Waiting on a command. MsZyH5 / bb.waiting_on_command left for a host status key.",
      thinking_phrases_Wre: "0.18 activity mark has no thinking mode in gJn (only working/typing); Wre unused.",
      sand_hide_working_dot: "untouched by design",
    },
    chunks: [
      {
        role: "activity-mark",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
      },
    ],
    transformations: [
      "gJn-working-uses-CP-phrases-without-bot-name",
      "phraseDraw-from-activityElapsedMs",
      "Typing-localized-via-RLocT",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-working-status-phrases-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}

export { WORKING_PHRASES, GJN_BEFORE, GJN_AFTER };
