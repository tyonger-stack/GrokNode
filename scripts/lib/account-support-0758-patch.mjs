// 0.75.8's account menu (CGe) moved the three flat rows About / Help Center /
// Send Feedback into a new Support submenu (OGe) whose first entry is the
// keyboard-shortcuts row. The shortcuts dialog itself is already shipped by the
// search-menu-0753 port (RSMOpenShortcuts, RSMShortcutsHost), so this pass only
// transplants the submenu component and rewires the account menu section that
// renders it. Support sits before Settings, matching the official order.
// The router patch already dropped the Help Center / Send Feedback rows from
// this section (ACCOUNT_MENU_AFTER), so the baseline this pass rewires is the
// post-router children array; About is the only moved row still present.
//
// @evidence rea-grokbot-0758/app/dist/renderer/assets/index.eager-app-BPR02W4s.js
//   OGe @1029237 (support submenu), CGe section @1025168 (children become
//   [update banner, weekly usage, iOS, Support submenu, Settings]); message ids
//   and zh-Hans values in rea-grokbot-0758/shortcuts/evidence.json.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const hash = text => createHash("sha256").update(text).digest("hex");

export const SECTION_CHILDREN_BEFORE = "children:[ee,te,ne,Z,se]";
export const ROUTER_SECTION_CHILDREN_BEFORE = "children:[ee,te,ne,Z,se,Q,ce]";
export const SECTION_CHILDREN_AFTER =
  "children:[ee,te,ne,p.jsx(ROGe0758,{onOpenHelpCenter:Y,onOpenKeyboardShortcuts:RSMOpenShortcuts,onSendFeedback:h.open,onOpenAbout:H}),Z]";

// Transplanted verbatim from official OGe (0.75.8) with only these mappings:
//   - renamed ROGe0758 and dropped the 0.75.8-only `OGe.d=283` metadata line;
//   - (0,Z.c)(35) -> he.c(35); memo slots e[0]..e[34], every guard and slot
//     index kept 1:1 with the official component;
//   - the i18n hook {_:o}=J() -> o=null (stable dep for the guards it feeds)
//     and each o({id:...}) / (0,Y.jsx)(ka,{id:...}) -> the official English
//     literal (ids XYLcNv / KKkUEB / C2SYi+ / 77Emn0 / LDzfVJ / uyJsf6; the
//     repo's i18n passes localize raw literals, never RLocT here);
//   - (0,Y.jsx|jsxs) -> p.jsx|p.jsxs, bT -> It (menu kit), Vt -> bt (icons);
//   - 0.75.8's jsx namespace is Y, so OGe's local `p` (help icon) was free
//     there; in 0.18 `p` is the React jsx namespace and a local `let p` would
//     TDZ-shadow it inside the function body, so the local is renamed Rp;
//   - backtick template literals became plain strings (injected source must
//     not contain backticks);
//   - the three moved labels are additionally inlined at the item children
//     sites (children:"Help Center" and friends): their existing FULL pairs
//     only match display-prop shapes, while the label variables below are
//     assignment shapes that only PANEL reaches. The variables stay computed
//     so every memo slot the official component claims is still written.
export const SUPPORT_SUBMENU_COMPONENT = String.raw`function ROGe0758(e){let t=he.c(35),{onOpenHelpCenter:n,onOpenKeyboardShortcuts:r,onSendFeedback:i,onOpenAbout:a}=e,o=null,s;t[0]===o?s=t[1]:(s="Support",t[0]=o,t[1]=s);let c=s,l,u;t[2]===Symbol.for("react.memo_cache_sentinel")?(l=p.jsx(bt,{name:"book",size:"base"}),u=p.jsx(bt,{color:"tertiary",name:"chevron-right",size:"base"}),t[2]=l,t[3]=u):(l=t[2],u=t[3]);let d;t[4]===c?d=t[5]:(d=p.jsx(It.SubMenuTrigger,{label:c,leading:l,trailing:u,children:c}),t[4]=c,t[5]=d);let f;t[6]===o?f=t[7]:(f="Support options",t[6]=o,t[7]=f);let Rp;t[8]===Symbol.for("react.memo_cache_sentinel")?(Rp=p.jsx(bt,{name:"question-circle",size:"base"}),t[8]=Rp):Rp=t[8];let m;t[9]===Symbol.for("react.memo_cache_sentinel")?(m="Help Center",t[9]=m):m=t[9];let h;t[10]===n?h=t[11]:(h=p.jsx(It.Item,{leading:Rp,onSelect:n,children:"Help Center"}),t[10]=n,t[11]=h);let g;t[12]===Symbol.for("react.memo_cache_sentinel")?(g=p.jsx(bt,{name:"keyboard",size:"base"}),t[12]=g):g=t[12];let _;t[13]===Symbol.for("react.memo_cache_sentinel")?(_="Keyboard shortcuts",t[13]=_):_=t[13];let v;t[14]===r?v=t[15]:(v=p.jsx(It.Item,{leading:g,onSelect:r,children:_}),t[14]=r,t[15]=v);let y;t[16]===Symbol.for("react.memo_cache_sentinel")?(y=p.jsx(bt,{name:"mail",size:"base"}),t[16]=y):y=t[16];let b;t[17]===Symbol.for("react.memo_cache_sentinel")?(b="Send Feedback",t[17]=b):b=t[17];let x;t[18]===i?x=t[19]:(x=p.jsx(It.Item,{leading:y,onSelect:i,children:"Send Feedback"}),t[18]=i,t[19]=x);let S;t[20]===Symbol.for("react.memo_cache_sentinel")?(S=p.jsx(bt,{name:"info",size:"base"}),t[20]=S):S=t[20];let C;t[21]===Symbol.for("react.memo_cache_sentinel")?(C="About",t[21]=C):C=t[21];let w;t[22]===a?w=t[23]:(w=p.jsx(It.Item,{leading:S,onSelect:a,children:"About"}),t[22]=a,t[23]=w);let T;t[24]!==v||t[25]!==x||t[26]!==w||t[27]!==h?(T=p.jsxs(It.Section,{children:[h,v,x,w]}),t[24]=v,t[25]=x,t[26]=w,t[27]=h,t[28]=T):T=t[28];let E;t[29]!==T||t[30]!==f?(E=p.jsx(It.SubMenuContent,{"aria-label":f,minWidth:180,size:"md",children:T}),t[29]=T,t[30]=f,t[31]=E):E=t[31];let D;return t[32]!==E||t[33]!==d?(D=p.jsxs(It.SubMenu,{children:[d,E]}),t[32]=E,t[33]=d,t[34]=D):D=t[34],D}`;

