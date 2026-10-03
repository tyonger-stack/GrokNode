/**
 * Official 0.66 marketplace class lists and lifted declarations.
 *
 * Every class name here was read off the running 0.66 renderer (CDP `className` dumps) or out of
 * the shipped stylesheet, never invented. stylix derives a class name purely from its declaration
 * block, so a declaration that also exists in 0.18 hashes to the SAME name in both versions —
 * 146 of the 190 official class names referenced by this surface are already present verbatim in
 * 0.18's `index-*.css`. The remaining 44 are lifted byte-for-byte from the official stylesheet
 * (see LIFTED_OFFICIAL_RULES), scoped under `.sand-mkt` so they cannot leak into any 0.18
 * component that happens to reuse one of these names.
 *
 * That is why the colours match without hand-tuning a palette: the official dialog paints
 * `background: rgb(252,252,252)` and the official pills draw `var(--sand-bg-elevated)` /
 * `var(--sand-border-weak)` — both of which resolve inside 0.18 unchanged.
 *
 * Dialog shell note: 0.18 and 0.66 share the same `ui-dialog` primitive and therefore the same
 * `ui-*` class names for the parts they have in common, but the six `ui-*` hashes between
 * `ui-2kampu` and `ui-1pkpdue` differ (same declarations, different hash) and the trailing recipe
 * differs. DIALOG_CLASSES therefore reuses 0.18's OWN `ui-*` list — those rules exist in 0.18's
 * stylesheet and are known-good — and layers the three official `sand-*` classes on top, which is
 * where the 800px width actually comes from.
 */

/* ------------------------------------------------------------------ *
 * Lifted official declarations absent from 0.18's stylesheet
 * ------------------------------------------------------------------ */

/**
 * `[className, declarations]` or `[className, declarations, pseudo]`.
 *
 * The optional third element is the part of upstream's selector that follows the class name, and
 * it is not optional in spirit: stylix emits pseudo-class and pseudo-element rules as separate
 * class+selector pairs, and several of the official rules below are *only* meaningful with it.
 * Dropping it turns a state into permanent chrome — that is exactly what happened to the row
 * focus ring. Official 0.66 declares
 *
 *     .sand-1t8vtw7:focus-visible::after { box-shadow: inset 0 0 0 2px … }
 *
 * and lifting it as a bare `.sand-1t8vtw7 { box-shadow: … }` painted a 2px inset border around
 * *every* plugin row at all times. Same for `sand-1w00h3t` (a `::after` radius) and
 * `sand-1iolv91` (a `:focus-visible` outline colour). Nothing caught it: the declarations were
 * copied verbatim, the class names were real, and every source-level assertion still passed. The
 * tell was a screenshot — a 1px box around rows that official renders bare.
 */
