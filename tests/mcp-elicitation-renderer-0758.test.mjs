import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {Window} from 'happy-dom';
import {MCP_ELICITATION_ANCHORS} from '../scripts/lib/mcp-elicitation-0758-patch.mjs';
const dom=new Window();globalThis.window=dom;globalThis.document=dom.document;globalThis.HTMLElement=dom.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),jsx=await import('react/jsx-runtime');const{createRoot}=await import('react-dom/client');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('the rendered elicitation card localizes, submits once, exposes failures and retires controls',async()=>{
  const shell=({title,summary,actions=[],failureNote,status,disclosure})=>React.createElement('section',null,React.createElement('h2',null,title),summary,...actions.map(action=>React.createElement('button',{key:action.label,onClick:action.onClick,disabled:action.disabled},action.label)),failureNote?React.createElement('p',{role:'alert'},failureNote):null,status?.label,disclosure?React.createElement('details',null,React.createElement('summary',null,disclosure.label),disclosure.detail.text):null);
  const Component=vm.runInNewContext(MCP_ELICITATION_ANCHORS.component+';RMcpElicitation0758',{F:React,C:jsx,q:shell,RMcpText:({children})=>React.createElement('div',null,children),RArIcon:()=>null,RLocT:(en,zh)=>zh});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let answers=[],finish;
  let respond=resolution=>{answers.push(resolution);return new Promise(resolve=>finish=resolve)};
  const render=async(status='pending',message='Confirm this report?')=>React.act(async()=>{root.render(React.createElement(Component,{approval:{summaryCopy:{kind:'mcp_elicitation',params:{message,serverDisplayName:'Calendar',toolName:'create'}}},status,canAct:status==='pending',fallbackTitle:'Approval',onResolve:resolution=>respond(resolution)}));await tick()});
  try{
    await render();assert.match(host.textContent,/Calendar 需要你确认/);assert.match(host.textContent,/运行 create 时/);
    await React.act(async()=>{const allow=[...host.querySelectorAll('button')].find(x=>x.textContent==='允许');allow.click();allow.click();await tick()});
    assert.deepEqual(answers,['approved']);assert.ok([...host.querySelectorAll('button')].every(button=>button.disabled));
    await React.act(async()=>{finish();await tick()});
    respond=()=>{throw new Error('sync transport failure')};await React.act(async()=>{host.querySelector('button').click();await tick()});assert.match(host.textContent,/你的回答未发送成功/);
    await render('denied','long request '.repeat(80));assert.equal(host.querySelectorAll('button').length,0);assert.match(host.textContent,/已拒绝/);assert.equal(host.querySelector('summary').textContent,'查看完整请求');
    await render('expired');assert.match(host.textContent,/已过期/);assert.equal(host.querySelectorAll('button').length,0);
  }finally{await React.act(async()=>root.unmount());host.remove();await dom.happyDOM.close()}
});
