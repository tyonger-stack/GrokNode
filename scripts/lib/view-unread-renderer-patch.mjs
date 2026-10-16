// Grok Bot 0.71.2 View → "View Unread" sidebar filter, ported onto the checksum-pinned
// 0.18 renderer chunk (index-UbX-y3il.js).
//
// Evidence (byte-sourced 2026-10-16 from rea-grokbot-0712):
//
//   * Menu label id `5G1/yr` = "View Unread" (main-core.cjs); zh-CN locales = "查看未读".
//   * Native menu (main-app.cjs ~@1709708): checkbox after Reload separator,
//     `checked:e.isUnreadFilterChecked()`, `click:s=>e.emitUnreadFilterMenuClicked(s.checked)`.
//   * Emit `unread-filter-menu-clicked` {isChecked}; RPC `setUnreadFilterMenuChecked`;
//     `applicationMenu.setUnreadFilterChecked` reinstalls the menu.
//   * Renderer eager-app: `"unread-filter-menu-clicked":({isChecked:z})=>x.setSidebarUnreadOnly(z)`.
//   * Filter (eager-app `LGe`, imported as `jge` into index-wlkGG389.js @2149439):
//       visibleAgents.filter(s => s.hasUnread || s.id === currentAgentId || exceptionSet.has(s.id))
//     with empty hiddenAgents while filtering. 0.18 has no sand_tasks exception set, so this
//     port keeps hasUnread || currentAgentId only (evidence-backed subset).
//
// 0.18 anchors:
//   * Roster split `lmt` / `bUe` (@2617477) already projects isHiddenFromSidebar.
//   * Sidebar hook `sFn` (@5503007) feeds `lmt(H)` into the visible list with currentAgentId `e`.
//   * Event map `Ie` next to open-about / open-feedback (@5728535).
//   * Desktop event bridge next to onOpenAbout (@5762543).
//
// Not invented: no new sidebar chrome, no persistence of isSidebarUnreadOnly (0.71 persists via
// uiState; 0.18 has no matching store slot — in-memory + menu sync only).

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const LMT_ANCHOR =
  "function bUe(n){return n.isHiddenFromSidebar===!0}function lmt(n){const e=n.filter(bUe);return e.length===0?{visibleAgents:n,hiddenAgents:e}:{visibleAgents:n.filter(t=>!bUe(t)),hiddenAgents:e}}";

const SFN_MEMO_BEFORE =
  "const H=_On(n,r),{visibleAgents:G,hiddenAgents:Y}=S.useMemo(()=>lmt(H),[H])";
const SFN_MEMO_AFTER =
  "const RUnreadOnly=S.useSyncExternalStore(RUnreadOnlySubscribe,RUnreadOnlyGet,RUnreadOnlyGet),H=_On(n,r),{visibleAgents:G,hiddenAgents:Y}=S.useMemo(()=>RUnreadFilterRoster(lmt(H),e),[H,e,RUnreadOnly])";

const IE_BEFORE =
  'Ie={"window-state":Be=>c.ingestWindowState(Be),"deep-link":Be=>o.ingest(Be),"open-feedback":()=>h.ingestOpenIntent(),"open-about":()=>y.ingestOpenIntent(),"focus-agent":Be=>c.ingestFocusAgent(Be)';
const IE_AFTER =
  'Ie={"window-state":Be=>c.ingestWindowState(Be),"deep-link":Be=>o.ingest(Be),"open-feedback":()=>h.ingestOpenIntent(),"open-about":()=>y.ingestOpenIntent(),"unread-filter-menu-clicked":({isChecked:Be})=>RUnreadOnlySet(Be===!0),"focus-agent":Be=>c.ingestFocusAgent(Be)';

const BRIDGE_BEFORE =
  '"open-feedback":(n,e)=>n.onOpenFeedback(()=>e({})),"open-about":(n,e)=>n.onOpenAbout(()=>e({})),"zoom-factor-changed"';
const BRIDGE_AFTER =
  '"open-feedback":(n,e)=>n.onOpenFeedback(()=>e({})),"open-about":(n,e)=>n.onOpenAbout(()=>e({})),"unread-filter-menu-clicked":(n,e)=>(RUnreadFilterBindDesktop(n),n.onUnreadFilterMenuClicked(t=>{typeof t?.isChecked=="boolean"&&e({isChecked:t.isChecked})})),"zoom-factor-changed"';

