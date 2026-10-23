import {nWe} from "./official.js";
function Wae(e){let t=e?.min_connected_apps;return typeof t==`number`&&Number.isSafeInteger(t)&&t>0?t:4}
export {Wae};
export const countConnectedApps=(()=>{
const LAe=`tailscale-team-`;
function ob(e){return e.rowServerIdentifier===`tailscale-team`||e.rowServerIdentifier.startsWith(LAe)}
function db(e){return e.isEnabled}
function xje(e,t){let n=e.builtinServerIdentifier;if(n!=null)return t.find(e=>e.rowServerIdentifier===n)}
function Sje(e){return e.status!==`needsAuth`}
function Tk(e,t,n,r){if(e.builtinServerIdentifier!=null){let n=xje(e,t);return{isInstalled:n!=null&&Sje(n),...n==null?{}:{server:n}}}let i=n.get(e.name.toLowerCase())??n.get(e.displayName.toLowerCase()),a=r.get(e.id),o=a!=null&&!db(a),s=o?void 0:a,c=i?.isTeamServer===!0?i:void 0,l=t.filter(t=>t.pluginId===e.id&&!ob(t)),u=l.find(e=>e.servedBy!==`grok`)??c,d=new Set([e.name.toLowerCase(),e.displayName.toLowerCase()]),f=l.find(e=>e.servedBy===`grok`)??t.find(e=>e.servedBy===`grok`&&d.has(e.name.toLowerCase())),p=u??f??(s==null?void 0:i);return{isInstalled:s!=null||!o&&u!=null,...s==null?{}:{plugin:s},...p==null?{}:{server:p},...u!=null&&f!=null?{grokTwin:f}:{}}}
function Dk(e){let t=new Map;for(let n of e)n.isTeamServer&&t.set(n.name.toLowerCase(),n);for(let n of e)!n.isTeamServer&&n.servedBy!==`grok`&&t.set(n.name.toLowerCase(),n);return t}
function I(e,t){if(e.cursorScmProvider!=null)return t.find(t=>t.builtinServerIdentifier===e.rowServerIdentifier);let n=t.filter(e=>e.builtinServerIdentifier==null);if(e.pluginId!=null){let t=n.find(t=>t.id===e.pluginId);if(t!=null)return t}let r=e.name.toLowerCase();return n.find(e=>e.name.toLowerCase()===r||e.displayName.toLowerCase()===r)}
const isFinance=(()=>{var e=`user-Finance-xai`;`${e}`;var t=`--`,n=`-xai`,r=/^(?:dashboard-team-\d+-|dashboard-|user-|cursor-)/i;function i(e){let i=e.trim(),a=i.lastIndexOf(t);a!==-1&&(i=i.slice(0,a));let o=r.exec(i)?.[0];return o!=null&&(i=i.slice(o.length)),i.length>4&&i.toLowerCase().endsWith(n)&&(i=i.slice(0,-4)),i.replace(/[._]+/g,`-`).replace(/^-+|-+$/g,``).toLowerCase()}function a(e){return e!=null&&e.length>0&&i(e)===`finance`}function o(e){return a(e.name)||a(e.rowServerIdentifier)||a(e.serverIdentifier)}return o;})();
const n=db,r=Dk,i=Sje,a=Tk,o=isFinance,s=I,d=new Set;
function l(e){return e.isTeamServer||e.isRequired===!0||e.managedByTeamPluginPolicy===!0?`team-required`:`user`}
function u(e){switch(e.installMode){case`team-required`:return`team-required`;case`team-default`:return`team-default`;case`user`:case`unknown`:return`user`}}
function f(e){return e.cursorScmProvider==null?e.servedBy===`grok`&&e.status===`needsAuth`&&o(e):!i(e)}
function p(e,t){return e.servedBy===`grok`&&[t?.name,e.name,e.serverIdentifier].some(e=>{let t=e?.toLowerCase()??``;return t===`sharepoint`||t===`sharepoint_rw`||t.includes(`sharepoint`)})}
function m(e,t){if(e!=null){let r=t.get(e.id);if(r!=null&&n(r))return!0}for(let e of t.values()){if(!n(e))continue;let t=e.name.toLowerCase();if(t===`sharepoint`||t===`sharepoint_rw`)return!0}return!1}
function h(e,t,i=[],o=d){let c=new Map;for(let e of i)c.set(e.pluginId,e);let h=r(e),_=[],v=new Map;for(let r of e){if(f(r))continue;let i=s(r,t),o=i==null?void 0:c.get(i.id);if(p(r,i)&&!m(i,c)||i!=null&&r.servedBy===`grok`&&a(i,e,h,c).grokTwin?.id===r.id)continue;if(i==null||r.servedBy===`grok`||r.pluginId!==i.id&&!r.isTeamServer&&r.cursorScmProvider==null||o!=null&&!n(o)){_.push({kind:`connector`,server:r,installMode:l(r)});continue}let d=o,g=v.get(i.id);if(g==null){let e={kind:`plugin`,entry:i,installMode:d==null?l(r):u(d),pluginId:i.id,connectors:[r],configuredVariables:null,configuredVariableKeys:d?.configuredVariableKeys??[]};v.set(i.id,e),_.push(e);continue}let y=r.isTeamServer?[...g.connectors,r]:[r,...g.connectors],b={...g,connectors:y,installMode:d!=null||r.isTeamServer?g.installMode:`user`};v.set(i.id,b),_[_.indexOf(g)]=b}for(let e of c.values()){if(!n(e)||v.has(e.pluginId))continue;let r=t.find(t=>t.id===e.pluginId);r!=null&&_.push({kind:`plugin`,entry:r,installMode:u(e),pluginId:e.pluginId,connectors:[],configuredVariables:null,configuredVariableKeys:e.configuredVariableKeys??[]})}for(let e of t)e.native!=null&&o.has(e.id)&&_.push({kind:`plugin`,entry:e,installMode:`user`,pluginId:e.id,connectors:[],configuredVariables:null,configuredVariableKeys:[]});return _.flatMap(e=>e.kind===`plugin`?g(e):[e])}
function g(e){let t=new Map;for(let n of e.connectors){let e=n.name.toLowerCase();t.has(e)||t.set(e,n)}return t.size<2?[e]:[...t.keys()].sort().flatMap(n=>{let r=t.get(n);return r==null?[]:[_(e,r)]})}
function _(e,t){return{kind:`connector`,server:t,installMode:e.installMode,plugin:e}}
function v(e){return e.kind===`connector`?e.server.status===`connected`:e.connectors.some(e=>e.status===`connected`)}
function y({servers:e,catalog:t,effectivePlugins:n}){return h(e,t,n).filter(v)}
function b(e){return y(e).length}
return b;})();

const record=e=>e!==null&&typeof e==="object";
const strings=(e,keys)=>record(e)&&keys.every(k=>typeof e[k]==="string");
export function connectedLayout(snapshot,config) {
  if(!record(snapshot)||!Array.isArray(snapshot.servers)||!Array.isArray(snapshot.catalog)||!Array.isArray(snapshot.effectivePlugins))return nWe(undefined,Wae(config));
  if(!snapshot.servers.every(e=>strings(e,["id","name","status","rowServerIdentifier"]))||!snapshot.catalog.every(e=>strings(e,["id","name","displayName"]))||!snapshot.effectivePlugins.every(e=>strings(e,["name","pluginId"])&&typeof e.isEnabled==="boolean"))return nWe(undefined,Wae(config));
  return nWe(countConnectedApps(snapshot),Wae(config));
}
