// Grok Bot 0.59 routine surfaces on the pinned 0.18 renderer chunk: a pause/resume switch on every
// routine list row, and a read-only routine detail panel (Instruction / When to run / Webhook, then
// Pause-Resume · Test · Edit · Delete) for existing routines. Everything is injected into the chunk that
// already owns the routine list (K2n) and editor (_2n), so it reuses that chunk's controller hooks
// (iJt / lr / rJt), confirm dialog (S2), switch (Hlt), buttons (Qs / fr) and text (vt) instead of
// loading any 0.59 chunk. Strings go through RLocT, which main-i18n-patch appends to this chunk later
// (function declarations hoist), and fall back to English when it is absent.

const LIST_ANCHOR = "function K2n(n){const e=he.c(25),{agentId:t,";
const LIST_COMPONENT_BEFORE = 'l=U2n,c="sand-routine__list",u="roomy",d=s;';
const LIST_COMPONENT_AFTER = 'l=RRtOfficialList,c="sand-routine__list",u="roomy",d=s;';
const ROW_MAP_BEFORE = 'e[17]!==r?(k=v=>{const b=G2n(v);return p.jsx(H2n,{onClick:()=>r(v.id),rowClassName:"sand-routine__row",rowProps:{"data-routine-row":v.id},children:p.jsxs("span",{className:"sand-78zum5 sand-6s0dn4 sand-ehausa sand-h8yej3 sand-euugli",children:[p.jsx(Dr,{name:b.iconName,size:"md",style:b.iconStyle}),p.jsxs("span",{className:"sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-euugli",children:[p.jsx(vt,{color:"primary",truncate:!0,children:v.name}),p.jsx(vt,{color:"secondary",truncate:!0,children:b.detail})]})]})},v.id)},e[17]=r,e[18]=k):k=e[18]';
const ROW_MAP_AFTER = "k=v=>p.jsx(RRtOfficialRow,{agentId:t,automation:v,onOpen:r},v.id)";
// Official 0.75.8 renders the routine section heading as one flex row that carries the
// typography itself (13px / 18px / letter-spacing-sm / --sand-text-secondary) and indents
// the label by 12px, so the label sits 12px inside the card that follows it. 0.18 renders
// the heading with its own 16px white classes. Only the class list is ported: the
// "Create Routine" action stays, and 0.18's `sand-1qughib` (justify-content: space-between)
// is kept so that action keeps its place at the far edge — official 0.75.8 has no action
// in this heading, so there is no official layout to copy for it.
const HEADING_BEFORE = 'p.jsxs("div",{className:"sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-mix8c7",children:[p.jsx("span",{className:re("sand-info-pane__section-heading",Fe(FUe.sectionHeading,Us.medium).className),id:ye,children:"Routines"})';
const HEADING_AFTER = 'p.jsxs("div",{className:"sand-11wthnw sand-w8bs97 sand-14gdtuo sand-78zum5 sand-6s0dn4 sand-11twubx sand-t1q3vd sand-8fiw5y sand-1o0liin sand-1qughib",children:[p.jsx("span",{className:"sand-info-pane__section-heading",id:ye,children:"Routines"})';
const EDITOR_MOUNT_BEFORE = "p.jsx(_2n,{agentId:t.id,automation:V,";
const EDITOR_MOUNT_AFTER = "p.jsx(RRoutineSurface,{agentId:t.id,automation:V,";
const EMPTY_SECTION_BEFORE = '1:{className:"sand-78zum5 sand-dt5ytf sand-17d4w8g sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-2lwn1j"}}[!!Cmt(x)<<0].className';
const EMPTY_SECTION_AFTER = '1:{className:"sand-78zum5 sand-dt5ytf sand-17d4w8g"}}[!!Cmt(x)<<0].className';
const EMPTY_ROOT_BEFORE = 'v={className:"sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k sand-1v2ro7d sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-yamay9 sand-1l90r2v"},e[10]=v';
const EMPTY_ROOT_AFTER = 'v={className:"sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k"},e[10]=v';
const EMPTY_MOUNT_BEFORE = 'N=p.jsxs("div",{className:v.className,children:[b,x]})';
// Native single-row section: 18px heading + 6px gap + 2 × 18px text + 2 × 6px row padding.
const EMPTY_MOUNT_AFTER = 'N=p.jsxs("div",{className:v.className,style:{minHeight:72,flex:"none",gap:3},children:[b,x]})';

