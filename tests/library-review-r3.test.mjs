import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import path from 'node:path';
const root = mkdtempSync(path.resolve('node_modules/.cache/r3-'));
test.after(() => { rmSync(root, {recursive:true,force:true}); assert.equal(existsSync(root),false); console.log('R3_TEARDOWN_OK'); });
await build({stdin:{contents:'export * from "./source/host/extensions/library/extension.ts"; export * from "./source/shared/library/mcp-result-hook.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',external:['undici'],outfile:path.join(root,'host.mjs'),logLevel:'silent'});
const lib = await import(path.join(root,'host.mjs'));
const signal = () => AbortSignal.timeout(10000);
function setup(name) {
 const service=lib.createLibraryHostService({dataRoot:path.join(root,name),transcript:{listAgentIds:()=>['existing-bot'],getAgentTranscriptPage:()=>({entries:['owned']})}});
 const credential=service.mainCredential();
 return {service,credential};
}
test('H1 rejects unknown transcript IDs without enrollment',async()=>{
 const {service,credential}=setup('h1');
 try {
  await assert.rejects(service.readTranscriptEntries({credential,agentId:'unknown'},signal()));
  assert.throws(()=>service.catalog.identity.requireAgent(service.catalog.identity.resolveCredential(credential,signal()),'unknown'));
  assert.deepEqual(await service.readTranscriptEntries({credential,agentId:'existing-bot'},signal()),{entries:['owned']});
  const other=service.catalog.identity.createLocalPrincipal();
  await assert.rejects(service.readTranscriptEntries({credential:other.credential,agentId:'existing-bot'},signal()));
 } finally {service.dispose();}
});
test('H4 main credential remains fixed after another issued identity reads',async()=>{
 const {service,credential}=setup('h4');
 try { const other=service.catalog.identity.createLocalPrincipal(); await service.listLibraryPages({credential:other.credential,includeDocuments:true},signal()); assert.equal(service.mainCredential(),credential); }
 finally {service.dispose();}
});
test('H2 owner member outsider transitions reauthorize cached pages',async()=>{
 const {service,credential}=setup('h2');
 try {
 const owner=service.catalog.identity.resolveCredential(credential,signal()).principal;
 const member=service.catalog.identity.createLocalPrincipal(owner.accountId), outsider=service.catalog.identity.createLocalPrincipal(owner.accountId);
 for (const principal of [owner,member]) service.catalog.identity.assignTeam({...principal,teamId:'team'},true);
 service.catalog.identity.registerStore({...owner,storeId:'team-store',teamId:'team'});
 service.catalog.identity.assignAgent({...owner,agentId:'existing-bot'},true);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 const published=await service.publishNativeArtifact({input:{kind:'document',source:'# Real artifact\nbytes',assets:[{name:'pixel.png',bytes:png}]},execution:{credential,agentId:'existing-bot',storeId:'team-store',toolCallId:'publish',idempotencyKey:'publish'}},signal());
 assert.equal(service.acknowledgePublishedLinks({credential,agentId:'existing-bot',storeId:'team-store',messageId:'published-message',content:published.url,publishedAtMs:Date.now()},signal()).length,1);
 const ref=published.identity.ref, locator={storeId:ref.storeId,documentId:ref.documentId};
 const resolve=async(c)=>(await service.resolveLibraryPages({credential:c,refs:[ref],includeDocuments:true},signal()))[0];
 assert.equal((await resolve(credential)).page.canShareToTeam,true);
 assert.equal((await resolve(member.credential)).status,'absent');
 await service.setDocumentVisibility({credential,locator,visibility:'team-view'},signal());
 assert.equal((await resolve(member.credential)).status,'found');
 assert.equal((await resolve(outsider.credential)).status,'absent');
 const assets=await service.getDocumentAssets({credential:member.credential,locator,names:['pixel.png']},signal());
 const hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(hash(assets.assets[0].bytes),hash(png));
 console.log('R3_PUBLISHED_ARTIFACT',JSON.stringify({url:published.url,assetSha256:hash(assets.assets[0].bytes),sourceSha256:hash(Buffer.from('# Real artifact\nbytes'))}));
 assert.equal((await service.getDocument({credential:member.credential,locator},signal())).source,'# Real artifact\nbytes');
 await service.setDocumentVisibility({credential,locator,visibility:'private'},signal());
 assert.equal((await resolve(member.credential)).status,'absent');
 await service.setDocumentVisibility({credential,locator,visibility:'team-view'},signal());
 assert.equal((await resolve(member.credential)).status,'found');
 service.catalog.identity.assignTeam({...member,teamId:'team'},false);
 assert.equal((await resolve(member.credential)).status,'absent');
 const revokedAssets=await service.getDocumentAssets({credential:member.credential,locator,names:['pixel.png']},signal());
 assert.equal(revokedAssets.assets.some(a=>a.bytes!==undefined),false);
 service.catalog.identity.assignTeam({...owner,teamId:'team'},false);
 assert.equal((await resolve(credential)).page.canShareToTeam,false);
 const assetFile=path.join(service.dataRoot,'library/documents',ref.documentId,'assets/pixel.png');
 const outside=path.join(root,'outside.png');writeFileSync(outside,png,{mode:0o600});
 unlinkSync(assetFile);symlinkSync(outside,assetFile);
 const unsafe=await service.getDocumentAssets({credential,locator,names:['pixel.png']},signal());
 assert.equal(unsafe.assets.some(a=>a.bytes!==undefined),false);
 } finally {service.dispose();}
});
test('H4 concurrent MCP completions keep captured identities',async()=>{
 const {service,credential}=setup('mcp');
 try {
 const owner=service.catalog.identity.resolveCredential(credential,signal()).principal;
 const second=service.catalog.identity.createLocalPrincipal(owner.accountId);
 const identities=[{...owner,credential,storeId:'node-local-store',agentId:'bot-a'}, {...second,storeId:'second-store',agentId:'bot-b'}];
 service.catalog.identity.registerStore({...second,storeId:'second-store',teamId:null});
 for (const id of identities) service.catalog.identity.assignAgent(id,true);
 let release; const gate=new Promise(r=>{release=r;});
 const notify=(id)=>lib.notifyLibraryMcpResult({providerIdentifier:'Notion:notion',toolName:'notion-create-pages',toolCallId:id.agentId,agentId:id.agentId,displayName:'Notion',args:{},raw:{result:{case:'success',value:{content:[],structuredContent:{url:'https://www.notion.so/1234567890abcdef1234567890abcdef'}}}}});
 const first=service.runMcpExecution({...identities[0],toolCallId:'bot-a',connectorAccount:'a'},signal(),async()=>{await gate;notify(identities[0]);});
 await service.runMcpExecution({...identities[1],toolCallId:'bot-b',connectorAccount:'b'},signal(),async()=>notify(identities[1]));
 release(); await first;
 for (const id of identities) assert.equal((await service.listLibraryDocs({credential:id.credential,agentId:id.agentId},signal())).docs.length,1);
 await assert.rejects(service.listLibraryDocs({credential:second.credential,agentId:'bot-a'},signal()));
 } finally {service.dispose();}
});
test('H3 late index and resolve results cannot expose revoked pages',async()=>{
 await build({stdin:{contents:'export * from "./source/host/extensions/library/page-cache.ts";export * from "./source/host/extensions/library/page-index.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:path.join(root,'cache.mjs'),logLevel:'silent'});
 const {createPageIndex,createPageResolveCache}=await import(path.join(root,'cache.mjs'));
 const {service,credential}=setup('late');
 try {
 const context=service.catalog.identity.resolveCredential(credential,signal());
 let release;const gate=new Promise(r=>{release=r;});
 const page={kind:'canvas',storeId:'store',canvasId:'12345678-1234-4234-8234-123456789abc',title:'private',visibility:'private',canShareToTeam:false,createdAtMs:null,updatedAtMs:null};
 const index=createPageIndex({listCanvasSummaries:async()=>{await gate;return {pages:[page]};},ownedDocumentStores:()=>[],listDocumentSummaries:async()=>({pages:[]})});
 const cache=createPageResolveCache({fetchPage:async()=>{await gate;return {status:'found',page};}});
 const flight=index.list({includeDocuments:false},context);
 const resolve=cache.resolveRefs({refs:[{kind:'canvas',storeId:page.storeId,canvasId:page.canvasId}],includeDocuments:false},context);
 index.invalidateAll();cache.invalidateAll();release();
 assert.equal((await flight).pages.length,0);
 assert.equal((await resolve)[0].status,'failed');
 } finally {service.dispose();}
});

test('M3 boundary preserves typed invalid argument and permission failures',async()=>{
 const {service,credential}=setup('errors');
 try {
 await assert.rejects(service.resolveLibraryPages({credential,refs:[{kind:'document',storeId:'x',documentId:'invalid'}],includeDocuments:true},signal()),e=>e.name==='LibraryContractError'&&e.code==='invalid-argument');
 await assert.rejects(service.readTranscriptEntries({credential,agentId:'unknown'},signal()),e=>e.name==='LibraryContractError'&&e.code==='read-only');
 } finally {service.dispose();}
});

test('owned stores and main team capability survive service restart',async()=>{
 const {service,credential}=setup('restart');
 const context=service.catalog.identity.resolveCredential(credential,signal());
 service.catalog.identity.assignTeam({...context.principal,teamId:'main-team'},true);
 service.catalog.identity.setStoreTeam(context,'node-local-store','main-team');
 service.catalog.identity.registerStore({...context.principal,storeId:'persisted-store',teamId:'main-team'});
 service.catalog.identity.assignAgent({...context.principal,agentId:'existing-bot'},true);
 const published=await service.publishNativeArtifact({input:{kind:'document',source:'# Persisted',assets:[]},execution:{credential,agentId:'existing-bot',storeId:'persisted-store',toolCallId:'p',idempotencyKey:'p'}},signal());
 service.dispose();
 const restarted=lib.createLibraryHostService({dataRoot:path.join(root,'restart')});
 try {
 assert.equal(restarted.mainCredential()===credential,true);
 const pages=await restarted.listLibraryPages({credential,includeDocuments:true},signal());
 assert.equal(pages.pages.some(page=>page.documentId===published.identity.ref.documentId),true);
 assert.equal(restarted.catalog.canShareToTeam(restarted.catalog.identity.resolveCredential(credential,signal()),'node-local-store'),true);
 } finally {restarted.dispose();}
});
test('separate admin connection revocation invalidates receiving principal cache',async()=>{
 const {service,credential}=setup('admin');
 let admin;
 try {
 const context=service.catalog.identity.resolveCredential(credential,signal());
 const member=service.catalog.identity.createLocalPrincipal(context.principal.accountId);
 for(const p of [context.principal,member]) service.catalog.identity.assignTeam({...p,teamId:'team'},true);
 service.catalog.identity.setStoreTeam(context,'node-local-store','team');
 const published=await service.publishNativeArtifact({input:{kind:'document',source:'# Admin revocation',assets:[]},execution:{credential,agentId:'existing-bot',storeId:'node-local-store',toolCallId:'a',idempotencyKey:'a'}},signal());
 const ref=published.identity.ref;
 await service.setDocumentVisibility({credential,locator:{storeId:ref.storeId,documentId:ref.documentId},visibility:'team-view'},signal());
 const resolve=()=>service.resolveLibraryPages({credential:member.credential,refs:[ref],includeDocuments:true},signal());
 assert.equal((await resolve())[0].status,'found');
 admin=lib.createLibraryHostService({dataRoot:path.join(root,'admin')});
 admin.catalog.identity.assignTeam({...member,teamId:'team'},false);
 assert.equal((await resolve())[0].status,'absent');
 } finally {admin?.dispose();service.dispose();}
});

test('extension lifecycle starts configured TLS receiver and closes its listener',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {createServer}=await import('node:net');
 const {request}=await import('node:https');
 const {readFileSync}=await import('node:fs');
 const key=path.join(root,'tls.key'),cert=path.join(root,'tls.crt'),conf=path.join(root,'tls.cnf');
 writeFileSync(conf,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-config',conf],{stdio:'pipe'});
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const env={SAND_DATA_ROOT:path.join(root,'lifecycle'),SAND_LIBRARY_ORIGIN:`https://127.0.0.1:${port}`,SAND_LIBRARY_TLS_KEY_FILE:key,SAND_LIBRARY_TLS_CERT_FILE:cert,SAND_LIBRARY_LISTEN_HOST:'127.0.0.1'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 let stop;
 try {
 const service=await lib.libraryExtension.start({deps:{transcript:{listAgentIds:()=>[],getAgentTranscriptPage:()=>({entries:[]})}},host:{},onStop:fn=>{stop=fn;}});
 const get=()=>new Promise((resolve,reject)=>{const req=request(env.SAND_LIBRARY_ORIGIN+'/documents/node-local-store/12345678-1234-4234-8234-123456789abc',{ca:readFileSync(cert),agent:false},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
 assert.equal(await get(),401);
 assert.equal(service.mainCredential().length>0,true);
 await stop();stop=undefined;
 await assert.rejects(get(),e=>e.code==='ECONNREFUSED');
 console.log('R3_TLS_LIFECYCLE',JSON.stringify({origin:env.SAND_LIBRARY_ORIGIN,verifiedCaSha256:createHash('sha256').update(readFileSync(cert)).digest('hex'),unauthenticatedStatus:401,closed:true}));
 } finally {if(stop)await stop();for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test("Node active-user store resolves the owner's main store and preserves active ref identity", async () => {
 const {service,credential}=setup("active-user");
 try {
  const published=await service.publishNativeArtifact({input:{kind:"canvas",title:"Active board",renderBundleGzip:new Uint8Array([1]),dataJson:new Uint8Array([2])},execution:{credential,agentId:"existing-bot",storeId:"node-local-store",toolCallId:"active",idempotencyKey:"active"}},signal());
  const canvasId=published.identity.ref.canvasId;
  const activeRef={kind:"active-user-store-canvas",canvasId};
  const share=await service.getCanvasShare({credential,locator:{kind:"active-user-store",canvasId}},signal());
  assert.equal(share.storeId,"node-local-store");
  assert.equal(share.share?.visibility,"private");
  const resolved=await service.resolveLibraryPages({credential,refs:[activeRef],includeDocuments:true},signal());
  assert.equal(resolved[0].ref.kind,"active-user-store-canvas");
  assert.equal(resolved[0].status,"found");
  assert.equal(resolved[0].page.canvasId,canvasId);
  const other=service.catalog.identity.createLocalPrincipal();
  assert.equal((await service.resolveLibraryPages({credential:other.credential,refs:[activeRef],includeDocuments:true},signal()))[0].status,"absent");
  console.log("R3_ACTIVE_USER_STORE",JSON.stringify({url:published.url,resolvedStore:share.storeId}));
 } finally {service.dispose();}
});
test("trusted roster membership is established before pending native publication reads",async()=>{
 const {service,credential}=setup("roster-before-native");
 try {
  assert.deepEqual(service.pendingPublications({credential,agentId:"existing-bot",storeId:"node-local-store"},signal()),[]);
  service.catalog.identity.requireAgent(service.catalog.identity.resolveCredential(credential,signal()),"existing-bot");
  const base=service.executionBase({agentId:"existing-bot"},signal());
  assert.equal(base.principal.accountId,"node-local-account");
  assert.equal(base.providerOrigin,"https://groknode.local");
  const first=await service.publishNativeArtifact({input:{kind:"document",source:"# First native publication",assets:[]},execution:{credential:base.credential,agentId:base.agentId,storeId:base.storeId,toolCallId:"first-native",idempotencyKey:"native-artifact:first-native"}},signal());
  assert.equal(service.pendingPublications({credential,agentId:"existing-bot",storeId:"node-local-store"},signal()).length,1);
  assert.equal(service.acknowledgePublishedLinks({credential,agentId:"existing-bot",storeId:"node-local-store",messageId:"first-message",content:first.url,publishedAtMs:Date.now()},signal()).length,1);
 } finally {service.dispose();}
});
test("canvas metadata and visibility use the original protocol echo through the Node provider",async()=>{
 const {service,credential}=setup("canvas-protocol-chain");
 try {
  const context=service.catalog.identity.resolveCredential(credential,signal());
  service.catalog.identity.assignTeam({...context.principal,teamId:"canvas-team"},true);
  service.catalog.identity.setStoreTeam(context,"node-local-store","canvas-team");
  const published=await service.publishNativeArtifact({input:{kind:"canvas",title:"Protocol board",renderBundleGzip:new Uint8Array([3]),dataJson:new Uint8Array([4])},execution:{credential,agentId:"existing-bot",storeId:"node-local-store",toolCallId:"canvas-protocol",idempotencyKey:"canvas-protocol"}},signal());
  const locator={kind:"active-user-store",canvasId:published.identity.ref.canvasId};
  const privateShare=await service.getCanvasShare({credential,locator},signal());
  assert.deepEqual(privateShare.share,{visibility:"private",canShareToTeam:true});
  assert.equal(await service.setCanvasVisibility({credential,locator,visibility:"team-view"},signal()),"team-view");
  assert.deepEqual((await service.getCanvasShare({credential,locator},signal())).share,{visibility:"team-view",canShareToTeam:true});
  assert.equal(await service.setCanvasVisibility({credential,locator,visibility:"private"},signal()),"private");
  assert.deepEqual((await service.getCanvasShare({credential,locator},signal())).share,{visibility:"private",canShareToTeam:true});
 } finally {service.dispose();}
});
