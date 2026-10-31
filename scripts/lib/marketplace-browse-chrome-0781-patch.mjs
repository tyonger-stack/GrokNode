/**
 * Official Grok Bot 0.78.1's browse-page model, ported into upstream 0.18's plugins view.
 *
 * ## What official 0.78.1's browse page looks like (measured live on official 9333, 2026-10-30)
 *
 *   连接应用                                    [icon stack] 已连接 25 个 ›
 *   [ 在应用和技能中搜索………………………… ]  [ Bot 模板 ↗ ]
 *   [全部] [密码管理器] [效率] [通信] [设计] [代码] [更多 ⌄]
 *   为你推荐                                        查看全部
 *   密码管理器
 *   效率                                              查看全部
 *   …
 *
 * Thirteen sections in the "all" state: 为你推荐 first, then the eleven chip buckets. Every section
 * previews six rows and carries a 查看全部 group action exactly when it holds more than six.
 *
 * ## The three 查看全部 semantics (official's own, measured 2026-10-30)
 *
 *   * A chip section's 查看全部 selects that chip. The chip row's `aria-pressed` moves to it, 全部
 *     unpresses, and the page becomes that one chip's FULL list — the group action disappears
 *     because the section is no longer a preview.
 *   * 为你推荐's 查看全部 does NOT change the chip selection. It appends a hero block at the END of
 *     the list — `<section>` with an `<h1 data-detail-hero-title>` reading 为你推荐 and all 24
 *     recommended rows. The thirteen original sections stay untouched.
 *
 * The port implements both. The hero block is official's own markup and class recipe.
 *
 * ## What this patch ports
 *
 * 1. **The chip taxonomy as the section taxonomy** — official's `P` (group the catalog by chip),
 *    `O`/`M` (an entry's chips), `x` (the upstream-category-key → chip map) and `b` (the chip order).
 * 2. **The 为你推荐 section** — official's `y` ranking, ported literally, with an empty
 *    `teamInstallCounts` (Grok Node has no team data; see the port record).
 * 3. **The 查看全部 group action** — official's `NAt` markup, with both semantics above.
 * 4. **The chip row** — official's own chip row: 全部 + the first five chips flat, the rest in a
 *    更多 dropdown whose trigger shows the selected overflow chip's name.
 * 5. **The Bot 模板 ↗ button** — official's own markup, class recipe and message id.
 * 6. **The trailing connect action** — official's 连接 / 正在连接… / 已连接, with no button at all
 *    once the app is connected.
 * 7. **The connected-apps entry** and the search placeholder — unchanged in shape from the 0.75.8
 *    port, kept here because the chip row and the entry share this module's registry.
 *
 * ## One source of truth for the taxonomy
 *
 * `MARKETPLACE_0781_CHIP_REGISTRY` is the only place a chip is named. The chip order, the
 * upstream-category-key → chip map, the chip labels and the official message ids are all derived
 * from it. The section builder, the chip row, the ranking and the logo loader all read that
 * registry — there is no second copy of a chip name, label or mapping anywhere in this file.
 *
 * ## Every string here is official 0.78.1's own
 *
 * The injected source runs in the chunk's module scope, so it can use the chunk's own `t` (jsx),
 * `C` (react), `k` (stylix), `me` (typography), `ue` (icon), `Ws` (the plugin grid), `et` (the
 * per-entry installed check) and `RLocT(en, zh)` (the locale runtime). Every user-visible string
 * goes through `RLocT`, so the language preference still switches it, and every Chinese string is
 * official 0.78.1's own text under its own message id.
 *
 * @evidence official 0.78.1 `chunk-marketplace-browse-model-9vlJFqic.js` — `b` (chip order), `x`
 *   (upstream-category-key map), `O`/`M` (an entry's chips), `P` (group by chip), `y` (ranking),
 *   `W` (logo urls), `F` (chip message ids), `I` (leading sub-category), `Zo` (native markers),
 *   `hm` (locale lowercase), `E` (key normalisation).
 * @evidence official 0.78.1 `index.eager-app-D1juOWZp.js` — `MAt` (the section component), `NAt`
 *   (the group action), `Pq` (the connected status), `hm` (the locale lowercase).
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the browse section component (`Qo`, with
 *   `pluginLimit`), the chip row (`Ga`), the connect button (`iSLIjg`/`JrFTcr`/`QHcLEN`/`5ZzgbQ`)
 *   and the recommended hero.
 * @evidence official 0.78.1 live (CDP 9333, 2026-10-30) — the thirteen sections, the six-row
 *   preview, the group-action threshold, the chip row's `aria-pressed`, the hero block, the
 *   Bot-templates button and the trailing connect action.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { normalizeJsxChildren } from "./marketplace-jsx-children.mjs";
import { readFileSync } from "node:fs";

/**
 * Official 0.78.1's GrokBotMark idle frame, captured verbatim from the running official app
 * (CDP 9333, 2026-10-31). Official renders the Bot-templates glyph as
 * `jsx(dT, {color:"black", isPaused:true, sizePx:18})` — its motion-SVG runtime generates the
 * blob at runtime, so the asar tree carries no path bytes. The frame is deterministic (measured
 * across six mounts and three close-reopen rounds: byte-identical d) and static in the button
 * surface (idle and paused before, during and after hover), so the captured bytes are the port.
 */
const BOT_MARK_FRAME = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/official-0781-bot-mark-frame.json", import.meta.url), "utf8"),
);

/**
 * Official 0.78.1's native-row icon frames, captured verbatim from the running official app
 * (CDP 9333, 2026-10-31). Official resolves a native row's icon from its NAME through its own
 * brand registry — `1password` renders the 1Password brand SVG on #303136, `email` renders the
 * envelope glyph on the magenta token — never the first-letter chip that upstream 0.18 falls
 * back to for an entry without `iconUrl`. The frames are the port's source of truth.
 */
const NATIVE_ICON_FRAME = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/official-0781-native-icons.json", import.meta.url), "utf8"),
);

/** The chunk this patch owns: upstream 0.18's plugins view. */
export const MARKETPLACE_BROWSE_CHROME_CHUNK = "view-B5Ug8wEm.js";

/**
 * Official 0.78.1's chip registry — the single source of truth for the taxonomy.
 *
 * Each entry carries the chip's official message id and official's own English/Chinese text, plus
 * the upstream category keys official maps onto that chip (`x` in the browse-model chunk).
 */