const COMPONENT_SOURCE = String.raw`
// Official 0.75.8 class lists for the info-pane routine surface, read off the running
// official app (com.anysphere.sand 0.75.8) with CDP. A stylix class name is the hash of
// its declarations, so a class the 0.18 stylesheet already carries means the same
// declarations and is used as-is; the classes 0.18 lacks are supplied by
// routine-surface-0758-official.css, copied verbatim from the official stylesheet.
const RRtOfficial={
card:"sand-9f619 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-f6zju3 sand-1tlft3r sand-cnij5n sand-tw3t59 sand-e8uvvx sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-hojbe8 sand-10e981r",
li:"sand-78zum5 sand-euugli",
rowOuter:"sand-9f619 sand-1n2onr6 sand-c8icb0 sand-78zum5 sand-6s0dn4 sand-ehausa sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-1yrsyyn sand-f159sx sand-10b6aqq sand-mzvs34 sand-1qmwy7c sand-jbqb8w sand-11hyl0l",
rowInner:"sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli",
group:"sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-1t137rt sand-1s928wv sand-1j6awrg sand-arstr8 sand-7cl8nr sand-1ybvw9k",
name:"ui-text ui-1acoasx ui-dj266r ui-14z9mp ui-at24cr ui-1lziwak ui-exx8yu ui-yri2b ui-18d9i69 ui-1c1uobl ui-vmahel ui-lh3980 ui-vxqr21 ui-1wd3ewq ui-6ikm8r ui-10wlt62 ui-lyipyv ui-jlip5 ui-kyw5k8 sand-11wthnw sand-w8bs97 sand-14gdtuo",
schedule:"ui-text ui-1acoasx ui-dj266r ui-14z9mp ui-at24cr ui-1lziwak ui-exx8yu ui-yri2b ui-18d9i69 ui-1c1uobl ui-vmahel ui-lh3980 ui-vxqr21 ui-19aaqeu ui-6ikm8r ui-10wlt62 ui-lyipyv ui-jlip5 ui-kyw5k8 sand-11wthnw sand-w8bs97 sand-14gdtuo sand-vrgn94",
switchWrap:"sand-1n2onr6 sand-1vjfegm sand-3nfvp2",
switchOn:"sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-149ho13 sand-qxvkua sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-1firant sand-wji4o3 sand-1td3qas sand-1qx5ct2 sand-46jg8d sand-isnujt sand-19phtnz sand-1cgqir sand-1moagsb sand-jhkic0",
switchOff:"sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-149ho13 sand-fwqdrz sand-19jy9ex sand-1g6zli8 sand-qxvkua sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-1firant sand-wji4o3 sand-1td3qas sand-1qx5ct2 sand-46jg8d sand-isnujt sand-19phtnz",
knobOn:"sand-9f619 sand-10l6tqk sand-s7f9wi sand-16rqkct sand-7qiiw0 sand-12sv23o sand-2hifos sand-1firant sand-wji4o3 sand-1kky2od sand-lup9mm sand-9p6ekw",
knobOff:"sand-9f619 sand-10l6tqk sand-s7f9wi sand-aoy8p5 sand-16rqkct sand-7qiiw0 sand-12sv23o sand-2hifos sand-1firant sand-wji4o3 sand-1kky2od sand-lup9mm"};
function RRtLoc(en,zh){return typeof RLocT==="function"?RLocT(en,zh):en}
function RRtHasWebhook(tr){return tr!=null&&(tr.type==="webhook"||tr.type==="group"&&Array.isArray(tr.listeners)&&tr.listeners.some(x=>x!=null&&x.type==="webhook"))}
function RRtTriggerLines(a){return String(a.triggerDescription??"").split(" or ").map(x=>x.trim()).filter(x=>x.length>0).map(x=>/^when its webhook url is called$/i.test(x)?{icon:"globe",text:RRtLoc("When a webhook fires","当 Webhook 被触发时")}:{icon:"clock",text:x.charAt(0).toUpperCase()+x.slice(1)})}
function RRtSummary(a){return RRtTriggerLines(a).map(x=>x.text).join(RRtLoc(" or "," 或 "))}
function RRtSeedComposer(text){const el=Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"]')).find(x=>x.offsetParent!==null);if(el==null)return!1;el.focus();const sel=window.getSelection();if(sel==null)return!1;const range=document.createRange();range.selectNodeContents(el);range.collapse(!1);sel.removeAllRanges();sel.addRange(range);const lead=(el.textContent??"").trim().length>0?" ":"";return document.execCommand("insertText",!1,lead+text)&&(el.textContent??"").includes(text)}
// Official 0.75.8 renders the routine list as an elevated card (--sand-bg-elevated,
// 12px radius, 0.5px translucent border, 4px padding) whose rows carry the name and the
// trigger description, and whose enabled switch is the accent-primary one (track
// --sand-bg-accent-primary, knob --sand-bg-luminous, no border).
//
// 0.18 renders the same list as a flush list on the pane background, with a gray
// --sand-fill-control-checked switch. The markup below is official's, class for class;
// the click and keyboard handling of the 0.18 row (open the routine) is kept because
// official's own trigger behaviour lives in a component 0.18 does not have.
function RRtOfficialList({label,labelledBy,density,children}){const level=density===void 0?"compact":density,a=label==null?{}:{"aria-label":label},b=labelledBy==null?{}:{"aria-labelledby":labelledBy};return p.jsx(Emt.Provider,{value:level,children:p.jsx("ul",{...a,...b,className:RRtOfficial.card,"data-density":level,children})})}
function RRtOfficialSwitch({checked,label,onToggle}){return p.jsxs("span",{className:RRtOfficial.switchWrap,children:[p.jsxs("button",{role:"switch",type:"button","aria-checked":checked?"true":"false","aria-label":label,className:checked?RRtOfficial.switchOn:RRtOfficial.switchOff,onClick:onToggle,children:p.jsx("span",{"aria-hidden":true,className:checked?RRtOfficial.knobOn:RRtOfficial.knobOff})})]})}
function RRtOfficialRow({agentId:t,automation:v,onOpen:r}){const{setEnabled:en}=iJt(),[opt,setOpt]=S.useState(null);opt!=null&&opt===v.isEnabled&&setOpt(null);const on=opt??v.isEnabled,ids="rrt-"+v.id,open=()=>r(v.id),keys=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open()}};return p.jsx("li",{className:RRtOfficial.li,children:p.jsx("div",{className:RRtOfficial.rowOuter,children:[p.jsx("div",{className:RRtOfficial.rowInner,children:p.jsxs("div",{className:RRtOfficial.group,role:"group",tabIndex:0,"aria-labelledby":ids+"-name "+ids+"-schedule","data-automation-row":v.id,onClick:open,onKeyDown:keys,children:[p.jsx("span",{className:RRtOfficial.name,id:ids+"-name","data-color":"primary",children:v.name}),p.jsx("span",{className:RRtOfficial.schedule,id:ids+"-schedule","data-color":"secondary",children:RRtSummary(v)})]})}),p.jsx(RRtOfficialSwitch,{checked:on,label:(on?RRtLoc("Pause ","暂停"):RRtLoc("Resume ","恢复"))+v.name,onToggle:()=>{const next=!on;setOpt(next);en(t,v.id,next).catch(()=>setOpt(null))}})]})})}
function RRtCopyField({label:l,value:v,placeholder:ph,tip:tip}){const[copied,setCopied]=S.useState(!1),has=typeof v==="string"&&v.length>0;return p.jsxs("div",{style:{alignItems:"center",display:"flex",gap:8},children:[p.jsx(vt,{as:"span",color:"secondary",size:"md",children:l}),p.jsx("input",{"aria-label":l,onClick:e=>{if(!has)return;e.currentTarget.select();navigator.clipboard?.writeText(v).then(()=>{setCopied(!0);window.setTimeout(()=>setCopied(!1),1200)},()=>{})},placeholder:has?"":ph,readOnly:!0,style:{background:"var(--cursor-bg-input,var(--cursor-bg-editor))",border:"1px solid var(--cursor-stroke-secondary)",borderRadius:6,color:"var(--cursor-text-secondary)",cursor:has?"copy":"default",flex:"1 1 auto",fontFamily:"var(--cursor-font-mono,ui-monospace,monospace)",fontSize:12,minWidth:0,padding:"4px 8px",textOverflow:"ellipsis"},title:tip,type:"text",value:has?v:""}),copied?p.jsx(vt,{as:"span",color:"secondary",size:"sm",children:RRtLoc("Copied","已复制")}):null]})}
function RRtWebhookCard({agentId:t,automationId:id}){const[c,setC]=S.useState({kind:"loading"});S.useEffect(()=>{let live=!0;setC({kind:"loading"});Promise.resolve(window.desktop?.agent?.getAutomationWebhookCredential?.(t,id)).then(x=>{live&&setC(x!=null&&typeof x.url==="string"&&typeof x.key==="string"?{kind:"ready",url:x.url,key:x.key}:{kind:"failed"})},()=>{live&&setC({kind:"failed"})});return()=>{live=!1}},[t,id]);const ph=c.kind==="loading"?RRtLoc("Loading…","加载中…"):RRtLoc("Couldn't load","无法加载"),url=c.kind==="ready"?c.url:null,key=c.kind==="ready"?c.key:null;return p.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:8},children:[p.jsx(RRtCopyField,{label:RRtLoc("POST to","POST 到"),placeholder:ph,value:url}),p.jsx(RRtCopyField,{label:RRtLoc("key","密钥"),placeholder:ph,tip:RRtLoc('Senders authenticate with this key: include an "Authorization: Bearer <key>" header in the webhook request.',"发送方使用此密钥进行身份验证：在 Webhook 请求中加入 “Authorization: Bearer <key>” 请求头。"),value:key}),p.jsx(RRtCopyField,{label:RRtLoc("header","标头"),placeholder:ph,value:key==null?null:"Authorization: Bearer "+key}),p.jsx(vt,{as:"span",color:"tertiary",size:"sm",children:RRtLoc("This is the local Grok Node endpoint. From inside this Bot's own box, call host.docker.internal on the same port.","这是本机 Grok Node 端点；在该 Bot 自己的容器里调用时，把 127.0.0.1 换成 host.docker.internal。")})]})}
function RRoutineDetail({agentId:t,automation:s,onDeleted:del,onEdit:onEdit}){const ctl=iJt(),en=lr(ctl.setEnabled),run=lr(ctl.runNow),blocked=rJt({agentId:t,automationId:s.id}),confirm=S2(),[opt,setOpt]=S.useState(null),[fail,setFail]=S.useState(null);opt!=null&&opt===s.isEnabled&&setOpt(null);const on=opt??s.isEnabled,running=run.isPending||blocked||s.runs?.[0]?.status==="running",hook=RRtHasWebhook(s.trigger),failText={pause:RRtLoc("Couldn't pause this routine.","无法暂停此例行任务。"),resume:RRtLoc("Couldn't resume this routine.","无法恢复此例行任务。"),test:RRtLoc("Couldn't start a test run.","无法开始测试运行。")};const toggle=()=>{const next=!on;setFail(null);setOpt(next);en.run(t,s.id,next).catch(()=>{setOpt(null);setFail(next?"resume":"pause")})};const test=()=>{setFail(null);run.run(t,s.id).catch(()=>setFail("test"))};const edit=()=>{RRtSeedComposer(RRtLoc("Edit your routine: ","编辑你的例行任务：")+s.name)||onEdit()};const remove=()=>{setFail(null);confirm({title:RRtLoc("Delete “","删除“")+s.name+"”",description:RRtLoc("This deletes the routine and stops its future runs. This can't be undone.","这将删除例行任务并停止其后续运行。此操作无法撤销。"),confirmLabel:RRtLoc("Delete","删除"),pendingLabel:RRtLoc("Deleting...","正在删除…"),cancelLabel:RRtLoc("Cancel","取消"),destructive:!0,perform:async()=>{try{return await ctl.remove(t,s.id),del(),null}catch{return RRtLoc("Deleting failed. Check your connection and try again.","删除失败。请检查网络连接后重试。")}}})};const sections=[p.jsx(uhe,{title:RRtLoc("Instruction","指令"),children:p.jsx("div",{className:Fe(Ut.body2).className,style:{overflowWrap:"anywhere",userSelect:"text",whiteSpace:"pre-wrap"},children:s.prompt})},"instruction"),p.jsx(uhe,{title:RRtLoc("When to run","何时运行"),children:p.jsx("ul",{"aria-label":RRtLoc("When to run","何时运行"),style:{display:"flex",flexDirection:"column",gap:6,listStyle:"none",margin:0,padding:0},children:RRtTriggerLines(s).map((x,i)=>p.jsxs("li",{className:Fe(Ut.body2).className,style:{alignItems:"center",display:"flex",gap:8},children:[p.jsx(Dr,{name:x.icon,size:"md"}),x.text]},i))})},"when"),hook?p.jsx(uhe,{title:"Webhook",children:p.jsx(RRtWebhookCard,{agentId:t,automationId:s.id})},"webhook"):null];return p.jsxs("div",{className:re("sand-automation-detail sand-routine-detail","sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-2lwn1j"),"data-routine-detail":s.id,children:[p.jsx(Ar,{className:"sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-2lwn1j",viewportStyle:m3.bodyViewport,children:p.jsx("div",{className:"sand-78zum5 sand-dt5ytf sand-1v2ro7d sand-9f619 sand-1iorvi4 sand-nuq7ks sand-1l90r2v sand-f18ygs",children:sections})}),p.jsxs("div",{style:{borderTop:"1px solid var(--cursor-stroke-secondary)",display:"flex",flexDirection:"column",gap:8,padding:"12px 16px"},children:[fail==null?null:p.jsx("div",{className:Fe(Ut.body2).className,role:"alert",style:{color:"var(--cursor-text-red,#e5484d)"},children:failText[fail]}),p.jsxs("div",{style:{alignItems:"center",display:"grid",gap:8,gridTemplateColumns:"1fr 1fr 1fr auto"},children:[p.jsx(Qs,{disabled:en.isPending,onClick:toggle,variant:"secondary",children:on?RRtLoc("Pause","暂停"):RRtLoc("Resume","恢复")}),p.jsx(Qs,{disabled:running,onClick:test,variant:"secondary",children:running?RRtLoc("Running…","运行中…"):RRtLoc("Test","测试")}),p.jsx(Qs,{onClick:edit,variant:"secondary",children:RRtLoc("Edit","编辑")}),p.jsx(fr,{"aria-label":RRtLoc("Delete routine","删除例行任务"),icon:"trash",onClick:remove,shape:"circle"})]})]})]})}
function RRoutineSurface(n){const[startedCreate]=S.useState(n.automation==null),[editing,setEditing]=S.useState(!1);return n.automation==null?startedCreate?p.jsx(_2n,{...n}):null:startedCreate||editing?p.jsx(_2n,{...n}):p.jsx(RRoutineDetail,{...n,onEdit:()=>setEditing(!0)})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error("Original renderer " + label + " anchor must appear exactly once.");
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalRoutineSurfaces(source) {
  let patched = replaceExactlyOnce(source, LIST_ANCHOR, COMPONENT_SOURCE + LIST_ANCHOR, "routine component insertion");
  patched = replaceExactlyOnce(patched, LIST_COMPONENT_BEFORE, LIST_COMPONENT_AFTER, "routine list card");
  patched = replaceExactlyOnce(patched, ROW_MAP_BEFORE, ROW_MAP_AFTER, "routine list row switch");
  patched = replaceExactlyOnce(patched, HEADING_BEFORE, HEADING_AFTER, "routine section heading");
  patched = replaceExactlyOnce(patched, EMPTY_SECTION_BEFORE, EMPTY_SECTION_AFTER, "known-empty routine overview wrapper");
  patched = replaceExactlyOnce(patched, EMPTY_ROOT_BEFORE, EMPTY_ROOT_AFTER, "known-empty routine root");
  patched = replaceExactlyOnce(patched, EMPTY_MOUNT_BEFORE, EMPTY_MOUNT_AFTER, "known-empty routine height");
  return replaceExactlyOnce(patched, EDITOR_MOUNT_BEFORE, EDITOR_MOUNT_AFTER, "routine detail surface");
}
