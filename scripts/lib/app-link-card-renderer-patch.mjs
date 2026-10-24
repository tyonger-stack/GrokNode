import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import catalog from './app-link-cards-official.json' with { type: 'json' };

const tabs = ['overview', 'routines', 'media', 'computer', 'meetings', 'members'];
const targets = ['webhook-url', 'webhook-key', 'webhook-header'];

// 0.71.2 hi/mXe: only canonical app URLs become application chips.
export function parseAppCardLink(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^[\x21-\x7e]+$/.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['sand:', 'grokbot:', 'groknode:'].includes(url.protocol) || url.host !== 'app' ||
      url.username || url.password || url.port || url.hash) return null;
  const route = { '/v1/settings': 'settings', '/v1/sidebar': 'sidebar', '/v1/agent': 'agent',
    '/v1/plugin/add': 'plugin-add', '/v1/bot-template': 'bot-template', '/v1/thread': 'thread', '/v1/task': 'task' }[url.pathname];
  if (route == null) return null;
  const order = route === 'sidebar' ? ['target', 'automation', 'agent', 'tab'] :
    route === 'thread' || route === 'task' ? ['agent', 'id'] : ['id'];
  const values = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!order.includes(key) || Object.hasOwn(values, key)) return null;
    values[key] = value;
  }
  const validAgent = value => /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (values.agent !== undefined && !validAgent(values.agent)) return null;
  if (route === 'settings' && !Object.hasOwn(RAppLinkCatalog.settings, values.id)) return null;
  if (route === 'agent' && !validAgent(values.id ?? '')) return null;
  if (route === 'plugin-add' && !/^[0-9]{1,19}$/.test(values.id ?? '')) return null;
  if (route === 'bot-template' && !/^[A-Za-z0-9_-]{21}$/.test(values.id ?? '')) return null;
  if ((route === 'thread' || route === 'task') && !/^[0-9a-f]{10}$/.test(values.id ?? '')) return null;
  if (route === 'sidebar' && (values.tab !== undefined && !RAppLinkTabs.includes(values.tab) ||
      values.automation !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(values.automation) ||
      values.target !== undefined && !RAppLinkTargets.includes(values.target))) return null;
  const query = new URLSearchParams();
  for (const key of order) if (values[key] !== undefined) query.set(key, values[key]);
  const canonical = `${url.protocol}//app${url.pathname}${query.size ? '?' + query : ''}`;
  if (raw !== canonical) return null;
  return { version: 1, route, ...values };
}

const RAppLinkCatalog = catalog;
const RAppLinkTabs = tabs;
const RAppLinkTargets = targets;

// The same owner-scoped pane request is used by native profile/routine actions.
export function openAppCardLink(link, owner, navigation) {
  switch (link.route) {
    case 'settings': {
      const section = RAppLinkCatalog.settings[link.id].section;
      return navigation.settings(section === 'updates' ? 'beta' : section, link.id);
    }
    case 'sidebar':
      if (link.agent != null && link.automation == null && (link.tab == null || link.tab === 'overview')) return navigation.agent(link.agent);
      return navigation.pane({ agentId: link.agent ?? owner, tab: link.tab ?? 'overview', automationId: link.automation, target: link.target });
    case 'agent': return navigation.agent(link.id);
    case 'plugin-add': return navigation.plugin(link.id);
    case 'bot-template': return navigation.template(link.id);
    case 'thread': case 'task': return navigation.thread(link.id, link.agent ?? owner);
    default: throw new Error('Unknown application card route');
  }
}

