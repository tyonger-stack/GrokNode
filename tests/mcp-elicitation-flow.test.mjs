import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';

const root=path.resolve(import.meta.dirname,'..');
const temporary=await mkdtemp(path.join(root,'node_modules/.cache/mcp-elicitation-'));
test.after(()=>rm(temporary,{recursive:true,force:true}));
async function load(entry,name){const outfile=path.join(temporary,name+'.cjs');await build({entryPoints:[path.join(root,entry)],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});return createRequire(import.meta.url)(outfile)}
const {LocalHttpMcpExec}=await load('source/shared/node/mcp/local-http-exec.ts','exec');
const {AutoReviewService}=await load('source/host/extensions/auto-review/auto-review-service.ts','approvals');
const until=async predicate=>{const deadline=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<deadline,'approval did not arrive');await new Promise(resolve=>setTimeout(resolve,5))}};

async function fixture(schema={type:'object',properties:{}}){
  let capabilities,requestNo=0,initializations=0;const pending=new Map(),answers=[];
  const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(value===undefined?'':JSON.stringify(value))};
  const event=(res,value)=>res.write('event: message\ndata: '+JSON.stringify(value)+'\n\n');
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST')return json(res,405,{});
    let raw='';for await(const chunk of req)raw+=chunk;
    const message=JSON.parse(raw);
    if(message.method==='initialize'){initializations++;capabilities=message.params.capabilities;return json(res,200,{jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'Confirmation',version:'1'}}})}
    if(message.method==='notifications/initialized'||message.method==='notifications/cancelled')return json(res,202);
    if(message.method==='tools/call'){
      const id='confirmation-'+(++requestNo);pending.set(id,{res,callId:message.id});
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
      event(res,{jsonrpc:'2.0',id,method:'elicitation/create',params:{mode:'form',message:'Confirm sending this report?',requestedSchema:schema}});return;
    }
    if(message.result&&pending.has(message.id)){
      answers.push(message.result);const held=pending.get(message.id);pending.delete(message.id);json(res,202);
      event(held.res,{jsonrpc:'2.0',id:held.callId,result:{content:[{type:'text',text:message.result.action}]}});held.res.end();return;
    }
    json(res,202);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{url:`http://127.0.0.1:${server.address().port}/mcp`,answers,get initializations(){return initializations},get capabilities(){return capabilities},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}
function approvalService(updates){
  const service=new AutoReviewService({auth:{},experiments:{checkFeatureGate:()=>true},settings:{getAutoReviewInstructions:()=>({isEnabled:false,allowInstructions:[],blockInstructions:[]})},telemetry:{reportAutoReviewDisplayRecheckFailed(){},reportAutoReviewApproval(){}},awaitingSink:{trySetForTab(){},clearForTab(){}},transcript:{settleStaleAutoReviewCard:async()=>false},hostGeneration:'test',createClassifierExecutor:()=>({})});
  const {autoReviewController}=service.bindRunner({agentId:'bot-a',onUpdate:update=>updates.push(update)});
  return{service,controller:autoReviewController};
}
for(const resolution of ['approved','denied'])test(`HTTP MCP elicitation waits for the real transcript approval and returns ${resolution}`,async()=>{
  const remote=await fixture(),updates=[];const {service,controller}=approvalService(updates);
  const runtime=new LocalHttpMcpExec({getServers:()=>({Confirmation:{url:remote.url}}),credentialDirectory:path.join(temporary,resolution),requestElicitation:request=>service.requestMcpElicitation(request)});
  let completed=false;
  try{
    const call=runtime.executeTool({serverIdentifier:'Confirmation',toolName:'send_report',args:{},agentId:'bot-a'}).then(value=>{completed=true;return value});
    await until(()=>updates.some(x=>x.type==='send-message'));
    assert.equal(completed,false);assert.deepEqual(remote.capabilities.elicitation,{form:{}});
    const approval=updates.find(x=>x.type==='send-message').message.approval;
    assert.equal(approval.summaryCopy.kind,'mcp_elicitation');assert.equal(approval.summaryCopy.params.message,'Confirm sending this report?');assert.equal(approval.summaryCopy.params.toolName,'send_report');
    await assert.rejects(()=>service.resolveApproval({requestId:approval.requestId,resolution,agentId:'bot-b',entryId:'entry'}),/stale/);
    await assert.rejects(()=>service.resolveApproval({requestId:approval.requestId,resolution:'always',agentId:'bot-a',entryId:'entry'}),/this request only/);
    await service.resolveApproval({requestId:approval.requestId,resolution,agentId:'bot-a',entryId:'entry'});
    const result=await call;assert.equal(result.result.case,'success');
    assert.equal(result.result.value.content[0].content.value.text,resolution==='approved'?'accept':'decline');
    assert.equal(remote.answers[0].action,resolution==='approved'?'accept':'decline');assert.equal(controller.getPendingApprovals().length,0);
    assert.ok(updates.some(x=>x.type==='auto-review-status'&&x.status===resolution));
  }finally{await runtime.dispose();service.stop();await remote.close()}
});

