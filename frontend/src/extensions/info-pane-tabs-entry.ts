import {
  DEFAULT_TAB,
  INFO_PANE_TABS,
  STYLE_ID,
  TABBAR_ID,
  TAB_ATTR,
  applyTab,
  isBotContext,
  isTabId,
  paneRoot,
  readStoredTab,
  writeStoredTab,
  type InfoPaneTabId,
} from "./info-pane-tabs-core.js";
const BAR_CSS = [
  '[class*="sand-info-pane__inner"] [data-r-tabs-hidden="1"][hidden]{display:none!important;}',
  "#" + TABBAR_ID + "{position:sticky;top:0;z-index:30;display:flex;gap:4px;padding:8px 16px;overflow-x:auto;background:var(--sand-bg-elevated);}",
  "#" + TABBAR_ID + " [role=tab]{appearance:none;border:0;border-radius:9999px;background:transparent;color:var(--sand-text-secondary);font:inherit;white-space:nowrap;cursor:pointer;padding:4px 8px;}",
  "#" + TABBAR_ID + " [role=tab][aria-selected=true]{background:var(--sand-fill-secondary);color:var(--sand-text-primary);}",
  "#" + TABBAR_ID + " [role=tab]:hover{background:var(--sand-fill-secondary);}",
  "#" + TABBAR_ID + " [role=tab]:focus-visible{outline:2px solid var(--sand-text-secondary);outline-offset:1px;}",
].join("\n");
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BAR_CSS;
  doc.head.append(style);
}
function currentTab(pane: Element): InfoPaneTabId {
  const raw = pane.getAttribute(TAB_ATTR) ?? "";
  return isTabId(raw) ? raw : DEFAULT_TAB;
}
function storageOf(): Storage | null {
  try {
    const win = window as unknown as { localStorage?: Storage };
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}
function scrollTop(pane: Element): void {
  try {
    const bar = pane.querySelector("#" + TABBAR_ID);
    if (bar != null && typeof bar.scrollIntoView === "function") bar.scrollIntoView({ block: "start" });
  } catch {
    return;
  }
}
function paintBar(pane: Element, tab: InfoPaneTabId): void {
  const bar = pane.querySelector("#" + TABBAR_ID);
  if (bar == null) return;
  for (const btn of Array.from(bar.querySelectorAll("[role=tab]"))) {
    const active = btn.getAttribute("data-r-tab") === tab;
    btn.setAttribute("aria-selected", active ? "true" : "false");
    (btn as HTMLElement).tabIndex = active ? 0 : -1;
  }
}
function setTab(pane: Element, tab: InfoPaneTabId, isUserAction = true): void {
  applyTab(pane, tab);
  activeTab = currentTab(pane);
  paintBar(pane, activeTab);
  writeStoredTab(storageOf(), activeTab);
  if (isUserAction) scrollTop(pane);
}
function onKey(btn: HTMLElement, pane: Element, tab: InfoPaneTabId, event: KeyboardEvent): void {
  const order = INFO_PANE_TABS.map((t) => t.id);
  const at = order.indexOf(tab);
  let next: InfoPaneTabId | null = null;
  if (event.key === "ArrowRight") next = order[(at + 1) % order.length] ?? null;
  if (event.key === "ArrowLeft") next = order[(at + order.length - 1) % order.length] ?? null;
  if (event.key === "Home") next = order[0] ?? null;
  if (event.key === "End") next = order[order.length - 1] ?? null;
  if (next == null) return;
  event.preventDefault();
  setTab(pane, next);
  const bar = pane.querySelector("#" + TABBAR_ID);
  const target = bar?.querySelector('[data-r-tab="' + currentTab(pane) + '"]') as HTMLElement | null;
  target?.focus();
  void btn;
}
function ensureBar(pane: Element, doc: Document): void {
  let bar = pane.querySelector("#" + TABBAR_ID);
  if (bar == null) {
    bar = doc.createElement("div");
    bar.id = TABBAR_ID;
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Bot \u8be6\u60c5");
    for (const def of INFO_PANE_TABS) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("data-r-tab", def.id);
      btn.textContent = def.label;
      btn.addEventListener("click", () => setTab(pane, def.id));
      btn.addEventListener("keydown", (event) => onKey(btn, pane, def.id, event));
      bar.append(btn);
    }
    pane.prepend(bar);
  }
  paintBar(pane, currentTab(pane));
}
let activeTab: InfoPaneTabId | null = null;
function sync(): void {
  const doc = document;
  const pane = paneRoot(doc);
  if (pane == null) return;
  if (!isBotContext(pane)) {
    pane.querySelector("#" + TABBAR_ID)?.remove();
    return;
  }
  ensureStyle(doc);
  ensureBar(pane, doc);
  if (activeTab == null) activeTab = readStoredTab(storageOf());
  setTab(pane, activeTab, false);
  activeTab = currentTab(pane);
}
let scheduled = false;
function scheduleSync(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    try {
      sync();
    } catch {
      return;
    }
  }, 300);
}
const observer = new MutationObserver(scheduleSync);
observer.observe(document.body, { childList: true, subtree: true });
scheduleSync();
window.addEventListener('grok-node-info-pane-tab', event => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || !isTabId(event.detail)) return;
  const pane = paneRoot(document);
  if (pane != null && isBotContext(pane)) setTab(pane, event.detail);
});
const testHooks = globalThis as unknown as { __sandInfoPaneTabsSync?: () => void; __sandInfoPaneTabsStop?: () => void; __sandInfoPaneTabsSet?: (tab: InfoPaneTabId) => void };
testHooks.__sandInfoPaneTabsSync = sync;
testHooks.__sandInfoPaneTabsStop = () => { observer.disconnect(); };
testHooks.__sandInfoPaneTabsSet = (tab: InfoPaneTabId) => {
  activeTab = tab;
  sync();
};
