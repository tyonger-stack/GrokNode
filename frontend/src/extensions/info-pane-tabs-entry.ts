import {
  DEFAULT_TAB,
  INFO_PANE_TABS,
  HERO_SELECTOR,
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
  "#" + TABBAR_ID + "{--r-tabs-chrome:var(--sand-bg-chrome,var(--sand-bg-base,#0b0d0b));position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:center;gap:2px;margin-inline:-16px;padding:4px 16px 10px;background-color:var(--r-tabs-chrome);}",
  "#" + TABBAR_ID + "::after{content:\"\";position:absolute;inset-inline:0;top:100%;height:12px;pointer-events:none;background-image:linear-gradient(to bottom,var(--r-tabs-chrome),transparent);}",
  "#" + TABBAR_ID + " [role=tab]{appearance:none;-webkit-appearance:none;display:flex;align-items:center;box-sizing:border-box;padding:4px 8px;margin:0;border:0;border-radius:9999px;background-color:transparent;color:var(--sand-text-secondary,#8a8f87);font-family:inherit;font-size:13px;line-height:18px;font-weight:400;cursor:pointer;white-space:nowrap;}",
  "#" + TABBAR_ID + " [role=tab][aria-selected=true]{background-color:var(--sand-bg-secondary,var(--sand-fill-secondary,#77777717));color:var(--sand-text-primary,#eef3e7);}",
  "#" + TABBAR_ID + " [role=tab]:hover:not([aria-selected=true]){background-color:var(--sand-bg-secondary-hover,var(--sand-fill-secondary-hover,#7777772b));}",
  "#" + TABBAR_ID + " [role=tab]:focus-visible{outline:2px solid var(--sand-text-secondary,#8a8f87);outline-offset:1px;}",
  '[data-r-info-pane-hero]{display:flex;flex-direction:column;align-items:center;gap:16px;padding:8px 16px 12px;}',
  '[data-r-info-pane-hero] [data-r-hero-text]{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;min-width:0;}',
  '[data-r-info-pane-hero] input{width:auto!important;max-width:100%;field-sizing:content;text-align:center!important;font-size:16px!important;line-height:22px!important;font-weight:500!important;padding:2px 10px!important;border:0.5px solid transparent!important;border-radius:8px!important;background:transparent!important;color:var(--sand-text-primary,#eef3e7)!important;}',
  '[data-r-info-pane-hero] input:hover{background:var(--sand-bg-secondary-hover,var(--sand-fill-secondary-hover,#7777772b))!important;}',
  '[data-r-info-pane-hero] input:focus{border-color:var(--sand-border-focus-primary,#1e86fc)!important;}',
  '[data-r-info-pane-hero] [aria-label="Agent title"]{font-size:12px!important;line-height:16px!important;font-weight:400!important;color:var(--sand-text-secondary,#8a8f87)!important;}',
  // Official zp empty title uses Ga.placeholder → sand-169k319 (tertiary). Uwe shows
  // that state via the input placeholder, so style ::placeholder to match.
  '[data-r-info-pane-hero] [aria-label="Agent title"]::placeholder{color:var(--sand-text-tertiary,#6b7168)!important;opacity:1!important;}',
  '[class*="sand-info-pane__inner"][data-r-tabs-tab="other"] .sand-agent-settings>div:first-child>div:first-child{display:none;}',
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
  }
  const hero = pane.querySelector(HERO_SELECTOR);
  if (hero != null) {
    if (bar.previousElementSibling !== hero) hero.after(bar);
  } else if (bar.parentElement !== pane || pane.firstElementChild !== bar) {
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
function mutationTouchesPane(records: MutationRecord[], pane: Element): boolean {
  return records.some((record) =>
    pane.contains(record.target) ||
    Array.from(record.addedNodes).some((node) => node.nodeType === 1 && (node as Element).contains(pane)),
  );
}
function scheduleSync(records?: MutationRecord[]): void {
  if (records != null) {
    const pane = paneRoot(document);
    if (pane == null || !mutationTouchesPane(records, pane)) return;
  }
  try {
    sync();
  } catch {
    return;
  }
}
const observer = new MutationObserver(scheduleSync);
observer.observe(document.body, { childList: true, subtree: true });
scheduleSync();
window.addEventListener('grok-node-info-pane-tab', event => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || !isTabId(event.detail)) return;
  activeTab = event.detail;
  const pane = paneRoot(document);
  if (pane != null && isBotContext(pane)) setTab(pane, event.detail);
  else scheduleSync();
});
const testHooks = globalThis as unknown as { __sandInfoPaneTabsSync?: () => void; __sandInfoPaneTabsStop?: () => void; __sandInfoPaneTabsSet?: (tab: InfoPaneTabId) => void };
testHooks.__sandInfoPaneTabsSync = sync;
testHooks.__sandInfoPaneTabsStop = () => { observer.disconnect(); };
testHooks.__sandInfoPaneTabsSet = (tab: InfoPaneTabId) => {
  activeTab = tab;
  sync();
};
