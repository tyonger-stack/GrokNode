import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import * as helpers from '../tools/node-agent-api/web/client.js';

const source = await readFile(new URL('../tools/node-agent-api/web/app.js', import.meta.url), 'utf8');
const evidence = new URL('../.omo/evidence/vnc-frontend-phase-one/', import.meta.url);
await mkdir(evidence, { recursive: true });
const observations = [];
test.after(async () => writeFile(new URL('scenarios.json', evidence), JSON.stringify(observations, null, 2)));

function fixture() {
  let now = 100000, nextTimer = 0;
  const timers = new Map(), elements = new Map(), requests = [], closes = [], messages = [], listeners = new Map(), aliveChecks = [];
  let alive = async () => ({ ok: true, json: async () => ({ view_only: true }) });
  class Element {
    constructor() {
      this.textContent = ''; this.value = ''; this.children = []; this.disabled = false;
      this.events = new Map(); this.contentDocument = { body: { textContent: '' } };
      this.contentWindow = { location: { href: 'http://localhost/desktop/lane/fixture/vnc.html' }, postMessage: (data, origin) => messages.push({ data, origin, iframe: this }) };
    }
    addEventListener(type, fn) { this.events.set(type, fn); }
    removeEventListener(type, fn) { if (this.events.get(type) === fn) this.events.delete(type); }
    replaceChildren(...nodes) { this.children = nodes; for (const n of nodes) n.parentElement = this; }
    append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parentElement = this; }
    closest() { return new Element(); }
    querySelectorAll() { return []; }
    close() {}
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); }
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const api = {
    json(path, options) {
      if (!path.endsWith('/desktop') && !path.endsWith('/handback')) return Promise.resolve({ id: path.split('/').at(-1), agent_id: 'bot', status: 'idle' });
      return new Promise((resolve, reject) => requests.push({ path, ...options, resolve, reject }));
    },
    list: async () => [],
  };
  const sandbox = {
    ...helpers, AbortController, AbortSignal, DOMException, URL, Option: Element, console,
    Date: { now: () => now }, location: { origin: 'http://localhost' },
    setTimeout(fn, ms) { timers.set(++nextTimer, { fn, at: now + ms }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const record = { url: String(url), options };
      if (String(url).endsWith('/mandatory.json')) { aliveChecks.push(record); return alive(); }
      closes.push(record); return {};
    },
    document: { getElementById: $, createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {} },
    window: { addEventListener: (type, fn) => listeners.set(type, fn) },
    createPaintQueue: () => ({ reset() {}, schedule() {}, flush() {} }),
  };
  vm.createContext(Object.assign(sandbox, { api }));
  vm.runInContext(source.replace(/^import[^\n]+\n/, '') + `\n globalThis.probe = {
    desktop, resetSession, disconnect, selectSession, receive, scheduleDesktopPrewarm,
    seed(id = 's1') { client = api; botId = 'bot'; session = {id, status:'idle'}; flags = {view:true, control:true}; },
    clear() { session = undefined; }, closed() { session.status = 'closed'; },
    viewer: () => currentViewer, changing: () => desktopChanging,
  };`, sandbox);
  const p = sandbox.probe;
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return {
    p, $, requests, timers, messages, closes, flush, aliveChecks,
    setAlive(fn) { alive = fn; },
    async tick(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); },
    async authorize(request = requests.at(-1)) { request.resolve({ url: '/desktop/open?ticket=fixture', pauses_agent: false }); await flush(); return p.viewer()?.iframe; },
    async load(frame = p.viewer().iframe) { frame.events.get('load')?.(); await flush(); },
    signal(type, overrides = {}, event = {}) { const viewer = p.viewer(); listeners.get('message')({ origin: 'http://localhost', source: viewer?.iframe.contentWindow, data: {source:'node-agent-viewer', mode:viewer?.mode, expiresAt: now + 1000, type, ...overrides}, ...event }); },
    async healthy() { this.signal('ready'); this.signal('connected'); this.signal('first-frame'); await this.load(); },
    record(name) { observations.push({ scenario: name, observable: 'PASS: all executable assertions satisfied', requests: requests.map(r => ({path:r.path, body:r.body, aborted:r.signal.aborted})), frames: $('desktop').children.length, disposeMessages: messages.length, laneCloses: closes.length }); },
  };
}

async function scenario(t, action) {
  const f = fixture();
  try { await action(f); f.record(t.name); } finally { f.p.resetSession(); }
}

