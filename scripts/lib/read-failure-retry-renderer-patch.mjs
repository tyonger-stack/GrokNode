// Grok Bot 0.71.2 "load failed → Retry, keep the old content", ported onto the checksum-pinned
// 0.18 renderer chunk index-UbX-y3il.js for the two reads that map cleanly: the open agent's
// transcript and the agent's routines list. Cloud-agent and team reads are not ported.
//
// Evidence: official Grok Bot 0.71.2 renderer, /Users/Apple/Documents/grokbot/rea-grokbot-0712/
// app/dist/renderer/assets. Offsets live in EVIDENCE (the provenance record), not in the chunk.
//
// 0.71.2 model. Every read is a resource `Ke(name,{id})` whose state is
// {status: ready|loading|failed|empty|unavailable, previous?, failure}. Its renderer `gc`
// shows, for a failed read, the stale value (`previous`) together with a failure surface `Cm`
// — copy "Couldn't refresh" when previous data is still on screen, the resource's own copy
// otherwise — and a Retry only when `failure.retry !== null`. `Cm` renders nothing for a
// box-parked failure (`nd`: SAND_AWAY_PARK / SAND_PRESENT_PARK / SAND_CLIENT_PAUSE).
//
// 0.18 already keeps `previous` in both stores and already shows a full "Couldn't load
// conversation" surface when the transcript has nothing to show. What it lacks:
//   transcript — a failed refresh with entries on screen is silent. 0.71.2 mounts `$ge`, a tray
//     above the composer holding `transcriptRead.row(...)`, i.e. "Couldn't refresh" + "Try again".
//   routines — `K2n` renders nothing at all when the first load fails, and the stale list
//     silently when a refresh fails. 0.71.2's `qL` renders `read.panel(...)`: the failure panel
//     ("Couldn't load routines" / "Couldn't refresh" + refresh icon button) above the list.
//   failure — 0.18's box-blocked failure (`HBn`) drops the block reason, so `nd` cannot be
//     evaluated. 0.71.2's `c8` carries it as `sandBoxBlockReason`; the same field is added.
//
// The surfaces read 0.18's own stores directly (transcript snapshot / automations snapshot)
// rather than introducing 0.71.2's resource objects, and are mounted without touching any
// React Compiler memo cache: the tray goes into `yOn`'s plain object literal, the routines
// panel wraps `K2n` from outside.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MARKER = "function RReadFailure(";

export const READ_TRAY_CLASSES = ["sand-1lliihq", "sand-hojbe8", "sand-10e981r", "sand-67bb7w"];
export const READ_ROW_CLASSES = [
  "sand-9f619",
  "sand-78zum5",
  "sand-1a02dak",
  "sand-6s0dn4",
  "sand-1qughib",
  "ui-1pzdu40",
  "sand-3pnbk8",
  "sand-oyc9vk",
  "sand-2lprc",
];
export const READ_COPY_CLASSES = ["sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-137clkk", "sand-euugli", "sand-1mzt3pk"];
export const READ_BODY2_CLASSES = ["sand-11wthnw", "sand-d4r4e8", "sand-12oo3zp"];
export const READ_PANEL_CLASSES = [
  ...READ_BODY2_CLASSES,
  "sand-9f619",
  "sand-78zum5",
  "sand-6s0dn4",
  "sand-1qughib",
  "sand-167g77z",
  "sand-u0aao5",
  "sand-f159sx",
  "sand-mzvs34",
  "sand-169k319",
];
// 0.71.2 classes 0.18's stylesheet never shipped; their declarations are applied inline.
// sand-mzvs34 is not in the pinned CSS either, but the computer-sleep pass (which runs first)
// appends its exact 0.71.2 rule to the staged stylesheet, so the panel uses the class.
export const READ_INLINE_ONLY_CLASSES = Object.freeze({
  "sand-1n9uuka": "padding-inline-end:var(--cursor-spacing-3-5)",
  "sand-cssynl": "padding-inline-start:var(--cursor-spacing-3-5)",
});

export const READ_COPY = Object.freeze({
  stale: { id: "lHVuBQ", en: "Couldn't refresh", zh: "无法刷新" },
  retry: { id: "KDw4GX", en: "Try again", zh: "重试" },
  transcript: { id: "vCqW2l", en: "Couldn't load conversation", zh: "无法加载对话" },
  routines: { id: "Hm/b/t", en: "Couldn't load routines", zh: "无法加载例行任务" },
});

