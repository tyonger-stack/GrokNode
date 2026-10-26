/**
 * Official Grok Bot 0.75.8 wording for upstream 0.18's own plugins surface.
 *
 * ## What this patches
 *
 * `view-B5Ug8wEm.js` is upstream 0.18's genuine "连接应用" implementation — the same component
 * official 0.75.8 ships, one generation earlier. This patch ports the *wording* of official
 * 0.75.8's version of that component onto upstream 0.18's code, so the surface reads exactly like
 * the official build instead of a mix of English and 0.18-era Chinese.
 *
 * It does NOT re-implement the surface: every replacement is a literal swap inside upstream's own
 * code, anchored on an exact string that must occur exactly once.
 *
 * ## Why it runs AFTER the i18n passes
 *
 * `scripts/lib/extra-i18n-patch.mjs` rewrites English literals into `(RLocT("English","中文"))`
 * runtime calls. Two of the strings below are already localised by that pass ("Installed" → 已安装,
 * "Plugins" → 插件, "Private" → 私密), so this patch anchors on the POST-i18n text. Anchoring on
 * the pre-i18n text would either miss or collide with the i18n pass.
 *
 * The `(RLocT(...))` form is preserved wherever the original was localised, so the language
 * preference still switches these strings at runtime.
 *
 * ## Every Chinese string below is official 0.75.8's own
 *
 * Taken from the official 0.75.8 build's zh-Hans locale table
 * (`rea-grokbot-0758/app/dist/renderer/assets/chunk-core-DtHSUFHD.js`), message id in brackets:
 *
 *   h8AWBN  连接应用                    — the dialog title
 *   E6HC8r  已连接 # 个                 — the installed-apps tab label
 *   glMsdy  私有技能                    — the private-skills section title
 *   Wy8KR2  显示全部 # 个插件            — the "show all" button
 *   ZyWE2h  尚未安装任何插件。请在市场中查找插件。
 *   +Pji+h  没有已安装的插件匹配“#”
 *   hvwZWn  没有私有技能匹配“#”
 *   RmL2Fy  打开一个 Bot 以查看其私有技能
 *   mLyVIn  没有插件匹配“#”
 *   d5N5Il  # 个连接器
 *   m+pG3Q  # 项技能
 *   MKRcMS  # 个命令
 *   31tnaC  无可用内容
 *
 * and the English labels upstream 0.18 left in this surface:
 *
 *   hp8OtS  已添加       — the "Added" badge on an installed plugin row
 *   cQpGeE  连接器       — the "Connectors" type-filter option
 *   Hc3Gxt  插件配置     — the plugin setup dialog title
 *   xdA/+p  工具         — the plugin detail's tools section
 *   bv4cFj  传输方式     — the plugin detail's transport term
 *   sjVfrA  命令         — the stdio transport label
 *   HMUxPu  查看源码     — the "View Source" link
 *   y1eoq1  复制链接     — the copy-link button
 *   6V3Ea3  已复制       — the copy-link success state
 *   9sj0G8  复制失败     — the copy-link failure state
 *   N2FcBE  已同步       — the "Synced" badge
 *   q1LJYo  由你的团队管理 — the team-required plugin badge
 *   MoPMW6  由你的团队添加 — the team-default plugin badge
 *   kx0s+n  结果         — the search results section
 *   mLyVIn  没有插件匹配“ — the browse page no-match state
 *   PaQ3df  启用         — the skill enable action
 *
 * Strings official 0.75.8 does not have at all (`All types`, `Ownership`, `Filter plugins`,
 * `N of M enabled`, `Used by N teammates`) stay English on purpose: there is no official wording
 * to port, and inventing one would break the evidence rule.
 *
 * @evidence official 0.75.8 `chunk-view-Bl5Kz6YC.js` — the manage page reads
 *   `de=M({id:'eQkgKV'})` (已安装), `pe=M({id:'glMsdy'})` (私有技能), `M({id:'Wy8KR2',values:{0:n.length}})`
 *   (显示全部 N 个插件) and the counts come from `d5N5Il` / `m+pG3Q`.
 * @evidence official 0.75.8 `chunk-core-DtHSUFHD.js` — the zh-Hans values quoted above.
 */

