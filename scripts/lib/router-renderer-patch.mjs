import { buildBotTemplateRendererExtension } from "./bot-template-renderer-extension.mjs";
import { buildChannelStatusRendererExtension } from "./channel-status-renderer-extension.mjs";
import { buildPluginsDockRendererExtension } from "./plugins-dock-renderer-extension.mjs";
import { buildWebhookCredentialRendererExtension } from "./webhook-credential-renderer-extension.mjs";
import { patchOriginalAutoReviewApproval } from "./auto-review-renderer-patch.mjs";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Router is a Grok Node-local Settings section: unlike General / Usage & Billing it has no
// counterpart in the upstream 0.58 catalogs, so the settings / main i18n patches — which only
// rewrite 0.58-sourced literals — leave both the sidebar entry and the whole panel English no
// matter which locale the Language row resolves to. Bridge both to the same runtime resolver:
//   * the sidebar label guards on `typeof RLocT` because main-i18n-patch appends `RLocT` to this
//     registry chunk *after* this patch runs; function declarations hoist, so the const `wDn`
//     initialiser still sees it at module-init time and degrades to "Router" when it is absent.
//   * the panel uses `RRouterLoc(en,zh)` (defined at the top of COMPONENT_SOURCE), which delegates
//     to the `RLocT` that settings-i18n-patch inserts into the same chunk and falls back to the
//     English source string when that prelude is missing. Both locales then follow the language
//     preference for the rest of Settings, including its reload on a locale flip.
// Brand names (Codex / TokenHub / Grok Bot / Docker / API) keep their English form in zh-CN.
const REGISTRY_BEFORE = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const REGISTRY_AFTER = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"router",label:(typeof RLocT==="function"?RLocT("Router","路由"):"Router"),icon:"git-branch"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const GENERAL_BEFORE = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null';
const GENERAL_AFTER = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):x==="router"?a.jsx(RRouterPanel,{}):null';
const GENERAL_CONTENT_BEFORE = 'children:[d,l,r,i,o]';
const GENERAL_CONTENT_AFTER = 'children:[l,r,i,o]';
const USAGE_BEFORE = 'Z=x==="usage"?a.jsx(Te,{children:a.jsx(Na,{})}):null';
const USAGE_AFTER = 'Z=x==="usage"?a.jsx(Te,{children:a.jsx(RRouterUsage,{})}):null';
const ACCOUNT_MENU_BEFORE = 'xe=p.jsxs(It.Section,{children:[ee,te,ne,Z,se,Q,ce]})';
const ACCOUNT_MENU_AFTER = 'xe=p.jsxs(It.Section,{children:[ee,te,ne,Z,se]})';
const COMPONENT_ANCHOR = 'function Sa(s){';
const COMPONENT_SOURCE = String.raw`
function RRouterLoc(en,zh){try{return RLocT(en,zh)}catch(_e){return en}}
const RRouterProviders=[
  {value:"codex",label:"Codex",description:RRouterLoc("Use your existing ChatGPT sign-in from Codex with Grok Bot's connected plugins.","复用 Codex 中已有的 ChatGPT 登录凭据，并搭配 Grok Bot 已连接的插件。"),kind:"local",localKey:"codex"},
  {value:"openrouter",label:"TokenHub",description:RRouterLoc("Route through your TokenHub account and selected model.","通过你的 TokenHub 账户与所选模型进行路由。"),kind:"key",secret:"OPENROUTER_API_KEY"}
],RRouterOptions=RRouterProviders.map(s=>({value:s.value,label:s.label})),RRouterEmptyUsage={requests:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,lastUsedAt:null},RRouterInputClass="sand-9f619 sand-h8yej3 sand-5f5z56 sand-u97haq sand-lrnmfh sand-uve7l6 sand-16b7oty sand-1rgtt3y sand-o7x2bt sand-mkeg23 sand-1y0btm7 sand-qz0629 sand-1043rbw sand-13l7odt sand-1wd3ewq sand-jb2p0i sand-4z9k3i sand-frs9s4 sand-tt52l0 sand-1odjw0f sand-1t137rt sand-ltfok3";
function RRouterState(){
  const[s,e]=de.useState({provider:"openrouter",usage:null,local:null,error:null});
  de.useEffect(()=>{let t=!0;const n=r=>{t&&e(r.detail)};window.addEventListener("sand-router-provider-changed",n);window.desktop.agent.getInferenceRouter().then(r=>{t&&e({...r,error:null})}).catch(r=>{t&&e(i=>({...i,error:String(r?.message??r)}))});return()=>{t=!1;window.removeEventListener("sand-router-provider-changed",n)}},[]);
  const t=async n=>{const r=s;e(i=>({...i,provider:n,error:null}));try{const i=await window.desktop.agent.setInferenceRouter(n),o={...i,error:null};e(o);window.dispatchEvent(new CustomEvent("sand-router-provider-changed",{detail:o}))}catch(i){e({...r,error:String(i?.message??i)})}};
  return[s,t]
}
function RRouterSecrets(){const[s,e]=de.useState([]),[t,n]=de.useState(0);de.useEffect(()=>{let r=!0;window.desktop.secrets.list().then(i=>{r&&e(Array.isArray(i?.keys)?i.keys:[])});return()=>{r=!1}},[t]);return[s,()=>n(r=>r+1)]}
function RRouterNumber(s){return new Intl.NumberFormat().format(s)}
function RRouterCredential({provider:s,state:e,keys:t,onSaved:n}){const[r,i]=de.useState(""),[o,l]=de.useState(!1);if(s.kind==="account")return a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterLoc("Signed in","已登录")});if(s.kind==="local"){const c=e.local?.[s.localKey],d=c?.installed&&c?.authenticated;return a.jsx(se,{as:"span",color:d?"primary":"secondary",size:"sm",children:d?RRouterLoc("Ready","就绪"):c?.installed?RRouterLoc("Sign in with ","使用 ")+("codex login"):RRouterLoc("Not installed","未安装")})}const c=t.includes(s.secret),d=async()=>{if(r.trim().length===0)return;l(!0);try{await window.desktop.secrets.upsert({[s.secret]:r.trim()}),i(""),n()}finally{l(!1)}};return a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-6s0dn4 sand-h8yej3",style:{width:360},children:[a.jsx("input",{"aria-label":s.secret,className:RRouterInputClass,disabled:o,onChange:u=>i(u.currentTarget.value),placeholder:c?RRouterLoc("Replace saved key","替换已保存的密钥"):RRouterLoc("Paste API key","粘贴 API 密钥"),style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},type:"password",value:r}),a.jsx(oe,{disabled:o||r.trim().length===0,onClick:d,shape:"rectangular",size:"sm",variant:"secondary",children:o?RRouterLoc("Saving…","保存中…"):RRouterLoc("Save","保存")})]})}
function RRouterUsageRows({usage:s}){return a.jsxs("div",{children:[a.jsx(ie,{label:RRouterLoc("Requests","请求数"),variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.requests)})}),a.jsx(ie,{divided:!0,label:RRouterLoc("Input tokens","输入 Token"),variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.inputTokens)})}),a.jsx(ie,{divided:!0,label:RRouterLoc("Output tokens","输出 Token"),variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.outputTokens)})}),a.jsx(ie,{divided:!0,label:RRouterLoc("Cache tokens","缓存 Token"),variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.cacheReadTokens+s.cacheWriteTokens)})}),a.jsx(ie,{divided:!0,label:RRouterLoc("Last used","最近使用"),variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:s.lastUsedAt?new Date(s.lastUsedAt).toLocaleString():RRouterLoc("Not used yet","尚未使用")})})]})}
function RBoxRuntime(){const[s,e]=de.useState({mode:"local-docker",status:null,error:null,busy:!0});de.useEffect(()=>{let t=!0;window.desktop.agent.getBoxRuntime().then(n=>{t&&e({...n,error:null,busy:!1})}).catch(n=>{t&&e(r=>({...r,error:String(n?.message??n),busy:!1}))});return()=>{t=!1}},[]);return a.jsx("div",{children:a.jsx(ie,{description:s.error??s.status?.detail??RRouterLoc("Shell, files and computer use run in a Docker container on this Mac.","Shell、文件与电脑操作都在这台 Mac 的 Docker 容器中运行。"),label:RRouterLoc("Local Docker VM","本地 Docker 虚拟机"),variant:"card",children:a.jsx(se,{as:"span",color:s.status?.ready?"primary":"secondary",size:"sm",children:s.error?RRouterLoc("Unavailable","不可用"):s.status?.ready?RRouterLoc("Ready","就绪"):RRouterLoc("Starting…","启动中…")})})})}
function RRouterOpenRouterModel(provider){
  const[s,e]=de.useState({models:[],selected:null,error:null,busy:!1});
  de.useEffect(()=>{
    if(provider!=="openrouter"){e({models:[],selected:null,baseUrl:null,error:null,busy:!1});return()=>{}}
    let c=!0;
    e(i=>({...i,busy:!0,error:null}));
    window.desktop.agent.getOpenRouterModelOptions().then(i=>{
      if(!c)return;
      e({models:Array.isArray(i.models)?i.models:[],selected:typeof i.selected==="string"?i.selected:null,baseUrl:typeof i.baseUrl==="string"?i.baseUrl:null,error:typeof i.error==="string"&&i.error.length>0?i.error:null,busy:!1});
    }).catch(i=>{if(c)e({models:[],selected:null,baseUrl:null,error:String(i?.message??i),busy:!1})});
    return()=>{c=!1};
  },[provider]);
  const t=async i=>{
    e(o=>({...o,busy:!0,error:null}));
    try{await window.desktop.agent.setOpenRouterModel(i);e(o=>({...o,selected:i,busy:!1,error:null}))}
    catch(o){e(n=>({...n,busy:!1,error:String(o?.message??o)}))}
  };
  const u=async v=>{
    e(o=>({...o,busy:!0,error:null}));
    try{
      const r=await window.desktop.agent.setOpenRouterBaseUrl(v.trim().length>0?v.trim():null);
      e(o=>({...o,baseUrl:typeof r.baseUrl==="string"?r.baseUrl:null,busy:!1,error:null}));
      window.desktop.agent.getOpenRouterModelOptions().then(i=>{
        e({models:Array.isArray(i.models)?i.models:[],selected:typeof i.selected==="string"?i.selected:null,baseUrl:typeof i.baseUrl==="string"?i.baseUrl:null,error:typeof i.error==="string"&&i.error.length>0?i.error:null,busy:!1});
      }).catch(()=>{});
    }catch(o){e(n=>({...n,busy:!1,error:String(o?.message??o)}))}
  };
  de.useEffect(()=>{
    if(provider==="openrouter"&&!s.busy&&s.selected==null&&s.models.length>0)void t(s.models[0]);
  },[provider,s]);
  return[s,t,u]
}
function RRouterEndpointCard({state:s,save:e,busy:t}){
  const[n,r]=de.useState(s.baseUrl??"");
  de.useEffect(()=>{r(s.baseUrl??"")},[s.baseUrl]);
  const i=async()=>{await e(n)};
  return a.jsx(ie,{description:s.baseUrl?s.baseUrl:RRouterLoc("Defaults to the TokenHub cloud endpoint.","默认使用 TokenHub 云端端点。"),label:RRouterLoc("API address","API 地址"),variant:"card",children:a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-6s0dn4 sand-h8yej3",style:{width:360},children:[a.jsx("input",{"aria-label":RRouterLoc("TokenHub API address","TokenHub API 地址"),className:RRouterInputClass,disabled:t,onChange:o=>r(o.currentTarget.value),placeholder:"https://openrouter.ai/api/v1",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},type:"text",value:n}),a.jsx(oe,{disabled:t||n.trim()===(s.baseUrl??""),onClick:i,shape:"rectangular",size:"sm",variant:"secondary",children:t?RRouterLoc("Saving…","保存中…"):RRouterLoc("Save","保存")})]})})
}
function RRouterModelCard({state:s,pick:e}){
  const t=s.models.length>0,n=s.selected==null?s.models[0]:s.selected;
  return a.jsx(ie,{description:s.error?s.error:RRouterLoc("Models offered by the TokenHub endpoint.","该 TokenHub 端点提供的模型。"),label:RRouterLoc("Model","模型"),variant:"card",children:t?a.jsx(ye,{"aria-label":RRouterLoc("TokenHub model","TokenHub 模型"),disabled:s.busy,onValueChange:l=>{if(l!==null)void e(l)},options:s.models.map(l=>({value:l,label:l})),placement:"bottom-end",size:"lg",value:n,variant:"filled"}):a.jsx(se,{as:"span",color:"secondary",size:"sm",children:s.busy?RRouterLoc("Loading models…","正在加载模型…"):RRouterLoc("No models listed by the endpoint","该端点未列出任何模型")})});
}
const RRouterEffortDefault="model-default";
function RRouterOpenRouterEffort(provider){
  const[s,e]=de.useState({effort:null,options:[],error:null,busy:!1});
  de.useEffect(()=>{
    if(provider!=="openrouter"){e({effort:null,options:[],error:null,busy:!1});return()=>{}}
    let c=!0;
    e(i=>({...i,busy:!0,error:null}));
    window.desktop.agent.getOpenRouterEffort().then(i=>{
      if(!c)return;
      e({effort:typeof i.effort==="string"&&i.effort.length>0?i.effort:null,options:Array.isArray(i.options)?i.options.filter(o=>o&&typeof o.value==="string"&&typeof o.label==="string"):[],error:null,busy:!1});
    }).catch(i=>{if(c)e({effort:null,options:[],error:String(i?.message??i),busy:!1})});
    return()=>{c=!1};
  },[provider]);
  const t=async i=>{
    e(o=>({...o,busy:!0,error:null}));
    try{
      const v=i===null||i===RRouterEffortDefault?null:i;
      const r=await window.desktop.agent.setOpenRouterEffort(v);
      e(o=>({...o,effort:typeof r.effort==="string"&&r.effort.length>0?r.effort:null,busy:!1,error:null}));
    }catch(o){e(n=>({...n,busy:!1,error:String(o?.message??o)}))}
  };
  return[s,t]
}
function RRouterEffortCard({state:s,pick:e}){
  const t=s.options.length>0?s.options:[{value:"low",label:RRouterLoc("Low","低")},{value:"medium",label:RRouterLoc("Medium","中")},{value:"high",label:RRouterLoc("High","高")},{value:"xhigh",label:RRouterLoc("Extra high","超高")},{value:"max",label:RRouterLoc("Max","最高")}];
  return a.jsx(ie,{description:s.error?s.error:RRouterLoc("Reasoning depth sent with each request. Models that ignore it keep their own default.","每次请求都会携带推理深度设置。忽略该参数的模型将保持自身默认值。"),label:RRouterLoc("Effort","推理强度"),variant:"card",children:a.jsx(ye,{"aria-label":RRouterLoc("TokenHub reasoning effort","TokenHub 推理强度"),disabled:s.busy,onValueChange:l=>{if(l!==null)void e(l)},options:[{value:RRouterEffortDefault,label:RRouterLoc("Model default","模型默认")}].concat(t.map(o=>({value:o.value,label:o.label}))),placement:"bottom-end",size:"lg",value:s.effort??RRouterEffortDefault,variant:"filled"})});
}
function RRouterPanel(){const[s,e]=RRouterState(),[t,n]=RRouterSecrets(),[m,u,g]=RRouterOpenRouterModel(s.provider),[f,w]=RRouterOpenRouterEffort(s.provider),r=RRouterProviders.find(i=>i.value===s.provider)??RRouterProviders[0],i=s.usage?.providers?.[s.provider]??RRouterEmptyUsage,o=r.value==="codex"?RRouterLoc("Uses the private ChatGPT login already stored by Codex on this Mac. Requests are made by Grok Bot directly.","使用 Codex 在这台 Mac 上已保存的私有 ChatGPT 登录凭据，请求由 Grok Bot 直接发出。"):r.kind==="local"?RRouterLoc("Uses your existing Codex login on this Mac.","使用你在这台 Mac 上已有的 Codex 登录凭据。"):r.kind==="key"?RRouterLoc("Stored securely with your other Grok Bot secrets.","与你的其他 Grok Bot 密钥一起安全保存。"):RRouterLoc("Uses the account already connected to Grok Bot.","使用已连接到 Grok Bot 的账户。");return a.jsx(Te,{children:a.jsxs("div",{className:k("sand-settings-general","sand-9f619 sand-78zum5 sand-dt5ytf sand-3qzy4x"),children:[a.jsx(re,{title:RRouterLoc("Routing","路由"),children:a.jsx(ie,{description:r.description,label:RRouterLoc("Provider","服务商"),variant:"card",children:a.jsx(ye,{"aria-label":RRouterLoc("Routing provider","路由服务商"),onValueChange:l=>{if(l!==null)void e(l)},options:RRouterOptions,placement:"bottom-end",size:"lg",value:s.provider,variant:"filled"})})}),a.jsx(re,{title:RRouterLoc("Computer","电脑"),children:a.jsx(RBoxRuntime,{})}),a.jsx(re,{title:r.kind==="key"?RRouterLoc("TokenHub account","TokenHub 账户"):RRouterLoc("Account","账户"),children:a.jsx(ie,{description:o,label:r.kind==="key"?RRouterLoc("API key","API 密钥"):RRouterLoc("Status","状态"),variant:"card",children:a.jsx(RRouterCredential,{provider:r,state:s,keys:t,onSaved:n})})}),r.kind==="key"?a.jsx(re,{title:RRouterLoc("TokenHub endpoint","TokenHub 端点"),children:a.jsx(RRouterEndpointCard,{state:m,save:g,busy:m.busy})}):null,r.kind==="key"?a.jsx(re,{title:RRouterLoc("TokenHub model","TokenHub 模型"),children:a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-dt5ytf",children:[a.jsx(RRouterModelCard,{state:m,pick:u}),a.jsx(RRouterEffortCard,{state:f,pick:w})]})}):null,s.error?a.jsx(se,{as:"p",color:"red",size:"sm",children:s.error}):null,a.jsx(re,{title:RRouterLoc("Usage for ","用量：")+r.label,children:a.jsx(RRouterUsageRows,{usage:i})})]})})}
function RRouterUsageSummary({provider:s,usage:e,current:t,divided:n}){const r=[RRouterNumber(e.requests)+RRouterLoc(" requests"," 次请求"),RRouterNumber(e.inputTokens)+RRouterLoc(" input"," 输入"),RRouterNumber(e.outputTokens)+RRouterLoc(" output"," 输出"),RRouterNumber(e.cacheReadTokens+e.cacheWriteTokens)+RRouterLoc(" cached"," 缓存")].join(" · "),i=t?RRouterLoc("Current route","当前路由"):e.lastUsedAt?new Date(e.lastUsedAt).toLocaleString():RRouterLoc("Not used yet","尚未使用");return a.jsx(ie,{divided:n,description:r,label:s.label,variant:"card",children:a.jsx(se,{as:"span",color:t?"primary":"secondary",size:"sm",children:i})})}
function RRouterUsage(){const[s]=RRouterState(),e=RRouterProviders.find(t=>t.value===s.provider)??RRouterProviders[0],t=RRouterProviders.filter(n=>n.value===s.provider||(s.usage?.providers?.[n.value]?.requests??0)>0);return a.jsxs("div",{className:k("sand-usage-section","sand-9f619 sand-78zum5 sand-dt5ytf sand-ou54vl"),children:[a.jsx(re,{title:RRouterLoc("Current provider","当前服务商"),children:a.jsx(ie,{description:e.description,label:e.label,variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterLoc("Selected","已选择")})})}),a.jsx(re,{title:RRouterLoc("Tracked activity","用量记录"),children:a.jsx("div",{children:t.map((n,r)=>a.jsx(RRouterUsageSummary,{provider:n,usage:s.usage?.providers?.[n.value]??RRouterEmptyUsage,current:n.value===s.provider,divided:r>0},n.value))})})]})}
`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