// Injected after lmt. Uses S (React) already at module scope. No backticks.
const INJECTED_AFTER_LMT =
  "const RUnreadEmptyHidden=[];" +
  "const RUnreadOnlyStore={value:!1,listeners:new Set};" +
  "let RUnreadFilterDesktop=null;" +
  "function RUnreadFilterBindDesktop(n){RUnreadFilterDesktop=n}" +
  "function RUnreadOnlyGet(){return RUnreadOnlyStore.value}" +
  "function RUnreadOnlySubscribe(n){return RUnreadOnlyStore.listeners.add(n),()=>RUnreadOnlyStore.listeners.delete(n)}" +
  "function RUnreadOnlySet(n){if(RUnreadOnlyStore.value===n)return;RUnreadOnlyStore.value=n;for(const e of RUnreadOnlyStore.listeners)e();try{RUnreadFilterDesktop?.setUnreadFilterMenuChecked?.({isChecked:n})}catch{}}" +
  "function RUnreadFilterRoster(n,e){return RUnreadOnlyStore.value?{visibleAgents:n.visibleAgents.filter(t=>t.hasUnread===!0||t.id===e),hiddenAgents:RUnreadEmptyHidden}:n}";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalViewUnread(source) {
  let next = source;
  next = replaceExactlyOnce(next, LMT_ANCHOR, LMT_ANCHOR + INJECTED_AFTER_LMT, "lmt+unread-store");
  next = replaceExactlyOnce(next, SFN_MEMO_BEFORE, SFN_MEMO_AFTER, "sFn unread roster memo");
  next = replaceExactlyOnce(next, IE_BEFORE, IE_AFTER, "Ie unread-filter-menu-clicked");
  next = replaceExactlyOnce(next, BRIDGE_BEFORE, BRIDGE_AFTER, "desktop unread-filter bridge");
  return next;
}

export async function applyOriginalRendererViewUnread({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(LMT_ANCHOR) && source.includes(SFN_MEMO_BEFORE)) {
      candidates.push({ name, target, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one original renderer chunk for the view-unread patch, found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  const patched = patchOriginalViewUnread(candidate.source);
  for (const [needle, what] of [
    ["function RUnreadFilterRoster(", "unread roster filter"],
    ["RUnreadOnlySubscribe", "unread store subscribe"],
    ['"unread-filter-menu-clicked":({isChecked:Be})=>RUnreadOnlySet', "Ie menu event"],
    ["onUnreadFilterMenuClicked", "desktop event bridge"],
    [SFN_MEMO_AFTER, "sFn filtered memo"],
  ]) {
    if (!patched.includes(needle)) {
      throw new Error(`View-unread patch lost its ${what}.`);
    }
  }
  if (patched.includes(SFN_MEMO_BEFORE)) {
    throw new Error("View-unread patch left the unfiltered sFn roster memo in place.");
  }
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-view-unread",
    alignedTo: "0.71.2",
    evidence: {
      menuLabelId: "5G1/yr",
      menuLabelEn: "View Unread",
      menuLabelZhCN: "查看未读",
      filter: "visibleAgents.filter(hasUnread || id === currentAgentId); hiddenAgents=[] while on",
      omitted: ["sand_tasks exception Set", "uiState persistence of isSidebarUnreadOnly"],
    },
    chunks: [
      {
        role: "sidebar-roster-filter",
        path: `dist/renderer/assets/${candidate.name}`,
        original: {
          bytes: Buffer.byteLength(candidate.source),
          sha256: createHash("sha256").update(candidate.source).digest("hex"),
        },
        patched: {
          bytes: Buffer.byteLength(patched),
          sha256: createHash("sha256").update(patched).digest("hex"),
        },
      },
    ],
    features: ["view-unread-menu-sidebar-filter"],
    transformations: [
      "inject-unread-only-store",
      "filter-sFn-visibleAgents-by-hasUnread",
      "subscribe-unread-filter-menu-clicked",
      "mirror-setUnreadFilterMenuChecked",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-view-unread-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