export const LIFTED_OFFICIAL_RULES: ReadonlyArray<readonly [string, string] | readonly [string, string, string]> = [
  ["sand-11lfxj5", "padding-inline-end:4px"],
  ["sand-1453kmi", "margin-inline-end:12px"],
  ["sand-15zmtp0", "padding-inline-end:48px"],
  ["sand-16mx7xq", "padding-inline-start:32px"],
  ["sand-19tkhrw", "padding-inline-start:8px"],
  ["sand-1ap1fj8", "column-gap:8px"],
  ["sand-1bvilyr", "transform:translateY(-4px)"],
  ["sand-1c436fg", "margin-bottom:18px"],
  // Official 0.66 declares these two unscoped:
  //   .sand-1c1uobl { padding-inline-start: 0px }   .sand-yri2b { padding-inline-end: 0px }
  // 0.18 ships the same declarations but scoped to the dock rail (`.sand-plugins-dock-rail …`),
  // so they never reach the marketplace grid and the browser default `ul { padding-inline-start:
  // 40px }` survives. Symptom: every row sat 40px right of where official puts it and the two
  // columns came out 343px wide instead of 363px. Same declaration, same hash, different selector
  // scope across versions — a case the class-name-equivalence rule alone does not cover.
  ["sand-1c1uobl", "padding-inline-start:0"],
  ["sand-yri2b", "padding-inline-end:0"],
  ["sand-1cxnnaq", "transition-duration:.12s"],
  ["sand-1erjwpq", "transition-property:grid-template-rows,opacity"],
  ["sand-1gy1zxj", "max-width:calc(100vw - 32px)"],
  ["sand-1gzmo1b", "margin-top:-18px"],
  ["sand-1iolv91", "outline-color:var(--sand-border-focus)", ":focus-visible"],
  ["sand-1lt80kd", "border-color:var(--sand-bg-elevated)"],
  ["sand-1lziwak", "margin-inline-start:0"],
  ["sand-1mfogq2", "padding-inline-start:32px"],
  ["sand-1qab1bc", "justify-self:end"],
  ["sand-1t8vtw7", "box-shadow:inset 0 0 0 2px var(--cursor-stroke-focused)", ":focus-visible::after"],
  ["sand-1w00h3t", "border-radius:16px", "::after"],
  ["sand-1yc453h", "text-align:start"],
  ["sand-37c5m6", "grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)"],
  ["sand-5orbwg", "animation-duration:.7s"],
  ["sand-aso8d8", "padding-inline-start:5px"],
  ["sand-c8icb0", "isolation:isolate"],
  ["sand-e2zdcy", "padding-inline-start:10px"],
  ["sand-ftzfs8", "padding-inline-end:8px"],
  ["sand-h5t8r0", "transition-duration:.15s"],
  ["sand-h6vr4k", "width:min(800px,calc(100vw - 40px))"],
  ["sand-icbapw", "transition-property:grid-template-rows,opacity,transform"],
  ["sand-idyk7z", "transition-duration:.26s"],
  ["sand-ihq33y", "grid-template-rows:0fr"],
  ["sand-j7smf7", "padding-inline-end:12px"],
  ["sand-l8qfz3", "max-height:94px"],
  ["sand-mzvs34", "padding-inline-start:8px"],
  ["sand-o2ifbc", "inset-inline-end:10px"],
  ["sand-s2i5tn", "padding-inline-start:12px"],
  ["sand-sfy40s", "padding-inline-end:32px"],
  ["sand-tijo5x", "inset-inline-end:0"],
  ["sand-w01apr", "margin-inline-start:-6px"],
  ["sand-z03ioa", "height:min(700px,calc(100vh - 96px))"],
];

/* ------------------------------------------------------------------ *
 * Dialog shell
 * ------------------------------------------------------------------ */

/** 0.18's own `ui-dialog` class list, read off the running 0.18 build. Those `ui-*` rules exist in
 *  0.18's stylesheet, so the shell is styled without lifting anything; only the three `sand-*`
 *  classes that carry the 0.66 geometry are added on top. */
export const DIALOG_CLASSES = [
  "ui-dialog", "ui-ixxii4", "ui-wa60dl", "ui-1nrll8i", "ui-3vbryh", "ui-78zum5", "ui-dt5ytf",
  "ui-f1vpex", "ui-178xt8z", "ui-13fuv20", "ui-2kampu", "ui-s1s249", "ui-32b0ac", "ui-hnkhp4",
  "ui-so031l", "ui-1q0q8m5", "ui-1jfuf7k", "ui-e0pwq", "ui-19ypqd9", "ui-1l09f48", "ui-1pkpdue",
  "ui-6ikm8r", "ui-10wlt62", "ui-1acoasx", "ui-11wthnw", "ui-1wd3ewq", "ui-1t137rt", "ui-chxttu",
  "ui-4afe7t", "ui-lzhlbq", "ui-10e4vud", "ui-11i3ho8",
  "sand-1a5igra", "sand-11lhmoz", "sand-9f619", "sand-qyufaf",
  "ui-dialog--xxl",
  "sand-plugins-dialog",
  // official 0.66 recipe: `me("sand-plugins-dialog", "sand-h6vr4k sand-1gy1zxj sand-1717udv")`
  "sand-h6vr4k", "sand-1gy1zxj", "sand-1717udv",
];

