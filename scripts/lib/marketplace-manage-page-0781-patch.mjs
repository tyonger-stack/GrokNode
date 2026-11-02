/**
 * Official Grok Bot 0.78.1's second-level "管理插件和技能" page, ported into upstream 0.18's plugins view.
 *
 * ## What official 0.78.1's second-level page looks like (measured live on official 9333, 2026-11-01)
 *
 *   ‹ 连接应用                                            管理
 *   管理插件和技能
 *   已安装
 *   [plugin row] [plugin row] [plugin row] [plugin row] [plugin row] [plugin row]
 *                                    显示全部 25 个插件
 *   私有技能
 *   [plugin row] [plugin row] …
 *
 * The browse page's "已连接 N 个" entry opens it. It is a SECOND-LEVEL page: official's own
 * detail bar (a labelled back button + the title "管理") replaces the browse header and the
 * whole browse toolbar, and the page carries a hero, an "已安装" section whose rows past the
 * sixth live in a collapsed `div[aria-hidden][inert]`, and a "私有技能" section.
 *
 * ## What this patch ports
 *
 * 1. **The four shared components, re-recipeed** — the plugin row (`fs`), the plugins grid
 *    (`Ws`), the section (`Hs`) and the show-all button (`ot`) carry official 0.78.1's class
 *    recipes. Official uses ONE row recipe and ONE grid recipe on both the browse page and the
 *    manage page, so re-recipeing them moves the browse page with them (that is official's own
 *    behaviour, and the spec allows it). The section additionally gains official's header
 *    wrapper `div` around its `h3` and drops `color:"tertiary"`.
 * 2. **The hero** — official's `<h1 data-detail-hero-title>` "管理插件和技能", as the first child
 *    of upstream's "yours" page root.
 * 3. **The installed section's body** — the first six rows in the grid, then the visible
 *    "显示全部 N 个插件" control, then a collapsed `div[aria-hidden][inert]` holding the
 *    remaining rows under a hidden "更多已安装的插件" label. Upstream's own expand flag (`b`)
 *    drives it; no new state is introduced.
 * 4. **The wording** — official 0.78.1's own message ids and texts, routed through the chunk's
 *    own locale runtime (`RLocT(en, zh)`) so the language preference still switches them.
 * 5. **The manage page's own row subtitle builder** — official's manage-page format: the
 *    connector count and the skill count, joined by official's own `Intl.ListFormat`
 *    (`style:"short"`, `type:"unit"`), which is why the Chinese reads "1 个连接器14 项技能".
 *    Upstream's shared `tt` builder is left alone: it is also the browse page's subtitle
 *    builder, whose 0.78.1 parity was signed off in the earlier wave.
 * 6. **A plugins-chunk-local detail bar** — official 0.78.1's markup (the labelled "‹ 连接应用"
 *    back button + the `h3` "管理" + the trailing slot), rendered instead of the browse header
 *    and toolbar while the manage page is open. `scroll-pane-CvNuGyd2.js` is shared by every
 *    settings surface and is NOT patched.
 * 7. **The connector auth action's label** — upstream 0.18's shared `Qn` picks its label from
 *    the LOCAL handoff status and hardcodes upstream's own authorize-mode wording
 *    ("Authenticate" / "Reopen" / "Retry" → 身份验证 / 重新打开 / 重试). Official 0.78.1 runs the
 *    same action through `W` → `le` → `K`, and `K`'s connect-mode branch picks official's
 *    `iSLIjg` ("Connect" → 连接), `gcoiFh` ("Reconnect" → 重新连接) and `6gRgw8`
 *    ("Retry" → 重试). The live official app shows "连接" for a connector that needs
 *    authentication, so the port rewrites upstream's label to official's.
 *
 * ## Every class recipe is the CAPTURED one, never a hardcoded copy
 *
 * The class recipes are read out of `tests/fixtures/official-0781-manage-page-recipes.json` at
 * load time, the same way the sibling 0.78.1 patches read their captured frames. The fixture is
 * a live capture, so it can move: the detail bar's `h3` was first captured mid fade-in (with
 * official's `sand-g01cxk` "hidden" recipe on it) and now carries the settled recipe
 * (`detailTitle` + `detailTitleFading`). Reading the fixture instead of a copy means the port
 * follows the capture rather than a snapshot of it.
 *
 * The recipes the fixture does NOT record — the collapsed wrapper's expanded variant, the
 * show-all wrapper's two variants, the detail bar's back-button wrapper and its icon and
 * label slots, and the collapsed list's inner wrapper — are official's own class strings, read
 * out of official's bytes (see the evidence block at the end of this file).
 *
 * ## Every string here is official 0.78.1's own
 *
 * The message ids are official's, read out of `chunk-core-CXBwRBzw.js` (zh-Hans) and
 * `index.eager-common-DbK3Oi_r.js` (English). Nothing is invented: where official's markup
 * could not be reproduced exactly, the deviation is recorded in the port record rather than
 * guessed around.
 *
 * ## Two ways of anchoring, both fail-closed
 *
 * Most anchors are plain `before`/`after` pairs. Three of them are SPANS and one is a RUN: the
 * text between two unique markers is replaced, because the i18n and wording passes rewrite the
 * literals inside that text (`"Installed"` becomes `RLocT("Installed","已安装")`, the show-all
 * label becomes `RLocT("Show all "+U.length+" plugins", …)`). The markers are the stable parts,
 * and each marker must occur EXACTLY ONCE in the chunk — so a missing or ambiguous marker
 * throws and the build stops, exactly like a plain anchor. The spans make this patch apply
 * identically to the pristine upstream chunk and to the chunk the i18n, wording and
 * browse-chrome passes have already rewritten.
 *
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the manage page component (the hero, the
 *   installed section's body, the collapsed wrapper and the show-all wrapper), the detail bar's
 *   call site (`backLabel`, `headingId`, `isTitleVisible`, `onBack`, `title`) and the row
 *   subtitle builder `Vo`.
 * @evidence official 0.78.1 `index.eager-app-D1juOWZp.js` — the shared components: `MAt` (the
 *   section), `PAt` (the grid), `FAt` (the row), `GAt` (the show-all button), `Hq`/`Uq` (the
 *   count builder and the joined list) and `mm` (the `Intl.ListFormat` joiner). The same file
 *   carries the status registry `Nq`, the status badge `LAt` and the status-to-text map `eAt`.
 * @evidence official 0.78.1 `chunk-plugin-detail-sharepoint-write-MAPmM3e9.js` — the connector
 *   auth action `W` (exported as `mr`), the account action `le` and the label chain `K`, which
 *   picks `iSLIjg` ("Connect"), `gcoiFh` ("Reconnect") and `6gRgw8` ("Retry").
 * @evidence official 0.78.1 `chunk-pane-header-DaY0itEE.js` — the detail bar `S`: the labelled
 *   back button, the `h3` (whose `detailTitle` / `detailTitleFading` / `detailTitleHidden`
 *   recipes are official's three title variants) and the trailing slot.
 * @evidence official 0.78.1 `chunk-core-CXBwRBzw.js` / `index.eager-common-DbK3Oi_r.js` — the
 *   zh-Hans and English text of every message id used here.
 * @evidence official 0.78.1 live (CDP 9333, 2026-11-01) — the fixture's class recipes.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { normalizeJsxChildren } from "./marketplace-jsx-children.mjs";

/** The chunk this patch owns: upstream 0.18's plugins view. */
export const MARKETPLACE_MANAGE_PAGE_0781_CHUNK = "view-B5Ug8wEm.js";

