// The main Bot renderer injection, ported from Grok Bot 0.66.0.
//
// Everything below is bound to 0.18's own primitives rather than invented markup, because
// the dialog reads as "stock" only when it uses the same shell the rest of the app uses:
//
//   official 0.66   0.18 chunk      what it is
//   --------------  --------------  ---------------------------------------------
//   It              Gt              dialog namespace (Root/Header/Title/Body/ActionBar/Action)
//   Rs              ml              agent avatar  {agent, size, fillPx, isStatic, style}
//   As              Ar              ScrollArea    {maxHeight, contentStyle, ...rest}
//   dn              bt              icon          {name, size, rootStyle}
//   pn              vt              text          {as, size, rootStyle, ...rest}
//   qt              —               0.18 folds it into vt's own default, no extra layer
//
// The two things 0.66 does that 0.18's kit cannot express verbatim, both deliberate:
//
//   * `It.Root` is a passthrough driven by `onOpenChange`, never `onClose` — 0.18's Root
//     spreads its remaining props into the same primitive and every shipped call site
//     passes `onOpenChange`. An `onClose` prop leaves the dialog undismissable.
//   * `width` is looked up in the kit's own table, `{360, 380, 440, 460, 480, 500, 520,
//     608}`. 0.66 asks for 400; 0.18 has no 400 and a miss renders at the default width
//     rather than failing, so the picker takes 440, the next size the kit ships.
//
// 0.66.0 ships TWO main Bot pickers, and they are not the same dialog:
//
//   cP  the standalone one, reached from the sidebar's "Replace with different Bot" row.
//       Search row + 312px ScrollArea + Cancel/Confirm, title EE2rtW "Choose a primary Bot".
//   dP  the forced introduction, which owns its own intro screen AND a second, simpler
//       chooser: no search row, a 282px list, and title JA/+xd "Choose an existing Bot".
//
// The dialog reproduced here is cP, in both entries: it is the surface that was screenshotted,
// and it is the one with the search box. dP's introduction screen is reproduced as dP has it,
// including that its PRIMARY action is the SECOND button. Two things are drawn rather than
// bound, because 0.18 has no equivalent to borrow: the introduction's avatar (0.66 renders
// its seeded "grok-bot" avatar; 0.18 ships no seeded avatar keys) and the badge's star glyph
// (0.66 uses its `star` icon; 0.18's 627-name icon set has none). Everything else is 0.18's
// own primitive, 0.18's own stylesheet, or a string quoted from 0.66's message tables — the
// English table is `index.eager-app-Cj5f8Gby.js`, the zh-Hans table is
// `chunk-agents-adTkvWAu.js`, both keyed by the ids the components pass to their i18n
// component: `O9nsuv`, `12i8o8`, `YjO4Og`, `A1taO8`, `BIDT9R`, `EE2rtW`, `JA/+xd`, `dEgA5A`,
// `7VpPHA`, `tQvgov`, `u9Nmei`, `g4mJLN`, `rMNow6`, `mQQ/Uq`, and `V8a0q9` for the badge.
// Note that 0.66 says "primary Bot" in the dialog copy but "Main Bot" on the sidebar badge
// (`V8a0q9`); that asymmetry is reproduced rather than tidied up.

