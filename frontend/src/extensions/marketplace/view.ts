/**
 * Marketplace view: the official 0.66 市场 dialog and its 管理 sub-view, built as a standalone DOM
 * tree in our own root.
 *
 * Why our own DOM rather than a rewrite of 0.18's dialog: 0.18 already ships a plugins dialog
 * (`role="dialog" aria-label="插件"`, class `sand-plugins-dialog`) and it IS this surface's
 * ancestor — same `Row`, same `Grid`, same `data-detail-hero-title` machinery. But 0.18 is a
 * different revision: it opens behind 市场/Yours tabs, labels its sections with the raw English
 * catalog categories, caps every group with "Show N more", and has no installed-preview header and
 * no manage page at all. Those are structural differences in React state, not styling, so
 * rewriting 0.18's children in place would fight reconciliation. This module therefore renders a
 * sibling dialog and reuses 0.18's *style system* (same stylix class names, same tokens) rather
 * than 0.18's *component tree*.
 *
 * The dialog is appended to `document.body` in its own portal-style layer, exactly where the
 * upstream `Dialog` primitive mounts, so the backdrop, stacking context and z-order match.
 */

import {
  ACTION_BUTTON_CLASSES,
  ADDED_PILL_CHECK_CLASSES,
  ADDED_PILL_CLASSES,
  ADD_PENDING_CLASSES,
  BACK_BAR_CLASSES,
  BACK_BUTTON_CLASSES,
  BACK_LABEL_CLASSES,
  BACK_LEADING_CLASSES,
  BACK_TO_MARKET_CLASSES,
  BACK_TRAILING_CLASSES,
  CLOSE_BUTTON_CLASSES,
  COPY_LINK_BUTTON_CLASSES,
  DETAIL_ACCOUNTS_CLASSES,
  DETAIL_ACCOUNT_NAME_CLASSES,
  DETAIL_ACCOUNT_TITLE_CLASSES,
  DETAIL_ACCOUNT_NAME_ROW_CLASSES,
  DETAIL_ACTIONS_CLASSES,
  DETAIL_APP_COUNT_CLASSES,
  DETAIL_BACK_BUTTON_CLASSES,
  DETAIL_BAR_CLASSES,
  DETAIL_BAR_LEADING_CLASSES,
  DETAIL_BODY_CLASSES,
  DETAIL_CONNECTORS_CLASSES,
  DETAIL_CONNECTOR_KIND_CLASSES,
  DETAIL_CONNECTOR_NAME_CLASSES,
  DETAIL_CONNECTOR_ROW_CLASSES,
  DETAIL_CONNECTOR_TEXT_CLASSES,
  DETAIL_DESC_CLASSES,
  DETAIL_DIVIDER_CLASSES,
  DETAIL_EDIT_ACCOUNT_FULL_CLASSES,
  DETAIL_HEADER_CLASSES,
  DETAIL_HEAD_CLASSES,
  DETAIL_INFO_LIST_CLASSES,
  DETAIL_INFO_ROW_CLASSES,
  DETAIL_INFO_TERM_CLASSES,
  DETAIL_INFO_VALUE_CLASSES,
  DETAIL_NAME_CLASSES,
  DETAIL_NAME_ROW_CLASSES,
  DETAIL_PRIMARY_BUTTON_CLASSES,
  DETAIL_ROOT_FULL_CLASSES,
  DETAIL_SECTION_TITLE_CLASSES,
  DETAIL_SHARE_BUTTON_CLASSES,
  DETAIL_SOURCE_LINK_CLASSES,
  DETAIL_SOURCE_ROW_CLASSES,
  DETAIL_STATUS_FULL_CLASSES,
  DETAIL_SUBSECTION_ROW_CLASSES,
  DETAIL_SUBSECTION_TITLE_CLASSES,
  DETAIL_TITLE_CENTERED_CLASSES,
  DETAIL_TITLE_CLASSES,
  DETAIL_TITLE_COL_CLASSES,
  DETAIL_TOOLS_CLASSES,
  DETAIL_TOOL_ICON_CLASSES,
  DIALOG_CLASSES,
  EMPTY_TEXT_CLASSES,
  EXPANDED_ROWS_CLASSES,
  GLYPH,
  GRID_CLASSES,
  GRID_FULLWIDTH_CLASSES,
  GRID_SINGLE_CLASSES,
  GROUPS_CLASSES,
  GROUP_ACTION_CLASSES,
  GROUP_SECTION_CLASSES,
  GROUP_TITLE_CLASSES,
  HIDDEN_ROWS_CLASSES,
  ICON_SPAN_CLASSES,
  INSTALLED_PREVIEW_CLASSES,
  LAYOUT_CLASSES,
  LIFTED_OFFICIAL_RULES,
  MANAGE_BACK_BUTTON_CLASSES,
  MANAGE_H1_CLASSES,
  MANAGE_HEADER_CLASSES,
  MARKETPLACE_ROOT_CLASSES,
  MARKET_SCOPE_CLASS,
  OVERFLOW_GRID_HOLDER_CLASSES,
  OVERFLOW_INNER_CLASSES,
  PANE_CLASSES,
  PANE_HEADER_CLASSES,
  PANE_TITLE_CLASSES,
  PANE_WRAPPER_CLASSES,
  PIN_BAND_CLASSES,
  PIN_COMPACT_HEIGHT_CLASS,
  PIN_FIELD_REL_CLASSES,
  PIN_FIELD_WRAP_CLASSES,
  PIN_PAD_CLASSES,
  PIN_ROW_CLASSES,
  PREVIEW_COUNT_CLASSES,
  PREVIEW_ICON_FIRST_CLASSES,
  PREVIEW_ICON_REST_CLASSES,
  PREVIEW_ICON_STACK_CLASSES,
  ROW_ITEM_CLASSES,
  ROW_MAIN_CLASSES,
  ROW_NAME_CLASSES,
  ROW_NAME_WRAPPER_CLASSES,
  ROW_OPEN_CLASSES,
  ROW_SUBTITLE_CLASSES,
  ROW_TRAILING_CLASSES,
  SEARCH_FIELD_INNER_CLASSES,
  SEARCH_FIELD_SHELL_CLASSES,
  SEARCH_HOLDER_CLASSES,
  SEARCH_INPUT_CLASSES,
  SECTION_H1_CLASSES,
  SECTION_OUTER_CLASSES,
  SECTION_PAGE_FULL_CLASSES,
  SECTION_RESULTS_TITLE_CLASSES,
  SECTION_ROW_CLASSES,
  SECTION_TITLE_CLASSES,
  SHARE_ICON_CLASSES,
  SHARE_LABEL_CLASSES,
  SHOW_ALL_CLASSES,
  SKILL_ICON_CLASSES,
  STATUS_BASE_CLASSES,
  STATUS_TONE_CLASSES,
  TEAM_BADGE_CLASSES,
  TITLE_ROW_CLASSES,
  TITLE_TRAILING_CLASSES,
  TOOL_ICON_CLASSES,
  TOOL_IMG_CLASSES,
  YOURS_ROOT_CLASSES,
} from "./official-styles.js";
import {
  createAddAccountCta,
  createGlyph,
  createToolsRowCta,
} from "./detail-cta.js";
import {
  HOMEPAGE_PREVIEW_LIMIT,
  PREVIEW_ICON_LIMIT,
  MANAGE_VISIBLE_ROWS,
  TEXT,
  canEditPrivateSkill,
  installedCountLabel,
  showAllLabel,
  skillSubtitle,
  statusLabel,
  statusTone,
  type BrowseGroup,
  type BrowseRow,
  type InstalledRow,
  type MarketplaceModel,
  type McpServer,
  buildPluginDetail,
  sectionGroup,
  type PrivateSkill,
} from "./model.js";

/* ------------------------------------------------------------------ *
 * Small DOM helpers
 * ------------------------------------------------------------------ */

function applyClasses(element: Element, classNames: readonly string[]): void {
  for (const className of classNames) element.classList.add(className);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classNames: readonly string[],
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyClasses(node, classNames);
  if (text != null) node.textContent = text;
  return node;
}

function glyph(name: string, codePoint: string, size = 12): HTMLElement {
  // The body lives in detail-cta.ts so the CTA builders and this wrapper cannot drift apart.
  return createGlyph(document, name, codePoint, size);
}

/* ------------------------------------------------------------------ *
 * Style injection
 * ------------------------------------------------------------------ */

const STYLE_ELEMENT_ID = "sand-marketplace-style";

/** Official-only rules. Each is emitted twice: the class sits on the element itself, and a
 *  descendant-only selector would never match an element that also satisfies its own ancestor
 *  part — the same trap the dock pill hit. */
function installStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID) != null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  const scope = `.${MARKET_SCOPE_CLASS}`;
  style.textContent = [
    // The dialog lives in our own portal layer, so it supplies its own positioning context. The
    // official `sand-h6vr4k` (width) and `sand-z03ioa` (height) come from the lifted block below;
    // these three give the layer the centring the upstream Dialog primitive would.
    `.${MARKET_SCOPE_CLASS}-layer{position:fixed !important;inset:0 !important;z-index:10000 !important;display:flex !important;align-items:center !important;justify-content:center !important;pointer-events:none !important;}`,
    `.${MARKET_SCOPE_CLASS}-layer > *{pointer-events:auto !important;}`,
    // Upstream paints the scrim through the Dialog primitive's own backdrop class. This build has
    // no portal to inherit it, so the layer carries the same dimming the official dialog shows
    // over the chat: a flat black veil that keeps the dialog the only bright surface.
    `.${MARKET_SCOPE_CLASS}-scrim{position:absolute !important;inset:0 !important;background:rgba(0,0,0,.28) !important;}`,
    // The dialog body scrolls; the header and the close button stay put. Upstream achieves this
    // with a `ScrollArea` inside `.sand-plugins`, so the same two-box structure is reproduced
    // here rather than scrolling the whole dialog.
    `${scope}{overflow:hidden !important;display:flex !important;flex-direction:column !important;}`,
    `${scope} > .${LAYOUT_MARKER}{min-height:0 !important;display:flex !important;flex-direction:column !important;}`,
    // Official keeps a 48px band between the layout top and the scroller: empty while the page is
    // at the top, and holding a second copy of the search field once the real one scrolls away
    // (measured official 0.66: band [1,1,798,48], scroller [1,49,798,652], switch between
    // scrollTop 78 and 79). It is `position: relative`, not sticky. So the scroller carries NO
    // top margin — it simply follows the band, and the band owns the 48px. An earlier revision
    // emulated the reservation with `margin-top: 48px` on the scroller and had no band at all,
    // which is why the pinned field had nowhere to go.
    `${scope} .${PIN_BAND_MARKER}{position:relative !important;z-index:2 !important;flex:0 0 auto !important;height:48px !important;min-height:48px !important;box-sizing:border-box !important;display:flex !important;flex-direction:column !important;}`,
    // The band only paints; the field inside it is the same flex-column recipe official uses.
    `${scope} .${PIN_ROW_MARKER}{display:flex !important;flex-direction:column !important;min-height:0 !important;}`,
    `${scope} .${PIN_PAD_MARKER}{display:flex !important;align-items:flex-start !important;min-height:0 !important;}`,
    `${scope} .${PIN_WRAP_MARKER}{flex:1 1 auto !important;min-width:0 !important;}`,
    `${scope} .${PIN_REL_MARKER}{min-width:0 !important;}`,
    // The SKILL.md body is a raw markdown blob: long prose lines, fenced code, tables. A bare
    // `<pre>` neither wraps nor shrinks, so it overflowed the 734px content column and Chromium
    // clipped the right edge instead of scrolling it — the tail of every long line was simply
    // unreadable. Wrap first (markdown is prose, not code to align) and keep the box from growing
    // past the pane.
    `${scope} .${SKILL_BODY_MARKER}{white-space:pre-wrap !important;overflow-wrap:anywhere !important;overflow-x:auto !important;max-width:100% !important;margin:0 !important;}`,
    `${scope} .${SCROLL_MARKER}{min-height:0 !important;flex:1 1 auto !important;overflow-y:auto !important;overscroll-behavior:contain !important;}`,
    // `sand-1s169rl` (official's own pane class) is absent from 0.18's stylesheet; these are the
    // declarations it carried — a flex column, and the 32px inline-end gutter that makes the
    // content 734px wide inside the 798px pane (33 + 734 + 32 = 799 ≈ 800 minus the border).
    `${scope} .${PANE_WRAPPER_MARKER}{display:flex !important;flex-direction:column !important;min-height:100% !important;padding-inline-end:32px !important;}`,
    `${scope} .${PANE_CONTENT_MARKER}{display:flex !important;flex-direction:column !important;min-width:0 !important;}`,
    // The page body is the only part that swaps between 市场 and 管理; it carries its own
    // bottom padding so the last section clears the scroller's bottom edge.
    `${scope} .${GROUPS_HOLDER_MARKER}{display:flex !important;flex-direction:column !important;min-width:0 !important;}`,
    // The homepage groups are a single column of sections; upstream's `Ce.flatMap` renders them
    // as siblings inside one scroller.
    `${scope} .${GROUP_ACTION_MARKER}[data-mkt-muted="true"]{opacity:.6 !important;}`,
    // `jt` sections carry their heading and grid; give the group action its own right-aligned
    // slot so 查看全部 lands on the same baseline as the official build.
    `${scope} .${GROUP_ROW_MARKER}{display:flex !important;align-items:baseline !important;justify-content:space-between !important;gap:12px !important;}`,
    `${scope} .${HIDDEN_MARKER}{overflow:hidden !important;}`,
    // Manage view: the collapsed overflow uses `grid-template-rows:0fr` (upstream's animation
    // hook) and is additionally hidden, so the un-expanded rows take no space and no hit target.
    `${scope} .${HIDDEN_MARKER}[data-mkt-collapsed="true"]{display:none !important;}`,
    // Rows are a two-column grid; the trailing action is a sibling of the row button, which is
    // why upstream's row container is a flex box rather than a button wrapping its own action.
    // The gap is NOT set here: the row's own `sand-1v2ro7d` already carries the official
    // `gap:12px`, and overriding it would drop the icon/name/trailing rhythm to 8px.
    `${scope} .${ROW_ITEM_MARKER}{min-width:0 !important;}`,
    `${scope} .${ROW_OPEN_MARKER}{min-width:0 !important;flex:1 1 auto !important;}`,
    `${scope} .${ROW_TRAILING_MARKER}{flex:0 0 auto !important;display:flex !important;align-items:center !important;}`,
    // Search field.
    `${scope} .${SEARCH_SHELL_MARKER}{display:flex !important;align-items:center !important;}`,
    `${scope} .${SEARCH_INNER_MARKER}{display:flex !important;align-items:center !important;gap:6px !important;flex:1 1 auto !important;min-width:0 !important;}`,
    `${scope} input.${SEARCH_INPUT_MARKER}{min-width:0 !important;flex:1 1 auto !important;background:transparent !important;border:0 !important;outline:none !important;}`,
    // Installed-preview icon stack overlaps, exactly like the dock pill's logo fan.
    `${scope} .${PREVIEW_STACK_MARKER}{display:inline-flex !important;align-items:center !important;}`,
    // Official 0.66 computes `padding: 4px 8px 4px 4px` on this button, but only three of the four
    // sides are reachable from the class list we carry: `sand-1iorvi4` (top), `sand-f159sx`
    // (inline-end) and `sand-jkvuk6` (bottom). The inline-start 4px comes from a class 0.18 does not
    // ship, so it is restored from the measured official value rather than left to chance. Measured
    // correction, not a lifted declaration — the width it produces still varies with the count text
    // (official shows 已安装 13 个, this build 已安装 8 个), which is a data difference, not a
    // layout one.
    `${scope} .${PREVIEW_BUTTON_MARKER}{padding-inline-start:4px !important;}`,
    // Each lifted rule is emitted twice: the class sits on the element itself, and a
    // descendant-only selector would never match an element that also satisfies its own ancestor
    // part. The leading dot on `selector` is load-bearing — `${scope}${selector}` concatenates to
    // `.sand-mktsand-h6vr4k`, which matches nothing at all. That bug shipped once: all 40 lifted
    // rules were emitted malformed, the dialog fell back to 0.18's `width:640px`, and every
    // source-level assertion still passed. `tests/plugins-marketplace-renderer-patch.test.mjs`
    // now asserts the emitted selector text directly.
    //
    // `pseudo` is appended verbatim so a lifted rule keeps upstream's state. It is not a nicety:
    // a `:focus-visible::after` rule emitted without it becomes an always-on border. See
    // LIFTED_OFFICIAL_RULES.
    ...LIFTED_OFFICIAL_RULES.flatMap(([selector, declarations, pseudo = ""]) => [
      `${scope}.${selector}${pseudo}{${declarations}}`,
      `${scope} .${selector}${pseudo}{${declarations}}`,
    ]),
  ].join("");
  document.head.append(style);
}

const LAYOUT_MARKER = "sand-plugins-layout";
const PANE_WRAPPER_MARKER = "sand-mkt-pane";
const PANE_CONTENT_MARKER = "sand-mkt-content";
const GROUPS_HOLDER_MARKER = "sand-mkt-groups";
const SCROLL_MARKER = "sand-mkt-scroll";
const GROUP_ACTION_MARKER = "sand-plugins__group-action";
const GROUP_ROW_MARKER = "sand-mkt-section-row";
const HIDDEN_MARKER = "sand-mkt-overflow";
const ROW_ITEM_MARKER = "sand-plugins-row";
const ROW_OPEN_MARKER = "sand-plugins-row__open";
const ROW_TRAILING_MARKER = "sand-plugins-row__trailing";
const SEARCH_SHELL_MARKER = "sand-mkt-search-shell";
const SEARCH_INNER_MARKER = "sand-mkt-search-inner";
const SEARCH_INPUT_MARKER = "sand-mkt-search-input";
const PIN_BAND_MARKER = "sand-mkt-pin-band";
const BAND_ROW_MARKER = "sand-mkt-band-row";
const PIN_ROW_MARKER = "sand-mkt-pin-row";
const PIN_PAD_MARKER = "sand-mkt-pin-pad";
const PIN_WRAP_MARKER = "sand-mkt-pin-wrap";
const PIN_REL_MARKER = "sand-mkt-pin-rel";
const SKILL_BODY_MARKER = "sand-mkt-skill-body";
const PREVIEW_STACK_MARKER = "sand-mkt-preview-stack";
const PREVIEW_BUTTON_MARKER = "sand-mkt-installed-preview";

/* ------------------------------------------------------------------ *
 * View state
 * ------------------------------------------------------------------ */

export type MarketplacePageKind = "browse" | "manage" | "section" | "detail" | "skill";