/**
 * Official 0.78.1's captured class recipes.
 *
 * This is the live capture of official's second-level page, read at load time so the port
 * always lands on the captured recipe rather than on a copy of it.
 */
const OFFICIAL = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/official-0781-manage-page-recipes.json", import.meta.url),
    "utf8",
  ),
);

/**
 * A component's class recipe, with upstream's own marker class taken off the front.
 *
 * Upstream's `k(marker, recipe)` renders `marker recipe`, and official's captured class string
 * therefore starts with the marker. The recipes this patch writes into the chunk are the recipe
 * alone; the marker stays the first argument of the `k(...)` call.
 */
function recipeWithoutMarker(className, marker) {
  if (typeof className !== "string" || !className.startsWith(`${marker} `)) {
    throw new Error(
      `Official manage page recipe for ${marker} does not start with the marker: ${String(className)}`,
    );
  }
  return className.slice(marker.length + 1);
}

/**
 * Official 0.78.1's class recipes, taken from the capture.
 *
 * `sectionTitle` and `detailBarTitle` carry the whole captured class string — official's
 * `Text` component's own `ui-` classes included — because upstream 0.18's `Text` resolves a
 * different set of `ui-` classes and the port has to land on official's class for class.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_CLASSES = Object.freeze({
  hero: OFFICIAL.hero.class,
  heroWrapper: OFFICIAL.hero.wrapperClass,
  section: recipeWithoutMarker(OFFICIAL.installedSection.class, "sand-plugins__group"),
  sectionHeader: OFFICIAL.installedSection.headerClass,
  sectionTitle: OFFICIAL.installedSection.h3Class,
  grid: recipeWithoutMarker(OFFICIAL.installedSection.gridClass, "sand-plugins__grid"),
  gridFullWidth: recipeWithoutMarker(OFFICIAL.privateSection.gridClass, "sand-plugins__grid"),
  row: recipeWithoutMarker(OFFICIAL.row.class, "sand-plugins-row"),
  rowOpen: recipeWithoutMarker(OFFICIAL.row.openClass, "sand-plugins-row__open"),
  rowName: recipeWithoutMarker(OFFICIAL.row.nameClass, "sand-plugins-row__name"),
  rowSubtitle: recipeWithoutMarker(OFFICIAL.row.subtitleClass, "sand-plugins-row__subtitle"),
  rowTrailing: recipeWithoutMarker(OFFICIAL.row.trailingClass, "sand-plugins-row__trailing"),
  showAll: recipeWithoutMarker(OFFICIAL.showAll.class, "sand-plugins__show-all"),
  collapsed: OFFICIAL.collapsed.class,
  collapsedInner: OFFICIAL.collapsed.innerClass,
  detailBar: OFFICIAL.detailBar.class,
  detailBarBackButton: OFFICIAL.detailBar.buttonClass,
  detailBarTitle: OFFICIAL.detailBar.h3Class,
  detailBarTitleHidden: OFFICIAL.detailBar.h3HiddenClass,
  detailBarTitleHiddenAriaHidden: OFFICIAL.detailBar.h3HiddenAttrs["aria-hidden"],
  detailBarTrailing: OFFICIAL.detailBar.trailingClass,
});

/**
 * Official 0.78.1's class recipes the capture does not record, read out of official's bytes.
 *
 * * the collapsed wrapper's second variant — the collapsed remainder once it is expanded;
 * * the show-all wrapper's two variants — hidden once the remainder is expanded;
 * * the detail bar's back-button wrapper, its icon slot and its label slot;
 * * the collapsed list's inner wrapper (the one that holds the hidden label and the grid).
 *
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the installed section's body.
 * @evidence official 0.78.1 `chunk-pane-header-DaY0itEE.js` — the detail bar `S`.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES = Object.freeze({
  collapsedExpanded:
    "sand-rvj5dj sand-icbapw sand-1ympp8d sand-1upsisp sand-t35mv4 sand-1r6a6jf sand-1tu4anv sand-1hc1fzr sand-nn1q72 sand-67bb7w",
  showAllWrapper:
    "sand-rvj5dj sand-1erjwpq sand-1ympp8d sand-1upsisp sand-t35mv4 sand-1r6a6jf sand-1tu4anv sand-1hc1fzr sand-67bb7w",
  showAllWrapperHidden:
    "sand-rvj5dj sand-ihq33y sand-g01cxk sand-47corl sand-1erjwpq sand-1ympp8d sand-1upsisp sand-t35mv4 sand-1r6a6jf",
  restList: "sand-1nn3v0j",
  detailBarBack: "sand-1lqcxt8 sand-euugli",
  detailBarIcon:
    "sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-w4jnvo sand-1qx5ct2",
  detailBarLabel: "sand-b3r6kr sand-lyipyv sand-uxw1ft",
});

/**
 * Official 0.78.1's status-badge variant recipes, read out of official's own registry.
 *
 * Official ships three variants of one badge recipe — connected, warn and error — and each
 * carries its own colour class. The capture only ever saw the connected variant, because the
 * live dialog showed no warning and no failing connector; the other two are read out of
 * official's bytes.
 *
 * Upstream 0.18 ships its own three, and the port replaces them with official's, so the ported
 * page has to carry official's colour rules itself. Each of the three classes resolves nowhere
 * inside upstream 0.18's plugins dialog, and each of official's rules reads a `--sand-text-*`
 * colour token that upstream 0.18's palette does not define.
 *
 * @evidence official 0.78.1 `index.eager-app-D1juOWZp.js` — the `status` recipe registry.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_STATUS_VARIANT_CLASSES = Object.freeze({
  connected: "sand-1ufr4hg",
  warn: "sand-132xtu3",
  error: "sand-wtpwev",
});

/**
 * Official 0.78.1's message ids used by this patch, with official's own text.
 *
 * `zh` is the text the patch writes into the chunk, so it is always a contiguous literal there.
 * The two plural messages carry official's "#" placeholder (official's own template:
 * `["显示全部 ","#"," 个插件"]`), because the count is interpolated at render time.
 *
 * `backLabel` is the dialog's title, which official renders as its own back button's label
 * (official's id `g/jm+8`). The repo's own wording pass keeps the dialog title's English at
 * upstream's "Plugins" and localizes it to 连接应用, so the back button reuses that same string
 * rather than introducing a second English string for the same title.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_MESSAGES = Object.freeze({
  hero: Object.freeze({ id: "ZoHizH", en: "Manage plugins and skills", zh: "管理插件和技能" }),
  manage: Object.freeze({ id: "wckWOP", en: "Manage", zh: "管理" }),
  installed: Object.freeze({ id: "eQkgKV", en: "Installed", zh: "已安装" }),
  privateSkills: Object.freeze({ id: "glMsdy", en: "Private skills", zh: "私有技能" }),
  showAll: Object.freeze({ id: "Wy8KR2", en: "Show all # plugins", zh: "显示全部 # 个插件" }),
  emptyInstalled: Object.freeze({
    id: "ZyWE2h",
    en: "Nothing installed yet. Find plugins in the marketplace.",
    zh: "尚未安装任何插件。请在市场中查找插件。",
  }),
  moreInstalled: Object.freeze({
    id: "iofzif",
    en: "More installed plugins",
    zh: "更多已安装的插件",
  }),
  backLabel: Object.freeze({ id: "g/jm+8", en: "Plugins", zh: "连接应用" }),
  openLabel: Object.freeze({ id: "T9mwDN", en: "Open ", zh: "打开 " }),
  connectorCount: Object.freeze({ id: "d5N5Il", en: "# connector", zh: "# 个连接器" }),
  skillCount: Object.freeze({ id: "m+pG3Q", en: "# skill", zh: "# 项技能" }),
  connect: Object.freeze({ id: "iSLIjg", en: "Connect", zh: "连接" }),
  reconnect: Object.freeze({ id: "gcoiFh", en: "Reconnect", zh: "重新连接" }),
  retry: Object.freeze({ id: "6gRgw8", en: "Retry", zh: "重试" }),
});

/**
 * The installed section's own row elements, kept in one local so the visible grid and the
 * collapsed grid can share ONE set of row elements.
 *
 * Upstream's row closure is bound to the manage page's own locals (the ToolIcon, the server
 * resolvers, the open handlers), so it cannot move into this module. Instead the patch assigns
 * the mapped elements to one local and slices that array: the first six go to the visible grid,
 * the rest go to the collapsed one.
 */
