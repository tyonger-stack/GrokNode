// 0.75.8 choice/schedule dialog shell, adapted to one local data-preserving restart.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'acorn';

export const COMPUTER_UPGRADE_COMPONENT = `
function RComputerUpgrade0758({onUpdate,disabled}){
  const api=window.desktop?.foreverBox;
  const [view,setView]=S.useState(null),[schedule,setSchedule]=S.useState(null),[busy,setBusy]=S.useState(false),[error,setError]=S.useState(null),[localTime,setLocalTime]=S.useState("");
  const focus=S.useRef(null),inFlight=S.useRef(false),mounted=S.useRef(false);
  S.useEffect(()=>{mounted.current=true;let active=true;const refresh=()=>{if(inFlight.current)return;api.getUpgradeSchedule().then(result=>{if(active)setSchedule(result.schedule)},()=>{if(active)setError(RLocT("Couldn't load the update schedule. Try again.","无法加载更新排程，请重试。"))})};refresh();const timer=setInterval(refresh,15000);return()=>{active=false;mounted.current=false;clearInterval(timer)}},[api]);
  const run=async action=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);try{const result=await action();if(mounted.current){if(result&&"schedule"in result)setSchedule(result.schedule);setView(null)}}catch(cause){if(mounted.current)setError(RLocT("Couldn't save the update schedule. Check the time and try again.","无法保存更新排程，请检查时间后重试。"))}finally{inFlight.current=false;if(mounted.current)setBusy(false)}};
  const edit=()=>{const date=new Date(schedule?.state==="scheduled"?schedule.scheduledAtMs:Date.now()+3600000);setLocalTime(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16));setView("schedule");setError(null)};
  const save=()=>{const timestamp=new Date(localTime).getTime();if(!Number.isFinite(timestamp)||timestamp<=Date.now()){setError(RLocT("Choose a future update time.","请选择未来的更新时间。"));return}return run(()=>schedule==null?api.scheduleUpgrade(timestamp):api.rescheduleUpgrade(timestamp))};
  const terminal=schedule!=null&&schedule.state!=="scheduled"&&schedule.state!=="running";
  const label=schedule?.state==="scheduled"?RLocT("Reschedule update","重新安排更新"):schedule?.state==="running"?RLocT("Updating…","正在更新…"):RLocT("Update","更新");
  const status=schedule==null?null:schedule.state==="scheduled"?RLocT("Update scheduled for ","更新安排于 ")+new Date(schedule.scheduledAtMs).toLocaleString():schedule.state==="running"?RLocT("Updating…","正在更新…"):schedule.state==="completed"?RLocT("Computer restarted","电脑已重启"):schedule.state==="missed"?RLocT("Update window missed. Reschedule the update.","已错过更新窗口，请重新安排。"):schedule.state==="cancelled"?RLocT("Update cancelled","更新已取消"):RLocT("Couldn't update the computer. Check your connection and try again.","无法更新电脑。请检查网络连接后重试。");
  const button=(text,onClick,extra={})=>p.jsx(Qs,{className:"sand-settings-reset",disabled:disabled||busy||schedule?.state==="running",onClick,shape:"rectangular",size:"md",style:[Ut.body2,jne.settingsConfirmAction,jne.updateWeakBorder],type:"button",variant:"secondary",...extra,children:text});
  const description=RLocT("Restart the local computer at the chosen time and keep its data. Running tasks may be interrupted. Keep Grok Node open. This does not download a new image. Updates missed by more than 15 minutes must be rescheduled.","在指定时间保留数据重启本地电脑，运行中的任务可能中断。请保持 Grok Node 开启；此操作不会下载新镜像。错过超过 15 分钟后需重新安排。");
  const close=()=>{if(!inFlight.current)setView(null)};
  return p.jsxs(p.Fragment,{children:[
    p.jsxs("div",{className:"sand-computer-upgrade-status sand-78zum5 sand-dt5ytf sand-11wthnw",children:[status==null?null:p.jsx("span",{role:"status",children:status}),p.jsxs("div",{className:"sand-78zum5 sand-6s0dn4 sand-11wthnw",children:[button(label,()=>schedule?.state==="scheduled"?edit():setView("choice")),schedule?.state==="scheduled"?button(RLocT("Cancel update","取消更新"),()=>run(()=>api.cancelUpgrade(false))):terminal?button(RLocT("Dismiss","关闭"),()=>run(()=>api.cancelUpgrade(true))):null]})]}),
    error==null?null:p.jsx("div",{role:"alert",children:error}),
    view==null?null:p.jsxs(Gt.Root,{className:view==="choice"?"sand-computer-upgrade-choice-dialog":"sand-computer-upgrade-schedule-dialog",open:true,width:440,initialFocus:focus,closeOnBackdropClick:!busy,closeOnEscape:!busy,closeOnOutsidePress:!busy,onOpenChange:open=>{if(!open)close()},children:[
      p.jsxs(Gt.Header,{children:[p.jsx(Gt.Title,{children:view==="choice"?RLocT("Update computer","更新电脑"):schedule==null?RLocT("Schedule update","安排更新"):RLocT("Reschedule update","重新安排更新")}),p.jsx(Gt.Description,{children:description})]}),
      view==="schedule"?p.jsx(Gt.Body,{children:p.jsxs("label",{className:"sand-78zum5 sand-dt5ytf sand-11wthnw",children:[RLocT("Update time","更新时间"),p.jsx("input",{className:"sand-computer-upgrade-schedule-dialog__time sand-9f619 sand-h8yej3 sand-1y0btm7 sand-17tbahu sand-10e981r sand-tyxrsu",type:"datetime-local",ref:focus,required:true,disabled:busy,value:localTime,onChange:event=>setLocalTime(event.currentTarget.value)})]})}):null,
      error==null?null:p.jsx(Gt.Body,{children:p.jsx("div",{role:"alert",children:error})}),
      p.jsxs(Gt.ActionBar,{children:view==="choice"?[p.jsx(Gt.Action,{disabled:busy,onClick:edit,children:RLocT("Schedule update","安排更新")}),p.jsx(Gt.Action,{disabled:disabled||busy,ref:focus,variant:"primary",onClick:()=>run(async()=>{if(schedule?.state==="scheduled")await api.cancelUpgrade(false);await onUpdate()}),children:RLocT("Update now","立即更新")})]:[p.jsx(Gt.Action,{disabled:busy,onClick:close,children:RLocT("Cancel","取消")}),p.jsx(Gt.Action,{disabled:busy||localTime.length===0,onClick:save,variant:"primary",children:RLocT("Save","保存")})]})
    ]})
  ]})
}
`;

