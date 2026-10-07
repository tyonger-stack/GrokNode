import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, stat, unlink, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv from 'ajv';
import { WebSocket, WebSocketServer } from 'ws';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { createRfbFilter } from '../tools/node-agent-api/rfb-filter.mjs';
import { createAuth } from '../tools/node-agent-api/auth.mjs';
import { createStore } from '../tools/node-agent-api/store.mjs';
import { createGrokNodeAdapter } from '../tools/node-agent-api/grok-node.mjs';
import { recoverServiceLocks } from '../tools/node-agent-api/persistence.mjs';

const api = JSON.parse(await readFile(new URL('../tools/node-agent-api/openapi.json', import.meta.url), 'utf8'));
const schemaId = 'urn:node-agent-api:openapi';
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(api, schemaId);
const validators = new Map();
function dereference(value) {
  if (!value.$ref) return value;
  return value.$ref.slice(2).split('/').reduce((current, part) => current[part], api);
}
function validateResponse(method, url, status, data) {
  const pathname = new URL(url, 'http://127.0.0.1').pathname;
  const route = Object.keys(api.paths).find(template => template === pathname)
    ?? Object.keys(api.paths).find(template => new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(pathname));
  assert.ok(route, 'OpenAPI route missing: ' + method + ' ' + pathname);
  const operation = api.paths[route][method.toLowerCase()];
  assert.ok(operation, 'OpenAPI method missing: ' + method + ' ' + route);
  const response = dereference(operation.responses[status] ?? operation.responses.default);
  const schema = response.content?.['application/json']?.schema;
  assert.ok(schema, 'OpenAPI JSON response schema missing: ' + route);
  const cacheKey = method + ' ' + route + ' ' + status;
  if (!validators.has(cacheKey)) validators.set(cacheKey, ajv.compile({ ...schema, $id: schemaId + ':response:' + validators.size, ...(schema.$ref ? { $ref: schemaId + schema.$ref } : {}) }));
  const validate = validators.get(cacheKey);
  assert.ok(validate(data), 'Response disagrees with OpenAPI: ' + cacheKey + ' ' + JSON.stringify(validate.errors));
}

