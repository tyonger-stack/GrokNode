/**
 * Official Grok Bot 0.78.1's plugin DETAIL page, ported into upstream 0.18's plugins view.
 *
 * ## What official 0.78.1's detail page looks like (measured live on official 9333, 2026-10-31)
 *
 *   ┌ 56×56 brand tile ─────────────────────────────────┬────────────────────────────┐
 *   │                                                    │  [复制此插件的链接]  [分享] [连接] │
 *   │  X Money                                    (h3 + copy-link + share + connect) │
 *   │  Use your X Money Card, send money to users …                                  │
 *   ├────────────────────────────────────────────────────┴────────────────────────────┤
 *   │ 应用                                                    1                        │
 *   │ ┌ x-money                                                                    ┐ │
 *   │ └ 连接器                                                                      ┘ │
 *   │ 技能                                                    1                        │
 *   │ ┌ x-money-guide                                                              ┐ │
 *   │ └ Read this before the first X Money action …                                ┘ │
 *   │ 信息                                                                          │
 *   │ 功能     1 个应用, 1 项技能                                                    │
 *   │ 开发者   Cursor                                                               │
 *   │ 类别     MCP                                                                  │
 *   │ 网站     cursor.com                                                           │
 *   │ 可用性   公开                                                                 │
 *   └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Upstream 0.18 renders a different page for the same entry: a 40×40 first-letter tile, the
 * name, a "View Source" link, an "Add" button, and one collapsible "Connectors" card. It has no
 * copy-link, no share, no 应用 / 技能 sections and no 信息 table.
 *
 * ## What this patch ports
 *
 * 1. **The header** — official's class recipe (`sand-1xr8qbc sand-jodmca`), the
 *    `data-detail-hero-title` wrapper around the title, and the copy-link icon button.
 * 2. **The meta line** — official's marketplace name and teammate count, without upstream 0.18's
 *    "View Source" link (official 0.78.1's header has no such link).
 * 3. **The action group** — official's 分享 + 连接/卸载 pair with official's four button states
 *    (连接 / 正在连接… / 卸载 / 正在移除…), plus official's separate disabled "由你的团队管理" /
 *    "由你的团队添加" button for the team-managed modes.
 * 4. **The 应用 / 技能 cards** — official's card (header with a count, a plug/cube glyph per row,
 *    the noun as the row's description fallback) instead of upstream's collapsible card, with
 *    official's collapse at five rows and its "N more" button.
 * 5. **The 信息 table** — official's `dl` with 功能 / 开发者 / 类别 / 团队使用情况 / 网站 / 可用性,
 *    and official's rule for which rows exist at all.
 * 6. **The tool rows' switch** — official's own Switch (the accent-primary track and the luminous
 *    knob) instead of upstream 0.18's shared grey switch.
 *
 * ## Every string here is official 0.78.1's own
 *
 * The injected source runs in the chunk's module scope, so it can use the chunk's own `t` (jsx),
 * `C` (react), `k` (stylix), `me` (typography), `ue` (icon) and `RLocT(en, zh)` (the locale
 * runtime). Every user-visible string goes through `RLocT`, and every Chinese string is official
 * 0.78.1's own text under its own message id.
 *
 * ## The two fields official reads that this build does not carry
 *
 * Official's availability label (`Wr`) and its plugin URL (`nt`) both read `isPublicListed`, a
 * marketplace-listing flag that upstream 0.18's recovered proto does not expose. This port
 * derives it from the catalogue shape official's own model uses: a LISTED marketplace plugin has
 * no `marketplace` field and is not one of the two native entries, a team- or user-owned
 * published plugin carries `marketplace`, and the two native entries carry `native`. That is the
 * same split official's browse model draws (`P` groups the entries whose `marketplace` is
 * undefined; `Tjt` collects the ones whose `marketplace` is not).
 *
 * @evidence official 0.78.1 `chunk-plugin-detail-view-KNB3B4mm.js` — `qr` (the detail view), `Kr`
 *   (the header), `Gr` (the layout), `Fn` (the details list), `In` (the dt/dd row), `zr` (the
 *   应用 / 技能 card), `Yn` (the connect button), `Jn` (the action group), `mr` (the share
 *   button), `Wr` (the availability label), `nt` (the plugin URL), `Ne` (the stacked label).
 * @evidence official 0.78.1 `index.eager-app-D1juOWZp.js` — `LD`/`cv` (the copy status hook),
 *   `fGe` (the copy-link revert delay), `mXe` (the share revert delay), `_Mt` (the team-managed
 *   label), `vMt` (the removal descriptor), `zq` (the category message ids), `Rjt` (the hostname),
 *   `Bjt` (the connector list), `Sjt` (the category label).
 * @evidence official 0.78.1 live (CDP 9333, 2026-10-31) — the X Money detail page's DOM, the
 *   1Password detail page's DOM, and both buttons' class recipes.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { normalizeJsxChildren } from "./marketplace-jsx-children.mjs";

/** The chunk this patch owns: upstream 0.18's plugins view. */
export const MARKETPLACE_DETAIL_VIEW_0781_CHUNK = "view-B5Ug8wEm.js";

/**
 * Official 0.78.1's own message ids for every string the detail page renders.
 *
 * The port renders them through `RLocT(en, zh)`, so the language preference still switches them;
 * the ids are recorded so the port record can point at official's own locale table.
 */
export const MARKETPLACE_DETAIL_VIEW_0781_MESSAGES = Object.freeze({
  information: Object.freeze({ id: "nSkB8g", en: "Information", zh: "信息" }),
  developer: Object.freeze({ id: "7aDnUb", en: "Developer", zh: "开发者" }),
  category: Object.freeze({ id: "K7tIrx", en: "Category", zh: "类别" }),
  website: Object.freeze({ id: "On0aF2", en: "Website", zh: "网站" }),
  availability: Object.freeze({ id: "lXkUEV", en: "Availability", zh: "可用性" }),
  capabilities: Object.freeze({ id: "Qx7DM7", en: "Capabilities", zh: "功能" }),
  teamAdoption: Object.freeze({ id: "20QE6w", en: "Team adoption", zh: "团队使用情况" }),
  apps: Object.freeze({ id: "VDvaN2", en: "Apps", zh: "应用" }),
  skills: Object.freeze({ id: "PCSkw2", en: "Skills", zh: "技能" }),
  connector: Object.freeze({ id: "cQpGeE", en: "Connector", zh: "连接器" }),
  skill: Object.freeze({ id: "OZJeTZ", en: "Skill", zh: "技能" }),
  connect: Object.freeze({ id: "iSLIjg", en: "Connect", zh: "连接" }),
  connecting: Object.freeze({ id: "JrFTcr", en: "Connecting…", zh: "正在连接…" }),
  uninstall: Object.freeze({ id: "fo0VXg", en: "Uninstall", zh: "卸载" }),
  remove: Object.freeze({ id: "t/YqKh", en: "Remove", zh: "移除" }),
  removing: Object.freeze({ id: "APfagk", en: "Removing…", zh: "正在移除…" }),
  managedByTeam: Object.freeze({ id: "q1LJYo", en: "Managed by your team", zh: "由你的团队管理" }),
  addedByTeam: Object.freeze({ id: "MoPMW6", en: "Added by your team", zh: "由你的团队添加" }),
  share: Object.freeze({ id: "Z8lGw6", en: "Share", zh: "分享" }),
  copied: Object.freeze({ id: "6V3Ea3", en: "Copied", zh: "已复制" }),
  copyFailed: Object.freeze({ id: "9sj0G8", en: "Copy failed", zh: "复制失败" }),
  copyLink: Object.freeze({ id: "bXJKzj", en: "Copy link to this plugin", zh: "复制此插件的链接" }),
  showMore: Object.freeze({
    id: "UhKOdj",
    en: "# more",
    zh: "另外 # 个",
    composed: true,
    source: 'RLocT(hidden+" more","另外 "+hidden+" 个")',
  }),
  appCount: Object.freeze({
    id: "VdObnj",
    plural: true,
    oneEn: "1 app",
    oneZh: "1 个应用",
    en: "# apps",
    zh: "# 个应用",
  }),
  skillCount: Object.freeze({
    id: "Yb5NVb",
    plural: true,
    oneEn: "1 skill",
    oneZh: "1 项技能",
    en: "# skills",
    zh: "# 项技能",
  }),
  teamUsage: Object.freeze({
    id: "bCbNMB",
    plural: true,
    oneEn: "Used by 1 teammate",
    oneZh: "1 位队友在使用",
    en: "Used by # teammates",
    zh: "# 位队友在使用",
  }),
  builtIn: Object.freeze({ id: "+7fBMP", en: "Built-in", zh: "内置" }),
  yourTeam: Object.freeze({ id: "vhSOwR", en: "Your team", zh: "你的团队" }),
  publicListed: Object.freeze({ id: "7d1a0d", en: "Public", zh: "公开" }),
  // The tools section's count sentence. Official composes it at runtime from its locale entry, so
  // the port writes the two halves around the runtime counts.
  toolsEnabled: Object.freeze({
    id: "bWyJ+b",
    composed: true,
    en: "{enabledCount} of {0} enabled",
    zh: "已启用 {enabledCount}/{0} 个",
    source: 'RLocT(h+" of "+r.length+" enabled","已启用 "+h+"/"+r.length+" 个")',
  }),
  // The information table's Tools row. Official's locale entry names the first value differently.
  detailsEnabled: Object.freeze({
    id: "CzixCu",
    composed: true,
    en: "{enabledToolCount} of {0} enabled",
    zh: "已启用 {enabledToolCount}/{0} 个",
    source: 'RLocT(y+" of "+f.length+" enabled","已启用 "+y+"/"+f.length+" 个")',
  }),
  // The add-account label the port writes into upstream's own row.
  addAnotherAccount: Object.freeze({
    id: "FGnQEW",
    en: "Add Another Account",
    zh: "添加其他账户",
  }),
});

