// ═══ 0.18 runtime/bridge wiring — NO visual code; official segments below stay verbatim ═══
// Panel-chunk locals (index-BlqerJhg.js import aliases): de=react, a=jsx runtime,
// H=react-compiler runtime module (H.c), je=icon glyph renderer, Ds=base dialog
// primitive, se=Text, re/ie=General-panel section/card kit. RLocT is appended to
// this chunk later by the settings-i18n pass (function declaration; hoisted).
const O77react=de,O77jsx=a,O77rtObj=H,O77jsx2=a,O77Text=se,O77IconGlyph=je,O77BaseDialog=Ds;
const O77ZS=O77react.createContext(`simple`),O77QS=O77react.createContext(!1),O77eC=O77react.createContext(null),O77SettingsCtx=O77react.createContext(null);
function O77useDialogIds(){const t=O77react.useId(),d=O77react.useId();return{titleId:t,descriptionId:d}}
const O77Gate=()=>!0;
const O77Loc={UwUr5z:['Import Memory to Grok Bot','将记忆导入 Grok Bot'],odeIN7:['Start Import','开始导入'],'6OUNRA':['Transfer your preferences and context from another AI assistant','从另一个 AI 助手迁移你的偏好和背景信息'],VVno4E:['Paste your memory details here','在此粘贴你的记忆详情'],eyN5TV:['Add to Memory','添加到记忆'],dEgA5A:['Cancel','取消'],YYxWO8:['Paste the results below to add them to Grok Bot\'s memory','将结果粘贴到下方，添加到 Grok Bot 的记忆中'],'zkoAv/':['Add these memories from my other AI assistant','添加这些来自我另一个 AI 助手的记忆'],aYUunS:['Copy this prompt into a chat with your other AI assistant','将此提示词复制到与你另一个 AI 助手的聊天中'],he3ygx:['Copy','复制'],'6V3Ea3':['Copied','已复制'],'9A+Hw8':['Create a Bot to import memory','创建一个 Bot 来导入记忆'],k1G10P:['Couldn\'t send to {targetName}. Try again.','无法发送给 {targetName}。请重试。'],syvjPm:['That\'s too long. Paste a shorter export.','内容太长。请粘贴更短的导出内容。'],l3s5ri:['Import','导入'],cu6iol:['Close','关闭']};
function O77msg(o){const p=O77Loc[o.id];let s;try{s=p?RLocT(p[0],p[1]):o.id}catch(_e){s=p?p[0]:o.id}if(o.values)for(const k in o.values)s=s.split('{'+k+'}').join(String(o.values[k]==null?'':o.values[k]));return s}
function O77i18n(){return{_:o=>O77msg(o)}}
const O77i18nInstance={_:m=>typeof m==='string'?m:O77msg(m)};
function O77Trans(props){return O77msg(props)}
let O77TargetEntity=null;
function O77useMainAgent(){return O77TargetEntity&&O77TargetEntity.id||null}
function O77useSelAgent(){return null}
function O77useRoster(){return O77TargetEntity}
function O77useNavSelect(){return()=>{}}
function O77telemetry(){return{memoryImportAction(){}}}
function O77useSettings(){return O77react.useContext(O77SettingsCtx)}
function O77afterSend(e){e&&e.cursorAuth&&e.cursorAuth.status&&e.cursorAuth.status.kind==='logged-in'&&e.cursorAuth.clearError&&e.cursorAuth.clearError();e&&e.onClose&&e.onClose()}
function O77useSendPrompt(){return{sendPrompt:req=>{const g=window.desktop&&window.desktop.agent;if(!g||typeof g.importAgentMemory!=='function')return Promise.reject(new Error('bridge'));return Promise.resolve(g.importAgentMemory(req.agentId,req.prompt,req.richText)).then(r=>{if(!r||r.ok!==!0)throw new Error('send')})}}}
function O77useClipboard(){const[t,n]=O77react.useState(!1);const r=O77react.useCallback(text=>{const g=navigator.clipboard;Promise.resolve(g&&typeof g.writeText==='function'?g.writeText(text):Promise.reject()).then(()=>{n(!0);setTimeout(()=>n(!1),2500)},()=>{})},[]);return[t,r]}
const O77DialogRoot={Root:O77DialogRootImpl};
function O77ImportDialogPort(props){const ctx=O77react.useMemo(()=>({cursorAuth:{status:{kind:'logged-in'},clearError(){}},onClose:props.onClose}),[props.onClose]);return a.jsx(O77SettingsCtx.Provider,{value:ctx,children:a.jsx(O77ImportDialog,{onClose:props.onClose})})}
// official Er structure (Yt group title l3s5ri / X card description 6OUNRA /
// q button size md style body2 variant secondary label odeIN7) on the 0.18
// General-panel section & card kit — documented deviation (row chunk is 0.77-only)
function RImportSection(){
  const[open,setOpen]=O77react.useState(!1),[,force]=O77react.useState(0);
  O77react.useEffect(()=>{let on=!0;const g=window.desktop&&window.desktop.agent;Promise.resolve(g&&typeof g.getMainAgent==='function'?g.getMainAgent():null).then(id=>{if(!on||typeof id!=='string'||id.length===0)return;const entity={id:id,name:'',purpose:void 0};const finish=()=>{if(!on)return;O77TargetEntity=entity;force(x=>x+1)};if(g&&typeof g.getAgentDataOverview==='function'){Promise.resolve(g.getAgentDataOverview(id)).then(v=>{const n=v&&v.ok===!0&&v.data&&v.data.botProfile&&v.data.botProfile.name;if(typeof n==='string'&&n.length>0)entity.name=n}).catch(()=>{}).then(finish)}else finish()}).catch(()=>{});return()=>{on=!1}},[]);
  return a.jsxs(re,{title:O77msg({id:'l3s5ri'}),children:[
    a.jsx(ie,{description:O77msg({id:'6OUNRA'}),label:O77msg({id:'UwUr5z'}),variant:'card',children:a.jsx(O77Button,{onClick:()=>setOpen(!0),size:'md',style:O77Tokens.body2,type:'button',variant:'secondary',children:O77msg({id:'odeIN7'})})}),
    open?a.jsx(O77ImportDialogPort,{onClose:()=>setOpen(!1)}):null]})}
