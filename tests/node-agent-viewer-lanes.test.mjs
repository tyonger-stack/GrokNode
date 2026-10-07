import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { ApiError } from '../tools/node-agent-api/errors.mjs';

async function fixture(t, { embeddedViewer = null, validate = true } = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'viewer-lanes-')));
  const http = createServer(), upstream = new WebSocketServer({ server: http });
  const state = { assigned: true, generation: 'a', prepare: [], validated: 0, received: [] };
  upstream.on('connection', socket => {
    socket.send('RFB 003.008\n');
    socket.on('message', data => { state.received.push(Buffer.from(data)); socket.send(data); });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const bot = { id: 'bot-a', backend: 'grok_node' };
  const adapter = {
    async agents() { return [bot]; }, async requireAgent() { return bot; }, async items() { return []; },
    async desktop(id, target, mode, options) {
      state.prepare.push(options.prepare);
      if (!state.assigned && !options.prepare) throw new ApiError(409, 'desktop_unavailable', 'Unassigned');
      state.assigned = true;
      return { display: 3, applicationId: target.application_id ?? null, websocketUrl: `ws://127.0.0.1:${http.address().port}`, containerGenerationImmutableId: state.generation };
    },
    async viewerAsset() { return '<html><head></head><body>fallback</body></html>'; },
    ...(validate ? { async validateDesktop(id, expected) {
      state.validated++;
      assert.equal(id, 'bot-a');
      if (state.hang) return new Promise(() => {});
      if (!state.assigned || expected.containerGenerationImmutableId !== state.generation) throw new ApiError(409, 'desktop_changed', 'Changed');
      return true;
    } } : {}),
  };
  const service = await startNodeAgentApi({ adapter, stateDirectory: directory, embeddedViewer });
  const authorization = 'Bearer ' + (await readFile(service.keyFile, 'utf8')).trim();
  const request = (route, { body, headers = {}, method = body ? 'POST' : 'GET' } = {}) => fetch(service.origin + route, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(9000),
  });
  const created = await request('/v1/agents/sessions', { body: { agent_id: bot.id }, headers: { authorization } });
  assert.equal(created.status, 201);
  const session = await created.json(), route = `/v1/agents/sessions/${session.id}/desktop`;
  const issue = (body = {}, auth = authorization) => request(route, { body, headers: { authorization: auth } });
  async function open(body = {}, auth) {
    const response = await issue(body, auth); assert.equal(response.status, 201);
    const ticket = new URL((await response.json()).url);
    const opened = await request(ticket.pathname + ticket.search); assert.equal(opened.status, 303);
    const location = opened.headers.get('location');
    assert.match(location, /^\/desktop\/lane\/[A-Za-z0-9_-]+\/vnc.html$/);
    const base = location.slice(0, -'vnc.html'.length), cookie = opened.headers.get('set-cookie').split(';')[0];
    assert.ok(opened.headers.get('set-cookie').includes('Path=' + base.slice(0, -1) + ';'));
    return { base, cookie, location };
  }
  async function connect(viewer) {
    const socket = new WebSocket(service.origin.replace('http:', 'ws:') + viewer.base + 'socket', { headers: { cookie: viewer.cookie, origin: service.origin } });
    socket.on('error', () => {});
    const banner = once(socket, 'message');
    await once(socket, 'open'); assert.equal((await banner)[0].toString(), 'RFB 003.008\n');
    return socket;
  }
  async function close(viewer, headers = { cookie: viewer.cookie, origin: service.origin }) {
    return request(viewer.base + 'close', { method: 'POST', headers });
  }
  t.after(async () => {
    await service.close();
    for (const socket of upstream.clients) socket.terminate();
    await new Promise(resolve => upstream.close(resolve));
    await new Promise(resolve => http.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { state, request, issue, open, connect, close, service, authorization, session };
}

test('existing-only is view-only, never prepares missing desktops, and validates its body', async t => {
  const f = await fixture(t);
  f.state.assigned = false;
  assert.equal((await f.issue({ existing_only: true })).status, 409);
  assert.deepEqual(f.state.prepare, [false]); assert.equal(f.state.assigned, false);
  for (const body of [{ existing_only: 'true' }, { mode: 'control', existing_only: true }]) assert.equal((await f.issue(body)).status, 400);
  assert.deepEqual(f.state.prepare, [false]);
  f.state.assigned = true;
  const viewer = await f.open({ mode: 'view', existing_only: true, replace_own_control: false });
  await f.connect(viewer);
  assert.deepEqual(f.state.prepare, [false, false, false, false]);
});

test('desktop and application viewers have isolated cookies, sockets and Cookie+Origin disposal', async t => {
  const f = await fixture(t);
  const a = await f.open(), b = await f.open(), app = await f.open({ target: { type: 'application', application_id: '0x200004' } });
  assert.equal(new Set([a.base, b.base, app.base]).size, 3);
  const sockets = await Promise.all([a, b, app].map(f.connect));
  for (const headers of [{ cookie: a.cookie }, { cookie: a.cookie, origin: 'https://foreign.invalid' }, { origin: f.service.origin }]) {
    assert.ok([401, 403].includes((await f.close(a, headers)).status));
  }
  assert.equal((await f.request(b.location, { headers: { cookie: a.cookie } })).status, 401);
  assert.equal((await f.request('/desktop/vnc.html', { headers: { cookie: a.cookie } })).status, 401);
  assert.equal((await f.close(b, { cookie: a.cookie, origin: f.service.origin })).status, 401);
  const closed = once(sockets[0], 'close');
  assert.equal((await f.close(a)).status, 200); await closed;
  assert.equal((await f.request(a.location, { headers: { cookie: a.cookie } })).status, 401);
  for (let i = 1; i < sockets.length; i++) {
    const socket = sockets[i], response = once(socket, 'message'); socket.send('RFB 003.008\n');
    assert.equal((await response)[0].toString(), 'RFB 003.008\n');
  }
  assert.equal((await f.request(b.location, { headers: { cookie: a.cookie + '; ' + b.cookie } })).status, 200);
});

test('closing a view lane preserves the control lease; closing control releases it', async t => {
  const f = await fixture(t), controller = await f.open({ mode: 'control' }), viewer = await f.open();
  await f.connect(controller); await f.connect(viewer);
  assert.equal((await f.close(viewer)).status, 200);
  assert.equal((await f.issue({ mode: 'control' })).status, 409);
  assert.equal((await f.close(controller)).status, 200);
  assert.equal((await f.issue({ mode: 'control' })).status, 201);
});

for (const change of ['generation', 'assignment', 'timeout']) test('retained sockets fail closed on ' + change, { timeout: 12000 }, async t => {
  const f = await fixture(t), viewer = await f.open(), socket = await f.connect(viewer);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(8500) });
  if (change === 'generation') f.state.generation = 'b';
  if (change === 'assignment') f.state.assigned = false;
  if (change === 'timeout') f.state.hang = true;
  await closed; assert.ok(f.state.validated >= 1);
  assert.equal(socket.readyState, WebSocket.CLOSED);
  assert.ok(f.state.prepare.slice(1).every(value => value === false));
});

for (const action of ['expiry', 'revoke', 'session-close', 'handback']) test('retained connection terminates on ' + action, { timeout: 7000 }, async t => {
  const f = await fixture(t, { validate: false });
  const keyResponse = await f.request('/v1/keys', { body: { scopes: ['sessions.read', 'desktop.view', 'desktop.control'], bot_ids: ['bot-a'], ttl_seconds: action === 'expiry' ? 2 : 60 }, headers: { authorization: f.authorization } });
  assert.equal(keyResponse.status, 201);
  const key = await keyResponse.json();
  const viewer = await f.open({ mode: action === 'handback' ? 'control' : 'view' }, 'Bearer ' + key.key);
  const socket = await f.connect(viewer), closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) });
  if (action === 'revoke') assert.equal((await f.request('/v1/keys/' + key.id, { method: 'DELETE', headers: { authorization: f.authorization } })).status, 200);
  if (action === 'session-close' || action === 'handback') assert.equal((await f.request(`/v1/agents/sessions/${f.session.id}/${action === 'handback' ? 'handback' : 'close'}`, { method: 'POST', headers: { authorization: f.authorization } })).status, 200);
  await closed;
  assert.equal((await f.request(viewer.location, { headers: { cookie: viewer.cookie } })).status, 401);
});