/**
 * Official 0.78.1's own message ids for the detail page's section headings and labels.
 *
 * Upstream 0.18 writes these as hardcoded English strings that the extra-i18n pass localizes
 * under official's own message ids, so the port does not write them itself. The ids are recorded
 * here so the port record points at official's locale table and so the ids the repository's i18n
 * table uses can be checked against official's own.
 */
export const MARKETPLACE_DETAIL_VIEW_0781_SECTION_MESSAGES = Object.freeze({
  tools: Object.freeze({ id: "xdA/+p", en: "Tools", zh: "工具" }),
  accounts: Object.freeze({ id: "bPwFdf", en: "Accounts", zh: "账户" }),
  defaultAccount: Object.freeze({ id: "ovBPCi", en: "Default", zh: "默认" }),
  setup: Object.freeze({ id: "RDjuBN", en: "Setup", zh: "配置" }),
  setupValues: Object.freeze({ id: "mrRDVU", en: "Setup Values", zh: "配置值" }),
  editValues: Object.freeze({ id: "kDCdbL", en: "Edit Values", zh: "编辑值" }),
});

/**
 * Official 0.78.1's category-key → message-id table (`zq` in `index.eager-app`).
 *
 * The keys are upstream 0.18's own curated category keys, so an entry that carries one resolves
 * straight through it. An entry whose key is not in the table falls back to official's `bjt`
 * (title-case the human category string), exactly as official's `Sjt` does.
 */
export const MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES = Object.freeze({
  FEATURED: Object.freeze({ en: "Featured", zh: "精选" }),
  INFRASTRUCTURE: Object.freeze({ en: "Infrastructure", zh: "基础设施" }),
  DATA_ANALYTICS: Object.freeze({ en: "Data & Analytics", zh: "数据与分析" }),
  PRODUCTIVITY: Object.freeze({ en: "Productivity", zh: "效率" }),
  PAYMENTS: Object.freeze({ en: "Payments", zh: "支付" }),
  AGENT_ORCHESTRATION: Object.freeze({ en: "Agent Orchestration", zh: "智能体编排" }),
  CANVAS: Object.freeze({ en: "Canvas", zh: "画布" }),
  INBOX_AND_COLLABORATION: Object.freeze({ en: "Inbox and Collaboration", zh: "收件箱与协作" }),
  SCHEDULING: Object.freeze({ en: "Scheduling", zh: "日程安排" }),
  DOCUMENTS_AND_FILES: Object.freeze({ en: "Documents and Files", zh: "文档与文件" }),
  SALES: Object.freeze({ en: "Sales", zh: "销售" }),
  CUSTOMER_SUPPORT: Object.freeze({ en: "Customer Support", zh: "客户支持" }),
  FINANCE_AND_LEGAL: Object.freeze({ en: "Finance and Legal", zh: "财务与法务" }),
  RESEARCH: Object.freeze({ en: "Research", zh: "研究" }),
  DESIGN: Object.freeze({ en: "Design", zh: "设计" }),
  MARKETING: Object.freeze({ en: "Marketing", zh: "营销" }),
  LOGIN_AND_CREDENTIAL_MANAGEMENT: Object.freeze({ en: "Password Managers", zh: "密码管理器" }),
});

/**
 * Official 0.78.1's own class recipes for the detail page's shared surfaces.
 *
 * Every string here was read off official 0.78.1's own renderer — the plugin detail page's DOM,
 * measured live on official's CDP port 9333 on 2026-11-01 — and cross-checked against official's
 * stylesheet (`index-Dh7EWA8t.css`), where every token resolves to a declaration. A stylix class
 * name is the hash of its declaration block, so a token that exists on both sides carries the same
 * declarations and needs no new CSS.
 *
 * @evidence official 0.78.1 `chunk-plugin-detail-view-KNB3B4mm.js` — `hr` (the collapsible card),
 *   `Nr` (the tools section), `Br` (the setup section), `kn` (the row label recipe).
 * @evidence official 0.78.1 `chunk-plugin-detail-sharepoint-write-MAPmM3e9.js` — the account row,
 *   the account title recipe and the add-account row recipe.
 */
const OFFICIAL_0781_SECTION_LABEL =
  "sand-9f619 sand-1y1aw1k sand-1pic42t sand-10b6aqq sand-1onr9mi";
const OFFICIAL_0781_DETAIL_CARD =
  "sand-9f619 sand-7giv3 sand-13ly8rp sand-1xlntvz sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r";
const OFFICIAL_0781_TOOLS_CARD =
  "sand-9f619 sand-7giv3 sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r sand-exx8yu sand-18d9i69";
const OFFICIAL_0781_DETAILS_ROW =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi";
const OFFICIAL_0781_ROW_LABEL =
  "sand-9f619 sand-2lah0s sand-thy2uy sand-b3r6kr sand-uxw1ft sand-lyipyv sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-tyxrsu";
const OFFICIAL_0781_ACCOUNT_TITLE =
  "sand-9f619 sand-b3r6kr sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-tyxrsu sand-lyipyv sand-uxw1ft";
const OFFICIAL_0781_SUMMARY_BUTTON =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-jyslct sand-1lugfcp sand-h8yej3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-c342km sand-ng3xce sand-jb2p0i sand-1qlqyl8 sand-1yc453h sand-1ypdohk sand-jbqb8w sand-1ecwv3n sand-1t137rt sand-1yfcfk6";
const OFFICIAL_0781_SM_SECONDARY_BUTTON =
  "sand-button sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-17d4w8g sand-178xt8z " +
  "sand-1lun4ml sand-so031l sand-pilrb4 sand-13fuv20 sand-18b5jzi sand-1q0q8m5 sand-1t7ytsu sand-1v8p93f " +
  "sand-1o3jo1z sand-16stqrj sand-v5lvn5 sand-jb2p0i sand-1k6tqyu sand-uxw1ft sand-2b8uid sand-krqix3 " +
  "sand-87ps6o sand-ggy1nq sand-1ypdohk sand-1s07b3s sand-1hc1fzr sand-uhm2yv sand-67bb7w sand-aqnwrm " +
  "sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1uczgqu sand-1wpm9rq sand-1wfwxd8 sand-7s97pk " +
  "sand-1eaenvl sand-4meti sand-1pbvl4h sand-d7y6wv sand-exx8yu sand-2vl965 sand-18d9i69 sand-e2zdcy " +
  "sand-9h44rk sand-1wm8ruf sand-spwq11 sand-fwqdrz sand-19jy9ex sand-tyxrsu";
const OFFICIAL_0781_CHEVRON =
  "sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-169k319 sand-11xpdln sand-12rn374 sand-wji4o3";
const OFFICIAL_0781_ADD_ACCOUNT =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-h8yej3 sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-c342km sand-ng3xce sand-jbqb8w sand-1o0liin sand-n4ifyr sand-jb2p0i sand-11wthnw sand-12oo3zp sand-1yc453h sand-1ypdohk sand-1t137rt sand-1yfcfk6";
const OFFICIAL_0781_EDIT_ACCOUNT =
  "sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-1717udv sand-c342km sand-ng3xce sand-jbqb8w sand-169k319 sand-n4ifyr sand-1ypdohk";