const ROW_ASSIGNMENT = "RM0781ManageRowElements";

const REPLACEMENTS = [
  {
    label: "the section: official's class recipe",
    before: 'k("sand-plugins__group","sand-9f619 sand-78zum5 sand-dt5ytf sand-xhr3t")',
    after: `k("sand-plugins__group","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.section}")`,
  },
  {
    label: "the section: official's header wrapper div and official's h3 class recipe",
    before:
      'let d;e[1]===Symbol.for("react.memo_cache_sentinel")?(d={className:"sand-9f619 sand-1y1aw1k sand-y13l1i sand-10b6aqq sand-163pfp"},e[1]=d):d=e[1];' +
      'let r;e[2]!==s||e[3]!==a?(r=t.jsx(me,{as:"h3",className:d.className,color:"tertiary",id:a,size:"sm",children:s}),e[2]=s,e[3]=a,e[4]=r):r=e[4];' +
      'let o;return e[5]!==l||e[6]!==r||e[7]!==a?(o=t.jsxs("section",{"aria-labelledby":a,className:i,children:[r,l]}),e[5]=l,e[6]=r,e[7]=a,e[8]=o):o=e[8],o}',
    after:
      'let d;e[1]===Symbol.for("react.memo_cache_sentinel")?(d={className:"' +
      MARKETPLACE_MANAGE_PAGE_0781_CLASSES.sectionTitle +
      '"},e[1]=d):d=e[1];' +
      'let r;e[2]!==s||e[3]!==a?(r=t.jsx("h3",{className:d.className,"data-variant":"default","data-size":"sm","data-weight":"regular",id:a,children:s}),e[2]=s,e[3]=a,e[4]=r):r=e[4];' +
      'let o;return e[5]!==l||e[6]!==r||e[7]!==a?(o=t.jsxs("section",{"aria-labelledby":a,className:i,children:[t.jsxs("div",{className:"' +
      MARKETPLACE_MANAGE_PAGE_0781_CLASSES.sectionHeader +
      '",children:[r]}),l]}),e[5]=l,e[6]=r,e[7]=a,e[8]=o):o=e[8],o}',
  },
  {
    label: "the plugins grid: official's two-column and full-width class recipes",
    before:
      'k("sand-plugins__grid",{0:{className:"sand-9f619 sand-rvj5dj sand-nby9oq sand-fex06f sand-1dbijih sand-3ct3a4 sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l"},' +
      '1:{className:"sand-9f619 sand-rvj5dj sand-fex06f sand-1dbijih sand-3ct3a4 sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l sand-1mkdm3x"}}[!!i<<0].className)',
    after:
      'k("sand-plugins__grid",{0:{className:"' +
      MARKETPLACE_MANAGE_PAGE_0781_CLASSES.grid +
      '"},1:{className:"' +
      MARKETPLACE_MANAGE_PAGE_0781_CLASSES.gridFullWidth +
      '"}}[!!i<<0].className)',
  },
  {
    label: "the plugin row: official's row class recipe",
    before:
      'k("sand-plugins-row","sand-9f619 sand-78zum5 sand-6s0dn4 sand-1v2ro7d sand-euugli sand-z9dl7a sand-nuq7ks sand-sag5q8 sand-f18ygs sand-gqmno8 sand-jbqb8w sand-1q5pob1")',
    after: `k("sand-plugins-row","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.row}")`,
  },
  {
    label: "the plugin row's open button: official's class recipe",
    before:
      'k("sand-plugins-row__open","sand-9f619 sand-78zum5 sand-6s0dn4 sand-883omv sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-exx8yu sand-1xpa7k sand-18d9i69 sand-1uhho1l sand-c342km sand-ng3xce sand-jbqb8w sand-1heor9g sand-jb2p0i sand-dpxx8g sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-2d6ogt sand-1wfwxd8 sand-7s97pk sand-1kogg8i")',
    after: `k("sand-plugins-row__open","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.rowOpen}")`,
  },
  {
    label: "the plugin row's name: official's class recipe",
    before:
      'k("sand-plugins-row__name","sand-9f619 sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1rhlpx6 sand-1wd3ewq sand-lyipyv sand-uxw1ft")',
    after: `k("sand-plugins-row__name","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.rowName}")`,
  },
  {
    label: "the plugin row's subtitle: official's class recipe",
    before:
      'k("sand-plugins-row__subtitle","sand-9f619 sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-19aaqeu sand-lyipyv sand-uxw1ft")',
    after: `k("sand-plugins-row__subtitle","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.rowSubtitle}")`,
  },
  {
    label: "the plugin row's trailing slot: official's class recipe",
    before:
      'k("sand-plugins-row__trailing","sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-1c4vz4f sand-2lah0s sand-dl72j9")',
    after: `k("sand-plugins-row__trailing","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.rowTrailing}")`,
  },
  {
    label: "the show-all button: official's class recipe",
    before:
      'k("sand-plugins__show-all","sand-9f619 sand-qcrz7y sand-1iorvi4 sand-y13l1i sand-jkvuk6 sand-163pfp sand-c342km sand-ng3xce sand-jbqb8w sand-19aaqeu sand-7gh5u8 sand-jb2p0i sand-fifm61 sand-1ypdohk")',
    after: `k("sand-plugins__show-all","${MARKETPLACE_MANAGE_PAGE_0781_CLASSES.showAll}")`,
  },
  {
    label: "the manage page: official's hero is the first child of the 'yours' root",
    before: 't.jsxs("div",{className:T,children:[O,M,R,E]})',
    after: `t.jsxs("div",{className:T,children:[t.jsx(RM0781ManageHero,{}),O,M,R,E]})`,
  },
  {
    label: "the manage page: the installed rows are split into the visible six and the collapsed rest",
    before: "{visible:J,hiddenCount:te}=Jn(U,b||q,Dl),",
    after: "{visible:J,hiddenCount:te}=Jn(U,b||q,Dl),RM0781ManageParts=RM0781ManageSplitRows(U,q,Dl),",
  },
  {
    label: "the manage page: the row elements are kept so the collapsed list can reuse them",
    before: "let T,O,M,R,E;",
    after: `let T,O,M,R,E,${ROW_ASSIGNMENT};`,
  },
  {
    label: "the manage page: the visible grid maps the whole list once",
    before: "t.jsx(Ws,{labelledBy:w,children:J.map(H=>{",
    after: `t.jsx(Ws,{labelledBy:w,children:(${ROW_ASSIGNMENT}=U.map(H=>{`,
  },
  {
    label:
      "the manage page: the installed section's body is the visible grid, the show-all control and the collapsed remainder",
    kind: "run",
    start: "}),te>0?t.jsx(ot,{hiddenLabel:",
    end: ",onShowAll:()=>z(!0)}):null]})",
    after:
      `,${ROW_ASSIGNMENT}.slice(0,RM0781ManageParts.visibleCount)),}),` +
      "t.jsx(RM0781ManageRest,{collapsedRows:" +
      `${ROW_ASSIGNMENT}.slice(RM0781ManageParts.visibleCount),expanded:b,onShowAll:()=>z(!0),total:U.length})]})`,
  },
  {
    label: "the manage page: the installed section's title is official's",
    kind: "between",
    start: "R=le?t.jsx(Hs,{title:",
    end: ",titleId:w,children:U.length===0?",
    after: 'RLocT("Installed","已安装")',
  },
  {
    label: "the manage page: the installed section's empty state is official's",
    kind: "between",
    start:
      'U.length===0?t.jsx(me,{as:"p",className:"sand-9f619 sand-y13l1i sand-163pfp",color:"tertiary",size:"xs",children:',
    end: "}):t.jsxs(t.Fragment,{children:[t.jsx(Ws,{labelledBy:w,children:",
    after:
      'q?RLocT("No installed plugins match \\""+$+"\\"","没有已安装的插件匹配“"+$+"”"):' +
      'RLocT("Nothing installed yet. Find plugins in the marketplace.","尚未安装任何插件。请在市场中查找插件。")',
  },
  {
    label: "the manage page: the private-skills section's title is official's",
    kind: "between",
    start: "E=de?t.jsx(Hs,{title:",
    end: ",titleId:g,children:s==null?",
    after: 'RLocT("Private","私有技能")',
  },
  {
    label: "the manage page: the installed row's subtitle is official's manage-page format",
    before: "function yi(n){return tt({...ys(n.entry),commands:null})}",
    after: "function yi(n){return RM0781ManageSubtitle(n)}",
  },
  {
    label:
      "the dialog: the manage page renders official's detail bar instead of the browse header and toolbar",
    before: "Me!=null?t.jsx(el,{headingId:a,onBack:W,title:Ts}):t.jsxs(t.Fragment,{children:[",
    after:
      "Me!=null?t.jsx(el,{headingId:a,onBack:W,title:Ts}):" +
      'p==="yours"?t.jsx(RM0781ManageDetailBar,{backLabel:RLocT("Plugins","连接应用"),headingId:a,onBack:()=>x("marketplace"),title:RLocT("Manage","管理")}):' +
      "t.jsxs(t.Fragment,{children:[",
  },
  {
    label: "the row: the open button carries official's localized label",
    before: '"aria-label":`Open ${a}`',
    after: '"aria-label":RLocT("Open "+a,"打开 "+a)',
  },
  {
    label: "the status badge: official's class recipes",
    before:
      'const cs={status:{kB7OPa:"sand-9f619",kGuDYH:"sand-4z9k3i",kLWn49:"sand-d4r4e8",kb6lSQ:"sand-12oo3zp",kMwMTN:"sand-4b2ntj",khDVqt:"sand-uxw1ft",$$css:!0},' +
      'statusConnected:{kMwMTN:"sand-98zg7y",$$css:!0},statusWarn:{kMwMTN:"sand-1izesbo",$$css:!0},statusError:{kMwMTN:"sand-pmgbkh",$$css:!0}};',
    after:
      'const cs={status:{kB7OPa:"sand-9f619",kGuDYH:"sand-11wthnw",kLWn49:"sand-d4r4e8",kb6lSQ:"sand-12oo3zp",kMwMTN:"sand-169k319",khDVqt:"sand-uxw1ft",$$css:!0},' +
      `statusConnected:{kMwMTN:"${MARKETPLACE_MANAGE_PAGE_0781_STATUS_VARIANT_CLASSES.connected}",$$css:!0},` +
      `statusWarn:{kMwMTN:"${MARKETPLACE_MANAGE_PAGE_0781_STATUS_VARIANT_CLASSES.warn}",$$css:!0},` +
      `statusError:{kMwMTN:"${MARKETPLACE_MANAGE_PAGE_0781_STATUS_VARIANT_CLASSES.error}",$$css:!0}};`,
  },
  {
    label:
      "the status badge: the variant's class replaces the base's, as official's own composer does",
    before: 'a=k("sand-plugins__status",Re(cs.status,o).className)',
    after:
      'a=k("sand-plugins__status",{className:RM0781ManageStatusClass(cs.status,o)}.className)',
  },
  {
    label: "the private-skills row: official's icon wrapper recipe",
    before:
      'k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-l56j7k sand-100vrsf sand-1vqgdyp sand-2lah0s sand-1kogg8i sand-arj5zm")',
    after:
      'k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-l56j7k sand-100vrsf sand-1vqgdyp sand-2lah0s sand-1kogg8i sand-wpq65r")',
  },
  {
    label:
      "the private-skills row: no enable toggle in the trailing slot, as official's row has none",
    // A RUN, because the i18n pass rewrites the toggle's own label between the two
    // markers. The markers themselves are stable in the pristine chunk and in the
    // chunk the i18n, wording and browse-chrome passes have already rewritten.
    kind: "run",
    start:
      'trailing:H.source==="workflow"?t.jsx(Kn,{isChecked:H.isEnabledForAgent,isDisabled:c,label:',
    end: "}):null},H.id))",
    after: "trailing:null},H.id))",
  },
  {
    label:
      "the connector auth action: official's connect-mode label, as official's own `K` chain picks it",
    // A BETWEEN, because the i18n pass rewrites the three label literals between the two
    // markers. The markers themselves are stable in the pristine chunk and in the chunk the
    // i18n, wording and browse-chrome passes have already rewritten.
    kind: "between",
    start: "const o=d==null",
    end: ':d.status==="waiting"?',
    after: '||d.status==="completed"?(RLocT("Connect","连接"))',
  },
  {
    label:
      "the connector auth action: official's reconnect and retry labels, as official's own `K` chain picks them",
    // The same BETWEEN shape as the label above. The two replacements together rewrite
    // upstream's own authorize-mode labels into official's connect-mode ones.
    kind: "between",
    start: ':d.status==="waiting"?',
    end: ";let c;return e[6]!==a||e[7]!==r||e[8]!==o?",
    after: '(RLocT("Reconnect","重新连接")):(RLocT("Retry","重试"))',
  },
];

