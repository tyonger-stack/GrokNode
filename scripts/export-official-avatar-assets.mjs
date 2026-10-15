import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parse}=require('acorn');
const walk=require('acorn-walk');
const file=process.argv[2];
if(!file)throw Error('Pass the extracted 0.70.2 index.eager-platform-DUN5VkaE.js path.');
const source=fs.readFileSync(file,'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declarations=new Map();
for(const statement of ast.body){
 const node=statement.declaration??statement;
 if(node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')declarations.set(node.id.name,{node,text:source.slice(node.start,node.end)});
 if(node.type==='VariableDeclaration')for(const d of node.declarations)if(d.id.type==='Identifier')declarations.set(d.id.name,{node:d,text:node.kind+' '+source.slice(d.start,d.end)+';'});
}
function binding(node,names){
 if(!node)return;
 if(node.type==='Identifier')names.add(node.name);
 if(node.type==='RestElement')binding(node.argument,names);
 if(node.type==='AssignmentPattern')binding(node.left,names);
 if(node.type==='ArrayPattern')node.elements.forEach(n=>binding(n,names));
 if(node.type==='ObjectPattern')node.properties.forEach(n=>binding(n.type==='RestElement'?n.argument:n.value,names));
}
function deps(node){
 const locals=new Set();
 walk.full(node,n=>{
  if(/Function/.test(n.type)||n.type==='ArrowFunctionExpression'){binding(n.id,locals);n.params.forEach(p=>binding(p,locals));}
  if(n.type==='VariableDeclarator')binding(n.id,locals);
  if(n.type==='CatchClause')binding(n.param,locals);
 });
 const used=new Set();
 walk.ancestor(node,{Identifier(n,parents){
  const parent=parents.at(-2);
  if(parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed)return;
  if(parent?.type==='Property'&&parent.key===n&&!parent.computed&&!parent.shorthand)return;
  if(!locals.has(n.name)&&declarations.has(n.name))used.add(n.name);
 }});
 return [...used];
}
const selected=new Set();
function visit(name){if(selected.has(name))return;const d=declarations.get(name);if(!d)throw Error(name);selected.add(name);for(const dep of deps(d.node))visit(dep);}
['Yf','Nx','Fh','wN','zE','$n','Ur','Ps','xN','yN'].forEach(visit);
const program=[...selected].map(n=>declarations.get(n)).sort((a,b)=>a.node.start-b.node.start).map(d=>d.text).join('\n');

const hash=text=>createHash('sha256').update(text).digest('hex');
if(hash(source)!=='560912e771f4989101d04ad06dca024cd1c0513cbdcad122222d9a6bd1df1183')throw Error('Official avatar engine source digest mismatch.');
const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'lib/computer-sleep-official');
const factory='export function createOfficialAvatarEngine(k,M){\n'+program+'\nreturn {Mark:yN,create:Yf,state:Nx,render:Fh,body:wN,appearance:zE,fill:Ps,fillScale:Ur(Ps),outline:xN};\n}\n';
fs.writeFileSync(path.join(output,'avatar-engine.mjs'),factory);
const React=require('react');
const jsx=require('react/jsx-runtime');
const {createOfficialAvatarEngine}=await import(path.join(output,'avatar-engine.mjs')+'?'+Date.now());
const engine=createOfficialAvatarEngine(React,jsx);
const esc=text=>String(text).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function serialize(node){return '<'+node.tag+Object.entries(node.attrs??{}).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('')+'>'+ (node.children??[]).map(n=>typeof n==='object'?serialize(n):esc(n)).join('')+'</'+node.tag+'>';}
const shapes=['blob','cloud','square','sparkle','clover','heart','flower','teardrop','tablet','wedge','house','star','hex'];
const states={idle:{},sleeping:{},waking:{}};
for(const state of Object.keys(states))for(const shape of shapes){
 const mark=engine.create({body:engine.body(shape)});
 engine.state(mark,state,{isCompact:true,isResting:true,seed:1});
 for(let i=0;i<240;i++)mark.advance(1/120);
 states[state][shape]=serialize(engine.render(mark.frame(),engine.appearance('var(--grok-bot-ink)'),192,'r-avatar-'+state+'-'+shape,{extent:'100%'}));
}
fs.writeFileSync(path.join(output,'shape-map.json'),JSON.stringify(states.sleeping,null,2)+'\n');
fs.writeFileSync(path.join(output,'avatar-states.json'),JSON.stringify(states,null,2)+'\n');
for(const shape of shapes)fs.writeFileSync(path.join(output,'shapes',shape+'.svg'),states.idle[shape]+'\n');
fs.writeFileSync(path.join(output,'shapes','shape-map.json'),JSON.stringify(states.idle,null,2)+'\n');
const bodyPaths=Object.fromEntries(shapes.map(shape=>[shape,states.idle[shape].match(/<g[^>]+-body[^>]*><path d="([^"]+)"/)?.[1]??states.idle[shape].match(/<path d="([^"]+)"/)?.[1].split('ZM')[0]+'Z']));
fs.writeFileSync(path.join(output,'shapes','shape-paths.json'),JSON.stringify(bodyPaths,null,2)+'\n');
fs.writeFileSync(path.join(output,'shapes','shape-index.json'),JSON.stringify({version:'0.70.2',shapes:shapes.map(shape=>({shape,file:shape+'.svg',sha256:hash(states.idle[shape]+'\n')}))},null,2)+'\n');
fs.writeFileSync(path.join(output,'shape-map.mjs'),'import map from "./shape-map.json" with {type:"json"};\nexport const OFFICIAL_SHAPE_SVGS=Object.freeze(map);\n');
const css=fs.readFileSync(path.join(path.dirname(file),'index-Dve5Ol5U.css'),'utf8');
if(hash(css)!=='7a1f78e57358cc7d1276d8fde21ab33376dd41af96a41c2ef30235c78183d3c1')throw Error('Official animation CSS digest mismatch.');
const animations=['sand-12vywve-B','sand-6fenen-B','sand-18re5ia-B'].map(name=>{
 const start=css.indexOf('@keyframes '+name+'{');
 if(start<0)throw Error('Missing keyframes '+name);
 let at=css.indexOf('{',start),depth=0;
 do{if(css[at]==='{')depth++;if(css[at]==='}')depth--;at++;}while(depth>0&&at<css.length);
 return css.slice(start,at);
});
fs.writeFileSync(path.join(output,'asleep-animation.css'),animations.join('\n')+'\n');
const manifest={version:'0.70.2',asarSha256:'8dd7b6c4a58439d626a9a7b3766982b7c725db2bc1f6ff68a29fc1ec62ca4cf7',sourceFile:path.basename(file),sourceSha256:hash(source),engineSha256:hash(factory),shapes,fillScale:engine.fillScale,declarations:[...selected].map(n=>({name:n,start:declarations.get(n).node.start,end:declarations.get(n).node.end})),generation:'AST-selected pure drawing dependencies and original yN React renderer; no app bootstrap or IPC executed.'};
fs.writeFileSync(path.join(output,'avatar-source.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({shapes:shapes.length,declarations:selected.size,engineBytes:factory.length,fillScale:engine.fillScale}));