/**
 * Official 0.78.1's own switch recipes for the detail page's per-tool rows.
 *
 * Upstream 0.18 renders those rows' on/off switches with its shared switch component, whose
 * checked track is the grey `--sand-fill-control-checked`. Official renders the same control with
 * its own switch: the checked track is the accent primary (`--sand-bg-accent-primary`), the knob
 * is the luminous surface (`--sand-bg-luminous`), and the track carries no border. Both sides
 * render `role="switch"`, `aria-checked="true"`, a 26x16 track and a 12x12 knob; only the recipes
 * differ.
 *
 * Official's track recipe table is a 16-entry literal map indexed by
 * `(size==="md")<<3 | checked<<2 | disabled<<1 | (disabled&&checked)`. The detail page's tool
 * switch is the `sm` size and is never disabled, so only the unchecked and the checked variants
 * are reachable — the two strings below. The knob recipes are official's `knob`, `knobSm` and
 * `knobSmChecked` merged the way official's own merge helper merges them: a key a later recipe
 * overrides moves to the end of the class string.
 *
 * @evidence official 0.78.1 `index.eager-app-D1juOWZp.js` — `SD` (the switch component), `xD`
 *   (its knob recipes) and its 16-entry track recipe table.
 * @evidence official 0.78.1 live (CDP 9333, 2026-11-01) — the plugin detail page's tool-row
 *   switch DOM: the checked track's class string and the knob's.
 */
const OFFICIAL_0781_SWITCH_TRACK_ON =
  "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-ymw2ht sand-2k1e5v sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-12rn374 sand-wji4o3 sand-23j0i4 sand-lup9mm sand-lrd64x sand-1hshjfz sand-1akln4p sand-1cgqir sand-1moagsb sand-jhkic0";
const OFFICIAL_0781_SWITCH_TRACK_OFF =
  "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-ymw2ht sand-fwqdrz sand-19jy9ex sand-1g6zli8 sand-2k1e5v sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-12rn374 sand-wji4o3 sand-23j0i4 sand-lup9mm sand-lrd64x sand-1hshjfz sand-1akln4p";
const OFFICIAL_0781_SWITCH_KNOB_ON =
  "sand-9f619 sand-10l6tqk sand-s7f9wi sand-16rqkct sand-7qiiw0 sand-1gdvyqu sand-2hifos sand-12rn374 sand-wji4o3 sand-smyaan sand-1kpxq89 sand-1r4y97";
const OFFICIAL_0781_SWITCH_KNOB_OFF =
  "sand-9f619 sand-10l6tqk sand-s7f9wi sand-aoy8p5 sand-16rqkct sand-7qiiw0 sand-1gdvyqu sand-2hifos sand-12rn374 sand-wji4o3 sand-smyaan sand-1kpxq89";

/** Upstream 0.18's own recipes for the same surfaces, which the port replaces. */
const UPSTREAM_018_SECTION_LABEL =
  "sand-9f619 sand-1y1aw1k sand-19tmk5i sand-10b6aqq sand-zjhap9";
const UPSTREAM_018_DETAIL_CARD = "sand-9f619 sand-ixl9f9 sand-i07v4r";
const UPSTREAM_018_DETAILS_ROW =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-z9dl7a sand-19tmk5i sand-sag5q8 sand-zjhap9";
const UPSTREAM_018_ROW_LABEL =
  "sand-9f619 sand-2lah0s sand-thy2uy sand-b3r6kr sand-uxw1ft sand-lyipyv sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1wd3ewq";
const UPSTREAM_018_ACCOUNT_TITLE =
  "sand-9f619 sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1wd3ewq sand-lyipyv sand-uxw1ft";
const UPSTREAM_018_ADD_ACCOUNT =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-h8yej3 sand-z9dl7a sand-19tmk5i sand-sag5q8 sand-zjhap9 sand-c342km sand-ng3xce sand-jbqb8w sand-19aaqeu sand-7gh5u8 sand-jb2p0i sand-4z9k3i sand-12oo3zp sand-dpxx8g sand-1ypdohk";
const UPSTREAM_018_EDIT_ACCOUNT =
  "sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-1717udv sand-c342km sand-ng3xce sand-jbqb8w sand-4b2ntj sand-7gh5u8 sand-1ypdohk";

