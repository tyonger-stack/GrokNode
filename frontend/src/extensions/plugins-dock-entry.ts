/**
 * Connect Apps footer surface: dock the upstream Plugins button onto the account row and render it
 * with the upstream 0.66 `data-sidebar-marketplace` pill — same stylix class names, same geometry,
 * same "suggested, not installed" logo semantics.
 *
 * Why class names instead of hand-written CSS: stylix derives a class name purely from its
 * declaration block, so a declaration that exists in 0.18 hashes to the *same* class name in 0.66.
 * 128 of the 158 class names on the official pill subtree already exist verbatim in 0.18's
 * stylesheet; the remaining 27 real rules are lifted byte-for-byte from the official stylesheet
 * (see LIFTED_OFFICIAL_RULES). That is why the colours match without hand-tuning a palette: the
 * official pill draws `background-color: var(--sand-bg-elevated)` and
 * `border-color: var(--sand-border-weak)`, whereas the previous version approximated the surface
 * with `--cursor-bg-secondary` / `--cursor-border-secondary`, which is the actual source of the
 * mismatch with the official build.
 *
 * The upstream React node is never moved or re-parented — only classes, text and two appended
 * spans are set on it, so React reconciliation stays untouched.
 */

export {};

import { createMarketplaceController } from "./marketplace/index.js";

const STYLE_ELEMENT_ID = "sand-plugins-dock-style";
const ENTRY_SELECTOR = ".sand-agents-sidebar__plugins-entry";
const BUTTON_SELECTOR = `${ENTRY_SELECTOR} .sand-agents-sidebar__plugins`;
const ACCOUNT_BUTTON_SELECTOR = ".sand-agents-sidebar__account > button";
const ACCOUNT_AVATAR_SELECTOR = `${ACCOUNT_BUTTON_SELECTOR} .sand-kit-base-avatar`;
const ACCOUNT_FOOTER_SELECTOR = ".sand-agents-sidebar__footer";
const DOCK_CLASS = "sand-plugins-dock";
const LABEL_CLASS = "sand-plugins-dock-label";
const LOGOS_CLASS = "sand-plugins-dock-logos";
const ICON_CLASS = "sand-plugins-dock-icon";
const UPSTREAM_LABEL_CLASS = "sand-plugins-dock-upstream-label";
const RAIL_BUTTON_CLASS = "sand-plugins-dock-rail";
const RAIL_ICON_NAME = "storefront";

/** Upstream 0.66 renders a second, different surface once the sidebar is in its collapsed ("rail")
 *  state: the pill is not rendered at all, and `lA` takes its place — a bare circular icon button
 *  carrying the `storefront` glyph, wrapped in a tooltip, sitting directly after
 *  `.sand-agents-sidebar__rail-new`.
 *
 *  The wrapper is byte-identical to the one upstream gives its own `__rail-new` row
 *  (`sand-78zum5 … sand-10b6aqq sand-lvsv26 sand-r1vbnl sand-1aquc0h` + the two animation-tail
 *  classes), which is why upstream can stack the two rows with no extra layout code.
 *
 *  0.18 has no such component — the rail collapse machinery is otherwise identical (`Jlt`/`Ult=210`/
 *  `GFe=220` in 0.18 vs `R_`/`j_=210`/`f2=220` in 0.66) — so the rail market entry is added here. */
const RAIL_WRAPPER_CLASSES = [
  "sand-78zum5", "sand-dt5ytf", "sand-6s0dn4", "sand-2lah0s", "sand-10b6aqq", "sand-lvsv26",
  "sand-r1vbnl", "sand-1aquc0h", "sand-rez4as", "sand-q56fva",
];

/** Official 0.66 `to.railButton` on the `Rn` icon button. Captured from the running renderer. */
const RAIL_BUTTON_CLASSES = [
  "sand-kit-icon-button", "sand-1n2onr6", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k",
  "sand-2lah0s", "sand-9f619", "sand-exx8yu", "sand-yri2b", "sand-18d9i69", "sand-1c1uobl",
  "sand-c342km", "sand-ng3xce", "sand-1ypdohk", "sand-tgyt42", "sand-s2xxs2", "sand-1firant",
  "sand-9lcvmn", "sand-1k57tk5", "sand-784prv", "sand-1t137rt", "sand-9v5kkp", "sand-4sht9k",
  "sand-1y3gkto", "sand-gd8bvy", "sand-1fgtraw", "sand-149ho13", "sand-jbqb8w", "sand-1r8pydn",
  "sand-1o0liin", "sand-1fx2joi", "sand-7n8uir", "sand-lvsv26",
];

/** Official `sand-kit-icon` wrapper around the glyph. Identical to the one on `__rail-new`. */
const RAIL_ICON_SPAN_CLASSES = [
  "sand-kit-icon", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k", "sand-2lah0s", "sand-1heor9g",
  "sand-w4jnvo", "sand-1qx5ct2",
];

/** Glyph class list. The upstream icon element carries the same `ui-*` classes for `plus` and for
 *  `storefront` — the glyph itself is delivered out-of-band through the `--cursor-icon-content`
 *  custom property and `data-icon-name`, so no icon-specific class is required.
 *
 *  `ui-jb5y04` / `ui-1bxnb1t` are the two 0.66-only members; the rest already exist in 0.18. */
const RAIL_ICON_GLYPH_CLASSES = [
  "ui-icon", "ui-1j61x8r", "ui-etm3q0", "ui-1tachi3", "ui-1qt6sjn", "ui-o5v014", "ui-3nfvp2",
  "ui-6s0dn4", "ui-l56j7k", "ui-1heor9g", "ui-1oai4fc", "ui-higkf7", "ui-xymvpz", "ui-krqix3",
  "ui-1403hyl", "ui-2b8uid", "ui-6mezaz", "ui-vmahel", "ui-lh3980", "ui-87ps6o", "ui-1winvzj",
  "ui-1u4itkb", "ui-1q5xvfy", "ui-jb5y04", "ui-1bxnb1t", "ui-1ehclkv", "ui-1yj7g93", "cursor-icon",
];

/** Codepoint behind upstream's `storefront` entry in the icon map (`storefront:"\uF483"`), read off
 *  the live 0.66 renderer. The `ui-icon` element paints `var(--cursor-icon-content)`, so the glyph
 *  follows the variable rather than a font class. */
const RAIL_ICON_GLYPH = "\uF483";