export const LAYOUT_CLASSES = [
  "sand-plugins-layout", "sand-9f619", "sand-1n2onr6", "sand-78zum5", "sand-dt5ytf", "sand-z03ioa",
  "sand-2lwn1j", "sand-7giv3",
];

export const PANE_CLASSES = [
  "sand-plugins", "sand-9f619", "sand-78zum5", "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9",
  "sand-dt5ytf", "sand-2lwn1j",
];

/**
 * The `sand-settings-pane` wrapper: the scroller's only child, and the layer that makes the
 * official header land where it does.
 *
 * This layer is load-bearing and reads like redundant padding. Measured against official 0.66
 * (dialog-relative): the title row sits at y=53 and the search field at y=95, both at x=33.
 * That comes from `padding-top: 22px` (`sand-1xy6bms`) + `padding-inline-start: 32px`
 * (`sand-16mx7xq`) here, applied to pane content that carries `margin-top: -18px`
 * (`sand-1gzmo1b`, below) and a 32px start indent on the title (`sand-1g0dm76`). The -18 only
 * nets out to +4 against the +22 above it.
 *
 * An earlier build applied `sand-1gzmo1b` straight onto the header wrapper with no pane around
 * it, so the -18px had nothing to cancel it: the whole content block rode 70px above the
 * dialog's top edge, the dialog's `overflow:hidden` clipped it away, and the 市场 title plus the
 * 已安装 preview disappeared from the render. The clip was not merely cosmetic — a clipped
 * region takes no hit test, so the page-1 → page-2 button stopped responding to a real mouse
 * and clicks fell through to the scrim, which closed the dialog. Static assertions and the full
 * test suite were green throughout; only `document.elementFromPoint` over the button showed it.
 *
 * `sand-1s169rl` is official's own class for this wrapper and does not exist in 0.18's
 * stylesheet, so the two declarations it carried are supplied by the scoped rule in
 * `view.ts` (`PANE_WRAPPER_MARKER`) instead of being invented here.
 */
export const PANE_WRAPPER_CLASSES = [
  "sand-settings-pane", "sand-9f619", "sand-1xy6bms", "sand-1s169rl", "sand-84yb8i", "sand-16mx7xq",
];

export const MARKETPLACE_ROOT_CLASSES = [
  "sand-plugins__marketplace", "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1665zp3",
];

export const YOURS_ROOT_CLASSES = [
  "sand-plugins__yours", "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1665zp3",
];

/* ------------------------------------------------------------------ *
 * Close button
 * ------------------------------------------------------------------ */
export const CLOSE_BUTTON_CLASSES = [
  "sand-plugins-dialog__close", "sand-kit-icon-button", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k",
  "sand-2lah0s", "sand-9f619", "sand-exx8yu", "sand-yri2b", "sand-18d9i69", "sand-1c1uobl",
  "sand-c342km", "sand-ng3xce", "sand-1ypdohk", "sand-tgyt42", "sand-s2xxs2", "sand-1firant",
  "sand-9lcvmn", "sand-1k57tk5", "sand-784prv", "sand-1t137rt", "sand-9v5kkp", "sand-4sht9k",
  "sand-1y3gkto", "sand-gd8bvy", "sand-1fgtraw", "sand-149ho13", "sand-jbqb8w", "sand-1r8pydn",
  "sand-1o0liin", "sand-1fx2joi", "sand-7n8uir", "sand-10l6tqk", "sand-1eu8d0j", "sand-o2ifbc",
  "sand-zkaem6",
];

export const ICON_SPAN_CLASSES = [
  "sand-kit-icon", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k", "sand-2lah0s", "sand-1heor9g",
  "sand-w4jnvo", "sand-1qx5ct2",
];

/* ------------------------------------------------------------------ *
 * Headers
 * ------------------------------------------------------------------ */

/** `Xa` (d=1138) outer wrapper — the pane header column. */
export const PANE_HEADER_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-euugli", "sand-1gzmo1b",
];

/** `Xa` title row: `<h2 id>{title}</h2>` + the `titleTrailing` wrapper. */
export const TITLE_ROW_CLASSES = ["sand-1n2onr6", "sand-euugli", "sand-1c436fg"];