export const MAIN_AGENT_STYLE = `
.r-main-avatar{display:inline-flex;position:relative;align-items:center;justify-content:center}
.r-main-badge{position:absolute;right:-2px;bottom:-2px;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:2px solid var(--sand-bg-elevated);border-radius:50%;background:var(--sand-fill-warning);color:var(--sand-text-on-color);pointer-events:none}
.r-main-avatar[data-layout=pinned]>.r-main-badge{width:20px;height:20px}

/* Introduction (0.66's dP, step==="intro"): avatar, heading, one paragraph. The heading and
   copy are laid out here because 0.66's own rules for them are not among the 45 class names
   that survive into 0.18's sheet. */
.r-main-intro{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:16px}
.r-main-intro-avatar{position:relative;display:inline-flex;width:60px;height:60px}
.r-main-intro-title{font-weight:600}
.r-main-intro-copy{color:var(--sand-text-secondary)}
/* 0.66 gives both introduction buttons style Xs.half, i.e. equal halves of the bar. */
.r-main-half{flex:1 1 0}
.r-main-error{color:var(--sand-text-warning);margin:8px 0;white-space:normal}

/* Search row. 0.66 composes this from eleven stylex classes; 45 of its 47 picker classes
   resolve to the same names in 0.18 because a stylix hash is a hash of the declarations,
   and the two that do not exist ship without a rule in 0.66 either. Only the flex glue is
   written out here, so the parts that carry the real metrics still come from the bundle's
   own stylesheet rather than from a guess. */
.r-main-searchrow{display:flex;align-items:center;gap:8px;width:100%}
.r-main-searchrow>.r-main-searchicon{flex:none;color:var(--sand-text-tertiary)}
.r-main-searchrow>.r-main-searchinput{flex:1 1 auto;min-width:0;background:transparent;border:0;outline:none;font:inherit;color:inherit;padding:0}
.r-main-searchrow>.r-main-searchinput::placeholder{color:var(--sand-text-tertiary)}

/* Candidate row. 0.66 renders a bare <button role="radio"> carrying its own class list and
   a trailing check icon; the reset below is what keeps it from inheriting UA button chrome
   on top of those classes. */
.r-main-row{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;cursor:pointer;text-align:left;font:inherit;color:inherit}
.r-main-row:focus-visible{outline:2px solid var(--sand-border-focus);outline-offset:-2px}
.r-main-rowname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.r-main-row>.r-main-check{flex:none;margin-left:auto;color:var(--sand-text-primary)}
.r-main-list{padding:0}
.r-main-empty{color:var(--sand-text-tertiary)}
`;

// 0.66's `ql` style object, with each style written as the class list 0.66 actually emits.
// The names survive into 0.18 unchanged wherever the underlying declarations are the same.
//
// Two shapes are needed, and mixing them up is what once black-screened the app:
//
//   CLASSES  a plain "sand-… sand-…" string, for `className` on components that take one
//            (`vt`, `bt`, and the plain DOM elements this block renders itself).
//   OBJECT   a stylix style object, for every `style` prop. 0.66 passes objects, and so must
//            this block: 0.18's `Gt.Header`, `Gt.Body`, `Gt.ActionBar` and `Ar.contentStyle`
//            forward `style` straight into its own `Fe`/`ar` stylix merge. Handing that merge
//            a string makes it `for…in` over the string's characters and write
//            `element.style[0]`, which throws "Indexed property setter is not supported",
//            unwinds the app into its error boundary, and takes the whole window with it.
//            The symptom is invisible to typecheck, to the test suite and to packaging: the
//            crash only happens once the dialog is actually opened.
const RMAIN_CLASSES = {
  header: "sand-z9dl7a sand-sag5q8 sand-2vl965 sand-19145p9",
  body: "sand-78zum5 sand-dt5ytf sand-167g77z sand-z9dl7a sand-sag5q8",
  secondary: "sand-1o0liin",
  searchRow: "sand-78zum5 sand-6s0dn4 sand-9f619 sand-c9qbxq sand-dqyycr sand-mkeg23 sand-1y0btm7 sand-fnq37j sand-5obw34 sand-1t6ttyj sand-vvtkfd",
  searchIcon: "sand-w4jnvo sand-1qx5ct2 sand-169k319",
  searchInput: "sand-1iyjqo2 sand-euugli sand-1ghz6dp sand-1717udv sand-ng3xce sand-1a2a7pz sand-jbqb8w sand-jb2p0i sand-jyslct sand-tyxrsu sand-1h7ufjq",
  listContent: "sand-1dbijih",
  row: "sand-jyslct sand-78zum5 sand-6s0dn4 sand-fex06f sand-h8yej3 sand-1t0vds8 sand-dqyycr sand-1ghz6dp sand-ng3xce sand-1qmwy7c sand-jbqb8w sand-aalx5g sand-tyxrsu sand-jb2p0i sand-1ypdohk",
  rowName: "sand-1iyjqo2 sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft",
  actions: "sand-t8lcch",
  failure: "sand-6rl5ky",
};