/** Where upstream inserts the rail row: after `__rail-new`, before `__footer`. */
const RAIL_NEW_SELECTOR = ".sand-agents-sidebar__rail-new";
const RAIL_FOOTER_SELECTOR = ".sand-agents-sidebar__footer";
const SIDEBAR_SELECTOR = "aside.sand-agents-sidebar";
const COLLAPSED_SELECTOR = ".sand-shell[data-sidebar-collapsed]";

/** The sign-out row in the account menu.
 *
 *  This build is login-free: `source/electron-preload/preload.ts` hard-codes
 *  `account.getStatus()` to `{ kind: "logged-in", authId: "local" }`, and upstream gates the row on
 *  exactly that value — `const P = authStatus === "logged-in"; … P ? <MenuItem …>Log out</MenuItem> : null`
 *  in the bundled `Xln`. So the hard-coded status is what makes the row appear.
 *
 *  It is not just cosmetic here. `account.logout()` resolves to `{ kind: "logged-out" }`, and
 *  `account.login()` on this build also resolves to `{ kind: "logged-out" }` ("Cursor cloud login is
 *  unavailable in the local-only build."), so activating the row moves the app into a state it can
 *  never leave: every `authStatus === "logged-in"` branch turns off and there is no way back. Hiding
 *  the row removes that dead end.
 *
 *  Selected by the leading icon rather than by label: the three rows in this menu
 *  (设置 / 关于 / 退出登录) share one class list and one set of data attributes, so the text is the
 *  only other discriminator — and it changes with the locale. `data-icon-name` is set by the icon
 *  component from the name the menu row was built with, so it survives both. */
const LOGOUT_ICON_NAME = "arrow-bracket-from-left";
const LOGOUT_ROW_SELECTOR = `[role="menuitem"] i[data-icon-name="${LOGOUT_ICON_NAME}"]`;
const LOGOUT_MARKER_CLASS = "sand-plugins-dock-no-logout";

/** Upstream 0.66 wording. The official build picks between this and "Marketplace"
 *  (`Zt5PUS`) behind the Statsig gate `sand_new_connect_button`, which defaults off; this
 *  reconstruction has no Statsig client, so the gated-on label is the one to match. */
const LABEL_TEXT = "连接应用";

/** Official cap: `const Hfe = 3` in the marketplace logo selector. */
const LOGO_LIMIT = 3;

/** Official pill class lists, captured from the running 0.66 renderer's
 *  `[data-sidebar-marketplace]` subtree.
 *
 *  `sand--default-marker` LOOKS like an inert stylix composition marker (it is `{"sand--default-
 *  marker": "sand--default-marker", $$css: true}` and carries no declarations of its own), and an
 *  earlier revision of this file dropped it on that basis. That was wrong: it is the anchor for
 *  every `:where(.sand--default-marker:hover) …` rule in the official stylesheet, and the pill's
 *  logo fan-out is driven by two of them. Without it the hover simply never fires.
 *
 *  Re-adding it is safe against 0.18's own rules: every `:where(.sand--default-marker:is(…))` rule
 *  in the 0.18 stylesheet additionally requires the marker element to match a state class such as
 *  `.sand-transcript-row[data-role=user]` or `.sand-info-pane[data-open]`, and this button matches
 *  none of them. */
const OFFICIAL_BUTTON_CLASSES = [
  "sand--default-marker",
  "sand-lvsv26", "sand-jyslct", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k",
  "sand-xhr3t", "sand-1iyjqo2", "sand-s83m0k", "sand-1m3x3r8", "sand-15hfatp", "sand-c9qbxq",
  "sand-exx8yu", "sand-18d9i69", "sand-mkeg23", "sand-1y0btm7", "sand-q03nf1", "sand-149ho13",
  "sand-10e981r", "sand-18o3ruo", "sand-q8sv2t", "sand-tyxrsu", "sand-jb2p0i", "sand-1yc453h",
  "sand-1ypdohk", "sand-670bw6", "sand-jyj1k0", "sand-q8ykup", "sand-1554a8d", "sand-1k57tk5",
  "sand-784prv", "sand-1t137rt", "sand-9v5kkp", "sand-4sht9k", "sand-1y3gkto", "sand-fc7y3v",
  "sand-1fc57z9", "sand-12oo3zp", "sand-1rhlpx6", "sand-f7dkkf", "sand-pdmqnj",
];
const OFFICIAL_ICON_SPAN_CLASSES = [
  "sand-3nfvp2", "sand-2lah0s", "sand-1m189uc", "sand-b3r6kr", "sand-g01cxk", "sand-1g23rn4",
  "sand-4wkmsb", "sand-q8ykup", "sand-1554a8d",
];
const OFFICIAL_LABEL_SPAN_CLASSES = [
  "sand-1lliihq", "sand-euugli", "sand-1ncir08", "sand-b3r6kr", "sand-uxw1ft", "sand-lyipyv",
  "sand-1lziwak", "sand-1hc1fzr", "sand-k0bdwt", "sand-4wkmsb", "sand-q8ykup", "sand-1554a8d",
];
const OFFICIAL_LOGOS_WRAPPER_CLASSES = [
  "sand-1n2onr6", "sand-3nfvp2", "sand-1cy8zhl", "sand-1vdjht5", "sand-euugli", "sand-10h3iyq",
  "sand-1rehbtp", "sand-mix8c7", "sand-7giv3", "sand-i4da17", "sand-dzw4kq", "sand-1hc1fzr",
  "sand-k0bdwt", "sand-4wkmsb", "sand-q8ykup", "sand-1554a8d",
];
// `sand-1cpjm7i` (`content:""`) is omitted: `content` only applies to ::before/::after, so the rule
// the official stylesheet carries for it is a no-op on this element there too.
const OFFICIAL_LOGO_STACK_CLASSES = [
  "sand-78zum5", "sand-1a02dak", "sand-6s0dn4", "sand-p1r0qw", "sand-1l7klhg", "sand-euugli",
  "sand-k9ib7f", "sand-1vtibv1",
];
const OFFICIAL_LOGO_SLOT_CLASSES = [
  "sand-9f619", "sand-3nfvp2", "sand-2lah0s", "sand-1xp8n7a", "sand-mix8c7", "sand-4p5aij",
  "sand-1ccui7m", "sand-1j85h84", "sand-18pi947", "sand-t9pb60", "sand-10e981r", "sand-18o3ruo",
  "sand-k4g3bx", "sand-11xpdln", "sand-4wkmsb", "sand-1da2sx9", "sand-1e6nqfh",
];
/** `lo.slotStacked` — the official fan-out overlap for every logo after the first. */
const OFFICIAL_LOGO_SLOT_STACKED_CLASS = "sand-w01apr";
/** `lo.fanStart` / `fanMiddle` / `fanEnd` — the resting fan phase per slot. Hovering the pill swaps
 *  the outer slots to the transformed phase (the two `:where(.sand--default-marker:hover)` rules in
 *  LIFTED_HOVER_RULES), which grows them from 18px to 20px and rotates them outward. */