test('injected embedded HTML and bundle are lane protected and fallback remains available', async t => {
  let args;
  const bundle = 'viewer-' + 'a'.repeat(64) + '.js';
  const f = await fixture(t, { embeddedViewer: {
    html(input) { args = input; return `<html><script type="module" src="./${bundle}"></script></html>`; },
    asset(asset) { return asset === bundle ? { body: 'export const ready = true;', contentType: 'text/javascript', cacheControl: 'private, max-age=60' } : null; },
  } });
  const viewer = await f.open();
  const html = await f.request(viewer.location, { headers: { cookie: viewer.cookie } });
  assert.equal(html.status, 200); assert.match(await html.text(), new RegExp(bundle.replace('.', '\\.')));
  assert.equal((await f.request(viewer.location, { headers: { cookie: viewer.cookie, 'if-none-match': '*' } })).status, 200);
  assert.equal(args.mode, 'view'); assert.equal(args.socketPath, viewer.base + 'socket'); assert.ok(args.expiresAt > Date.now());
  const asset = await f.request(viewer.base + bundle, { headers: { cookie: viewer.cookie } });
  assert.equal(asset.status, 200); assert.equal(await asset.text(), 'export const ready = true;');
  assert.equal(asset.headers.get('content-type'), 'text/javascript'); assert.equal(asset.headers.get('cache-control'), 'private, max-age=60');
  assert.equal((await f.request(viewer.base + bundle)).status, 401);
  assert.equal((await f.request(viewer.base + 'unknown.js', { headers: { cookie: viewer.cookie } })).status, 404);
  const legacy = await fixture(t, { validate: false }), oldViewer = await legacy.open();
  const fallback = await legacy.request(oldViewer.location, { headers: { cookie: oldViewer.cookie } });
  assert.match(await fallback.text(), /fallback/); await legacy.connect(oldViewer);
});