export const MARKETPLACE_0781_CHIP_REGISTRY = Object.freeze({
  credentials: Object.freeze({
    messageId: "P+nzjE",
    en: "Password Managers",
    zh: "密码管理器",
    upstreamKeys: Object.freeze(["LOGIN_AND_CREDENTIAL_MANAGEMENT"]),
  }),
  productivity: Object.freeze({
    messageId: "N42ane",
    en: "Productivity",
    zh: "效率",
    upstreamKeys: Object.freeze(["PRODUCTIVITY", "DOCUMENTS_AND_FILES"]),
  }),
  communication: Object.freeze({
    messageId: "hZotg6",
    en: "Communication",
    zh: "通信",
    upstreamKeys: Object.freeze(["INBOX_AND_COLLABORATION", "SCHEDULING"]),
  }),
  design: Object.freeze({
    messageId: "f8fH8W",
    en: "Design",
    zh: "设计",
    upstreamKeys: Object.freeze(["DESIGN", "CANVAS"]),
  }),
  code: Object.freeze({
    messageId: "EWPtMO",
    en: "Code",
    zh: "代码",
    upstreamKeys: Object.freeze(["INFRASTRUCTURE"]),
  }),
  data: Object.freeze({
    messageId: "HKH+W+",
    en: "Data",
    zh: "数据",
    upstreamKeys: Object.freeze(["DATA_ANALYTICS"]),
  }),
  sales: Object.freeze({
    messageId: "mUv9U4",
    en: "Sales",
    zh: "销售",
    upstreamKeys: Object.freeze(["SALES"]),
  }),
  marketing: Object.freeze({
    messageId: "vo2a+a",
    en: "Marketing",
    zh: "营销",
    upstreamKeys: Object.freeze(["MARKETING"]),
  }),
  finance: Object.freeze({
    messageId: "8V6XO3",
    en: "Finance",
    zh: "财务",
    upstreamKeys: Object.freeze(["PAYMENTS", "FINANCE_AND_LEGAL"]),
  }),
  research: Object.freeze({
    messageId: "bdztP2",
    en: "Research",
    zh: "研究",
    upstreamKeys: Object.freeze(["RESEARCH"]),
  }),
  support: Object.freeze({
    messageId: "XYLcNv",
    en: "Support",
    zh: "支持",
    upstreamKeys: Object.freeze(["CUSTOMER_SUPPORT"]),
  }),
});

/** Official 0.78.1's canonical chip order (`b` in the browse-model chunk). */
export const MARKETPLACE_0781_CHIP_ORDER = Object.freeze([
  "credentials",
  "productivity",
  "communication",
  "design",
  "code",
  "data",
  "sales",
  "marketing",
  "finance",
  "research",
  "support",
]);

/** The upstream-category-key → chip map, derived from the registry — never written twice. */
export const MARKETPLACE_0781_CHIP_BY_UPSTREAM_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(MARKETPLACE_0781_CHIP_REGISTRY).flatMap(([chip, entry]) =>
      entry.upstreamKeys.map((key) => [key, chip]),
    ),
  ),
);

/**
 * Official 0.78.1's plugin-name → chips map (`C` in the browse-model chunk).
 *
 * Official resolves an entry's chips from its plugin name FIRST (`O`) and only falls back to the
 * upstream category keys (`M`); the two never merge. The map's values are chip keys, so they come
 * from the registry's key space.
 */
export const MARKETPLACE_0781_CONNECTOR_CHIPS = Object.freeze({
  slack: Object.freeze(["communication"]),
  notion: Object.freeze(["productivity"]),
  "notion-workspace": Object.freeze(["productivity"]),
  linear: Object.freeze(["productivity"]),
  figma: Object.freeze(["design"]),
  tldraw: Object.freeze(["design"]),
  github: Object.freeze(["code"]),
  "github-plugin": Object.freeze(["code"]),
  runlayer: Object.freeze(["code"]),
  langfuse: Object.freeze(["data"]),
  parallel: Object.freeze(["research", "data"]),
  superpowers: Object.freeze(["code"]),
  "compound-engineering": Object.freeze(["code"]),
  "create-plugin": Object.freeze(["code"]),
  "context7-plugin": Object.freeze(["research"]),
  context7: Object.freeze(["research"]),
});

/** Official 0.78.1's leading sub-category per chip (`I` in the browse-model chunk). */
export const MARKETPLACE_0781_CHIP_LEADING = Object.freeze({
  communication: Object.freeze(["email"]),
});

/** Official 0.78.1's native markers (`Zo` in the browse-model chunk) — the `native` values it knows. */
export const MARKETPLACE_0781_NATIVE_MARKERS = Object.freeze(["onepassword", "email"]);

/** Official 0.78.1's section preview size, measured live (six rows per section). */
export const MARKETPLACE_0781_SECTION_LIMIT = 6;

/**
 * Official 0.78.1's recommended-section size (`pluginLimit: 24` in its browse section component).
 *
 * The hero block the 为你推荐 group action appends shows exactly these rows.
 */
export const MARKETPLACE_0781_RECOMMENDED_LIMIT = 24;

/** How many chips the chip row lays out flat before the rest move into the 更多 dropdown. */
export const MARKETPLACE_0781_CHIP_FLAT_LIMIT = 5;

/**
 * Official 0.78.1's message ids used by this patch, with the official text each one carries.
 *
 * The regression test asserts every Chinese string the patch injects against the captured official
 * locale fixture (`tests/fixtures/official-0781-marketplace-wording.json`), so a typo or an
 * invented translation fails the build.
 */
export const MARKETPLACE_0781_MESSAGES = Object.freeze({
  recommended: Object.freeze({ id: "dlD2mM", en: "Recommended for you", zh: "为你推荐" }),
  viewAll: Object.freeze({ id: "N6Pxr9", en: "View all", zh: "查看全部" }),
  botTemplates: Object.freeze({ id: "bpVWP/", en: "Bot templates", zh: "Bot 模板" }),
  connect: Object.freeze({ id: "iSLIjg", en: "Connect", zh: "连接" }),
  connecting: Object.freeze({ id: "JrFTcr", en: "Connecting…", zh: "正在连接…" }),
  connected: Object.freeze({ id: "QHcLEN", en: "Connected", zh: "已连接" }),
  connectNamed: Object.freeze({ id: "5ZzgbQ", en: "Connect ", zh: "连接 " }),
  all: Object.freeze({ id: "N40H+G", en: "All", zh: "全部" }),
  more: Object.freeze({ id: "2FYpfJ", en: "More", zh: "更多" }),
  chipRowAria: Object.freeze({ id: "jj4zKl", en: "Plugin categories", zh: "插件分类" }),
  moreAria: Object.freeze({ id: "8zPg/f", en: "More categories", zh: "更多类别" }),
});