export interface MarketplaceViewState {
  readonly model: MarketplaceModel;
  readonly installed: readonly InstalledRow[];
  readonly skills: readonly PrivateSkill[];
  readonly servers: readonly McpServer[];
  /**
   * Which page is on screen. 0.66 pushes rather than swaps: 查看全部 and a row click both push a
   * page that 返回 pops, so the kind alone is not enough to rebuild the body — the pushed payload
   * below is what identifies the page. Captured ladder in docs/MARKETPLACE-066-EVIDENCE.md §1.
   */
  page: MarketplacePageKind;
  /** The group whose 查看全部 was pressed. Set only while `page === "section"`. */
  sectionGroup: BrowseGroup | null;
  /** The row whose 打开 was pressed. Set only while `page === "detail"`. */
  detailRow: BrowseRow | null;
  /** The skill whose 打开 was pressed. Set only while `page === "skill"`. */
  skillDetail: PrivateSkill | null;
  query: string;
  /** `onExpandInstalled` is a one-way latch upstream; it resets when the manage view is left. */
  installedExpanded: boolean;
  busy: boolean;
  /** The catalog round-trip is in flight; upstream shows `正在加载市场…` for this. */
  loading: boolean;
  /** Non-null when the catalog call failed. Kept separate from `loading` so a failure is not
   *  indistinguishable from an account with no plugins. */
  catalogError: string | null;
  /**
   * Non-null when 私有技能 could not be read — almost always a box that is not running. It is a
   * separate field from an empty `skills` array on purpose: "the host is down" and "you have no
   * skills" are different answers and the section must not conflate them.
   */
  skillsError: string | null;
}

export interface MarketplaceViewHandlers {
  readonly close: () => void;
  readonly openManage: () => void;
  readonly backToMarket: () => void;
  readonly onQuery: (value: string) => void;
  readonly onToggleInstalledExpanded: () => void;
  readonly onAdd: (row: BrowseRow) => void;
  readonly onAuthenticate: (serverId: string) => void;
  readonly onOpenRow: (row: BrowseRow) => void;
  readonly onOpenSkill: (skill: PrivateSkill) => void;
  readonly onDeleteSkill: (skill: PrivateSkill) => void;
  readonly onSaveSkill: (skill: PrivateSkill, draft: PrivateSkill) => void;
  readonly onViewAll: (group: BrowseGroup) => void;
  /** Pops one level. Official's 返回 sits in the detail bar on BOTH pushed pages and always
   *  returns to the page underneath, never straight to 市场. */
  readonly onBack: () => void;
  readonly onUninstall: (row: BrowseRow) => void;
  readonly onShare: (row: BrowseRow) => void;
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

function buildToolIcon(iconUrl: string, name: string, size: number): HTMLElement {
  const box = el("span", TOOL_ICON_CLASSES);
  box.setAttribute("aria-hidden", "true");
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.style.borderRadius = size >= 40 ? "10px" : "4px";
  if (iconUrl.length > 0) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = size;
    image.height = size;
    image.src = iconUrl;
    applyClasses(image, TOOL_IMG_CLASSES);
    box.append(image);
  } else {
    // Upstream falls back to the first letter of the display name when an entry has no icon —
    // the official grid shows a bare "O" for `oh-my-claudecode` and "F" for `Finance`.
    const monogram = el("span", [], name.trim().charAt(0).toLocaleUpperCase());
    monogram.setAttribute("aria-hidden", "true");
    monogram.style.display = "grid";
    monogram.style.placeItems = "center";
    monogram.style.width = "100%";
    monogram.style.height = "100%";
    monogram.style.fontSize = `${Math.round(size * 0.45)}px`;
    monogram.style.fontWeight = "600";
    box.append(monogram);
  }
  return box;
}

/* ------------------------------------------------------------------ *
 * Search field
 * ------------------------------------------------------------------ */

/**
 * One search field. `compact` builds official's pinned variant: identical shell and input class
 * lists, with the single height class swapped (`sand-10w6t97`, 32px, in-flow →
 * `sand-1fgtraw`, 28px, pinned). Both are real official hashes and both already exist in 0.18's
 * stylesheet, so the swap needs no lifted declaration — which is why the pinned field measures
 * 718x28 while the in-flow one is 734x32.
 *
 * Official renders the same controlled field twice and typing in either filters the list; the
 * renderer keeps one query in `state.query` and both inputs write to it, so `render` writes the
 * value back to each.
 */