test('selection debounce issues only last-session existing_only view, never auth-only or closed-session prewarm', t => scenario(t, async f => {
  f.p.clear(); f.p.scheduleDesktopPrewarm(); await f.tick(401); assert.equal(f.requests.length, 0);
  f.p.seed('s1'); f.p.scheduleDesktopPrewarm(); await f.tick(100);
  f.p.resetSession(); f.p.seed('s2'); f.p.scheduleDesktopPrewarm(); await f.tick(401);
  assert.equal(f.requests.length, 1); assert.ok(f.requests[0].path.includes('/s2/'));
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].body)), { mode:'view', replace_own_control:false, existing_only:true });
  f.p.resetSession(); f.p.seed(); f.p.closed(); f.p.scheduleDesktopPrewarm(); await f.tick(401); assert.equal(f.requests.length, 1);
}));

test('actual selectSession schedules quiet prewarm; missing desktop falls through explicit prepare', t => scenario(t, async f => {
  f.p.seed(); await f.p.selectSession('selected'); await f.tick(401);
  assert.ok(f.requests[0].path.includes('/selected/'));
  const before = f.$('desktop-status').textContent;
  f.requests[0].reject(new Error('desktop not running')); await f.flush();
  assert.equal(f.$('desktop-status').textContent, before); assert.equal(f.p.viewer(), undefined);
  const open = f.p.desktop('view'); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].body.existing_only, undefined);
  await f.authorize(); await f.load(); await open;
}));

test('healthy current view reuses iframe without authorization; ready/load alone never reuses', t => scenario(t, async f => {
  f.p.seed(); const warm = f.p.desktop('view', false, true); await f.authorize(); f.signal('ready'); await f.load(); await warm;
  const old = f.p.viewer().iframe; const open = f.p.desktop('view'); assert.equal(f.requests.length, 2);
  assert.equal(f.messages[0].iframe, old); await f.authorize(); await f.healthy(); await open;
  const frame = f.p.viewer().iframe; await f.p.desktop('view'); assert.equal(f.requests.length, 2); assert.equal(f.p.viewer().iframe, frame);
  assert.equal(f.$('desktop').children.length, 1);
}));

test('prewarmed first frame is revealed on View with no new request; mode is never promoted', t => scenario(t, async f => {
  f.p.seed(); const warm = f.p.desktop('view', false, true); await f.authorize(); await f.healthy(); await warm;
  const frame = f.p.viewer().iframe; assert.equal(frame.hidden, true);
  await f.p.desktop('view'); assert.equal(frame.hidden, false); assert.equal(f.requests.length, 1);
  const control = f.p.desktop('control'); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].body.mode, 'control'); assert.equal(f.requests[1].body.replace_own_control, true);
  await f.authorize(); await f.healthy(); await control; assert.notEqual(f.p.viewer().iframe, frame);
  const view = f.p.desktop('view'); assert.equal(f.requests.length, 3); assert.equal(f.requests[2].body.mode, 'view'); await f.authorize(); await f.load(); await view;
}));

test('legacy iframe load succeeds but successive View always obtains new authorization', t => scenario(t, async f => {
  f.p.seed(); const a = f.p.desktop('view'); await f.authorize(); await f.load(); await a;
  assert.equal(f.p.changing(), false); assert.match(f.$('desktop-status').textContent, /已签发观看授权/);
  const b = f.p.desktop('view'); assert.equal(f.requests.length, 2); await f.authorize(); await f.load(); await b;
}));

test('wrong origin/window/source/mode and first-frame before connected cannot grant reuse', t => scenario(t, async f => {
  f.p.seed(); const a = f.p.desktop('view'); await f.authorize(); await f.load(); await a;
  f.signal('ready', {}, {origin:'https://evil.invalid'}); assert.equal(f.p.viewer().expiresAt, 0);
  f.signal('ready', {}, {source:{}}); assert.equal(f.p.viewer().expiresAt, 0);
  f.signal('ready', {source:'other'}); assert.equal(f.p.viewer().expiresAt, 0);
  f.signal('ready', {mode:'control'}); assert.equal(f.p.viewer().expiresAt, 0);
  f.signal('ready'); f.signal('first-frame'); assert.equal(f.p.viewer().firstFrame, false);
  f.signal('connected'); assert.equal(f.p.viewer().firstFrame, false);
  const b = f.p.desktop('view'); assert.equal(f.requests.length, 2); await f.authorize(); await f.load(); await b;
}));