export const EVIDENCE = Object.freeze({
  source: "Grok Bot 0.71.2 renderer (rea-grokbot-0712/app/dist/renderer/assets)",
  resourceFactory: "index.eager-app-DSuGVQNC.js@239090 (Ke(name,copy) → {name,copy})",
  resourceRenderer: "index.eager-app-DSuGVQNC.js@243413 (gc: failed → value(previous,'stale') + Cm; panel puts the surface first)",
  failureSurface: "index.eager-app-DSuGVQNC.js@244520 (Cm: null when nd(failure); copy K6 when stale; retry only when failure.retry!==null; isPending while the clicked failure is current)",
  staleCopy: "index.eager-app-DSuGVQNC.js@243390 (K6={id:'lHVuBQ'})",
  parkedPredicate: "index.eager-app-DSuGVQNC.js@238371 (nd) + @221990 (SAND_CLIENT_PAUSE / SAND_AWAY_PARK / SAND_PRESENT_PARK)",
  boxBlockedFailure: "index.eager-app-DSuGVQNC.js@290935 (c8: ...reason.length>0?{sandBoxBlockReason:reason}:{})",
  transcriptResource: "index.eager-app-DSuGVQNC.js@405751 (cT=Ke('transcript',{id:'vCqW2l'})) + @406373 (nt(cT, entriesFor, ()=>transcript.load(agent)))",
  transcriptState: "index.eager-app-DSuGVQNC.js@1538101 (qIe: failure!==null && (previous===void 0 || !nd) → failed; previous = entries when loadState==='ready' || entries.length>0)",
  transcriptErrored: "index-wlkGG389.js@1986457 (isTranscriptErrored = failed && entries.length===0 — same as 0.18)",
  transcriptTray: "index.eager-app-DSuGVQNC.js@1061782 ($ge: tray div + read.row({value:()=>null,loading:null}))",
  transcriptTrayMount: "index-wlkGG389.js@1977985 (surface==='transcript' && !isNewChatOpen ? $ge : null) + @1978229 (Fragment[tray, trays])",
  readStatusRenderer: "index-wlkGG389.js@383564 (RO: row = body copy + secondary 'Try again' button; panel = body2 copy + zy)",
  readStatusRecipes: "index-wlkGG389.js@382107 (qo.panel/qo.row) + @383077 (pj copy column)",
  panelRetry: "index-wlkGG389.js@386931 (zy: icon button refresh, circle, sm, ghost, aria-label KDw4GX; null when retry===null)",
  body2Recipe: "index.eager-app-DSuGVQNC.js@586189 (body2: sand-11wthnw / line-height 18px / letter-spacing 0em)",
  routinesResource: "index.eager-app-DSuGVQNC.js@435938 (AT=Ke('agent-automations',{id:'Hm/b/t'})) + @436133/@241081 (Zn: retry = automations.refresh(agent))",
  routinesPanel: "index-wlkGG389.js@709594 (qL) + @710293 (read.panel({value:list,empty,loading:null}))",
  copyEn: "index.eager-app-DSuGVQNC.js lHVuBQ@136496 KDw4GX@46673 Hm/b/t@100838 vCqW2l@149564",
  copyZhHans: "chunk-core-CFLk5DM-.js lHVuBQ@35996 KDw4GX@16346 Hm/b/t@14700 vCqW2l@43585",
  target018: "index-UbX-y3il.js HBn@5377903 yOn trays@5315359 K2n@2733245 Dtt@827526 (transcript loadState rule @5703066 identical to 0.71.2's)",
});