/**
 * `St.title` on the `h2#sand-plugins-modal-heading`.
 *
 * Official's full list, measured off the running 0.66 renderer. The three size classes are the
 * ones that were missing: `sand-19d36u7` (font-size:17px), `sand-1o2sk6j` (line-height:24px) and
 * `sand-1deyeav` (letter-spacing:-0.008em). They are what give the title its 24px row height —
 * without them the header collapses to 17px and the `top:50%` / `translateY(-50%)` installed
 * preview centres itself against the wrong box.
 */
export const PANE_TITLE_CLASSES = [
  "sand-19d36u7", "sand-1o2sk6j", "sand-1deyeav", "sand-1ghz6dp", "sand-pdmqnj", "sand-1g0dm76",
  "sand-1wd3ewq", "sand-1rhlpx6",
];

/** `Xa` `titleTrailing` wrapper around the installed-preview button. */
export const TITLE_TRAILING_CLASSES = [
  "sand-10l6tqk", "sand-tijo5x", "sand-wa60dl", "sand-1cb1t30",
];

/** `Xa` search holder. */
export const SEARCH_HOLDER_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-xhr3t", "sand-euugli", "sand-ieb3on",
];

/** `Xa` groups container. */
export const GROUPS_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1665zp3", "sand-euugli",
];

/* --- back bar (manage view header) --- */
export const BACK_BAR_CLASSES = [
  "sand-settings-detail-bar", "sand-9f619", "sand-rvj5dj", "sand-37c5m6", "sand-6s0dn4",
  "sand-sdox4t", "sand-889kno", "sand-2vl965", "sand-1a8lsjc", "sand-e2zdcy",
];

export const BACK_LEADING_CLASSES = ["sand-1lqcxt8", "sand-euugli"];
export const BACK_TRAILING_CLASSES = ["sand-78zum5", "sand-6s0dn4", "sand-1qab1bc", "sand-euugli"];

export const BACK_BUTTON_CLASSES = [
  "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-195vfkc", "sand-193iq5w", "sand-1fgtraw",
  "sand-exx8yu", "sand-2vl965", "sand-18d9i69", "sand-25sj25", "sand-c342km", "sand-ng3xce",
  "sand-149ho13", "sand-jbqb8w", "sand-aalx5g", "sand-jb2p0i", "sand-1ypdohk", "sand-1t137rt",
  "sand-9v5kkp", "sand-1k57tk5", "sand-784prv", "sand-1uczgqu", "sand-1iolv91",
];

export const BACK_LABEL_CLASSES = ["sand-b3r6kr", "sand-lyipyv", "sand-uxw1ft"];

/** `ft` detail title — renders "管理" on the manage view. */
export const DETAIL_TITLE_CLASSES = [
  "sand-9f619", "sand-dj266r", "sand-14z9mp", "sand-at24cr", "sand-1lziwak", "sand-b3r6kr",
  "sand-1rhlpx6", "sand-1wd3ewq", "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9", "sand-euugli",
  "sand-2b8uid", "sand-lyipyv", "sand-uxw1ft", "sand-19991ni", "sand-h5t8r0", "sand-12w9bfk",
  "sand-9lcvmn", "sand-g01cxk",
];

/* ------------------------------------------------------------------ *
 * Installed-preview header button (`Bt`, d=1147)
 * ------------------------------------------------------------------ */
export const INSTALLED_PREVIEW_CLASSES = [
  "sand-plugins__installed-preview", "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-qcrz7y",
  "sand-167g77z", "sand-euugli", "sand-1iorvi4", "sand-f159sx", "sand-jkvuk6", "sand-135b78x",
  "sand-c342km", "sand-ng3xce", "sand-1qmwy7c", "sand-jbqb8w", "sand-aalx5g", "sand-1o0liin",
  "sand-jb2p0i", "sand-1wm8ruf", "sand-1d3mw78", "sand-12oo3zp", "sand-1ypdohk", "sand-1t137rt",
  "sand-9v5kkp", "sand-1k57tk5", "sand-784prv", "sand-1uczgqu", "sand-1iolv91",
];