const OFFICIAL_LOGO_FAN_BASE_CLASS = "sand-1c071of";
const OFFICIAL_LOGO_FAN_CLASSES = ["sand-1q77ly", "sand-1nbbp8h", "sand-1rwtdfy"] as const;
const OFFICIAL_LOGO_ICON_BOX_CLASSES = [
  "sand-tool-icon", "sand-tool-icon--logo", "sand-9f619", "sand-3nfvp2", "sand-6s0dn4",
  "sand-l56j7k", "sand-1c4vz4f", "sand-2lah0s", "sand-dl72j9", "sand-b3r6kr", "sand-qjedn3",
  "sand-1y0btm7", "sand-q03nf1", "sand-jbqb8w",
];
const OFFICIAL_LOGO_IMG_CLASSES = ["sand-1lliihq", "sand-h8yej3", "sand-5yr21d", "sand-l1xv1r"];

/** Official declaration blocks that 0.18's stylesheet does not contain, copied verbatim from the
 *  official 0.66 stylesheet. Scoped under the dock button so they cannot leak into any 0.18
 *  component that happens to reuse one of these class names. */
const LIFTED_OFFICIAL_RULES: ReadonlyArray<readonly [string, string]> = [
  [".sand-1m3x3r8", "flex-basis:36px"],
  [".sand-q8sv2t", "background-image:linear-gradient(var(--sand-fill-elevated-hover),var(--sand-fill-elevated-hover))"],
  [".sand-1yc453h", "text-align:start"],
  [".sand-670bw6", "transition-property:background-color,flex-grow,padding"],
  [".sand-jyj1k0", "transition-property:background-color"],
  [".sand-q8ykup", "transition-duration:.2s"],
  [".sand-1554a8d", "transition-timing-function:cubic-bezier(.22,1,.36,1)"],
  [".sand-pdmqnj", "padding-inline-end:12px"],
  [".sand-1m189uc", "max-width:0"],
  [".sand-1g23rn4", "transition-property:max-width,opacity"],
  [".sand-1lziwak", "margin-inline-start:0"],
  [".sand-k0bdwt", "transition-property:max-width,opacity,margin-inline-start"],
  [".sand-1vdjht5", "flex-shrink:1000000"],
  [".sand-10h3iyq", "width:42px"],
  [".sand-1rehbtp", "max-width:42px"],
  [".sand-i4da17", "overflow-clip-margin:5px"],
  [".sand-dzw4kq", "margin-inline-start:6px"],
  [".sand-1l7klhg", "flex-basis:100%"],
  [".sand-k9ib7f", "width:0"],
  [".sand-1vtibv1", "height:18px"],
  [".sand-1c071of", "transform:none"],
  [".sand-1q77ly", "transform:translate(calc(-3px*var(--sand-inline-sign,1))) rotate(calc(-8deg*var(--sand-inline-sign,1)))"],
  [".sand-1nbbp8h", "transform:translateY(-1px)"],
  [".sand-1rwtdfy", "transform:translate(calc(3px*var(--sand-inline-sign,1))) rotate(calc(8deg*var(--sand-inline-sign,1)))"],
  [".sand-1ccui7m", "padding-inline-end:1px"],
  [".sand-18pi947", "padding-inline-start:1px"],
  [".sand-k4g3bx", "background-image:linear-gradient(var(--sand-fill-elevated-hover),var(--sand-fill-elevated-hover))"],
  [".sand-w01apr", "margin-inline-start:-6px"],
];

/** The five official rail-market declarations that have no counterpart in 0.18's stylesheet.
 *  Copied byte-for-byte from the official stylesheet; each is a single declaration.
 *
 *  `.sand-rez4as` / `.sand-q56fva` are the animation tail that upstream also puts on its own
 *  `__rail-new` row (0.18 spells the same two values `.sand-5hsz1j` / `.sand-1fcfbla`, so this is
 *  the same pair under a different hash — the class-name hash follows the declaration, and 0.18
 *  bundles it under a different name because the animation-name it guards differs).
 *  `.sand-yri2b` / `.sand-1c1uobl` zero the inline padding on the icon button.
 *  `.sand-1firant` is the 120ms colour transition. */
const LIFTED_RAIL_RULES: ReadonlyArray<readonly [string, string]> = [
  [".sand-rez4as", "animation-duration:.2s"],
  [".sand-q56fva", "animation-timing-function:cubic-bezier(.22,1,.36,1)"],
  [".sand-yri2b", "padding-inline-end:0"],
  [".sand-1c1uobl", "padding-inline-start:0"],
  [".sand-1firant", "transition-duration:.12s"],
];

function applyClasses(element: Element, classNames: readonly string[]): void {
  for (const className of classNames) element.classList.add(className);
}

/** The two official hover rules that drive the logo fan-out, copied verbatim but re-anchored on the
 *  dock scope: the official selector is `:where(.sand--default-marker:hover) .sand-1q77ly.sand-
 *  1q77ly`, i.e. the button must carry the marker class (see OFFICIAL_BUTTON_CLASSES). `.sand-1q77ly`,
 *  `.sand-1rwtdfy` and `.sand-1nbbp8h` have zero references anywhere in the 0.18 bundle, so scoping
 *  them here cannot collide with an existing component.
 *
 *  `!important` is required, and the reason is a specificity tie, not sloppiness: 0.18's own stylesheet
 *  already carries `.sand-1c071of:not(#\#):not(#\#):not(#\#) { transform: none }` at (0,4,0) — the
 *  three `:not()` guards it emits count as classes, which lands it exactly level with the lifted
 *  hover rule. The official sheet wins that tie by source order because both rules live in one file;
 *  here they do not, because the 0.18 stylesheet is injected into <head> at runtime and can land
 *  after this extension's <style>. Confirmed with CSS.getMatchedStylesForNode: the fan rule is
 *  matched, `:hover` is active, and the slot still computed `transform: none` until this was added. */
