// Grok Bot 0.75.3 "Create new Bot" dialog, ported onto the pinned 0.18 renderer.
//
// The official 0.75.3 dialog is nLt/ZO in assets/index.eager-app-DjFE9lSq.js:
// title "Create new Bot", name placeholder, 96px mark preview, the 14-shape
// character grid, 11 color swatches, Cancel/Create, and a 440px rich dialog.
// The creation request is the same one 0.18 already ships in n5n: roster
// createAgent with isKickstartRequested, then launcher.kickstartAwaitingFirstMessage.
// This patch only adds the official surface and wires it to those existing calls.
//
// @evidence rea-grokbot-0753/bot-search-create-0753/official-popup-interactions.json
// @evidence rea-grokbot-0753/bot-search-create-0753/official-create-bot.png
// @evidence rea-grokbot-0753/bot-search-create-0753/official-shape-paths.json

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const MOUNT_ANCHOR = "p.jsx(RMainRoot,{sidebar:props})";

export const BOT_CREATE_STYLE = `
.r-create-bot-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;gap:8px}
.r-create-bot-header .sand-dialog__title{margin:0;font-size:14px;line-height:22px;font-weight:600}
.r-create-bot-body{padding:0 16px 16px}
.r-create-bot{display:flex;flex-direction:column;gap:12px;width:100%;min-width:0}
.r-create-bot-preview{position:relative;display:flex;align-items:center;justify-content:center;align-self:center;width:96px;height:96px;margin:8px 0 2px}
.r-create-bot-name{display:block;width:100%;box-sizing:border-box;padding:8px 10px;margin:4px 0;color:#f5f5f5;background:transparent;border:.5px solid rgba(245,245,245,.1);border-radius:8px;outline:none;font:inherit;font-size:13px;line-height:18px}
.r-create-bot-name::placeholder{color:rgba(245,245,245,.54)}
.r-create-bot-name:focus{border-color:var(--sand-border-focus)}
.r-create-bot-shapes{display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0}
.r-create-bot-shape-row{display:flex;align-items:center;justify-content:center;gap:14px}
.r-create-bot-shape{position:relative;display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;color:var(--sand-text-primary);background:transparent;border:0;border-radius:0;cursor:pointer;--sand-border-primary-translucent:#f5f5f538;--sand-border-secondary-translucent:#f5f5f51a}
.r-create-bot-shape-mark{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px}
.r-create-bot-shape:focus-visible{outline:2px solid var(--sand-border-focus);outline-offset:2px}
.r-create-bot-shape-outline{position:absolute;pointer-events:none;background:var(--sand-border-secondary-translucent,var(--sand-border-default));opacity:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.r-create-bot-shape:hover .r-create-bot-shape-outline{opacity:1}
.r-create-bot-shape[aria-pressed=true] .r-create-bot-shape-outline{background:var(--sand-border-primary-translucent,var(--sand-text-secondary));opacity:1}
.r-create-bot-colors{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;align-self:center;gap:10px 12px;padding:8px 0;max-width:260px}
.r-create-bot-color{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;background:transparent;border:1px solid transparent;border-radius:9999px;cursor:pointer}
.r-create-bot-color:focus-visible{outline:2px solid var(--sand-border-focus);outline-offset:2px}
.r-create-bot-color[aria-pressed=true]{border-color:var(--sand-text-secondary)}
.r-create-bot-color-swatch{display:block;width:24px;height:24px;border-radius:9999px}
.r-create-bot-error{margin:0;color:var(--sand-text-warning);font-size:13px;line-height:18px;white-space:normal}
.r-create-bot-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:.5px solid var(--sand-border-weak)}
.r-create-bot-action{min-height:32px!important;padding:6px 12px!important;border-radius:9999px!important;font-size:14px;line-height:20px}
`;

