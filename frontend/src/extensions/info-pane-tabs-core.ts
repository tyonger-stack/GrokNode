export type InfoPaneTabId = "details" | "library" | "computer" | "other";
export interface InfoPaneTabDef {
  readonly id: InfoPaneTabId;
  readonly label: string;
}
export const INFO_PANE_TABS: readonly InfoPaneTabDef[] = [
  { id: "details", label: "详情" },
  { id: "library", label: "资料库" },
  { id: "computer", label: "电脑" },
  { id: "other", label: "其他" },
];
export const DEFAULT_TAB: InfoPaneTabId = "details";
export function isTabId(value: string): value is InfoPaneTabId {
  return value === "details" || value === "library" || value === "computer" || value === "other";
}
export const PANE_SELECTOR = '[class*="sand-info-pane__inner"]';
export const ROUTINE_LIST_SELECTOR = "ul.sand-routine__list, .sand-routine__empty";
export const LIBRARY_SECTION_SELECTOR = ".sand-agent-library";
export const COMPUTER_POOL_SELECTOR = ".sand-box-vnc-pool";
export const OTHER_CARD_SELECTOR = ".sand-agent-settings__card";
export const OTHER_MODEL_SELECTOR = "[data-r-agent-model]";
export const OTHER_DESC_SELECTOR = '[aria-label="Agent description"]';
export const OTHER_FORM_SELECTOR = ".sand-agent-settings";
export const HERO_SELECTOR = "[data-r-info-pane-hero]";
export const TABBAR_ID = "sand-info-pane-tabs";
export const TAB_ATTR = "data-r-tabs-tab";
export const HIDE_MARK = "data-r-tabs-hidden";
export const STYLE_ID = "sand-info-pane-tabs-style";
export const STORAGE_KEY = "sand.infoPaneTab";
function asElement(node: Node | null): Element | null {
  return node != null && node.nodeType === 1 ? (node as Element) : null;
}
export function paneRoot(doc: Document | ParentNode): Element | null {
  const root = doc as ParentNode;
  const kind = (root as Node).nodeType;
  if (kind === 1) {
    const el = root as Element;
    if (typeof el.matches === "function" && el.matches(PANE_SELECTOR)) return el;
  }
  return root.querySelector(PANE_SELECTOR);
}
export function topPaneChild(pane: Element, node: Element | null): Element | null {
  let current = node;
  while (current != null && current !== pane) {
    const parent = asElement(current.parentNode);
    if (parent === pane) return current;
    if (parent == null) return null;
    current = parent;
  }
  return null;
}
export function isBotContext(pane: Element): boolean {
  return (
    pane.querySelector(ROUTINE_LIST_SELECTOR) != null ||
    pane.querySelector(LIBRARY_SECTION_SELECTOR) != null ||
    pane.querySelector(COMPUTER_POOL_SELECTOR) != null
  );
}
export interface TabNodes {
  readonly library: Element | null;
  readonly pool: Element | null;
  readonly cards: Element[];
  readonly desc: Element | null;
  readonly settings: Element | null;
}
export function collectTabNodes(pane: Element): TabNodes {
  return {
    library: pane.querySelector(LIBRARY_SECTION_SELECTOR),
    pool: pane.querySelector(COMPUTER_POOL_SELECTOR),
    cards: Array.from(pane.querySelectorAll(OTHER_CARD_SELECTOR)),
    desc: pane.querySelector(OTHER_DESC_SELECTOR),
    settings: pane.querySelector(OTHER_FORM_SELECTOR),
  };
}
function markHide(el: Element): void {
  if ((el as HTMLElement).hidden) return;
  (el as HTMLElement).hidden = true;
  el.setAttribute(HIDE_MARK, "1");
}
function markShow(el: Element): void {
  if (el.getAttribute(HIDE_MARK) !== "1") return;
  (el as HTMLElement).hidden = false;
  el.removeAttribute(HIDE_MARK);
}
function resetHidden(pane: Element): void {
  for (const el of Array.from(pane.querySelectorAll("[" + HIDE_MARK + "]"))) markShow(el);
}
function keepOnly(root: Element, targets: readonly Element[]): void {
  for (const child of Array.from(root.children)) {
    if (child.id === TABBAR_ID || child.matches('.sand-info-pane__top') || child.matches(HERO_SELECTOR)) continue;
    if (targets.some(target => target === child || target.contains(child))) continue;
    if (targets.some(target => child.contains(target))) keepOnly(child, targets);
    else markHide(child);
  }
}
function computerPart(pane: Element, pool: Element | null): Element | null {
  if (pool == null) return null;
  return pool.closest('[data-r-info-pane-computer]') ?? pool.closest('.sand-computer-preview') ?? topPaneChild(pane, pool);
}
function fieldParts(pane: Element, desc: Element | null): Element[] {
  if (desc == null) return [];
  let editor = desc;
  while (editor.parentElement != null && editor.parentElement !== pane &&
    editor.parentElement.children.length === 1) editor = editor.parentElement;
  const heading = editor.previousElementSibling;
  return heading == null ? [editor] : [heading, editor];
}
export function applyTab(pane: Element, tab: InfoPaneTabId): void {
  const nodes = collectTabNodes(pane);
  const overview = pane.querySelector('[data-r-info-pane-overview]') ?? pane;
  if (tab === "library" && nodes.library == null || tab === "computer" && nodes.pool == null ||
      tab === "other" && nodes.settings == null && nodes.cards.length === 0 && nodes.desc == null) return;
  resetHidden(pane);
  const description = fieldParts(pane, nodes.desc);
  if (tab === "details") {
    if (nodes.library != null) markHide(nodes.library);
    const comp = computerPart(pane, nodes.pool);
    if (comp != null) markHide(comp);
    if (nodes.settings != null) markHide(nodes.settings);
    for (const card of nodes.cards) markHide(card);
    for (const part of description) markHide(part);
    pane.setAttribute(TAB_ATTR, tab);
    return;
  }
  if (tab === "library") {
    if (nodes.library == null) return;
    keepOnly(overview, [nodes.library]);
    pane.setAttribute(TAB_ATTR, tab);
    return;
  }
  if (tab === "computer") {
    if (nodes.pool == null) return;
    keepOnly(overview, [computerPart(pane, nodes.pool) ?? nodes.pool]);
    pane.setAttribute(TAB_ATTR, tab);
    return;
  }
  const keep: Element[] = [];
  if (nodes.settings != null) keep.push(nodes.settings);
  for (const card of nodes.cards) keep.push(card);
  for (const part of description) keep.push(part);
  if (keep.length === 0) return;
  keepOnly(overview, keep);
  if (nodes.settings != null) {
    for (const label of ["Agent name", "Agent title"]) {
      const field = nodes.settings.querySelector('[aria-label="' + label + '"]');
      for (const part of fieldParts(pane, field)) markHide(part);
    }
  }
  pane.setAttribute(TAB_ATTR, tab);
}
export function readStoredTab(storage: Storage | null): InfoPaneTabId {
  try {
    const raw = storage != null ? storage.getItem(STORAGE_KEY) : null;
    if (raw != null && isTabId(raw)) return raw;
  } catch {
    return DEFAULT_TAB;
  }
  return DEFAULT_TAB;
}
export function writeStoredTab(storage: Storage | null, tab: InfoPaneTabId): void {
  try {
    if (storage != null) storage.setItem(STORAGE_KEY, tab);
  } catch {
    return;
  }
}
