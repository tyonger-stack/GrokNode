/**
 * Official class recipes for the two panels this build mounts inside upstream 0.18's plugins view.
 *
 * ## Why this file exists
 *
 * The live "连接应用" dialog is upstream 0.18's own component, but two panels inside it are
 * Grok Node's own components (the effective-plugins list and the custom-MCP form, mounted by
 * `scripts/lib/port-0750-renderer-patch.mjs`). Those two rendered **raw HTML**: browser-default
 * headings (19.5px/700), a bulleted `<ul>`, default `<input>` boxes and default `<button>`s —
 * inside an otherwise native dialog (2026-10-26, user screenshot).
 *
 * ## Nothing here is invented
 *
 * Every class below is a recipe the 0.18 build itself ships, taken from the same surface:
 *
 *   * `SETUP_*` — upstream 0.18's own plugin-setup form (`view-B5Ug8wEm.js`, the `Di` component:
 *     a card with labelled text fields, an inline error line and a right-aligned action row).
 *   * `ROW_*` — upstream 0.18's plugin row (`li.sand-plugins-row …`), captured live from the
 *     running app: a centred flex row, a 12px gap, a 13px/500 name that truncates.
 *   * `GRID_*` — the two-column grid upstream's own plugin grid uses (`ul.sand-plugins__grid …`):
 *     `display:grid`, two equal columns, 2px/8px gaps, `list-style-type:none`.
 *   * `BUTTON_*` — upstream 0.18's small secondary button (the one the 身份验证 / 添加 actions
 *     use), captured live from the running app.
 *   * `SECTION_TITLE_*` — upstream 0.18's section title (`h3` inside the plugins view): 12px/420
 *     in the tertiary text colour with the section's 8px/6px/8px padding.
 *
 * `tests/marketplace-panel-styles.test.mjs` asserts that every class used here resolves to a rule
 * in the shipped 0.18 stylesheet, so a recipe that silently stops existing fails the build instead
 * of quietly turning the panel back into raw HTML.
 */

/** Upstream 0.18's plugin-setup form card (`k("sand-plugin-setup", …)`). */
export const SETUP_CARD = "sand-9f619 sand-78zum5 sand-dt5ytf sand-ou54vl";

/** The form's field column (`k("sand-9f619 sand-78zum5 sand-dt5ytf sand-1af02g3")` — 14px gap). */
export const SETUP_FIELD_COLUMN = "sand-9f619 sand-78zum5 sand-dt5ytf sand-1af02g3";

/** One field's row (`k("sand-9f619 sand-78zum5 sand-dt5ytf sand-1jnr06f")` — 4px gap). */
export const SETUP_FIELD_ROW = "sand-9f619 sand-78zum5 sand-dt5ytf sand-1jnr06f";

/** A field's label (`k("sand-9f619 sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1rhlpx6 sand-1wd3ewq")`). */
export const SETUP_LABEL = "sand-9f619 sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1rhlpx6 sand-1wd3ewq";

/** A field's text input — the valid state of upstream's plugin-setup input. */
export const SETUP_INPUT =
  "sand-9f619 sand-10w6t97 sand-exx8yu sand-cicffo sand-18d9i69 sand-1lqa7cf sand-mkeg23 sand-1y0btm7" +
  " sand-9r1u3d sand-1ubt8my sand-ur7f20 sand-1t137rt sand-i07v4r sand-1wd3ewq sand-jb2p0i sand-4z9k3i" +
  " sand-12oo3zp sand-ltfok3";

/** The invalid state of the same input (upstream swaps in `sand-yerb3`, the red border). */
export const SETUP_INPUT_INVALID =
  "sand-9f619 sand-10w6t97 sand-exx8yu sand-cicffo sand-18d9i69 sand-1lqa7cf sand-mkeg23 sand-1y0btm7" +
  " sand-ur7f20 sand-1t137rt sand-i07v4r sand-1wd3ewq sand-jb2p0i sand-4z9k3i sand-12oo3zp sand-ltfok3" +
  " sand-yerb3";

/** The inline error line of upstream's setup form (tertiary text, red). */
export const SETUP_ERROR = "sand-9f619 sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-fifm61 sand-1d3mw78 sand-pmgbkh";

/** The form's action row (`k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-13a6bvl sand-167g77z")`). */
export const SETUP_ACTIONS = "sand-9f619 sand-78zum5 sand-6s0dn4 sand-13a6bvl sand-167g77z";