export const BOT_CREATE_COMPONENTS = `
let RCreateBotOpenValue=false;
const RCreateBotListeners=new Set();
function RCreateBotPublish(open){RCreateBotOpenValue=open===true;RCreateBotListeners.forEach(listener=>listener())}
function RCreateBotSubscribe(listener){RCreateBotListeners.add(listener);return()=>RCreateBotListeners.delete(listener)}
function RCreateBotSnapshot(){return RCreateBotOpenValue}
function RCreateBotOpen(){RCreateBotPublish(true)}
function RCreateBotClose(){RCreateBotPublish(false)}
function RCreateBotT(en,zh){return typeof RLocT==='function'?RLocT(en,zh):zh}
function RCreateBotShapeLabel(shape){const labels=typeof RCompAvatarLabels==='function'?RCompAvatarLabels():{};return labels[shape]??shape}
function RCreateBotShapeSuffix(){return typeof RCompAvatarSuffix==='function'?RCompAvatarSuffix('shape'):RCreateBotT(' character shape','角色形状')}
function RCreateBotColorSuffix(){return typeof RCompAvatarSuffix==='function'?RCompAvatarSuffix('color'):RCreateBotT(' character color','角色颜色')}
function RCreateBotColorLabel(color){return typeof RCompAvatarColorLabel==='function'?RCompAvatarColorLabel(color):(color.label??color.id)}
function RCreateBotRandom(){
  const shapes=Array.isArray(Ij)&&Ij.length>0?Ij:['blob'];
  const colors=Array.isArray(PQ)&&PQ.length>0?PQ:[{id:'red',value:'#FF263C',label:'Red'}];
  return {shape:shapes[Math.floor(Math.random()*shapes.length)],color:colors[Math.floor(Math.random()*colors.length)].id};
}
function RCreateBotShapeRows(){
  const rows=[];
  for(let index=0;index<Ij.length;index+=5)rows.push(Ij.slice(index,index+5));
  return rows;
}
function RCreateBotColorValue(color){return color.id==='black'?(typeof MNe==='function'?MNe('black'):'#000'):color.value}
function RCreateBotDialog({onClose,onCreate,busy,error}){
  const initial=S.useRef(null);
  if(initial.current==null)initial.current=RCreateBotRandom();
  const [name,setName]=S.useState('');
  const [shape,setShape]=S.useState(initial.current.shape);
  const [color,setColor]=S.useState(initial.current.color);
  const trimmed=name.trim();
  const canCreate=trimmed.length>0&&!busy;
  const submit=()=>{if(canCreate)onCreate({name:trimmed,avatarShape:shape,avatarColor:color})};
  const rows=RCreateBotShapeRows();
  return p.jsxs(Gt.Root,{open:true,variant:'rich',width:440,closeOnBackdropClick:!busy,closeOnEscape:!busy,onOpenChange:next=>{if(!next)onClose()},children:[
    p.jsxs(Gt.Header,{style:RCREATE_STYLES.header,children:[p.jsx(Gt.Title,{children:RCreateBotT('Create new Bot','创建新 Bot')}),p.jsx(Gt.CloseButton,{'aria-label':RCreateBotT('Close dialog','关闭对话框')})]}),
    p.jsx(Gt.Body,{style:RCREATE_STYLES.body,children:p.jsxs('div',{className:'r-create-bot',children:[
      p.jsx('span',{className:'r-create-bot-preview',children:[p.jsx(sd,{color,shape,sizePx:96}),shape==='pumpkin'&&typeof RCompPumpkinStem==='function'?p.jsx(RCompPumpkinStem,{sizePx:96}):null]}),
      p.jsx('input',{'aria-label':RCreateBotT('Bot name','Bot 名称'),autoFocus:true,className:'r-create-bot-name',disabled:busy,maxLength:255,onChange:event=>setName(event.currentTarget.value),onKeyDown:event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();submit()}},placeholder:RCreateBotT('Give your Bot a name','给你的 Bot 起个名字'),type:'text',value:name}),
      p.jsx('div',{'aria-label':RCreateBotShapeSuffix(),className:'r-create-bot-shapes',children:rows.map((row,index)=>p.jsx('div',{className:'r-create-bot-shape-row',children:row.map(candidate=>{
        const selected=shape===candidate;
        const label=RCreateBotShapeLabel(candidate);
        const outline=typeof RCompAvatarOutline==='function'?RCompAvatarOutline(candidate):null;
        return p.jsxs('button',{'aria-label':label+RCreateBotShapeSuffix(),'aria-pressed':selected,className:'r-create-bot-shape',disabled:busy,onClick:()=>setShape(candidate),title:label,type:'button',children:[
          p.jsxs('span',{className:'r-create-bot-shape-mark',children:[p.jsx(sd,{color,shape:candidate,sizePx:36,paused:true}),candidate==='pumpkin'&&typeof RCompPumpkinStem==='function'?p.jsx(RCompPumpkinStem,{sizePx:36}):null]}),
          outline==null?null:p.jsx('span',{'aria-hidden':true,className:'r-create-bot-shape-outline',style:outline})
        ]},candidate);
      })},index))}),
      p.jsx('div',{'aria-label':RCreateBotColorSuffix(),className:'r-create-bot-colors',children:PQ.map(candidate=>p.jsx('button',{'aria-label':RCreateBotColorLabel(candidate)+RCreateBotColorSuffix(),'aria-pressed':color===candidate.id,className:'r-create-bot-color',disabled:busy,onClick:()=>setColor(candidate.id),title:RCreateBotColorLabel(candidate),type:'button',children:p.jsx('span',{'aria-hidden':true,className:'r-create-bot-color-swatch',style:{backgroundColor:RCreateBotColorValue(candidate)}})},candidate.id))}),
      error==null?null:p.jsx('p',{className:'r-create-bot-error',role:'alert',children:error})
    ]})}),
    p.jsxs(Gt.ActionBar,{style:RCREATE_STYLES.actions,children:[
      p.jsx(Gt.Action,{className:'r-create-bot-action',disabled:busy,onClick:onClose,children:RCreateBotT('Cancel','取消')}),
      p.jsx(Gt.Action,{className:'r-create-bot-action',disabled:!canCreate,pending:busy,variant:'primary',onClick:submit,children:busy?RCreateBotT('Creating…','正在创建…'):RCreateBotT('Create','创建')})
    ]})
  ]});
}
const RCREATE_STYLES={header:{rCreateHeader:'r-create-bot-header',$$css:true},body:{rCreateBody:'r-create-bot-body',$$css:true},actions:{rCreateActions:'r-create-bot-actions',$$css:true}};
function RCreateBotHost(){
  const open=S.useSyncExternalStore(RCreateBotSubscribe,RCreateBotSnapshot,RCreateBotSnapshot);
  const [busy,setBusy]=S.useState(false);
  const [error,setError]=S.useState(null);
  const {roster,launcher,selection}=Qe();
  const close=()=>{if(!busy){setError(null);RCreateBotClose()}};
  const create=async data=>{
    setBusy(true);setError(null);
    try{
      const result=await n5n(roster,launcher,{name:data.name,description:'',avatarShape:data.avatarShape,avatarColor:data.avatarColor});
      setBusy(false);RCreateBotClose();
      if(!result.isAbandoned)selection.select(result.agentId);
    }catch(reason){setBusy(false);setError(Nme(reason))}
  };
  return open?p.jsx(RCreateBotDialog,{onClose:close,onCreate:create,busy,error}):null;
}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error("Create Bot " + label + " anchor is missing or ambiguous.");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchBotCreateDialogRenderer(source) {
  if (source.includes("function RCreateBotHost(")) throw new Error("Create Bot patch was already applied.");
  let patched = replaceExactlyOnce(source, MOUNT_ANCHOR, MOUNT_ANCHOR + ",p.jsx(RCreateBotHost,{})", "mount");
  patched += BOT_CREATE_COMPONENTS;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

const sha256 = text => createHash("sha256").update(text).digest("hex");

export async function applyBotCreateDialogRendererExtension({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = await readdir(assets);
  const candidates = [];
  for (const file of files.filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(MOUNT_ANCHOR)) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error("Create Bot patch: expected one sidebar wrapper, found " + candidates.length + ".");
  const cssFiles = files.filter(file => /^index-.*[.]css$/.test(file));
  if (cssFiles.length !== 1) throw new Error("Create Bot patch: expected one main stylesheet.");
  const [{ file, source }] = candidates;
  const patched = patchBotCreateDialogRenderer(source);
  await writeFile(path.join(assets, file), patched);
  const cssFile = cssFiles[0];
  const css = await readFile(path.join(assets, cssFile), "utf8");
  const patchedCss = css + BOT_CREATE_STYLE;
  await writeFile(path.join(assets, cssFile), patchedCss);
  const provenance = {
    mode: "create-bot-dialog-0753",
    files: [
      { file: "dist/renderer/assets/" + file, originalSha256: sha256(source), patchedSha256: sha256(patched) },
      { file: "dist/renderer/assets/" + cssFile, originalSha256: sha256(css), patchedSha256: sha256(patchedCss) },
    ],
    features: ["create-bot-dialog", "official-14-shape-picker", "n5n-kickstart"],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-create-bot-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
