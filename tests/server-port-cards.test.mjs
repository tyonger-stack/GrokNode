import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build, stop } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const evidence = resolve(process.env.CARD_EVIDENCE_DIR ?? '.omo/evidence/wave2-cards');
await mkdir(evidence, { recursive: true });
const dir = await mkdtemp(join(evidence, 'run-'));
await build({ stdin: {contents: `export {mountServerPortCard} from './frontend/src/extensions/server-port-cards-entry';
export {TranscriptCardRootEntry} from './frontend/src/recovered/features/conversation/cards/transcript-card/root';
export {createTranscriptCardRootMountContract} from './frontend/src/recovered/features/conversation/cards/transcript-card/mount-contract';
export {createTranscriptCardLeafResolver, loadTranscriptCardLeaf} from './frontend/src/recovered/features/conversation/cards/transcript-card/resolver';
export {ReviewCardScope} from './frontend/src/recovered/features/conversation/cards/transcript-card/review-card-scope';
export {createElement} from 'react';
export {act} from 'react';`, resolveDir: process.cwd(), loader: 'tsx'}, bundle: true, platform: 'browser', format: 'esm', outfile: join(dir, 'cards.mjs'), loader: {'.css':'empty'}, define: {'process.env.NODE_ENV':'"development"'} });
const window = new Window({url:'http://localhost'});
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','navigator']) Object.defineProperty(globalThis, key, {value: key === 'window' ? window : window[key], configurable: true});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Browser scheduler must not retain Node MessagePorts in this DOM-only harness.
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel { constructor() { super(); channels.push(this); } };
const {mountServerPortCard, TranscriptCardRootEntry, createTranscriptCardRootMountContract, createTranscriptCardLeafResolver, loadTranscriptCardLeaf, ReviewCardScope, createElement, act} = await import(pathToFileURL(join(dir,'cards.mjs')).href);
const observations = [];
const email = () => ({kind:'send-message',id:'email-1',message:{type:'email-draft',draft:{from:'me@example.com',to:['old@example.com'],cc:[],subject:'Review',body:'original',signature:'old signature',attachments:[{id:'one',name:'report.pdf'},{id:'two',name:'notes.txt'}]}}});
const form = () => ({kind:'send-message',id:'form-entry',message:{type:'user-form',form:{id:'request-1',title:'Secure Form',instruction:'Sign in',reason:'auth',domain:'login.example.com',fields:[{id:'pass',label:'Password',type:'password',required:true,target:{kind:'ref',value:'e1'}},{id:'code',label:'Code',type:'otp',target:{kind:'ref',value:'e2'}}]}}});
async function mount(entry, call) { const host=document.createElement('div');document.body.append(host);let view;await act(async()=>{view=mountServerPortCard(host,{call},{agentId:'agent-A',accountSlot:'account-A'},entry)});return {host,view}; }
async function edit(element,value) {assert.ok(element);await act(async()=>{const proto=element.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));});}
async function click(host,text) {const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text || b.getAttribute('aria-label')===text);assert.ok(button);assert.equal(button.disabled,false);await act(async()=>{button.click()});}
async function finish(name, host, view, detail) {await writeFile(join(dir,`${name}.html`),host.outerHTML);observations.push({scenario:name,invocation:'node --test tests/server-port-cards.test.mjs',observable:detail,pass:true,artifact:join(dir,`${name}.html`)});await act(async()=>view.unmount());host.remove();}

test('edited email click sends all displayed fields and awaits transcript confirmation',async()=>{
  // Given a mounted production exporter and an accepted-only transport.
  const calls=[];const entry=email(); const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});return {accepted:true}});
  const inputs=host.querySelectorAll('input'); await edit(inputs[0],'other@example.com');await edit(inputs[1],'cc@example.com');await edit(inputs[2],'new@example.com');await edit(inputs[3],'Edited subject');await edit(host.querySelector('textarea'),'Edited body');await edit(host.querySelectorAll('textarea')[1],'Edited signature');await click(host,'Remove report.pdf');
  // When the user actually clicks Send.
  await click(host,'Send email');
  // Then exact user edits cross the real adapter and acceptance does not claim sent.
  assert.deepEqual(calls,[{method:'sendDraft',args:{agentId:'agent-A',entryId:'email-1',draft:{type:'email-draft',draft:{from:'other@example.com',to:['new@example.com'],cc:['cc@example.com'],subject:'Edited subject',body:'Edited body',signature:'Edited signature',attachments:[{id:'two',name:'notes.txt'}]}}}}]);
  assert.equal(host.querySelector('[role=status]').textContent,'Sending…');
  await act(async()=>view.update({...entry,draftSendState:'sent',message:calls[0].args.draft}));assert.match(host.textContent,/Sent to new@example.com/);
  await finish('edited-email',host,view,{calls,terminal:'sent'});
});

