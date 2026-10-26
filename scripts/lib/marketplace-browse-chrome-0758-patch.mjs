/**
 * Official Grok Bot 0.75.8's browse-page chrome, ported into upstream 0.18's plugins view.
 *
 * ## What official 0.75.8's browse page looks like (and why 0.18's does not)
 *
 * Official 0.75.8 (screenshot, 2026-10-26):
 *
 *   连接应用                                  … [icon stack] 已连接 25 个 ›
 *   [ 在应用和技能中搜索………………………… ]  [ Bot 模板 ↗ ]
 *   [全部] [密码管理器] [效率] [通信] [设计] [代码] [更多 ⌄]
 *   为你推荐                                        查看全部
 *   …
 *
 * Upstream 0.18 ships the same plugins dialog one generation earlier, but its browse page still has
 * the older chrome: a two-item segmented control (市场 / 已连接 N 个), a narrow search field on the
 * right of the toolbar, and no category chips at all. Everything else — the two-column plugin
 * cards, the category sections, the 添加 / 已添加 actions, the per-plugin counts — already matches
 * official, because those are the same components.
 *
 * ## What this patch ports
 *
 * 1. **The category chip row** — official's `Pi` component (`chunk-view-Bl5Kz6YC.js`), which shows
 *    the 全部 chip, the first five categories, and a 更多 dropdown with the rest. It filters the
 *    browse sections by category, exactly like official.
 * 2. **The "connected apps" header entry** — official's icon stack + `已连接 N 个` + chevron, which
 *    opens the installed view. It replaces 0.18's segmented control (official has no tabs there).
 * 3. **The search placeholder** — official's `ApxUA3` "在应用和技能中搜索" / "Search across apps and
 *    skills", instead of 0.18's "搜索插件".
 *
 * The category model is official's own (`chunk-marketplace-browse-model-DZZc6njJ.js`): the canonical
 * chip order, the upstream-category-key → chip mapping, and each chip's official message id.
 *
 * ## Everything here is official's
 *
 * * the chip component's class recipes are official's `Ni.chip` / `Ni.chipSelected` / group recipe,
 *   merged with official's `Oe.body2` typography recipe — copied verbatim;
 * * the three class recipes 0.18 does not ship are lifted byte-for-byte from official's own
 *   stylesheet (`marketplace-browse-chrome-0758-official.css`);
 * * the header entry's recipes are official 0.66's own (already lifted in this repo for the
 *   replica's dock pill — `frontend/src/extensions/marketplace/official-styles.ts`);
 * * the chip labels are official's locale entries.
 *
 * @evidence official 0.75.8 `chunk-view-Bl5Kz6YC.js` — `Pi` (the chip row) and the plugins view.
 * @evidence official 0.75.8 `chunk-marketplace-browse-model-DZZc6njJ.js` — the category model.
 * @evidence official 0.75.8 `chunk-plugins-model-DeyTkJ2l.js` — the upstream category keys.
 * @evidence official 0.75.8 `index-CFSAhbDS.css` — the three rules 0.18 lacks.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

/** The chunk this patch owns: upstream 0.18's plugins view. */
export const MARKETPLACE_BROWSE_CHROME_CHUNK = "view-B5Ug8wEm.js";

/** Official's chip model, ported from `chunk-marketplace-browse-model-DZZc6njJ.js`. */
const OFFICIAL_CHIP_ORDER = [
  "credentials", "productivity", "communication", "design", "code",
  "data", "sales", "marketing", "finance", "research", "support",
];

/** Official's upstream-category-key → chip mapping (`x` in the browse model). */
const OFFICIAL_CHIP_BY_UPSTREAM_KEY = {
  LOGIN_AND_CREDENTIAL_MANAGEMENT: "credentials",
  PRODUCTIVITY: "productivity",
  INBOX_AND_COLLABORATION: "communication",
  SCHEDULING: "communication",
  SALES: "sales",
  MARKETING: "marketing",
  CUSTOMER_SUPPORT: "support",
  PAYMENTS: "finance",
  FINANCE_AND_LEGAL: "finance",
  DATA_ANALYTICS: "data",
  DESIGN: "design",
  CANVAS: "design",
  DOCUMENTS_AND_FILES: "productivity",
  INFRASTRUCTURE: "code",
  RESEARCH: "research",
};

/**
 * Official's chip labels: the message id it uses, and the official zh-Hans text that id carries.
 * (English text is official's too.)
 */