function buildSearchField(
  compact: boolean,
  onInput: (value: string) => void,
): { shell: HTMLElement; input: HTMLInputElement } {
  const shell = el("div", SEARCH_FIELD_SHELL_CLASSES);
  applyClasses(shell, [SEARCH_SHELL_MARKER]);
  const inner = el("div", SEARCH_FIELD_INNER_CLASSES);
  applyClasses(inner, [SEARCH_INNER_MARKER]);
  if (compact) {
    inner.classList.remove("sand-10w6t97");
    inner.classList.add(PIN_COMPACT_HEIGHT_CLASS);
  }
  const searchIcon = el("span", ICON_SPAN_CLASSES);
  searchIcon.setAttribute("aria-hidden", "true");
  searchIcon.setAttribute("data-size", "md");
  searchIcon.append(glyph("search", GLYPH.search, 14));
  inner.append(searchIcon);
  const input = document.createElement("input");
  applyClasses(input, SEARCH_INPUT_CLASSES);
  input.classList.add(SEARCH_INPUT_MARKER);
  input.type = "text";
  input.placeholder = TEXT.searchPlaceholder;
  input.setAttribute("aria-label", TEXT.searchPlaceholder);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("spellcheck", "false");
  input.addEventListener("input", () => onInput(input.value));
  inner.append(input);
  shell.append(inner);
  return { shell, input };
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

/** `row__main` is a COLUMN flex that holds the name and the subtitle as direct siblings.
 *
 *  The name span itself carries the classes the upstream style object calls the "row meta wrapper"
 *  (`sand-17d4w8g` et al). An earlier revision nested BOTH spans inside an extra wrapper with those
 *  classes: that wrapper is `display:flex` in ROW direction, so the name and subtitle sat side by
 *  side and the pair got squeezed — every row read "Adob…  Development, customization, …" with the
 *  name truncated to a few characters. The official subtree is
 *  `row__main > [name(sand-17d4w8g…)] + [subtitle(sand-plugins-row__subtitle…)]`, verified with
 *  getComputedStyle on the running build: `row__main` computes `flex-direction:column`, its two
 *  children are 231x18 each, stacked at y=365 and y=383. */
function buildRowText(name: string, subtitle: string): HTMLElement {
  const main = el("span", ROW_MAIN_CLASSES);
  // Three levels, verbatim: row__main > [wrapper > __name] + [__subtitle].
  const nameWrapper = el("span", ROW_NAME_WRAPPER_CLASSES);
  nameWrapper.append(el("span", ROW_NAME_CLASSES, name));
  main.append(nameWrapper);
  main.append(el("span", ROW_SUBTITLE_CLASSES, subtitle));
  return main;
}

/** `Ws` (d=1151) — the plugin row, including upstream's six-way action decision table. */
function buildBrowseRow(row: BrowseRow, state: MarketplaceViewState, handlers: MarketplaceViewHandlers): HTMLElement {
  const item = el("li", ROW_ITEM_CLASSES);
  const open = el("button", ROW_OPEN_CLASSES);
  open.type = "button";
  open.setAttribute("aria-label", `打开 ${row.name}`);
  open.append(buildToolIcon(row.iconUrl, row.name, 40));
  open.append(buildRowText(row.name, row.description));
  open.addEventListener("click", () => handlers.onOpenRow(row));
  item.append(open);

  const trailing = el("span", ROW_TRAILING_CLASSES);
  trailing.append(buildRowAction(row, state, handlers));
  item.append(trailing);
  return item;
}

function buildRowAction(
  row: BrowseRow,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): HTMLElement {
  // Table order follows upstream `Ws` exactly. Branches 1–2 are the `nativeInstalled` path, which
  // this build has no equivalent for (no native plugin host), so the table starts at branch 3.
  const needsAuth = row.isInstalled && str(row.server?.status) === "needsAuth";
  if (needsAuth && row.server != null) {
    const button = el("button", ACTION_BUTTON_CLASSES, TEXT.add === "添加" ? "连接" : "连接");
    button.type = "button";
    button.setAttribute("aria-label", `连接 ${row.name}`);
    button.disabled = state.busy;
    button.addEventListener("click", () => handlers.onAuthenticate(str(row.server?.id)));
    return button;
  }
  if (row.isInstalled) return buildAddedPill(TEXT.added);
  const button = el("button", ACTION_BUTTON_CLASSES, TEXT.add);
  button.type = "button";
  button.disabled = state.busy;
  button.addEventListener("click", () => handlers.onAdd(row));
  return button;
}

function buildAddedPill(label: string): HTMLElement {
  const pill = el("span", ADDED_PILL_CLASSES);
  pill.append(glyph("check", GLYPH.check, 12));
  pill.append(document.createTextNode(label));
  return pill;
}

function buildPendingPill(name: string): HTMLElement {
  const pill = el("span", ADD_PENDING_CLASSES);
  pill.setAttribute("role", "status");
  pill.append(document.createTextNode(`正在添加 ${name}`));
  return pill;
}

/** `ss` in `chunk-plugins-rows` — `data-status` is the raw server status, passed through. */
function buildStatusPill(status: string, detail: string): HTMLElement {
  const pill = el("span", STATUS_BASE_CLASSES, statusLabel(status));
  pill.setAttribute("data-status", status);
  pill.setAttribute("role", "status");
  if (detail.length > 0) pill.setAttribute("title", detail);
  const tone = statusTone(status);
  if (tone === "connected") pill.classList.add(STATUS_TONE_CLASSES.connected);
  else if (tone === "warn") pill.classList.add(STATUS_TONE_CLASSES.warn);
  else if (tone === "error") pill.classList.add(STATUS_TONE_CLASSES.error);
  return pill;
}

function buildTeamBadge(teamName: string | null): HTMLElement | null {
  if (teamName == null) return null;
  const badge = el("span", TEAM_BADGE_CLASSES);
  badge.append(glyph("people", GLYPH.people, 12));
  badge.append(document.createTextNode("团队"));
  badge.setAttribute("title", `由 ${teamName} 发布`);
  return badge;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/** `Us` (d=1139) — homepage section: `h3[data-detail-hero-title]` + optional 查看全部. */
function buildHomepageSection(
  title: string,
  titleId: string,
  items: readonly BrowseRow[],
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
  options: { readonly limit: number; readonly kind: BrowseGroup["kind"] },
): HTMLElement {
  const outer = el("section", SECTION_OUTER_CLASSES);
  const header = el("div", SECTION_ROW_CLASSES);
  const heading = el("h3", SECTION_TITLE_CLASSES, title);
  heading.setAttribute("data-detail-hero-title", "");
  heading.id = titleId;
  header.append(heading);

  // Two different upstream thresholds live here and must not be conflated:
  //   - category groups: `c.plugins.length > 4`, rows `slice(0, 4)`
  //   - every other section: a computed `hiddenCount`
  // Both homepage thresholds reduce to the same comparison upstream applies to the two section
  // families (`c.plugins.length > 4` for buckets, a computed hiddenCount elsewhere); at the fixed
  // 4-row preview they coincide, so the cap is the single gate for 查看全部.
  const overflows = items.length > options.limit;
  if (overflows) {
    const action = el("button", GROUP_ACTION_CLASSES, TEXT.viewAll);
    action.type = "button";
    // The pushed page's SHAPE comes from the group's kind, so it must travel with the group
    // rather than be re-derived from the title at the far end of the stack.
    action.addEventListener("click", () =>
      handlers.onViewAll(sectionGroup(titleId, title, items, options.kind)),
    );
    header.append(action);
  }
  outer.append(header);

  const visible = items.slice(0, options.limit);
  const grid = el("ul", GRID_CLASSES);
  for (const item of visible) grid.append(buildBrowseRow(item, state, handlers));
  outer.append(grid);
  return outer;
}

/** `jt` (d=1162) — the manage view's sections. Its `h3` has NO `data-detail-hero-title`. */
/**
 * Variadic on purpose. Official's group puts its grid — and, on 已安装, the collapsed overflow
 * holder and the 显示全部 row — as *siblings* under the section, not inside a wrapper. The wrapper
 * this used to take (`OVERFLOW_INNER_CLASSES`, i.e. `min-height:0;overflow:hidden`) belongs one
 * level further in: official only carries it around the holder and around the 显示全部 row, never
 * around the whole body. Passing the parts straight through is what makes the section's child list
 * match — official 已安装 has exactly 4 children (heading row, grid, holder, 显示全部 row).
 */
function buildGroupSection(title: string, titleId: string, ...bodies: HTMLElement[]): HTMLElement {
  const section = el("section", GROUP_SECTION_CLASSES);
  section.setAttribute("aria-labelledby", titleId);
  const header = el("div", SECTION_ROW_CLASSES);
  const heading = el("h3", GROUP_TITLE_CLASSES, title);
  heading.id = titleId;
  header.append(heading);
  section.append(header);
  section.append(...bodies);
  return section;
}

function buildEmptyState(message: string): HTMLElement {
  return el("p", EMPTY_TEXT_CLASSES, message);
}

/* ------------------------------------------------------------------ *
 * Page 1 — 市场
 * ------------------------------------------------------------------ */

function renderBrowse(
  groups: HTMLElement,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): void {
  const root = el("div", MARKETPLACE_ROOT_CLASSES);
  const { model, query } = state;
  const searching = query.trim().length > 0;

  // Upstream renders a `CatalogStatus` block when the catalog is loading or empty. Reproduced here
  // so a failed fetch is visible as a state rather than as a blank marketplace.
  if (state.loading || state.catalogError != null) {
    root.append(
      buildEmptyState(
        state.loading ? TEXT.loadingCatalog : `${TEXT.catalogUnavailable} ${state.catalogError ?? ""}`.trim(),
      ),
    );
    groups.replaceChildren(root);
    return;
  }

  if (searching) {
    // Upstream's unified search renders one flat, uncapped result list rather than the section
    // stack; `gl` still applies its own preview limit on top of it.
    const matches = model.rows.filter((row) => matchesQuery(row, query));
    if (matches.length === 0) {
      root.append(buildEmptyState(`没有匹配“${query.trim()}”的插件`));
    } else {
      root.append(buildSearchResults(matches, state, handlers));
    }
    groups.replaceChildren(root);
    return;
  }

  // `vl` (d=1168) render order, verbatim.
  if (model.forYou.length > 0) {
    root.append(
      buildHomepageSection(TEXT.forYou, "mkt-for-you", model.forYou, state, handlers, {
        limit: HOMEPAGE_PREVIEW_LIMIT,
        kind: "featured",
      }),
    );
  }
  if (model.showsTrailingBrowse && model.featured.length > 0) {
    root.append(
      buildHomepageSection(TEXT.featured, "mkt-featured", model.featured, state, handlers, {
        limit: HOMEPAGE_PREVIEW_LIMIT,
        kind: "featured",
      }),
    );
  }
  // 团队插件 is hoisted ABOVE the trailing category list and is a named section here; upstream
  // renders it as an unnamed group, but the live 0.66 build shows a titled 团队插件 heading, so the
  // heading is what this port reproduces.
  root.append(
    buildHomepageSection(TEXT.team, "mkt-team", model.team, state, handlers, {
      limit: HOMEPAGE_PREVIEW_LIMIT,
      kind: "featured",
    }),
  );
  for (const group of model.categoryGroups) {
    root.append(
      buildHomepageSection(group.title, group.key, group.items, state, handlers, {
        limit: HOMEPAGE_PREVIEW_LIMIT,
        kind: "bucket",
      }),
    );
  }
  groups.replaceChildren(root);
}

function buildSearchResults(
  matches: readonly BrowseRow[],
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): HTMLElement {
  const wrapper = el("div", MARKETPLACE_ROOT_CLASSES);
  const visible = matches.slice(0, HOMEPAGE_PREVIEW_LIMIT * 5);
  const grid = el("ul", GRID_CLASSES);
  for (const item of visible) grid.append(buildBrowseRow(item, state, handlers));
  wrapper.append(grid);
  return wrapper;
}

function matchesQuery(row: BrowseRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  return (
    row.name.toLocaleLowerCase().includes(needle)
    || row.description.toLocaleLowerCase().includes(needle)
    || normalizeCategory(row).includes(needle)
  );
}

function normalizeCategory(row: BrowseRow): string {
  return str(row.entry.category).toLocaleLowerCase();
}

/* ------------------------------------------------------------------ *
 * Page 2 — 管理插件和技能
 * ------------------------------------------------------------------ */

function buildInstalledRow(item: InstalledRow, handlers: MarketplaceViewHandlers): HTMLElement {
  const row = el("li", ROW_ITEM_CLASSES);
  const open = el("button", ROW_OPEN_CLASSES);
  open.type = "button";
  open.setAttribute("aria-label", `打开 ${item.name}`);
  open.append(buildToolIcon(item.iconUrl, item.name, 40));
  open.append(buildRowText(item.name, item.subtitle));
  if (item.row != null) open.addEventListener("click", () => handlers.onOpenRow(item.row as BrowseRow));
  row.append(open);

  if (item.status != null) {
    const trailing = el("span", ROW_TRAILING_CLASSES);
    trailing.append(buildStatusPill(item.status ?? "", item.statusDetail));
    row.append(trailing);
  }
  return row;
}

function buildSkillRow(skill: PrivateSkill, handlers: MarketplaceViewHandlers): HTMLElement {
  const row = el("li", ROW_ITEM_CLASSES);
  const open = el("button", ROW_OPEN_CLASSES);
  open.type = "button";
  open.setAttribute("aria-label", `打开 ${skill.name}`);
  const icon = el("span", SKILL_ICON_CLASSES);
  icon.setAttribute("aria-hidden", "true");
  icon.append(glyph("file-list", GLYPH.fileList, 14));
  open.append(icon);
  open.append(buildRowText(skill.name, skillSubtitle(skill)));
  open.addEventListener("click", () => handlers.onOpenSkill(skill));
  row.append(open);
  return row;
}

function renderManage(
  groups: HTMLElement,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): void {
  const root = el("div", YOURS_ROOT_CLASSES);
  const { query, installed, skills } = state;
  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const header = el("header", MANAGE_HEADER_CLASSES);
  const h1 = el("h1", MANAGE_H1_CLASSES, TEXT.manageTitle);
  h1.setAttribute("data-detail-hero-title", "");
  h1.tabIndex = -1;
  header.append(h1);
  root.append(header);

  // ---- 已安装 ----
  const matchedInstalled = searching
    ? installed.filter((item) => item.name.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()))
    : installed;
  const overflows = !searching && matchedInstalled.length > MANAGE_VISIBLE_ROWS;
  const first = overflows ? matchedInstalled.slice(0, MANAGE_VISIBLE_ROWS) : matchedInstalled;
  const rest = overflows ? matchedInstalled.slice(MANAGE_VISIBLE_ROWS) : [];

  const installedNodes: HTMLElement[] = [];
  if (matchedInstalled.length === 0) {
    installedNodes.push(
      buildEmptyState(searching ? `没有已安装的插件匹配“${trimmed}”` : TEXT.noInstalled),
    );
  } else {
    const grid = el("ul", GRID_CLASSES);
    grid.setAttribute("aria-labelledby", "mkt-installed");
    for (const item of first) grid.append(buildInstalledRow(item, handlers));
    installedNodes.push(grid);

    if (rest.length > 0) {
      // Upstream renders the overflow rows in the DOM but keeps them `aria-hidden` + `inert` behind
      // `grid-template-rows:0fr` until the one-way 显示全部 latch fires.
      const holder = el("div", state.installedExpanded ? EXPANDED_ROWS_CLASSES : HIDDEN_ROWS_CLASSES);
      if (state.installedExpanded) {
        holder.removeAttribute("aria-hidden");
        holder.removeAttribute("inert");
      } else {
        holder.setAttribute("aria-hidden", "true");
        holder.setAttribute("inert", "");
      }
      // `min-height:0;overflow:hidden` is what lets the 0fr row collapse — official has it here,
      // around the holder's own content, and nowhere higher up.
      const inner = el("div", OVERFLOW_INNER_CLASSES);
      const gridHolder = el("div", OVERFLOW_GRID_HOLDER_CLASSES);
      const restGrid = el("ul", GRID_CLASSES);
      restGrid.setAttribute("aria-labelledby", "mkt-installed");
      for (const item of rest) restGrid.append(buildInstalledRow(item, handlers));
      gridHolder.append(restGrid);
      inner.append(gridHolder);
      holder.append(inner);
      installedNodes.push(holder);

      if (!state.installedExpanded) {
        const wrap = el("div", OVERFLOW_INNER_CLASSES);
        const showAll = el("button", SHOW_ALL_CLASSES, showAllLabel(matchedInstalled.length));
        showAll.type = "button";
        showAll.addEventListener("click", () => handlers.onToggleInstalledExpanded());
        wrap.append(showAll);
        installedNodes.push(wrap);
      }
    }
  }
  root.append(buildGroupSection(TEXT.installed, "mkt-installed", ...installedNodes));

  // ---- 私有技能 ----
  const matchedSkills = searching
    ? skills.filter((skill) => skill.name.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()))
    : skills;
  const skillNodes: HTMLElement[] = [];
  if (state.skillsError != null) {
    // An unreachable host must never read as "you have no skills". Upstream's empty state is only
    // correct when the read actually succeeded and came back empty.
    skillNodes.push(buildEmptyState(state.skillsError));
  } else if (matchedSkills.length === 0) {
    skillNodes.push(buildEmptyState(searching ? `没有私有技能匹配“${trimmed}”` : TEXT.noPrivateSkills));
  } else {
    const grid = el("ul", GRID_FULLWIDTH_CLASSES);
    grid.setAttribute("aria-labelledby", "mkt-private-skills");
    for (const skill of matchedSkills) grid.append(buildSkillRow(skill, handlers));
    skillNodes.push(grid);
  }
  root.append(buildGroupSection(TEXT.privateSkills, "mkt-private-skills", ...skillNodes));

  groups.replaceChildren(root);
}