/** The back-to-marketplace button that replaces the preview on the manage view. */
export const BACK_TO_MARKET_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-qcrz7y", "sand-17d4w8g", "sand-10w6t97",
  "sand-euugli", "sand-1iorvi4", "sand-f159sx", "sand-jkvuk6", "sand-135b78x", "sand-c342km",
  "sand-ng3xce", "sand-1qmwy7c", "sand-jbqb8w", "sand-aalx5g", "sand-1o0liin", "sand-jb2p0i",
  "sand-1wm8ruf", "sand-1d3mw78", "sand-12oo3zp", "sand-1ypdohk", "sand-1t137rt", "sand-9v5kkp",
  "sand-1k57tk5", "sand-784prv", "sand-1uczgqu", "sand-1iolv91",
];

export const PREVIEW_ICON_STACK_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9",
];
export const PREVIEW_ICON_FIRST_CLASSES = [
  "sand-9f619", "sand-1n2onr6", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k", "sand-w4jnvo",
  "sand-1qx5ct2", "sand-mkeg23", "sand-1y0btm7", "sand-1lt80kd", "sand-t9pb60", "sand-10e981r",
  "sand-b3r6kr",
];
/** Official `{0: FIRST, 1: REST}[i>0]` — every icon after the first also gets `sand-w01apr`. */
export const PREVIEW_ICON_REST_CLASSES = [...PREVIEW_ICON_FIRST_CLASSES, "sand-w01apr"];
export const PREVIEW_COUNT_CLASSES = ["sand-9f619", "sand-b3r6kr", "sand-lyipyv", "sand-uxw1ft"];

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */
export const SEARCH_FIELD_SHELL_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9", "sand-6s0dn4",
  "sand-167g77z", "sand-euugli",
];
export const SEARCH_FIELD_INNER_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9", "sand-6s0dn4",
  "sand-1jnr06f", "sand-10w6t97", "sand-euugli", "sand-exx8yu", "sand-11lfxj5", "sand-18d9i69",
  "sand-mzvs34", "sand-qjedn3", "sand-1y0btm7", "sand-q03nf1", "sand-5obw34", "sand-149ho13",
  "sand-1tiofj7",
];
export const SEARCH_INPUT_CLASSES = [
  "sand-9f619", "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9", "sand-euugli", "sand-c342km",
  "sand-ng3xce", "sand-1t137rt", "sand-jbqb8w", "sand-1wd3ewq", "sand-fc7y3v", "sand-1fc57z9",
  "sand-12oo3zp", "sand-ltfok3",
];

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/** `Us` (d=1139) — the homepage section wrapper (为你推荐 / 精选插件 / 团队插件 / 分类栏). */
export const SECTION_OUTER_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-167g77z", "sand-euugli",
];
export const SECTION_ROW_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-1pha0wt", "sand-1qughib", "sand-167g77z", "sand-euugli",
];
/** `St.groupTitle` on the section `h3[data-detail-hero-title]`. */
export const SECTION_TITLE_CLASSES = [
  "sand-1ghz6dp", "sand-1y1aw1k", "sand-f159sx", "sand-10b6aqq", "sand-1g0dm76", "sand-1wd3ewq",
  "sand-1rhlpx6",
];

/** `jt` (d=1162) — the section used by the manage view (已安装 / 私有技能). No
 *  `data-detail-hero-title` on its `h3`; that attribute belongs to `Us` and to the manage `h1`. */
export const GROUP_SECTION_CLASSES = [
  "sand-plugins__group", "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-xhr3t",
];
export const GROUP_TITLE_CLASSES = [
  "sand-9f619", "sand-1y1aw1k", "sand-f159sx", "sand-10b6aqq", "sand-1g0dm76", "sand-4b2ntj",
];