const REPLACEMENTS = [
  {
    label: "dialog aria-label",
    before: 'jsx(Xa,{"aria-label":(RLocT("Plugins","插件"))',
    after: 'jsx(Xa,{"aria-label":(RLocT("Plugins","连接应用"))',
    official: "h8AWBN",
  },
  {
    label: "dialog title",
    before: 't.jsx(sl,{headingId:a,title:(RLocT("Plugins","插件"))})',
    after: 't.jsx(sl,{headingId:a,title:(RLocT("Plugins","连接应用"))})',
    official: "h8AWBN",
  },
  {
    label: "dialog shell class recipe",
    before: 'k("sand-plugins-dialog","sand-1gys7z3 sand-w7nakj sand-1717udv")',
    after: 'k("sand-plugins-dialog","sand-h6vr4k sand-1a2e76q sand-1gy1zxj sand-1717udv sand-xrbq2n sand-1da2sx9 sand-5vqeur sand-1e6nqfh")',
    official: "0.75.8 chunk-view Ms @ 162251",
  },
  {
    label: "dialog layout class recipe",
    before: 'k("sand-plugins-layout","sand-9f619 sand-1n2onr6 sand-78zum5 sand-dt5ytf sand-1bwblxx sand-2lwn1j")',
    after: 'k("sand-plugins-layout","sand--default-marker sand-9f619 sand-1n2onr6 sand-78zum5 sand-dt5ytf sand-z03ioa sand-2lwn1j sand-7giv3")',
    official: "0.75.8 chunk-view Ms @ 162472",
  },
  {
    label: "installed-apps tab label",
    before: 't.jsx(Os.Item,{value:"yours",children:"Yours"})',
    after: 't.jsx(Os.Item,{value:"yours",children:RLocT(St.length+" connected","已连接 "+St.length+" 个")})',
    official: "E6HC8r",
  },
  {
    label: "private skills section title",
    before: 'title:(RLocT("Private","私密"))',
    after: 'title:(RLocT("Private","私有技能"))',
    official: "glMsdy",
  },
  {
    label: "show all button",
    before: "hiddenLabel:`Show all ${U.length} plugins`",
    after: 'hiddenLabel:RLocT("Show all "+U.length+" plugins","显示全部 "+U.length+" 个插件")',
    official: "Wy8KR2",
  },
  {
    label: "installed empty state",
    before: 'q?`No installed plugins match "${$}"`:"Nothing installed yet. Find plugins in the Marketplace tab."',
    after: 'q?RLocT("No installed plugins match \\""+$+"\\"","没有已安装的插件匹配“"+$+"”"):RLocT("Nothing installed yet. Find plugins in the marketplace.","尚未安装任何插件。请在市场中查找插件。")',
    official: "+Pji+h / ZyWE2h",
  },
  {
    label: "browse page no-match state",
    before: 'if(n.isFilterActive)return"No plugins match the current filters";',
    after: 'if(n.isFilterActive)return RLocT("No plugins match \\""+n.query.trim()+"\\"","没有插件匹配“"+n.query.trim()+"”");',
    official: "mLyVIn",
  },
  {
    label: "manage page empty state",
    before: 'children:"No plugins match the current filters"',
    after: 'children:q?RLocT("No installed plugins match \\""+$+"\\"","没有已安装的插件匹配“"+$+"”"):RLocT("Nothing installed yet. Find plugins in the marketplace.","尚未安装任何插件。请在市场中查找插件。")',
    official: "+Pji+h / ZyWE2h",
  },
  {
    label: "private skills empty state",
    before: 'q?`No private skills match "${$}"`',
    after: 'q?RLocT("No private skills match \\""+$+"\\"","没有私有技能匹配“"+$+"”")',
    official: "hvwZWn",
  },
  {
    label: "private skills unavailable state",
    before: 'children:"Open an agent to see its private skills"',
    after: 'children:RLocT("Open a Bot to see its private skills","打开一个 Bot 以查看其私有技能")',
    official: "RmL2Fy",
  },
  {
    label: "connector / skill / command counts",
    before: "function us(n,e){return`${n} ${n===1?e:`${e}s`}`}",
    after: 'function us(n,e){return RLocT(`${n} ${n===1?e:`${e}s`}`,`${n} ${e==="connector"?"个连接器":e==="skill"?"项技能":e==="command"?"个命令":e}`)}',
    official: "d5N5Il / m+pG3Q / MKRcMS",
  },
  {
    label: "browse section overflow button",
    before: "ot,{hiddenLabel:`Show ${h} more`,onShowAll:()=>o(!0)}",
    after: 'ot,{hiddenLabel:RLocT("Show "+h+" more","查看全部"),onShowAll:()=>o(!0)}',
    official: "N6Pxr9",
  },
  {
    label: "category section title",
    before: "key:`category:${n.category}`,title:n.category}",
    after: "key:`category:${n.category}`,title:RcMarketplaceCategoryLabel(n.categoryKey)||n.category}",
    official: "chunk-plugins-model category key map (0.75.8)",
  },
  {
    label: "featured section stays first",
    before: "function Rl(n,e){return n===e?0:n===_n?-1:e===_n?1:n.localeCompare(e)}",
    after: 'function Rl(n,e){const t=RcMarketplaceCategoryLabel("FEATURED");return n===e?0:n===t?-1:e===t?1:n.localeCompare(e)}',
    official: "chunk-plugins-model category key map (0.75.8)",
  },
  // ---------------------------------------------------------------------
  // The English labels upstream 0.18 left in this surface. Every Chinese below is
  // official 0.75.8's own zh-Hans entry; each anchor occurs exactly once in the chunk.
  // ---------------------------------------------------------------------
  {
    label: "marketplace row added badge",
    before: 'name:"check",size:12}),"Added"',
    after: 'name:"check",size:12}),RLocT("Added","已添加")',
    official: "hp8OtS",
  },
  {
    label: "type filter option",
    before: '{value:"connectors",label:"Connectors"}',
    after: '{value:"connectors",label:RLocT("Connectors","连接器")}',
    official: "cQpGeE",
  },
  {
    label: "plugin setup dialog title",
    before: 'const Ql="Plugin Setup",at=',
    after: 'const Ql=RLocT("Plugin Setup","插件配置"),at=',
    official: "Hc3Gxt",
  },
  {
    label: "plugin detail tools section",
    before: 'p="Tools",',
    after: 'p=RLocT("Tools","工具"),',
    official: "xdA/+p",
  },
  {
    label: "plugin detail transport term",
    before: '{term:"Transport",value:M}',
    after: '{term:RLocT("Transport","传输方式"),value:M}',
    official: "bv4cFj",
  },
  {
    label: "stdio transport label",
    before: 'stdio:"Command"}',
    after: 'stdio:RLocT("Command","命令")}',
    official: "sjVfrA",
  },
  {
    label: "view source link",
    before: 'children:["View Source",',
    after: 'children:[RLocT("View Source","查看源码"),',
    official: "HMUxPu",
  },
  {
    label: "copy link button",
    before: 'let z="Copy link";',
    after: 'let z=RLocT("Copy link","复制链接");',
    official: "y1eoq1",
  },
  {
    label: "copy link states",
    before: 'N==="copied"?z="Copied":N==="error"&&(z="Copy failed")',
    after: 'N==="copied"?z=RLocT("Copied","已复制"):N==="error"&&(z=RLocT("Copy failed","复制失败"))',
    official: "6V3Ea3 / 9sj0G8",
  },
  {
    label: "synced badge",
    before: ',"Synced"]',
    after: ',RLocT("Synced","已同步")]',
    official: "N2FcBE",
  },
  {
    label: "team-required badge",
    before: 'case"team-required":return"Managed by your team";',
    after: 'case"team-required":return RLocT("Managed by your team","由你的团队管理");',
    official: "q1LJYo",
  },
  {
    label: "team-default badge",
    before: 'case"team-default":return"Added by your team";',
    after: 'case"team-default":return RLocT("Added by your team","由你的团队添加");',
    official: "MoPMW6",
  },
  {
    label: "search results section",
    before: 'category:"Results"',
    after: 'category:RLocT("Results","结果")',
    official: "kx0s+n",
  },
  {
    label: "browse page no-match state (non-filter branch)",
    before: '?`No plugins match "${e}"`:',
    after: '?RLocT("No plugins match \\""+e+"\\"","没有插件匹配“"+e+"”"):',
    official: "mLyVIn",
  },
  {
    label: "skill enable action",
    before: "`Enable ${H.name}`",
    after: 'RLocT("Enable "+H.name,"启用 "+H.name)',
    official: "PaQ3df",
  },
];