// About overlay: the upstream 0.58 renderer chunk already localises the dialog to "Grok Node"
// + `基于Grok Bot Version ${s.currentVersion} 重建`, but our build reports a patch-suffix
// version (0.18.0-reconstructed.1). Pin the visible line to the upstream base version 0.18.0
// so the rebuilt copy reads exactly as documented.
const ABOUT_VERSION_BEFORE = '`基于Grok Bot Version ${s.currentVersion} 重建`';
const ABOUT_VERSION_AFTER = '"基于Grok Bot Version 0.18.0 重建"';

export function patchOriginalAboutVersionLine(source) {
  return replaceExactlyOnce(source, ABOUT_VERSION_BEFORE, ABOUT_VERSION_AFTER, "about version line");
}

export function patchOriginalSettingsRegistry(source) {
  const patched = replaceExactlyOnce(source, REGISTRY_BEFORE, REGISTRY_AFTER, "settings registry");
  return replaceExactlyOnce(patched, ACCOUNT_MENU_BEFORE, ACCOUNT_MENU_AFTER, "local account menu");
}

export function patchOriginalSettingsPanel(source) {
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, `${COMPONENT_SOURCE}${COMPONENT_ANCHOR}`, "component insertion");
  patched = replaceExactlyOnce(patched, GENERAL_BEFORE, GENERAL_AFTER, "Router panel switch");
  patched = replaceExactlyOnce(patched, GENERAL_CONTENT_BEFORE, GENERAL_CONTENT_AFTER, "General settings without account");
  patched = replaceExactlyOnce(patched, USAGE_BEFORE, USAGE_AFTER, "Usage panel switch");
  return patched;
}