test('expiry disposes lane and frame; disconnected similarly prevents reuse', t => scenario(t, async f => {
  f.p.seed(); const a = f.p.desktop('view'); await f.authorize(); await f.healthy(); await a;
  await f.tick(1001); assert.equal(f.p.viewer(), undefined); assert.equal(f.$('desktop').children.length, 0); assert.equal(f.closes.length, 1);
  assert.equal(f.closes[0].url, 'http://localhost/desktop/lane/fixture/close'); assert.equal(f.closes[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages[0].data)), {source:'node-agent-parent', type:'dispose'});
  const b = f.p.desktop('view'); await f.authorize(); await f.healthy(); await b; f.signal('disconnected');
  assert.equal(f.p.viewer(), undefined); assert.equal(f.closes.length, 2);
}));

test('selection and disconnect fence delayed authorization, cancel load waits and expiry timers', t => scenario(t, async f => {
  f.p.seed(); const warm = f.p.desktop('view', false, true); const stale = f.requests[0];
  f.p.resetSession(); f.p.seed('s2'); await f.authorize(stale); await warm; assert.equal(f.p.viewer(), undefined); assert.equal(stale.signal.aborted, true);
  const a = f.p.desktop('view'); const cancelled = assert.rejects(a, {name:'AbortError'}); await f.authorize(); f.signal('ready'); f.p.disconnect(); await cancelled;
  assert.equal(f.p.viewer(), undefined); assert.equal(f.timers.size, 0); assert.equal(f.$('desktop').children.length, 0);
}));

test('explicit Control cancels in-flight prewarm and stale completion cannot overwrite current viewer', t => scenario(t, async f => {
  f.p.seed(); const warm = f.p.desktop('view', false, true), stale = f.requests[0];
  const control = f.p.desktop('control'); await f.authorize(); await f.healthy(); await control;
  const frame = f.p.viewer().iframe; await f.authorize(stale); await warm;
  assert.equal(stale.signal.aborted, true); assert.equal(f.p.viewer().iframe, frame); assert.equal(f.p.viewer().mode, 'control');
}));

test('Handback failure retains control; confirmation precedes fresh view; view failure reports released state', t => scenario(t, async f => {
  f.p.seed(); const a = f.p.desktop('control'); await f.authorize(); await f.healthy(); await a;
  const frame = f.p.viewer().iframe;
  const failed = f.p.desktop('view', true); const rejected = assert.rejects(failed, /denied/); assert.ok(f.requests[1].path.endsWith('/handback'));
  f.requests[1].reject(new Error('denied')); await rejected; assert.equal(f.p.viewer().iframe, frame);
  const b = f.p.desktop('view', true); assert.equal(f.requests.length, 3); assert.equal(f.p.viewer().iframe, frame);
  f.requests[2].resolve({}); await f.flush(); assert.equal(f.requests.length, 4); assert.equal(f.p.viewer(), undefined); assert.equal(f.requests[3].body.mode, 'view');
  await f.authorize(); await f.healthy(); await b; assert.notEqual(f.p.viewer().iframe, frame);
  const c = f.p.desktop('view', true); const reconnect = assert.rejects(c, /控制已交还，但观看重连失败/);
  f.requests[4].resolve({}); await f.flush(); f.requests[5].reject(new Error('offline')); await reconnect;
}));

test('load error and timeout dispose frame; session closed event also disposes', t => scenario(t, async f => {
  f.p.seed(); const a = f.p.desktop('view'); const invalid = assert.rejects(a, /桌面授权已变化/); const frame = await f.authorize();
  frame.contentDocument.body.textContent = '{"error":"expired"}'; await f.load(); await invalid; assert.equal(f.p.viewer(), undefined);
  const b = f.p.desktop('view'); const timeout = assert.rejects(b, /加载超时/); await f.authorize(); await f.tick(30000); await timeout; assert.equal(f.p.viewer(), undefined);
  const c = f.p.desktop('view'); await f.authorize(); await f.healthy(); await c;
  f.p.receive({type:'node.session.closed', data:{session_id:'s1'}}); assert.equal(f.p.viewer(), undefined); assert.equal(f.$('desktop').children.length, 0);
}));

test('server disconnect before Handback response does not abort confirmed view reconnect', t => scenario(t, async f => {
  f.p.seed(); const control = f.p.desktop('control'); await f.authorize(); await f.healthy(); await control;
  const handback = f.p.desktop('view', true), request = f.requests[1];
  f.signal('disconnected'); assert.equal(f.p.viewer(), undefined); assert.equal(request.signal.aborted, false);
  request.resolve({}); await f.flush(); assert.equal(f.requests.length, 3); assert.equal(f.requests[2].body.mode, 'view');
  await f.authorize(); await f.healthy(); await handback; assert.equal(f.p.viewer().mode, 'view');
}));

