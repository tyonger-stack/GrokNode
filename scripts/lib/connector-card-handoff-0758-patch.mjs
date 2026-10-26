// Port the official 0.75.8 handoff block and browser-open attempt tracking.
// Evidence: chunk-connector-card-view-C82KF2jU.js and index.eager-app-BPR02W4s.js
// Xtt.startOpenAttempt/markOpenFailed. The local flow uses desktop loopback OAuth.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const hash = value => createHash('sha256').update(value).digest('hex');
const shellFile = 'index-UbX-y3il.js';
const cardFile = 'connector-card-BOH-l7tH.js';
const syntax = source => parse(source, { sourceType: 'module', ecmaVersion: 'latest' });

export const OFFICIAL_STRINGS = Object.freeze([
  ['wfJAKj', 'Waiting for {displayName} authorization…', '正在等待 {displayName} 授权…'],
  ['08fv1/', "Couldn't open your browser for {displayName}", '无法为 {displayName} 打开浏览器'],
  ['nVjuaq', 'Copy the sign-in link into your browser, or try again', '请将登录链接复制到浏览器中，或重试'],
  ['8BWxKJ', '{displayName} authorization failed', '{displayName} 授权失败'],
  ['j7klSo', "{displayName} authorization didn't finish", '{displayName} 授权未完成'],
  ['6V3Ea3', 'Copied', '已复制'],
  ['y1eoq1', 'Copy link', '复制链接'],
  ['9sj0G8', 'Copy failed', '复制失败'],
  ['M7SqjM', 'Reopen', '重新打开'],
  ['6gRgw8', 'Retry', '重试'],
]);

function once(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error('Connector handoff ' + label + ' must match exactly once.');
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

export function patchConnectorHandoffStore(source) {
  const klass = syntax(source).body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'PBn');
  if (!klass) throw new Error('Connector handoff store class PBn is missing.');
  let replacement = source.slice(klass.start, klass.end);
  if (replacement.includes('startOpenAttempt(')) throw new Error('Connector handoff store was already patched.');
  replacement = once(replacement, 'nextAllowedOpenAt=0;', 'nextAllowedOpenAt=0;lastOpenAttempt=0;', 'open attempt sequence');
  replacement = once(replacement, 'this.safeOpen(e.authorizationUrl)', 'this.safeOpen({url:e.authorizationUrl})', 'empty connector open');
  replacement = once(replacement, 'this.scheduleOpen(e.authorizationUrl)', 'this.scheduleOpen({url:e.authorizationUrl,attempt:this.startOpenAttempt(r)})', 'initial open');
  replacement = once(replacement, 'this.safeOpen(s.authorizationUrl)', 'this.safeOpen({url:s.authorizationUrl,attempt:this.startOpenAttempt(s)})', 'reopen');
  replacement = once(replacement, 'async safeOpen(e){try{await this.openExternal(e)}catch(t){this.onOpenError?.(t)}}', `startOpenAttempt(entry){entry.openAttempt=++this.lastOpenAttempt;return{key:entry.key,id:entry.openAttempt}}
markOpenFailed(attempt){const entry=this.entries.get(attempt.key);if(entry!=null&&entry.status==="waiting"&&entry.openAttempt===attempt.id){entry.cancelTimeout?.();entry.cancelTimeout=null;entry.status="openFailed";this.emit()}}
async safeOpen(e){try{await this.openExternal(e.url)}catch(t){e.attempt!=null&&this.markOpenFailed(e.attempt);this.onOpenError?.(t)}}`, 'failed browser open');
  const patched = source.slice(0, klass.start) + replacement + source.slice(klass.end);
  syntax(patched);
  return patched;
}

export const HANDOFF_COMPONENT_SOURCE = `
function RConnectorHandoff0758({displayName,handoff}){
  const clipboard=RConnectorClipboard0758();
  const waiting=handoff.status==="waiting";
  const signInUrl=handoff.status==="openFailed"?handoff.signInUrl:void 0;
  const format=(en,zh)=>RLocT(en,zh).replace("{displayName}",displayName);
  const message=waiting?format("Waiting for {displayName} authorization…","正在等待 {displayName} 授权…")
    :handoff.status==="openFailed"?format("Couldn't open your browser for {displayName}","无法为 {displayName} 打开浏览器")
    :handoff.failureDetail!=null?format("{displayName} authorization failed","{displayName} 授权失败")
    :format("{displayName} authorization didn't finish","{displayName} 授权未完成");
  const detail=handoff.status==="openFailed"&&signInUrl!=null?RLocT("Copy the sign-in link into your browser, or try again","请将登录链接复制到浏览器中，或重试")
    :handoff.failureDetail??handoff.portConflictDetail??null;
  return l.jsxs("div",{className:d("sand-connector-card__handoff","sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli"),children:[
    l.jsx(V,{"aria-hidden":true,className:d("sand-2lah0s"),...(waiting?{modifier:"spin",name:"loading"}:{color:"yellow",name:"exclamation-circle"}),size:"sm"}),
    l.jsxs("div",{className:d("sand-1iyjqo2 sand-s83m0k sand-euugli sand-13faqbe"),children:[l.jsx(se,{as:"div",color:"secondary",size:"sm",children:message}),detail==null?null:l.jsx(se,{as:"div",color:"tertiary",size:"xs",children:detail})]}),
    signInUrl==null?null:l.jsx(nn,{onClick:()=>clipboard.copy(signInUrl),rootStyle:fe.action,size:"sm",type:"button",variant:"secondary",children:clipboard.status==="copied"?RLocT("Copied","已复制"):clipboard.status==="error"?RLocT("Copy failed","复制失败"):RLocT("Copy link","复制链接")}),
    l.jsx(nn,{onClick:waiting?handoff.onReopen:handoff.onRetry,rootStyle:fe.action,size:"sm",type:"button",variant:"secondary",children:waiting?RLocT("Reopen","重新打开"):RLocT("Retry","重试")})
  ]})
}
`;