/** The upstream trigger-draft editor projects every trigger member through a listener→form switch with no
 *  default case (Vgn), so a locally supported trigger the upstream build never knew (webhook) maps to
 *  `undefined` and crashes the editor's card list on `form.platform`. Strip webhook members out of the
 *  projection list (W0n) so the editor treats them as "no rows" and never reaches the upstream projection
 *  or its fallback commit path; the residual row filter (Rwe) guards any other unknown trigger type. */
const WEBHOOK_FORM_GUARD_BEFORE = 'function Rwe(n){return{rows:W0n(n).map(Vgn)}}';
const WEBHOOK_FORM_GUARD_AFTER = 'function Rwe(n){return{rows:W0n(n).map(Vgn).filter(e=>e!=null)}}';
const WEBHOOK_LIST_GUARD_BEFORE = 'function W0n(n){return n.type==="group"?n.listeners:[n]}';
const WEBHOOK_LIST_GUARD_AFTER = 'function W0n(n){return n.type==="group"?n.listeners.filter(e=>e&&e.type!=="webhook"):n.type==="webhook"?[]:[n]}';

export function patchOriginalWebhookTriggerFormGuard(source) {
  let patched = replaceExactlyOnce(source, WEBHOOK_LIST_GUARD_BEFORE, WEBHOOK_LIST_GUARD_AFTER, "webhook trigger list guard");
  return replaceExactlyOnce(patched, WEBHOOK_FORM_GUARD_BEFORE, WEBHOOK_FORM_GUARD_AFTER, "webhook trigger form guard");
}

