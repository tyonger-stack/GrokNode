// Grok Bot 0.71.2 "Not delivered yet" (qq3pY2), ported onto the checksum-pinned 0.18 renderer
// chunk index-UbX-y3il.js.
//
// Evidence: official Grok Bot 0.71.2 renderer, /Users/Apple/Documents/grokbot/rea-grokbot-0712/
// app/dist/renderer/assets. Offsets below are byte offsets into those files; they live in the
// provenance record (EVIDENCE) rather than in the chunk.
//
// What 0.71.2 does that 0.18 does not: when the online ACK deadline expires for a send that the
// host already accepted (phase "accepted-awaiting-echo") but whose echo never arrived, 0.18
// marks the journal record failed immediately — and because 0.18's markOptimisticFailed only
// flips "pending" overlays, a confirmed ("accepted") bubble shows nothing at all. 0.71.2 instead
// flags the record `awaitingHostDecision`, asks the host for the acceptance record, and when the
// host cannot give a decision (accepted without echo, durability unknown, query failed, or the
// transport is down) shows "Not delivered yet" under the user's bubble. A definite negative
// still ends in the existing "Failed to send / Resend" row.
//
// The port is a 1:1 transcription of the awaitingHostDecision branches into 0.18's own
// spelling. Everything 0.71.2 changed for other reasons (session ids, dispatch holds, retain,
// refusal codes) is deliberately left at 0.18 behaviour.
//
// Variable map (0.71.2 index.eager-app → 0.18 index-UbX-y3il): journal map a→c, persist te→_,
// set-record V→R, phase X→H, reconcile Ue→Z, expiry decision Q→ne, overlay s→s, in-flight u→d,
// parked-while-down p→f, failure Ze/et→Ae, capability-unavailable code Rs→h2, uncertain
// rt→de, prior status (Jn,Rn,_n,fn)→(Pe,je,Le,Me), own status (ct,yt,wn,jn)→(Te,Je,Ce,Ie),
// record bt→qe, zl→fKe, Aue→THn.
//
// Not ported (recorded, not papered over): 0.71.2's expiry handler persists the awaiting flag
// through its failed-state retry helper `T`; 0.18 persists once via `_()`. If that one write
// fails the flag is not durable across a restart, and the restored record re-enters the
// ordinary ACK timer and expires into the same awaiting path again.
//
// Rendering. 0.71.2 carries isUndelivered in a unified per-entry send-state map; 0.18 threads
// separate per-kind sets through five compiled components. Instead of growing every memo
// guard on that path, the snapshot builder publishes the undelivered entry ids (last entry of
// each undelivered overlay — 0.71.2's isActionOwner rule) into a module-level external store,
// and the user-row footer reads it through useSyncExternalStore. Entry ids embed the client
// nonce, so they are unique across agents.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MARKER = "function RSendUndeliveredFooter(";

export const UNDELIVERED_ROW_CLASSES = [
  "sand-pvyfi4",
  "sand-78zum5",
  "sand-6s0dn4",
  "sand-1a02dak",
  "sand-13a6bvl",
  "sand-11twubx",
  "sand-1om1abp",
];
export const UNDELIVERED_TEXT_CLASSES = ["sand-1o0liin", "sand-y5h43f", "sand-19ji09o"];

export const UNDELIVERED_COPY = { id: "qq3pY2", en: "Not delivered yet", zh: "尚未送达" };