export function patchComputerUpgradeSchedule0758(source){
  if(source.includes('function RComputerUpgrade0758('))throw new Error('Computer schedule already patched');
  if(!source.includes('function RLocT(')||!source.includes('const Gt={Root:Oin,Action:zin,'))throw new Error('Computer schedule requires localized dialog kit');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const component=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='vKn');
  if(!component)throw new Error('Computer settings component is missing');
  const before=source.slice(component.start,component.end),anchor='p.jsx(mDn,{action:R})';
  if(before.split(anchor).length!==2)throw new Error('Computer schedule action anchor must match once');
  const after=before.replace(anchor,'p.jsx(mDn,{action:p.jsxs(p.Fragment,{children:[R,p.jsx(RComputerUpgrade0758,{disabled:l||t||s,onUpdate:()=>m(!1)})]})})');
  const patched=source.slice(0,component.start)+after+source.slice(component.end)+COMPUTER_UPGRADE_COMPONENT;
  parse(patched,{ecmaVersion:'latest',sourceType:'module'});return patched;
}
export async function applyComputerUpgradeSchedule0758Patch({stageRoot}){
  const file=path.join(stageRoot,'dist/renderer/assets/index-UbX-y3il.js');
  const source=await readFile(file,'utf8'),patched=patchComputerUpgradeSchedule0758(source);
  await writeFile(file,patched);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const result={schemaVersion:1,referenceVersion:'0.75.8',reference:'chunk-view-KUSBlG8Y.js vt/yt',scope:'One-shot local data-preserving restart; no cloud image replacement or automatic future update subscription',originalSha256:hash(source),patchedSha256:hash(patched)};
  await writeFile(path.join(stageRoot,'dist/renderer-computer-upgrade-schedule-0758.json'),JSON.stringify(result,null,2)+'\n');return result;
}