test('a required form is declined without guessing fields or creating a card',async()=>{
  const remote=await fixture({type:'object',properties:{secret:{type:'string'}},required:['secret']});let prompts=0;
  const runtime=new LocalHttpMcpExec({getServers:()=>({Confirmation:{url:remote.url}}),credentialDirectory:path.join(temporary,'form'),requestElicitation:async()=>{prompts++;return'accept'}});
  try{await runtime.executeTool({serverIdentifier:'Confirmation',toolName:'form',args:{},agentId:'bot-a'});assert.equal(remote.answers[0].action,'decline');assert.equal(prompts,0)}finally{await runtime.dispose();await remote.close()}
});

test('turn cancellation closes the transport and expires the pending approval',async()=>{
  const remote=await fixture(),updates=[];const {service,controller}=approvalService(updates);const abort=new AbortController();
  const runtime=new LocalHttpMcpExec({getServers:()=>({Confirmation:{url:remote.url}}),credentialDirectory:path.join(temporary,'cancel'),requestElicitation:request=>service.requestMcpElicitation(request)});
  try{const call=runtime.executeTool({serverIdentifier:'Confirmation',toolName:'send',args:{},agentId:'bot-a',signal:abort.signal});await until(()=>controller.getPendingApprovals().length===1);abort.abort();await call;await until(()=>controller.getPendingApprovals().length===0);assert.ok(updates.some(x=>x.type==='auto-review-status'&&x.status==='expired'))}finally{await runtime.dispose();service.stop();await remote.close()}
});

test('expiry/session stop returns cancel, and an ownerless request cannot be approved',async()=>{
  const updates=[];const {service,controller}=approvalService(updates);const request={agentId:'bot-a',serverDisplayName:'MCP',toolName:'send',message:'Confirm?',signal:new AbortController().signal};
  try{
    assert.equal(await service.requestMcpElicitation({...request,agentId:'unknown'}),'cancel');
    const pending=service.requestMcpElicitation(request);controller.expire('session_end');assert.equal(await pending,'cancel');
  }finally{service.stop()}
});

test('disposing an active client retires its approval without a late acceptance',async()=>{
  const remote=await fixture(),updates=[];const{service,controller}=approvalService(updates);
  const runtime=new LocalHttpMcpExec({getServers:()=>({Confirmation:{url:remote.url}}),credentialDirectory:path.join(temporary,'dispose'),requestElicitation:request=>service.requestMcpElicitation(request)});
  try{const call=runtime.executeTool({serverIdentifier:'Confirmation',toolName:'send',args:{},agentId:'bot-a'});await until(()=>controller.getPendingApprovals().length===1);await runtime.dispose();await call;assert.equal(controller.getPendingApprovals().length,0);assert.ok(updates.some(x=>x.type==='auto-review-status'&&x.status==='expired'));assert.equal(remote.answers.some(answer=>answer.action==='accept'),false)}finally{await runtime.dispose();service.stop();await remote.close()}
});

test('a cancelled queued tool never opens another connection or creates another approval',async()=>{
  const remote=await fixture(),updates=[];const{service,controller}=approvalService(updates);const abort=new AbortController();
  const runtime=new LocalHttpMcpExec({getServers:()=>({Confirmation:{url:remote.url}}),credentialDirectory:path.join(temporary,'queued'),requestElicitation:request=>service.requestMcpElicitation(request)});
  try{
    const first=runtime.executeTool({serverIdentifier:'Confirmation',toolName:'first',args:{},agentId:'bot-a'});await until(()=>controller.getPendingApprovals().length===1);
    const second=runtime.executeTool({serverIdentifier:'Confirmation',toolName:'second',args:{},agentId:'bot-a',signal:abort.signal});abort.abort();
    const approval=controller.getPendingApprovals()[0];await service.resolveApproval({requestId:approval.id,resolution:'approved',agentId:'bot-a',entryId:'entry'});
    await first;const result=await second;assert.equal(result.result.case,'error');assert.equal(remote.initializations,1);assert.equal(updates.filter(update=>update.type==='send-message').length,1);
  }finally{await runtime.dispose();service.stop();await remote.close()}
});