export function patchAccountSupport0758(source) {
  if (source.includes("function ROGe0758(")) throw new Error("Account support patch was already applied.");
  if (!source.includes("function RSMOpenShortcuts")) throw new Error("Account support patch expects the search-menu pass (function RSMOpenShortcuts) to have run first.");
  const hits = source.split(SECTION_CHILDREN_BEFORE).length - 1;
  if (hits !== 1) throw new Error(`Account menu section anchor expected once, found ${hits}.`);
  let patched = source + "\n" + SUPPORT_SUBMENU_COMPONENT;
  patched = patched.replace(SECTION_CHILDREN_BEFORE, SECTION_CHILDREN_AFTER);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export async function applyAccountSupport0758Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter(file => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(SECTION_CHILDREN_BEFORE)) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Account support patch: expected one account-menu chunk, found ${candidates.length}.`);
  const { file, source } = candidates[0];
  const patched = patchAccountSupport0758(source);
  await writeFile(path.join(assets, file), patched);
  console.log(`Account support: 0.75.8 Support submenu transplanted (${file}).`);
  const provenance = {
    mode: "account-support-0758",
    referenceVersion: "0.75.8",
    official: { supportSubmenu: "OGe@1029237", accountMenuSection: "CGe@1025168" },
    file,
    files: [{ file: "dist/renderer/assets/" + file, originalSha256: hash(source), patchedSha256: hash(patched) }],
    features: ["account-menu-support-submenu", "keyboard-shortcuts-menu-entry"],
    applied: [
      { edit: "transplant official OGe as ROGe0758", bindingMaps: ["(0,Z.c)->he.c", "(0,Y.jsx|jsxs)->p.jsx|p.jsxs", "bT->It", "Vt->bt", "i18n hook->literals"] },
      { edit: "menu section children rewire", before: SECTION_CHILDREN_BEFORE, after: SECTION_CHILDREN_AFTER },
    ],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-account-support-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
