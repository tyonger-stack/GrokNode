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
  BACK_TRAILING_CLASSES,
  BACK_TO_MARKET_CLASSES,
  CLOSE_BUTTON_CLASSES,
  DIALOG_CLASSES,
  DETAIL_TITLE_CLASSES,
  EMPTY_TEXT_CLASSES,
  EXPANDED_ROWS_CLASSES,
  GLYPH,
  GRID_CLASSES,
  GRID_FULLWIDTH_CLASSES,
  GROUP_ACTION_CLASSES,
  GROUP_SECTION_CLASSES,
  GROUP_TITLE_CLASSES,
  GROUPS_CLASSES,
  HIDDEN_ROWS_CLASSES,
  ICON_GLYPH_CLASSES,
  ICON_SPAN_CLASSES,
  INSTALLED_PREVIEW_CLASSES,
  LAYOUT_CLASSES,
  LIFTED_OFFICIAL_RULES,
  MANAGE_H1_CLASSES,
  MANAGE_HEADER_CLASSES,
  MARKETPLACE_ROOT_CLASSES,
  MARKET_SCOPE_CLASS,
  OVERFLOW_GRID_HOLDER_CLASSES,
  OVERFLOW_INNER_CLASSES,
  PANE_CLASSES,
  PANE_HEADER_CLASSES,
  PANE_WRAPPER_CLASSES,
  PANE_TITLE_CLASSES,
  PREVIEW_COUNT_CLASSES,
  PREVIEW_ICON_FIRST_CLASSES,
  PREVIEW_ICON_REST_CLASSES,
  PREVIEW_ICON_STACK_CLASSES,
  ROW_ITEM_CLASSES,
  ROW_MAIN_CLASSES,
  ROW_NAME_CLASSES,
  ROW_OPEN_CLASSES,
  ROW_SUBTITLE_CLASSES,
  ROW_TRAILING_CLASSES,
  SEARCH_FIELD_INNER_CLASSES,
  SEARCH_FIELD_SHELL_CLASSES,
  SEARCH_HOLDER_CLASSES,
  SEARCH_INPUT_CLASSES,
  SECTION_OUTER_CLASSES,
  SECTION_ROW_CLASSES,
  SECTION_TITLE_CLASSES,
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
  HOMEPAGE_PREVIEW_LIMIT,
  PREVIEW_ICON_LIMIT,
  MANAGE_VISIBLE_ROWS,
  TEXT,
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
  const glyphNode = document.createElement("i");
  applyClasses(glyphNode, ICON_GLYPH_CLASSES);
  glyphNode.setAttribute("data-icon-name", name);
  glyphNode.setAttribute("aria-hidden", "true");
  glyphNode.style.setProperty("--cursor-icon-content", JSON.stringify(codePoint));
  glyphNode.style.setProperty("--icon-size", `${size}px`);
  return glyphNode;
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
    // The scroller starts 48px below the layout's top edge in official 0.66 (dialog-relative
    // y=49, height 652 = 700-48). Upstream gets that band from classes the 0.18 stylesheet does
    // not carry, so it is pinned here rather than approximated by nudging the header.
    `${scope} .${SCROLL_MARKER}{min-height:0 !important;flex:1 1 auto !important;margin-top:48px !important;overflow-y:auto !important;overscroll-behavior:contain !important;}`,
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
const PREVIEW_STACK_MARKER = "sand-mkt-preview-stack";
const PREVIEW_BUTTON_MARKER = "sand-mkt-installed-preview";

/* ------------------------------------------------------------------ *
 * View state
 * ------------------------------------------------------------------ */