/** `button.sand-plugins__group-action` — 查看全部. */
export const GROUP_ACTION_CLASSES = [
  "sand-plugins__group-action", "sand-jyslct", "sand-1lugfcp", "sand-9f619", "sand-1c4vz4f",
  "sand-2lah0s", "sand-dl72j9", "sand-amitd3", "sand-1453kmi", "sand-1nn3v0j", "sand-ftzfs8",
  "sand-1120s5i", "sand-19tkhrw", "sand-c342km", "sand-ng3xce", "sand-149ho13", "sand-jbqb8w",
  "sand-aalx5g", "sand-19aaqeu", "sand-7gh5u8", "sand-jb2p0i", "sand-1wm8ruf", "sand-1d3mw78",
  "sand-1ypdohk", "sand-1t137rt", "sand-9v5kkp", "sand-1k57tk5", "sand-784prv", "sand-1uczgqu",
  "sand-1iolv91",
];

/** `button.sand-plugins__show-all` — 显示全部 N 个插件. */
export const SHOW_ALL_CLASSES = [
  "sand-plugins__show-all", "sand-9f619", "sand-qcrz7y", "sand-1iorvi4", "sand-f159sx",
  "sand-jkvuk6", "sand-1g0dm76", "sand-c342km", "sand-ng3xce", "sand-jbqb8w", "sand-19aaqeu",
  "sand-7gh5u8", "sand-jb2p0i", "sand-1wm8ruf", "sand-1ypdohk",
];

/** Collapsed-overflow wrapper — `grid-template-rows:0fr` + `sand-g01cxk` (visually hidden). */
export const HIDDEN_ROWS_CLASSES = [
  "sand-rvj5dj", "sand-ihq33y", "sand-g01cxk", "sand-1bvilyr", "sand-uupxpy", "sand-47corl",
  "sand-icbapw", "sand-1ympp8d", "sand-idyk7z", "sand-1cxnnaq", "sand-1e6nqfh",
];
/** Expanded-overflow wrapper — same box, but the `sand-g01cxk` collapse is removed. */
export const EXPANDED_ROWS_CLASSES = [
  "sand-rvj5dj", "sand-ihq33y", "sand-g01cxk", "sand-47corl", "sand-1erjwpq", "sand-1ympp8d",
  "sand-idyk7z", "sand-1cxnnaq", "sand-1e6nqfh",
];
export const OVERFLOW_INNER_CLASSES = ["sand-2lwn1j", "sand-b3r6kr"];
export const OVERFLOW_GRID_HOLDER_CLASSES = ["sand-1nn3v0j"];

/* ------------------------------------------------------------------ *
 * Grids and rows
 * ------------------------------------------------------------------ */
export const GRID_CLASSES = [
  // Official's list, read off the running 0.66 build. The leading semantic hook was the one class
  // it carried and we did not; everything after it matches in the same order.
  "sand-plugins__grid",
  "sand-9f619", "sand-rvj5dj",
  // `grid-template-columns:repeat(2,minmax(0,1fr))` — the two-column marketplace grid. It is NOT in
  // upstream's `Row`-adjacent style object the extraction reported (that list was assembled from
  // the second operand of `me()` merges and the `Ne` set was never extracted), so it was missing
  // and every section collapsed to a single column. Found by CSS.getMatchedStylesForNode against
  // the running official build, which reports the rule on the `ul`:
  //   .sand-nby9oq:not(#):not(#):not(#) { grid-template-columns:repeat(2,minmax(0,1fr)) }
  // The hash is identical in 0.18 — same declaration, same name — so this restores the official
  // layout with no lifted CSS.
  "sand-nby9oq",
  "sand-1ap1fj8", "sand-1dbijih", "sand-3ct3a4", "sand-dj266r",
  "sand-14z9mp", "sand-at24cr", "sand-1lziwak", "sand-exx8yu", "sand-yri2b", "sand-18d9i69",
  "sand-1c1uobl",
];
/** `isFullWidth` variant — 私有技能 rows. */
export const GRID_FULLWIDTH_CLASSES = [...GRID_CLASSES, "sand-1mkdm3x"];

export const ROW_ITEM_CLASSES = [
  "sand-plugins-row", "sand-9f619", "sand-1n2onr6", "sand-c8icb0", "sand-78zum5", "sand-6s0dn4",
  "sand-1v2ro7d", "sand-euugli", "sand-z9dl7a", "sand-j7smf7", "sand-sag5q8", "sand-s2i5tn",
  "sand-gqmno8", "sand-jbqb8w", "sand-1q5pob1",
];