/**
 * The injected source.
 *
 * It lives in the chunk's module scope, so it can use the chunk's own `t` (jsx runtime), `C`
 * (react), `ue` (the icon component), `Ws` (the plugin grid), `ot` (the show-all button),
 * `ys` (the contribution counts) and `RLocT(en, zh)` (the locale runtime the i18n passes append).
 */
const INJECTED_SOURCE = normalizeJsxChildren(
  [
    `const RM0781ManageHeroClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.hero)};`,
    `const RM0781ManageHeroWrapperClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.heroWrapper)};`,
    `const RM0781ManageDetailBarTitleHiddenClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBarTitleHidden)};`,
    `const RM0781ManageDetailBarTitleHiddenAriaHidden=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBarTitleHiddenAriaHidden)};`,
    `const RM0781ManageCollapsedClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.collapsed)};`,
    `const RM0781ManageCollapsedExpandedClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.collapsedExpanded)};`,
    `const RM0781ManageShowAllWrapperClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.showAllWrapper)};`,
    `const RM0781ManageShowAllWrapperHiddenClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.showAllWrapperHidden)};`,
    `const RM0781ManageRestInnerClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.collapsedInner)};`,
    `const RM0781ManageRestListClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.restList)};`,
    `const RM0781ManageDetailBarClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBar)};`,
    `const RM0781ManageDetailBarBackClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.detailBarBack)};`,
    `const RM0781ManageDetailBarBackButtonClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBarBackButton)};`,
    `const RM0781ManageDetailBarIconClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.detailBarIcon)};`,
    `const RM0781ManageDetailBarLabelClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES.detailBarLabel)};`,
    `const RM0781ManageDetailBarTitleClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBarTitle)};`,
    `const RM0781ManageDetailBarTrailingClasses=${JSON.stringify(MARKETPLACE_MANAGE_PAGE_0781_CLASSES.detailBarTrailing)};`,
    'const RM0781ManageConnectorZh="# 个连接器";',
    'const RM0781ManageConnectorEnOne="# connector";',
    'const RM0781ManageConnectorEnOther="# connectors";',
    'const RM0781ManageSkillZh="# 项技能";',
    'const RM0781ManageSkillEnOne="# skill";',
    'const RM0781ManageSkillEnOther="# skills";',
    'const RM0781ManageShowAllZh="显示全部 # 个插件";',
    'const RM0781ManageShowAllEn="Show all # plugins";',
    'const RM0781ManageShowAllEnOne="Show # plugin";',
    'function RM0781ManageLocale(){return typeof RLocBoot==="function"?RLocBoot():"en"}',
    "function RM0781ManageCount(count,one,other,zh){",
    '  const en=(count===1?one:other).replace("#",String(count));',
    '  return RLocT(en,zh.replace("#",String(count)));',
    "}",
    "function RM0781ManageConnectorCount(count){return RM0781ManageCount(count,RM0781ManageConnectorEnOne,RM0781ManageConnectorEnOther,RM0781ManageConnectorZh)}",
    "function RM0781ManageSkillCount(count){return RM0781ManageCount(count,RM0781ManageSkillEnOne,RM0781ManageSkillEnOther,RM0781ManageSkillZh)}",
    "function RM0781ManageShowAllLabel(total){",
    '  const en=(total===1?RM0781ManageShowAllEnOne:RM0781ManageShowAllEn).replace("#",String(total));',
    '  return RLocT(en,RM0781ManageShowAllZh.replace("#",String(total)));',
    "}",
    // Official joins the counts with its own `Intl.ListFormat` (`mm`), which is why the Chinese
    // reads "1 个连接器14 项技能" — the unit-style list format carries no separator in zh.
    "function RM0781ManageList(parts){",
    '  if(parts.length===0)return RLocT("no supported contributions","无可用内容");',
    '  try{return new Intl.ListFormat(RM0781ManageLocale(),{style:"short",type:"unit"}).format(parts)}',
    '  catch(_e){return parts.join("")}',
    "}",
    "function RM0781ManageSubtitle(row){",
    "  const counts=ys(row.entry);",
    "  const parts=[];",
    "  if(counts.connectors>0)parts.push(RM0781ManageConnectorCount(counts.connectors));",
    "  if(counts.skills!=null&&counts.skills>0)parts.push(RM0781ManageSkillCount(counts.skills));",
    "  return RM0781ManageList(parts);",
    "}",
    // Official splits the installed list after six rows whenever the page is not searching.
    "function RM0781ManageSplitRows(rows,searching,limit){",
    "  if(searching||rows.length<=limit)return{visibleCount:rows.length,restCount:0};",
    "  return{visibleCount:limit,restCount:rows.length-limit};",
    "}",
    // Official composes the status badge's recipe from its base recipe plus the
    // variant's own class: the variant's class REPLACES the base's `kMwMTN` and lands
    // at the end. Measured on the live official app for `connected` and `error`.
    "function RM0781ManageStatusClass(base,variant){",
    '  const ordered=Object.keys(base).filter(k=>k!=="$$css");',
    '  const kept=variant?ordered.filter(k=>k!=="kMwMTN"):ordered;',
    "  const parts=kept.map(k=>base[k]);",
    "  if(variant)parts.push(variant.kMwMTN);",
    '  return parts.join(" ");',
    "}",
    "function RM0781ManageHero(){",
    '  return t.jsx("header",{className:RM0781ManageHeroWrapperClasses,children:',
    '    t.jsx("h1",{"data-detail-hero-title":"",className:RM0781ManageHeroClasses,tabIndex:-1,children:RLocT("Manage plugins and skills","管理插件和技能")})});',
    "}",
    "function RM0781ManageRest(props){",
    "  const{collapsedRows,expanded,onShowAll,total}=props;",
    "  const labelId=C.useId();",
    "  if(collapsedRows.length===0)return null;",
    '  const collapsed=t.jsx("div",{"aria-hidden":!expanded||void 0,inert:!expanded||void 0,',
    "    className:expanded?RM0781ManageCollapsedExpandedClasses:RM0781ManageCollapsedClasses,",
    '    children:t.jsx("div",{className:RM0781ManageRestInnerClasses,children:t.jsxs("div",{className:RM0781ManageRestListClasses,children:[',
    '      t.jsx("span",{hidden:!0,id:labelId,children:RLocT("More installed plugins","更多已安装的插件")}),',
    "      t.jsx(Ws,{labelledBy:labelId,children:collapsedRows}),",
    "    ]})})});",
    '  const showAll=t.jsx("div",{"aria-hidden":expanded||void 0,inert:expanded||void 0,',
    "    className:expanded?RM0781ManageShowAllWrapperHiddenClasses:RM0781ManageShowAllWrapperClasses,",
    '    children:t.jsx("div",{className:RM0781ManageRestInnerClasses,children:t.jsx(ot,{hiddenLabel:RM0781ManageShowAllLabel(total),onShowAll:onShowAll})})});',
    "  return t.jsxs(t.Fragment,{children:[collapsed,showAll]});",
    "}",
    // Official's own scroll container lookup: the viewport the hero title is observed against.
    // The nearest ancestor that scrolls is the pane's viewport in both official and this build.
    "function RM0781ManageScrollViewport(node){",
    "  let current=node.parentElement;",
    "  while(current!=null){",
    "    const overflow=getComputedStyle(current).overflowY;",
    '    if(overflow==="auto"||overflow==="scroll")return current;',
    "    current=current.parentElement;",
    "  }",
    "  return null;",
    "}",
    // Official observes the hero title with an IntersectionObserver rooted at the pane's
    // viewport and reports `visible` while the hero is in view and `hidden` once it is not.
    // The detail bar's own title is visible exactly while the hero title is NOT in view, so
    // the bar title is hidden at the top of the page and appears once the hero scrolls away.
    "function RM0781ManageHeroTitleState(){",
    '  const[heroTitle,setHeroTitle]=C.useState("unmeasured");',
    "  C.useEffect(()=>{",
    "    let observer=null;",
    "    let frame=null;",
    "    let cancelled=false;",
    "    const attach=()=>{",
    "      const hero=document.querySelector(\"[role='dialog'] h1[data-detail-hero-title]\");",
    "      if(hero==null)return false;",
    "      const viewport=RM0781ManageScrollViewport(hero);",
    '      setHeroTitle("visible");',
    "      if(viewport==null)return true;",
    "      observer=new IntersectionObserver((entries)=>{",
    "        const last=entries[entries.length-1];",
    '        if(last!=null)setHeroTitle(last.isIntersecting?"visible":"hidden");',
    "      },{root:viewport});",
    "      observer.observe(hero);",
    "      return true;",
    "    };",
    "    if(!attach()){",
    "      const retry=()=>{",
    "        if(cancelled)return;",
    "        if(!attach())frame=requestAnimationFrame(retry);",
    "      };",
    "      frame=requestAnimationFrame(retry);",
    "    }",
    "    return ()=>{",
    "      cancelled=true;",
    "      if(frame!=null)cancelAnimationFrame(frame);",
    "      if(observer!=null)observer.disconnect();",
    "    };",
    "  },[]);",
    "  return heroTitle;",
    "}",
    "function RM0781ManageDetailBar(props){",
    "  const{backLabel,headingId,onBack,title}=props;",
    "  const heroTitle=RM0781ManageHeroTitleState();",
    '  const titleVisible=heroTitle==="hidden";',
    "  const titleClass=titleVisible",
    "    ?RM0781ManageDetailBarTitleClasses",
    "    :RM0781ManageDetailBarTitleHiddenClasses;",
    '  const back=t.jsxs("button",{className:RM0781ManageDetailBarBackButtonClasses,onClick:onBack,type:"button",children:[',
    '    t.jsx("span",{"aria-hidden":"true",className:RM0781ManageDetailBarIconClasses,"data-size":"lg"},t.jsx(ue,{name:"chevron-left",size:16})),',
    "    t.jsx(\"span\",{className:RM0781ManageDetailBarLabelClasses,children:backLabel}),",
    "  ]});",
    '  return t.jsxs("div",{className:RM0781ManageDetailBarClasses,children:[',
    "    t.jsx(\"div\",{className:RM0781ManageDetailBarBackClasses,children:back}),",
    '    t.jsx("h3",{"aria-hidden":titleVisible?void 0:RM0781ManageDetailBarTitleHiddenAriaHidden,className:titleClass,id:headingId,children:title}),',
    "    t.jsx(\"div\",{className:RM0781ManageDetailBarTrailingClasses}),",
    "  ]});",
    "}",
  ].join("\n"),
);