const REPLACEMENTS = [
  {
    label: "chip selection state",
    before: '[p,x]=C.useState("marketplace"),[m,I]=C.useState(""),[v,P]=C.useState(qn),[j,S]=C.useState(qn),',
    after:
      '[p,x]=C.useState("marketplace"),[m,I]=C.useState(""),[v,P]=C.useState(qn),[j,S]=C.useState(qn),' +
      "[RM0781Chip,RM0781SetChip]=C.useState(null),[RM0781Hero,RM0781SetHero]=C.useState(false),",
  },
  {
    label: "segmented control removed from the toolbar (official's connected-apps entry moves to the header)",
    before:
      't.jsxs(Os,{"aria-label":"Plugins view",onValueChange:u=>x(u==="yours"?"yours":"marketplace"),size:"lg",value:p,variant:"compact",' +
      'children:[t.jsx(Os.Item,{value:"marketplace",children:(RLocT("Marketplace","市场"))}),' +
      't.jsx(Os.Item,{value:"yours",children:RLocT(St.length+" connected","已连接 "+St.length+" 个")})]})',
    after: "null",
  },
  {
    label: "official's connected-apps entry sits in the dialog header",
    before: 't.jsx(sl,{headingId:a,title:(RLocT("Plugins","连接应用"))})',
    after:
      't.jsxs("div",{className:"sand-plugins-0781-header",children:[' +
      't.jsx(sl,{headingId:a,title:(RLocT("Plugins","连接应用"))}),' +
      't.jsx(RM0781InstalledEntry,{count:St.length,logos:RM0781InstalledLogos(St),onOpen:()=>x("yours")})' +
      "]})",
  },
  {
    label: "browse toolbar: official's chip row",
    before: 'spellCheck:!1,type:"text",value:m})]})]})]})',
    after:
      'spellCheck:!1,type:"text",value:m})]})]})' +
      ',t.jsx("div",{className:"sand-plugins-0781-chips",children:' +
      "t.jsx(RM0781Chips,{categories:RM0781ChipRow(wt),selectedKey:RM0781Chip,onSelect:u=>RM0781SetChip(u)})" +
      "})" +
      "]})",
  },
  {
    // Upstream 0.18 renders the whole toolbar (title, search, and now the chip row) inside a
    // React-compiler memo whose dependency list does NOT include the marketplace items. The chip
    // row reads those items, so without this dependency the memo keeps the tree it built on the
    // first render — when the catalogue is still empty — and the chip row stays empty forever,
    // while the page below it (rendered outside the memo) shows every chip section. Measured on
    // the deployed build: 11 sections, zero chips.
    //
    // The same memo also does not depend on the SELECTED chip, so the chip row's own selected
    // state freezes on the first render: the list below switches to the chosen chip, but the chip
    // row keeps aria-pressed on 全部 and the chip's own class. Measured on the deployed build:
    // clicking 效率 switched the sections to 效率 while aria-pressed stayed 全部=true, 效率=false.
    // Official 0.78.1 moves the pressed state with the selection (全部 1 -> 0, 效率 0 -> 1).
    label: "browse toolbar: the toolbar re-renders when the marketplace items or the selected chip change",
    before:
      "e[57]!==Ts||e[58]!==w||e[59]!==G||e[60]!==a||e[61]!==W||e[62]!==m||e[63]!==Me||e[64]!==g||e[65]!==p?",
    after:
      "e[57]!==Ts||e[58]!==w||e[59]!==G||e[60]!==a||e[61]!==W||e[62]!==m||e[63]!==Me||e[64]!==g||e[65]!==p||e[902]!==wt||e[903]!==RM0781Chip?",
  },
  {
    label: "browse toolbar: the toolbar memo stores the marketplace items and the selected chip",
    before: "e[57]=Ts,e[58]=w,e[59]=G,e[60]=a,e[61]=W,e[62]=m,e[63]=Me,e[64]=g,e[65]=p,e[66]=$e",
    after:
      "e[57]=Ts,e[58]=w,e[59]=G,e[60]=a,e[61]=W,e[62]=m,e[63]=Me,e[64]=g,e[65]=p,e[902]=wt,e[903]=RM0781Chip,e[66]=$e",
  },
  {
    label: "browse toolbar: official's Bot-templates button",
    before: 'ref:B,spellCheck:!1,type:"text",value:m})]})]})',
    after:
      'ref:B,spellCheck:!1,type:"text",value:m})]})' +
      ",t.jsx(RM0781BotTemplatesButton,{})" +
      "]})",
  },
  {
    label: "search field aria-label",
    before: '"aria-label":(RLocT("Search plugins","搜索插件"))',
    after: '"aria-label":(RLocT("Search across apps and skills","在应用和技能中搜索"))',
  },
  {
    label: "search field placeholder",
    before: 'placeholder:(RLocT("Search plugins","搜索插件"))',
    after: 'placeholder:(RLocT("Search across apps and skills","在应用和技能中搜索"))',
  },
  {
    label: "browse page receives the selected chip and the recommended hero",
    before:
      "t.jsx(ci,{effectivePluginsById:Ye,installedByKey:sn,isBusy:Be,isFilterActive:!Xs(v),isLoading:ye,items:wt," +
      "onAdd:u=>{tn(u)},onOpenPlugin:on,pendingAddKey:O,query:m,servers:Ie})",
    after:
      "t.jsx(ci,{effectivePluginsById:Ye,installedByKey:sn,isBusy:Be,isFilterActive:!Xs(v),isLoading:ye,items:wt," +
      "onAdd:u=>{tn(u)},onOpenPlugin:on,pendingAddKey:O,query:m,servers:Ie,selectedChip:RM0781Chip," +
      "onSelectChip:u=>RM0781SetChip(u),recommendedHero:RM0781Hero,onShowRecommended:()=>RM0781SetHero(true)})",
  },
  {
    label: "browse page reads the selected chip and the recommended hero",
    before:
      "{items:s,query:a,isLoading:l,isBusy:i,isFilterActive:d,servers:r,installedByKey:o,effectivePluginsById:c," +
      "pendingAddKey:f,onAdd:h,onOpenPlugin:y}=n",
    after:
      "{items:s,query:a,isLoading:l,isBusy:i,isFilterActive:d,servers:r,installedByKey:o,effectivePluginsById:c," +
      "pendingAddKey:f,onAdd:h,onOpenPlugin:y,selectedChip:RM0781SelectedChip,onSelectChip:RM0781SelectChip," +
      "recommendedHero:RM0781RecommendedHero,onShowRecommended:RM0781ShowRecommendedHero}=n," +
      "RM0781TeamCounts=za()",
  },
  {
    label: "browse sections are official's chip sections",
    before: 'const w=m?[{sectionKey:"results",category:RLocT("Results","结果"),items:s}]:ql(s);',
    after:
      'const w=m?[{sectionKey:"results",category:RLocT("Results","结果"),items:s}]:' +
      "RM0781BuildSections(s,{selectedChip:RM0781SelectedChip,recommendedHero:RM0781RecommendedHero," +
      "onShowRecommended:RM0781ShowRecommendedHero,isInstalled:e=>et(e,r,o,c).isInstalled,locale:RM0781Locale()," +
      "teamInstallCounts:RM0781TeamCounts});",
  },
  {
    label: "browse section list depends on the selected chip and the recommended hero",
    before: "if(e[18]!==m||e[19]!==s||e[20]!==v){",
    after:
      "if(e[18]!==m||e[19]!==s||e[20]!==v||e[900]!==RM0781SelectedChip||e[901]!==RM0781RecommendedHero){",
  },
  {
    label: "browse section list remembers the selected chip and the recommended hero",
    before: "e[18]=m,e[19]=s,e[20]=v,e[21]=P,e[22]=j}else P=e[21],j=e[22];",
    after:
      "e[18]=m,e[19]=s,e[20]=v,e[21]=P,e[22]=j,e[900]=RM0781SelectedChip,e[901]=RM0781RecommendedHero" +
      "}else P=e[21],j=e[22];",
  },
  {
    label: "section renderer",
    before: "g=A=>t.jsx(ri,{isCollapsible:!m,items:A.items,renderRow:v,title:A.category},A.sectionKey)",
    after:
      "g=A=>A.sectionKey===\"recommended-hero\"" +
      "?t.jsx(RM0781RecommendedHero,{items:A.items,renderRow:v},A.sectionKey)" +
      ":A.label===undefined" +
      "?t.jsx(ri,{isCollapsible:!m,items:A.items,renderRow:v,title:A.category},A.sectionKey)" +
      ":t.jsx(RM0781Section,{chipKey:A.chipKey,hiddenCount:A.hiddenCount,items:A.items,label:A.label," +
      "onSelectChip:RM0781SelectChip,onShowRecommended:RM0781ShowRecommendedHero,renderRow:v," +
      "sectionKey:A.sectionKey},A.sectionKey)",
  },
  {
    label: "row trailing: official's connect button and connected status",
    before:
      "b=A?t.jsx(di,{}):f===Vs(w.id)?t.jsx(dt,{label:`Adding ${w.displayName}`}):" +
      't.jsx(ve,{disabled:i,onClick:()=>h(w),size:"sm",type:"button",variant:"secondary",children:(RLocT("Add","添加"))})',
    after:
      "b=A?t.jsx(RM0781ConnectedStatus,{}):f===Vs(w.id)" +
      "?t.jsx(dt,{label:RLocT(\"Connecting…\",\"正在连接…\")}):" +
      "t.jsx(RM0781ConnectButton,{disabled:i,name:w.displayName,onClick:()=>h(w)})",
  },
  {
    label: "row icon: official's native brand icons, not the first-letter fallback",
    before: "t.jsx(m,{iconId:w.iconId,iconUrl:w.iconUrl,name:s.displayName,size:56})",
    after:
      "RM0781NativeIcon(s)??t.jsx(m,{iconId:w.iconId,iconUrl:w.iconUrl,name:s.displayName,size:56})",
  },
];