test('explicit View cancels loading prewarm; detached iframe messages and late load cannot dispose replacement', t => scenario(t, async f => {
  f.p.seed(); const warm = f.p.desktop('view', false, true); const old = await f.authorize();
  const lateLoad = old.events.get('load'); const view = f.p.desktop('view'); await warm;
  assert.equal(old.events.size, 0); const frame = await f.authorize(); await f.healthy(); await view;
  f.signal('disconnected', {}, {source:old.contentWindow}); lateLoad(); await f.flush();
  assert.equal(f.p.viewer().iframe, frame); assert.equal(f.$('desktop').children.length, 1); assert.equal(f.p.changing(), false);
}));

test('cold View before 400ms cancels scheduled prewarm; injectable delay and disabled scheduling stay internal', t => scenario(t, async f => {
  f.p.seed(); f.p.scheduleDesktopPrewarm({ enabled: false }); await f.tick(500); assert.equal(f.requests.length, 0);
  f.p.scheduleDesktopPrewarm(); await f.tick(399); assert.equal(f.requests.length, 0);
  const cold = f.p.desktop('view'); await f.authorize(); await f.healthy(); await cold; await f.tick(500);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.existing_only, undefined);
  f.p.resetSession(); f.p.seed(); f.p.scheduleDesktopPrewarm({delay:10}); await f.tick(10);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].body.existing_only, true);
}));

test('View joins started scheduled prewarm only when healthy; legacy joined load falls through fresh prepare', t => scenario(t, async f => {
  f.p.seed(); f.p.scheduleDesktopPrewarm(); await f.tick(400);
  const joined = f.p.desktop('view'); assert.equal(f.requests.length, 1); assert.equal(f.p.changing(), true);
  await f.authorize(); await f.healthy(); await joined;
  assert.equal(f.requests.length, 1); assert.equal(f.p.viewer().iframe.hidden, false);
  f.p.resetSession(); f.p.seed(); f.p.scheduleDesktopPrewarm(); await f.tick(400);
  const legacy = f.p.desktop('view'); await f.authorize(); await f.load();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].body.existing_only, undefined);
  await f.authorize(); await f.load(); await legacy;
}));

test('inactivity hides old canvas until uncached lane alive check; revoked lane requires fresh authorization', t => scenario(t, async f => {
  f.p.seed(); const open = f.p.desktop('view'); await f.authorize();
  f.signal('ready', {expiresAt:300000}); f.signal('connected'); f.signal('first-frame'); await f.load(); await open;
  const frame = f.p.viewer().iframe;
  let resolve; f.setAlive(() => new Promise(done => { resolve = done; })); await f.tick(30001);
  const reuse = f.p.desktop('view'); assert.equal(frame.hidden, true); assert.equal(f.requests.length, 1);
  assert.equal(f.aliveChecks[0].options.cache, 'no-store'); assert.equal(f.aliveChecks[0].options.credentials, 'same-origin');
  resolve({ok:true, json:async () => ({view_only:true})}); await reuse;
  assert.equal(frame.hidden, false); assert.equal(f.p.viewer().iframe, frame);
  await f.tick(30001); f.setAlive(async () => ({ok:false}));
  const renewed = f.p.desktop('view'); await f.flush(); assert.equal(f.p.viewer(), undefined); assert.equal(f.requests.length, 2);
  await f.authorize(); await f.healthy(); await renewed; assert.notEqual(f.p.viewer().iframe, frame);
}));

test('selection during joined prewarm or lane alive check cannot reveal old canvas or open new session implicitly', t => scenario(t, async f => {
  f.p.seed(); f.p.scheduleDesktopPrewarm(); await f.tick(400); const stale = f.requests[0];
  const joined = f.p.desktop('view'); f.p.resetSession(); f.p.seed('s2'); await f.authorize(stale); await joined;
  assert.equal(f.p.viewer(), undefined); assert.equal(f.requests.length, 1);
  const open = f.p.desktop('view'); await f.authorize(); f.signal('ready', {expiresAt:300000}); f.signal('connected'); f.signal('first-frame'); await f.load(); await open;
  let resolve; f.setAlive(() => new Promise(done => {resolve = done;})); await f.tick(30001);
  const reuse = f.p.desktop('view'); f.p.resetSession(); f.p.seed('s3'); resolve({ok:true,json:async () => ({view_only:true})}); await reuse;
  assert.equal(f.p.viewer(), undefined); assert.equal(f.requests.length, 2); assert.equal(f.aliveChecks[0].options.signal.aborted, true);
}));