const LIFTED_HOVER_RULES: ReadonlyArray<readonly [string, string]> = [
  [".sand-1q77ly", "transform:translate(calc(-3px*var(--sand-inline-sign,1))) rotate(calc(-8deg*var(--sand-inline-sign,1))) !important"],
  // The official sheet only has hover rules for the two outer slots; the middle slot's 1px lift on
  // hover falls out of its own cascade order. Measured on the running official build: at rest all
  // three compute `transform: none`, on hover the outer two become
  // `matrix(0.990268, ∓0.139173, ±0.139173, 0.990268, ∓3, 0)` and the middle becomes
  // `matrix(1, 0, 0, 1, 0, -1)`. All three are restated here so the resting state stays `none`
  // (0.18's `.sand-1c071of` already out-ranks the resting phases) and the hover state matches.
  [".sand-1nbbp8h", "transform:translateY(-1px) !important"],
  [".sand-1rwtdfy", "transform:translate(calc(3px*var(--sand-inline-sign,1))) rotate(calc(8deg*var(--sand-inline-sign,1))) !important"],
];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID) != null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  const scope = `.${DOCK_CLASS}`;
  style.textContent = [
    // The sidebar container is the positioning context for the docked row. (`container-type:
    // inline-size` already makes it a containing block; position:relative is belt and braces.)
    ".sand-agents-sidebar{position:relative !important;}",
    // Dock the upstream Plugins row over the account row. Geometry only — every visual property of
    // the pill itself comes from the official class list below.
    // Bottom offset is pinned to 16px so the pill baseline lands on the same line as the account
    // avatar (footer padding-bottom 16px) and the chat prompt form (dock input dock padding 16px).
    // Measured 2026-10-03: official 0.66 avatar.bottom === form.bottom === 1008 in a 1024px
    // viewport (16px from the bottom edge). `bottom:12px` put ours at 1012 — 4px lower.
    // Right offset is 16px (not 8) so the pill's right edge lands on the footer content box
    // (399.5 − 16 = 383.5, official button width 323.5). `right:8px` overshot to 391.5.
    `${ENTRY_SELECTOR}{position:absolute !important;left:60px !important;right:16px !important;bottom:16px !important;z-index:30;display:flex !important;align-items:center;height:36px;margin:0 !important;padding:0 !important;}`,
    // Official `flex-grow:1` (sand-1iyjqo2) already grows the button; force the width so the
    // absolutely-positioned entry hands it the full row, and pin the content alignment the
    // official build resolves to `center` / `center`.
    `${scope}{width:100% !important;justify-content:center !important;align-items:center !important;}`,
    // Cascade repair. The 0.18 sidebar row still carries 18 classes that 0.66 no longer has, and
    // they sit LATER in 0.18's stylesheet than the official pill classes, so at equal specificity
    // they win outright (verified with CSS.getMatchedStylesForNode: no !important anywhere, the
    // loss is pure source order):
    //   gap:8px            <- 0.18-only .sand-167g77z      beats official .sand-xhr3t (gap:0)
    //   padding-block:6px  <- 0.18-only .sand-1yrsyyn / .sand-10b6aqq
    //                                  beats official .sand-exx8yu / .sand-18d9i69 (padding-block:0)
    //   padding-inline:8px <- the 0.18 row's own shorthand
    //                                  beats official .sand-f7dkkf / .sand-pdmqnj (16px / 12px)
    // Dropping those classes outright would also strip shared 0.18 layout helpers the sidebar
    // needs, so the official values are re-asserted here. Each number is the official build's own
    // computed value, not a design decision.
    `${scope}{gap:0 !important;padding-block:0 !important;padding-inline:16px 12px !important;}`,
    // Upstream's own text label has no counterpart in the 0.66 pill (the official component renders
    // its own label span instead), so drop it and keep the button's accessible name.
    `${scope} > .${UPSTREAM_LABEL_CLASS}{display:none !important;}`,
    `${scope} > .${LABEL_CLASS}{min-width:0 !important;}`,
    // The upstream icon is a `plug` glyph; the official 0.66 pill collapses its leading slot to
    // zero width and zeroes its opacity, so the storefront glyph is not painted either.
    `${scope} > .${ICON_CLASS}{max-width:0 !important;opacity:0 !important;overflow:hidden !important;}`,
    `${scope} > .${LOGOS_CLASS}{display:inline-flex !important;align-items:center !important;}`,
    // Lifted official declarations, scoped to this dock. Each rule is emitted twice: the dock
    // button carries the pill classes ITSELF, and a descendant selector never matches the element
    // that also satisfies its own ancestor part — so `.sand-plugins-dock .sand-pdmqnj` alone would
    // silently fail to apply the pill's own padding.
    ...LIFTED_OFFICIAL_RULES.flatMap(([selector, declarations]) => [
      `${scope}${selector}{${declarations}}`,
      `${scope} ${selector}{${declarations}}`,
    ]),
    // Hover fan-out. The doubled class in the selector is what lets this beat the resting
    // `transform:none` / `translateY(-1px)` phases above; the official sheet relies on the same
    // specificity bump.
    ...LIFTED_HOVER_RULES.map(([selector, declarations]) =>
      `${scope}:hover ${selector}${selector}{${declarations}}`),
    // Account avatar: the official footer pairs a 36x36 circular avatar with the pill in one 36px
    // band, while the 0.18 row ships a 28x28 monogram. Match the official size; the full-width hit
    // area of the account trigger is kept, because re-parenting upstream's React node is not an
    // option and shrinking the menu target would be a real usability regression.
    //
    // The official pill starts 8px after the avatar's right edge (measured: avatar right 52, pill
    // left 60). The 56px this used to use put the pill flush against the avatar with a 0px gap.
    `${ACCOUNT_BUTTON_SELECTOR} > span:first-child,${ACCOUNT_AVATAR_SELECTOR}{width:36px !important;height:36px !important;}`,
    // The account row only needs to match the pill height now that the label is hidden.
    `${ACCOUNT_BUTTON_SELECTOR}{min-height:36px !important;padding-top:0 !important;padding-bottom:0 !important;}`,
    // Hide the name/email text slot. This used to be `:last-child`, which is correct while the
    // sidebar is expanded (avatar first, text second) but destroys the rail state: upstream renders
    // only ONE span there, so it is simultaneously the first and the last child and the avatar is
    // hidden with the text — the account row came out blank. `:not(:first-child)` keeps the avatar in
    // both states and still hides the text, which is never the first child.
    `${ACCOUNT_BUTTON_SELECTOR} > span:not(:first-child){display:none !important;}`,
    `${ACCOUNT_BUTTON_SELECTOR}:hover{background:transparent !important;}`,
    // The official account trigger is a 36px CIRCLE (`border-radius: 9999px`); the 0.18 row is a
    // 10px-radius pill that spans the full sidebar width. Only the radius is asserted here — the
    // trigger stays full width on purpose (see the hit-area note above), so the shape can only be
    // corrected on the trigger's own box, not by shrinking it.
    `${ACCOUNT_BUTTON_SELECTOR}{border-radius:9999px !important;}`,
    // Press feedback. The official account disc does NOT change its background on hover — it dims
    // the whole disc with `filter: brightness()`, so the same effect applies to a photo avatar and
    // to a monogram one:
    //   rest  filter: none
    //   hover filter: brightness(0.9)    (sand-1spsku0)
    //   press filter: brightness(0.82)   (sand-64r99s)
    //   transition-property: filter      (sand-1eokjkq)
    // None of those three class names exist in 0.18, so they are lifted rather than referenced.
    //
    // This is the same visual grey the pill paints on hover (`rgba(119,119,119,0.09)` /
    // `var(--sand-fill-elevated-hover)`) — two different mechanisms for the same affordance, and
    // both were verified against the running official build.
    //
    // Note: the state is measured with a REAL pointer event. Reading `backgroundColor` alone
    // reports "no change" here and looks like the interaction is missing, because it is applied to
    // `filter`, not to any background property.
    `${ACCOUNT_BUTTON_SELECTOR}{transition-property:filter !important;transition-duration:.2s !important;}`,
    `${ACCOUNT_BUTTON_SELECTOR}:hover{filter:brightness(.9) !important;}`,
    `${ACCOUNT_BUTTON_SELECTOR}:active{filter:brightness(.82) !important;}`,
    // Sign-out row. `display: none` rather than `visibility` so it also leaves the menu's keyboard
    // order and hit testing — the row is unreachable, not merely invisible.
    `.${LOGOUT_MARKER_CLASS}{display:none !important;}`,
    // Footer insets, measured against the running official build: its avatar sits at x=16, ours at
    // x=20. The 4px is the sum of two upstream differences, not one:
    //   official footer padding  = 0 16px 16px   (sand-mzvs34 in 0.66, absent in 0.18)
    //   0.18    footer padding  = 2px 12px 12px  (sand-1nn3v0j / sand-f18ygs / sand-sag5q8)
    // plus the extra 8px of horizontal inset 0.18 adds on the trigger itself (`padding: 0 8px`).
    // Re-asserting the official values on the footer is enough for the left edge, because the
    // avatar is the trigger's first child and inherits its content box. The bottom padding is
    // restored to 16px so the row keeps the official distance from the window edge.
    `${ACCOUNT_FOOTER_SELECTOR}{padding-top:0 !important;padding-bottom:16px !important;padding-inline:16px !important;}`,
    // …and 0.18 additionally pads the trigger itself with `padding: 0 8px`, which pushes the
    // avatar a further 8px right (x=24 instead of the official 16) and closes the pill gap to 0.
    // The official trigger is a bare 36px circle with `padding: 0`. Only the inline padding is
    // zeroed: the box stays full width so the account menu keeps its hit area — the circle is
    // drawn by the radius, not by the box size.
    `${ACCOUNT_BUTTON_SELECTOR}{padding-inline:0 !important;}`,
    // The avatar's fallback surface. When upstream has no account photo it paints the monogram on
    // `var(--sand-fill-neutral-subtle)` — and it does so through an INLINE style
    // 0.18 paints the monogram inline (`style="width:28px;height:28px;background-color:…;color:…;
    // font-size:12px"`), not via a class, so only `!important` can reach it.
    //
    // The official 0.66 avatar is transparent with no border — measured on the running build: its
    // `.sand-kit-base-avatar` computes to `background: rgba(0,0,0,0)`, `border: 0px none`, and the
    // child is an `<img>` (the account photo). An earlier revision here forced the disc transparent
    // to "stop the grey circle the official build never draws". That matched the official box model
    // but not what it renders: with a photo the disc is filled by the image, whereas this build has
    // no account photo and falls back to a monogram. A bare near-black letter on the sidebar's
    // #f7f7f7 therefore has no disc to see, and — the actual symptom — the ported
    // `filter: brightness(.9)` / `brightness(.82)` hover and press feedback became invisible,
    // because dimming a near-black glyph on a near-white surface moves nothing perceptible.
    //
    // The monogram is account data and this extension cannot supply a photo, so the fallback is a
    // surface the official build does not need: the same recipe its sibling dock pill already uses
    // (`--sand-bg-elevated` fill, `--sand-border-weak` 1px ring). Both tokens are upstream's own and
    // resolve to #fcfcfc / #1414141a in 0.18, so the disc reads as a real object and the brightness
    // steps have something to act on. box-sizing keeps the 36px box exact under the added border.
    `${ACCOUNT_AVATAR_SELECTOR}{background-color:var(--sand-bg-elevated, #fcfcfc) !important;border:1px solid var(--sand-border-weak, #1414141a) !important;box-sizing:border-box !important;}`,
    `${ACCOUNT_AVATAR_SELECTOR}{color:inherit !important;}`,
    `${ACCOUNT_AVATAR_SELECTOR}{font-size:13.3333px !important;}`,
    // `sand-1rhlpx6` is 0.18's medium-weight avatar class; the official avatar carries
    // `sand-xzm5a7` (`font-weight: var(--sand-font-weight-semibold)`), which exists in 0.18 too.
    // Both are stylix classes at equal specificity, so the later one in the stylesheet wins — and
    // which is later is not stable across builds, hence the explicit weight.
    `${ACCOUNT_AVATAR_SELECTOR}{font-weight:var(--sand-font-weight-semibold,600) !important;}`,
    // Collapsed sidebar: the pill is not rendered at all upstream in this state, so the
    // icon-only fallback below only ever has to cover the narrow-but-not-collapsed widths.
    `@container sand-sidebar (max-width: 240px){${scope} > .${LABEL_CLASS},${scope} > .${LOGOS_CLASS}{display:none !important;}${scope}{flex:0 0 auto !important;width:36px !important;padding:3px !important;}}`,
    // Rail market button. Upstream mounts it only while the sidebar is collapsed and unmounts the
    // pill at the same time, so the two states are mutually exclusive; the shell attribute
    // `data-sidebar-collapsed` is written by the same sidebar layout code in both versions (0.18
    // `Nle`, 0.66 `wa`) and is the only rail signal available without importing upstream internals.
    // Emitted twice per rule for the same reason as the pill above: these classes sit on the
    // elements themselves, so a descendant-only selector would never match.
    ...LIFTED_RAIL_RULES.flatMap(([selector, declarations]) => [
      `.${RAIL_BUTTON_CLASS}${selector}{${declarations}}`,
      `.${RAIL_BUTTON_CLASS} ${selector}{${declarations}}`,
    ]),
  ].join("");
  document.head.append(style);
}