const REPLACEMENTS = [
  {
    // Official's marketplace renders the detail bar from the shared `sand-settings-detail-bar`
    // component: a 48px three-column grid (back button | title | trailing) whose title is hidden
    // for a plugin detail, because the detail page carries its own heading. Upstream 0.18's bar is
    // a 44px flex row that shows the title and a 16px bare icon as the back button.
    label: "marketplace detail bar: official's 48px bar with the ghost back button",
    before: "t.jsx(el,{headingId:a,onBack:W,title:Ts})",
    after: "t.jsx(RM0781DetailBar,{headingId:a,onBack:W,title:Ts})",
  },
  {
    // Official's header renders the title block inside a memo that tracks the title element and
    // the meta line. The port adds the copy-link button to that block and the share button to the
    // action group, and both depend on the entry's plugin URL, so the two memos need one more
    // tracked slot each. React's `useMemoCache` allocates exactly the number of slots it is asked
    // for, so the cache grows from 87 to 89. `ne.c(87)` occurs once in this chunk.
    label: "detail memo cache: two more slots for the title block and the action group",
    before: "ne.c(87)",
    after: "ne.c(89)",
  },
  {
    // Official's meta line is the marketplace display name and the teammate count. Upstream 0.18
    // renders the same two facts plus a "View Source" link, which official 0.78.1's header does
    // not have. Official's class recipe is `sand-11wthnw sand-1o0liin` where upstream's older
    // recipe is `sand-4z9k3i sand-19aaqeu`.
    label: "detail meta line: official's marketplace name and teammate count, no View Source link",
    before:
      'J=g!=null||b||z?t.jsxs("span",{className:k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g ' +
      'sand-euugli sand-b3r6kr sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-19aaqeu sand-uxw1ft"),children:[' +
      'g!=null?t.jsx("span",{className:k("sand-9f619 sand-euugli sand-b3r6kr sand-lyipyv"),children:g}):null,' +
      'g!=null&&b?t.jsx("span",{"aria-hidden":!0,className:k("sand-9f619 sand-1c4vz4f sand-2lah0s ' +
      'sand-dl72j9"),children:"·"}):null,' +
      'b?t.jsx("span",{className:k("sand-9f619 sand-1c4vz4f sand-2lah0s sand-dl72j9"),children:A(_)}):null,' +
      '(g!=null||b)&&z?t.jsx("span",{"aria-hidden":!0,className:k("sand-9f619 sand-1c4vz4f sand-2lah0s ' +
      'sand-dl72j9"),children:"·"}):null,' +
      's.homepage!=null?t.jsxs("a",{...v(s.homepage,P),className:k("sand-3nfvp2 sand-6s0dn4 sand-1jnr06f ' +
      'sand-19aaqeu sand-7gh5u8 sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-krqix3 sand-1ypdohk sand-9f619 ' +
      'sand-1c4vz4f sand-2lah0s sand-dl72j9"),href:s.homepage,rel:"noopener noreferrer",target:"_blank",' +
      'children:[RLocT("View Source","查看源码"),t.jsx(ue,{name:"arrow-right-up",size:13})]}):null]}):null',
    after: 'J=t.jsx(RM0781DetailMetaLine,{entry:s,teammateCount:_})',
  },
  {
    // Official wraps the title in a `data-detail-hero-title` block and puts the copy-link button
    // beside it. Upstream 0.18 puts the title and the meta line straight into the title block.
    label: "detail title: official's hero-title wrapper with the copy-link button",
    before:
      "e[31]!==U||e[32]!==J?(te=t.jsxs(\"div\",{className:B,children:[U,J]}),e[31]=U,e[32]=J,e[33]=te):te=e[33]",
    after:
      "e[31]!==U||e[32]!==J||e[87]!==(RM0781DetailPluginUrl(s)??\"\")?(te=t.jsxs(\"div\",{className:B,children:[" +
      "t.jsxs(\"div\",{className:RM0781DetailHeroTitleClasses,\"data-detail-hero-title\":\"\",children:[" +
      "U,t.jsx(RM0781DetailCopyLink,{entry:s})]}),J]})," +
      "e[31]=U,e[32]=J,e[87]=RM0781DetailPluginUrl(s)??\"\",e[33]=te):te=e[33]",
  },
  {
    // Official's header carries the anchor-reveal pair on top of upstream 0.18's recipe.
    label: "detail header: official's anchor-reveal classes",
    before:
      'L=k("sand-9f619 sand-78zum5 sand-dt5ytf sand-1v2ro7d"),' +
      'F=k("sand-plugins-detail__header","sand-9f619 sand-78zum5 sand-6s0dn4 sand-1v2ro7d"),' +
      "e[11]=q,e[12]=L,e[13]=F",
    after:
      'L=k("sand-9f619 sand-78zum5 sand-dt5ytf sand-1v2ro7d"),' +
      'F=k("sand-plugins-detail__header","sand-9f619 sand-78zum5 sand-6s0dn4 sand-1v2ro7d sand-1xr8qbc sand-jodmca"),' +
      "e[11]=q,e[12]=L,e[13]=F",
  },
  {
    // Official's description is the body-1 typography recipe; upstream 0.18 uses its own.
    label: "detail description: official's typography recipe",
    before:
      'G=k("sand-plugins-detail__desc","sand-9f619 sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b ' +
      'sand-if65rj sand-1fc57z9 sand-12oo3zp sand-19aaqeu")',
    after:
      'G=k("sand-plugins-detail__desc","sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-9f619 sand-dj266r ' +
      'sand-14z9mp sand-at24cr sand-1lziwak sand-1o0liin")',
  },
  {
    // Official's action group is the share button plus the connect/uninstall button. Upstream
    // 0.18 renders one button per install mode ("Remove" / "Uninstall") or an "Add" button.
    label: "detail action: official's share + connect group",
    before:
      "e[39]!==r||e[40]!==$||e[41]!==fe?(ce=t.jsx(ft,{isBusy:r,mode:$,onAction:fe})," +
      "e[39]=r,e[40]=$,e[41]=fe,e[42]=ce):ce=e[42]",
    after:
      "e[39]!==r||e[40]!==$||e[41]!==fe||e[88]!==(RM0781DetailPluginUrl(s)??\"\")?" +
      "(ce=t.jsx(RM0781DetailActions,{entry:s,installedPlugin:i,installedServer:a,installMode:$," +
      "isBusy:r,isAddPending:x,onAdd:f,onUninstall:h,onUninstallPlugin:y})," +
      "e[39]=r,e[40]=$,e[41]=fe,e[88]=RM0781DetailPluginUrl(s)??\"\",e[42]=ce):ce=e[42]",
  },
  {
    label: "detail action: official's share + connect group (adding)",
    before: "e[43]!==fe?(ce=t.jsx(dt,{label:fe}),e[43]=fe,e[44]=ce):ce=e[44]",
    after:
      "e[43]!==fe||e[88]!==(RM0781DetailPluginUrl(s)??\"\")?" +
      "(ce=t.jsx(RM0781DetailActions,{entry:s,installedPlugin:i,installedServer:a,installMode:$," +
      "isBusy:r,isAddPending:x,onAdd:f,onUninstall:h,onUninstallPlugin:y})," +
      "e[43]=fe,e[88]=RM0781DetailPluginUrl(s)??\"\",e[44]=ce):ce=e[44]",
  },
  {
    label: "detail action: official's share + connect group (add)",
    before:
      "e[48]!==r||e[49]!==se?(ke=t.jsx(ve,{disabled:r,onClick:se,size:\"sm\",type:\"button\",variant:\"primary\"," +
      "children:(RLocT(\"Add\",\"添加\"))}),e[48]=r,e[49]=se,e[50]=ke):ke=e[50]",
    after:
      "e[48]!==r||e[49]!==se||e[88]!==(RM0781DetailPluginUrl(s)??\"\")?" +
      "(ke=t.jsx(RM0781DetailActions,{entry:s,installedPlugin:i,installedServer:a,installMode:$," +
      "isBusy:r,isAddPending:x,onAdd:f,onUninstall:h,onUninstallPlugin:y})," +
      "e[48]=r,e[49]=se,e[88]=RM0781DetailPluginUrl(s)??\"\",e[50]=ke):ke=e[50]",
  },
  {
    // Official's 应用 card: a header with the label and the count, then the connector rows.
    label: "detail apps card: official's card",
    before:
      'pe=t.jsx($n,{cardClassName:"sand-plugins-detail__connectors",items:O,label:"Connectors",noun:"connector"})',
    after:
      'pe=t.jsx(RM0781DetailCard,{cardClassName:"sand-plugins-detail__connectors",items:O,' +
      'label:RLocT("Apps","应用"),noun:"connector"})',
  },
  {
    label: "detail skills card: official's card",
    before:
      'ge=t.jsx($n,{cardClassName:"sand-plugins-detail__skills",items:R,label:(RLocT("Skills","技能")),noun:"skill"})',
    after:
      'ge=t.jsx(RM0781DetailCard,{cardClassName:"sand-plugins-detail__skills",items:R,' +
      'label:RLocT("Skills","技能"),noun:"skill"})',
  },
  {
    // Official's 信息 table is the last child of the detail body.
    label: "detail body: official's information table",
    before:
      "Q=t.jsxs(\"div\",{className:de,children:[H,oe,he,pe,ge]})",
    after:
      "Q=t.jsxs(\"div\",{className:de,children:[H,oe,he,pe,ge," +
      "t.jsx(RM0781DetailsList,{label:RLocT(\"Information\",\"信息\")," +
      "rows:RM0781DetailRows(s,_)})]})",
  },
  {
    // Official's tools section reads its count sentence from its locale table: id `bWyJ+b` is
    // "{enabledCount} of {0} enabled" in English and "已启用 {enabledCount}/{0} 个" in Chinese.
    // Upstream 0.18 builds the same sentence as an English template literal, so the Chinese
    // build renders "23 of 23 enabled" inside a Chinese page.
    label: "detail tools section: official's enabled-count sentence",
    before: "x=`${h} of ${r.length} enabled`",
    after: 'x=RLocT(h+" of "+r.length+" enabled","已启用 "+h+"/"+r.length+" 个")',
  },
  {
    // Official's information table reads the same sentence from its own locale entry, id
    // `CzixCu`: "{enabledToolCount} of {0} enabled" / "已启用 {enabledToolCount}/{0} 个".
    label: "detail information table: official's enabled-count sentence",
    before: "V=f.length>0?`${y} of ${f.length} enabled`:String(s.toolCount)",
    after: 'V=f.length>0?RLocT(y+" of "+f.length+" enabled","已启用 "+y+"/"+f.length+" 个"):String(s.toolCount)',
  },
  {
    // Official's section heading carries official's own section-label recipe
    // (`rt.sectionLabel`: sand-9f619 / sand-1y1aw1k / sand-1pic42t / sand-10b6aqq / sand-1onr9mi).
    // Upstream 0.18 pads the heading with physical left and right padding; official pads it
    // logically. Official uses the one recipe for every section heading on the page, so all four
    // of upstream's heading sites take it.
    label: "detail sections: official's section-label recipe",
    before: `k("${UPSTREAM_018_SECTION_LABEL}")`,
    after: `k("${OFFICIAL_0781_SECTION_LABEL}")`,
    occurrences: 4,
  },
  {
    // Official's card is an elevated surface with a hairline border and the xl radius; upstream's
    // is a translucent fill with a 14px radius and no border. Official's tools card drops the
    // vertical padding because its only child is the summary button.
    label: "detail tools card: official's card recipe",
    before: `h=k(l,"${UPSTREAM_018_DETAIL_CARD}")`,
    after: `h=k(l,"${OFFICIAL_0781_TOOLS_CARD}")`,
  },
  {
    // Official's summary button composes `$.detailsRow` with `$.summaryRow`, the interactive recipe
    // and the inset focus ring. Upstream composes its own pair, which pads the row by 12px, keeps
    // a 14px radius on the button and draws an outline focus ring instead of an inset one.
    label: "detail tools card: official's summary button recipe",
    before:
      "k(Re(Fs.detailsRow,Fs.summaryRow,d&&Fs.summaryRowExpanded,wn.interactive,wn.keyboardFocus).className)",
    after: `k("${OFFICIAL_0781_SUMMARY_BUTTON}")`,
  },
  {
    // Official's chevron wrapper carries the tertiary text colour and a 120ms transition.
    label: "detail tools card: official's chevron recipe",
    before:
      'k({0:{className:"sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-4b2ntj sand-11xpdln sand-gdialr sand-wji4o3"},' +
      '1:{className:"sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-4b2ntj sand-11xpdln sand-gdialr sand-wji4o3 sand-19jd1h0"}}' +
      "[!!d<<0].className)",
    after:
      `k({0:{className:"${OFFICIAL_0781_CHEVRON}"},` +
      `1:{className:"${OFFICIAL_0781_CHEVRON} sand-19jd1h0"}}[!!d<<0].className)`,
  },
  {
    // Official's details row is the row every section on the page uses: the accounts row, the
    // per-tool row, the setup row and the information row. Upstream pads its rows by 12px with
    // physical left and right padding; official pads them by 10px logically.
    label: "detail rows: official's details-row recipe",
    before: `k("${UPSTREAM_018_DETAILS_ROW}")`,
    after: `k("${OFFICIAL_0781_DETAILS_ROW}")`,
    occurrences: 7,
  },
  {
    // Official's row label is one recipe (`kn`) for the tools summary, the per-tool name, the
    // setup values and the information table's term. Upstream's carries a 13px size and physical
    // margins; official's carries the base size and logical margins.
    label: "detail row labels: official's label recipe",
    before: `k("${UPSTREAM_018_ROW_LABEL}")`,
    after: `k("${OFFICIAL_0781_ROW_LABEL}")`,
    occurrences: 5,
  },
  {
    // Official's plugin detail page renders the per-tool row's on/off switch with official's own
    // Switch: the checked track is the accent primary (`--sand-bg-accent-primary`) and the knob is
    // the luminous surface (`--sand-bg-luminous`). Upstream 0.18 renders the same control with its
    // shared switch, whose checked track is the grey `--sand-fill-control-checked`.
    //
    // The port swaps the component and keeps the props: upstream's `Kn` takes the same
    // `{isChecked, label, onToggle}` triple, so the row's own behaviour — the label it computes,
    // the optimistic toggle and the failure callback — is untouched. Only the recipes change, so
    // the row keeps upstream's own markup and the port adds official's own switch next to it.
    //
    // The label is official's own in both languages. Official builds it from two locale ids —
    // `y5UgU8` ("Disable {0}" / "停用 {0}") for a tool that is enabled and `FZtBeR`
    // ("Enable {0}" / "启用 {0}") for a tool that is not. Upstream 0.18 builds the same label from
    // two English literals, and the extra-i18n pass localizes only the "Enable" half, so the
    // enabled branch reads "Disable <name>" inside a Chinese page. The port rewrites this exact
    // expression, so it writes official's whole label.
    label: "detail tool rows: official's own switch",
    before:
      't.jsx(Kn,{isChecked:!j.isDisabled,label:`${j.isDisabled?(RLocT("Enable","启用")):"Disable"} ${P.get(j.name)??j.name}`,onToggle:()=>{c(()=>Ci({toggle:l,serverId:s,toolName:j.name,applyOptimisticToggle:o,setToggleFailure:d}))}})',
    after:
      't.jsx(RM0781DetailToolSwitch,{isChecked:!j.isDisabled,label:`${j.isDisabled?(RLocT("Enable","启用")):RLocT("Disable","停用")} ${P.get(j.name)??j.name}`,onToggle:()=>{c(()=>Ci({toggle:l,serverId:s,toolName:j.name,applyOptimisticToggle:o,setToggleFailure:d}))}})',
    occurrences: 1,
  },
  {
    // Official's accounts card is the elevated bordered surface, not upstream's translucent fill.
    label: "detail accounts section: official's card recipe",
    before: `A=k("sand-plugins-detail__accounts","${UPSTREAM_018_DETAIL_CARD}")`,
    after: `A=k("sand-plugins-detail__accounts","${OFFICIAL_0781_DETAIL_CARD}")`,
  },
  {
    // Official's account title is the base-size primary-colour label.
    label: "detail accounts section: official's account-title recipe",
    before: `t.jsx("span",{className:k("${UPSTREAM_018_ACCOUNT_TITLE}"),children:B})`,
    after: `t.jsx("span",{className:k("${OFFICIAL_0781_ACCOUNT_TITLE}"),children:B})`,
  },
  {
    // Official's edit/rename icon on the account row carries official's own recipe.
    label: "detail accounts section: official's edit-account recipe",
    before: `k("${UPSTREAM_018_EDIT_ACCOUNT}")`,
    after: `k("${OFFICIAL_0781_EDIT_ACCOUNT}")`,
  },
  {
    // Official's add-account row carries official's own recipe, and its label is official's own
    // text under official's own message id (`FGnQEW`). The row only renders for a multi-account
    // connector, which the reconstruction's local credential store is not, so this keeps the
    // source faithful rather than changing a pixel.
    label: "detail accounts section: official's add-account row recipe",
    before: `k("sand-plugins-detail__add-account","${UPSTREAM_018_ADD_ACCOUNT}")`,
    after: `k("sand-plugins-detail__add-account","${OFFICIAL_0781_ADD_ACCOUNT}")`,
  },
  {
    // Official's add-account label is "Add Another Account" in English and "添加其他账户" in
    // Chinese, under official's message id `FGnQEW`. Upstream 0.18 leaves the English literal in
    // a Chinese page.
    label: "detail accounts section: official's add-account label",
    before: `,"Add Another Account"`,
    after: `,RLocT("Add Another Account","添加其他账户")`,
  },
  {
    // Official's setup section's "Edit Values" button is official's own small secondary button.
    // Upstream 0.18 builds it from its own `sand-button` recipe, which differs from official's in
    // the border side, the transition duration and the secondary tone. The attributes official's
    // button carries are the same ones upstream's button already renders, so only the recipe
    // changes.
    label: "detail setup section: official's small secondary button",
    before:
      't.jsx(ve,{disabled:s,onClick:a,size:"sm",type:"button",variant:"secondary",children:(RLocT("Edit Values","编辑值"))})',
    after:
      't.jsx(RM0781DetailSmallSecondaryButton,{disabled:s,onClick:a,children:(RLocT("Edit Values","编辑值"))})',
  },
  {
    // Official's setup card is the elevated bordered surface.
    label: "detail setup section: official's card recipe",
    before: `i=k("sand-plugins-detail__setup","${UPSTREAM_018_DETAIL_CARD}")`,
    after: `i=k("sand-plugins-detail__setup","${OFFICIAL_0781_DETAIL_CARD}")`,
  },

];