/**
 * The injected source.
 *
 * It lives in the chunk's module scope, so it can use the chunk's own `t` (jsx runtime), `C`
 * (react), `k` (stylix), `me` (typography), `ue` (icon), `Ws` (the plugin grid), `et` (the
 * per-entry installed check) and `RLocT(en, zh)` (the locale runtime the i18n passes append).
 *
 * The class recipes are official 0.78.1's own. Two classes are deliberately swapped for upstream
 * 0.18's equivalent: official's `sand-ymw2ht` and upstream's `sand-149ho13` are both
 * `border-radius:9999px`, and official's `sand-1x4j3cz` and upstream's `sand-1qmwy7c` are both
 * `border-radius:8px` (a stylix class name is the hash of its declaration block), so those use the
 * names upstream already ships and no extra rule is needed. The port record notes both.
 */
const INJECTED_SOURCE = normalizeJsxChildren([
  "const RM0781ChipRegistry={\"credentials\":{\"messageId\":\"P+nzjE\",\"en\":\"Password Managers\",\"zh\":\"密码管理器\",\"upstreamKeys\":[\"LOGIN_AND_CREDENTIAL_MANAGEMENT\"]},\"productivity\":{\"messageId\":\"N42ane\",\"en\":\"Productivity\",\"zh\":\"效率\",\"upstreamKeys\":[\"PRODUCTIVITY\",\"DOCUMENTS_AND_FILES\"]},\"communication\":{\"messageId\":\"hZotg6\",\"en\":\"Communication\",\"zh\":\"通信\",\"upstreamKeys\":[\"INBOX_AND_COLLABORATION\",\"SCHEDULING\"]},\"design\":{\"messageId\":\"f8fH8W\",\"en\":\"Design\",\"zh\":\"设计\",\"upstreamKeys\":[\"DESIGN\",\"CANVAS\"]},\"code\":{\"messageId\":\"EWPtMO\",\"en\":\"Code\",\"zh\":\"代码\",\"upstreamKeys\":[\"INFRASTRUCTURE\"]},\"data\":{\"messageId\":\"HKH+W+\",\"en\":\"Data\",\"zh\":\"数据\",\"upstreamKeys\":[\"DATA_ANALYTICS\"]},\"sales\":{\"messageId\":\"mUv9U4\",\"en\":\"Sales\",\"zh\":\"销售\",\"upstreamKeys\":[\"SALES\"]},\"marketing\":{\"messageId\":\"vo2a+a\",\"en\":\"Marketing\",\"zh\":\"营销\",\"upstreamKeys\":[\"MARKETING\"]},\"finance\":{\"messageId\":\"8V6XO3\",\"en\":\"Finance\",\"zh\":\"财务\",\"upstreamKeys\":[\"PAYMENTS\",\"FINANCE_AND_LEGAL\"]},\"research\":{\"messageId\":\"bdztP2\",\"en\":\"Research\",\"zh\":\"研究\",\"upstreamKeys\":[\"RESEARCH\"]},\"support\":{\"messageId\":\"XYLcNv\",\"en\":\"Support\",\"zh\":\"支持\",\"upstreamKeys\":[\"CUSTOMER_SUPPORT\"]}};",
  "const RM0781ChipOrder=[\"credentials\",\"productivity\",\"communication\",\"design\",\"code\",\"data\",\"sales\",\"marketing\",\"finance\",\"research\",\"support\"];",
  "const RM0781ChipByUpstreamKey={\"LOGIN_AND_CREDENTIAL_MANAGEMENT\":\"credentials\",\"PRODUCTIVITY\":\"productivity\",\"DOCUMENTS_AND_FILES\":\"productivity\",\"INBOX_AND_COLLABORATION\":\"communication\",\"SCHEDULING\":\"communication\",\"DESIGN\":\"design\",\"CANVAS\":\"design\",\"INFRASTRUCTURE\":\"code\",\"DATA_ANALYTICS\":\"data\",\"SALES\":\"sales\",\"MARKETING\":\"marketing\",\"PAYMENTS\":\"finance\",\"FINANCE_AND_LEGAL\":\"finance\",\"RESEARCH\":\"research\",\"CUSTOMER_SUPPORT\":\"support\"};",
  "const RM0781ConnectorChips={\"slack\":[\"communication\"],\"notion\":[\"productivity\"],\"notion-workspace\":[\"productivity\"],\"linear\":[\"productivity\"],\"figma\":[\"design\"],\"tldraw\":[\"design\"],\"github\":[\"code\"],\"github-plugin\":[\"code\"],\"runlayer\":[\"code\"],\"langfuse\":[\"data\"],\"parallel\":[\"research\",\"data\"],\"superpowers\":[\"code\"],\"compound-engineering\":[\"code\"],\"create-plugin\":[\"code\"],\"context7-plugin\":[\"research\"],\"context7\":[\"research\"]};",
  "const RM0781ChipLeading={\"communication\":[\"email\"]};",
  "const RM0781NativeMarkers=[\"onepassword\",\"email\"];",
  "const RM0781SectionLimit=6;",
  "const RM0781RecommendedLimit=24;",
  "const RM0781ChipFlatLimit=5;",
  "function RM0781NormalizeKey(e){return String(e).trim().toUpperCase().replace(/&/gu,\" AND \").replace(/[^A-Z0-9]+/gu,\"_\").replace(/^_+|_+$/gu,\"\")}",
  "function RM0781Lower(e){return String(e).toLowerCase()}",
  "function RM0781LocaleLower(e,t){const n=String(e).toLocaleLowerCase(t||\"en\").replaceAll(\"ς\",\"σ\");return t===\"tr\"?n.replaceAll(\"ı\",\"i\"):n}",
  "function RM0781Locale(){return typeof RLocBoot===\"function\"?RLocBoot():\"en\"}",
  "function RM0781ConnectorChipsOf(entry){",
  "  if(entry==null)return undefined;",
  "  for(const name of [entry.pluginName,entry.name]){",
  "    if(name==null)continue;",
  "    const chips=RM0781ConnectorChips[RM0781Lower(String(name).trim())];",
  "    if(chips!==undefined)return chips;",
  "  }",
  "  return undefined;",
  "}",
  "function RM0781ChipsOf(entry){",
  "  if(entry==null)return [];",
  "  const connector=RM0781ConnectorChipsOf(entry);",
  "  if(connector!==undefined)return connector;",
  "  const keys=entry.categoryKeys??(entry.categoryKey===undefined?[entry.category]:[entry.categoryKey]);",
  "  const out=[],seen=new Set();",
  "  for(const key of keys){",
  "    if(key==null)continue;",
  "    const chip=RM0781ChipByUpstreamKey[RM0781NormalizeKey(key)];",
  "    if(chip===undefined||seen.has(chip))continue;",
  "    seen.add(chip);out.push(chip);",
  "  }",
  "  return out;",
  "}",
  "function RM0781NativeMarker(entry){",
  "  if(entry==null)return null;",
  "  // The browse page hands the rows raw catalogue views, but the marketplace dialog wraps each",
  "  // view as {entry: view, name, ...}. Official's own resolution is name-driven either way:",
  "  // mo(n) probes [pluginName, name] and DD maps 1password/email to the brand specs, so the",
  "  // port accepts the marker from either shape and falls back to the same name probe.",
  "  const raw=entry.entry??entry;",
  "  const native=raw.native??entry.native;",
  "  if(native!=null)return RM0781NativeMarkers.indexOf(native)>=0?native:null;",
  "  for(const name of [raw.pluginName,raw.name,raw.displayName,entry.pluginName,entry.name,entry.displayName]){",
  "    if(name==null)continue;",
  "    const key=RM0781Lower(String(name).trim());",
  "    if(key===\"onepassword\"||key===\"1password\")return \"onepassword\";",
  "    if(key===\"email\")return \"email\";",
  "  }",
  "  return null;",
  "}",
  "const RM0781NativeIconClasses=" + JSON.stringify(NATIVE_ICON_FRAME.onepassword.spanClass) + ";",
  "const RM0781OnePasswordPathD=" + JSON.stringify(NATIVE_ICON_FRAME.onepassword.pathD) + ";",
  "function RM0781NativeIcon(entry){",
  "  const marker=RM0781NativeMarker(entry);",
  "  if(marker==null)return null;",
  "  if(marker===\"onepassword\"){",
  "    return t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781NativeIconClasses,style:{width:40,height:40,borderRadius:11,backgroundColor:\"#303136\",color:\"rgb(255, 255, 255)\"}},",
  "      t.jsx(\"svg\",{fill:\"#ffffff\",height:22,role:\"img\",viewBox:\"0 0 24 24\",width:22},",
  "        t.jsx(\"path\",{d:RM0781OnePasswordPathD})));",
  "  }",
  "  return t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781NativeIconClasses,style:{width:40,height:40,borderRadius:11,backgroundColor:\"var(--sand-bg-magenta-primary)\",color:\"rgb(255, 255, 255)\"}},",
  "    t.jsx(ue,{name:\"envelope\",size:22}));",
  "}",
  "function RM0781ApplyLeading(items,leading){",
  "  if(leading.length===0)return items.slice();",
  "  const rank=entry=>{const marker=RM0781NativeMarker(entry);return marker===null?-1:leading.indexOf(marker)};",
  "  return items.filter(e=>rank(e)>=0).sort((a,b)=>rank(a)-rank(b)).concat(items.filter(e=>rank(e)<0));",
  "}",
  "function RM0781GroupByChip(catalog){",
  "  const plugins=new Map();",
  "  for(const entry of catalog){",
  "    if(entry.marketplace!==undefined)continue;",
  "    for(const chip of RM0781ChipsOf(entry)){",
  "      const list=plugins.get(chip)??[];",
  "      list.push(entry);plugins.set(chip,list);",
  "    }",
  "  }",
  "  return RM0781ChipOrder.filter(chip=>plugins.has(chip)).map(chip=>({",
  "    id:chip,",
  "    filterKey:\"marketplace:category:\"+chip,",
  "    plugins:plugins.get(chip)??[],",
  "  }));",
  "}",
  "function RM0781PopularityRank(a,b){",
  "  if(a==null||a.popularityRank==null)return b==null||b.popularityRank==null?0:1;",
  "  if(b==null||b.popularityRank==null)return -1;",
  "  return a.popularityRank-b.popularityRank;",
  "}",
  "function RM0781AffinityCounts(catalog,isInstalled,locale){",
  "  const counts=new Map();",
  "  for(const entry of catalog){",
  "    if(!isInstalled(entry))continue;",
  "    const bucket=RM0781LocaleLower(String(entry.category??\"\").trim(),locale);",
  "    if(bucket.length!==0)counts.set(bucket,(counts.get(bucket)??0)+1);",
  "  }",
  "  return counts;",
  "}",
  "function RM0781RankRecommendations(catalog,isInstalled,teamInstallCounts,limit,locale){",
  "  const collator=new Intl.Collator(locale||\"en\");",
  "  const tie=(a,b)=>RM0781PopularityRank(a.entry,b.entry)||collator.compare(a.entry.displayName,b.entry.displayName);",
  "  const affinity=RM0781AffinityCounts(catalog,isInstalled,locale);",
  "  const scored=catalog.filter(e=>!isInstalled(e)).map(entry=>{",
  "    const bucket=RM0781LocaleLower(String(entry.category??\"\").trim(),locale);",
  "    return{entry,teammateCount:teamInstallCounts[entry.id]??0,affinityStrength:bucket.length===0?0:(affinity.get(bucket)??0)};",
  "  });",
  "  const team=scored.filter(s=>s.teammateCount>0).sort((a,b)=>b.teammateCount-a.teammateCount||tie(a,b));",
  "  const affinityRanked=scored.filter(s=>s.affinityStrength>0).sort((a,b)=>",
  "    b.affinityStrength-a.affinityStrength||b.teammateCount-a.teammateCount||tie(a,b));",
  "  const seen=new Set(),out=[];",
  "  const push=(s,signal)=>{if(seen.has(s.entry.id)||out.length===limit)return;seen.add(s.entry.id);out.push({entry:s.entry,signal})};",
  "  const teamQuota=Math.max(1,Math.floor(limit*0.5));",
  "  for(const s of team.slice(0,teamQuota))push(s,{kind:\"team\",teammateCount:s.teammateCount});",
  "  for(const s of affinityRanked)push(s,{kind:\"affinity\"});",
  "  for(const s of team)push(s,{kind:\"team\",teammateCount:s.teammateCount});",
  "  if(out.length===0){",
  "    for(const s of scored.slice().sort((a,b)=>tie(a,b)))push(s,{kind:\"fallback\"});",
  "  }",
  "  return out.sort((a,b)=>(a.signal.kind===\"team\"?0:a.signal.kind===\"affinity\"?1:2)-(b.signal.kind===\"team\"?0:b.signal.kind===\"affinity\"?1:2));",
  "}",
  "function RM0781MakeSection(sectionKey,chipKey,label,items,hiddenCount){",
  "  return{sectionKey,chipKey,label,items,hiddenCount};",
  "}",
  "function RM0781BuildSections(entries,options){",
  "  const selected=options.selectedChip??null;",
  "  const isInstalled=options.isInstalled??(()=>false);",
  "  const teamInstallCounts=options.teamInstallCounts??{};",
  "  const locale=options.locale??RM0781Locale();",
  "  const recommended=RM0781RankRecommendations(entries,isInstalled,teamInstallCounts,RM0781RecommendedLimit,locale)",
  "    .map(r=>r.entry);",
  "  const buckets=RM0781GroupByChip(entries);",
  "  if(selected!==null){",
  "    const bucket=buckets.find(b=>b.id===selected);",
  "    if(bucket===undefined)return [];",
  "    const chip=RM0781ChipRegistry[bucket.id];",
  "    const items=RM0781ApplyLeading(bucket.plugins,RM0781ChipLeading[bucket.id]??[]);",
  "    return[RM0781MakeSection(\"chip:\"+bucket.id,bucket.id,[chip.en,chip.zh],items,0)];",
  "  }",
  "  const sections=[];",
  "  sections.push(RM0781MakeSection(\"recommended\",null,[\"Recommended for you\",\"为你推荐\"],recommended,",
  "    recommended.length>RM0781SectionLimit?recommended.length-RM0781SectionLimit:0));",
  "  for(const bucket of buckets){",
  "    const chip=RM0781ChipRegistry[bucket.id];",
  "    const items=RM0781ApplyLeading(bucket.plugins,RM0781ChipLeading[bucket.id]??[]);",
  "    sections.push(RM0781MakeSection(\"chip:\"+bucket.id,bucket.id,[chip.en,chip.zh],items,",
  "      items.length>RM0781SectionLimit?items.length-RM0781SectionLimit:0));",
  "  }",
  "  const teamEntries=entries.filter(e=>e.marketplace!=null).sort((a,b)=>",
  "    (teamInstallCounts[b.id]??0)-(teamInstallCounts[a.id]??0)||String(a.displayName==null?\"\":a.displayName).localeCompare(String(b.displayName==null?\"\":b.displayName),locale));",
  "  if(teamEntries.length>0){",
  "    sections.push(RM0781MakeSection(\"team-plugins\",\"team\",[\"Team plugins\",\"团队插件\"],teamEntries,0));",
  "  }",
  "  if(options.recommendedHero===true){",
  "    sections.push(RM0781MakeSection(\"recommended-hero\",null,[\"Recommended for you\",\"为你推荐\"],recommended,0));",
  "  }",
  "  return sections;",
  "}",
  "const RM0781GroupActionClasses=\"sand-plugins__group-action sand-jyslct sand-1lugfcp sand-9f619 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-pffxup sand-1nn3v0j sand-10hui8a sand-1120s5i sand-19nlotp sand-c342km sand-ng3xce sand-ymw2ht sand-jbqb8w sand-11hyl0l sand-1o0liin sand-n4ifyr sand-jb2p0i sand-1wm8ruf sand-1d3mw78 sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1wpm9rq\";",
  "const RM0781SectionClasses=\"sand-plugins__group sand-9f619 sand-78zum5 sand-dt5ytf sand-167g77z sand-euugli\";",
  "const RM0781SectionHeaderClasses=\"sand-9f619 sand-78zum5 sand-1pha0wt sand-1qughib sand-167g77z sand-euugli\";",
  "const RM0781SectionTitleClasses=\"sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-1ghz6dp sand-1y1aw1k sand-f159sx sand-10b6aqq sand-1g0dm76 sand-tyxrsu sand-1rhlpx6\";",
  "function RM0781GroupAction(props){",
  "  const{label,onAction}=props;",
  "  return t.jsx(\"button\",{className:RM0781GroupActionClasses,onClick:onAction,type:\"button\"},label);",
  "}",
  "function RM0781Section(props){",
  "  const{chipKey,hiddenCount,items,label,onSelectChip,onShowRecommended,renderRow,sectionKey}=props;",
  "  const titleId=C.useId();",
  "  const visible=hiddenCount>0?items.slice(0,RM0781SectionLimit):items;",
  "  const action=hiddenCount>0?t.jsx(RM0781GroupAction,{label:RLocT(\"View all\",\"查看全部\"),onAction:()=>{",
  "    if(chipKey!=null){onSelectChip(chipKey);return}",
  "    onShowRecommended();",
  "  }}):null;",
  "  const header=t.jsxs(\"div\",{className:RM0781SectionHeaderClasses,children:[",
  "    t.jsx(\"h3\",{className:RM0781SectionTitleClasses,id:titleId,children:RLocT(label[0],label[1])}),",
  "    action,",
  "  ]});",
  "  const grid=t.jsx(Ws,{labelledBy:titleId,children:visible.map(renderRow)});",
  "  return t.jsxs(\"section\",{\"aria-labelledby\":titleId,className:RM0781SectionClasses,children:[header,grid]});",
  "}",
  "const RM0781HeroClasses=\"sand-9f619 sand-78zum5 sand-dt5ytf sand-167g77z sand-euugli\";",
  "const RM0781HeroHeaderClasses=\"sand-9f619 sand-78zum5 sand-1pha0wt sand-1qughib sand-167g77z sand-euugli\";",
  "const RM0781HeroTitleClasses=\"sand-1mmermx sand-vh7mc1 sand-1ehaq9d sand-1ghz6dp sand-f159sx sand-1g0dm76 sand-tyxrsu sand-1rhlpx6 sand-iorvi4 sand-sag5q8\";",
  "function RM0781RecommendedHero(props){",
  "  const{items,renderRow}=props;",
  "  const titleId=C.useId();",
  "  return t.jsxs(\"section\",{className:RM0781HeroClasses,children:[",
  "    t.jsxs(\"div\",{className:RM0781HeroHeaderClasses,children:[",
  "      t.jsx(\"h1\",{\"data-detail-hero-title\":\"\",className:RM0781HeroTitleClasses,id:titleId,children:RLocT(\"Recommended for you\",\"为你推荐\")}),",
  "    ]}),",
  "    t.jsx(Ws,{labelledBy:titleId,children:items.map(renderRow)}),",
  "  ]});",
  "}",
  "const RM0781ChipBody2=\"sand-11wthnw sand-w8bs97 sand-14gdtuo\";",
  "const RM0781ChipBase=\"sand-jyslct sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-195vfkc sand-2lah0s sand-1fgtraw sand-1awh872 sand-c342km sand-ng3xce sand-149ho13 sand-fwqdrz sand-1n4gmbt sand-tyxrsu sand-jb2p0i sand-uxw1ft sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1wpm9rq\";",
  "const RM0781ChipGroup=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli sand-1x57ub9 sand-dqyycr sand-b3r6kr\";",
  "const RM0781ChipIconClasses=\"sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1kky2od sand-lup9mm sand-169k319\";",
  "function RM0781ChipClass(selected){",
  "  if(!selected)return RM0781ChipBody2+\" \"+RM0781ChipBase;",
  "  return RM0781ChipBody2+\" \"+RM0781ChipBase.replace(\"sand-fwqdrz sand-1n4gmbt\",\"sand-8rotk8 sand-n4jrjs\").replace(\"sand-tyxrsu\",\"sand-sa7k8x\");",
  "}",
  "function RM0781ChipRow(catalog){",
  "  const present=new Set();",
  "  for(const entry of catalog)for(const chip of RM0781ChipsOf(entry))present.add(chip);",
  "  return RM0781ChipOrder.filter(chip=>present.has(chip)).map(chip=>{",
  "    const entry=RM0781ChipRegistry[chip];",
  "    return{key:chip,label:[entry.en,entry.zh]};",
  "  });",
  "}",
  "function RM0781Chips(props){",
  "  const{categories,selectedKey,onSelect}=props;",
  "  if(categories.length===0)return null;",
  "  const visible=categories.slice(0,RM0781ChipFlatLimit),overflow=categories.slice(RM0781ChipFlatLimit);",
  "  const selectedOverflow=overflow.find(c=>c.key===selectedKey)??null;",
  "  const all=t.jsx(\"button\",{\"aria-pressed\":selectedKey==null,className:RM0781ChipClass(selectedKey==null),onClick:()=>onSelect(null),type:\"button\"},RLocT(\"All\",\"全部\"));",
  "  const chips=visible.map(c=>t.jsx(\"button\",{\"aria-pressed\":selectedKey===c.key,className:RM0781ChipClass(selectedKey===c.key),key:c.key,onClick:()=>onSelect(selectedKey===c.key?null:c.key),type:\"button\"},RLocT(c.label[0],c.label[1])));",
  "  const more=overflow.length===0?null:t.jsxs(re,{placement:\"bottom-start\",children:[",
  "    t.jsx(re.Trigger,{children:t.jsxs(\"button\",{\"aria-pressed\":selectedOverflow!=null,className:RM0781ChipClass(selectedOverflow!=null),type:\"button\"},[",
  "      selectedOverflow!=null?RLocT(selectedOverflow.label[0],selectedOverflow.label[1]):RLocT(\"More\",\"更多\"),",
  "      t.jsx(ue,{className:RM0781ChipIconClasses,name:\"chevron-down\",size:\"sm\"})])}),",
  "    t.jsx(re.Content,{\"aria-label\":RLocT(\"More categories\",\"更多类别\"),minWidth:200,size:\"md\",children:overflow.map(c=>",
  "      t.jsx(re.Item,{closeOnSelect:!1,onSelect:()=>onSelect(c.key),trailing:selectedKey===c.key?t.jsx(ue,{name:\"check\",size:\"sm\"}):null,children:RLocT(c.label[0],c.label[1])},c.key))})",
  "  ]});",
  "  return t.jsxs(\"div\",{\"aria-label\":RLocT(\"Plugin categories\",\"插件分类\"),\"data-marketplace-chips\":\"\",role:\"group\",className:RM0781ChipGroup,children:[all,chips,more]});",
  "}",
  "function RM0781InstalledLogos(rows){",
  "  const out=[];",
  "  for(const row of rows){",
  "    if(row==null||row.kind!==\"plugin\"||row.entry==null)continue;",
  "    const url=row.entry.iconUrl;",
  "    if(typeof url!==\"string\"||url.length===0)continue;",
  "    out.push({url});",
  "  }",
  "  return out.slice(0,4);",
  "}",
  "const RM0781EntryClasses=\"sand-plugins__installed-preview sand-9f619 sand-78zum5 sand-6s0dn4 sand-qcrz7y sand-167g77z sand-euugli sand-1iorvi4 sand-f159sx sand-jkvuk6 sand-135b78x sand-c342km sand-ng3xce sand-1qmwy7c sand-jbqb8w sand-11hyl0l sand-1o0liin sand-jb2p0i sand-1wm8ruf sand-1d3mw78 sand-12oo3zp sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1wpm9rq\";",
  "const RM0781StackClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9\";",
  "const RM0781SlotClasses=\"sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-w4jnvo sand-1qx5ct2 sand-mkeg23 sand-1y0btm7 sand-1lt80kd sand-t9pb60 sand-10e981r sand-b3r6kr\";",
  "const RM0781SlotRestClasses=\"sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-w4jnvo sand-1qx5ct2 sand-mkeg23 sand-1y0btm7 sand-1lt80kd sand-t9pb60 sand-10e981r sand-b3r6kr sand-w01apr\";",
  "const RM0781CountClasses=\"sand-9f619 sand-b3r6kr sand-lyipyv sand-uxw1ft\";",
  "const RM0781ImageClasses=\"sand-1lliihq sand-h8yej3 sand-5yr21d sand-l1xv1r\";",
  "function RM0781InstalledEntry(props){",
  "  const{count,logos,onOpen}=props;",
  "  const label=RLocT(count+\" connected\",\"已连接 \"+count+\" 个\");",
  "  const stack=logos.length===0?null:t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781StackClasses},logos.map((logo,index)=>",
  "    t.jsx(\"span\",{className:index>0?RM0781SlotRestClasses:RM0781SlotClasses,key:index},",
  "      t.jsx(\"img\",{alt:\"\",className:RM0781ImageClasses,src:logo.url})))) ;",
  "  return t.jsxs(\"button\",{\"aria-label\":RLocT(\"Your plugins\",\"你的插件\"),className:RM0781EntryClasses,onClick:onOpen,type:\"button\"},",
  "    [stack,t.jsx(\"span\",{className:RM0781CountClasses},label),t.jsx(ue,{name:\"chevron-right\",size:12})]);",
  "}",
  "const RM0781BotTemplatesClasses=\"sand-11wthnw sand-w8bs97 sand-14gdtuo sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1v39l1b sand-1y3gkto sand-jyslct sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-17d4w8g sand-2lah0s sand-10w6t97 sand-25sj25 sand-2vl965 sand-6dg3xy sand-1y0btm7 sand-5fd6op sand-ymw2ht sand-10e981r sand-1sygd3j sand-tyxrsu sand-jb2p0i sand-uxw1ft sand-1ypdohk\";",
  "const RM0781BotMarkClasses=\"sand-grok-bot-mark sand-1n2onr6 sand-3nfvp2 sand-2lah0s\";",
  "const RM0781BotMarkPathD=" + JSON.stringify(BOT_MARK_FRAME.pathD) + ";",
  "function RM0781BotMark(){",
  "  return t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781BotMarkClasses,\"data-grok-state\":\"idle\",\"data-paused\":\"true\",style:{width:18,height:18,\"--grok-bot-ink\":\"light-dark(#000000, #FFFFFF)\"}},",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",style:{display:\"inline-block\",position:\"relative\",flexShrink:0,width:18,height:18,lineHeight:0}},",
  "      t.jsx(\"span\",{style:{position:\"absolute\",left:\"50%\",top:\"50%\",width:\"153.333%\",height:\"153.333%\",transform:\"translate(-50%, -50%)\",pointerEvents:\"none\"}},",
  "        t.jsx(\"svg\",{height:\"100%\",id:\"motion-_r_im_\",viewBox:\"0 0 27.6 27.6\",width:\"100%\",xmlns:\"http://www.w3.org/2000/svg\"},",
  "          t.jsx(\"path\",{d:RM0781BotMarkPathD,fill:\"var(--grok-bot-ink)\",fillRule:\"evenodd\"})))));",
  "}",
  "function RM0781BotTemplatesButton(){",
  "  return t.jsxs(\"button\",{\"data-bot-templates-link\":\"\",className:RM0781BotTemplatesClasses,type:\"button\"},[",
  "    t.jsx(RM0781BotMark,{}),",
  "    RLocT(\"Bot templates\",\"Bot 模板\"),",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781KitIconClasses},t.jsx(ue,{name:\"arrow-right-up\",size:12})),",
  "  ]);",
  "}",
  "const RM0781KitIconClasses=\"sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1kky2od sand-lup9mm sand-169k319\";",
  "const RM0781ConnectStackClasses=\"sand-wz0xwf sand-6s0dn4 sand-1o2pa38\";",
  "const RM0781ConnectLabelClasses=\"sand-1agbcgv sand-crlgei sand-3nfvp2 sand-6s0dn4 sand-1jnr06f sand-uxw1ft\";",
  "const RM0781ConnectLabelHiddenClasses=\"sand-1agbcgv sand-crlgei sand-3nfvp2 sand-6s0dn4 sand-1jnr06f sand-uxw1ft sand-lshs6z\";",
  "function RM0781ConnectButton(props){",
  "  const{disabled,name,onClick}=props;",
  "  const label=t.jsx(\"span\",{className:RM0781ConnectLabelClasses,children:RLocT(\"Connect\",\"连接\")});",
  "  const adding=t.jsx(\"span\",{\"aria-hidden\":\"true\",\"data-copy-skip\":\"\",\"data-find-skip\":\"\",className:RM0781ConnectLabelHiddenClasses,children:RLocT(\"Connecting…\",\"正在连接…\")});",
  "  const added=t.jsx(\"span\",{\"aria-hidden\":\"true\",\"data-copy-skip\":\"\",\"data-find-skip\":\"\",className:RM0781ConnectLabelHiddenClasses,children:RLocT(\"Connected\",\"已连接\")});",
  "  const stack=t.jsx(\"span\",{className:RM0781ConnectStackClasses,style:{display:\"grid\"},children:[label,adding,added]});",
  "  return t.jsx(ve,{\"aria-label\":RLocT(\"Connect \"+name,\"连接 \"+name),disabled:disabled,onClick:onClick,size:\"sm\",type:\"button\",variant:\"secondary\",children:stack});",
  "}",
  "const RM0781ConnectedClasses=\"sand-plugins__added sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-1nejdyq sand-1nn3v0j sand-1120s5i sand-ymw2ht sand-169k319 sand-1wm8ruf sand-1d3mw78 sand-uxw1ft\";",
  "function RM0781ConnectedStatus(){",
  "  return t.jsxs(\"span\",{className:RM0781ConnectedClasses,children:[",
  "    t.jsx(ue,{className:\"sand-9f619 sand-1ufr4hg\",name:\"check\",size:12}),",
  "    RLocT(\"Connected\",\"已连接\")]});",
  "}",
].join("\n"));

/** The browse-page swaps, exported so the regression test can build a matching synthetic chunk. */
export const MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS = REPLACEMENTS;

/** The injected source, exported so the regression test can parse it on its own. */
export const MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE = INJECTED_SOURCE;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Original renderer marketplace browse chrome anchor is missing: ${label}`);
  if (source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer marketplace browse chrome anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/** Applies official 0.78.1's browse page to upstream 0.18's plugins chunk. */
export function patchMarketplaceBrowseChrome0781(source) {
  let patched = source;
  for (const { label, before, after } of REPLACEMENTS) {
    patched = replaceExactlyOnce(patched, before, after, label);
  }
  // The injected components are function DECLARATIONS and `const` bindings in the chunk's module
  // scope. The `const` bindings are read by the replacements above at *render* time (inside the
  // component body), which runs after the module body, so the temporal-dead-zone is not an issue.
  patched = `${patched}\n${INJECTED_SOURCE}\n`;
  return patched;
}

export async function applyMarketplaceBrowseChrome0781({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assets)) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(path.join(assets, name), "utf8");
    if (source.includes('k("sand-plugins__bar"')) candidates.push({ name, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Marketplace browse chrome patch: expected one plugins chunk, found ${candidates.length}.`);
  }
  const { name, source } = candidates[0];
  const patched = patchMarketplaceBrowseChrome0781(source);
  // Fail closed: the rewritten chunk must still parse as a module.
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  await writeFile(path.join(assets, name), patched);
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const provenance = {
    mode: "marketplace-browse-chrome-0781",
    referenceVersion: "0.78.1",
    file: `dist/renderer/assets/${name}`,
    originalSha256: sha256(source),
    patchedSha256: sha256(patched),
    anchors: REPLACEMENTS.map((entry) => ({
      label: entry.label,
      before: entry.before,
      after: entry.after,
    })),
    features: REPLACEMENTS.map((entry) => entry.label),
    officialMessageIds: Object.values(MARKETPLACE_0781_MESSAGES).map((message) => ({
      id: message.id,
      en: message.en,
      zh: message.zh,
    })),
    officialChipIds: Object.values(MARKETPLACE_0781_CHIP_REGISTRY).map((chip) => ({
      id: chip.messageId,
      en: chip.en,
      zh: chip.zh,
    })),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-browse-chrome-0781.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Marketplace browse chrome: official 0.78.1 chip sections + recommended section added (${name}).`);
  return provenance;
}
