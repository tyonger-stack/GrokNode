import { tokenizer } from "acorn";
import official from "./search-menu-0753-official.json" with { type: "json" };

const prefix = value => value.replace(/\bsand-([a-z0-9]+)(?![\w-])/g, "rsm0753-sand-$1");
const names = [...Object.keys(official.functions), ...Object.keys(official.variables)];
const rename = new Map(names.map(name => [name, "RSM0753" + name.replace("$", "Dollar")]));
for (const [before, after] of Object.entries({ X: "RSMReact", Y: "RSMJSX", Z: "RSMCache", ga: "RSMStyle", $: "RSMJoin", J: "RSMShortcutsI18n", ka: "RSMShortcutMessage", cC: "RSMDialog", uS: "RSMIcon" })) rename.set(before, after);

function portIdentifiers(source) {
  const edits = [];
  for (const token of tokenizer(source, { ecmaVersion: "latest" })) {
    if (token.type.label === "name" && rename.has(token.value)) edits.push({ start: token.start, end: token.end, text: rename.get(token.value) });
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

const shortcutFunctions = { ...official.functions };
shortcutFunctions.Jon = shortcutFunctions.Jon.replace('cC,{"aria-label":l,initialFocus:a', 'cC,{"aria-label":l,className:"rsm0753-shortcuts",style:RSMShortcutPalette(),initialFocus:a').replace('icon:`x`', 'icon:"close"');
const shortcutSource = portIdentifiers(prefix([
  ...Object.entries(official.variables).map(([name, value]) => `const ${name}=${value};`),
  ...Object.values(shortcutFunctions),
].join("\n")));

export const SEARCH_MENU_0753_STYLE = official.css;
export const SEARCH_MENU_0753_REFERENCE = { reference: official.reference, appSha256: official.appSha256, cssSha256: official.cssSha256 };
export const SEARCH_MENU_0753_COMPONENTS = `
const RSMCatalogs=JSON.parse(${JSON.stringify(JSON.stringify(official.messages))});
const RSMThemes=${JSON.stringify(official.themes)};
const RSMJSX=p,RSMReact=S,RSMCache=he,RSMStyle=Fe,RSMJoin=re,RSMDialog=DX,RSMIcon=fr;
let RSMKeyboardActions=[];
let RSMGroupActive=false;
let RSMClearRecipients=null;
let RSMShortcutsVisible=false;
const RSMShortcutsListeners=new Set();
function RSMText(en,zh){return typeof RLocT==='function'?RLocT(en,zh):zh}
function RSMCatalogText(value,values){if(typeof value==='string')return value;if(!Array.isArray(value))return '';return value.map(part=>typeof part==='string'?part:Array.isArray(part)&&typeof part[0]==='string'?String(values?.[part[0]]??''):'').join('')}
function RSMMessage(message){const en=RSMCatalogText(RSMCatalogs.en[message.id],message.values),zh=RSMCatalogText(RSMCatalogs.zh[message.id],message.values);return RSMText(en,zh||en)}
function RSMShortcutsI18n(){return{_:RSMMessage}}
function RSMShortcutMessage(props){return RSMMessage(props)}
function RSMShortcutPalette(){const theme=typeof document==='undefined'?'dark':document.querySelector('.sand-shell')?.dataset.theme??'dark';return RSMThemes[theme.includes('light')?'light':'dark']}
function RSMShortcutsPublish(open){RSMShortcutsVisible=open;RSMShortcutsListeners.forEach(listener=>listener())}
function RSMShortcutsSubscribe(listener){RSMShortcutsListeners.add(listener);return()=>RSMShortcutsListeners.delete(listener)}
function RSMShortcutsSnapshot(){return RSMShortcutsVisible}
function RSMOpenShortcuts(){RSMShortcutsPublish(true)}
function RSMOpenBot(){RSMGroupActive=false;RCreateBotOpen()}
function RSMOpenGroup(open){open();RSMClearRecipients();RSMGroupActive=true}
function RSMSearchCommands({leading,info,settings,trailing,openGroup,close}){
  const run=action=>()=>{RSearchPaletteSet(false);close();action()};
  return[
    {id:'new-bot',label:RSMMessage({id:'2hjDEV'}),icon:'plus',keywords:['create','bot','agent','chat'],run:run(RSMOpenBot)},
    {id:'new-group-chat',label:RSMMessage({id:'yqxI6O'}),icon:'people',keywords:['group','chat','room','bots','people'],run:run(()=>RSMOpenGroup(openGroup))},
    {id:'open-keyboard-shortcuts',label:RSMMessage({id:'77Emn0'}),icon:'keyboard',keywords:['shortcuts','hotkeys','keys','help','cheatsheet'],detail:RSMMessage({id:'c3XJ18'}),run:run(RSMOpenShortcuts)},
    ...leading.filter(row=>row.id!=='open-hidden-chats'),
    ...info.filter(row=>row.id==='info:members').map(row=>({...row,label:RSMMessage({id:'wlQNTg'}),detail:RSMMessage({id:'KeHQxt'})})),
    ...settings.map(row=>({...row,label:RSMMessage({id:'8OT456',values:{0:row.label}}),detail:RSMMessage({id:'Tz0i8g'})})),
    ...trailing,
  ];
}
${shortcutSource}
function RSMShortcutsHost(){const open=S.useSyncExternalStore(RSMShortcutsSubscribe,RSMShortcutsSnapshot,RSMShortcutsSnapshot);const groups=RSM0753Won({actions:RSMKeyboardActions,translate:RSMMessage,isMacPlatform:typeof navigator!=='undefined'&&navigator.platform.includes('Mac')});return open?p.jsx(RSM0753Jon,{groups,onClose:()=>RSMShortcutsPublish(false)}):null}
`;

function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Search menu ${label} anchor is missing or ambiguous.`);
  return source.replace(before, after);
}

export function patchSearchMenu0753(source) {
  if (source.includes("function RSMSearchCommands(")) throw new Error("Search menu patch was already applied.");
  let next = source;
  const edits = [
    ['computerUpdateAction:A,openComputerUpdateConfirm:I}),{open:ae', 'computerUpdateAction:A,openComputerUpdateConfirm:I,openNewGroupChat:J}),{open:ae', "group action wiring"],
    ['computerUpdateAction:u,openComputerUpdateConfirm:d}=n,m=S.useCallback', 'computerUpdateAction:u,openComputerUpdateConfirm:d,openNewGroupChat:RSMGroup}=n,m=S.useCallback', "group action input"],
    ['return[...t,...s,...v.map(E=>({id:qDn(E.id),label:`Settings: ${E.label}`,icon:E.icon,keywords:jDn[E.id],detail:"Settings",run:()=>i(E.id)})),{id:"overlay:plugins",label:"Plugins",icon:"plug",keywords:DDn,run:o},...NDn({preference:l,setPreference:c}),...r,...N==null?[]:[N]]', 'return RSMSearchCommands({leading:t,info:s,settings:v.map(E=>({id:qDn(E.id),label:E.label,icon:E.icon,keywords:jDn[E.id],run:()=>i(E.id)})),trailing:[{id:"overlay:plugins",label:"Plugins",icon:"plug",keywords:DDn,run:o},...NDn({preference:l,setPreference:c}),...r,...N==null?[]:[N]],openGroup:RSMGroup,close:h})', "official command catalog"],
    ['},[t,s,r,v,i,l,c,u,d]),x=S.useMemo', '},[t,s,r,v,i,l,c,u,d,RSMGroup,h]),x=S.useMemo', "catalog dependencies"],
    ['function DFn({row:n,tab:e}){if(e==="all")return kFn(n);', 'function DFn({row:n,tab:e}){if(n.kind==="command")return null;if(e==="all")return kFn(n);', "command type label"],
    ['{id:"sand.newAgent",label:"New Bot",hotkey:"mod+n",isEnabledInContentEditable:!0,run:J}', '{id:"sand.newAgent",label:"New Bot",hotkey:"mod+n",isEnabledInContentEditable:!0,run:RSMOpenBot},{id:"sand.newGroupChat",label:RSMMessage({id:"yqxI6O"}),hotkey:"mod+shift+n",isEnabledInContentEditable:!0,run:()=>RSMOpenGroup(J)},{id:"sand.keyboardShortcuts",label:RSMMessage({id:"77Emn0"}),hotkey:"mod+slash,mod+shift+slash",isEnabledInContentEditable:!0,run:RSMOpenShortcuts}', "official hotkeys"],
    ['return{handleCommandPaletteOpenAgent:F,handleCommandPaletteOpenMessage:z', 'RSMKeyboardActions=be;return{handleCommandPaletteOpenAgent:F,handleCommandPaletteOpenMessage:z', "shortcut registry"],
    ['p.jsx(RMainRoot,{sidebar:props})', 'p.jsx(RMainRoot,{sidebar:props}),p.jsx(RSMShortcutsHost,{})', "keyboard dialog mount"],
    ['r=n.filter(o=>!s.has(o.id)&&(e.length===0||!o.isGroup))', 'r=n.filter(o=>!s.has(o.id)&&((e.length===0&&!RSMGroupActive)||!o.isGroup))', "group recipient filter"],
    ['return jj(t).length===0?e.length===0?[{kind:"create-new"},...i]:i:', 'return jj(t).length===0?e.length===0&&!RSMGroupActive?[{kind:"create-new"},...i]:i:', "group recipient rows"],
    ['if(e.length===0)return s==null?{type:"noop"}:{type:"single",recipient:k2e(s),message:""};const i=Wf(t).length>0&&s!=null', 'if(e.length===0&&(!RSMGroupActive||s==null))return s==null?{type:"noop"}:{type:"single",recipient:k2e(s),message:""};const i=(RSMGroupActive||Wf(t).length>0)&&s!=null', "group commit selection"],
    ['return l!=null?{type:"single",recipient:l,message:""}:{type:"group",recipients:o,message:""}', 'return l!=null&&!RSMGroupActive?{type:"single",recipient:l,message:""}:{type:"group",recipients:o,message:""}', "group commit kind"],
    ['Me.kind==="create"?s.length===0:Me.agent.isGroup', 'Me.kind==="create"?s.length===0&&!RSMGroupActive:Me.agent.isGroup', "group picker click"],
    ['m=()=>{o([])},e[8]=m', 'm=()=>{RSMGroupActive=false;o([])},e[8]=m', "group mode reset"],
    ['const f=m;let h;return e[9]!==c||e[10]!==i', 'const f=m;RSMClearRecipients=f;let h;return e[9]!==c||e[10]!==i', "group recipient controller"],
  ];
  for (const [before, after, label] of edits) next = once(next, before, after, label);
  return next + SEARCH_MENU_0753_COMPONENTS;
}