function RAppLinkCard({ href, label }) {
  const runtime = Qe(), owner = Mee(), agents = Ra(), transcript = r1(), settingsSections = vDn();
  const link = parseAppCardLink(href);
  const text = label.replace(/\s+/g, ' ').trim();
  if (link == null) return text;
  if (link.route === 'settings') {
    const section = RAppLinkCatalog.settings[link.id].section;
    if (!settingsSections.some(item => item.id === (section === 'updates' ? 'beta' : section))) return text;
  }
  const loc = pair => RLocT(pair[0], pair[1] ?? pair[0]);
  const ui = id => loc(RAppLinkCatalog.ui[id]);
  const agentId = link.route === 'agent' ? link.id : link.agent ?? owner;
  const agent = agents.find(item => item.id === agentId);
  if (link.route === 'agent' && agent == null || link.route === 'sidebar' && agent == null ||
      link.route === 'sidebar' && (link.target != null || link.tab === 'meetings' || link.tab === 'members') ||
      (link.route === 'thread' || link.route === 'task') &&
      (agentId !== owner || transcript.resolveEntry(link.id) == null)) return text;
  let title = text, byline = ui('ixkTse'), description = '', icon = 'globe', action = ui('hoaPGZ');
  switch (link.route) {
    case 'settings': {
      const setting = RAppLinkCatalog.settings[link.id];
      title = loc(setting.label); description = loc(setting.description); icon = 'settings-gear';
      byline = RLocT('Settings', '设置') + ' · ' + loc(({ general: ['General', '通用'], computer: ['Computer', '电脑'],
        usage: ['Usage & Billing', '用量与账单'], updates: ['Updates', '更新'] })[setting.section]);
      action = ui('6ER1KZ'); break;
    }
    case 'agent': title = agent.name; icon = 'agent'; break;
    case 'plugin-add': byline = ui('fOuPPd'); icon = 'plug'; action = ui('PY6dvu'); break;
    case 'bot-template': byline = ui('/K2CvV'); icon = 'agent'; action = ui('kthsWj'); break;
    case 'sidebar':
      if (link.agent != null && link.automation == null && (link.tab == null || link.tab === 'overview')) { title = agent.name; icon = 'agent'; }
      if (link.tab != null) title = loc(({ overview: ['Overview', '概览'], routines: ['Routines', '例行任务'],
        media: ['Library', '资料库'], computer: ['Computer', '电脑'], meetings: ['Meetings', '会议'], members: ['Members', '成员'] })[link.tab]);
      if (link.automation != null) action = ui('hZyuat');
      break;
    case 'thread': case 'task': icon = 'chat-bubbles'; action = RLocT('Open thread', '打开线程'); break;
  }
  const open = () => openAppCardLink(link, owner, {
    settings: (section, id) => {
      RAppSettingReveal?.();
      RAppSettingReveal = revealAppSetting(document, id);
      GD.open(Uf.settings({ section }));
    },
    pane: detail => window.dispatchEvent(new CustomEvent('grok-node-open-app-pane', { detail })),
    agent: id => runtime.selection.select(id),
    plugin: id => qRn(id, 0),
    template: templateId => window.dispatchEvent(new CustomEvent('grok-node-open-bot-template', { detail: templateId })),
    thread: id => transcript.openThread(id),
  });
  const activate = event => { event.preventDefault(); event.stopPropagation(); open(); };
  const keyDown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } };
  const glyph = size => p.jsx(bt, { 'aria-hidden': true, name: icon, size });
  const chip = p.jsxs('span', { className: 'sand-inserted-chip r-app-link-chip sand-3nfvp2 sand-6s0dn4 sand-1jnr06f sand-3y1lgt sand-19yoxgu sand-t9pb60 sand-9f619 sand-g2ss61 sand-16dsc37 sand-uxw1ft sand-193iq5w sand-euugli sand-1heor9g sand-jbqb8w sand-11hyl0l sand-d2x0lb sand-1bo111n sand-1ypdohk sand-4xl6zf sand-9v5kkp sand-1wpm9rq sand-13iak60', 'data-r-app-link': href,
    role: 'button', tabIndex: 0, onClick: activate, onKeyDown: keyDown,
    children: [p.jsx('span', { 'aria-hidden': true, className: 'sand-3nfvp2 sand-6s0dn4 sand-lup9mm sand-2lah0s', children: glyph('xs') }),
      p.jsx('span', { className: 'sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft', children: title })] });
  return p.jsx(_de, { 'aria-label': ui('B3ngzJ'), width: 300, contentStyle: { kLKAdn: 'sand-exx8yu', kwRFfy: 'sand-yri2b', kGO01o: 'sand-18d9i69', kZCmMZ: 'sand-1c1uobl', $$css: true },
    content: close => p.jsxs('div', { className: 'r-app-link-card sand-78zum5 sand-dt5ytf sand-euugli', children: [
      p.jsxs('div', { className: 'sand-78zum5 sand-dt5ytf sand-ehausa sand-euugli sand-1t8xvyj sand-2lprc sand-1m31zm8', children: [
        p.jsxs('div', { className: 'sand-78zum5 sand-6s0dn4 sand-1dbef6d sand-euugli', children: [
          p.jsx('span', { className: 'sand-wz0xwf sand-1ku5rj1 sand-2lah0s sand-1td3qas sand-10w6t97 sand-1043rbw sand-fwqdrz sand-1o0liin', children: glyph('lg') }),
          p.jsxs('div', { className: 'sand-78zum5 sand-dt5ytf sand-12mrbbr sand-euugli', children: [
            p.jsx('p', { className: 'r-app-link-title', children: title }), p.jsx('p', { className: 'r-app-link-byline', children: byline })] })] }),
        description ? p.jsx('p', { className: 'r-app-link-description', children: description }) : null] }),
      p.jsx('div', { className: 'r-app-link-footer', children: p.jsxs('button', { type: 'button', onClick: event => { close(); activate(event); },
        children: [action, p.jsx(bt, { 'aria-hidden': true, name: 'arrow-right', size: 'lg' })] }) })] }), children: chip });
}