/** The replacements, exported so the regression test can check them on their own. */
export const MARKETPLACE_MANAGE_PAGE_0781_REPLACEMENTS = REPLACEMENTS;

/** The injected source, exported so the regression test can parse it on its own. */
export const MARKETPLACE_MANAGE_PAGE_0781_INJECTED_SOURCE = INJECTED_SOURCE;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Original renderer manage page anchor is missing: ${label}`);
  if (source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer manage page anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Replaces the text BETWEEN two unique markers.
 *
 * Both markers must occur exactly once in the chunk, and the end marker must sit after the
 * start marker. The markers themselves are kept; only what lies between them is replaced.
 */
function replaceBetweenExactlyOnce(source, start, end, after, label) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`Original renderer manage page span start is missing: ${label}`);
  if (source.indexOf(start, startIndex + 1) >= 0) {
    throw new Error(`Original renderer manage page span start is ambiguous: ${label}`);
  }
  const endIndex = source.indexOf(end);
  if (endIndex < 0) throw new Error(`Original renderer manage page span end is missing: ${label}`);
  if (source.indexOf(end, endIndex + 1) >= 0) {
    throw new Error(`Original renderer manage page span end is ambiguous: ${label}`);
  }
  if (endIndex < startIndex + start.length) {
    throw new Error(`Original renderer manage page span end precedes its start: ${label}`);
  }
  return source.slice(0, startIndex + start.length) + after + source.slice(endIndex);
}

/**
 * Replaces a RUN that starts at one unique marker and ends at another.
 *
 * Both markers are consumed, so `after` has to re-emit whatever the run's tail was. The
 * installed section's body is replaced this way: the run's middle is the show-all label, which
 * the wording pass rewrites.
 */
function replaceRunExactlyOnce(source, start, end, after, label) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`Original renderer manage page run start is missing: ${label}`);
  if (source.indexOf(start, startIndex + 1) >= 0) {
    throw new Error(`Original renderer manage page run start is ambiguous: ${label}`);
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`Original renderer manage page run end is missing: ${label}`);
  if (source.indexOf(end, endIndex + 1) >= 0) {
    throw new Error(`Original renderer manage page run end is ambiguous: ${label}`);
  }
  return source.slice(0, startIndex) + after + source.slice(endIndex + end.length);
}

/** Applies official 0.78.1's second-level page to upstream 0.18's plugins chunk. */
export function patchMarketplaceManagePage0781(source) {
  let patched = source;
  for (const entry of REPLACEMENTS) {
    if (entry.kind === "between") {
      patched = replaceBetweenExactlyOnce(patched, entry.start, entry.end, entry.after, entry.label);
    } else if (entry.kind === "run") {
      patched = replaceRunExactlyOnce(patched, entry.start, entry.end, entry.after, entry.label);
    } else {
      patched = replaceExactlyOnce(patched, entry.before, entry.after, entry.label);
    }
  }
  // The injected components are function DECLARATIONS and `const` bindings in the chunk's
  // module scope. The `const` bindings are read by the replacements above at *render* time
  // (inside the component body), which runs after the module body, so the temporal-dead-zone is
  // not an issue.
  patched = `${patched}\n${INJECTED_SOURCE}\n`;
  return patched;
}

export async function applyMarketplaceManagePage0781({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assets)) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(path.join(assets, name), "utf8");
    if (source.includes('k("sand-plugins__bar"')) candidates.push({ name, source });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Marketplace manage page patch: expected one plugins chunk, found ${candidates.length}.`,
    );
  }
  const { name, source } = candidates[0];
  const patched = patchMarketplaceManagePage0781(source);
  // Fail closed: the rewritten chunk must still parse as a module.
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  await writeFile(path.join(assets, name), patched);
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const provenance = {
    mode: "marketplace-manage-page-0781",
    referenceVersion: "0.78.1",
    file: `dist/renderer/assets/${name}`,
    originalSha256: sha256(source),
    patchedSha256: sha256(patched),
    anchors: REPLACEMENTS.map((entry) => ({
      label: entry.label,
      kind: entry.kind ?? "plain",
      before: entry.before ?? entry.start,
      after: entry.after,
    })),
    features: REPLACEMENTS.map((entry) => entry.label),
    officialMessageIds: Object.entries(MARKETPLACE_MANAGE_PAGE_0781_MESSAGES).map(
      ([key, message]) => ({ key, id: message.id, en: message.en, zh: message.zh }),
    ),
    officialClassRecipes: {
      ...MARKETPLACE_MANAGE_PAGE_0781_CLASSES,
      ...MARKETPLACE_MANAGE_PAGE_0781_EXTRA_CLASSES,
    },
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-manage-page-0781.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Marketplace manage page: official 0.78.1's second-level page applied (${name}).`);
  return provenance;
}