/**
 * The injected source.
 *
 * It lives in the chunk's module scope, so it can use the chunk's own `t` (jsx runtime), `C`
 * (react), `k` (stylix), `me` (typography), `ue` (icon) and `RLocT(en, zh)` (the locale runtime
 * the i18n passes append).
 *
 * The class recipes are official 0.78.1's own, copied from its rendered DOM and from its button
 * recipes (`hC.root`, `hC.sizeLg`, `Cx.body1`, `hC.neutralPrimary`, `hC.neutralSecondary`,
 * `hC.neutralTertiary`).
 */
const INJECTED_SOURCE = [
  "const RM0781DetailHeroTitleClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-1jnr06f sand-euugli\";",
  "const RM0781DetailActionsClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-167g77z sand-1c4vz4f sand-2lah0s sand-dl72j9\";",
  "const RM0781DetailMetaClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-euugli sand-b3r6kr sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-1o0liin sand-uxw1ft\";",
  "const RM0781DetailMetaNameClasses=\"sand-9f619 sand-euugli sand-b3r6kr sand-lyipyv\";",
  "const RM0781DetailMetaSeparatorClasses=\"sand-9f619 sand-1c4vz4f sand-2lah0s sand-dl72j9\";",
  "const RM0781DetailIconButtonClasses=\"sand-kit-icon-button sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-9f619 sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-1ypdohk sand-tgyt42 sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1v39l1b sand-1y3gkto sand-w4jnvo sand-1qx5ct2 sand-1kogg8i sand-jbqb8w sand-1ecwv3n sand-nxsxl2 sand-13hlow9 sand-xcn2h6 sand-1t7ft1p sand-25t5g8 sand-19991ni sand-12rn374 sand-9lcvmn\";",
  "const RM0781DetailKitIconSmClasses=\"sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-1kky2od sand-lup9mm\";",
  "const RM0781DetailKitIconMdClasses=\"sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-1xp8n7a sand-mix8c7\";",
  "const RM0781DetailButtonBase=\"sand-kit-button sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-2lah0s sand-9f619 sand-c342km sand-ng3xce sand-jb2p0i sand-uxw1ft sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-12rn374 sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1v39l1b sand-1y3gkto sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-1y1aw1k sand-v54qhq sand-wib8y2 sand-f7dkkf sand-ymw2ht\";",
  "const RM0781DetailButtonPrimary=RM0781DetailButtonBase+\" sand-8rotk8 sand-5b9xvv sand-1ialtwx sand-sa7k8x sand-g7klql\";",
  "const RM0781DetailButtonSecondary=RM0781DetailButtonBase+\" sand-fwqdrz sand-urwpdt sand-1g6zli8 sand-tyxrsu sand-g7klql\";",
  "const RM0781DetailButtonTertiary=RM0781DetailButtonBase+\" sand-jbqb8w sand-15cxclc sand-1oqui1x sand-tyxrsu sand-g7klql\";",
  "const RM0781DetailStackClasses=\"sand-wz0xwf sand-6s0dn4 sand-1o2pa38\";",
  "const RM0781DetailStackLabelClasses=\"sand-1agbcgv sand-crlgei sand-3nfvp2 sand-6s0dn4 sand-1jnr06f sand-uxw1ft\";",
  "const RM0781DetailStackLabelHiddenClasses=RM0781DetailStackLabelClasses+\" sand-lshs6z\";",
  "const RM0781DetailButtonLabelClasses=\"sand-euugli sand-b3r6kr sand-lyipyv sand-9f619 sand-1tn5z8q sand-1pg8wfp sand-68av9p\";",
  "const RM0781DetailBarClasses=\"sand-settings-detail-bar sand-9f619 sand-rvj5dj sand-37c5m6 sand-6s0dn4 sand-sdox4t sand-889kno sand-2vl965 sand-1a8lsjc sand-e2zdcy\";",
  "const RM0781DetailBarBackClasses=\"sand-1lqcxt8 sand-euugli\";",
  "const RM0781DetailBarBackButtonClasses=\"sand-kit-icon-button sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-9f619 sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-12rn374 sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-1v39l1b sand-1y3gkto sand-gd8bvy sand-1fgtraw sand-ymw2ht sand-jbqb8w sand-1ecwv3n sand-nxsxl2 sand-13hlow9 sand-xcn2h6\";",
  "const RM0781DetailBarIconClasses=\"sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-w4jnvo sand-1qx5ct2\";",
  "const RM0781DetailBarTitleClasses=\"sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-9f619 sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-b3r6kr sand-1rhlpx6 sand-tyxrsu sand-2b8uid sand-lyipyv sand-uxw1ft sand-19991ni sand-ibwnj sand-12w9bfk sand-9lcvmn sand-g01cxk\";",
  "const RM0781DetailBarTrailingClasses=\"sand-78zum5 sand-6s0dn4 sand-1qab1bc sand-euugli\";",
  "const RM0781DetailSmallSecondaryButtonClasses=" + JSON.stringify(OFFICIAL_0781_SM_SECONDARY_BUTTON) + ";",
  "const RM0781DetailCardHeaderClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-1y1aw1k sand-1pic42t sand-10b6aqq sand-1onr9mi\";",
  "const RM0781DetailCardClasses=\"sand-9f619 sand-7giv3 sand-13ly8rp sand-1xlntvz sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r\";",
  "const RM0781DetailCardClassesMore=\"sand-9f619 sand-7giv3 sand-13ly8rp sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r sand-18d9i69\";",
  "const RM0781DetailCardRowClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-1nhvcw1\";",
  "const RM0781DetailCardGlyphClasses=\"sand-78zum5 sand-2lah0s sand-169k319\";",
  "const RM0781DetailCardItemClasses=\"sand-78zum5 sand-dt5ytf sand-euugli\";",
  "const RM0781DetailCardItemNameClasses=\"sand-b3r6kr sand-tyxrsu sand-11wthnw sand-d4r4e8 sand-lyipyv sand-uxw1ft\";",
  "const RM0781DetailCardItemDescClasses=\"sand-b3r6kr sand-169k319 sand-1wm8ruf sand-1d3mw78 sand-lyipyv sand-uxw1ft\";",
  "const RM0781DetailCardCountClasses=\"sand-169k319\";",
  "const RM0781DetailCardMoreClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-jyslct sand-1lugfcp sand-h8yej3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-c342km sand-ng3xce sand-jb2p0i sand-1qlqyl8 sand-1yc453h sand-1ypdohk sand-13a6bvl sand-jbqb8w sand-1ecwv3n sand-1t137rt sand-1yfcfk6\";",
  "const RM0781DetailSectionLabelClasses=\"sand-9f619 sand-1y1aw1k sand-1pic42t sand-10b6aqq sand-1onr9mi\";",
  "const RM0781DetailListClasses=\"sand-7giv3 sand-13ly8rp sand-1xlntvz sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r sand-9f619 sand-78zum5 sand-dt5ytf sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak\";",
  "const RM0781DetailRowClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi\";",
  "const RM0781DetailTermClasses=\"sand-9f619 sand-2lah0s sand-thy2uy sand-b3r6kr sand-uxw1ft sand-lyipyv sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-tyxrsu\";",
  "const RM0781DetailValueClasses=\"sand-9f619 sand-dj266r sand-2fvf9 sand-at24cr sand-1lziwak sand-b3r6kr sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-169k319 sand-p4054r sand-lyipyv sand-uxw1ft\";",
  // Official's own Switch, the control the per-tool rows use. The recipes are official's own class
  // strings, copied verbatim from its rendered DOM and from its switch recipe table; they are NOT
  // routed through the chunk's `k()` stylix helper, because that helper would prepend a custom name
  // and the recipes would stop being byte-identical to official's.
  "const RM0781DetailSwitchOn=" + JSON.stringify(OFFICIAL_0781_SWITCH_TRACK_ON) + ";",
  "const RM0781DetailSwitchOff=" + JSON.stringify(OFFICIAL_0781_SWITCH_TRACK_OFF) + ";",
  "const RM0781DetailKnobOn=" + JSON.stringify(OFFICIAL_0781_SWITCH_KNOB_ON) + ";",
  "const RM0781DetailKnobOff=" + JSON.stringify(OFFICIAL_0781_SWITCH_KNOB_OFF) + ";",
  "const RM0781DetailCategories=" + JSON.stringify(MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES) + ";",
  "function RM0781DetailTitleCase(text){",
  "  const locale=RM0781Locale();",
  "  return String(text).replace(/\\S+/gu,word=>word.charAt(0).toLocaleUpperCase(locale)+word.slice(1));",
  "}",
  "function RM0781DetailCategoryLabel(entry){",
  "  if(entry==null)return null;",
  "  const key=entry.categoryKey;",
  "  if(key!=null&&RM0781DetailCategories[key]!==undefined){",
  "    const label=RM0781DetailCategories[key];",
  "    return RLocT(label.en,label.zh);",
  "  }",
  "  const raw=entry.category==null?\"\":String(entry.category).trim();",
  "  return raw.length===0?null:RM0781DetailTitleCase(raw);",
  "}",
  "function RM0781DetailHostname(url){",
  "  if(url==null||String(url).length===0)return null;",
  "  try{return new URL(String(url)).hostname}catch{return null}",
  "}",
  "function RM0781DetailIsPublicListed(entry){",
  "  if(entry==null)return false;",
  "  return entry.marketplace==null&&entry.native==null;",
  "}",
  "function RM0781DetailAvailability(entry){",
  "  if(entry==null)return null;",
  "  if(entry.builtinServerIdentifier!=null)return RLocT(\"Built-in\",\"内置\");",
  "  if(entry.marketplace!=null&&entry.marketplace.ownership===\"team\")return RLocT(\"Your team\",\"你的团队\");",
  "  if(RM0781DetailIsPublicListed(entry))return RLocT(\"Public\",\"公开\");",
  "  return null;",
  "}",
  "function RM0781DetailPluginUrl(entry){",
  "  if(entry==null)return null;",
  "  if(entry.marketplace!=null&&entry.marketplace.ownership===\"user\")return null;",
  "  if(!RM0781DetailIsPublicListed(entry))return null;",
  "  return \"https://x.ai/bot/plugin/\"+entry.id;",
  "}",
  "function RM0781DetailConnectors(entry){",
  "  if(entry==null)return [];",
  "  return entry.connectors==null?[{name:entry.name==null?\"\":entry.name,description:\"\"}]:entry.connectors;",
  "}",
  "function RM0781DetailAppCount(count){",
  "  return count===1?RLocT(\"1 app\",\"1 个应用\"):RLocT(count+\" apps\",count+\" 个应用\");",
  "}",
  "function RM0781DetailSkillCount(count){",
  "  return count===1?RLocT(\"1 skill\",\"1 项技能\"):RLocT(count+\" skills\",count+\" 项技能\");",
  "}",
  "function RM0781DetailTeammateCount(count){",
  "  return count===1?RLocT(\"Used by 1 teammate\",\"1 位队友在使用\")",
  "    :RLocT(\"Used by \"+count+\" teammates\",count+\" 位队友在使用\");",
  "}",
  "function RM0781DetailRows(entry,teammateCount){",
  "  const appCount=RM0781DetailConnectors(entry).length;",
  "  const skillCount=entry==null||entry.skills==null?0:entry.skills.length;",
  "  const capabilities=[];",
  "  if(appCount>0)capabilities.push(RM0781DetailAppCount(appCount));",
  "  if(skillCount>0)capabilities.push(RM0781DetailSkillCount(skillCount));",
  "  const builtin=entry!=null&&entry.builtinServerIdentifier!=null;",
  "  const publisher=entry==null?null:entry.publisher;",
  "  const developer=publisher==null?null:publisher.displayName;",
  "  const rows=[];",
  "  rows.push({term:RLocT(\"Capabilities\",\"功能\"),value:capabilities.length===0?null:capabilities.join(\", \")});",
  "  if(developer!=null&&!builtin)rows.push({term:RLocT(\"Developer\",\"开发者\"),value:developer});",
  "  if(!builtin)rows.push({term:RLocT(\"Category\",\"类别\"),value:RM0781DetailCategoryLabel(entry)});",
  "  if(teammateCount!=null&&teammateCount>0){",
  "    rows.push({term:RLocT(\"Team adoption\",\"团队使用情况\"),value:RM0781DetailTeammateCount(teammateCount)});",
  "  }",
  "  const website=RM0781DetailHostname(entry==null?null:entry.websiteUrl);",
  "  if(website!=null)rows.push({term:RLocT(\"Website\",\"网站\"),value:website});",
  "  rows.push({term:RLocT(\"Availability\",\"可用性\"),value:RM0781DetailAvailability(entry)});",
  "  return rows;",
  "}",
  "function RM0781StackedLabel(props){",
  "  const{active,labels}=props;",
  "  return t.jsx(\"span\",{className:RM0781DetailStackClasses},Object.keys(labels).map(key=>{",
  "    const on=key===active;",
  "    return t.jsx(\"span\",{",
  "      ...(on?{}:{\"aria-hidden\":true,\"data-copy-skip\":\"\",\"data-find-skip\":\"\"}),",
  "      className:on?RM0781DetailStackLabelClasses:RM0781DetailStackLabelHiddenClasses,",
  "      key:key,children:labels[key]});",
  "  }));",
  "}",
  "let RM0781CopyTimer=null;",
  "function RM0781CopyState(setStatus,durationMs){",
  "  return value=>{",
  "    setStatus(value);",
  "    if(RM0781CopyTimer!=null)clearTimeout(RM0781CopyTimer);",
  "    RM0781CopyTimer=setTimeout(()=>{setStatus(\"idle\")},durationMs);",
  "  };",
  "}",
  "function RM0781DetailBar(props){",
  "  const{headingId,onBack,title}=props;",
  "  const back=t.jsx(\"button\",{\"aria-label\":RLocT(\"Back\",\"返回\"),className:RM0781DetailBarBackButtonClasses,",
  "    onClick:onBack,type:\"button\",\"data-sentiment\":\"neutral\",\"data-size\":\"md\",\"data-variant\":\"ghost\"},",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781DetailBarIconClasses,\"data-size\":\"lg\"},",
  "      t.jsx(ue,{name:\"chevron-left\",size:16})));",
  "  return t.jsxs(\"div\",{className:RM0781DetailBarClasses,children:[",
  "    t.jsx(\"div\",{className:RM0781DetailBarBackClasses,children:back}),",
  "    t.jsx(\"h3\",{\"aria-hidden\":true,className:RM0781DetailBarTitleClasses,id:headingId,children:title}),",
  "    t.jsx(\"div\",{className:RM0781DetailBarTrailingClasses}),",
  "  ]});",
  "}",
  "function RM0781DetailMetaLine(props){",
  "  const{entry,teammateCount}=props;",
  "  const marketplace=entry==null?null:entry.marketplace;",
  "  const name=marketplace==null?null:marketplace.displayName;",
  "  const used=teammateCount!=null&&teammateCount>0;",
  "  if(name==null&&!used)return null;",
  "  return t.jsxs(\"span\",{className:RM0781DetailMetaClasses,children:[",
  "    name==null?null:t.jsx(\"span\",{className:RM0781DetailMetaNameClasses,children:name}),",
  "    name!=null&&used?t.jsx(\"span\",{\"aria-hidden\":true,className:RM0781DetailMetaSeparatorClasses,children:\"·\"}):null,",
  "    used?t.jsx(\"span\",{className:RM0781DetailMetaSeparatorClasses,children:RM0781DetailTeammateCount(teammateCount)}):null,",
  "  ]});",
  "}",
  "function RM0781DetailCopyLink(props){",
  "  const{entry}=props;",
  "  const[status,setStatus]=C.useState(\"idle\");",
  "  const url=RM0781DetailPluginUrl(entry);",
  "  C.useEffect(()=>()=>{if(RM0781CopyTimer!=null)clearTimeout(RM0781CopyTimer)},[]);",
  "  if(url==null)return null;",
  "  const label=RLocT(\"Copy link to this plugin\",\"复制此插件的链接\");",
  "  const copy=()=>{",
  "    navigator.clipboard.writeText(url).then(()=>{",
  "      RM0781CopyState(setStatus,1200)(\"copied\");",
  "    },()=>{",
  "      RM0781CopyState(setStatus,1200)(\"error\");",
  "    });",
  "  };",
  "  return t.jsx(\"button\",{\"aria-label\":label,className:RM0781DetailIconButtonClasses,onClick:copy,title:label,type:\"button\",",
  "    \"data-sentiment\":\"neutral\",\"data-size\":\"xs\",\"data-variant\":\"ghost\"},",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781DetailKitIconSmClasses,\"data-size\":\"sm\"},",
  "      t.jsx(ue,{name:status===\"copied\"?\"check\":\"link\",size:\"xs\"})));",
  "}",
  "function RM0781DetailShare(props){",
  "  const{entry}=props;",
  "  const[status,setStatus]=C.useState(\"idle\");",
  "  const url=RM0781DetailPluginUrl(entry);",
  "  C.useEffect(()=>()=>{if(RM0781CopyTimer!=null)clearTimeout(RM0781CopyTimer)},[]);",
  "  if(url==null)return null;",
  "  const labels={idle:RLocT(\"Share\",\"分享\"),copied:RLocT(\"Copied\",\"已复制\"),error:RLocT(\"Copy failed\",\"复制失败\")};",
  "  const copy=()=>{",
  "    navigator.clipboard.writeText(url).then(()=>{",
  "      RM0781CopyState(setStatus,2000)(\"copied\");",
  "    },()=>{",
  "      RM0781CopyState(setStatus,2000)(\"error\");",
  "    });",
  "  };",
  "  return t.jsxs(\"button\",{className:RM0781DetailButtonSecondary,onClick:copy,type:\"button\",",
  "    \"data-sentiment\":\"neutral\",\"data-size\":\"lg\",\"data-variant\":\"secondary\"},[",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781DetailKitIconMdClasses,\"data-size\":\"md\"},",
  "      t.jsx(ue,{name:status===\"copied\"?\"check\":\"link\",size:\"md\"})),",
  "    t.jsx(\"span\",{className:RM0781DetailButtonLabelClasses},",
  "      t.jsx(RM0781StackedLabel,{active:status,labels:labels})),",
  "  ]);",
  "}",
  "function RM0781DetailConnect(props){",
  "  const{disabled,installMode,onAction,state}=props;",
  "  const labels={",
  "    add:RLocT(\"Connect\",\"连接\"),",
  "    adding:RLocT(\"Connecting…\",\"正在连接…\"),",
  "    remove:installMode===\"team-default\"?RLocT(\"Remove\",\"移除\"):RLocT(\"Uninstall\",\"卸载\"),",
  "    removing:RLocT(\"Removing…\",\"正在移除…\")};",
  "  const variant=state===\"add\"||state===\"adding\"?RM0781DetailButtonPrimary:RM0781DetailButtonSecondary;",
  "  return t.jsx(\"button\",{className:variant,disabled:disabled,onClick:onAction,type:\"button\",",
  "    \"data-sentiment\":\"neutral\",\"data-size\":\"lg\",",
  "    \"data-variant\":state===\"add\"||state===\"adding\"?\"primary\":\"secondary\"},",
  "    t.jsx(\"span\",{className:RM0781DetailButtonLabelClasses},",
  "      t.jsx(RM0781StackedLabel,{active:state,labels:labels})));",
  "}",
  "function RM0781DetailManagedButton(props){",
  "  const{mode}=props;",
  "  const label=mode===\"team-required\"",
  "    ?RLocT(\"Managed by your team\",\"由你的团队管理\")",
  "    :RLocT(\"Added by your team\",\"由你的团队添加\");",
  "  return t.jsx(\"button\",{className:RM0781DetailButtonTertiary,disabled:true,type:\"button\",",
  "    \"data-sentiment\":\"neutral\",\"data-size\":\"lg\",\"data-variant\":\"tertiary\"},",
  "    t.jsx(\"span\",{className:RM0781DetailButtonLabelClasses,children:label}));",
  "}",
  "function RM0781DetailActions(props){",
  "  const{entry,installedPlugin,installedServer,installMode,isAddPending,isBusy,onAdd,onUninstall,onUninstallPlugin}=props;",
  "  const installed=installMode!=null;",
  "  const state=!installed?(isAddPending?\"adding\":\"add\"):(isBusy?\"removing\":\"remove\");",
  "  const onAction=()=>{",
  "    if(!installed){onAdd(entry);return;}",
  "    installedPlugin!=null?onUninstallPlugin?.(installedPlugin.pluginId):installedServer!=null&&onUninstall(installedServer.id);",
  "  };",
  "  const children=[];",
  "  if(installMode===\"team-required\"||installMode===\"team-default\"){",
  "    children.push(t.jsx(RM0781DetailManagedButton,{mode:installMode}));",
  "  }",
  "  children.push(t.jsx(RM0781DetailShare,{entry:entry}));",
  "  if(installMode!==\"team-required\"){",
  "    children.push(t.jsx(RM0781DetailConnect,{disabled:isBusy,installMode:installMode,onAction:onAction,state:state}));",
  "  }",
  "  return t.jsx(\"div\",{className:RM0781DetailActionsClasses,children:children});",
  "}",
  "function RM0781DetailCard(props){",
  "  const{cardClassName,items,label,noun}=props;",
  "  const[expanded,setExpanded]=C.useState(false);",
  "  const cardId=C.useId();",
  "  if(items==null||items.length===0)return null;",
  "  const nounLabel=noun===\"connector\"?RLocT(\"Connector\",\"连接器\"):RLocT(\"Skill\",\"技能\");",
  "  const shown=expanded?items:items.slice(0,5);",
  "  const hidden=items.length-shown.length;",
  "  const header=t.jsxs(\"div\",{className:RM0781DetailCardHeaderClasses,children:[",
  "    t.jsx(me,{as:\"h3\",color:\"primary\",size:\"sm\",children:label}),",
  "    t.jsx(me,{as:\"span\",className:RM0781DetailCardCountClasses,size:\"sm\",children:items.length}),",
  "  ]});",
  "  const rows=shown.map(item=>t.jsxs(\"div\",{className:RM0781DetailCardRowClasses,key:item.name,children:[",
  "    t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0781DetailCardGlyphClasses},",
  "      t.jsx(ue,{\"aria-hidden\":true,name:noun===\"connector\"?\"plug\":\"cube\",size:16})),",
  "    t.jsxs(\"span\",{className:RM0781DetailCardItemClasses,children:[",
  "      t.jsx(\"span\",{className:RM0781DetailCardItemNameClasses,children:item.name}),",
  "      t.jsx(\"span\",{className:RM0781DetailCardItemDescClasses,title:item.description,",
  "        children:item.description!=null&&item.description.length>0?item.description:nounLabel}),",
  "    ]}),",
  "  ]}));",
  "  const more=hidden>0?t.jsx(\"button\",{\"aria-controls\":cardId,\"aria-expanded\":false,",
  "    className:RM0781DetailCardMoreClasses,onClick:()=>setExpanded(true),type:\"button\"},",
  "    t.jsx(\"span\",{className:RM0781DetailValueClasses,children:RLocT(hidden+\" more\",\"另外 \"+hidden+\" 个\")})):null;",
  "  const body=t.jsxs(\"div\",{className:cardClassName+\" \"+(hidden>0?RM0781DetailCardClassesMore:RM0781DetailCardClasses),",
  "    id:cardId,children:[rows,more]});",
  "  return t.jsxs(\"div\",{children:[header,body]});",
  "}",
  "function RM0781DetailSmallSecondaryButton(props){",
  "  const{children,disabled,onClick}=props;",
  "  return t.jsx(\"button\",{",
  "    \"data-size\":\"sm\",",
  "    \"data-variant\":\"secondary\",",
  "    className:RM0781DetailSmallSecondaryButtonClasses,",
  "    disabled:disabled,",
  "    onClick:onClick,",
  "    tabIndex:0,",
  "    type:\"button\",",
  "    children:children,",
  "  });",
  "}",
  "function RM0781DetailToolSwitch(props){",
  "  const{isChecked,label,onToggle}=props;",
  "  const on=isChecked===true;",
  "  return t.jsx(\"button\",{",
  "    \"aria-checked\":on,",
  "    \"aria-label\":label,",
  "    children:t.jsx(\"span\",{\"aria-hidden\":true,className:on?RM0781DetailKnobOn:RM0781DetailKnobOff}),",
  "    className:on?RM0781DetailSwitchOn:RM0781DetailSwitchOff,",
  "    onClick:()=>onToggle(!on),",
  "    role:\"switch\",",
  "    type:\"button\",",
  "  });",
  "}",
  "function RM0781DetailsList(props){",
  "  const{label,rows}=props;",
  "  const head=t.jsx(me,{as:\"h3\",className:RM0781DetailSectionLabelClasses,color:\"tertiary\",size:\"sm\",children:label});",
  "  const body=t.jsx(\"dl\",{className:RM0781DetailListClasses,children:rows.map(row=>t.jsxs(\"div\",{className:RM0781DetailRowClasses,key:row.term,children:[",
  "    t.jsx(\"dt\",{className:RM0781DetailTermClasses,children:row.term}),",
  "    t.jsx(\"dd\",{className:RM0781DetailValueClasses,title:row.value==null?undefined:row.value,",
  "      children:row.value==null?\"\\u2014\":row.value}),",
  "  ]}))});",
  "  return t.jsxs(\"div\",{children:[head,body]});",
  "}",
].join("\n");

