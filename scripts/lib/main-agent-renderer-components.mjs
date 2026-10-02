export const MAIN_AGENT_STYLE = `
.r-main-avatar{display:inline-flex;position:relative;align-items:center;justify-content:center}
.r-main-badge{position:absolute;right:-2px;bottom:-2px;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:2px solid var(--sand-bg-elevated);border-radius:50%;background:var(--sand-fill-warning);color:var(--sand-text-on-color);pointer-events:none}
.r-main-avatar[data-layout=pinned]>.r-main-badge{width:20px;height:20px}
.r-main-intro{display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:16px}
.r-main-intro-avatar{position:relative;display:inline-flex;width:72px;height:72px}
.r-main-search{box-sizing:border-box;width:100%;padding:8px 12px;background:var(--sand-fill-secondary);color:var(--sand-text-primary);border:1px solid var(--sand-border-weak);border-radius:8px;font:inherit}
.r-main-candidates{display:flex;flex-direction:column;gap:8px;max-height:min(320px,50vh);overflow-y:auto;margin-top:16px}
.r-main-candidate{width:100%;justify-content:flex-start;text-align:left;white-space:normal}
.r-main-candidate-copy{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.r-main-candidate-description{color:var(--sand-text-secondary);font-weight:normal;font-size:12px}
.r-main-error{color:var(--sand-text-warning);margin:8px 0;white-space:normal}
.r-main-dialog{max-width:calc(100vw - 32px)}
`;