/* ------------------------------------------------------------------ *
 * Page 3 — a section page, pushed by 查看全部
 *
 * 0.66 has two shapes here and they are not interchangeable (EVIDENCE §3):
 *
 *   featured  single column, 734px rows, `h1` carrying the section's own name, wrapped in
 *             `.sand-plugins__marketplace`            — measured on 精选插件 (6 rows)
 *   bucket    two columns of 363px, `h3` reading 结果,  no wrapper at all
 *             — measured on 效率 (63 rows) and 研究 (11 rows)
 *
 * Neither paginates: 效率 renders all 63 rows into one scroll area and the dialog carries no
 * 加载更多 / 下一页 affordance anywhere. The bucket name still reaches the user, but through the
 * detail bar's centred title, not through the in-page heading.
 * ------------------------------------------------------------------ */

function renderSection(
  groups: HTMLElement,
  group: BrowseGroup,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): void {
  const section = el("section", SECTION_OUTER_CLASSES);
  const header = el("div", SECTION_ROW_CLASSES);
  // The heading TAG differs between the two shapes, not just its class list: official renders the
  // featured section's own name in an `h1` (44px, measured `[65,231,107,44]`) and the bucket page's
  // 结果 in an `h3` (34px, measured `[65,231,48,34]`). Reusing one tag for both would change the
  // document outline as well as the type scale.
  const heading = el(
    group.kind === "featured" ? "h1" : "h3",
    group.kind === "featured" ? SECTION_H1_CLASSES : SECTION_RESULTS_TITLE_CLASSES,
    group.kind === "featured" ? group.title : TEXT.results,
  );
  heading.id = `mkt-section-${group.key}`;
  header.append(heading);
  section.append(header);

  // One class swaps the grid between 1×734px and 2×363px; see GRID_SINGLE_CLASSES.
  const grid = el("ul", group.kind === "featured" ? GRID_SINGLE_CLASSES : GRID_CLASSES);
  for (const item of group.items) grid.append(buildBrowseRow(item, state, handlers));
  section.append(grid);

  if (group.kind === "featured") {
    // Only the featured page carries the wrapper; the results page puts the bare section in the
    // pane, and adding the wrapper there would be a fabricated structural difference.
    const wrapper = el("div", SECTION_PAGE_FULL_CLASSES);
    wrapper.append(section);
    groups.replaceChildren(wrapper);
    return;
  }
  groups.replaceChildren(section);
}

/* ------------------------------------------------------------------ *
 * Page 4 — the plugin detail page
 * ------------------------------------------------------------------ */

/**
 * @param headingClasses the section heading's own class list. Official does NOT use one list for
 *   账户 / 工具 / 信息: 账户 carries 22 classes and 工具 / 信息 carry 18, differing by four
 *   `ui-*` classes that compute identically. Both readings were taken twice with byte-identical
 *   output, so the split is transcribed rather than normalised — collapsing them would be a
 *   simplification no measurement supports.
 */
function buildDetailSection(title: string, headingClasses: readonly string[], count?: string): HTMLElement {
  const block = el("div", []);
  if (count == null) {
    const heading = el("h3", headingClasses, title);
    block.append(heading);
    return block;
  }
  const row = el("div", DETAIL_SUBSECTION_ROW_CLASSES);
  row.append(el("h3", DETAIL_SUBSECTION_TITLE_CLASSES, title));
  row.append(el("span", DETAIL_APP_COUNT_CLASSES, count));
  block.append(row);
  return block;
}

function buildDetailListRow(
  term: string,
  value: string,
  withDivider: boolean,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const row = el("div", DETAIL_INFO_ROW_CLASSES);
  row.append(el("dt", DETAIL_INFO_TERM_CLASSES, term));
  row.append(el("dd", DETAIL_INFO_VALUE_CLASSES, value));
  fragment.append(row);
  if (withDivider) fragment.append(el("div", DETAIL_DIVIDER_CLASSES));
  return fragment;
}

/**
 * 私有技能 detail — the third surface, opened from the manage page's 私有技能 rows.
 *
 * Structure reuses the plugin detail page's official class names (same `DETAIL_*` recipe), because
 * upstream renders both through the same detail shell — the header band, the description line and
 * the `信息` term/value rows are identical furniture. Only the body differs: a plugin lists
 * 账户/工具/应用, a skill lists its own fields and, when it is user-written, an edit form.
 *
 * Two rules are upstream's, not this port's:
 *  - editing is offered ONLY for `source === "workflow"` (`canEditPrivateSkill`,
 *    `view-B5Ug8wEm.js#L1377`). A `managed` skill is installed by the platform; writing to its file
 *    would edit something the product owns.
 *
 * The provenance line is NOT rendered in the header band — official 0.66 leaves that slot empty
 * there (see D14 below). `skillSubtitle` still drives the manage page's list row (`buildRowText`),
 * which is where official does show it.
 */