/**
 * The injected source, normalized to the chunk's own jsx convention.
 *
 * Upstream 0.18's chunk calls React through the AUTOMATIC runtime, so `t.jsx(type, props, child)`
 * consumes the child as the KEY and renders an empty element. The helper moves every classic
 * third-argument child into the props object; without it the port's buttons lose their labels.
 */
const NORMALIZED_INJECTED_SOURCE = normalizeJsxChildren(INJECTED_SOURCE);

/** The detail-view swaps, exported so the regression test can build a matching synthetic chunk. */
export const MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS = REPLACEMENTS;

/** The injected source, exported so the regression test can parse it on its own. */
export const MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE = NORMALIZED_INJECTED_SOURCE;

/**
 * Replaces one anchor, exactly the number of times the entry declares.
 *
 * An anchor that is missing, or that occurs a different number of times than the entry declares,
 * fails the patch: a patch that cannot identify its site must not run.
 */
function replaceExactly(source, before, after, label, occurrences) {
  const count = source.split(before).length - 1;
  if (count === 0) throw new Error(`Original renderer marketplace detail view anchor is missing: ${label}`);
  if (count !== occurrences) {
    throw new Error(`Original renderer marketplace detail view anchor is ambiguous: ${label}`);
  }
  return source.split(before).join(after);
}