export const ROW_OPEN_CLASSES = [
  "sand-plugins-row__open", "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-883omv",
  "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9", "sand-euugli", "sand-exx8yu", "sand-yri2b",
  "sand-18d9i69", "sand-1c1uobl", "sand-c342km", "sand-ng3xce", "sand-jbqb8w", "sand-1heor9g",
  "sand-jb2p0i", "sand-1yc453h", "sand-1ypdohk", "sand-1t137rt", "sand-1kogg8i", "sand-1s928wv",
  "sand-1j6awrg", "sand-arstr8", "sand-1w00h3t", "sand-1t8vtw7",
];

export const ROW_MAIN_CLASSES = [
  "sand-plugins-row__main", "sand-9f619", "sand-78zum5", "sand-1iyjqo2", "sand-s83m0k",
  "sand-dl72j9", "sand-dt5ytf", "sand-12mrbbr", "sand-euugli",
];
/** The name span. These are the classes upstream's style object calls the "row meta wrapper" —
 *  they belong ON the name, not on a wrapper around name+subtitle. Read off the running official
 *  build: `row__main` has exactly two children, this one and `sand-plugins-row__subtitle`. */
export const ROW_NAME_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-17d4w8g", "sand-euugli",
];
export const ROW_SUBTITLE_CLASSES = [
  "sand-plugins-row__subtitle", "sand-9f619", "sand-b3r6kr", "sand-11wthnw", "sand-d4r4e8",
  "sand-12oo3zp", "sand-19aaqeu", "sand-lyipyv", "sand-uxw1ft",
];
/** The row-opening variant of the trailing slot (upstream: `me({0: plain, 1: opensRow})`). Both
 *  measured on the running build — a marketplace row's trailing carries the extra two. */
export const ROW_TRAILING_CLASSES = [
  "sand-plugins-row__trailing", "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-17d4w8g",
  "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9", "sand-1n2onr6", "sand-1vjfegm",
];

/** Skill-row icon wrapper — `file-list` glyph, tertiary, sm. */
export const SKILL_ICON_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-l56j7k", "sand-100vrsf", "sand-1vqgdyp",
  "sand-2lah0s", "sand-1kogg8i", "sand-arj5zm",
];

/** `ToolIcon` box used by catalog rows. */
export const TOOL_ICON_CLASSES = [
  "sand-tool-icon", "sand-tool-icon--logo", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4",
  "sand-l56j7k", "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9", "sand-b3r6kr", "sand-qjedn3",
  "sand-1y0btm7", "sand-q03nf1", "sand-jbqb8w",
];
export const TOOL_IMG_CLASSES = ["sand-1lliihq", "sand-h8yej3", "sand-5yr21d", "sand-l1xv1r"];
/** Monogram fallback painted when an entry has no `iconUrl`. */
export const TOOL_ICON_FALLBACK_CLASSES = [
  "sand-9f619", "sand-1lliihq", "sand-h8yej3", "sand-5yr21d", "sand-l1xv1r", "sand-1tachi3",
];

/* ------------------------------------------------------------------ *
 * Trailing action: pills and buttons
 * ------------------------------------------------------------------ */

/** `span.sand-plugins__added` — 已添加 / 已连接 pill, plus the 12px `check` glyph. */
export const ADDED_PILL_CLASSES = [
  "sand-plugins__added", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-1nejdyq",
  "sand-1nn3v0j", "sand-f159sx", "sand-1120s5i", "sand-25sj25", "sand-149ho13", "sand-4b2ntj",
  "sand-1wm8ruf", "sand-1d3mw78", "sand-uxw1ft",
];
export const ADDED_PILL_CHECK_CLASSES = ["sand-9f619", "sand-98zg7y"];

