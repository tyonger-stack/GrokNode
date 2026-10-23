import { compose, deriveEngagement, jGe, Jb, Yb, sS, Nk, surface, type Target, type Layout } from "./official.js";
import { officialFooterCss } from "./official-css.js";

const rowSelector = ".sand-footer-0753";
const accountSelector = ".sand-agents-sidebar__account > button";
const appsSelector = ".sand-agents-sidebar__plugins";

export const footerAdapterCss = officialFooterCss + `
.sand-footer-0753{display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0;padding:0 16px 16px;--sand-border-tertiary-translucent:color-mix(in srgb,var(--sand-text-primary) 7.84313725490196%,transparent);--sand-bg-hover:color-mix(in srgb,var(--sand-text-primary) 5.88235294117647%,transparent);--sand-border-focus-primary:#1e86fc;--sand-letter-spacing-base:0em;--sand-line-height-base:20px}
.sand-footer-0753 .sand-agents-sidebar__footer,.sand-footer-0753 .sand-agents-sidebar__account,.sand-footer-0753 .sand-agents-sidebar__plugins-entry{display:contents!important}
.sand-footer-0753 .sand-plugins-dock-upstream-label{display:none!important}
.sand-footer-0753 [data-sidebar-account-pill]>span:first-child,.sand-footer-0753 [data-sidebar-account-pill] .sand-kit-base-avatar{width:36px!important;height:36px!important;flex-shrink:0}
.sand-footer-0753 [data-sidebar-footer-action]{position:static!important;order:3}
.sand-shell[data-sidebar-collapsed] .sand-footer-0753{display:contents}
.sand-shell[data-sidebar-collapsed] .sand-footer-0753 .sand-agents-sidebar__footer,.sand-shell[data-sidebar-collapsed] .sand-footer-0753 .sand-agents-sidebar__account{display:flex!important}
`;

function flag(element: HTMLElement, name: string, value: boolean | string | undefined): void {
  if (value === undefined || value === false) element.removeAttribute(name);
  else element.setAttribute(name, String(value));
}