const OFFICIAL_CHIP_LABELS = {
  credentials: ["P+nzjE", "Password Managers", "密码管理器"],
  productivity: ["N42ane", "Productivity", "效率"],
  communication: ["hZotg6", "Communication", "通信"],
  design: ["f8fH8W", "Design", "设计"],
  code: ["EWPtMO", "Code", "代码"],
  data: ["HKH+W+", "Data", "数据"],
  sales: ["mUv9U4", "Sales", "销售"],
  marketing: ["vo2a+a", "Marketing", "营销"],
  finance: ["8V6XO3", "Finance", "财务"],
  research: ["bdztP2", "Research", "研究"],
  support: ["XYLcNv", "Support", "支持"],
};

const REPLACEMENTS = [
  {
    label: "chip filter state",
    before: '[p,x]=C.useState("marketplace"),[m,I]=C.useState(""),[v,P]=C.useState(qn),[j,S]=C.useState(qn),',
    after: '[p,x]=C.useState("marketplace"),[m,I]=C.useState(""),[v,P]=C.useState(qn),[j,S]=C.useState(qn),[RM0758Category,RM0758SetCategory]=C.useState(null),',
  },
  {
    label: "marketplace items filtered by the selected chip",
    before:
      "let Ge;if(e[13]!==Q||e[14]!==v||e[15]!==m){let u;e[17]!==v?(u=D=>nt(D,v),e[17]=v,e[18]=u):u=e[18]," +
      "Ge=Pl(Q,m).filter(u),e[13]=Q,e[14]=v,e[15]=m,e[16]=Ge}else Ge=e[16];",
    after:
      "let Ge;if(e[13]!==Q||e[14]!==v||e[15]!==m||e[900]!==RM0758Category){let u;e[17]!==v?(u=D=>nt(D,v),e[17]=v,e[18]=u):u=e[18]," +
      "Ge=Pl(Q,m).filter(u).filter(u=>RM0758Category==null||RM0758ChipOf(u).indexOf(RM0758Category)>=0)," +
      "e[13]=Q,e[14]=v,e[15]=m,e[16]=Ge,e[900]=RM0758Category}else Ge=e[16];",
  },
  {
    label: "segmented control replaced by official's connected-apps entry",
    before:
      't.jsxs(Os,{"aria-label":"Plugins view",onValueChange:u=>x(u==="yours"?"yours":"marketplace"),size:"lg",value:p,variant:"compact",' +
      'children:[t.jsx(Os.Item,{value:"marketplace",children:(RLocT("Marketplace","市场"))}),' +
      't.jsx(Os.Item,{value:"yours",children:RLocT(St.length+" connected","已连接 "+St.length+" 个")})]})',
    after: 't.jsx(RM0758InstalledEntry,{count:St.length,logos:RM0758Logos(St),onOpen:()=>x("yours")})',
  },
  {
    label: "official's category chip row",
    before: 'spellCheck:!1,type:"text",value:m})]})]})]})]}),e[57]=Ts,',
    after:
      'spellCheck:!1,type:"text",value:m})]})]})]}),' +
      't.jsx(RM0758Chips,{categories:RM0758ChipList(Q),selectedKey:RM0758Category,onSelect:u=>RM0758SetCategory(u)})' +
      ']}),e[57]=Ts,',
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
];

/**
 * The injected source. It lives in the chunk's module scope, so it can use the chunk's own
 * `t` (jsx runtime), `C` (react), `re` (the dropdown-menu kit upstream's filter uses) and `ue`
 * (the icon component) — exactly the components official's chip row uses.
 *
 * The class recipes are official's `Ni.chip` / `Ni.chipSelected` / group recipe merged with
 * official's `Oe.body2` typography recipe. Official merges the recipes with stylix's `J()`, which
 * resolves conflicts by PROPERTY: the selected chip's background (`kWkggS`) and text colour
 * (`kMwMTN`) replace the base chip's, they do not merely follow it in the class list. The class
 * lists below reproduce that merge, because in 0.18's stylesheet the base rules come *after* the
 * selected ones and would otherwise win.
 */
const INJECTED_SOURCE = [
  "const RM0758ChipBody2=\"sand-11wthnw sand-w8bs97 sand-14gdtuo\";",
  "const RM0758ChipBase=\"sand-jyslct sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-195vfkc sand-2lah0s sand-1fgtraw sand-1awh872 sand-c342km sand-ng3xce sand-149ho13 sand-fwqdrz sand-1n4gmbt sand-tyxrsu sand-jb2p0i sand-uxw1ft sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1wpm9rq\";",
  "const RM0758ChipGroup=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli sand-1x57ub9 sand-dqyycr sand-b3r6kr\";",
  "const RM0758EntryClasses=\"sand-plugins__installed-preview sand-9f619 sand-78zum5 sand-6s0dn4 sand-qcrz7y sand-167g77z sand-euugli sand-1iorvi4 sand-f159sx sand-jkvuk6 sand-135b78x sand-c342km sand-ng3xce sand-1qmwy7c sand-jbqb8w sand-11hyl0l sand-1o0liin sand-jb2p0i sand-1wm8ruf sand-1d3mw78 sand-12oo3zp sand-1ypdohk sand-1t137rt sand-9v5kkp sand-1k57tk5 sand-784prv sand-1uczgqu sand-1wpm9rq\";",
  "const RM0758StackClasses=\"sand-9f619 sand-78zum5 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9\";",
  "const RM0758SlotClasses=\"sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-w4jnvo sand-1qx5ct2 sand-mkeg23 sand-1y0btm7 sand-1lt80kd sand-t9pb60 sand-10e981r sand-b3r6kr\";",
  "const RM0758SlotRestClasses=\"sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-w4jnvo sand-1qx5ct2 sand-mkeg23 sand-1y0btm7 sand-1lt80kd sand-t9pb60 sand-10e981r sand-b3r6kr sand-w01apr\";",
  "const RM0758CountClasses=\"sand-9f619 sand-b3r6kr sand-lyipyv sand-uxw1ft\";",
  "const RM0758IconClasses=\"sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-w4jnvo sand-1qx5ct2 sand-mkeg23 sand-1y0btm7 sand-1lt80kd sand-t9pb60 sand-10e981r sand-b3r6kr\";",
  "const RM0758ImageClasses=\"sand-1lliihq sand-h8yej3 sand-5yr21d sand-l1xv1r\";",
  "const RM0758ChevronClasses=\"sand-9f619 sand-169k319\";",
  "const RM0758ChipOrder=" + JSON.stringify(OFFICIAL_CHIP_ORDER) + ";",
  "const RM0758ChipByUpstreamKey=" + JSON.stringify(OFFICIAL_CHIP_BY_UPSTREAM_KEY) + ";",
  "const RM0758ChipLabels=" + JSON.stringify(
    Object.fromEntries(
      Object.entries(OFFICIAL_CHIP_LABELS).map(([key, [, en, zh]]) => [key, [en, zh]]),
    ),
  ) + ";",
  "function RM0758NormalizeKey(n){return String(n).trim().toUpperCase().replace(/&/g,\" AND \").replace(/[^A-Z0-9]+/g,\"_\").replace(/^_+|_+$/g,\"\");}",
  "function RM0758ChipOf(entry){",
  "  if(entry==null)return[];",
  "  const keys=entry.categoryKeys??(entry.categoryKey===void 0?[entry.category]:[entry.categoryKey]);",
  "  const seen=new Set(),out=[];",
  "  for(const key of keys){",
  "    if(key==null)continue;",
  "    const chip=RM0758ChipByUpstreamKey[RM0758NormalizeKey(key)];",
  "    if(chip===void 0||seen.has(chip))continue;",
  "    seen.add(chip);out.push(chip);",
  "  }",
  "  return out;",
  "}",
  "function RM0758ChipList(catalog){",
  "  const present=new Set();",
  "  for(const entry of catalog)for(const chip of RM0758ChipOf(entry))present.add(chip);",
  "  return RM0758ChipOrder.filter((chip)=>present.has(chip)).map((chip)=>({key:chip,label:RM0758ChipLabels[chip]}));",
  "}",
  "function RM0758ChipClass(selected){",
  "  if(!selected)return RM0758ChipBody2+\" \"+RM0758ChipBase;",
  "  return RM0758ChipBody2+\" \"+RM0758ChipBase.replace(\"sand-fwqdrz sand-1n4gmbt\",\"sand-8rotk8 sand-n4jrjs\").replace(\"sand-tyxrsu\",\"sand-sa7k8x\");",
  "}",
  "function RM0758Chips(props){",
  "  const{categories,selectedKey,onSelect}=props;",
  "  if(categories.length===0)return null;",
  "  const visible=categories.slice(0,5),overflow=categories.slice(5);",
  "  const selectedOverflow=overflow.find((c)=>c.key===selectedKey)??null;",
  "  const all=t.jsx(\"button\",{\"aria-pressed\":selectedKey==null,className:RM0758ChipClass(selectedKey==null),onClick:()=>onSelect(null),type:\"button\"},RLocT(\"All\",\"全部\"));",
  "  const chips=visible.map((c)=>t.jsx(\"button\",{\"aria-pressed\":selectedKey===c.key,className:RM0758ChipClass(selectedKey===c.key),key:c.key,onClick:()=>onSelect(selectedKey===c.key?null:c.key),type:\"button\"},RLocT(c.label[0],c.label[1])));",
  "  const more=overflow.length===0?null:t.jsxs(re,{placement:\"bottom-start\",children:[",
  "    t.jsx(re.Trigger,{children:t.jsxs(\"button\",{\"aria-pressed\":selectedOverflow!=null,className:RM0758ChipClass(selectedOverflow!=null),type:\"button\"},",
  "      selectedOverflow!=null?RLocT(selectedOverflow.label[0],selectedOverflow.label[1]):RLocT(\"More\",\"更多\"),",
  "      t.jsx(ue,{name:\"chevron-down\",size:\"sm\"}))}),",
  "    t.jsx(re.Content,{\"aria-label\":RLocT(\"More categories\",\"更多类别\"),minWidth:200,size:\"md\",children:overflow.map((c)=>",
  "      t.jsx(re.Item,{closeOnSelect:!1,onSelect:()=>onSelect(c.key),trailing:selectedKey===c.key?t.jsx(ue,{name:\"check\",size:\"sm\"}):null,children:RLocT(c.label[0],c.label[1])},c.key))})",
  "  ]});",
  "  return t.jsxs(\"div\",{\"aria-label\":RLocT(\"Plugin categories\",\"插件分类\"),\"data-marketplace-chips\":\"\",role:\"group\",className:RM0758ChipGroup,children:[all,chips,more]});",
  "}",
  "function RM0758Logos(rows){",
  "  const out=[];",
  "  for(const row of rows){",
  "    if(row==null||row.kind!==\"plugin\"||row.entry==null)continue;",
  "    const url=row.entry.iconUrl;",
  "    if(typeof url!==\"string\"||url.length===0)continue;",
  "    out.push({url});",
  "  }",
  "  return out.slice(0,4);",
  "}",
  "function RM0758InstalledEntry(props){",
  "  const{count,logos,onOpen}=props;",
  "  const label=RLocT(count+\" connected\",\"已连接 \"+count+\" 个\");",
  "  const stack=logos.length===0?null:t.jsx(\"span\",{\"aria-hidden\":\"true\",className:RM0758StackClasses},logos.map((logo,index)=>",
  "    t.jsx(\"span\",{className:index>0?RM0758SlotRestClasses:RM0758SlotClasses,key:index},",
  "      t.jsx(\"img\",{alt:\"\",className:RM0758ImageClasses,src:logo.url})))) ;",
  "  return t.jsxs(\"button\",{\"aria-label\":RLocT(\"Your plugins\",\"你的插件\"),className:RM0758EntryClasses,onClick:onOpen,type:\"button\"},",
  "    [stack,t.jsx(\"span\",{className:RM0758CountClasses},label),t.jsx(ue,{name:\"chevron-right\",size:12})]);",
  "}",
].join("\n");

/** The chip-row swaps, exported so the regression test can build a matching synthetic chunk. */
export const MARKETPLACE_BROWSE_CHROME_REPLACEMENTS = REPLACEMENTS;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Original renderer marketplace browse chrome anchor is missing: ${label}`);
  if (source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer marketplace browse chrome anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/** Applies official 0.75.8's browse chrome to upstream 0.18's plugins chunk. */
export function patchMarketplaceBrowseChrome(source) {
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

export async function applyMarketplaceBrowseChrome0758({ stageRoot }) {
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
  const patched = patchMarketplaceBrowseChrome(source);
  // Fail closed: the rewritten chunk must still parse as a module.
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  await writeFile(path.join(assets, name), patched);
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const provenance = {
    mode: "marketplace-browse-chrome-0758",
    referenceVersion: "0.75.8",
    file: `dist/renderer/assets/${name}`,
    originalSha256: sha256(source),
    patchedSha256: sha256(patched),
    features: REPLACEMENTS.map((entry) => entry.label),
    officialChipIds: Object.values(OFFICIAL_CHIP_LABELS).map(([id]) => id),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-browse-chrome-0758.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Marketplace browse chrome: official 0.75.8 chips + connected entry added (${name}).`);
  return provenance;
}