type DockCatalogEntry = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly pluginName?: unknown;
  readonly displayName?: unknown;
  readonly iconUrl?: unknown;
};
type DockServer = { readonly name?: unknown; readonly pluginId?: unknown };
type DockMcpBridge = {
  catalog(): Promise<readonly DockCatalogEntry[]>;
  list(): Promise<{ servers?: readonly DockServer[] }>;
};

function getDockMcp(): DockMcpBridge | null {
  const desktop = (window as unknown as { desktop?: { mcp?: DockMcpBridge } }).desktop;
  return desktop?.mcp ?? null;
}

function serverPrefix(name: string): string {
  return name.includes(":") ? name.slice(0, name.indexOf(":")) : name;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/** Ids of catalog entries that already have a configured MCP server. */
function configuredCatalogIds(
  servers: readonly DockServer[],
  catalog: readonly DockCatalogEntry[],
): Set<string> {
  const byId = new Map<string, DockCatalogEntry>();
  const byName = new Map<string, DockCatalogEntry>();
  for (const entry of catalog) {
    if (entry.id != null) byId.set(String(entry.id), entry);
    for (const alias of [entry.displayName, entry.pluginName, entry.name]) {
      const key = normalize(alias);
      if (key.length > 0 && !byName.has(key)) byName.set(key, entry);
    }
  }
  const configured = new Set<string>();
  for (const server of servers) {
    const pluginId = String(server.pluginId ?? "");
    const entry = byId.get(pluginId) ?? byName.get(normalize(serverPrefix(String(server.name ?? ""))));
    if (entry?.id != null) configured.add(String(entry.id));
  }
  return configured;
}

/** Official 0.66 semantics: the pill is a discovery affordance, so it advertises catalog entries
 *  that are NOT configured yet (`isPublicListed === true && !isInstalled(item)`), capped at 3.
 *
 *  Uncertainty, deliberately not invented: the official selector also sorts by a team-install-count
 *  feed and drops items whose `isPublicListed` flag is false. This reconstruction's local catalog
 *  exposes neither field, so ordering falls back to catalog order and no visibility filter is
 *  applied. Both gaps are data-shape limits, not design choices. */
function pickSuggestedLogos(
  catalog: readonly DockCatalogEntry[],
  configured: ReadonlySet<string>,
): DockCatalogEntry[] {
  const suggestions: DockCatalogEntry[] = [];
  for (const entry of catalog) {
    if (entry.id == null || configured.has(String(entry.id))) continue;
    const iconUrl = typeof entry.iconUrl === "string" ? entry.iconUrl : "";
    if (iconUrl.length === 0) continue;
    suggestions.push(entry);
    if (suggestions.length >= LOGO_LIMIT) break;
  }
  return suggestions;
}

function buildLogo(entry: DockCatalogEntry, index: number, total: number): HTMLSpanElement {
  const slot = document.createElement("span");
  applyClasses(slot, OFFICIAL_LOGO_SLOT_CLASSES);
  if (index > 0) slot.classList.add(OFFICIAL_LOGO_SLOT_STACKED_CLASS);
  // fanStart / fanMiddle / fanEnd by position: the official selector picks the phase by slot index.
  slot.classList.add(OFFICIAL_LOGO_FAN_BASE_CLASS);
  const fan = index === 0 ? OFFICIAL_LOGO_FAN_CLASSES[0] : index === total - 1 ? OFFICIAL_LOGO_FAN_CLASSES[2] : OFFICIAL_LOGO_FAN_CLASSES[1];
  slot.classList.add(fan);

  const box = document.createElement("span");
  box.setAttribute("aria-hidden", "true");
  applyClasses(box, OFFICIAL_LOGO_ICON_BOX_CLASSES);
  box.style.width = "16px";
  box.style.height = "16px";
  box.style.borderRadius = "4px";

  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.width = 16;
  image.height = 16;
  image.src = String(entry.iconUrl ?? "");
  applyClasses(image, OFFICIAL_LOGO_IMG_CLASSES);

  box.append(image);
  slot.append(box);
  return slot;
}

function ensureButtonSurface(): HTMLButtonElement | null {
  const button = document.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
  if (button == null) return null;
  button.classList.add(DOCK_CLASS);
  applyClasses(button, OFFICIAL_BUTTON_CLASSES);
  button.title = LABEL_TEXT;
  button.setAttribute("aria-label", LABEL_TEXT);

  const isOwnNode = (node: Element): boolean =>
    node.classList.contains(LABEL_CLASS) || node.classList.contains(LOGOS_CLASS);

  // The upstream icon span keeps its own classes; the official collapsed-slot classes are added so
  // the glyph is not painted, matching the 0.66 render.
  const iconSpan = Array.from(button.children).find(
    (child) => child instanceof HTMLSpanElement && !isOwnNode(child) && child.textContent?.trim().length === 0,
  );
  if (iconSpan != null) {
    iconSpan.classList.add(ICON_CLASS);
    applyClasses(iconSpan, OFFICIAL_ICON_SPAN_CLASSES);
  }

  // Hide upstream's own text label; it has no counterpart in the official pill. Our own label and
  // logos spans must be excluded — they also carry text, and on every re-run (the observer calls
  // this again) marking them here would hide the label we just rendered.
  for (const child of Array.from(button.children)) {
    if (child === iconSpan || isOwnNode(child)) continue;
    if (child instanceof HTMLSpanElement && child.textContent?.trim().length > 0) {
      child.classList.add(UPSTREAM_LABEL_CLASS);
    }
  }

  let label = button.querySelector<HTMLSpanElement>(`.${LABEL_CLASS}`);
  if (label == null) {
    label = document.createElement("span");
    label.classList.add(LABEL_CLASS);
    button.append(label);
  }
  applyClasses(label, OFFICIAL_LABEL_SPAN_CLASSES);
  if (label.textContent !== LABEL_TEXT) label.textContent = LABEL_TEXT;

  let logos = button.querySelector<HTMLSpanElement>(`.${LOGOS_CLASS}`);
  if (logos == null) {
    logos = document.createElement("span");
    // The marker class is what makes the next run FIND this node. Without it every pass would
    // create another pair, and the previous pair (now carrying text) would be mistaken for
    // upstream's own label on the following pass and hidden.
    logos.classList.add(LOGOS_CLASS);
    logos.setAttribute("aria-hidden", "true");
    button.append(logos);
  }
  applyClasses(logos, OFFICIAL_LOGOS_WRAPPER_CLASSES);
  return button;
}

function isSidebarCollapsed(): boolean {
  return document.querySelector(COLLAPSED_SELECTOR) != null;
}

/** Opens the 0.66 marketplace from either the pill or the rail row.
 *
 *  Upstream renders both behind one `onOpenPlugins` prop — 0.18's is `() => Rme.open(Uf.plugins())`
 *  (`uSe` in the bundle), 0.66's goes through `nA`. In rail state the pill itself is not mounted
 *  (`Hn ? null : <s0n/>` in 0.18, `_t ? <lA/> : null` in 0.66), so the rail row is the only entry.
 *
 *  Neither entry dispatches upstream's `sand.openTools` chord any more. That shortcut reached
 *  `Rme.open(Uf.plugins())`, which is 0.18's own plugins dialog — a different revision of this same
 *  surface (市场/Yours tabs, raw English category names, "Show N more") — so the rail row and the
 *  pill would have opened two different dialogs. Both now go to the 0.66 marketplace, and the pill's
 *  React `onClick` is suppressed by a capture-phase listener so 0.18's dialog never opens at all. */
const marketplaceController = createMarketplaceController();

function openMarketplace(): void {
  void marketplaceController.open();
}

/** Routes the pill to the 0.66 marketplace instead of 0.18's own plugins dialog.
 *
 *  The pill IS an upstream React node — 0.18's `sand-agents-sidebar__plugins` button with our
 *  classes on it, and its `onClick` is `() => Rme.open(Uf.plugins())`. Leaving that in place would
 *  open 0.18's dialog (`aria-label="插件"`, 市场/Yours tabs) underneath the 0.66 surface, so the
 *  click has to be taken before React sees it.
 *
 *  React 18 binds its listeners on the root container, and the root listens during the BUBBLE
 *  phase. A capture-phase listener on the button therefore runs first, and `stopPropagation()`
 *  there prevents the event from ever bubbling to the root — the React handler never runs. The
 *  listener is registered on the pill itself (not on the sidebar) so it is scoped to the one
 *  control, and it is guarded by a marker class so re-running `ensureButtonSurface` cannot stack
 *  duplicates. */
function interceptPillClick(): void {
  const button = document.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
  if (button == null || button.classList.contains("sand-plugins-dock-no-upstream-click")) return;
  button.classList.add("sand-plugins-dock-no-upstream-click");
  button.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      openMarketplace();
    },
    // Capture on the target: this fires during the capture phase, before the event can bubble to
    // the React root.
    { capture: true },
  );
}