/**
 * Official 0.75.8's category labels, keyed by the SAME upstream category keys this build's
 * catalog already carries (`categoryKey`: FEATURED, PRODUCTIVITY, …).
 *
 * The Chinese text is official's own — taken from the official 0.75.8 zh-Hans locale table
 * (`chunk-core-DtHSUFHD.js`) through official's own category-key map
 * (`chunk-plugins-model-DeyTkJ2l.js`). The English side is official's too, so the labels follow
 * the language preference like the rest of the app instead of being Chinese in every locale:
 *
 *   FEATURED FkMol5 精选              DATA_ANALYTICS svH45G 数据与分析
 *   INFRASTRUCTURE Mo77P4 基础设施     PRODUCTIVITY N42ane 效率
 *   PAYMENTS H0ShEF 支付               AGENT_ORCHESTRATION byAjqm 智能体编排
 *   CANVAS Zty/IJ 画布                 INBOX_AND_COLLABORATION IzFMeN 收件箱与协作
 *   SCHEDULING DbZMYM 日程安排         DOCUMENTS_AND_FILES gDShYL 文档与文件
 *   SALES mUv9U4 销售                  CUSTOMER_SUPPORT n+xLOH 客户支持
 *   FINANCE_AND_LEGAL hxm6On 财务与法务  RESEARCH bdztP2 研究
 *   DESIGN f8fH8W 设计                 MARKETING vo2a+a 营销
 *   LOGIN_AND_CREDENTIAL_MANAGEMENT P+nzjE 密码管理器
 */