/** `span.sand-plugins__status` base + the three tone modifiers. */
export const STATUS_BASE_CLASSES = [
  "sand-plugins__status", "sand-9f619", "sand-11wthnw", "sand-d4r4e8", "sand-12oo3zp",
  "sand-4b2ntj", "sand-uxw1ft",
];
export const STATUS_TONE_CLASSES = {
  connected: "sand-98zg7y",
  warn: "sand-1izesbo",
  error: "sand-pmgbkh",
} as const;

/** `span.sand-plugins__team-badge` — 团队 pill with a 12px `people` glyph. */
export const TEAM_BADGE_CLASSES = [
  "sand-plugins__team-badge", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-1jnr06f",
  "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9", "sand-4p5aij", "sand-1icxu4v", "sand-1j85h84",
  "sand-aso8d8", "sand-149ho13", "sand-jdhboh", "sand-4b2ntj", "sand-y5h43f", "sand-1d3mw78",
  "sand-uxw1ft",
];

/** `span.sand-plugins__add-pending` — 正在添加 {name} spinner. */
export const ADD_PENDING_CLASSES = [
  "sand-plugins__add-pending", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k",
  "sand-d7y6wv", "sand-2vl965", "sand-e2zdcy",
];

/** Secondary button used for 添加 / 连接. Mirrors the official `Button size=sm variant=secondary`
 *  call sites, which reuse the shared `sand-kit-button` recipe. */
export const ACTION_BUTTON_CLASSES = [
  "sand-kit-button", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-167g77z", "sand-euugli",
  "sand-1iorvi4", "sand-f159sx", "sand-jkvuk6", "sand-c342km", "sand-ng3xce", "sand-jbqb8w",
  "sand-1o0liin", "sand-jb2p0i", "sand-1wm8ruf", "sand-1d3mw78", "sand-12oo3zp", "sand-1ypdohk",
  "sand-1t137rt", "sand-9v5kkp", "sand-1k57tk5", "sand-784prv", "sand-1uczgqu", "sand-1iolv91",
];

/* ------------------------------------------------------------------ *
 * Manage view
 * ------------------------------------------------------------------ */
export const MANAGE_HEADER_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-euugli", "sand-f159sx", "sand-mzvs34",
];
export const MANAGE_H1_CLASSES = ["sand-1ghz6dp", "sand-1wd3ewq", "sand-1rhlpx6"];

export const EMPTY_TEXT_CLASSES = ["sand-9f619", "sand-f159sx", "sand-1g0dm76"];

/** Shared `ui-icon` glyph classes — 0.18 ships the same list, so the glyph renders from
 *  `var(--cursor-icon-content)` without any icon-specific class. */
export const ICON_GLYPH_CLASSES = [
  "ui-icon", "ui-1j61x8r", "ui-etm3q0", "ui-1tachi3", "ui-1qt6sjn", "ui-o5v014", "ui-3nfvp2",
  "ui-6s0dn4", "ui-l56j7k", "ui-1heor9g", "ui-1oai4fc", "ui-higkf7", "ui-xymvpz", "ui-krqix3",
  "ui-1403hyl", "ui-2b8uid", "ui-6mezaz", "ui-vmahel", "ui-lh3980", "ui-87ps6o", "ui-1winvzj",
  "ui-1u4itkb", "ui-1q5xvfy", "ui-jb5y04", "ui-1bxnb1t", "ui-1ehclkv", "ui-1yj7g93", "cursor-icon",
];

/** Codepoints behind the glyphs this surface uses. Every value was read off the live 0.66
 *  renderer's computed `--cursor-icon-content` custom property (a CSS string holding the literal
 *  glyph) and re-encoded as an escape so the PUA codepoints survive review — they are NOT
 *  inferable from the icon name, and guessing them renders blank boxes.
 *  Captured on both pages: close/chevron-left/file-list on the manage view, the rest on the
 *  marketplace view. */
export const GLYPH = {
  close: "\ued82",
  chevronRight: "\ueab6",
  chevronLeft: "\ueab5",
  search: "\uea6d",
  check: "\ueab2",
  people: "\uea7e",
  fileList: "\uec53",
} as const;

export const MARKET_SCOPE_CLASS = "sand-mkt";