// /var is a symlink to /private/var on macOS; the credential store rejects
// symlinked ancestors, so start from the resolved path.
const stateDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-api-')));
const upstreamHttp = createServer();
const upstream = new WebSocketServer({ noServer: true });
upstreamHttp.on('upgrade', (req, socket, head) => upstream.handleUpgrade(req, socket, head, client => upstream.emit('connection', client, req)));
await new Promise(resolve => upstreamHttp.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstreamHttp.address().port;
const received = [];
const drained = Buffer.from('fixture-drained');
upstream.on('connection', socket => {
  let stage = 0;
  socket.send(Buffer.from('RFB 003.008\n', 'ascii'));
  socket.on('message', data => {
    if (stage === 0) { socket.send(Buffer.from([1, 1])); stage = 1; return; }
    if (stage === 1) { socket.send(Buffer.from([0, 0, 0, 0])); stage = 2; return; }
    if (stage === 2) { stage = 3; return; }
    received.push({ type: data[0], size: data.length });
    if (data[0] === 3) socket.send(drained);
  });
});

const bots = [
  { object: 'node.agent', id: 'bot-a', name: 'Alpha', description: '', backend: 'grok_node' },
  { object: 'node.agent', id: 'bot-b', name: 'Beta', description: '', backend: 'grok_node' },
];
let inputLog = [];
const adapter = {
  writesEnabled: true,
  async agents() { return bots; },
  async requireAgent(id) { const bot = bots.find(b => b.id === id); if (!bot) { const error = new Error('missing'); error.status = 404; error.code = 'not_found'; throw error; } return bot; },
  async items() { return [{ kind: 'send-message', id: 'e1', text: 'hello' }]; },
  async input(id, text, requestId) { inputLog.push({ id, text, requestId }); return { accepted: true }; },
  async createAgent(input) { return { object: 'node.agent', id: 'bot-new', name: input.name }; },
  async desktop(id) {
    return { object: 'node.environment', id: 'nenv_' + id, agent_id: id, type: 'grok_node', isolation: 'shared_container_separate_display', container: 'grok-node-local-vm', display: 3, websocketUrl: 'ws://127.0.0.1:' + upstreamPort };
  },
  async viewerAsset(asset) {
    if (asset === 'vnc.html') return Buffer.from('<html><head></head><body>viewer</body></html>');
    if (asset === 'core/rfb.js') return Buffer.from('export class RFB {}');
    throw Object.assign(new Error('missing'), { status: 404, code: 'not_found' });
  },
};

const service = await startNodeAgentApi({ adapter, stateDirectory });
const ownerKey = (await readFile(service.keyFile, 'utf8')).trim();
const authorization = 'Bearer ' + ownerKey;
let sessions = {};
let issued = [];

async function call(method, url, { body, headers = {}, raw = false } = {}) {
  const response = await fetch(service.origin + url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
  if (raw) return response;
  const data = await response.json();
  validateResponse(method, url, response.status, data);
  return { status: response.status, data };
}

test('health and unauthenticated access', async () => {
  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.backend, 'grok_node');
  assert.equal(health.data.compatible_with_openai_sdk, false);
  assert.equal((await call('GET', '/v1/agents')).status, 401);
  assert.equal((await call('GET', '/v1/agents', { headers: { authorization: 'Bearer wrong' } })).status, 401);
});

test('host and origin guard reject foreign requests', async () => {
  const response = await fetch(service.origin + '/v1/agents', { headers: { authorization, origin: 'https://untrusted.invalid' } });
  assert.equal(response.status, 403);
});

test('agent roster is scoped to the caller', async () => {
  const all = await call('GET', '/v1/agents', { headers: { authorization } });
  assert.equal(all.status, 200);
  assert.deepEqual(all.data.data.map(a => a.id), ['bot-a', 'bot-b']);
  const created = await call('POST', '/v1/keys', { headers: { authorization }, body: { scopes: ['agents.read', 'sessions.read', 'sessions.write', 'desktop.view'], bot_ids: ['bot-a'], ttl_seconds: 120 } });
  assert.equal(created.status, 201);
  assert.ok(created.data.key.startsWith('node_') || created.data.key.length > 30);
  issued.push(created.data);
  const scoped = await call('GET', '/v1/agents', { headers: { authorization: 'Bearer ' + created.data.key } });
  assert.deepEqual(scoped.data.data.map(a => a.id), ['bot-a']);
  assert.equal((await call('GET', '/v1/agents/bot-b', { headers: { authorization: 'Bearer ' + created.data.key } })).status, 403);
  assert.equal((await call('GET', '/v1/agents/bot-b', { headers: { authorization } })).status, 200);
});

test('sessions attach to an existing bot and reuse its transcript', async () => {
  const created = await call('POST', '/v1/agents/sessions', { headers: { authorization }, body: { agent_id: 'bot-a' } });
  assert.equal(created.status, 201);
  sessions.a = created.data;
  const again = await call('POST', '/v1/agents/sessions', { headers: { authorization }, body: { agent_id: 'bot-a' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.id, created.data.id);
  const other = await call('POST', '/v1/agents/sessions', { headers: { authorization }, body: { agent: { id: 'bot-b' } } });
  sessions.b = other.data;
  assert.notEqual(other.data.id, created.data.id);
  const list = await call('GET', '/v1/agents/sessions', { headers: { authorization } });
  assert.equal(list.data.data.length >= 2, true);
  const items = await call('GET', '/v1/agents/sessions/' + created.data.id + '/items', { headers: { authorization } });
  assert.equal(items.data.context, 'grok_node_bot_transcript');
  assert.equal(items.data.data[0].text, 'hello');
  const environment = await call('GET', '/v1/agents/sessions/' + created.data.id + '/environment', { headers: { authorization } });
  assert.equal(environment.status, 200);
  assert.equal(environment.data.display, 3);
  assert.equal(Object.hasOwn(environment.data, 'websocketUrl'), false);
  assert.equal((await call('GET', '/v1/agents/sessions/nsess_missing/items', { headers: { authorization } })).status, 404);
});

test('message input is idempotent and streamed as events', async () => {
  const id = sessions.a.id;
  const events = await call('GET', '/v1/agents/sessions/' + id + '/events', { headers: { authorization } });
  assert.equal(events.data.data.some(e => e.type === 'node.session.created'), true);
  const key = 'nreq_fixture_1';
  const first = await call('POST', '/v1/agents/sessions/' + id + '/events', { headers: { authorization }, body: { events: [{ type: 'message', text: 'run the suite' }], idempotency_key: key } });
  assert.equal(first.status, 202);
  assert.equal(first.data.status, 'accepted');
  assert.equal(first.data.completed, false);
  assert.deepEqual(inputLog.at(-1), { id: 'bot-a', text: 'run the suite', requestId: key });
  const replay = await call('POST', '/v1/agents/sessions/' + id + '/events', { headers: { authorization }, body: { events: [{ type: 'message', text: 'run the suite' }], idempotency_key: key } });
  assert.equal(replay.status, 202);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.completed, false, 'acceptance does not prove model completion');
  assert.equal(replay.data.request_id, key);
  assert.equal(inputLog.filter(entry => entry.requestId === key).length, 1);
  const conflict = await call('POST', '/v1/agents/sessions/' + id + '/events', { headers: { authorization }, body: { events: [{ type: 'message', text: 'different' }], idempotency_key: key } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.type, 'idempotency_conflict');
  const unsupported = await call('POST', '/v1/agents/sessions/' + id + '/events', { headers: { authorization }, body: { events: [{ type: 'turn.cancel' }] } });
  assert.equal(unsupported.status, 400);
  const after = await call('GET', '/v1/agents/sessions/' + id + '/events', { headers: { authorization } });
  assert.equal(after.data.data.some(e => e.type === 'node.session.input.accepted' && e.data.request_id === key), true);
});

test('SSE replays stored events and forwards new ones', async () => {
  const id = sessions.a.id;
  const response = await fetch(service.origin + '/v1/agents/sessions/' + id + '/events', { headers: { authorization, accept: 'text/event-stream' } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  const text = new TextDecoder().decode(firstChunk.value);
  assert.match(text, /event: node\.session\.created/);
  const posted = call('POST', '/v1/agents/sessions/' + id + '/events', { headers: { authorization }, body: { events: [{ type: 'message', text: 'stream probe' }] } });
  let live = '';
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !live.includes('node.session.input.accepted')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    live += new TextDecoder().decode(chunk.value);
  }
  await posted;
  assert.match(live, /node\.session\.input\.accepted/);
  await reader.cancel();
});

test('desktop authorization is single-use, bot-bound and server enforced', async () => {
  const view = await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/desktop', { headers: { authorization }, body: { mode: 'view', ttl_seconds: 60 } });
  assert.equal(view.status, 201);
  assert.equal(view.data.single_use, true);
  assert.equal(view.data.server_enforced, true);
  assert.equal(view.data.pauses_agent, false);
  assert.equal(view.data.display, 3);
  const ticket = new URL(view.data.url).searchParams.get('ticket');
  const opened = await call('GET', '/desktop/open?ticket=' + ticket, { raw: true, headers: { authorization } });
  assert.equal(opened.status, 303);
  const cookie = /nodeviewer=([A-Za-z0-9_-]+)/.exec(opened.headers.get('set-cookie'))[1];
  assert.equal((await call('GET', '/desktop/open?ticket=' + ticket, { raw: true, headers: { authorization } })).status, 401);
  const mandatory = await call('GET', '/desktop/lane/' + cookie + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + cookie } });
  const settings = await mandatory.json();
  const validateSettings = ajv.compile({ $ref: schemaId + '#/components/schemas/ViewerSettings' });
  assert.ok(validateSettings(settings), JSON.stringify(validateSettings.errors));
  assert.equal(settings.view_only, true);
  assert.equal(settings.path, 'desktop/lane/' + cookie + '/socket');
  const html = await call('GET', '/desktop/lane/' + cookie + '/vnc.html', { raw: true, headers: { cookie: 'nodeviewer=' + cookie } });
  assert.match(await html.text(), /#noVNC_control_bar/);
  const scoped = issued[0];
  const crossBot = await call('POST', '/v1/agents/sessions/' + sessions.b.id + '/desktop', { headers: { authorization: 'Bearer ' + scoped.key }, body: { mode: 'view' } });
  assert.equal(crossBot.status, 403, 'a bot-a credential must not open bot-b desktop');
  sessions.viewCookie = cookie;
});

async function driveViewer(cookie, messages) {
  const socket = new WebSocket(service.origin.replace('http:', 'ws:') + '/desktop/lane/' + cookie + '/socket', { headers: { cookie: 'nodeviewer=' + cookie, origin: service.origin } });
  const closed = new Promise(resolve => { socket.once('close', resolve); socket.once('error', resolve); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Upstream did not receive the framebuffer barrier')), 4000);
      socket.on('message', data => { if (data.equals(drained)) { clearTimeout(timeout); resolve(); } });
      socket.once('close', () => { clearTimeout(timeout); reject(new Error('Viewer closed before the framebuffer barrier')); });
      socket.once('error', error => { clearTimeout(timeout); reject(error); });
      socket.send(Buffer.from('RFB 003.008\n', 'ascii'));
      socket.send(Buffer.from([1]));
      socket.send(Buffer.from([0]));
      for (const message of messages) socket.send(Buffer.from(message));
      // The upstream acknowledgement proves every preceding message was processed.
      socket.send(Buffer.from([3, 0, 0, 0, 0, 0, 0, 1, 0, 1]));
    });
  } finally { socket.terminate(); await closed; }
}

test('view-only viewers cannot deliver input even when the client tries', async () => {
  received.length = 0;
  await driveViewer(sessions.viewCookie, [
    [4, 1, 0, 0, 0, 0, 0, 65], [5, 0, 0, 0, 0, 0],
    [2, 0, 0, 1, 0, 0, 0, 0], [6, 0, 0, 0, 0, 0, 0, 0],
    [250, 0, 1, 2], [251, 0, 0, 1, 0, 1, 0, 0],
    [255, 0, 0, 1, 0, 0, 0, 65, 0, 0, 0, 30],
  ]);
  const types = received.map(entry => entry.type);
  assert.equal(types.includes(2), true, 'non-mutating SetEncodings must pass');
  for (const type of [4, 5, 6, 250, 251, 255]) assert.equal(types.includes(type), false, 'mutating RFB message ' + type + ' must be dropped in view mode');
});

test('control viewers can deliver input and hold a single exclusive lease', async () => {
  const control = await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/desktop', { headers: { authorization }, body: { mode: 'control', ttl_seconds: 60 } });
  assert.equal(control.status, 201);
  const ticket = new URL(control.data.url).searchParams.get('ticket');
  const opened = await call('GET', '/desktop/open?ticket=' + ticket, { raw: true, headers: { authorization } });
  const cookie = /nodeviewer=([A-Za-z0-9_-]+)/.exec(opened.headers.get('set-cookie'))[1];
  const settings = await (await call('GET', '/desktop/lane/' + cookie + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + cookie } })).json();
  assert.equal(settings.view_only, false);
  const busy = await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/desktop', { headers: { authorization }, body: { mode: 'control' } });
  assert.equal(busy.status, 409);
  assert.equal(busy.data.error.type, 'desktop_busy');
  received.length = 0;
  await driveViewer(cookie, [[5, 0, 0, 0, 0, 0]]);
  assert.equal(received.some(entry => entry.type === 5), true, 'pointer event must pass while the lease is held');
  const released = await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/handback', { headers: { authorization }, body: {} });
  assert.equal(released.data.released, true);
});