export const EVIDENCE = Object.freeze({
  source: "Grok Bot 0.71.2 renderer (rea-grokbot-0712/app/dist/renderer/assets)",
  journalParserKeepsFlag: "index.eager-app-DSuGVQNC.js@1597263 (nPe: kept only when phase==='accepted-awaiting-echo' && failedAtMs===void 0)",
  expiryPredicate: "index.eager-app-DSuGVQNC.js@954654 (Aue: awaitingHostDecision short-circuits the elapsed check)",
  overlayStatus: "index.eager-app-DSuGVQNC.js@954773 (zl: awaitingHostDecision → 'accepted')",
  expiryDecision: "index.eager-app-DSuGVQNC.js@1603673 (Q/qe: transport down && awaitingHostDecision → markOptimisticUndelivered, 'parked')",
  reconcilePrior: "index.eager-app-DSuGVQNC.js@1604609 (found && !rejected && no echo && awaiting → undelivered, 'retired')",
  reconcileOwn: "index.eager-app-DSuGVQNC.js@1605415 (awaiting && code!==Rs: found-no-echo → retired; uncertain/failed/unknown-durability → parked; both undelivered)",
  reconcileRejected: "index.eager-app-DSuGVQNC.js@1605809 (found && rejected: rt||awaiting → Q)",
  resendStripsFlag: "index.eager-app-DSuGVQNC.js@1610218 ({failedAtMs,firstFlushAtMs,awaitingHostDecision,...rest})",
  ackExpiry: "index.eager-app-DSuGVQNC.js@1614403 (Je: accepted-awaiting-echo → {...,awaitingHostDecision:!0}, persist, Ue)",
  echoReconciled: "index.eager-app-DSuGVQNC.js@1618820 (noteEchoReconciled re-reconciles the agent's other awaiting records)",
  restore: "index.eager-app-DSuGVQNC.js@1619685 (status zl, isUndelivered, no ACK timer for awaiting records)",
  overlayMarkFailed: "index.eager-app-DSuGVQNC.js@1574983 (markOptimisticFailed accepts pending or accepted)",
  overlayMarkUndelivered: "index.eager-app-DSuGVQNC.js@1575433 (markOptimisticUndelivered: unless failed → status accepted, isUndelivered)",
  sendStateMap: "index.eager-app-DSuGVQNC.js@403790 (accepted && isActionOwner && isUndelivered → entry state)",
  rowAggregate: "index-wlkGG389.js@1480865 (any accepted entry with isUndelivered → row isUndelivered)",
  footer: "index-wlkGG389.js@1482004 (_K: owned failed first; user role → isUndelivered ? SK : sent-while-offline)",
  component: "index-wlkGG389.js@1478393 (SK: div nLe role=status > span sLe > qq3pY2)",
  copyEn: "index.eager-app-DSuGVQNC.js@70698 (\"qq3pY2\":[\"Not delivered yet\"])",
  copyZh: "chunk-chat-oYCOIqHR.js@25677 (\"qq3pY2\":[\"尚未送达\"])",
});

const FOOTER_SOURCE =
  "const RSendUndeliveredEmpty=new Set;let RSendUndeliveredIds=RSendUndeliveredEmpty;const RSendUndeliveredByAgent=new Map,RSendUndeliveredListeners=new Set;" +
  "function RSendUndeliveredPublish(a,ids){const prev=RSendUndeliveredByAgent.get(a);if(ids.length===0){if(prev==null)return;RSendUndeliveredByAgent.delete(a)}else{if(prev!=null&&prev.length===ids.length&&prev.every((x,i)=>x===ids[i]))return;RSendUndeliveredByAgent.set(a,ids)}const next=new Set;for(const v of RSendUndeliveredByAgent.values())for(const x of v)next.add(x);RSendUndeliveredIds=next.size===0?RSendUndeliveredEmpty:next;for(const l of[...RSendUndeliveredListeners])l()}" +
  "function RSendUndeliveredSubscribe(l){RSendUndeliveredListeners.add(l);return()=>{RSendUndeliveredListeners.delete(l)}}" +
  "function RSendUndeliveredSnapshot(){return RSendUndeliveredIds}" +
  'function RSendUndeliveredRowHas(ids,row){if(ids.size===0||row==null)return!1;switch(row.kind){case"entry":return ids.has(row.entry.id);case"attachment-group":case"agent-comm-group":case"routine-event-group":return row.entries.some(x=>ids.has(x.id));default:return!1}}' +
  "function RSendUndeliveredFooter({row,children}){const ids=S.useSyncExternalStore(RSendUndeliveredSubscribe,RSendUndeliveredSnapshot,RSendUndeliveredSnapshot);" +
  'return RSendUndeliveredRowHas(ids,row)?p.jsx("div",{className:' +
  JSON.stringify(UNDELIVERED_ROW_CLASSES.join(" ")) +
  ',role:"status",children:p.jsx("span",{className:' +
  JSON.stringify(UNDELIVERED_TEXT_CLASSES.join(" ")) +
  ",children:RLocT(" +
  JSON.stringify(UNDELIVERED_COPY.en) +
  "," +
  JSON.stringify(UNDELIVERED_COPY.zh) +
  ")})}):children}";