function openPluginsFromRail(): void {
  openMarketplace();
}

function buildRailButton(): HTMLButtonElement {
  const button = document.createElement("button");
  // The marker class is what makes the next pass FIND this node. Without it every pass would build
  // another one and the sidebar would accumulate duplicates.
  button.classList.add(RAIL_BUTTON_CLASS);
  applyClasses(button, RAIL_BUTTON_CLASSES);
  button.type = "button";
  button.title = LABEL_TEXT;
  button.setAttribute("aria-label", LABEL_TEXT);
  button.setAttribute("data-size", "md");
  button.setAttribute("data-variant", "ghost");
  button.addEventListener("click", openPluginsFromRail);

  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  applyClasses(span, RAIL_ICON_SPAN_CLASSES);
  span.setAttribute("data-size", "lg");

  // Upstream's `ui-icon` element paints `var(--cursor-icon-content)`, so the glyph is carried by the
  // custom property rather than by a font class; `data-icon-name` is what the icon component reads
  // to pick it. 0.18 ships the `storefront` entry in its own icon map but never renders it.
  const glyph = document.createElement("i");
  applyClasses(glyph, RAIL_ICON_GLYPH_CLASSES);
  glyph.setAttribute("data-icon-name", RAIL_ICON_NAME);
  glyph.setAttribute("aria-hidden", "true");
  glyph.style.setProperty("--cursor-icon-content", JSON.stringify(RAIL_ICON_GLYPH));
  glyph.style.setProperty("--icon-size", "16px");

  span.append(glyph);
  button.append(span);
  return button;
}