test('explicit own-control replacement recovers a viewer without stealing another credential lease', async () => {
  const route = '/v1/agents/sessions/' + sessions.a.id + '/desktop';
  async function open(input, auth = authorization) {
    const result = await call('POST', route, { headers: { authorization: auth }, body: input });
    assert.equal(result.status, 201);
    const opened = await call('GET', new URL(result.data.url).pathname + new URL(result.data.url).search, { raw: true });
    assert.equal(opened.status, 303);
    return /nodeviewer=([A-Za-z0-9_-]+)/.exec(opened.headers.get('set-cookie'))[1];
  }
  try {
    const old = await open({ mode: 'control' });
    const peer = await call('POST', '/v1/keys', { headers: { authorization }, body: { scopes: ['sessions.read', 'desktop.view', 'desktop.control'], bot_ids: ['bot-a'], ttl_seconds: 300 } });
    const refused = await call('POST', route, { headers: { authorization: 'Bearer ' + peer.data.key }, body: { mode: 'control', replace_own_control: true } });
    assert.equal(refused.status, 409);
    const current = await open({ mode: 'control', replace_own_control: true });
    assert.equal((await call('GET', '/desktop/lane/' + old + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + old } })).status, 401);
    const settings = await (await call('GET', '/desktop/lane/' + current + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + current } })).json();
    assert.equal(settings.view_only, false);
    const view = await open({ mode: 'view', replace_own_control: true });
    assert.equal((await call('GET', '/desktop/lane/' + current + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + current } })).status, 401);
    assert.equal((await (await call('GET', '/desktop/lane/' + view + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + view } })).json()).view_only, true);
    await open({ mode: 'control' });
  } finally { await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/handback', { headers: { authorization }, body: {} }); }
});