export interface MarketplaceViewState {
  readonly model: MarketplaceModel;
  readonly installed: readonly InstalledRow[];
  readonly skills: readonly PrivateSkill[];
  readonly servers: readonly McpServer[];
  /** Which page: the marketplace, or the manage sub-view. */
  page: "browse" | "manage";
  query: string;
  /** `onExpandInstalled` is a one-way latch upstream; it resets when the manage view is left. */
  installedExpanded: boolean;
  busy: boolean;
  /** The catalog round-trip is in flight; upstream shows `正在加载市场…` for this. */
  loading: boolean;
  /** Non-null when the catalog call failed. Kept separate from `loading` so a failure is not
   *  indistinguishable from an account with no plugins. */
  catalogError: string | null;
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
  readonly onViewAll: (group: BrowseGroup) => void;
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
  main.append(el("span", ROW_NAME_CLASSES, name));
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
  options: { readonly limit: number; readonly alwaysShowAction: boolean },
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
  const overflows = options.alwaysShowAction
    ? items.length > options.limit
    : items.length > options.limit;
  if (overflows) {
    const action = el("button", GROUP_ACTION_CLASSES, TEXT.viewAll);
    action.type = "button";
    action.addEventListener("click", () =>
      handlers.onViewAll({ key: titleId, title, items }),
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
function buildGroupSection(title: string, titleId: string, body: HTMLElement): HTMLElement {
  const section = el("section", GROUP_SECTION_CLASSES);
  section.setAttribute("aria-labelledby", titleId);
  const header = el("div", SECTION_ROW_CLASSES);
  const heading = el("h3", GROUP_TITLE_CLASSES, title);
  heading.id = titleId;
  header.append(heading);
  section.append(header);
  section.append(body);
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
        alwaysShowAction: false,
      }),
    );
  }
  if (model.showsTrailingBrowse && model.featured.length > 0) {
    root.append(
      buildHomepageSection(TEXT.featured, "mkt-featured", model.featured, state, handlers, {
        limit: HOMEPAGE_PREVIEW_LIMIT,
        alwaysShowAction: true,
      }),
    );
  }
  // 团队插件 is hoisted ABOVE the trailing category list and is a named section here; upstream
  // renders it as an unnamed group, but the live 0.66 build shows a titled 团队插件 heading, so the
  // heading is what this port reproduces.
  root.append(
    buildHomepageSection(TEXT.team, "mkt-team", model.team, state, handlers, {
      limit: HOMEPAGE_PREVIEW_LIMIT,
      alwaysShowAction: false,
    }),
  );
  for (const group of model.categoryGroups) {
    root.append(
      buildHomepageSection(group.title, group.key, group.items, state, handlers, {
        limit: HOMEPAGE_PREVIEW_LIMIT,
        alwaysShowAction: true,
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

  const installedBody = el("div", OVERFLOW_INNER_CLASSES);
  if (matchedInstalled.length === 0) {
    installedBody.append(
      buildEmptyState(searching ? `没有已安装的插件匹配“${trimmed}”` : TEXT.noInstalled),
    );
  } else {
    const grid = el("ul", GRID_CLASSES);
    for (const item of first) grid.append(buildInstalledRow(item, handlers));
    installedBody.append(grid);

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
      const inner = el("div", OVERFLOW_INNER_CLASSES);
      const gridHolder = el("div", OVERFLOW_GRID_HOLDER_CLASSES);
      const restGrid = el("ul", GRID_CLASSES);
      for (const item of rest) restGrid.append(buildInstalledRow(item, handlers));
      gridHolder.append(restGrid);
      inner.append(gridHolder);
      holder.append(inner);
      installedBody.append(holder);

      if (!state.installedExpanded) {
        const wrap = el("div", OVERFLOW_INNER_CLASSES);
        const showAll = el("button", SHOW_ALL_CLASSES, showAllLabel(matchedInstalled.length));
        showAll.type = "button";
        showAll.addEventListener("click", () => handlers.onToggleInstalledExpanded());
        wrap.append(showAll);
        installedBody.append(wrap);
      }
    }
  }
  root.append(buildGroupSection(TEXT.installed, "mkt-installed", installedBody));

  // ---- 私有技能 ----
  const skillBody = el("div", OVERFLOW_INNER_CLASSES);
  const matchedSkills = searching
    ? skills.filter((skill) => skill.name.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()))
    : skills;
  if (matchedSkills.length === 0) {
    skillBody.append(
      buildEmptyState(searching ? `没有私有技能匹配“${trimmed}”` : TEXT.noPrivateSkills),
    );
  } else {
    const grid = el("ul", GRID_FULLWIDTH_CLASSES);
    for (const skill of matchedSkills) grid.append(buildSkillRow(skill, handlers));
    skillBody.append(grid);
  }
  root.append(buildGroupSection(TEXT.privateSkills, "mkt-private-skills", skillBody));

  groups.replaceChildren(root);
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
  const shell = el("div", SEARCH_FIELD_SHELL_CLASSES);
  applyClasses(shell, [SEARCH_SHELL_MARKER]);
  const inner = el("div", SEARCH_FIELD_INNER_CLASSES);
  applyClasses(inner, [SEARCH_INNER_MARKER]);
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
  input.addEventListener("input", () => handlers.onQuery(input.value));
  inner.append(input);
  shell.append(inner);
  searchHolder.append(shell);
  content.append(searchHolder);

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

  const render = (state: MarketplaceViewState): void => {
    dialog.setAttribute("aria-label", state.page === "manage" ? TEXT.market : TEXT.market);
    // Header: the marketplace page carries the `h2` title + installed preview; the manage page
    // carries the back bar with the "管理" detail title. Upstream swaps them, it does not stack.
    header.replaceChildren();
    if (state.page === "manage") {
      const bar = el("div", BACK_BAR_CLASSES);
      const leading = el("div", BACK_LEADING_CLASSES);
      const backButton = el("button", BACK_BUTTON_CLASSES);
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
      header.append(bar);
      searchHolder.style.display = "none";
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
      searchHolder.style.display = "";
    }

    if (input.value !== state.query) input.value = state.query;

    if (state.page === "manage") renderManage(groups, state, handlers);
    else renderBrowse(groups, state, handlers);
  };

  const destroy = (): void => {
    document.removeEventListener("keydown", onKeydown, true);
    layer.remove();
  };

  return { root: layer, render, destroy };
}

export { buildPendingPill, buildBackToMarket };