const CATEGORY_LABEL_HELPER = `function RcMarketplaceCategoryLabel(e){switch(e){case"FEATURED":return RLocT("Featured","精选");case"INFRASTRUCTURE":return RLocT("Infrastructure","基础设施");case"DATA_ANALYTICS":return RLocT("Data & Analytics","数据与分析");case"PRODUCTIVITY":return RLocT("Productivity","效率");case"PAYMENTS":return RLocT("Payments","支付");case"AGENT_ORCHESTRATION":return RLocT("Agent Orchestration","智能体编排");case"CANVAS":return RLocT("Canvas","画布");case"INBOX_AND_COLLABORATION":return RLocT("Inbox and Collaboration","收件箱与协作");case"SCHEDULING":return RLocT("Scheduling","日程安排");case"DOCUMENTS_AND_FILES":return RLocT("Documents and Files","文档与文件");case"SALES":return RLocT("Sales","销售");case"CUSTOMER_SUPPORT":return RLocT("Customer Support","客户支持");case"FINANCE_AND_LEGAL":return RLocT("Finance and Legal","财务与法务");case"RESEARCH":return RLocT("Research","研究");case"DESIGN":return RLocT("Design","设计");case"MARKETING":return RLocT("Marketing","营销");case"LOGIN_AND_CREDENTIAL_MANAGEMENT":return RLocT("Password Managers","密码管理器");default:return null}}`;