/** Upstream 0.18's section title (`h3` in the plugins view): 12px/420 tertiary. */
export const SECTION_TITLE =
  "ui-text ui-1acoasx ui-dj266r ui-1yf7rl7 ui-at24cr ui-j3b58b ui-exx8yu ui-1xpa7k ui-18d9i69" +
  " ui-1uhho1l ui-vmahel ui-lh3980 ui-1wm8ruf ui-spwq11 ui-14s4slr ui-20ajya ui-4b2ntj" +
  " sand-9f619 sand-1y1aw1k sand-y13l1i sand-10b6aqq sand-163pfp";

/** A centred flex row with a 12px gap — upstream's plugin row geometry. */
export const ROW = "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1v2ro7d sand-euugli";

/**
 * Upstream 0.18's plugin-row *button* — the one that carries the plugin's icon and name.
 *
 * It matters that this is the full recipe and not just the row geometry: it is what resets the
 * browser's default button (the UA paints `<button>` with a grey background, and a button that
 * only wraps a short label is only as wide as that label, so the default background showed up as
 * a grey chip behind every plugin name).
 */
export const ROW_OPEN =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-883omv sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli" +
  " sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l sand-c342km sand-ng3xce sand-jbqb8w sand-1heor9g" +
  " sand-jb2p0i sand-dpxx8g sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv" +
  " sand-1uczgqu sand-2d6ogt sand-1wfwxd8 sand-7s97pk sand-1kogg8i";

/**
 * The same button without the three flex classes (`flex-grow:1` / `flex-shrink:1` /
 * `flex-basis:auto`).
 *
 * Upstream's row button grows to fill its row because the row's trailing action is a *sibling* of
 * the button (the icon and the name are inside the button, the status chip is not). In this panel
 * the trailing 卸载 button is the row's second child, so a growing name button would push the
 * action to the far edge of its grid cell — in a two-column grid that put "卸载" immediately next
 * to the *next* column's name. Shrink-wrapped, each cell reads "Gmail 卸载".
 */
export const ROW_OPEN_COMPACT = ROW_OPEN
  .replace("sand-1iyjqo2 ", "")
  .replace("sand-s83m0k ", "")
  .replace("sand-dl72j9 ", "");

/** The row's name: 13px/500, truncated to one line. */
export const ROW_NAME =
  "sand-9f619 sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1rhlpx6 sand-1wd3ewq sand-lyipyv sand-uxw1ft";

/** The row's secondary label: 13px/400 in the tertiary text colour, truncated. */
export const ROW_SECONDARY =
  "sand-9f619 sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-19aaqeu sand-lyipyv sand-uxw1ft";

/** A tertiary text chip (the policy badge next to a plugin name). */
export const ROW_BADGE = "sand-9f619 sand-4b2ntj sand-1k6tqyu sand-1wd3ewq";

/** Upstream's two-column plugin grid: `ul` with two equal columns and no list markers. */
export const GRID =
  "sand-9f619 sand-rvj5dj sand-nby9oq sand-fex06f sand-1dbijih sand-3ct3a4" +
  " sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-exx8yu ui-1xpa7k ui-18d9i69 ui-1uhho1l";

/** The design system's "span the whole grid" utility (`grid-column: 1 / -1`). */
export const GRID_SPAN = "sand-427cgg";

/**
 * Upstream 0.18's small secondary button — the same recipe the 身份验证 / 添加 actions use.
 * `sand-button` is the semantic hook (it carries no rule of its own); the rest is the recipe.
 */
export const BUTTON_SECONDARY =
  "sand-button sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-17d4w8g sand-178xt8z" +
  " sand-s1s249 sand-so031l sand-e0pwq sand-13fuv20 sand-32b0ac sand-1q0q8m5 sand-19ypqd9 sand-1v8p93f" +
  " sand-he5wa1 sand-16stqrj sand-1g4hjc sand-jb2p0i sand-1k6tqyu sand-uxw1ft sand-2b8uid sand-krqix3" +
  " sand-87ps6o sand-ggy1nq sand-1ypdohk sand-1s07b3s sand-1hc1fzr sand-uhm2yv sand-67bb7w sand-aqnwrm" +
  " sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1uczgqu sand-1725o6r sand-1wfwxd8" +
  " sand-7s97pk sand-1eaenvl sand-bb3pvg sand-1pbvl4h sand-d7y6wv sand-exx8yu sand-cicffo sand-18d9i69" +
  " sand-1lqa7cf sand-9h44rk sand-1wm8ruf sand-spwq11 sand-1kxuqrf sand-uo9n5k sand-1wd3ewq";