test('pending replacement tickets cannot evict a newer controller after a race', async () => {
  const route = '/v1/agents/sessions/' + sessions.a.id + '/desktop';
  async function issue() { const r = await call('POST', route, { headers: { authorization }, body: { mode: 'control', replace_own_control: true } }); assert.equal(r.status, 201); return new URL(r.data.url); }
  async function open(url) { return call('GET', url.pathname + url.search, { raw: true }); }
  try {
    const initial = await issue(); assert.equal((await open(initial)).status, 303);
    const a = await issue(), b = await issue();
    assert.equal((await open(a)).status, 303);
    assert.equal((await open(b)).status, 409);
  } finally { await call('POST', '/v1/agents/sessions/' + sessions.a.id + '/handback', { headers: { authorization }, body: {} }); }
});

test('revoking a credential closes its access and live desktop lease', async () => {
  // Authorize a viewer with the scoped credential, then revoke that same key.
  const scoped = issued[0];
  const scopedSession = await call('POST', '/v1/agents/sessions', { headers: { authorization: 'Bearer ' + scoped.key }, body: { agent_id: 'bot-a' } });
  const scopedView = await call('POST', '/v1/agents/sessions/' + scopedSession.data.id + '/desktop', { headers: { authorization: 'Bearer ' + scoped.key }, body: { mode: 'view' } });
  assert.equal(scopedView.status, 201);
  const scopedTicket = new URL(scopedView.data.url).searchParams.get('ticket');
  const scopedOpened = await call('GET', '/desktop/open?ticket=' + scopedTicket, { raw: true, headers: { authorization: 'Bearer ' + scoped.key } });
  const scopedCookie = /nodeviewer=([A-Za-z0-9_-]+)/.exec(scopedOpened.headers.get('set-cookie'))[1];
  assert.equal((await call('GET', '/desktop/lane/' + scopedCookie + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + scopedCookie } })).status, 200);
  const live = new WebSocket(service.origin.replace('http:', 'ws:') + '/desktop/lane/' + scopedCookie + '/socket', { headers: { cookie: 'nodeviewer=' + scopedCookie, origin: service.origin } });
  const liveClosed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Revoked viewer stayed connected')), 4000);
    live.once('close', () => { clearTimeout(timeout); resolve(); });
  });
  await new Promise((resolve, reject) => { live.once('open', resolve); live.once('error', reject); });
  const revoked = await call('DELETE', '/v1/keys/' + scoped.id, { headers: { authorization } });
  assert.equal(revoked.data.revoked, true);
  await liveClosed;
  assert.equal((await call('GET', '/v1/agents', { headers: { authorization: 'Bearer ' + scoped.key } })).status, 401);
  assert.equal((await call('GET', '/desktop/lane/' + scopedCookie + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + scopedCookie } })).status, 401);
  assert.equal((await call('GET', '/desktop/lane/' + sessions.viewCookie + '/mandatory.json', { raw: true, headers: { cookie: 'nodeviewer=' + sessions.viewCookie } })).status, 200, 'an owner viewer stays valid');
});