/**
 * Publishes upstream's own locale runtime for the replica panels mounted into this chunk.
 *
 * `scripts/lib/port-0750-renderer-patch.mjs` injects two Grok Node replica components into this
 * chunk — the effective-plugins list and the custom-MCP form. Their wording is official 0.75.8's
 * (see `frontend/src/i18n/official-marketplace-copy.ts`), and the locale decision must stay
 * upstream's, so the i18n passes' `function RLocT(en, zh)` is published as
 * `globalThis.__sandRLocT` for them to call.
 *
 * `typeof RLocT` is used deliberately: if a build mode ever leaves the runtime out, the publish
 * stores `undefined` instead of throwing, and the replica falls back to English.
 */
const LOCALE_RUNTIME_PUBLISH = 'globalThis.__sandRLocT=typeof RLocT==="function"?RLocT:undefined;';

/** Official's category labels, exported so the regression test can check each one. */
export const MARKETPLACE_CATEGORY_LABELS = CATEGORY_LABEL_HELPER;

/**
 * Every wording swap this patch makes, exported so the regression test can check each one against
 * the captured official locale instead of trusting the strings in this file.
 */
export const MARKETPLACE_WORDING_REPLACEMENTS = REPLACEMENTS;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Original renderer marketplace wording anchor is missing: ${label}`);
  if (source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer marketplace wording anchor is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/** Applies official 0.75.8's marketplace wording to upstream 0.18's plugins chunk. */
export function patchMarketplaceOfficialWording(source) {
  let patched = source;
  for (const { label, before, after } of REPLACEMENTS) {
    patched = replaceExactlyOnce(patched, before, after, label);
  }
  // The category-label helper is a function DECLARATION, so it is hoisted to the module scope and
  // is callable from the rewritten `El`/`Rl` above even though it is appended after the export
  // statement. Appending is what keeps the rest of the chunk byte-identical to upstream's.
  patched = `${patched}\n${CATEGORY_LABEL_HELPER}\n`;
  // The i18n passes append the `RLocT` runtime to this chunk; publish it so the replica panels
  // mounted here resolve official's wording the same way the rest of the app does.
  if (patched.includes("function RLocT(")) patched = `${patched}${LOCALE_RUNTIME_PUBLISH}\n`;
  return patched;
}

/** The chunk this patch owns. */
export const MARKETPLACE_WORDING_CHUNK = "view-B5Ug8wEm.js";

/** A stable pre-patch marker: the chunk's own plugin-dialog class recipe. */
const CHUNK_MARKER = 'k("sand-plugins-dialog"';

export async function applyOriginalRendererMarketplaceOfficialWording({ stageRoot }) {
  const { readdir, readFile, writeFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const path = (await import("node:path")).default;
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(CHUNK_MARKER) && source.includes("sand-plugins__yours")) candidates.push({ file, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Marketplace wording patch: expected one plugins chunk, found ${candidates.length}.`);
  }
  const { file, source } = candidates[0];
  const patched = patchMarketplaceOfficialWording(source);
  await writeFile(path.join(assets, file), patched);
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const provenance = {
    mode: "marketplace-official-wording",
    referenceVersion: "0.75.8",
    file,
    files: [{ file, originalSha256: sha256(source), patchedSha256: sha256(patched) }],
    features: REPLACEMENTS.map((entry) => entry.label),
    officialMessageIds: REPLACEMENTS.map((entry) => entry.official),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-official-wording.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log(`Marketplace wording: ported official 0.75.8 strings (${file}).`);
  return provenance;
}
