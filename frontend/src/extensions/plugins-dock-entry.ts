/** Plugins footer dock: the upstream sidebar renders the Plugins button as its own footer row
 *  (`.sand-agents-sidebar__plugins-entry`) above the account row, wasting a full row of vertical
 *  space. This extension docks the button onto the account row — the same line that shows the
 *  local account name ("Local") and the appended channel-status light — right-aligned and
 *  minimized to a plain icon, and reserves right padding on the account area so the icon never
 *  covers the name or the channel-status text.
 *
 *  Pure CSS + a title tooltip: no DOM nodes are moved, so React reconciliation is untouched.
 *  Mounts the same way as channel-status-entry (appended to the pinned renderer chunk). */

// Keep this entry a module: the sibling extension entries share one tsconfig program, and
// script-scoped files would collide on helper names (ensureStyles et al.).
export {};

const STYLE_ELEMENT_ID = "sand-plugins-dock-style";
const BUTTON_SELECTOR = ".sand-agents-sidebar__plugins-entry .sand-agents-sidebar__plugins";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID) != null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = [
    // The sidebar container is the positioning context for the docked button. (`container-type:
    // inline-size` already makes it a containing block; position:relative is belt and braces.)
    ".sand-agents-sidebar{position:relative !important;}",
    // Lift the plugins entry out of the footer grid and dock it over the account row: right
    // aligned, vertically centered on a 46px band hugging the sidebar bottom (the account
    // trigger row lives there regardless of the optional update pill above it).
    ".sand-agents-sidebar__plugins-entry{position:absolute !important;right:8px !important;bottom:8px !important;z-index:30;display:flex !important;align-items:center;width:auto !important;height:46px;margin:0 !important;padding:0 !important;}",
    // Minimize the button to a 30px round icon.
    `${BUTTON_SELECTOR}{flex:0 0 auto !important;width:30px !important;height:30px !important;min-height:30px !important;justify-content:center !important;gap:0 !important;padding:0 !important;border-radius:999px !important;}`,
    `${BUTTON_SELECTOR}:hover{background:rgba(128,128,128,.16) !important;}`,
    // Visually hide the text label while keeping it in the accessibility tree.
    `${BUTTON_SELECTOR} > span:last-child{position:absolute !important;width:1px !important;height:1px !important;margin:-1px !important;padding:0 !important;overflow:hidden !important;white-space:nowrap !important;border:0 !important;clip-path:inset(50%) !important;}`,
    // Reserve space on the account row so the docked icon can never overlap the account name or
    // the injected OpenCodex channel-status light.
    ".sand-agents-sidebar__account{padding-right:44px !important;box-sizing:border-box !important;}",
    // Collapsed sidebar: fall back to the original static row so the icon cannot cover the
    // avatar-only account button.
    "@container sand-sidebar (max-width: 130px){.sand-agents-sidebar__plugins-entry{position:static !important;display:block !important;width:auto !important;height:auto !important;}.sand-agents-sidebar__account{padding-right:0 !important;}}",
  ].join("\n");
  document.head.append(style);
}

/** The minimized button hides its text label visually; mirror it into `title` so hover still
 *  explains the icon. Re-applied on mutations because the i18n patch localizes the label late. */
function ensureTooltip(): void {
  const button = document.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
  if (button == null) return;
  const label = button.querySelector("span:last-child")?.textContent?.trim();
  if (label != null && label.length > 0 && button.title !== label) button.title = label;
}

function install(): void {
  ensureStyles();
  ensureTooltip();
  const observer = new MutationObserver(() => {
    ensureStyles();
    ensureTooltip();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