function renderSkillDetail(
  groups: HTMLElement,
  skill: PrivateSkill,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): void {
  const root = el("div", DETAIL_ROOT_FULL_CLASSES);

  /* --- header band: file icon, name, provenance, 删除 --- */
  const head = el("div", []);
  const header = el("header", DETAIL_HEADER_CLASSES);
  const icon = el("span", SKILL_ICON_CLASSES);
  icon.setAttribute("aria-hidden", "true");
  icon.append(glyph("file-list", GLYPH.fileList, 20));
  header.append(icon);

  const titleCol = el("div", DETAIL_TITLE_COL_CLASSES);
  const nameRow = el("div", DETAIL_NAME_ROW_CLASSES);
  const name = el("h3", DETAIL_NAME_CLASSES, skill.name);
  name.id = "sand-plugins-detail-heading";
  nameRow.append(name);
  titleCol.append(nameRow);
  // D14: the provenance/description subtitle is rendered **empty** here, matching official 0.66.
  //
  // Measured on the official build's private-skill detail (`画图`): the `sand-settings-detail-bar`
  // text is the title ONLY, `DETAIL_SOURCE_ROW_CLASSES` has **0 hits** on that page, and the slot
  // that would hold it is a `w=0` **empty flex** node — `display:flex`, no text.
  //
  // This used to render `${provenance} · ${description}` and hard-clip 603px
  // (`textOverflow:clip`, `scrollWidth 1213 / clientWidth 610`). The fix is NOT an ellipsis: official
  // has no element there to ellipsize, so any truncation would be invented behaviour. The node is
  // kept (empty) rather than dropped because official demonstrably has one; at zero width the two
  // are visually identical, so this is a DOM-fidelity call, not a visual one.
  titleCol.append(el("span", DETAIL_SOURCE_ROW_CLASSES));
  header.append(titleCol);

  const actions = el("div", DETAIL_ACTIONS_CLASSES);
  const remove = el("button", DETAIL_PRIMARY_BUTTON_CLASSES, TEXT.delete);
  remove.type = "button";
  remove.disabled = state.busy;
  remove.addEventListener("click", () => handlers.onDeleteSkill(skill));
  actions.append(remove);
  header.append(actions);

  head.append(header);
  if (skill.description.length > 0) head.append(el("p", DETAIL_DESC_CLASSES, skill.description));
  root.append(head);

  /* --- 信息 --- */
  const body = el("div", DETAIL_BODY_CLASSES);
  const infoBlock = buildDetailSection(TEXT.detailInfo, DETAIL_SECTION_TITLE_CLASSES);
  const info = el("dl", DETAIL_INFO_LIST_CLASSES);
  info.append(buildDetailListRow(TEXT.skillProvenance, TEXT.skillProvenanceFor(skill.source), true));
  info.append(buildDetailListRow(TEXT.skillLocation, TEXT.skillLocationFor(skill.source), true));
  info.append(buildDetailListRow(TEXT.skillStatus, skill.enabled ? TEXT.toolsEnabled : TEXT.skillDisabled, false));
  infoBlock.append(info);
  body.append(infoBlock);

  /* --- the SKILL.md body --- */
  if (skill.body.length > 0) {
    const bodyBlock = buildDetailSection(TEXT.skillBody, DETAIL_SECTION_TITLE_CLASSES);
    const pre = el("pre", DETAIL_DESC_CLASSES, skill.body);
    applyClasses(pre, [SKILL_BODY_MARKER]);
    bodyBlock.append(pre);
    body.append(bodyBlock);
  }

  /* --- edit form, user-written skills only --- */
  const editable = skill.source === "workflow";
  if (editable) {
    const editBlock = buildDetailSection(TEXT.edit, DETAIL_SECTION_TITLE_CLASSES);
    const form = el("div", DETAIL_INFO_LIST_CLASSES);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = skill.name;
    nameInput.setAttribute("aria-label", TEXT.skillName);
    form.append(nameInput);

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.value = skill.description;
    descInput.setAttribute("aria-label", TEXT.skillDescription);
    form.append(descInput);

    const bodyInput = document.createElement("textarea");
    bodyInput.value = skill.body;
    bodyInput.rows = 12;
    bodyInput.setAttribute("aria-label", TEXT.skillBody);
    form.append(bodyInput);

    // Upstream enables 保存 only when the draft is valid AND actually different
    // (`canEditPrivateSkill`), so the button is recomputed on every keystroke rather than on submit.
    const save = el("button", DETAIL_PRIMARY_BUTTON_CLASSES, TEXT.save);
    save.type = "button";
    const draft = (): PrivateSkill =>
      ({ ...skill, name: nameInput.value, description: descInput.value, body: bodyInput.value });
    const sync = (): void => {
      save.disabled = state.busy || !canEditPrivateSkill(skill, draft());
    };
    for (const field of [nameInput, descInput, bodyInput]) {
      field.addEventListener("input", sync);
    }
    save.addEventListener("click", () => handlers.onSaveSkill(skill, draft()));
    form.append(save);
    editBlock.append(form);
    body.append(editBlock);
    sync();
  } else {
    // A platform-installed skill has no edit affordance at all — not a disabled button, because
    // upstream simply does not render the control.
    body.append(buildEmptyState(TEXT.skillReadOnly));
  }

  root.append(body);
  groups.replaceChildren(root);
}

function renderDetail(
  groups: HTMLElement,
  row: BrowseRow,
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): void {
  const detail = buildPluginDetail(row, state.servers.find((s) => matchesServer(s, row)) ?? null);
  const root = el("div", DETAIL_ROOT_FULL_CLASSES);

  /* --- header band: logo, name, source link, 分享 + 添加/卸载 --- */
  // Official wraps the band and the description in a flex column with a 12px gap, so the pair
  // measures 88px. An unclassed div here is a plain block with no gap, which is 12px short and,
  // worse, left the icon with no box to size against.
  const head = el("div", DETAIL_HEAD_CLASSES);
  const header = el("header", DETAIL_HEADER_CLASSES);
  header.append(buildDetailToolIcon(detail.iconUrl, detail.name));

  const titleCol = el("div", DETAIL_TITLE_COL_CLASSES);
  const nameRow = el("div", DETAIL_NAME_ROW_CLASSES);
  const name = el("h3", DETAIL_NAME_CLASSES, detail.name);
  name.id = "sand-plugins-detail-heading";
  nameRow.append(name);
  const copy = el("button", COPY_LINK_BUTTON_CLASSES);
  copy.type = "button";
  copy.setAttribute("aria-label", TEXT.copyPluginLink);
  copy.append(glyph("copy", GLYPH.copy, 12));
  // Official's copy-link affordance writes the plugin's own URL — the same value 查看源码 links
  // to. Both buttons therefore route to the same handler rather than re-deriving the URL.
  copy.addEventListener("click", () => handlers.onShare(row));
  nameRow.append(copy);
  titleCol.append(nameRow);

  if (detail.sourceUrl.length > 0) {
    const sourceRow = el("span", DETAIL_SOURCE_ROW_CLASSES);
    const link = el("a", DETAIL_SOURCE_LINK_CLASSES, TEXT.viewSource);
    link.href = detail.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    // The external-link glyph lives INSIDE the <a> in official (text node, then a 13×13
    // `<i class="ui-icon">`), which is what makes the link 69px wide rather than 52px. Appending
    // it to the wrapper `span` left the link text-only and silently lost the icon.
    link.append(glyph("arrow-up-right", GLYPH.externalLink, 13));
    sourceRow.append(link);
    titleCol.append(sourceRow);
  }
  header.append(titleCol);

  const actions = el("div", DETAIL_ACTIONS_CLASSES);
  // Official's children are `[sand-kit-icon 18×18][label span]` — icon first, label in its own
  // ellipsis span. Passing the label as button text and appending a bare 14px glyph produced the
  // same 82→78px shortfall; the recipe classes were already correct.
  const share = el("button", DETAIL_SHARE_BUTTON_CLASSES);
  share.type = "button";
  const shareIcon = el("span", SHARE_ICON_CLASSES);
  shareIcon.append(glyph("link", GLYPH.share, 14));
  share.append(shareIcon);
  share.append(el("span", SHARE_LABEL_CLASSES, TEXT.share));
  share.addEventListener("click", () => handlers.onShare(row));
  actions.append(share);
  const primary = el(
    "button",
    DETAIL_PRIMARY_BUTTON_CLASSES,
    detail.isInstalled ? TEXT.uninstall : TEXT.add,
  );
  primary.type = "button";
  if (detail.isInstalled) primary.addEventListener("click", () => handlers.onUninstall(row));
  else primary.addEventListener("click", () => handlers.onAdd(row));
  actions.append(primary);
  header.append(actions);

  head.append(header);
  if (detail.description.length > 0) {
    head.append(el("p", DETAIL_DESC_CLASSES, detail.description));
  }
  root.append(head);

  /* --- body: 账户 / 工具 / 应用 / 信息 --- */
  const body = el("div", DETAIL_BODY_CLASSES);

  // 账户 — installed only. Official gates it on the plugin having a configured account, so an
  // installed plugin with no account row omits the whole section rather than showing an empty one.
  if (detail.accounts.length > 0) {
    const block = buildDetailSection(TEXT.detailAccounts, DETAIL_ACCOUNT_TITLE_CLASSES);
    const list = el("div", DETAIL_ACCOUNTS_CLASSES);
    detail.accounts.forEach((account, index) => {
      const accountRow = el("div", DETAIL_INFO_ROW_CLASSES);
      // Official nests the label and the edit button in a 5px-gap flex row inside a 1px-gap column.
      // This build put a <dt> carrying the ellipsizing term recipe directly in a block span, so the
      // name was clipped to "d..." at 21px wide and the pencil fell to a second line — 57px tall
      // against official's 42.
      const holder = el("span", DETAIL_ACCOUNT_NAME_CLASSES);
      const nameRow = el("span", DETAIL_ACCOUNT_NAME_ROW_CLASSES, account.key);
      const edit = el("button", DETAIL_EDIT_ACCOUNT_FULL_CLASSES);
      edit.type = "button";
      edit.setAttribute("aria-label", TEXT.editAccount(account.key));
      edit.append(glyph("pencil", GLYPH.pencil, 10));
      nameRow.append(edit);
      holder.append(nameRow);
      accountRow.append(holder);
      const status = el("dd", DETAIL_STATUS_FULL_CLASSES, statusLabel(account.status));
      accountRow.append(status);
      list.append(accountRow);
      if (index < detail.accounts.length - 1) list.append(el("div", DETAIL_DIVIDER_CLASSES));
    });
    list.append(el("div", DETAIL_DIVIDER_CLASSES));
    // Official 0.66 renders the label as a **text node** next to the glyph, with no aria-label at
    // all (measured: `textContent === "添加其他账户"`, `getAttribute("aria-label") === null`,
    // `children.length === 1` — the glyph). Carrying the copy in aria-label only made the button
    // icon-only on screen, 34px tall instead of 43px, with the text existing purely for screen
    // readers. The construction lives in detail-cta.ts so a test can render it and assert that.
    list.append(createAddAccountCta(document));
    block.append(list);
    body.append(block);
  }

  // 工具 — installed only.
  if (detail.toolsLabel != null) {
    const block = buildDetailSection(TEXT.detailTools, DETAIL_SECTION_TITLE_CLASSES);
    const list = el("div", DETAIL_TOOLS_CLASSES);
    list.append(createToolsRowCta(document, detail.toolsLabel));
    block.append(list);
    body.append(block);
  }

  // 应用 — always. Official heads it with the connector count and lists one row per connector.
  const apps = buildDetailSection(TEXT.detailApps, DETAIL_SECTION_TITLE_CLASSES, String(detail.connectors.length));
  if (detail.connectors.length > 0) {
    const list = el("div", DETAIL_CONNECTORS_CLASSES);
    for (const connector of detail.connectors) {
      const item = el("div", DETAIL_CONNECTOR_ROW_CLASSES);
      item.append(glyph("plug", GLYPH.plug, 16));
      const text = el("span", DETAIL_CONNECTOR_TEXT_CLASSES);
      text.append(el("span", DETAIL_CONNECTOR_NAME_CLASSES, connector.name));
      text.append(el("span", DETAIL_CONNECTOR_KIND_CLASSES, TEXT.connectorLabel));
      item.append(text);
      list.append(item);
    }
    apps.append(list);
  }
  body.append(apps);

  // 信息 — one dt/dd pair per field the entry actually carries, in official's order.
  const info = buildDetailSection(TEXT.detailInfo, DETAIL_SECTION_TITLE_CLASSES);
  const list = el("dl", DETAIL_INFO_LIST_CLASSES);
  detail.info.forEach((entry, index) => {
    list.append(buildDetailListRow(entry.label, entry.value, index < detail.info.length - 1));
  });
  info.append(list);
  body.append(info);

  root.append(body);
  groups.replaceChildren(root);
}