/** Wrap a class list as a stylix style object. The key only has to be stable and unique
 *  within one merge; `$$css: true` is what marks the object as compiled styles rather than
 *  a dynamic inline style, which is what makes the runtime emit class names. */
const rmainObject = (classList, key) => `{${key}:"${classList}",$$css:true}`;

const RMAIN_STYLES = {
  header: rmainObject(RMAIN_CLASSES.header, "rMainHeader"),
  body: rmainObject(RMAIN_CLASSES.body, "rMainBody"),
  actions: rmainObject(RMAIN_CLASSES.actions, "rMainActions"),
  listContent: rmainObject(RMAIN_CLASSES.listContent, "rMainListContent"),
  failure: rmainObject(RMAIN_CLASSES.failure, "rMainFailure"),
};

export const MAIN_AGENT_COMPONENTS = String.raw`
const RMAIN_CLASSES={header:"${RMAIN_CLASSES.header}",body:"${RMAIN_CLASSES.body}",secondary:"${RMAIN_CLASSES.secondary}",searchRow:"${RMAIN_CLASSES.searchRow}",searchIcon:"${RMAIN_CLASSES.searchIcon}",searchInput:"${RMAIN_CLASSES.searchInput}",listContent:"${RMAIN_CLASSES.listContent}",row:"${RMAIN_CLASSES.row}",rowName:"${RMAIN_CLASSES.rowName}",actions:"${RMAIN_CLASSES.actions}",failure:"${RMAIN_CLASSES.failure}"};
const RMAIN_STYLES={header:${RMAIN_STYLES.header},body:${RMAIN_STYLES.body},actions:${RMAIN_STYLES.actions},listContent:${RMAIN_STYLES.listContent},failure:${RMAIN_STYLES.failure}};
const RMAIN_LIST_MAX=312;
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
/* Ported from 0.66.0's picker (function cP). Its shape, verbatim:
 *
 *     r        = rP(roster, currentMainId)          candidates
 *     m        = rH(pS({agents:r, ...}), query)     filtered + sidebar-sorted rows
 *     p        = m.some(id===picked) ? picked : null the pick, revalidated every render
 *     C        = r.length===0 ? "no candidates" : <>search row, m.length===0 ? "no
 *                  matches" : <As role="radiogroup" maxHeight=312>{rows}</As></>
 *
 * Two deliberate divergences, both because the source is not reachable from here:
 *
 *   * pS is 0.66's sidebar layout helper and is private to 0.66's sidebar. 0.18's
 *     equivalent is likewise private to its own sidebar, so the roster order is kept and
 *     only the filter (rP, reproduced exactly below) is ported.
 *   * Nn localises three of 0.66's own default bot names through its message table. 0.18
 *     ships no message table, so the agent's own name is rendered. Only those three seeded
 *     names are affected; every user-created bot already carries a display name.
 */
function RMainFold(value){
  // 0.66's Pn: lowercase, fold the Greek final sigma, and map the Turkish dotless i.
  // The Turkish branch is dropped with the locale argument — 0.18 has no locale to read.
  return String(value??'').toLocaleLowerCase().replaceAll('ς','σ');
}
function RMainCandidates({agents,current}){
  // 0.66's rP(t,e): t.filter(n=>!n.isGroup&&!Ff(n)&&n.id!==e), where Ff is
  // hr, i.e. viewerIsOwner===false. Groups and bots the user does not own are not
  // selectable, and the current main Bot is excluded because it is already the main Bot.
  return agents.filter(agent=>!agent.isGroup&&agent.viewerIsOwner!==false&&agent.id!==current);
}
function RMainPicker({candidates,query,onQuery,picked,onPick}){
  const state=RMainState();
  // 0.66's rH: an empty folded query returns everything, otherwise the folded query must
  // be a substring of the folded display name.
  const needle=RMainFold(query.trim());
  const rows=needle.length===0
    ? candidates
    : candidates.filter(agent=>RMainFold(agent.name).includes(needle));
  const empty=(message)=>p.jsx(vt,{as:'p',size:'md',role:'status',className:RMAIN_CLASSES.secondary+' r-main-empty',children:message});
  const list=rows.length===0
    ? empty(RMainT('No matching Bots','没有匹配的 Bot'))
    : p.jsx(Ar,{
        'aria-label':RMainT('Bots','Bot'),
        className:'r-main-list',
        contentStyle:RMAIN_STYLES.listContent,
        maxHeight:RMAIN_LIST_MAX,
        role:'radiogroup',
        children:rows.map(agent=>{
        const selected=agent.id===picked;
        const children=[
          p.jsx(ml,{agent,fillPx:24,size:'sm'}),
          p.jsx(vt,{as:'span',size:'md',className:RMAIN_CLASSES.rowName+' r-main-rowname',children:agent.name})
        ];
        if(selected)children.push(p.jsx(bt,{name:'check',size:'md',className:'r-main-check'}));
        return p.jsx('button',{
          className:RMAIN_CLASSES.row+' r-main-row',
          'aria-checked':selected,
          key:agent.id,
          onClick:()=>onPick(agent.id),
          role:'radio',
          type:'button',
          children
        });
      })
    });
  // 0.66 renders the search row only once there is something to search: with no candidate
  // Bots at all the body is a single status line.
  const content=candidates.length===0
    ? empty(RMainT('No other Bots to choose from yet','还没有其他可选的 Bot'))
    : [p.jsxs('div',{className:RMAIN_CLASSES.searchRow+' r-main-searchrow',children:[
        p.jsx(bt,{name:'search',size:'md',className:RMAIN_CLASSES.searchIcon+' r-main-searchicon','aria-hidden':true}),
        p.jsx('input',{
          className:RMAIN_CLASSES.searchInput+' r-main-searchinput',
          'aria-label':RMainT('Search Bots','搜索 Bot'),
          autoComplete:'off',
          placeholder:RMainT('Search','搜索'),
          spellCheck:false,
          value:query,
          onChange:event=>onQuery(event.currentTarget.value)
        })
      ]}),list];
  const body=[content];
  if(state.error)body.push(p.jsx(vt,{as:'p',size:'md',role:'alert',style:RMAIN_STYLES.failure,className:'r-main-error',children:state.error}));
  return p.jsx(Gt.Body,{style:RMAIN_STYLES.body,children:body});
}
function RMainIntro(){
  // 0.66's introduction (dP, step==="intro") stacks a 60px avatar carrying the main Bot
  // badge, the heading, one paragraph of copy, then the action bar. Two of those four cannot
  // be ported and are drawn here instead — 0.18 ships no seeded avatar keys at all (no
  // caller passes an avatarKey, and 0.66 renders its seeded "grok-bot" avatar) and its
  // 627-name icon set has no star, so the face and the badge glyph are the only hand-drawn
  // pixels in the dialog. Everything else is 0.18's own primitive or a quoted string.
  const face=p.jsxs('svg',{width:60,height:60,viewBox:'0 0 72 72','aria-hidden':true,children:[
    p.jsx('circle',{cx:36,cy:36,r:34,fill:'var(--sand-text-primary)'}),
    p.jsx('path',{d:'M28 26l2 7M45 23l2 7',stroke:'var(--sand-bg-elevated)',strokeWidth:5,strokeLinecap:'round'})
  ]});
  const badge=p.jsx('span',{className:'r-main-badge',role:'img','aria-label':RMainT('Main Bot','主 Bot'),children:p.jsx(RMainStar,{})});
  const framed=p.jsx('span',{className:'r-main-intro-avatar',children:[face,badge]});
  return p.jsx(Gt.Body,{style:RMAIN_STYLES.body,children:p.jsxs('div',{className:'r-main-intro',children:[
    framed,
    p.jsx(vt,{as:'p',size:'lg',className:'r-main-intro-title',children:RMainT('Introducing your primary Bot','认识你的主 Bot')}),
    p.jsx(vt,{as:'p',size:'md',className:'r-main-intro-copy',children:RMainT('Your main point of contact. It checks in proactively and coordinates work with your other Bots.','你的主要联系人。它会主动来看看，也能和其他 Bot 协调工作。')})
  ]})});
}
function RMainDialog({agents,onSave,mode}){
  const state=RMainState(),intro=mode==='intro',[picked,setPicked]=S.useState(null),[query,setQuery]=S.useState('');
  const candidates=RMainCandidates({agents,current:state.agentId});
  // 0.66 recomputes the pick against the FILTERED list (m.some(O=>O.id===u)?u:null), so a
  // pick the current filter hides disables Confirm instead of committing something invisible.
  const needle=RMainFold(query.trim());
  const rows=needle.length===0
    ? candidates
    : candidates.filter(agent=>RMainFold(agent.name).includes(needle));
  const valid=rows.some(agent=>agent.id===picked)?picked:null;
  const close=()=>{if(!state.busy&&!state.forced)RMainPublish({dialog:null,error:null})};
  // The introduction has no dialog header in 0.66: its heading lives inside the body, next
  // to the avatar. Only the chooser gets a Header/Title pair.
  const header=p.jsx(Gt.Header,{style:RMAIN_STYLES.header,children:p.jsx(Gt.Title,{children:RMainT('Choose a primary Bot','选择主 Bot')})});
  // 0.66's introduction bar is [Create primary Bot] then [Choose an existing Bot], and the
  // PRIMARY variant sits on the second one — the opposite of the usual "recommended is the
  // first button" arrangement. Reproduced as found.
  const actions=intro
    ? p.jsxs(Gt.ActionBar,{style:RMAIN_STYLES.actions,children:[
        p.jsx(Gt.Action,{disabled:state.busy,pending:state.busy,onClick:()=>onSave(null),className:'r-main-half',children:RMainT('Create primary Bot','创建主 Bot')}),
        p.jsx(Gt.Action,{variant:'primary',disabled:state.busy,onClick:()=>RMainPublish({dialog:'chooser',error:null}),className:'r-main-half',children:RMainT('Choose an existing Bot','选择现有 Bot')})]})
    : p.jsxs(Gt.ActionBar,{style:RMAIN_STYLES.actions,children:[
        p.jsx(Gt.Action,{onClick:close,children:RMainT('Cancel','取消')}),
        p.jsx(Gt.Action,{variant:'primary',disabled:state.busy||valid===null,pending:state.busy,onClick:()=>{if(valid!==null)onSave(valid)},children:RMainT('Confirm','确认')})]});
  // 0.66 asks for 400 in both pickers (cP's v=400, and dP's A=$2e where $2e=400).
  // 0.18's dialog kit has no 400 in its width table, and a miss renders at the default
  // width rather than failing, so both take 440 — the next size the kit ships.
  return p.jsx(Gt.Root,{onOpenChange:next=>{if(!next)close()},open:true,closeOnBackdropClick:!state.forced&&!state.busy,closeOnEscape:!state.forced&&!state.busy,closeOnOutsidePress:!state.forced&&!state.busy,variant:'rich',width:440,children:intro
    ? [p.jsx(RMainIntro,{}),actions]
    : [header,p.jsx(RMainPicker,{candidates,query,onQuery:setQuery,picked,onPick:setPicked}),actions]});
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
      if(typeof agentId!=='string'||!agentId.length)throw new Error(result?.outcome==='tombstoned'?RMainT('The default main Bot was deleted. Choose an existing Bot.','默认主 Bot 已删除，请选择一个现有 Bot。'):id===null?RMainT("Couldn't set the primary Bot",'无法设置主 Bot'):RMainT("Couldn't replace the main Bot",'无法替换主 Bot'));
      const pins=await bridge.getPinnedAgents();if(Array.isArray(pins))await side.current.onSetPinned(pins);
      RMainPublish({loaded:true,agentId,dialog:null,forced:false,busy:false,error:null});++RMainRevision;
      side.current.onOpenAgent(agentId);
    }catch(error){RMainPublish({busy:false,error:String(error?.message??error)});++RMainRevision}
  };
  return state.dialog?p.jsx(RMainDialog,{agents:sidebar.agents,mode:state.dialog,onSave:save}):null;
}
function u0n(props){return p.jsxs(p.Fragment,{children:[p.jsx(RMainOriginalSidebar,props),p.jsx(RMainRoot,{sidebar:props})]})}
`;