const COMPONENT_SOURCE =
  "const R_READ_PARKED=new Set([\"SAND_AWAY_PARK\",\"SAND_PRESENT_PARK\",\"SAND_CLIENT_PAUSE\"]);" +
  "function RReadIsParked(f){return f!=null&&R_READ_PARKED.has(f.sandBoxBlockReason)}" +
  "const R_READ_TRAY_CLASS=" + JSON.stringify(READ_TRAY_CLASSES.join(" ")) + ";" +
  "const R_READ_ROW_CLASS=" + JSON.stringify(READ_ROW_CLASSES.join(" ")) + ";" +
  "const R_READ_ROW_STYLE={paddingInlineStart:\"var(--cursor-spacing-3-5)\",paddingInlineEnd:\"var(--cursor-spacing-3-5)\"};" +
  "const R_READ_COPY_CLASS=" + JSON.stringify(READ_COPY_CLASSES.join(" ")) + ";" +
  "const R_READ_PANEL_CLASS=" + JSON.stringify(READ_PANEL_CLASSES.join(" ")) + ";" +
    "const R_READ_BODY2={kGuDYH:\"sand-11wthnw\",kLWn49:\"sand-d4r4e8\",kb6lSQ:\"sand-12oo3zp\",$$css:!0};" +
  "const R_READ_NO_SUB=()=>()=>{},R_READ_NONE=()=>null;" +
  "function RReadFailure(n){const{read:t,size:s,failure:f,isStale:i,copy:c,retry:r}=n,[l,o]=S.useState(null);" +
  "const m=i?RLocT(\"Couldn't refresh\",\"无法刷新\"):c,d=f.display?.detail??null," +
  "a={\"data-read\":t,\"data-read-state\":i?\"stale\":\"failed\",\"data-retry-owner\":f.retry?.owner},u=()=>{o(f),r()};" +
  "if(s===\"row\")return p.jsxs(\"div\",{className:R_READ_ROW_CLASS,style:R_READ_ROW_STYLE,...a,role:\"alert\",children:[" +
  "p.jsxs(\"div\",{className:R_READ_COPY_CLASS,children:[p.jsx(vt,{as:\"span\",color:\"primary\",size:\"md\",children:m}),d===null?null:p.jsx(vt,{as:\"span\",color:\"secondary\",size:\"md\",children:d})]})," +
  "f.retry==null?null:p.jsx(As,{disabled:l===f,onClick:u,size:\"md\",rootStyle:R_READ_BODY2,type:\"button\",variant:\"secondary\",children:RLocT(\"Try again\",\"重试\")})]});" +
  "return p.jsxs(\"div\",{className:R_READ_PANEL_CLASS,...a,role:\"alert\",children:[" +
  "p.jsxs(\"div\",{className:R_READ_COPY_CLASS,children:[p.jsx(\"span\",{children:m}),d===null?null:p.jsx(\"span\",{children:d})]})," +
  "f.retry==null?null:p.jsx(fr,{\"aria-label\":RLocT(\"Try again\",\"重试\"),disabled:l===f,icon:\"refresh\",onClick:u,shape:\"circle\",size:\"sm\",variant:\"ghost\"})]})}" +
  "function RReadTranscriptTray(n){const{agentId:e}=n,t=Qe().transcript,s=e==null||e.length===0?null:t.snapshotsFor(e)," +
  "v=S.useSyncExternalStore(s?.subscribe??R_READ_NO_SUB,s?.get??R_READ_NONE,s?.get??R_READ_NONE);" +
  "if(v==null||v.failure==null||RReadIsParked(v.failure))return null;" +
  "return p.jsx(\"div\",{className:R_READ_TRAY_CLASS,children:p.jsx(RReadFailure,{read:\"transcript\",size:\"row\",failure:v.failure," +
  "isStale:v.loadState===\"ready\"||v.entries.length>0,copy:RLocT(\"Couldn't load conversation\",\"无法加载对话\"),retry:()=>t.load(e)})})}" +
  "function RReadRoutinesPanel(n){const{agentId:e,children:c}=n,a=Qe().automations,v=Dtt(e);" +
  "return p.jsxs(p.Fragment,{children:[v.status===\"failed\"&&!RReadIsParked(v.failure)?p.jsx(RReadFailure,{read:\"agent-automations\",size:\"panel\"," +
  "failure:v.failure,isStale:v.previous!=null,copy:RLocT(\"Couldn't load routines\",\"无法加载例行任务\"),retry:()=>{e!=null&&e.length>0&&a.refresh(e)}}):null,c]})}";