test('credential store and owner key stay private', async () => {
  assert.equal((await stat(service.keyFile)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(stateDirectory, 'keys.json'))).mode & 0o777, 0o600);
  const stored = await readFile(path.join(stateDirectory, 'keys.json'), 'utf8');
  assert.equal(stored.includes(ownerKey), false);
  assert.equal(stored.includes(issued[0].key), false);
});

test('RFB filter rejects unknown protocols and fragments input correctly', () => {
  const invalid = createRfbFilter(() => true);
  assert.throws(() => invalid(Buffer.from('RFB 003.003\n')), /RFB 3\.8/);
  const init = createRfbFilter(() => true);
  assert.equal(init(Buffer.from('RFB 003.')).length, 0);
  assert.equal(init(Buffer.from('008\n')).length, 1);
  assert.equal(init(Buffer.from([1])).length, 1);
  assert.equal(init(Buffer.from([0])).length, 1);
  // SetPixelFormat is a 20-byte message; a 1-byte fragment must wait.
  assert.equal(init(Buffer.from([0])).length, 0);
  assert.equal(init(Buffer.alloc(19)).length, 1);
  // In the normal phase an unknown message type is rejected outright.
  assert.throws(() => init(Buffer.from([99, 0, 0])), /Unsupported RFB message/);
});

test('pagination follows authorized cursors and rejects invalid limits', async () => {
  const first = await call('GET', '/v1/agents?limit=1', { headers: { authorization } });
  assert.equal(first.data.data[0].id, 'bot-a');
  assert.equal(first.data.has_more, true);
  const next = await call('GET', '/v1/agents?limit=1&after=' + first.data.last_id, { headers: { authorization } });
  assert.equal(next.data.data[0].id, 'bot-b');
  assert.equal(next.data.has_more, false);
  const descending = await call('GET', '/v1/agents?limit=1&order=desc', { headers: { authorization } });
  assert.equal(descending.data.first_id, 'bot-b');
  const filtered = await call('GET', '/v1/agents/sessions?agent_id=bot-b&limit=1', { headers: { authorization } });
  assert.equal(filtered.data.data.length, 1);
  assert.equal(filtered.data.data[0].agent_id, 'bot-b');
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'order=sideways', 'after=missing']) assert.equal((await call('GET', '/v1/agents?' + query, { headers: { authorization } })).status, 400);
});

test('capability discovery explicitly reports unsupported runtime features', async () => {
  const response = await call('GET', '/v1/capabilities', { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.equal(response.data.version, '0.3.0');
  assert.equal(response.data.events.turn_outcomes, false);
  assert.equal(response.data.events.cancellation, false);
  assert.equal(response.data.sessions.independent_conversations, false);
  assert.equal(response.data.security.legacy_vnc_protected, false);
});

test('official text input and concurrent retries submit exactly once', async () => {
  const url = '/v1/agents/sessions/' + sessions.a.id + '/events';
  const body = { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: 'concurrent probe' }] }] }] };
  const key = 'nreq_concurrent';
  const replies = await Promise.all(Array.from({ length: 6 }, () => call('POST', url, { headers: { authorization, 'Idempotency-Key': key }, body })));
  assert.equal(replies.every(r => r.status === 202 && r.data.completed === false), true);
  assert.equal(replies.filter(r => r.data.replayed).length, 5);
  assert.equal(inputLog.filter(entry => entry.requestId === key).length, 1);
  const legacy = await call('POST', url, { headers: { authorization }, body: { events: [{ type: 'message', text: 'concurrent probe' }], idempotency_key: key } });
  assert.equal(legacy.data.replayed, true);
  assert.equal((await call('POST', url, { headers: { authorization, 'Idempotency-Key': 'other' }, body: { ...body, idempotency_key: key } })).status, 400);
  const constructor = await call('POST', url, { headers: { authorization, 'Idempotency-Key': 'constructor' }, body });
  assert.equal(constructor.status, 202, 'valid identifiers must not collide with object prototype fields');
});