// [role, before, after]. Every anchor must occur exactly once in the pinned chunk.
export const UNDELIVERED_TRANSFORMS = Object.freeze([
  [
    "journal-parser-keeps-awaiting-flag",
    ",...t.failedAtMs===void 0?{}:{failedAtMs:t.failedAtMs}}}function vHn(",
    ',...t.failedAtMs===void 0?{}:{failedAtMs:t.failedAtMs},...t.awaitingHostDecision===!0&&t.phase==="accepted-awaiting-echo"&&t.failedAtMs===void 0?{awaitingHostDecision:!0}:{}}}function vHn(',
  ],
  [
    "expiry-predicate-awaiting",
    'function THn(n,e){return n.phase!=="queued"&&n.failedAtMs==null&&e-(n.firstFlushAtMs??n.createdAtMs)>Upt}',
    'function THn(n,e){return n.phase!=="queued"&&n.failedAtMs==null&&(n.awaitingHostDecision===!0||e-(n.firstFlushAtMs??n.createdAtMs)>Upt)}',
  ],
  [
    "overlay-status-awaiting-accepted",
    'function fKe(n){return n.failedAtMs!=null?"failed":n.phase==="queued"?"queued":"pending"}',
    'function fKe(n){return n.failedAtMs!=null?"failed":n.awaitingHostDecision===!0?"accepted":n.phase==="queued"?"queued":"pending"}',
  ],
  [
    "expiry-decision-undelivered-while-down",
    'ne=oe=>THn(oe,r())?n.isTransportDown?.()===!0?(f.add(oe.nonce),"parked"):(Ae(oe),"failed"):"parked",',
    'RUndel=(oe,ve)=>(s.markOptimisticUndelivered({agentId:oe.agentId,nonce:oe.nonce}),ve),ne=oe=>THn(oe,r())?n.isTransportDown?.()===!0?oe.awaitingHostDecision===!0?RUndel(oe,"parked"):(f.add(oe.nonce),"parked"):(Ae(oe),"failed"):"parked",',
  ],
  [
    "reconcile-prior-found-without-echo",
    'if(je==="found"&&Me!=="rejected")return Ve.phase!=="accepted-awaiting-echo"&&(H(Ve,"accepted-awaiting-echo"),_()),Le!=null&&(s.confirmOptimistic({agentId:Ve.agentId,nonce:oe}),s.refresh(Ve.agentId)),"retired"}',
    'if(je==="found"&&Me!=="rejected")return Ve.awaitingHostDecision===!0&&Le==null?RUndel(Ve,"retired"):(Ve.phase!=="accepted-awaiting-echo"&&(H(Ve,"accepted-awaiting-echo"),_()),Le!=null&&(s.confirmOptimistic({agentId:Ve.agentId,nonce:oe}),s.refresh(Ve.agentId)),"retired")}',
  ],
  [
    "reconcile-own-awaiting-branch",
    'if(Te!=null)return Te.code===h2&&!de&&(qe.phase==="prepared"||qe.phase==="queued")?await se(qe,ve):ne(qe);',
    'if(qe.awaitingHostDecision===!0&&Te?.code!==h2){const RUg=Te==null&&Je==="found"&&Ie!=="rejected";if(RUg&&Ce==null)return RUndel(qe,"retired");if(!RUg&&(de||Te!=null||Je==="unknown-durability"))return RUndel(qe,"parked")}if(Te!=null)return Te.code===h2&&!de&&(qe.phase==="prepared"||qe.phase==="queued")?await se(qe,ve):ne(qe);',
  ],
  [
    "reconcile-rejected-awaiting-decides",
    'if(Je==="found"&&Ie==="rejected")return de?ne(qe):(W(',
    'if(Je==="found"&&Ie==="rejected")return de||qe.awaitingHostDecision===!0?ne(qe):(W(',
  ],
  [
    "ack-expiry-accepted-awaits-host",
    "ae(ve,r()),_();return}Ae(ve)},Ae=oe=>{",
    'ae(ve,r()),_();return}if(ve.phase==="accepted-awaiting-echo"){R({...ve,awaitingHostDecision:!0}),_(),Z(oe,x);return}Ae(ve)},Ae=oe=>{',
  ],
  [
    "resend-strips-awaiting-flag",
    "{failedAtMs:Ie,firstFlushAtMs:qe,...we}=ye",
    "{failedAtMs:Ie,firstFlushAtMs:qe,awaitingHostDecision:RUa,...we}=ye",
  ],
  [
    "echo-reconciles-awaiting-siblings",
    "noteEchoReconciled:({agentId:oe,nonce:ve,echoedNonce:ge})=>{if(N)return;const ye=c.get(ve);ye==null||ye.agentId!==oe||V(ye,ge)}",
    "noteEchoReconciled:({agentId:oe,nonce:ve,echoedNonce:ge})=>{if(N)return;const ye=c.get(ve);if(!(ye==null||ye.agentId!==oe)){V(ye,ge);for(const RUe of c.values())RUe.agentId===oe&&RUe.awaitingHostDecision===!0&&RUe.failedAtMs==null&&Z(RUe.nonce,x)}}",
  ],
  [
    "restore-awaiting-undelivered",
    'status:fKe(ue),...ue.queuedAtMs==null?{}:{queuedAtMs:ue.queuedAtMs}}),ue.failedAtMs==null&&ue.phase!=="queued"&&(h.set(',
    'status:fKe(ue),...ue.queuedAtMs==null?{}:{queuedAtMs:ue.queuedAtMs},...ue.awaitingHostDecision===!0?{isUndelivered:!0}:{}}),ue.failedAtMs==null&&ue.phase!=="queued"&&ue.awaitingHostDecision!==!0&&(h.set(',
  ],
  [
    "overlay-mark-failed-and-undelivered",
    'le==null||le.nonce!==Z||le.status!=="pending"||(X.overlay.set(se,{...le,status:"failed"}),O(X))},removeOptimistic:',
    'le==null||le.nonce!==Z||le.status!=="pending"&&le.status!=="accepted"||(X.overlay.set(se,{...le,status:"failed"}),O(X))},markOptimisticUndelivered:({agentId:j,nonce:Z})=>{if(d||j.length===0)return;const X=t.get(j);if(X==null)return;const se=Pu(Z),le=X.overlay.get(se);le==null||le.nonce!==Z||le.status==="failed"||(X.overlay.set(se,{...le,status:"accepted",isUndelivered:!0}),O(X))},removeOptimistic:',
  ],
  [
    "snapshot-collects-undelivered-ids",
    "Ae.has(Pu(oe.clientNonce))))}let ce=J(ae,j.overlay),xe=P1",
    "Ae.has(Pu(oe.clientNonce))))}const RUndIds=[];let ce=J(ae,j.overlay),xe=P1",
  ],
  [
    "snapshot-marks-undelivered-action-owner",
    'ue.queuedAtMs!=null&&ue.status!=="queued"&&de!=null&&Ne.set(de.id,ue.queuedAtMs)}',
    'ue.queuedAtMs!=null&&ue.status!=="queued"&&de!=null&&Ne.set(de.id,ue.queuedAtMs),ue.status==="accepted"&&ue.isUndelivered===!0&&de!=null&&RUndIds.push(de.id)}',
  ],
  [
    "snapshot-publishes-undelivered-ids",
    "ye.length>0&&(be=new Set(ye))}j.snapshots.set({entries:ce,pendingEntryIds:xe,",
    "ye.length>0&&(be=new Set(ye))}RSendUndeliveredPublish(j.agentId,RUndIds);j.snapshots.set({entries:ce,pendingEntryIds:xe,",
  ],
  [
    "user-row-footer-undelivered",
    'Ft.role==="user"?On=p.jsx(UMn,{composedAtMs:ss,showQueuedFallback:h&&_n!=null})',
    'Ft.role==="user"?On=p.jsx(RSendUndeliveredFooter,{row:Yt,children:p.jsx(UMn,{composedAtMs:ss,showQueuedFallback:h&&_n!=null})})',
  ],
  ["footer-component", "function HMn(n){const e=he.c(11),", FOOTER_SOURCE + "function HMn(n){const e=he.c(11),"],
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalUndeliveredSend(source, { skip = [] } = {}) {
  if (source.includes(MARKER)) throw new Error("Undelivered-send renderer patch was already applied.");
  let patched = source;
  for (const [role, before, after] of UNDELIVERED_TRANSFORMS) {
    if (skip.includes(role)) continue;
    patched = replaceExactlyOnce(patched, before, after, `undelivered-send ${role}`);
  }
  return patched;
}

export function assertUndeliveredStylesResolve(cssText) {
  const missing = [...UNDELIVERED_ROW_CLASSES, ...UNDELIVERED_TEXT_CLASSES].filter(name => !cssText.includes(`.${name}`));
  if (missing.length > 0) {
    throw new Error(`Undelivered-send row classes are missing from the pinned stylesheet: ${missing.join(", ")}`);
  }
  return UNDELIVERED_ROW_CLASSES.length + UNDELIVERED_TEXT_CLASSES.length;
}

const sha = text => createHash("sha256").update(text).digest("hex");

export async function applyOriginalRendererUndeliveredSend({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const names = await readdir(assetsRoot);
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(UNDELIVERED_TRANSFORMS[0][1])) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk for the undelivered-send patch, found ${candidates.length}.`);
  }
  let checked = 0;
  for (const name of names) {
    if (name.endsWith(".css")) checked += assertUndeliveredStylesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checked === 0) throw new Error("Undelivered-send patch found no renderer stylesheet to validate against.");
  const [candidate] = candidates;
  const patched = patchOriginalUndeliveredSend(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-undelivered-send",
    chunks: [
      {
        role: "send-journal+transcript-overlay+transcript-row",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: sha(candidate.source) },
        patched: { bytes: Buffer.byteLength(patched), sha256: sha(patched) },
        validatedStyleClasses: [...UNDELIVERED_ROW_CLASSES, ...UNDELIVERED_TEXT_CLASSES],
      },
    ],
    features: ["accepted-send-awaits-host-decision", "not-delivered-yet-status-row"],
    transformations: UNDELIVERED_TRANSFORMS.map(([role]) => role),
    copy: UNDELIVERED_COPY,
    evidence: EVIDENCE,
    knownDeltas: [
      "ACK-expiry persists the awaiting flag once via the journal's persist, not through 0.71.2's failed-state retry helper.",
      "Undelivered entry ids reach the row footer through a module-level external store instead of 0.71.2's unified send-state map prop.",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-undelivered-send-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