export function installFooterAdapter(doc: Document): {sync(): void; setLayout(value: Layout): void; dispose(): void} {
  let layout: Layout = "labeled";
  let pointer: Target = null;
  let focus: Target = null;
  let current: HTMLElement | null = null;
  const targets: Record<Exclude<Target, null>, HTMLElement | null> = {account:null,connect:null,update:null};
  const wired = new WeakSet<HTMLElement>();
  const originals = new WeakMap<HTMLElement, string>();
  const applied = new WeakMap<HTMLElement, string>();
  function track(target: Exclude<Target, null>, element: HTMLElement | null): void {
    if (targets[target] === element) return;
    if (pointer === target) pointer = null;
    if (focus === target) focus = null;
    targets[target] = element;
  }
  function classes(element: HTMLElement, value: string): void {
    if (!originals.has(element)) originals.set(element, element.className);
    const hooks = element.className.split(" ").filter(c => c.length > 0 && !/^sand-[a-z0-9]+$/.test(c));
    const next = [...new Set([...hooks, ...value.split(" ")])].join(" ");
    if (element.className !== next) element.className = next;
    applied.set(element, next);
  }
  function wire(element: HTMLElement, target: Exclude<Target, null>): void {
    if (wired.has(element)) return;
    wired.add(element);
    element.addEventListener("pointerenter", () => {pointer = jGe(pointer, target, true); sync();});
    element.addEventListener("pointerleave", () => {pointer = jGe(pointer, target, false); sync();});
    element.addEventListener("focusin", () => {
      focus = jGe(focus, target, target === "update" || element.matches(":focus-visible")); sync();
    });
    element.addEventListener("focusout", event => {
      if (target === "update" && event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      focus = jGe(focus, target, false); sync();
    });
  }
  function sync(): void {
    const row = doc.querySelector<HTMLElement>(rowSelector);
    if (row !== current) {pointer = null; focus = null; current = row;}
    if (row == null) return;
    const account = row.querySelector<HTMLButtonElement>(accountSelector);
    const apps = row.querySelector<HTMLButtonElement>(appsSelector);
    const update = account?.parentElement?.querySelector<HTMLElement>(":scope > span:has(button)") ?? null;
    track("account",account); track("connect",apps); track("update",update);
    if (doc.querySelector(".sand-shell[data-sidebar-collapsed]") != null) {
      pointer = null; focus = null;
      for (const element of row.querySelectorAll<HTMLElement>("*")) {
        const original = originals.get(element);
        if (original != null && element.className === applied.get(element)) element.className = original;
        for (const name of ["data-expanded", "data-name-at-rest", "data-sidebar-account-pill"]) element.removeAttribute(name);
      }
      return;
    }
    if (account == null || apps == null) return;
    const name = account.children.item(1);
    const accountAvailable = name instanceof HTMLElement && !!name.textContent?.trim();
    const state = deriveEngagement({pointer, focus, menuOpen: account.getAttribute("aria-expanded") === "true", accountAvailable, updateAvailable: update != null, layout});
    pointer = state.pointer; focus = state.focus;
    wire(account, "account"); wire(apps, "connect");
    if (update != null) {
      wire(update, "update"); flag(update, "data-sidebar-footer-action", true);
      classes(update, `sand-78zum5 sand-6s0dn4 sand-13a6bvl sand-2lah0s sand-euugli sand-16wom5 sand-4wkmsb sand-q8ykup sand-1554a8d ${state.engaged === "update" ? "sand-1iyjqo2" : "sand-1c4vz4f"}`);
    }
    flag(row, "data-sidebar-account", true);
    flag(row, "data-action-engaged", state.engaged === "update");
    classes(account, compose(accountAvailable ? Nk.accountPill : Nk.avatarButton, accountAvailable && (state.engaged === "account" || state.nameAtRest) && Nk.accountPillExpanded, sS.controlRing));
    flag(account, "data-sidebar-account-pill", accountAvailable);
    flag(account, "data-expanded", state.engaged === "account");
    flag(account, "data-name-at-rest", state.nameAtRest);
    if (name instanceof HTMLElement) {
      classes(name, compose(Nk.accountName, Jb.body1, Yb.medium));
      if (name.firstElementChild instanceof HTMLElement) classes(name.firstElementChild, compose(Jb.body1, Yb.medium));
    }
    const logos = apps.querySelector<HTMLElement>(".sand-plugins-dock-logos");
    const view = surface({layout: accountAvailable ? layout : "labeled", isCrowded: update != null, isEngaged: state.engaged === "connect", isYielding: state.engaged != null && state.engaged !== "connect", logoCount: logos?.querySelectorAll("img").length ?? 0});
    classes(apps, view.className);
    flag(apps, "data-sidebar-marketplace", true);
    for (const key of ["data-expanded", "data-folded", "data-icons-only", "data-yielding"] satisfies (keyof typeof view)[]) flag(apps, key, view[key]);
    const slots = [apps.querySelector<HTMLElement>(".sand-plugins-dock-icon"), apps.querySelector<HTMLElement>(".sand-plugins-dock-label"), logos];
    const glyph = slots[0]?.querySelector<HTMLElement>("[data-icon-name]");
    if (glyph != null) {
      glyph.setAttribute("data-icon-name", "grid-plus");
      glyph.style.setProperty("--cursor-icon-content", JSON.stringify("\uF461"));
    }
    slots.forEach((slot, index) => {
      const recipe = view.children[index];
      if (slot != null && recipe != null) {classes(slot, recipe.className); flag(slot, "data-icon-shown", recipe["data-icon-shown"]);}
    });
  }
  const observer = new MutationObserver(sync);
  observer.observe(doc.body, {subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded", "data-sidebar-collapsed"]});
  sync();
  return {sync, setLayout: value => {layout = value; sync();}, dispose: () => observer.disconnect()};
}