test('clean restart preserves metadata and SSE replay from a persisted cursor', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-resume-')));
  let instance = await startNodeAgentApi({ adapter, stateDirectory: directory });
  const key = (await readFile(instance.keyFile, 'utf8')).trim();
  const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  try {
    const created = await (await fetch(instance.origin + '/v1/agents/sessions', { method: 'POST', headers, body: JSON.stringify({ agent_id: 'bot-a', metadata: { project: 'persisted' } }) })).json();
    const base = '/v1/agents/sessions/' + created.id;
    await fetch(instance.origin + base + '/items', { headers });
    const before = await (await fetch(instance.origin + base + '/events', { headers })).json();
    assert.equal(before.data.length, 2);
    await instance.close();
    instance = await startNodeAgentApi({ adapter, stateDirectory: directory });
    assert.equal((await readFile(instance.keyFile, 'utf8')).trim(), key);
    const restored = await (await fetch(instance.origin + base, { headers })).json();
    assert.equal(restored.metadata.project, 'persisted');
    const response = await fetch(instance.origin + base + '/events', { headers: { ...headers, accept: 'text/event-stream', 'Last-Event-ID': before.data[0].id }, signal: AbortSignal.timeout(4000) });
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: node\.session\.items\.changed/);
    assert.equal(first.includes(before.data[1].id), true);
    assert.equal(first.includes('event: node.session.created'), false);
    await reader.cancel();
  } finally { await instance.close(); }
});

test('SSE polling persists one change notification shared by two viewers', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-poll-')));
  let items = [{ id: 'original', text: 'before' }];
  const instance = await startNodeAgentApi({ adapter: { ...adapter, async items() { return items; } }, stateDirectory: directory, pollIntervalMs: 25 });
  const key = (await readFile(instance.keyFile, 'utf8')).trim();
  const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const readers = [];
  try {
    const created = await (await fetch(instance.origin + '/v1/agents/sessions', { method: 'POST', headers, body: JSON.stringify({ agent_id: 'bot-a' }) })).json();
    const base = '/v1/agents/sessions/' + created.id;
    await fetch(instance.origin + base + '/items', { headers });
    const before = await (await fetch(instance.origin + base + '/events', { headers })).json();
    for (let i = 0; i < 2; i++) {
      const response = await fetch(instance.origin + base + '/events?after=' + before.last_id, { headers: { ...headers, accept: 'text/event-stream' }, signal: AbortSignal.timeout(4000) });
      readers.push(response.body.getReader());
    }
    items = [...items, { id: 'new', text: 'after' }];
    const chunks = await Promise.all(readers.map(async reader => new TextDecoder().decode((await reader.read()).value)));
    assert.equal(chunks.every(chunk => chunk.includes('node.session.items.changed')), true);
    const ids = chunks.map(chunk => /^id: ([^\n]+)/.exec(chunk)[1]);
    assert.equal(ids[0], ids[1]);
    const after = await (await fetch(instance.origin + base + '/events?after=' + before.last_id, { headers })).json();
    assert.equal(after.data.length, 1);
    assert.equal(after.data[0].data.item_count, 2);
  } finally { await Promise.all(readers.map(reader => reader.cancel())); await instance.close(); }
});

test('session metadata, persistent item notifications and explicit close', async () => {
  const url = '/v1/agents/sessions/' + sessions.b.id;
  const updated = await call('PATCH', url, { headers: { authorization }, body: { metadata: { project: 'beta' } } });
  assert.equal(updated.data.metadata.project, 'beta');
  assert.equal((await call('PATCH', url, { headers: { authorization }, body: { metadata: { wrong: 1 } } })).status, 400);
  const cleared = await call('PATCH', url, { headers: { authorization }, body: { metadata: null } });
  assert.deepEqual(cleared.data.metadata, {});
  await call('GET', url + '/items', { headers: { authorization } });
  await call('GET', url + '/items', { headers: { authorization } });
  const events = await call('GET', url + '/events', { headers: { authorization } });
  assert.equal(events.data.data.filter(e => e.type === 'node.session.items.changed').length, 1);
  const unknown = await call('GET', url + '/events?after=missing', { raw: true, headers: { authorization, accept: 'text/event-stream' } });
  assert.equal(unknown.status, 400);
  const changed = events.data.data.find(e => e.type === 'node.session.items.changed');
  const resumed = await call('GET', url + '/events?after=' + changed.id, { raw: true, headers: { authorization, accept: 'text/event-stream' } });
  assert.equal(resumed.status, 200, 'an empty replay still establishes the SSE connection');
  await resumed.body.cancel();
  const closed = await call('POST', url + '/close', { headers: { authorization } });
  assert.equal(closed.data.status, 'closed');
  assert.equal((await call('POST', url + '/events', { headers: { authorization }, body: { events: [{ type: 'message', text: 'blocked' }] } })).status, 409);
  const next = await call('POST', '/v1/agents/sessions', { headers: { authorization }, body: { agent_id: 'bot-b', metadata: { project: 'new' } } });
  assert.notEqual(next.data.id, sessions.b.id);
  assert.equal((await call('GET', url, { headers: { authorization } })).data.status, 'closed', 'closed records remain readable');
});