export function patchHandoffSource(source) {
  if (source.includes('function RConnectorHandoff0758(')) throw new Error('Connector handoff card was already patched.');
  if (!source.includes('function RLocT(')) throw new Error('Connector handoff patch requires extra-i18n first.');
  let patched = once(source, 'import{c as ge,', 'import{c1 as RConnectorClipboard0758,c as ge,', 'clipboard hook import');
  const head = 'let ee;e[49]!==a||e[50]!==x||e[51]!==Ne?';
  const tail = 'let O;e[53]';
  const start = patched.indexOf(head), end = patched.indexOf(tail, start);
  if (start < 0 || end < 0 || patched.indexOf(head, start + 1) >= 0) throw new Error('Connector handoff render block is missing or ambiguous.');
  patched = patched.slice(0,start) + 'let ee;e[49]!==a||e[50]!==x||e[51]!==Ne?(ee=Ne?l.jsx(RConnectorHandoff0758,{displayName:a,handoff:x}):null,e[49]=a,e[50]=x,e[51]=Ne,e[52]=ee):ee=e[52];' + patched.slice(end);
  patched = once(patched, 'b=z?.status==="waiting"?"waiting":"stalled"', 'b=z?.status??"stalled"', 'account status');
  patched = once(patched, 'handoff:{status:b,onReopen:', 'handoff:{status:b,signInUrl:z.authorizationUrl,failureDetail:z.failureDetail,portConflictDetail:z.portConflictDetail,onReopen:', 'account handoff fields');
  patched = once(patched, 'wn=ee?.status==="waiting"?"waiting":"stalled"', 'wn=ee?.status??"stalled"', 'card status');
  patched = once(patched, '{status:wn,onReopen:gn,onRetry:qe}', '{status:wn,signInUrl:ee.authorizationUrl,failureDetail:ee.failureDetail,portConflictDetail:ee.portConflictDetail,onReopen:gn,onRetry:qe}', 'card handoff fields');
  const titleStart = patched.indexOf('title:g?'), titleEnd = patched.indexOf(',treatment:"account"',titleStart);
  if (titleStart<0||titleEnd<0) throw new Error('Connector account handoff title anchor is missing.');
  patched = patched.slice(0,titleStart) + 'title:g?RLocT("Waiting for authorization… Click to reopen.","正在等待授权…点击重新打开。"):r.handoff.status==="openFailed"?RLocT("Couldn\'t open your browser. Click to retry.","无法打开浏览器。点击重试。"):r.handoff.failureDetail??RLocT("Authorization didn\'t finish. Click to retry.","授权未完成。点击重试。")' + patched.slice(titleEnd);
  patched += HANDOFF_COMPONENT_SOURCE;
  syntax(patched);
  return patched;
}

export async function applyConnectorCardHandoff0758Patch({stageRoot}) {
  const assets=path.join(stageRoot,'dist/renderer/assets');
  const [shell,card]=await Promise.all([readFile(path.join(assets,shellFile),'utf8'),readFile(path.join(assets,cardFile),'utf8')]);
  const patchedShell=patchConnectorHandoffStore(shell),patchedCard=patchHandoffSource(card);
  const files=[{path:shellFile,before:hash(shell),after:hash(patchedShell)},{path:cardFile,before:hash(card),after:hash(patchedCard)}];
  await writeFile(path.join(assets,shellFile),patchedShell);
  await writeFile(path.join(assets,cardFile),patchedCard);
  const provenance={schemaVersion:1,version:'0.75.8',official:'chunk-connector-card-view-C82KF2jU.js; index.eager-app-BPR02W4s.js Xtt',features:['open-failed-producer','copy-sign-in-link','retry','localized-handoff'],files};
  await writeFile(path.join(stageRoot,'dist/renderer-connector-handoff-0758.json'),JSON.stringify(provenance,null,2)+'\n');
  return provenance;
}
