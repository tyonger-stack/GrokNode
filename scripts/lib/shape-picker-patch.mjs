import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parse} from "acorn";
import {simple} from "acorn-walk";
import {createOfficialAvatarEngine} from "./computer-sleep-official/avatar-engine.mjs";
export const OFFICIAL_SHAPES=Object.freeze(["blob","cloud","square","sparkle","clover","heart","flower","teardrop","tablet","wedge","house","star","hex","pumpkin"]);
const ARTIFACTS=path.join(path.dirname(fileURLToPath(import.meta.url)),"computer-sleep-official");
const ORIGINAL='const Ij=["blob","pebble","squircle","tablet","wedge","hex","cloud","teardrop"];';
const JO_TAIL='teardrop:Po("Teardrop",r_t(88,Re-114,Re+26,18)),leaf:Po("Leaf",i_t(88,113,1.5))};';
const hash=text=>createHash("sha256").update(text).digest("hex");
const ZH_LABELS={blob:"团块",cloud:"云朵",square:"方形",sparkle:"星芒",clover:"四叶草",heart:"爱心",flower:"花朵",teardrop:"水滴",tablet:"药片",wedge:"楔形",house:"房子",star:"星形",hex:"六边形",pumpkin:"南瓜形"};
const ZH_COLORS={black:"黑色",brown:"棕色",red:"红色",orange:"橙色",yellow:"黄色",green:"绿色",cyan:"青色",blue:"蓝色",violet:"紫罗兰色",magenta:"品红色",gray:"灰色"};
const LABELS={blob:"Blob",cloud:"Cloud",square:"Square",sparkle:"Sparkle",clover:"Clover",heart:"Heart",flower:"Flower",teardrop:"Teardrop",tablet:"Tablet",wedge:"Wedge",house:"House",star:"Star",hex:"Hex",pumpkin:"Pumpkin"};
function one(source,text){if(source.split(text).length!==2)throw Error("Avatar patch anchor missing or ambiguous: "+text);return source.replace(text,"");}
function avatarViewRuntime(){
return `
function RCompOfficialAvatarEngine(){return RCompOfficialAvatarEngine.value??=createOfficialAvatarEngine(S,p)}
function RCompOfficialAvatarView(n){
 const e=RCompOfficialAvatarEngine(),ref=S.useRef(null),signal=S.useRef(n.spinSignal);
 S.useEffect(()=>{if(n.spinSignal!==signal.current){signal.current=n.spinSignal;ref.current?.poke("spin")}},[n.spinSignal]);
 const capture=S.useCallback(value=>{ref.current=value;const handle=value==null?null:{...value,spin:(turns=1)=>{if(!n.paused)value.poke("spin",{turns})},bounce:()=>{if(!n.paused)value.poke("bounce")},burst:()=>{if(!n.paused)value.poke("bounce")}};if(typeof n.ref==="function")n.ref(handle);else if(n.ref)n.ref.current=handle},[n.ref,n.paused]);
 const paint=n.ink??(n.color==="black"?MNe("black"):PQ.find(c=>c.id===n.color)?.value??"var(--fg)");
 const body=e.body(n.shape==null||n.shape===""?"sphere":n.shape);
 return p.jsx(e.Mark,{body,appearance:e.appearance(paint),fill:e.fill,size:n.size??"100%",resolution:192,state:n.state,isPlaying:!n.paused,isEmphasized:n.emphasis,isFollowingPointer:n.isFollowingPointer,id:n.id,ref:capture});
}
function RCompOfficialAvatarMirror({sourceId}){
 const extent=RCompOfficialAvatarEngine().fillScale*100+"%";
 return p.jsx("span",{"aria-hidden":true,style:{display:"inline-block",position:"relative",flexShrink:0,width:"100%",height:"100%",lineHeight:0},children:p.jsx("svg",{style:{position:"absolute",left:"50%",top:"50%",width:extent,height:extent,transform:"translate(-50%, -50%)",pointerEvents:"none"},children:p.jsx("use",{height:"100%",href:"#"+sourceId,width:"100%"})})});
}
function RCompAvatarSuffix(kind){return typeof RLocT==="function"?RLocT(" character "+kind,kind==="shape"?"角色形状":"角色颜色"):" character "+kind}
function RCompAvatarOutline(shape){
 const e=RCompOfficialAvatarEngine(),sizePx=36,inflatePx=1,gapPx=3,body=e.body(shape);
 const base=sizePx*e.fill/e.fit(body),o=inflatePx+gapPx,canvas=base+o*2;
 const white=e.outline({body,fill:e.fill,inflate:o,paint:"#fff",size:base}),black=e.outline({body,fill:e.fill,inflate:gapPx,paint:"#000",size:base});
 const mask='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+canvas+' '+canvas+'"><mask id="r"><g transform="translate('+o+' '+o+')">'+white+black+'</g></mask><rect width="'+canvas+'" height="'+canvas+'" fill="#000" mask="url(#r)"/></svg>')+'")';
 return {inset:(48-canvas)/2,maskImage:mask,WebkitMaskImage:mask};
}
`;
}
export function officialPicker({agent,character,staged,isCharacterActive}){
 const sample={id:agent.id,avatarShape:staged?.avatarShape??agent.avatarShape??null,avatarColor:staged?.avatarColor??agent.avatarColor??null};
 const color=Cee(sample),shape=Eee(sample);
 const shapes=Ij.includes(shape)?Ij:[...Ij,shape];
 const labels=RCompAvatarLabels();
 const rows=[];
 for(let at=0;at<shapes.length;at+=5)rows.push(shapes.slice(at,at+5));
 return p.jsxs("div",{className:"sand-agent-character sand-78zum5 sand-dt5ytf sand-1oot3zn",children:[
 p.jsx("div",{"aria-label":"Character shape",className:"sand-78zum5 sand-dt5ytf sand-ehausa sand-uve7l6 sand-1rgtt3y",children:rows.map((row,index)=>p.jsx("div",{className:"r-avatar-shape-row sand-78zum5 sand-l56j7k",children:row.map(candidate=>{
 const selected=!!isCharacterActive&&shape===candidate,label=labels[candidate]??candidate;
 return p.jsxs("button",{"aria-label":label+RCompAvatarSuffix("shape"),"aria-pressed":selected,className:"sand-agent-character__shape sand-jyslct sand-1lugfcp sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-9f619 sand-1717udv sand-jbqb8w sand-1ypdohk sand-1n2onr6 sand-1useyqa sand-sdox4t sand-c342km sand-ng3xce sand-1t137rt",onClick:()=>character.commitCharacter({avatarShape:candidate}),title:label,type:"button",children:[
 p.jsx(sd,{color,paused:true,shape:candidate,sizePx:36}),
 p.jsx("span",{"aria-hidden":true,className:"r-avatar-shape-outline",style:RCompAvatarOutline(candidate)})
 ]},candidate);
 })},index))}),
 p.jsx("div",{"aria-label":"Character color",className:"r-avatar-colors sand-78zum5 sand-1a02dak sand-6s0dn4 sand-l56j7k sand-ehausa sand-13ly8rp sand-1xlntvz",children:PQ.map(candidate=>p.jsx("button",{"aria-label":RCompAvatarColorLabel(candidate)+RCompAvatarSuffix("color"),"aria-pressed":!!isCharacterActive&&color===candidate.id,className:Fe($we.cell,$we.colorCell,_s.keyboardFocus,!!isCharacterActive&&color===candidate.id&&$we.colorCellSelected).className,onClick:()=>character.commitCharacter({avatarColor:candidate.id}),title:RCompAvatarColorLabel(candidate),type:"button",children:p.jsx("span",{className:"r-avatar-color-swatch",style:{backgroundColor:candidate.id==="black"?MNe("black"):candidate.value}})},candidate.id))})
 ]});
}
export function patchShapePicker(source,joAdditions,engineSource){
 if(source.includes("function RCompOfficialAvatarEngine"))throw Error("Avatar patch already applied.");
 const ast=parse(source,{ecmaVersion:"latest",sourceType:"module"});
 const funcs=new Map();
 for(const node of ast.body)if(node.type==="FunctionDeclaration"&&["sd","e3n"].includes(node.id?.name)){if(funcs.has(node.id.name))throw Error("Duplicate avatar function");funcs.set(node.id.name,node);}
 if(funcs.size!==2)throw Error("Avatar functions missing.");
 one(source,ORIGINAL);one(source,JO_TAIL);
 if(typeof engineSource!=="string")throw Error("Official avatar engine source required.");
 const sd=funcs.get("sd"),picker=funcs.get("e3n");
 const anchor="p.jsx($_t,{...W,...H,emphasis:A";
 const edits=[];
 simple(ast,{FunctionDeclaration(node){
  const body=source.slice(node.start,node.end);
  if(node.id?.name==="sd"&&body.includes('"sand-grok-bot-mark"')){
   one(body,anchor);
   edits.push([node,body.replace(anchor,"p.jsx(RCompOfficialAvatarView,{...W,...H,color:t,ink:r?.flat,isFollowingPointer:I,emphasis:A").replace("lnt(x)",'lnt(Jo[x]?x:"blob")').replace("$de(x)",'$de(Jo[x]?x:"blob")')]);
  }
  if(node.id?.name==="Eee"&&body.includes("Qtt.find(t=>t===n.avatarShape)"))edits.push([node,body.replace("Qtt.find(t=>t===n.avatarShape)","("+JSON.stringify(OFFICIAL_SHAPES)+".find(t=>t===n.avatarShape)??Qtt.find(t=>t===n.avatarShape))")]);
  // Official 0.71.2 mR/XN mirrors the 192px source with the same fill as the
  // live mark. The 0.18 viewBox drops that fill wrapper and shrinks rail marks.
  if(node.id?.name==="Nlt"&&body.includes('"sand-grok-bot-mark--mirror"')){
   const mirror='p.jsx("svg",{style:lin,viewBox:ent,children:p.jsx("use",{height:J1.height,href:k,width:J1.width,x:J1.minX,y:J1.minY})})';
   one(body,mirror);
   edits.push([node,body.replace(mirror,'p.jsx(RCompOfficialAvatarMirror,{sourceId:t})')]);
  }
 }});
 if(!edits.some(([node])=>node===sd))throw Error("Native avatar renderer missing.");
 if(!edits.some(([node])=>node.id?.name==="Nlt"))throw Error("Native avatar mirror missing.");
 edits.push([picker,officialPicker.toString().replace("function officialPicker","function e3n")]);
 let text=source;
 for(const [node,value] of edits.sort((a,b)=>b[0].start-a[0].start)){
 text=text.slice(0,node.start)+value+text.slice(node.end);
 }
 text=text.replace(ORIGINAL,"const Ij="+JSON.stringify(OFFICIAL_SHAPES)+";").replace(JO_TAIL,JO_TAIL.slice(0,-2)+joAdditions+"};");
 text+="\n"+engineSource.replace("export function createOfficialAvatarEngine","function createOfficialAvatarEngine")+avatarViewRuntime()+"\nfunction RCompAvatarLabels(){const en="+JSON.stringify(LABELS)+",zh="+JSON.stringify(ZH_LABELS)+";return Object.fromEntries(Object.keys(en).map(key=>[key,typeof RLocT===\"function\"?RLocT(en[key],zh[key]):en[key]]))}\nfunction RCompAvatarColorLabel(color){const zh="+JSON.stringify(ZH_COLORS)+";return typeof RLocT===\"function\"?RLocT(color.label,zh[color.id]):color.label}\n";
 parse(text,{ecmaVersion:"latest",sourceType:"module"});
 return {text,applied:true,reason:"patched"};
}
export const AVATAR_PICKER_CSS=`
.sand-avatar-editor{width:min(calc(min(272px,100vw - 32px) + 2*var(--cursor-spacing-3)),100vw - 32px)!important}
.r-avatar-shape-row{column-gap:clamp(0px,calc((100% - 240px)/4),var(--cursor-spacing-2))}
.sand-agent-character__shape{border:1px solid transparent;box-sizing:border-box;background:transparent;--sand-border-primary-translucent:#f5f5f538;--sand-border-secondary-translucent:#f5f5f51a}
.sand-agent-character__shape:hover{border-color:var(--sand-border-secondary-translucent,var(--sand-border-default))}
.r-avatar-shape-outline{position:absolute;pointer-events:none;background:var(--sand-border-secondary-translucent,var(--sand-border-default));opacity:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.sand-agent-character__shape:hover .r-avatar-shape-outline{opacity:1}
.sand-agent-character__shape[aria-pressed=true] .r-avatar-shape-outline{background:var(--sand-border-primary-translucent,var(--sand-text-secondary));opacity:1}
.r-avatar-colors{align-self:center;max-width:calc(6*32px + 5*var(--cursor-spacing-2));flex-wrap:wrap}
.r-avatar-color-swatch{display:block;width:24px;height:24px;border-radius:9999px}
[aria-pressed=true]>.r-avatar-color-swatch{box-shadow:0 0 0 3px var(--sand-bg-elevated),0 0 0 4px var(--sand-border-primary-translucent,var(--sand-text-secondary))}
`;
export async function applyShapePickerPatch({stageRoot}){
 const root=path.join(stageRoot,"dist","renderer");
 const html=await readFile(path.join(root,"index.html"),"utf8");
 const entries=[...html.matchAll(/src="\.\/(assets\/index-[^"]+\.js)"/g)].map(m=>m[1]);
 const cssEntries=[...html.matchAll(/href="\.\/(assets\/index-[^"]+\.css)"/g)].map(m=>m[1]);
 if(entries.length!==1||cssEntries.length!==1)throw Error("Avatar patch expected one entry and stylesheet.");
 const [source,engineSource,states,manifest,pumpkin]=await Promise.all([readFile(path.join(root,entries[0]),"utf8"),readFile(path.join(ARTIFACTS,"avatar-engine.mjs"),"utf8"),readFile(path.join(ARTIFACTS,"avatar-states.json"),"utf8").then(JSON.parse),readFile(path.join(ARTIFACTS,"avatar-source.json"),"utf8").then(JSON.parse),readFile(path.join(ARTIFACTS,"avatar-pumpkin-0753.json"),"utf8").then(JSON.parse)]);
 if(hash(engineSource)!==manifest.engineSha256)throw Error("Avatar engine digest mismatch.");
 const names=["square","sparkle","clover","heart","flower","house","star","pumpkin"];
 const joAdditions=","+names.map(name=>{
 const body=name==="pumpkin"?pumpkin.d:states.idle[name].match(/<g[^>]+-body[^>]*><path d="([^"]+)"/)?.[1];
 if(!body)throw Error("Official body missing: "+name);
 return name+':Po('+JSON.stringify(LABELS[name])+","+JSON.stringify(body)+")";
 }).join(",");
 const result=patchShapePicker(source,joAdditions,engineSource);
 await writeFile(path.join(root,entries[0]),result.text);
 const cssFile=path.join(root,cssEntries[0]),css=await readFile(cssFile,"utf8");
 await writeFile(cssFile,css+AVATAR_PICKER_CSS);
 const provenance={mode:"official-avatar-engine",referenceVersion:"0.75.3",shapes:OFFICIAL_SHAPES,rows:[5,5,4],sourceSha256:manifest.sourceSha256,engineSha256:manifest.engineSha256,files:[{file:entries[0],originalSha256:hash(source),patchedSha256:hash(result.text)},{file:cssEntries[0],originalSha256:hash(css),patchedSha256:hash(css+AVATAR_PICKER_CSS)}]};
 await writeFile(path.join(stageRoot,"dist","renderer-avatar-extension.json"),JSON.stringify(provenance,null,2)+"\n");
 console.log("Avatar picker: official 14 shapes, 5+5+4, native drawing engine.");
 return provenance;
}