test('delegated credentials cannot outlive or revoke unrelated parents', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-auth-')));
  let now = 1000000;
  const auth = await createAuth(directory, () => now);
  const owner = auth.authenticate('Bearer ' + (await readFile(auth.keyFile, 'utf8')).trim());
  const parent = await auth.issue(owner, { scopes: ['keys.manage', 'agents.read'], bot_ids: ['bot-a'], ttl_seconds: 10 });
  const sibling = await auth.issue(owner, { scopes: ['agents.read'], bot_ids: ['bot-a'], ttl_seconds: 100 });
  const principal = auth.authenticate('Bearer ' + parent.key);
  const child = await auth.issue(principal, { scopes: ['agents.read'], bot_ids: ['bot-a'], ttl_seconds: 100 });
  assert.equal(child.expires_at, parent.expires_at);
  await assert.rejects(auth.revoke(principal, sibling.id), /does not allow/);
  await auth.revoke(owner, parent.id);
  assert.throws(() => auth.authenticate('Bearer ' + child.key), /invalid or expired/);
  assert.equal(auth.authenticate('Bearer ' + sibling.key).id, sibling.id);
  now += 101000;
  assert.throws(() => auth.authenticate('Bearer ' + sibling.key), /invalid or expired/);
});

test('state lock prevents concurrent owners and state symlinks fail closed', async () => {
  await assert.rejects(startNodeAgentApi({ adapter, stateDirectory }), /locked/);
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-state-')));
  await symlink(path.join(stateDirectory, 'sessions.json'), path.join(directory, 'sessions.json'));
  await assert.rejects(createStore(directory), /ELOOP/);
});

test('real process crash preserves input state without resubmitting work', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-crash-')));
  const child = spawn(process.execPath, [new URL('./fixtures/node-agent-api-crash.mjs', import.meta.url).pathname, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const lines = createInterface({ input: child.stdout });
  const notifications = [];
  const listeners = new Set();
  lines.on('line', line => { const value = JSON.parse(line); notifications.push(value); for (const listener of listeners) listener(); });
  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { listeners.delete(check); reject(new Error('Crash fixture did not reach checkpoint')); }, 5000);
      function check() { const value = notifications.find(predicate); if (value) { clearTimeout(timeout); listeners.delete(check); resolve(value); } }
      listeners.add(check); check();
    });
  }
  let recovered;
  try {
    const started = await waitFor(value => value.origin);
    const key = (await readFile(started.keyFile, 'utf8')).trim();
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    const created = await (await fetch(started.origin + '/v1/agents/sessions', { method: 'POST', headers, body: JSON.stringify({ agent_id: 'bot-a' }) })).json();
    const payload = { events: [{ type: 'message', text: 'crash probe' }], idempotency_key: 'nreq_crash' };
    const pending = fetch(started.origin + '/v1/agents/sessions/' + created.id + '/events', { method: 'POST', headers, body: JSON.stringify(payload) }).catch(() => null);
    await waitFor(value => value.backend_called);
    child.kill('SIGKILL'); await exited; await pending;
    // Remove only this test child's lock after authoritative process termination.
    await recoverServiceLocks(directory);
    let calls = 0;
    recovered = await startNodeAgentApi({ adapter: { ...adapter, async input() { calls++; return { accepted: true }; } }, stateDirectory: directory });
    assert.equal((await readFile(recovered.keyFile, 'utf8')).trim(), key);
    const state = await (await fetch(recovered.origin + '/v1/agents/sessions/' + created.id, { headers })).json();
    assert.equal(state.status, 'unknown');
    const replay = await (await fetch(recovered.origin + '/v1/agents/sessions/' + created.id + '/events', { method: 'POST', headers, body: JSON.stringify(payload) })).json();
    assert.equal(replay.status, 'unknown'); assert.equal(replay.replayed, true); assert.equal(calls, 0);
    const events = await (await fetch(recovered.origin + '/v1/agents/sessions/' + created.id + '/events', { headers })).json();
    assert.equal(events.data.some(e => e.type === 'node.session.input.unknown' && e.data.reason === 'service_restart'), true);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } lines.close(); await recovered?.close(); }
});