/** Applies official 0.78.1's plugin detail page to upstream 0.18's plugins chunk. */
export function patchMarketplaceDetailView0781(source) {
  let patched = source;
  for (const { label, before, after, occurrences } of REPLACEMENTS) {
    patched = replaceExactly(patched, before, after, label, occurrences ?? 1);
  }
  patched = `${patched}\n${NORMALIZED_INJECTED_SOURCE}\n`;
  return patched;
}

export async function applyMarketplaceDetailView0781({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assets)) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(path.join(assets, name), "utf8");
    if (source.includes('k("sand-plugins__bar"')) candidates.push({ name, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Marketplace detail view patch: expected one plugins chunk, found ${candidates.length}.`);
  }
  const { name, source } = candidates[0];
  const patched = patchMarketplaceDetailView0781(source);
  // Fail closed: the rewritten chunk must still parse as a module.
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  await writeFile(path.join(assets, name), patched);
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const provenance = {
    mode: "marketplace-detail-view-0781",
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
    officialMessageIds: Object.values(MARKETPLACE_DETAIL_VIEW_0781_MESSAGES).map((message) => ({
      id: message.id,
      en: message.en,
      zh: message.zh,
    })),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-detail-view-0781.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Marketplace detail view: official 0.78.1 plugin detail page added (${name}).`);
  return provenance;
}
