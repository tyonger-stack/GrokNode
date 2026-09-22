import { buildBotTemplateRendererExtension } from "./bot-template-renderer-extension.mjs";
import { patchOriginalAutoReviewApproval } from "./auto-review-renderer-patch.mjs";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const REGISTRY_BEFORE = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const REGISTRY_AFTER = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"router",label:"Router",icon:"git-branch"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
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
const RRouterProviders=[
  {value:"codex",label:"Codex",description:"Use your existing ChatGPT sign-in from Codex with Grok Bot's connected plugins.",kind:"local",localKey:"codex"},
  {value:"openrouter",label:"TokenHub",description:"Route through your TokenHub account and selected model.",kind:"key",secret:"OPENROUTER_API_KEY"}
],RRouterOptions=RRouterProviders.map(s=>({value:s.value,label:s.label})),RRouterEmptyUsage={requests:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,lastUsedAt:null},RRouterInputClass="sand-9f619 sand-h8yej3 sand-5f5z56 sand-u97haq sand-lrnmfh sand-uve7l6 sand-16b7oty sand-1rgtt3y sand-o7x2bt sand-mkeg23 sand-1y0btm7 sand-qz0629 sand-1043rbw sand-13l7odt sand-1wd3ewq sand-jb2p0i sand-4z9k3i sand-frs9s4 sand-tt52l0 sand-1odjw0f sand-1t137rt sand-ltfok3";
function RRouterState(){
  const[s,e]=de.useState({provider:"openrouter",usage:null,local:null,error:null});
  de.useEffect(()=>{let t=!0;const n=r=>{t&&e(r.detail)};window.addEventListener("sand-router-provider-changed",n);window.desktop.agent.getInferenceRouter().then(r=>{t&&e({...r,error:null})}).catch(r=>{t&&e(i=>({...i,error:String(r?.message??r)}))});return()=>{t=!1;window.removeEventListener("sand-router-provider-changed",n)}},[]);
  const t=async n=>{const r=s;e(i=>({...i,provider:n,error:null}));try{const i=await window.desktop.agent.setInferenceRouter(n),o={...i,error:null};e(o);window.dispatchEvent(new CustomEvent("sand-router-provider-changed",{detail:o}))}catch(i){e({...r,error:String(i?.message??i)})}};
  return[s,t]
}
function RRouterSecrets(){const[s,e]=de.useState([]),[t,n]=de.useState(0);de.useEffect(()=>{let r=!0;window.desktop.secrets.list().then(i=>{r&&e(Array.isArray(i?.keys)?i.keys:[])});return()=>{r=!1}},[t]);return[s,()=>n(r=>r+1)]}
function RRouterNumber(s){return new Intl.NumberFormat().format(s)}
function RRouterCredential({provider:s,state:e,keys:t,onSaved:n}){const[r,i]=de.useState(""),[o,l]=de.useState(!1);if(s.kind==="account")return a.jsx(se,{as:"span",color:"secondary",size:"sm",children:"Signed in"});if(s.kind==="local"){const c=e.local?.[s.localKey],d=c?.installed&&c?.authenticated;return a.jsx(se,{as:"span",color:d?"primary":"secondary",size:"sm",children:d?"Ready":c?.installed?"Sign in with "+("codex login"):"Not installed"})}const c=t.includes(s.secret),d=async()=>{if(r.trim().length===0)return;l(!0);try{await window.desktop.secrets.upsert({[s.secret]:r.trim()}),i(""),n()}finally{l(!1)}};return a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-6s0dn4 sand-h8yej3",style:{width:360},children:[a.jsx("input",{"aria-label":s.secret,className:RRouterInputClass,disabled:o,onChange:u=>i(u.currentTarget.value),placeholder:c?"Replace saved key":"Paste API key",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},type:"password",value:r}),a.jsx(oe,{disabled:o||r.trim().length===0,onClick:d,shape:"rectangular",size:"sm",variant:"secondary",children:o?"Saving…":"Save"})]})}
function RRouterUsageRows({usage:s}){return a.jsxs("div",{children:[a.jsx(ie,{label:"Requests",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.requests)})}),a.jsx(ie,{divided:!0,label:"Input tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.inputTokens)})}),a.jsx(ie,{divided:!0,label:"Output tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.outputTokens)})}),a.jsx(ie,{divided:!0,label:"Cache tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.cacheReadTokens+s.cacheWriteTokens)})}),a.jsx(ie,{divided:!0,label:"Last used",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:s.lastUsedAt?new Date(s.lastUsedAt).toLocaleString():"Not used yet"})})]})}
function RBoxRuntime(){const[s,e]=de.useState({mode:"local-docker",status:null,error:null,busy:!0});de.useEffect(()=>{let t=!0;window.desktop.agent.getBoxRuntime().then(n=>{t&&e({...n,error:null,busy:!1})}).catch(n=>{t&&e(r=>({...r,error:String(n?.message??n),busy:!1}))});return()=>{t=!1}},[]);return a.jsx("div",{children:a.jsx(ie,{description:s.error??s.status?.detail??"Shell, files and computer use run in a Docker container on this Mac.",label:"Local Docker VM",variant:"card",children:a.jsx(se,{as:"span",color:s.status?.ready?"primary":"secondary",size:"sm",children:s.error?"Unavailable":s.status?.ready?"Ready":"Starting…"})})})}
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
  return a.jsx(ie,{description:s.baseUrl?s.baseUrl:"Defaults to the TokenHub cloud endpoint.",label:"API address",variant:"card",children:a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-6s0dn4 sand-h8yej3",style:{width:360},children:[a.jsx("input",{"aria-label":"TokenHub API address",className:RRouterInputClass,disabled:t,onChange:o=>r(o.currentTarget.value),placeholder:"https://openrouter.ai/api/v1",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},type:"text",value:n}),a.jsx(oe,{disabled:t||n.trim()===(s.baseUrl??""),onClick:i,shape:"rectangular",size:"sm",variant:"secondary",children:t?"Saving…":"Save"})]})})
}
function RRouterModelCard({state:s,pick:e}){
  const t=s.models.length>0,n=s.selected==null?s.models[0]:s.selected;
  return a.jsx(ie,{description:s.error?s.error:"Models offered by the TokenHub endpoint.",label:"Model",variant:"card",children:t?a.jsx(ye,{"aria-label":"TokenHub model",disabled:s.busy,onValueChange:l=>{if(l!==null)void e(l)},options:s.models.map(l=>({value:l,label:l})),placement:"bottom-end",size:"lg",value:n,variant:"filled"}):a.jsx(se,{as:"span",color:"secondary",size:"sm",children:s.busy?"Loading models…":"No models listed by the endpoint"})});
}
function RRouterPanel(){const[s,e]=RRouterState(),[t,n]=RRouterSecrets(),[m,u,g]=RRouterOpenRouterModel(s.provider),r=RRouterProviders.find(i=>i.value===s.provider)??RRouterProviders[0],i=s.usage?.providers?.[s.provider]??RRouterEmptyUsage,o=r.value==="codex"?"Uses the private ChatGPT login already stored by Codex on this Mac. Requests are made by Grok Bot directly.":r.kind==="local"?"Uses your existing Codex login on this Mac.":r.kind==="key"?"Stored securely with your other Grok Bot secrets.":"Uses the account already connected to Grok Bot.";return a.jsx(Te,{children:a.jsxs("div",{className:k("sand-settings-general","sand-9f619 sand-78zum5 sand-dt5ytf sand-3qzy4x"),children:[a.jsx(re,{title:"Routing",children:a.jsx(ie,{description:r.description,label:"Provider",variant:"card",children:a.jsx(ye,{"aria-label":"Routing provider",onValueChange:l=>{if(l!==null)void e(l)},options:RRouterOptions,placement:"bottom-end",size:"lg",value:s.provider,variant:"filled"})})}),a.jsx(re,{title:"Computer",children:a.jsx(RBoxRuntime,{})}),a.jsx(re,{title:r.kind==="key"?"TokenHub account":"Account",children:a.jsx(ie,{description:o,label:r.kind==="key"?"API key":"Status",variant:"card",children:a.jsx(RRouterCredential,{provider:r,state:s,keys:t,onSaved:n})})}),r.kind==="key"?a.jsx(re,{title:"TokenHub endpoint",children:a.jsx(RRouterEndpointCard,{state:m,save:g,busy:m.busy})}):null,r.kind==="key"?a.jsx(re,{title:"TokenHub model",children:a.jsx(RRouterModelCard,{state:m,pick:u})}):null,s.error?a.jsx(se,{as:"p",color:"red",size:"sm",children:s.error}):null,a.jsx(re,{title:"Usage for "+r.label,children:a.jsx(RRouterUsageRows,{usage:i})})]})})}
function RRouterUsageSummary({provider:s,usage:e,current:t,divided:n}){const r=[RRouterNumber(e.requests)+" requests",RRouterNumber(e.inputTokens)+" input",RRouterNumber(e.outputTokens)+" output",RRouterNumber(e.cacheReadTokens+e.cacheWriteTokens)+" cached"].join(" · "),i=t?"Current route":e.lastUsedAt?new Date(e.lastUsedAt).toLocaleString():"Not used yet";return a.jsx(ie,{divided:n,description:r,label:s.label,variant:"card",children:a.jsx(se,{as:"span",color:t?"primary":"secondary",size:"sm",children:i})})}
function RRouterUsage(){const[s]=RRouterState(),e=RRouterProviders.find(t=>t.value===s.provider)??RRouterProviders[0],t=RRouterProviders.filter(n=>n.value===s.provider||(s.usage?.providers?.[n.value]?.requests??0)>0);return a.jsxs("div",{className:k("sand-usage-section","sand-9f619 sand-78zum5 sand-dt5ytf sand-ou54vl"),children:[a.jsx(re,{title:"Current provider",children:a.jsx(ie,{description:e.description,label:e.label,variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:"Selected"})})}),a.jsx(re,{title:"Tracked activity",children:a.jsx("div",{children:t.map((n,r)=>a.jsx(RRouterUsageSummary,{provider:n,usage:s.usage?.providers?.[n.value]??RRouterEmptyUsage,current:n.value===s.provider,divided:r>0},n.value))})})]})}
`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  return source.slice(0, first) + after + source.slice(first + before.length);
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
  const approvalName = "view-QqBtBG74.js";
  const approvalTarget = path.join(assetsRoot, approvalName);
  const approvalCandidate = { name: approvalName, target: approvalTarget, source: await readFile(approvalTarget, "utf8") };
  const changes = [];
  for (const [role, candidate, transform] of [
    ["registry", registryCandidates[0], patchOriginalSettingsRegistry],
    ["panel", panelCandidates[0], patchOriginalSettingsPanel],
    ["approval", approvalCandidate, patchOriginalAutoReviewApproval],
  ]) {
    const patched = transform(candidate.source) + (role === "registry" ? "\n;" + botTemplateExtension : "");
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
    features: ["settings-router-provider", "settings-local-docker-vm", "usage-current-provider", "local-account-menu", "bot-template-preview-confirmation", "auto-review-always-allow"],
    transformations: ["settings-registry", "router-panel", "usage-panel", "remove-account-help-feedback", "remove-general-account", "append-local-bot-template-preview", "fail-closed-always-allow"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-router-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