test('Slack click preserves edited target signature and attachment choice',async()=>{
  const calls=[]; const entry={kind:'send-message',id:'slack',message:{type:'slack-draft',draft:{target:'#old',body:'hello',signature:'sig',attachments:[{id:'a',name:'file'}]}}};const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});return {accepted:true}});
  await edit(host.querySelector('input'),'#new');await edit(host.querySelector('textarea'),'new body');await edit(host.querySelectorAll('textarea')[1],'new sig');await click(host,'Remove file');
  await click(host,'Send message');
  assert.deepEqual(calls[0].args.draft.draft,{target:'#new',body:'new body',signature:'new sig',attachments:[]});
  await finish('edited-slack',host,view,calls);
});

for (const mode of ['rejected','missing','throw']) test(`draft ${mode} does not fake success`,async()=>{
  const {host,view}=await mount(email(),async()=>{if(mode==='throw')throw new Error('provider private detail');return mode==='missing'?{}:{accepted:false}});
  await click(host,'Send email');
  assert.equal(host.querySelector('[role=status]').textContent,mode==='rejected'?'Ready to send':'Send outcome unconfirmed');assert.ok(!host.textContent.includes('provider private detail'));
  await finish(`draft-${mode}`,host,view,{successShown:false});
});

test('discard click uses the narrow API and waits for a persisted terminal state',async()=>{
  const calls=[];const entry=email();const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});return {accepted:true}});
  await click(host,'Discard');
  assert.deepEqual(calls,[{method:'discardDraft',args:{agentId:'agent-A',entryId:'email-1'}}]);assert.equal(host.querySelector('[role=status]').textContent,'Sending…');await act(async()=>view.update({...entry,draftSendState:'discarded'}));assert.equal(host.querySelector('[role=status]').textContent,'Discarded');
  await finish('discard',host,view,calls);
});

const settledLabels = {editable:'Ready to send',sent:'Sent',unconfirmed:'Send outcome unconfirmed','draft-created':'Draft created',discarded:'Discarded'};
for (const state of Object.keys(settledLabels)) test(`host settled ${state} replaces the optimistic sending label`,async()=>{
  const secret='provider-private-detail';
  const {host,view}=await mount(email(),async()=>({accepted:true,state,error:secret}));
  await click(host,'Send email');
  assert.equal(host.querySelector('[role=status]').textContent,settledLabels[state]);
  assert.equal(host.textContent.includes(secret),false);
  await finish(`settled-${state}`,host,view,{state,echoedError:false});
});

test('discard receipt uses discarded instead of the optimistic sending label',async()=>{
  const secret='provider-private-detail';
  const {host,view}=await mount(email(),async()=>({accepted:true,state:'discarded',error:secret}));
  await click(host,'Discard');
  assert.equal(host.querySelector('[role=status]').textContent,'Discarded');
  assert.equal(host.textContent.includes(secret),false);
  await finish('discard-settled',host,view,{state:'discarded',echoedError:false});
});

test('persisted editable overrides leftover sending after the request',async()=>{
  const entry=email();
  const {host,view}=await mount(entry,async()=>({accepted:true,state:'sending'}));
  await click(host,'Send email');
  assert.equal(host.querySelector('[role=status]').textContent,'Sending…');
  await act(async()=>view.update({...entry,draftSendState:'editable'}));
  assert.equal(host.querySelector('[role=status]').textContent,'Ready to send');
  const send=[...host.querySelectorAll('button')].find(button=>button.textContent==='Send email');
  assert.equal(send.disabled,false);
  await finish('editable-overrides-sending',host,view,{state:'editable'});
});

for (const action of ['submit','cancel','expire','failure']) test(`form ${action} masks and clears local values`,async()=>{
  const calls=[];const entry=form();const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});if(action==='failure')throw new Error('DO-NOT-ECHO');return {status:action==='cancel'?'dismissed':'submitted'}});
  assert.deepEqual([...host.querySelectorAll('input')].map(i=>i.type),['password','password']);assert.ok(host.textContent.includes('login.example.com'));
  await edit(host.querySelectorAll('input')[0],'DO-NOT-ECHO');await edit(host.querySelectorAll('input')[1],'123456');
  if(action==='expire')await act(async()=>view.update({...entry,formResolution:'expired'}));else await click(host,action==='cancel'?'Cancel':'Fill fields');
  assert.deepEqual([...host.querySelectorAll('input')].map(i=>i.value),['','']);assert.ok(!host.textContent.includes('DO-NOT-ECHO'));
  if(action==='cancel')assert.deepEqual(calls,[{method:'dismissUserForm',args:{agentId:'agent-A',requestId:'request-1'}}]);
  if(action==='submit')assert.deepEqual(calls,[{method:'submitUserForm',args:{agentId:'agent-A',requestId:'request-1',values:{pass:'DO-NOT-ECHO',code:'123456'}}}]);
  await finish(`form-${action}`,host,view,{masked:true,cleared:true,callNames:calls.map(c=>c.method)});
});