export async function applyOriginalRendererRouterPatch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const registryCandidates = [];
  const panelCandidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(REGISTRY_BEFORE)) registryCandidates.push({ name, target, source });
    if (source.includes(COMPONENT_ANCHOR) && source.includes(GENERAL_BEFORE) && source.includes(USAGE_BEFORE)) panelCandidates.push({ name, target, source });
  }
  if (registryCandidates.length !== 1 || panelCandidates.length !== 1) {
    throw new Error(`Expected one original Settings registry and panel chunk, found ${registryCandidates.length}/${panelCandidates.length}.`);
  }
  const botTemplateExtension = await buildBotTemplateRendererExtension();
  const channelStatusExtension = await buildChannelStatusRendererExtension();
  const pluginsDockExtension = await buildPluginsDockRendererExtension();
  const webhookCredentialExtension = await buildWebhookCredentialRendererExtension();
  const approvalName = "view-QqBtBG74.js";
  const approvalTarget = path.join(assetsRoot, approvalName);
  const approvalCandidate = { name: approvalName, target: approvalTarget, source: await readFile(approvalTarget, "utf8") };
  const changes = [];
  const ABOUT_VERSION_ANCHOR = ABOUT_VERSION_BEFORE;
  for (const [role, candidate, transform] of [
    ["registry", registryCandidates[0], (source) => patchOriginalWebhookTriggerFormGuard(patchOriginalSettingsRegistry(source))],
    ["panel", panelCandidates[0], patchOriginalSettingsPanel],
    ["approval", approvalCandidate, patchOriginalAutoReviewApproval],
  ]) {
    const registryExtensions = role === "registry" ? "\n;" + [botTemplateExtension, channelStatusExtension, pluginsDockExtension, webhookCredentialExtension].join("\n;") : "";
    let patched = transform(candidate.source) + registryExtensions;
    // Pin the About overlay version line to the upstream base version (0.18.0) regardless
    // of which chunk the upstream About dialog lives in. About lives in the registry chunk
    // (the same chunk the Settings registry patch already touches), so this is a single
    // string replacement applied to that chunk only.
    if (role === "registry" && patched.includes(ABOUT_VERSION_BEFORE)) {
      patched = patchOriginalAboutVersionLine(patched);
    }
    await writeFile(candidate.target, patched);
    changes.push({
      role,
      path: `dist/renderer/assets/${candidate.name}`,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
    });
  }
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-settings-extension",
    chunks: changes,
    features: ["settings-router-provider", "settings-local-docker-vm", "settings-router-effort", "usage-current-provider", "local-account-menu", "bot-template-preview-confirmation", "auto-review-always-allow", "channel-status-light", "plugins-footer-dock", "about-version-pinned", "webhook-credential-copy"],
    transformations: ["settings-registry", "router-panel", "router-effort-card", "usage-panel", "remove-account-help-feedback", "remove-general-account", "append-local-bot-template-preview", "append-channel-status-light", "append-plugins-footer-dock", "pin-about-version-line", "append-webhook-credential-copy", "guard-webhook-trigger-form", "fail-closed-always-allow"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-router-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