export function revealAppSetting(doc, id) {
  const anchor = id === 'local-execution' ? 'computers' : id;
  if (!['computers', 'update-computer', 'reset-computer'].includes(anchor)) return () => {};
  const view = doc.defaultView;
  const stop = () => { observer.disconnect(); view.clearTimeout(timer); };
  const reveal = () => {
    const node = doc.querySelector('[data-r-app-setting="' + anchor + '"]');
    if (node == null) return;
    stop(); node.scrollIntoView({ block: 'center' }); node.focus({ preventScroll: true });
  };
  const observer = new view.MutationObserver(reveal);
  observer.observe(doc.body, { childList: true, subtree: true });
  const timer = view.setTimeout(stop, 5000);
  reveal();
  return stop;
}

const paneBridge = `S.useEffect(()=>{const handle=event=>{const request=event.detail;if(request==null)return;const tab={overview:"details",routines:"details",media:"library",computer:"computer",meetings:"details",members:"details"}[request.tab];if(I({agentId:request.agentId,automationId:request.automationId})){if(request.agentId!==l)s(request.agentId);window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:tab}))}};window.addEventListener("grok-node-open-app-pane",handle);return()=>window.removeEventListener("grok-node-open-app-pane",handle)},[I,l,s]);`;

export function patchAppLinkCards(source) {
  const anchor = 'a({node:n,children:e,href:t,...s}){if(ls(n),$5e(t))';
  const pane = 'function IDn(n){';
  const transform = 'function p1t(n){return $5e(n)||';
  const end = 'return Cr(()=>{z.acceptInputs({isOpen:y,isOverlayStacked:r!=null||i,close:B})})';
  const registry = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},';
  for (const value of [anchor, pane, transform, end, registry, 'function _de(', 'function r1(', 'function vDn(', 'function qRn(']) {
    if (source.split(value).length !== 2) throw new Error('Application card anchor missing or ambiguous: ' + value);
  }
  const injected = `const RAppLinkCatalog=${JSON.stringify(catalog)},RAppLinkTabs=${JSON.stringify(tabs)},RAppLinkTargets=${JSON.stringify(targets)};` +
    'let RAppSettingReveal=null;' + parseAppCardLink.toString() + openAppCardLink.toString() + revealAppSetting.toString() + RAppLinkCard.toString();
  const maintenanceStart = source.indexOf('function vKn(n){'), maintenanceEnd = source.indexOf('async function bKn(', maintenanceStart);
  const maintenance = source.slice(maintenanceStart, maintenanceEnd);
  if (maintenanceStart < 0 || maintenanceEnd < 0 || maintenance.split('children:[D,G]').length !== 2) throw new Error('Computer maintenance rows drifted');
  const maintenancePatched = maintenance.replace('children:[D,G]', 'children:[p.jsx("div",{"data-r-app-setting":"update-computer",tabIndex:-1,children:D}),p.jsx("div",{"data-r-app-setting":"reset-computer",tabIndex:-1,children:G})]');
  const patched = source.replace(maintenance, maintenancePatched)
    .replace(anchor, 'a({node:n,children:e,href:t,...s}){if(parseAppCardLink(t)!=null)return p.jsx(RAppLinkCard,{href:t,label:rde(e)});if(ls(n),$5e(t))')
    .replace(transform, 'function p1t(n){return parseAppCardLink(n)!=null?n:$5e(n)||')
    .replace(registry, registry + '{id:"computer",label:RLocT("Computer","电脑"),icon:"device-desktop"},')
    .replace(pane, injected + pane).replace(end, paneBridge + end);
  parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  return patched;
}