/** Mirrors upstream's `isCollapsed ? <lA/> : null` next to its `__rail-new` row. Returns the
 *  mounted button, or null while the sidebar is expanded (upstream renders no rail row at all —
 *  the pill is the only market surface in that state). */
function ensureRailButton(): HTMLButtonElement | null {
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
  if (sidebar == null) return null;
  if (!isSidebarCollapsed()) return null;

  const railNew = sidebar.querySelector<HTMLElement>(RAIL_NEW_SELECTOR);
  const footer = sidebar.querySelector<HTMLElement>(RAIL_FOOTER_SELECTOR);
  if (railNew == null || footer == null) return null;

  // Look the row up by the BUTTON's marker class and take its parent, not by the wrapper's: the
  // marker is set on the button (that is the node `buildRailButton` owns), and the wrapper carries
  // only upstream's class list. Querying the wrapper for a class it never has looks like "not
  // mounted" on every pass, so each collapse built another row and they piled up in the sidebar.
  const existing = sidebar.querySelector<HTMLButtonElement>(`:scope > div > button.${RAIL_BUTTON_CLASS}`);
  let wrapper = existing?.parentElement ?? null;
  if (wrapper == null) {
    wrapper = document.createElement("div");
    applyClasses(wrapper, RAIL_WRAPPER_CLASSES);
    wrapper.append(buildRailButton());
  } else {
    // Keep the official class list authoritative: upstream re-renders this row on every state
    // change, and a partially-classed wrapper would silently lose the 28x28 / circular geometry.
    applyClasses(wrapper, RAIL_WRAPPER_CLASSES);
    if (existing != null) applyClasses(existing, RAIL_BUTTON_CLASSES);
  }

  // Upstream order: `__rail-new`, then the market row, then `__footer`.
  if (wrapper.nextElementSibling !== footer) sidebar.insertBefore(wrapper, footer);
  return wrapper.querySelector<HTMLButtonElement>("button");
}