// Native 0.18 React, dialog, button, menu and agent-item bindings are reused.
//
// Two of these bindings do NOT accept what 0.66.0 uses, and the difference is invisible
// until the dialog is on screen, so both deviations are deliberate:
//
//   * `Gt.Root` is driven by `onOpenChange`, not `onClose`. 0.18's Dialog spreads its
//     remaining props into the primitive and every shipped call site passes
//     `onOpenChange`; nothing reads `onClose`. Since the Root is mounted with a hard-coded
//     `open:true` and unmounts only when the store clears `dialog`, an `onClose` prop
//     leaves Escape, the backdrop and the close button doing nothing at all.
//   * `width` is looked up in the kit's own table — `_in = {360, 380, 440, 460, 480,
//     500, 520, 608}` — and a miss yields `undefined`, i.e. the dialog silently renders
//     at the default width instead of failing. Official 0.66.0 uses 360/400; 0.18 has no
//     400, so the picker takes 440, the next size the kit actually ships.
export const MAIN_AGENT_COMPONENTS = String.raw`
let RMainView={loaded:false,agentId:null,dialog:null,forced:false,busy:false,error:null},RMainRevision=0;
const RMainListeners=new Set();
function RMainPublish(update){RMainView={...RMainView,...update};RMainListeners.forEach(listener=>listener())}
function RMainSubscribe(listener){RMainListeners.add(listener);return()=>RMainListeners.delete(listener)}
function RMainSnapshot(){return RMainView}
function RMainState(){return S.useSyncExternalStore(RMainSubscribe,RMainSnapshot,RMainSnapshot)}
function RMainT(en,zh){return typeof RLocT==='function'?RLocT(en,zh):zh}
function RMainStar(){return p.jsx('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true,children:p.jsx('path',{d:'m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01Z'})})}
function RMainAgentItem(props){
  const state=RMainState(),{base:Base,...rest}=props,id=props['data-agent-id'],main=state.loaded&&state.agentId===id;
  const corner=hnt({layout:props.layout,marker:props.marker,isWorking:props.isWorking,isActivityNamed:props.isPreviewActivity});
  const show=main&&props.layout!=='collapsed'&&corner.corner===null;
  const avatar=show?p.jsxs('span',{className:'r-main-avatar','data-layout':props.layout,children:[props.avatar,p.jsx('span',{className:'r-main-badge',role:'img','aria-label':RMainT('Main Bot','主 Bot'),children:p.jsx(RMainStar,{})})]}):props.avatar;
  return p.jsx(Base,{...rest,avatar,...main?{'aria-label':props.name+', '+RMainT('Main Bot','主 Bot')}:{} });
}
function RMainDeleteOrReplace(props){
  const state=RMainState();
  if(state.loaded&&state.agentId===props.id&&(props.batchCount??1)===1)return p.jsx(It.Item,{leading:p.jsx(bt,{name:'arrow-swap',size:'base'}),onSelect:()=>RMainPublish({dialog:'chooser',forced:false,error:null}),children:RMainT('Replace with different Bot','替换为其他 Bot')});
  return p.jsx(mcn,{batchCount:props.batchCount,id:props.id,onRequestDelete:props.onRequestDelete});
}
function RMainDialog({agents,onSave}){
  const state=RMainState(),[picked,setPicked]=S.useState(null),[query,setQuery]=S.useState('');
  const intro=state.dialog==='intro',candidates=agents.filter(agent=>!agent.isGroup&&agent.remoteRoom==null&&agent.viewerIsOwner!==false&&agent.id!==state.agentId&&String(agent.name??'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const valid=candidates.some(agent=>agent.id===picked);
  const close=()=>{if(!state.busy&&!state.forced)RMainPublish({dialog:null,error:null})};
  return p.jsxs(Gt.Root,{open:true,onOpenChange:next=>{if(!next)close()},closeOnBackdropClick:!state.forced&&!state.busy,closeOnEscape:!state.forced&&!state.busy,closeOnOutsidePress:!state.forced&&!state.busy,variant:'rich',width:intro?360:440,className:'r-main-dialog',children:[
    p.jsxs(Gt.Header,{children:[p.jsx(Gt.Title,{children:intro?RMainT('Introducing Primary Bot','认识主 Bot'):RMainT('Select main Bot','选择主 Bot')}),p.jsx(Gt.Description,{children:intro?RMainT('Primary Bot does work proactively. It is your go-to for everyday tasks, unblocks stuck work, and comes to you when it needs your help.','主 Bot 会主动做事。它是日常任务的首选，会解开卡住的工作，并在需要你帮忙时来确认。'):RMainT('Pick one of your existing Bots.','选择一个现有 Bot 作为主 Bot。')})]}),
    p.jsxs(Gt.Body,{children:[intro?p.jsx('div',{className:'r-main-intro',children:p.jsxs('span',{className:'r-main-intro-avatar',children:[p.jsxs('svg',{width:72,height:72,viewBox:'0 0 72 72','aria-hidden':true,children:[p.jsx('circle',{cx:36,cy:36,r:34,fill:'var(--sand-text-primary)'}),p.jsx('path',{d:'M28 26l2 7M45 23l2 7',stroke:'var(--sand-bg-elevated)',strokeWidth:5,strokeLinecap:'round'})]}),p.jsx('span',{className:'r-main-badge',role:'img','aria-label':RMainT('Main Bot','主 Bot'),children:p.jsx(RMainStar,{})})]})}):p.jsxs(p.Fragment,{children:[
      p.jsx('input',{className:'r-main-search','aria-label':RMainT('Search Bots','搜索 Bot'),placeholder:RMainT('Search Bots','搜索 Bot'),value:query,disabled:state.busy,onChange:event=>setQuery(event.target.value)}),
      p.jsx('div',{className:'r-main-candidates',role:'listbox','aria-label':RMainT('Your Bots','你的 Bot'),children:candidates.length?candidates.map(agent=>p.jsx(Qs,{className:'r-main-candidate',variant:agent.id===picked?'primary':'secondary',disabled:state.busy,onClick:()=>setPicked(agent.id),'aria-pressed':agent.id===picked,children:p.jsxs('span',{className:'r-main-candidate-copy',children:[p.jsx('span',{children:agent.name}),agent.description?p.jsx('span',{className:'r-main-candidate-description',children:agent.description}):null]})},agent.id)):p.jsx('p',{children:RMainT('No matching Bots','没有匹配的 Bot')})})]}),
      state.error?p.jsx('p',{className:'r-main-error',role:'alert',children:state.error}):null]}),
    p.jsxs(Gt.ActionBar,{children:intro?[
      p.jsx(Gt.Action,{disabled:state.busy,onClick:()=>RMainPublish({dialog:'chooser',error:null}),children:RMainT('Use an existing Bot','选择现有 Bot')}),
      p.jsx(Gt.Action,{variant:'primary',disabled:state.busy,onClick:()=>onSave(null),children:state.busy?RMainT('Creating…','正在创建…'):RMainT('Create Primary Bot','创建主 Bot')})
    ]:[
      p.jsx(Gt.Action,{disabled:state.busy,onClick:()=>RMainPublish({dialog:state.forced?'intro':null,error:null}),children:state.forced?RMainT('Back','返回'):RMainT('Cancel','取消')}),
      p.jsx(Gt.Action,{variant:'primary',disabled:state.busy||!valid,onClick:()=>valid&&onSave(picked),children:state.busy?RMainT('Saving…','正在保存…'):RMainT('Confirm','确认')})
    ]})]});
}
function RMainRoot({sidebar}){
  const state=RMainState(),side=S.useRef(sidebar);side.current=sidebar;
  S.useEffect(()=>{
    if(!sidebar.isHostReachable)return;
    let live=true;const bridge=window.desktop?.agent;
    if(typeof bridge?.getMainAgent!=='function')return;
    const read=async()=>{
      if(RMainView.busy)return;
      const revision=RMainRevision;
      try{const[id,seen]=await Promise.all([bridge.getMainAgent(),window.desktop.onboarding.getSeen()]);
        if(!live||revision!==RMainRevision)return;
        const agentId=typeof id==='string'&&id.length?id:null;
        RMainPublish({loaded:true,agentId,...agentId!==null&&RMainView.forced?{dialog:null,forced:false}:agentId===null&&seen===true&&RMainView.dialog===null?{dialog:'intro',forced:true,error:null}:{}});
      }catch(error){if(live&&RMainView.dialog)RMainPublish({error:String(error?.message??error)})}
    };
    void read();const timer=setInterval(read,5000);return()=>{live=false;clearInterval(timer)};
  },[sidebar.isHostReachable]);
  const save=async(id)=>{
    if(RMainView.busy)return;
    ++RMainRevision;RMainPublish({busy:true,error:null});
    try{const bridge=window.desktop.agent,result=id===null?await bridge.ensureMainAgent():await bridge.setMainAgent(id),agentId=typeof result==='string'?result:result?.agentId;
      if(typeof agentId!=='string'||!agentId.length)throw new Error(result?.outcome==='tombstoned'?RMainT('The default main Bot was deleted. Choose an existing Bot.','默认主 Bot 已删除，请选择一个现有 Bot。'):RMainT('Could not set the main Bot.','无法设置主 Bot。'));
      const pins=await bridge.getPinnedAgents();if(Array.isArray(pins))await side.current.onSetPinned(pins);
      RMainPublish({loaded:true,agentId,dialog:null,forced:false,busy:false,error:null});++RMainRevision;
      side.current.onOpenAgent(agentId);
    }catch(error){RMainPublish({busy:false,error:String(error?.message??error)});++RMainRevision}
  };
  return state.dialog?p.jsx(RMainDialog,{agents:sidebar.agents,onSave:save},state.dialog):null;
}
function u0n(props){return p.jsxs(p.Fragment,{children:[p.jsx(RMainOriginalSidebar,props),p.jsx(RMainRoot,{sidebar:props})]})}
`;