test('write-enabled GrokNode backends require ownership and safe mounts', async () => {
  const container = 'grok-node-lab-api-test';
  let info = { Name: '/' + container, Config: { Labels: { 'com.groknode.lab.namespace': 'grok-node-lab-api' } }, Mounts: [] };
  const methods = [];
  const guarded = createGrokNodeAdapter({ container, allowWrites: true, async execute(_binary, args) {
    if (args[0] === 'inspect') return { stdout: JSON.stringify([info]) };
    const method = args.at(-2); methods.push(method);
    return { stdout: JSON.stringify(method === 'listAgents' ? bots : { accepted: true }) };
  } });
  await guarded.input('bot-a', 'allowed', 'request');
  assert.equal(methods.includes('sendPrompt'), true);
  methods.length = 0;
  info.Mounts = [{ Type: 'bind', Destination: '/host' }];
  await assert.rejects(guarded.input('bot-a', 'blocked', 'request'), /isolation check/);
  assert.deepEqual(methods, []);
  info.Mounts = []; info.Config.Labels['com.groknode.lab.bot-id'] = 'bot-b';
  await assert.rejects(guarded.input('bot-a', 'blocked', 'request'), /isolation check/);
  info.Config.Labels = {};
  await assert.rejects(guarded.createAgent({ name: 'blocked' }), /namespace label/);
  info.Config.Labels = { 'com.groknode.lab.namespace': 'grok-node-lab-api' }; delete info.Mounts;
  await assert.rejects(guarded.createAgent({ name: 'blocked' }), /isolation check/);
});

test('OpenAPI request schemas accept documented approval, cancel and user-key payloads', () => {
  const approval = ajv.compile({ $ref: schemaId + '#/components/schemas/AnswerAction' });
  assert.equal(approval({ decision: 'accept' }), true);
  assert.equal(approval({ decision: 'decline' }), true);
  assert.equal(approval({ decision: 'approve' }), false);
  assert.equal(approval({}), false);
  assert.equal(approval({ decision: 'accept', command: 'untrusted' }), false);

  const eventInput = api.paths['/v1/agents/sessions/{session_id}/events'].post.requestBody.content['application/json'].schema;
  const submit = ajv.compile({ $ref: schemaId + eventInput.$ref });
  assert.equal(submit({ events: [{ type: 'message', text: 'Run project tests' }], idempotency_key: 'tests-001' }), true);
  assert.equal(submit({ events: [{ type: 'agent.session.input.cancel', turn_id: 'turn_example' }] }), true);
  assert.equal(submit({ events: [{ type: 'agent.session.input.cancel' }] }), false);
  assert.equal(submit({ events: [{ type: 'agent.session.input.cancel', turn_id: 'turn_example' }], idempotency_key: 'cancel-001' }), false);

  const result = ajv.compile({ $ref: schemaId + '#/components/schemas/SubmitResult' });
  assert.equal(result({ request_id: 'tests-001', status: 'accepted', completed: false, turn_id: 'turn_example' }), true);
  assert.equal(result({ accepted: true, turn_id: 'turn_example', completed: false }), true);
  assert.equal(result({ accepted: true, completed: false }), false);
  assert.equal(result({ accepted: true, turn_id: 'turn_example', completed: true }), false);

  const issueKey = ajv.compile({ $ref: schemaId + '#/components/schemas/IssueKey' });
  assert.equal(issueKey({ scopes: ['agents.read', 'sessions.read', 'desktop.view'], bot_ids: ['bot-example'], user_id: 'nuser_example', ttl_seconds: 3600 }), true);
  assert.equal(issueKey({ scopes: ['agents.read'], bot_ids: ['bot-example'], user_id: 42 }), false);

  const settings = ajv.compile({ $ref: schemaId + '#/components/schemas/ViewerSettings' });
  const base = { autoconnect: true, resize: 'scale', reconnect: false, view_only: true };
  assert.equal(settings({ ...base, path: 'desktop/socket' }), true);
  assert.equal(settings({ ...base, path: 'desktop/lane/example_viewer/socket' }), true);
  assert.equal(settings({ ...base, path: 'unrelated/socket' }), false);
});

test('OpenAPI references, operations and response schemas are well formed', () => {
  assert.equal(api.openapi, '3.0.3');
  const operationIds = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) assert.ok(dereference(value), 'Unresolved reference: ' + value.$ref);
    for (const child of Object.values(value)) visit(child);
  }
  visit(api);
  for (const name of Object.keys(api.components.schemas)) ajv.compile({ $ref: schemaId + '#/components/schemas/' + name });
  for (const [route, pathItem] of Object.entries(api.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'delete', 'patch'].includes(method)) continue;
      assert.ok(operation.operationId);
      assert.equal(operationIds.has(operation.operationId), false, 'Duplicate operation ID');
      operationIds.add(operation.operationId);
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(dereference);
      for (const match of route.matchAll(/\{([^}]+)\}/g)) assert.ok(parameters.some(p => p.in === 'path' && p.name === match[1] && p.required));
      for (const response of Object.values(operation.responses)) assert.equal(typeof dereference(response).description, 'string');
    }
  }
});

test.after(async () => {
  await service.close();
  upstream.close();
  await new Promise(resolve => upstreamHttp.close(resolve));
});