for (const state of ['sending','sent','discarded','unconfirmed','draft-created']) test(`persisted ${state} cannot be sent again`,async()=>{
  let calls=0;const {host,view}=await mount({...email(),draftSendState:state},async()=>{calls++;return {accepted:true}});
  for(const button of host.querySelectorAll('button'))await act(async()=>button.click());
  assert.equal(calls,0);
  await finish(`terminal-${state}`,host,view,{calls});
});
test('submitAfterFill discloses Enter action and sends only field values',async()=>{
  const entry=form();entry.message.form.fields=[entry.message.form.fields[1]];entry.message.form.submitAfterFill=true;const calls=[];
  const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});return {status:'submitted'}});
  assert.ok(host.textContent.includes('pressing Enter'));
  await edit(host.querySelector('input'),'123456');await click(host,'Fill and submit');
  assert.deepEqual(calls[0],{method:'submitUserForm',args:{agentId:'agent-A',requestId:'request-1',values:{code:'123456'}}});
  await finish('form-enter-submit',host,view,{disclosed:true,cleared:host.querySelector('input').value===''});
});

test('failed fill receipt is not displayed as successful submission',async()=>{
  const {host,view}=await mount(form(),async()=>({status:'submitted',fields:[{id:'pass',status:'failed'}]}));
  await edit(host.querySelector('input'),'DO-NOT-ECHO');await click(host,'Fill fields');
  assert.equal(host.querySelector('[role=status]').textContent,'fill_failed');assert.equal(host.querySelector('input').value,'');
  await finish('form-fill-failed',host,view,{status:'fill_failed',cleared:true});
});

test('pending host form survives original turn end and remains submittable',async()=>{
  const calls=[];const entry={...form(),userFormState:'pending'};
  const {host,view}=await mount(entry,async(method,args)=>{calls.push({method,args});return {status:'submitted'}});
  await edit(host.querySelector('input'),'DO-NOT-ECHO');
  await act(async()=>view.update({...entry,turnStatus:'turn_ended'},true));
  assert.equal(host.querySelector('input').value,'DO-NOT-ECHO');
  await click(host,'Fill fields');
  assert.equal(calls[0].method,'submitUserForm');assert.equal(host.querySelector('input').value,'');
  await finish('form-survives-turn-end',host,view,{submitted:true,clearedAfterSubmit:true});
});

for(const state of ['expired','dismissed','stopped','submitted']) test(`host userFormState ${state} clears values and disables actions`,async()=>{
  const entry={...form(),userFormState:'pending'};let calls=0;
  const {host,view}=await mount(entry,async()=>{calls++;return {status:'submitted'}});
  await edit(host.querySelector('input'),'DO-NOT-ECHO');
  await act(async()=>view.update({...entry,userFormState:state}));
  assert.equal(host.querySelector('input').value,'');assert.equal(host.querySelector('input').disabled,true);
  assert.equal(host.querySelector('[role=status]').textContent,state);assert.equal(calls,0);
  await finish(`form-host-${state}`,host,view,{cleared:true,disabled:true,calls});
});

test('readable ProductionRenderer path scopes exactly the three review cards',async()=>{
  const contract=createTranscriptCardRootMountContract({
    scope:{agentId:'agent-A',accountSlot:'account-A'},
    registry:createTranscriptCardLeafResolver(),
    widgetInteractions:{subscribe(){return ()=>{}}},
    cloudAgents:null,
    leafProviders:{serverPortActions:{sendDraft:async()=>'sending',discardDraft:async()=>'sending',submitUserForm:async()=>'submitted',dismissUserForm:async()=>'dismissed'}},
  });
  const cases=[
    ['email',email(),true],
    ['slack',{kind:'send-message',id:'s',message:{type:'slack-draft',draft:{target:'#a',body:'b'}}},true],
    ['form',form(),true],
    ['text',{kind:'send-message',id:'t',message:{type:'text',content:'plain'}},false],
    ['widget',{kind:'send-message',id:'w',message:{type:'widget',widget:{prompt:'pick',options:[{label:'a',value:'a'}]}}},false],
    ['secret',{kind:'send-message',id:'q',message:{type:'secret-request',secretRequest:{label:'token'}}},false],
  ];
  const results={};
  for(const [name,entry,expected] of cases){
    const tree=TranscriptCardRootEntry({contract,entry});
    const stack=[tree];
    let scoped=false;
    while(stack.length>0){
      const node=stack.pop();
      if(node==null||typeof node!=='object')continue;
      if(node.type===ReviewCardScope)scoped=true;
      const kids=node.props?.children;
      for(const kid of Array.isArray(kids)?kids:[kids])stack.push(kid);
    }
    results[name]={scoped};
    assert.equal(results[name].scoped,expected,`${name} scope`);
  }
  const host=document.createElement('div');document.body.append(host);
  await writeFile(join(dir,'readable-path-scope.html'),JSON.stringify(results,null,2));
  observations.push({scenario:'readable-path-scope',invocation:'node --test tests/server-port-cards.test.mjs',observable:JSON.stringify(results),pass:true,artifact:join(dir,'readable-path-scope.html')});
  host.remove();
});

after(async()=>{await writeFile(join(evidence,'observations.json'),JSON.stringify({run:dir,observations},null,2));for (const channel of channels) { channel.port1.close(); channel.port2.close(); } await window.happyDOM.close(); stop();});