function buildDetailToolIcon(iconUrl: string, name: string): HTMLElement {
  const box = el("span", DETAIL_TOOL_ICON_CLASSES);
  box.setAttribute("aria-hidden", "true");
  // The 56x56 box comes from an INLINE style on official's span, not from a class: every one of
  // DETAIL_TOOL_ICON_CLASSES resolves identically in 0.18, and `sand-tool-icon--logo` has no rule
  // in either stylesheet. With nothing constraining the span, the img's own `width:100%`
  // (sand-h8yej3) resolved against an unconstrained flex item and the logo rendered 401x401 —
  // which is what pushed the whole detail page from 677px to 1023px tall.
  box.style.width = "56px";
  box.style.height = "56px";
  box.style.borderRadius = "16px";
  if (iconUrl.length > 0) {
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    // Official's attributes are 56/56; the img computes to 55x55 because its box is border-box
    // with a 1px border. Sizing the attributes to the rendered 55 instead would be off by one.
    image.width = 56;
    image.height = 56;
    image.src = iconUrl;
    applyClasses(image, TOOL_IMG_CLASSES);
    box.append(image);
  } else {
    const monogram = el("span", [], name.trim().charAt(0).toLocaleUpperCase());
    monogram.setAttribute("aria-hidden", "true");
    monogram.style.display = "grid";
    monogram.style.placeItems = "center";
    monogram.style.width = "100%";
    monogram.style.height = "100%";
    monogram.style.fontSize = "25px";
    monogram.style.fontWeight = "600";
    box.append(monogram);
  }
  return box;
}

function matchesServer(server: McpServer, row: BrowseRow): boolean {
  const name = str(server.name);
  return name.split(":")[0] === row.name;
}

/* ------------------------------------------------------------------ *
 * Header (shared, changes between the two pages)
 * ------------------------------------------------------------------ */

function buildInstalledPreview(
  state: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): HTMLButtonElement {
  const button = el("button", INSTALLED_PREVIEW_CLASSES);
  applyClasses(button, [PREVIEW_BUTTON_MARKER]);
  button.type = "button";
  button.setAttribute("aria-label", TEXT.installedAriaLabel);
  button.addEventListener("click", () => handlers.openManage());

  // `Bt`: icon-havers first, capped at 4, then the count, then a 12px chevron.
  const withIcon = state.installed.filter((item) => item.iconUrl.length > 0);
  const without = state.installed.filter((item) => item.iconUrl.length === 0);
  const shown = [...withIcon, ...without].slice(0, PREVIEW_ICON_LIMIT);
  if (shown.length > 0) {
    const stack = el("span", PREVIEW_ICON_STACK_CLASSES);
    stack.setAttribute("aria-hidden", "true");
    shown.forEach((item, index) => {
      const slot = el(
        "span",
        index > 0 ? PREVIEW_ICON_REST_CLASSES : PREVIEW_ICON_FIRST_CLASSES,
      );
      slot.append(buildToolIcon(item.iconUrl, item.name, 18));
      stack.append(slot);
    });
    button.append(stack);
  }
  button.append(el("span", PREVIEW_COUNT_CLASSES, installedCountLabel(state.installed.length)));
  const chevron = glyph("chevron-right", GLYPH.chevronRight, 12);
  button.append(chevron);
  return button;
}