/** Removes every rail row, not just the first: a duplicate can only exist if a previous pass used
 *  a lookup that could not find the row it had created, so cleanup is written to be idempotent. */
function removeRailRows(sidebar: HTMLElement | null): void {
  if (sidebar == null) return;
  for (const button of Array.from(sidebar.querySelectorAll(`:scope > div > button.${RAIL_BUTTON_CLASS}`))) {
    const wrapper = button.parentElement;
    if (wrapper != null && wrapper.parentElement === sidebar) wrapper.remove();
    else button.remove();
  }
}

function syncRailButton(): void {
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
  if (isSidebarCollapsed()) {
    ensureRailButton();
    return;
  }
  // Expanded: upstream unmounts the row, so this must not linger next to the pill.
  removeRailRows(sidebar);
}

/** Hides the sign-out row in the account menu, if it is currently mounted.
 *
 *  The menu is a floating layer rendered into a portal at the document root, so it never appears
 *  inside the sidebar subtree and none of this extension's sidebar-scoped triggers can see it.
 *  The caller runs this on every mutation batch, so it is a plain idempotent sweep rather than a
 *  lifecycle hook: the row is marked on the way out, which also makes repeated calls cheap.
 *
 *  `display: none` removes the row from the menu's own keyboard order and from its hit testing, so
 *  it cannot be reached by arrow keys or by a stale pointer position either. */
function hideSignOutRow(): void {
  for (const icon of Array.from(document.querySelectorAll(LOGOUT_ROW_SELECTOR))) {
    const row = icon.closest<HTMLElement>('[role="menuitem"]');
    if (row == null) continue;
    // Guard against a stale lookup pattern of the kind that duplicated the rail row: only mark a
    // node that actually still carries the marker, and only ever touch the row this icon is in.
    if (row.classList.contains(LOGOUT_MARKER_CLASS)) continue;
    row.classList.add(LOGOUT_MARKER_CLASS);
  }
  // The row lives in a `ui-menu__section` that paints its divider with a `::before`
  // (`border-top: 0.5px solid rgba(20,20,20,.15)`). With its only item gone the section is an empty
  // shell, and the divider would be left dangling under the last real row. Drop the section when
  // none of its items is still laid out.
  for (const section of Array.from(document.querySelectorAll<HTMLElement>(".ui-menu__section"))) {
    const items = section.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items.length === 0) continue;
    const anyVisible = Array.from(items).some((item) => getComputedStyle(item).display !== "none");
    if (anyVisible) continue;
    section.classList.add(LOGOUT_MARKER_CLASS);
  }
}

async function refreshSuggestedLogos(): Promise<void> {
  const button = ensureButtonSurface();
  const logos = button?.querySelector<HTMLElement>(`.${LOGOS_CLASS}`);
  const mcp = getDockMcp();
  if (logos == null || mcp == null) return;
  try {
    const [{ servers = [] }, catalog] = await Promise.all([mcp.list(), mcp.catalog()]);
    const configured = configuredCatalogIds(servers, catalog);
    const suggestions = pickSuggestedLogos(catalog, configured);
    const stack = document.createElement("span");
    applyClasses(stack, OFFICIAL_LOGO_STACK_CLASSES);
    suggestions.forEach((entry, index) => {
      stack.append(buildLogo(entry, index, suggestions.length));
    });
    logos.replaceChildren(stack);
  } catch {
    logos.replaceChildren();
  }
}

let refreshTimer: number | null = null;
function scheduleRefresh(): void {
  if (refreshTimer != null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refreshSuggestedLogos();
  }, 80);
}

function install(): void {
  ensureStyles();
  ensureButtonSurface();
  interceptPillClick();
  syncRailButton();
  scheduleRefresh();
  // Only react to the upstream row being (re)inserted. A blanket `subtree` callback re-enters this
  // extension's own DOM writes, which is what turns a refresh into an endless mutation loop.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Rail transitions flip `data-sidebar-collapsed` on the shell and touch no child list, so a
      // childList-only observer would never see the sidebar collapse or expand. Attribute records
      // are filtered to that one attribute to keep this from re-entering on unrelated churn.
      if (
        record.type === "attributes"
        && record.attributeName === "data-sidebar-collapsed"
        && record.target instanceof HTMLElement
        && record.target.matches(COLLAPSED_SELECTOR)
      ) {
        syncRailButton();
        return;
      }
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        // The account menu is a floating layer in a document-root portal, so it is added outside
        // the sidebar entirely. Checked first and on every batch: by the time the portal is in the
        // DOM the row is already painted, and the menu is short-lived, so there is no later hook
        // that could take it back down before the user can click it.
        if (node.matches(LOGOUT_ROW_SELECTOR) || node.querySelector(LOGOUT_ROW_SELECTOR) != null) {
          hideSignOutRow();
        }
        if (node.matches(BUTTON_SELECTOR) || node.querySelector(BUTTON_SELECTOR) != null) {
          ensureStyles();
          ensureButtonSurface();
          // The pill is an upstream React node: React can unmount and remount it (sidebar collapse,
          // agent switch, settings re-render), and a remount produces a brand-new element with no
          // listener. Attaching only once — at install time — left the pill wired to 0.18's own
          // `Rme.open(Uf.plugins())` whenever the first pass ran before the sidebar mounted, which
          // is the common case: `install()` fires on DOMContentLoaded, long before the agents list
          // has rendered. Both must run on every remount.
          interceptPillClick();
          syncRailButton();
          scheduleRefresh();
          return;
        }
        // The rail row lives outside the plugins entry, so it needs its own trigger; otherwise a
        // sidebar that collapses before the footer mounts would never get the button.
        if (node.matches(SIDEBAR_SELECTOR) || node.matches(RAIL_NEW_SELECTOR) || node.matches(RAIL_FOOTER_SELECTOR)) {
          ensureStyles();
          syncRailButton();
          return;
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-sidebar-collapsed"],
  });
  window.addEventListener("sand-marketplace-changed", () => scheduleRefresh());
  window.addEventListener("beforeunload", () => observer.disconnect());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