export function patchAppComputerSettings(source) {
  const branch = 'P=x==="beta"?a.jsx(Te,{', rows = 'children:[a.jsx(ma,{}),a.jsx(qs,{';
  // The shared-computer section is mounted inside the computer pane. Left as a sibling of
  // the pane switch it also rendered on Settings → 更新, which must only carry the channel
  // and version rows.
  const rowsEnd = 'workingAgentNames:p})]})}):null';
  for (const anchor of [branch, rows, rowsEnd, 'function da(){']) {
    if (source.split(anchor).length !== 2) throw new Error('Computer settings anchor missing or ambiguous: ' + anchor);
  }
  const patched = source.replace(branch, 'P=x==="beta"||x==="computer"?a.jsx(Te,{')
    .replace(rows, 'children:[x==="beta"?a.jsx(ma,{}):a.jsx("div",{"data-r-app-setting":"computers",tabIndex:-1,children:[a.jsx(re,{title:RLocT("Your computer","你的电脑"),children:a.jsx(da,{})}),a.jsx(qs,{')
    .replace(rowsEnd, 'workingAgentNames:p})]})]})}):null');
  parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  return patched;
}

export async function applyOriginalRendererAppLinkCards({ stageRoot }) {
  const relative = 'dist/renderer/assets/index-UbX-y3il.js', file = path.join(stageRoot, relative);
  const original = await readFile(file, 'utf8'), patched = patchAppLinkCards(original);
  const settingsRelative = 'dist/renderer/assets/index-BlqerJhg.js', settingsPath = path.join(stageRoot, settingsRelative);
  const settingsOriginal = await readFile(settingsPath, 'utf8'), settingsPatched = patchAppComputerSettings(settingsOriginal);
  const cssFile = (await readdir(path.dirname(file))).filter(name => /^index-.*\.css$/.test(name));
  if (cssFile.length !== 1) throw new Error('Application cards require one main stylesheet');
  const cssPath = path.join(path.dirname(file), cssFile[0]), originalCss = await readFile(cssPath, 'utf8');
  const css = await readFile(new URL('./app-link-cards-official.css', import.meta.url), 'utf8');
  const patchedCss = originalCss + '\n' + css;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const evidence = { referenceVersion: '0.71.2', referenceEvidence: 'ev_da6b32f08dd860d21dc6b4dadfae02488ff7553691c57b63d500a0869a060083',
    file: relative, originalSha256: hash(original), patchedSha256: hash(patched),
    settings: { file: settingsRelative, originalSha256: hash(settingsOriginal), patchedSha256: hash(settingsPatched) },
    css: { file: 'dist/renderer/assets/' + cssFile[0], originalSha256: hash(originalCss), patchedSha256: hash(patchedCss) } };
  await writeFile(file, patched); await writeFile(settingsPath, settingsPatched); await writeFile(cssPath, patchedCss);
  await writeFile(path.join(stageRoot, 'dist/renderer-app-link-cards-extension.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