function buildBackToMarket(handlers: MarketplaceViewHandlers): HTMLButtonElement {
  const button = el("button", BACK_TO_MARKET_CLASSES);
  button.type = "button";
  button.setAttribute("aria-label", TEXT.backToMarketAriaLabel);
  button.addEventListener("click", () => handlers.backToMarket());
  const icon = el("span", ICON_SPAN_CLASSES);
  icon.setAttribute("aria-hidden", "true");
  icon.append(glyph("chevron-left", GLYPH.chevronLeft, 12));
  button.append(icon);
  button.append(el("span", BACK_LABEL_CLASSES, TEXT.market));
  return button;
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

export interface MarketplaceDialog {
  readonly root: HTMLElement;
  readonly render: (state: MarketplaceViewState) => void;
  readonly destroy: () => void;
}

export function createMarketplaceDialog(
  initial: MarketplaceViewState,
  handlers: MarketplaceViewHandlers,
): MarketplaceDialog {
  installStyles();

  const layer = el("div", [`${MARKET_SCOPE_CLASS}-layer`]);
  const scrim = el("div", [`${MARKET_SCOPE_CLASS}-scrim`]);
  layer.append(scrim);

  const dialog = el("div", DIALOG_CLASSES);
  applyClasses(dialog, [MARKET_SCOPE_CLASS]);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("tabindex", "-1");
  dialog.setAttribute("data-status", "open");
  dialog.setAttribute("data-floating-ui-focusable", "");

  const layout = el("div", LAYOUT_CLASSES);
  const close = el("button", CLOSE_BUTTON_CLASSES);
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.setAttribute("data-size", "md");
  close.setAttribute("data-variant", "ghost");
  const closeIcon = el("span", ICON_SPAN_CLASSES);
  closeIcon.setAttribute("aria-hidden", "true");
  closeIcon.setAttribute("data-size", "lg");
  closeIcon.append(glyph("close", GLYPH.close, 16));
  close.append(closeIcon);
  close.addEventListener("click", () => handlers.close());
  layout.append(close);

  // The 48px band is a shared slot: official renders ONE element here on every page and swaps only
  // its single child. 页 1 holds the mount point the pinned 搜索插件 field drops into; 页 2 and the
  // pushed pages hold the "‹" detail bar. Its class list is the same 17/10 on all of them. Rendering
  // the bar inside the scroller instead left the band empty and duplicated the bar 55px lower and
  // 64px narrower than official — the whole of page 2 and of 插件详情 sat in the wrong place.
  const pinBand = el("div", PIN_BAND_CLASSES);
  applyClasses(pinBand, [PIN_BAND_MARKER]);
  layout.append(pinBand);

  const bandRow = el("div", PIN_ROW_CLASSES);
  applyClasses(bandRow, [BAND_ROW_MARKER]);

  /** Empty the band for a new page. Dropping the child also drops the `pinMounted` latch, so the
   *  pinned field re-arms instead of being silently believed present; `syncPin` re-mounts it on the
   *  same render if this page wants it. The class list is NOT touched — it is the same everywhere. */
  const clearBand = (): void => {
    pinBand.replaceChildren();
    pinMounted = false;
  };

  /** Mount a detail bar into the band, on official's 10-class row. */
  const mountBar = (bar: HTMLElement): void => {
    bandRow.replaceChildren(bar);
    pinBand.append(bandRow);
  };

  const pane = el("div", PANE_CLASSES);
  applyClasses(pane, [SCROLL_MARKER]);

  // Official nests scroller > sand-settings-pane > pane content. See PANE_WRAPPER_CLASSES for
  // why that middle layer is load-bearing rather than cosmetic.
  const paneWrapper = el("div", PANE_WRAPPER_CLASSES);
  applyClasses(paneWrapper, [PANE_WRAPPER_MARKER]);
  const content = el("div", PANE_HEADER_CLASSES);
  applyClasses(content, [PANE_CONTENT_MARKER]);

  const header = el("div", TITLE_ROW_CLASSES);
  content.append(header);

  const searchHolder = el("div", SEARCH_HOLDER_CLASSES);
  const mainSearch = buildSearchField(false, (value) => handlers.onQuery(value));
  searchHolder.append(mainSearch.shell);
  content.append(searchHolder);
  const input = mainSearch.input;

  /* --- the pinned copy, created on first need and then shown/hidden --- */
  const pinRow = el("div", PIN_ROW_CLASSES);
  applyClasses(pinRow, [PIN_ROW_MARKER]);
  const pinPad = el("div", PIN_PAD_CLASSES);
  applyClasses(pinPad, [PIN_PAD_MARKER]);
  const pinWrap = el("div", PIN_FIELD_WRAP_CLASSES);
  applyClasses(pinWrap, [PIN_WRAP_MARKER]);
  const pinRel = el("div", PIN_FIELD_REL_CLASSES);
  applyClasses(pinRel, [PIN_REL_MARKER]);
  const pinSearch = buildSearchField(true, (value) => handlers.onQuery(value));
  pinRel.append(pinSearch.shell);
  pinWrap.append(pinRel);
  pinPad.append(pinWrap);
  pinRow.append(pinPad);
  let pinMounted = false;
  // Mirrors `state.page` for `syncPin`, which the scroll listener can fire before the next render.
  let page: MarketplaceViewState["page"] = initial.page;

  const mountPin = (): void => {
    if (pinMounted) return;
    pinMounted = true;
    pinBand.append(pinRow);
    if (pinSearch.input.value !== input.value) pinSearch.input.value = input.value;
  };
  const unmountPin = (): void => {
    if (!pinMounted) return;
    pinMounted = false;
    pinRow.remove();
  };

  /**
   * The search field is a MARKETPLACE-page affordance, and official's other pages do not carry it at
   * all — measured: 页 2 管理插件和技能 and every pushed page contain ZERO `<input>` nodes, not one
   * hidden one. Hiding it with `display:none` left a dead input in the tree on those pages, which is
   * why this unmounts the shell instead. It is inert either way (a `display:none` input cannot be
   * focused, so the manage page's filter was never reachable), so nothing is lost and the DOM now
   * matches. `syncPin` keys off `shell.isConnected` for the same reason.
   *
   * The HOLDER goes too, not just the shell. Measured on the deployed build: the emptied title row
   * still contributed `margin-bottom:18px` and the emptied holder `margin-bottom:20px`, and
   * `content` still carried `margin-top:-18px` — the pull-up that cancels the title row's own 18px
   * on 页 1. On 页 2 there is no title row, so all three are dead: 18 + 20 − 18 = +20px, and the
   * h1 measured at pane+42 against official's pane+22. Detaching both wrappers takes the h1 to
   * pane+22 and drops `content`'s pull-up for the same reason it does not exist upstream.
   */
  const unmountSearch = (): void => {
    mainSearch.shell.remove();
    searchHolder.remove();
    header.remove();
  };
  const mountSearch = (): void => {
    // Re-insert in the ORIGINAL order — `content` is [header, searchHolder, groups], and a plain
    // `append` would drop the field below the sections on the way back to 页 1. The holder goes in
    // FIRST: `insertBefore(header, searchHolder)` throws when `searchHolder` is not yet a child.
    if (!searchHolder.isConnected) content.insertBefore(searchHolder, groups);
    if (!header.isConnected) content.insertBefore(header, searchHolder);
    if (!mainSearch.shell.isConnected) searchHolder.append(mainSearch.shell);
    content.style.marginTop = "";
  };
  /** Cancel `PANE_HEADER_CLASSES`' -18px pull-up: it exists to cancel the title row's 18px, and on
   *  the pages that have no title row there is nothing to cancel. */
  const releaseContentPullUp = (): void => {
    content.style.marginTop = "0px";
  };

  /**
   * Official's switch, reproduced from its measured geometry rather than a scroll listener with a
   * magic number: the band is a real 48px strip and the pinned field appears once the in-flow
   * field's bottom edge has passed the band's bottom edge. On official that boundary sits between
   * scrollTop 78 (one input) and 79 (two inputs); computing it from the two rects reproduces the
   * same switch and — unlike a hardcoded 79 — stays correct if either box changes size.
   *
   * Comparing the two rects directly (rather than through the scroller) also makes this a no-op
   * for free whenever the field is not scrolled: at rest the field's bottom is below the band's.
   */
  const syncPin = (): void => {
    if (page !== "browse") {
      unmountPin();
      return;
    }
    if (!mainSearch.shell.isConnected) {
      unmountPin();
      return;
    }
    const bandBottom = pinBand.getBoundingClientRect().bottom;
    const fieldBottom = searchHolder.getBoundingClientRect().bottom;
    if (fieldBottom < bandBottom) mountPin();
    else unmountPin();
  };

  const onScroll = (): void => syncPin();
  pane.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  // The page body lives in its own container so re-rendering a page never disturbs the header
  // and the search field, which stay mounted across the 市场 ↔ 管理 swap.
  const groups = el("div", [GROUPS_HOLDER_MARKER]);
  content.append(groups);

  paneWrapper.append(content);
  pane.append(paneWrapper);
  layout.append(pane);
  dialog.append(layout);
  layer.append(dialog);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      handlers.close();
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  scrim.addEventListener("click", () => handlers.close());

  let lastPage: MarketplacePageKind = initial.page;
  const render = (state: MarketplaceViewState): void => {
    // Official pushes a page rather than swapping content in place, and each pushed page opens
    // scrolled to its own top. Detecting the change here keeps that from depending on which
    // handler happened to move the page.
    const pushed = state.page !== lastPage;
    lastPage = state.page;
    dialog.setAttribute("aria-label", TEXT.market);
    // Header: the marketplace page carries the `h2` title + installed preview; the manage page
    // carries the back bar with the "管理" detail title. Upstream swaps them, it does not stack.
    header.replaceChildren();
    if (state.page === "section" || state.page === "detail" || state.page === "skill") {
      // Both pushed pages share one header: `sand-settings-detail-bar` carrying an icon-only
      // 返回 at x=43 and the page name centred. Official centres the title rather than
      // left-aligning it — measured x=404 for 精选插件 (w=56) and x=413 for Gmail (w=38), both
      // landing on the bar's 432px midline — so the class list alone reproduces it.
      // A pushed page's header title is the payload's own name. The skill surface joins the same
      // bar: an icon-only 返回 on the left, the skill's name centred, exactly like 插件详情.
      const pushedTitle =
        state.page === "detail"
          ? (state.detailRow?.name ?? "")
          : state.page === "skill"
            ? (state.skillDetail?.name ?? "")
            : (state.sectionGroup?.title ?? TEXT.market);
      const bar = el("div", DETAIL_BAR_CLASSES);
      const leading = el("div", DETAIL_BAR_LEADING_CLASSES);
      const backButton = el("button", DETAIL_BACK_BUTTON_CLASSES);
      backButton.type = "button";
      backButton.setAttribute("aria-label", TEXT.back);
      const backIcon = el("span", ICON_SPAN_CLASSES);
      backIcon.setAttribute("aria-hidden", "true");
      backIcon.append(glyph("chevron-left", GLYPH.chevronLeft, 16));
      backButton.append(backIcon);
      backButton.addEventListener("click", () => handlers.onBack());
      leading.append(backButton);
      bar.append(leading);
      const detailTitle = el("h3", DETAIL_TITLE_CENTERED_CLASSES, pushedTitle);
      detailTitle.id = "sand-plugins-modal-heading";
      bar.append(detailTitle);
      // A pushed page's bar occupies the same 48px band the manage page uses — measured on official
      // 插件详情: strip[17] > row[10] > `sand-settings-detail-bar` at 798x48 y=161, with the
      // scroller starting right below it. Kept in the scroller header it measured 734x48 y=216.
      clearBand();
      mountBar(bar);
      unmountSearch();
      releaseContentPullUp();
    } else if (state.page === "manage") {
      // The bar belongs in the 48px band, NOT in the scroller's header.
      // `header` stays empty on this page, exactly as official leaves it, so nothing is appended
      // below the band and the groups start at the band's bottom edge.
      clearBand();
      const bar = el("div", BACK_BAR_CLASSES);
      const leading = el("div", BACK_LEADING_CLASSES);
      const backButton = el("button", MANAGE_BACK_BUTTON_CLASSES);
      backButton.type = "button";
      const backIcon = el("span", ICON_SPAN_CLASSES);
      backIcon.setAttribute("aria-hidden", "true");
      backIcon.append(glyph("chevron-left", GLYPH.chevronLeft, 12));
      backButton.append(backIcon);
      backButton.append(el("span", BACK_LABEL_CLASSES, TEXT.market));
      backButton.addEventListener("click", () => handlers.backToMarket());
      leading.append(backButton);
      bar.append(leading);
      const detailTitle = el("h3", DETAIL_TITLE_CLASSES, TEXT.manage);
      detailTitle.id = "sand-plugins-modal-heading";
      bar.append(detailTitle);
      bar.append(el("div", BACK_TRAILING_CLASSES));
      mountBar(bar);
      unmountSearch();
      releaseContentPullUp();
    } else {
      // `header` already carries TITLE_ROW_CLASSES — it IS official's single header row. The h2
      // and the trailing slot go straight into it. Wrapping them in a second row here nested two
      // elements both carrying `sand-1c436fg`, so the header measured 42px instead of 24px (24 + the
      // 18px margin-bottom the outer one added) and pushed the search field 18px below where
      // official puts it, taking every section with it.
      const h2 = el("h2", PANE_TITLE_CLASSES, TEXT.market);
      h2.id = "sand-plugins-modal-heading";
      header.append(h2);
      const trailing = el("div", TITLE_TRAILING_CLASSES);
      trailing.append(buildInstalledPreview(state, handlers));
      header.append(trailing);
      clearBand();
      mountSearch();
    }

    if (input.value !== state.query) input.value = state.query;
    // The pinned input is the same controlled field; keep it in step so a query typed into either
    // copy reads the same in both. Measured on official: typing in the pinned field leaves BOTH
    // inputs holding the text and filters the list below.
    if (pinSearch.input.value !== state.query) pinSearch.input.value = state.query;

    page = state.page;
    if (state.page === "manage") renderManage(groups, state, handlers);
    else if (state.page === "section" && state.sectionGroup != null) {
      renderSection(groups, state.sectionGroup, state, handlers);
    } else if (state.page === "detail" && state.detailRow != null) {
      renderDetail(groups, state.detailRow, state, handlers);
    } else if (state.page === "skill" && state.skillDetail != null) {
      renderSkillDetail(groups, state.skillDetail, state, handlers);
    } else renderBrowse(groups, state, handlers);
    // A pushed page always starts at the top of its own content; official's scroller resets on
    // every push, so arriving mid-scroll after 返回 would be a navigation the user never made.
    if (pushed) pane.scrollTop = 0;
    // Re-check after the body swapped: official keeps the band empty on the manage page whatever
    // the scroll position, and the browse page can become non-scrollable after a search, which
    // must retract the pinned field too.
    syncPin();
  };

  const destroy = (): void => {
    document.removeEventListener("keydown", onKeydown, true);
    pane.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    layer.remove();
  };

  return { root: layer, render, destroy };
}

export { buildPendingPill, buildBackToMarket };