export const READ_FAILURE_TRANSFORMS = Object.freeze([
  [
    "box-blocked-failure-keeps-reason",
    "function HBn(n){const e={code:l0e,boundary:\"host\",retry:null,transportKind:\"box_blocked\",...n===null?{}:{display:",
    "function HBn(n){const e={code:l0e,boundary:\"host\",retry:null,transportKind:\"box_blocked\",...n!==null&&n.reason.length>0?{sandBoxBlockReason:n.reason}:{},...n===null?{}:{display:",
  ],
  [
    "chat-trays-stale-transcript",
    "trays:n.trays,composer:",
    "trays:p.jsxs(p.Fragment,{children:[e.transcriptSurface.surface===\"transcript\"&&!n.isNewChatOpen?p.jsx(RReadTranscriptTray,{agentId:n.currentAgentId}):null,n.trays]}),composer:",
  ],
  [
    "routines-list-failure-panel",
    "function K2n(n){const e=he.c(25),{agentId:t,",
    COMPONENT_SOURCE +
      "function K2n(n){return p.jsx(RReadRoutinesPanel,{agentId:n.agentId,children:p.jsx(RK2nList,{...n})})}" +
      "function RK2nList(n){const e=he.c(25),{agentId:t,",
  ],
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalReadFailureRetry(source, { skip = [] } = {}) {
  if (source.includes(MARKER)) throw new Error("Read-failure retry renderer patch was already applied.");
  let patched = source;
  for (const [role, before, after] of READ_FAILURE_TRANSFORMS) {
    if (skip.includes(role)) continue;
    patched = replaceExactlyOnce(patched, before, after, `read-failure ${role}`);
  }
  return patched;
}

const STYLE_CLASSES = [...new Set([...READ_TRAY_CLASSES, ...READ_ROW_CLASSES, ...READ_COPY_CLASSES, ...READ_PANEL_CLASSES])];

export function assertReadFailureStylesResolve(cssText) {
  const missing = STYLE_CLASSES.filter(name => !cssText.includes(`.${name}`));
  if (missing.length > 0) {
    throw new Error(`Read-failure surface classes are missing from the pinned stylesheet: ${missing.join(", ")}`);
  }
  const shipped = Object.keys(READ_INLINE_ONLY_CLASSES).filter(name => cssText.includes(`.${name}`));
  if (shipped.length > 0) {
    throw new Error(`Pinned stylesheet now ships ${shipped.join(", ")}; retire the inline fallback for it.`);
  }
  return STYLE_CLASSES.length;
}

const sha = text => createHash("sha256").update(text).digest("hex");

export async function applyOriginalRendererReadFailureRetry({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const names = await readdir(assetsRoot);
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(READ_FAILURE_TRANSFORMS[2][1])) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk for the read-failure retry patch, found ${candidates.length}.`);
  }
  let checked = 0;
  for (const name of names) {
    if (name.endsWith(".css")) checked += assertReadFailureStylesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checked === 0) throw new Error("Read-failure retry patch found no renderer stylesheet to validate against.");
  const [candidate] = candidates;
  const patched = patchOriginalReadFailureRetry(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-read-failure-retry",
    chunks: [
      {
        role: "chat-trays+routines-list+gateway-failure",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: sha(candidate.source) },
        patched: { bytes: Buffer.byteLength(patched), sha256: sha(patched) },
        validatedStyleClasses: STYLE_CLASSES,
        inlineOnlyClasses: READ_INLINE_ONLY_CLASSES,
      },
    ],
    features: ["transcript-stale-refresh-tray", "routines-load-failure-panel", "box-blocked-failure-block-reason"],
    transformations: READ_FAILURE_TRANSFORMS.map(([role]) => role),
    copy: READ_COPY,
    evidence: EVIDENCE,
    knownDeltas: [
      "0.71.2 hides a transcript failure equal to its pre-port-boot failure (prePortBootFailure); 0.18 has no such concept, so every lastFailure surfaces.",
      "0.71.2's tray container hides itself with :empty (sand-jl7jj, absent from 0.18 CSS); here the container is only rendered when it has content.",
      "sand-ergiip (box-shadow:var(--sand-shadow-inline)) is omitted: the variable is undefined in 0.71.2 too, so it paints nothing there.",
      "0.71.2 wraps the panel retry icon in a tooltip that is disabled when no tooltip text is given (the default placement); the wrapper is omitted.",
      "0.18's full-screen 'Couldn't load conversation' surface is unchanged (it already shows when the transcript has nothing to display).",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-read-failure-retry-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
