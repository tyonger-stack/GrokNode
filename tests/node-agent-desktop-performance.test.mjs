import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { ApiError } from '../tools/node-agent-api/errors.mjs';

const evidence = { admissions: [], assets: [], renewals: [], cleanup: [] };
const record = (group, scenario, result) => evidence[group].push({ scenario, ...result });

async function fixture(t) {
  const stateDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'desktop-admission-')));
  const upstreamHttp = createServer();
  const upstream = new WebSocketServer({ server: upstreamHttp });
  const state = { running: true, assigned: true, application: true, revision: 'opaque-a', startedAt: 'start-a', generation: 'container-a', bytes: 'export const revision = 1;', html: '<html><head></head><body>fixture</body></html>', css: 'body { color: black; }', legacy: false };
  const counts = { prepare: 0, upstream: 0, assets: 0, options: [] };
  upstream.on('connection', socket => { counts.upstream++; socket.send(Buffer.from('RFB 003.008\n')); });
  await new Promise((resolve, reject) => { upstreamHttp.once('error', reject); upstreamHttp.listen(0, '127.0.0.1', resolve); });
  const bot = { object: 'node.agent', id: 'bot-a', name: 'Fixture', backend: 'grok_node' };
  const adapter = {
    writesEnabled: true,
    async agents() { return [bot]; },
    async requireAgent() { return bot; },
    async items() { return []; },
    async desktop(id, target = { type: 'desktop' }, mode = 'view', options = { prepare: true }) {
      counts.options.push(options.prepare);
      if (!state.running) throw new ApiError(409, 'container_stopped', 'Fixture stopped');
      if (!state.assigned) {
        if (!options.prepare) throw new ApiError(409, 'desktop_unavailable', 'Fixture unassigned');
        counts.prepare++; state.assigned = true;
      }
      if (target.type === 'application' && !state.application) throw new ApiError(404, 'application_not_found', 'Fixture application closed');
      return { display: 3, websocketUrl: 'ws://127.0.0.1:' + upstreamHttp.address().port,
        containerGenerationImmutableId: state.generation,
        applicationId: target.application_id ?? null,
        ...(!state.legacy ? { assignmentRevision: state.revision, containerStartedAt: state.startedAt } : {}) };
    },
    async viewerAsset(asset) {
      counts.assets++;
      state.assetEntered?.();
      if (state.assetBarrier) await state.assetBarrier;
      if (!state.running) throw new ApiError(409, 'container_stopped', 'Fixture stopped');
      if (asset === 'core/rfb.js') return Buffer.from(state.bytes);
      if (asset === 'vnc.html') return Buffer.from(state.html);
      if (asset === 'app/style.css') return Buffer.from(state.css);
      throw new ApiError(404, 'not_found', 'Fixture asset missing');
    },
  };
  const service = await startNodeAgentApi({ adapter, stateDirectory });
  const authorization = 'Bearer ' + (await readFile(service.keyFile, 'utf8')).trim();
  async function request(route, { method = 'GET', body, headers = {} } = {}) {
    return fetch(service.origin + route, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(5000) });
  }
  const created = await request('/v1/agents/sessions', { method: 'POST', body: { agent_id: 'bot-a' }, headers: { authorization } });
  assert.equal(created.status, 201);
  const session = await created.json();
  async function issue(body = {}, auth = authorization) {
    const response = await request('/v1/agents/sessions/' + session.id + '/desktop', { method: 'POST', body, headers: { authorization: auth } });
    assert.equal(response.status, 201);
    const url = new URL((await response.json()).url);
    return url.pathname + url.search;
  }
  async function open(ticket) {
    const response = await request(ticket);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { response, cookie, base: response.headers.get('location')?.replace(/vnc\.html$/, '') };
  }
  async function upgrade(viewer, expected = 101, origin = service.origin) {
    const socket = new WebSocket(service.origin.replace('http:', 'ws:') + viewer.base + 'socket', { headers: { cookie: viewer.cookie, origin }, handshakeTimeout: 4000 });
    const closed = new Promise(resolve => socket.once('close', resolve));
    socket.on('error', () => {});
    try {
      const status = await new Promise((resolve, reject) => {
        socket.once('open', () => resolve(101));
        socket.once('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); });
        socket.once('error', () => reject(new Error('Fixture upgrade failed without HTTP response')));
      });
      if (status === 101 && expected === 101) {
        const [bytes] = await once(socket, 'message');
        assert.equal(bytes.toString(), 'RFB 003.008\n');
      }
      assert.equal(status, expected);
      return status;
    } finally { socket.terminate(); await closed; }
  }
  t.after(async () => {
    await service.close();
    for (const socket of upstream.clients) socket.terminate();
    await new Promise(resolve => upstream.close(resolve));
    await new Promise(resolve => upstreamHttp.close(resolve));
    await rm(stateDirectory, { recursive: true, force: true });
    record('cleanup', t.name, { apiClosed: true, upstreamClosed: true, temporaryStateRemoved: true });
  });
  return { state, counts, request, issue, open, upgrade, authorization };
}

test('issue may prepare once; open and upgrade validate and deliver upstream RFB', async t => {
  const f = await fixture(t);
  f.state.assigned = false;
  const ticket = await f.issue();
  const viewer = await f.open(ticket);
  assert.equal(viewer.response.status, 303);
  assert.equal(viewer.response.headers.get('cache-control'), 'no-store');
  await f.upgrade(viewer);
  assert.deepEqual(f.counts.options, [true, false, false]);
  assert.equal(f.counts.prepare, 1);
  assert.equal(f.counts.upstream, 1);
  assert.equal((await f.request(ticket)).status, 401);
  record('admissions', t.name, { options: f.counts.options, preparations: f.counts.prepare, upstreamConnections: f.counts.upstream, replayStatus: 401, rfbBannerReceived: true });
});

const changes = {
  assignmentRevision: state => { state.revision = 'opaque-b'; },
  containerStartedAt: state => { state.startedAt = 'start-b'; },
  containerId: state => { state.generation = 'container-b'; },
  missingRevision: state => { state.legacy = true; },
  stopped: state => { state.running = false; },
  unassigned: state => { state.assigned = false; },
  applicationClosed: state => { state.application = false; },
};
for (const stage of ['open', 'upgrade']) for (const [change, mutate] of Object.entries(changes)) {
  test(stage + ' rejects ' + change + ' without preparing or connecting upstream', async t => {
    const f = await fixture(t);
    const body = change === 'applicationClosed' ? { target: { type: 'application', application_id: '0x200004' } } : {};
    const ticket = await f.issue(body);
    const viewer = stage === 'upgrade' ? await f.open(ticket) : null;
    mutate(f.state);
    const expected = change === 'applicationClosed' ? 404 : 409;
    const status = stage === 'open' ? (await f.request(ticket)).status : await f.upgrade(viewer, expected);
    assert.equal(status, expected);
    assert.equal(f.counts.prepare, 0);
    assert.equal(f.counts.upstream, 0);
    record('admissions', t.name, { status, preparations: f.counts.prepare, upstreamConnections: f.counts.upstream });
  });
}

test('legacy environments without revision fields still open and upgrade', async t => {
  const f = await fixture(t); f.state.legacy = true;
  const viewer = await f.open(await f.issue());
  assert.equal(viewer.response.status, 303);
  await f.upgrade(viewer);
  record('admissions', t.name, { openStatus: 303, upgradeStatus: 101, rfbBannerReceived: true });
});

test('static assets revalidate private ETags against current bytes; dynamic settings stay no-store', async t => {
  const f = await fixture(t);
  const viewer = await f.open(await f.issue());
  const headers = { cookie: viewer.cookie };
  const first = await f.request(viewer.base + 'core/rfb.js', { headers });
  assert.equal(first.status, 200);
  assert.equal(await first.text(), f.state.bytes);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.equal(first.headers.get('vary'), null);
  const conditional = { ...headers, 'if-none-match': etag };
  const cached = await f.request(viewer.base + 'core/rfb.js', { headers: conditional });
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  assert.equal(cached.headers.get('cache-control'), 'private, no-cache');
  assert.equal(f.counts.assets, 2, 'conditional requests must still validate runtime asset generation');
  for (const condition of ['W/' + etag, '"unrelated", ' + etag, '*']) {
    const response = await f.request(viewer.base + 'core/rfb.js', { headers: { ...headers, 'if-none-match': condition } });
    assert.equal(response.status, 304); assert.equal(await response.text(), '');
  }
  f.state.bytes = 'export const revision = 2;';
  const changed = await f.request(viewer.base + 'core/rfb.js', { headers: conditional });
  assert.equal(changed.status, 200); assert.equal(await changed.text(), f.state.bytes);
  assert.notEqual(changed.headers.get('etag'), etag);
  for (const asset of ['mandatory.json', 'defaults.json']) {
    const response = await f.request(viewer.base + asset, { headers: { ...headers, 'if-none-match': '*' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null); await response.json();
  }
  const html = await f.request(viewer.base + 'vnc.html', { headers });
  assert.match(await html.text(), /#noVNC_control_bar/);
  assert.ok(html.headers.get('etag'));
  const missing = await f.request(viewer.base + 'core/missing.js', { headers: conditional });
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store');
  assert.equal(missing.headers.get('etag'), null);
  f.state.running = false;
  const stopped = await f.request(viewer.base + 'core/rfb.js', { headers: conditional });
  assert.equal(stopped.status, 409); assert.equal(stopped.headers.get('cache-control'), 'no-store');
  record('assets', t.name, { firstStatus: 200, cachedStatus: 304, changedStatus: 200, stoppedStatus: 409, privateRevalidation: true, dynamicNoStore: true });
});

for (const [asset, field, changedBytes] of [
  ['vnc.html', 'html', '<html><head></head><body>updated fixture</body></html>'],
  ['core/rfb.js', 'bytes', 'export const revision = 2;'],
  ['app/style.css', 'css', 'body { color: blue; }'],
]) {
  test('static ' + asset + ' reuses content ETag across viewer reauthorization without Cookie Vary', async t => {
    const f = await fixture(t);
    const firstViewer = await f.open(await f.issue({ mode: 'view' }));
    assert.equal(firstViewer.response.status, 303);
    const first = await f.request(firstViewer.base + asset, { headers: { cookie: firstViewer.cookie } });
    assert.equal(first.status, 200);
    const body = await first.text(), etag = first.headers.get('etag');
    assert.ok(etag);
    const secondViewer = await f.open(await f.issue({ mode: 'view' }));
    assert.equal(secondViewer.response.status, 303);
    assert.notEqual(secondViewer.cookie, firstViewer.cookie);
    assert.notEqual(secondViewer.base, firstViewer.base);
    const headers = { cookie: secondViewer.cookie, 'if-none-match': etag };
    const reused = await f.request(secondViewer.base + asset, { headers });
    assert.equal(reused.status, 304); assert.equal(await reused.text(), '');
    assert.equal(reused.headers.get('etag'), etag);
    assert.equal(f.counts.assets, 2, 'new viewer conditional requests must load current asset bytes');
    f.state[field] = changedBytes;
    const changed = await f.request(secondViewer.base + asset, { headers });
    assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), etag);
    const expectedBody = asset === 'vnc.html' ? body.replace('fixture', 'updated fixture') : changedBytes;
    assert.equal(await changed.text(), expectedBody);
    for (const response of [first, reused, changed]) {
      assert.equal(response.headers.get('cache-control'), 'private, no-cache');
      assert.equal(response.headers.get('vary'), null, 'viewer-independent static bytes must not partition the cache by cookie');
    }
    record('renewals', t.name, { asset, cookiesDiffer: true, firstStatus: first.status, renewedStatus: reused.status, changedStatus: changed.status, vary: reused.headers.get('vary'), cacheControl: reused.headers.get('cache-control'), assetReads: f.counts.assets, sameEtagOnRenewal: true, changedEtagOnNewBytes: true });
  });
}

test('conditional assets require an active viewer and reject revoked keys before 304', async t => {
  const f = await fixture(t);
  const keyResponse = await f.request('/v1/keys', { method: 'POST', headers: { authorization: f.authorization }, body: { scopes: ['sessions.read', 'desktop.view'], bot_ids: ['bot-a'] } });
  assert.equal(keyResponse.status, 201);
  const key = await keyResponse.json();
  const viewer = await f.open(await f.issue({}, 'Bearer ' + key.key));
  const asset = viewer.base + 'core/rfb.js';
  const first = await f.request(asset, { headers: { cookie: viewer.cookie } });
  const etag = first.headers.get('etag'); await first.arrayBuffer();
  assert.ok(etag);
  assert.equal((await f.request(asset, { headers: { 'if-none-match': etag } })).status, 401);
  assert.equal((await f.request('/v1/keys/' + key.id, { method: 'DELETE', headers: { authorization: f.authorization } })).status, 200);
  const revoked = await f.request(asset, { headers: { cookie: viewer.cookie, 'if-none-match': etag } });
  assert.equal(revoked.status, 401); assert.equal(revoked.headers.get('cache-control'), 'no-store');
  assert.equal(f.counts.assets, 1);
  record('assets', t.name, { missingViewerStatus: 401, revokedViewerStatus: 401, assetReads: f.counts.assets });
});

test('revocation while an asset loads prevents a conditional response', async t => {
  const f = await fixture(t);
  const keyResponse = await f.request('/v1/keys', { method: 'POST', headers: { authorization: f.authorization }, body: { scopes: ['sessions.read', 'desktop.view'], bot_ids: ['bot-a'] } });
  assert.equal(keyResponse.status, 201);
  const key = await keyResponse.json();
  const viewer = await f.open(await f.issue({}, 'Bearer ' + key.key));
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  f.state.assetEntered = entered.resolve; f.state.assetBarrier = released.promise;
  const pending = f.request(viewer.base + 'core/rfb.js', { headers: { cookie: viewer.cookie, 'if-none-match': '*' } });
  try {
    await entered.promise;
    const revoked = await f.request('/v1/keys/' + key.id, { method: 'DELETE', headers: { authorization: f.authorization } });
    assert.equal(revoked.status, 200);
  } finally { released.resolve(); }
  const response = await pending;
  assert.equal(response.status, 401); assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  record('assets', t.name, { status: response.status, noEtag: true, noStore: true });
});

test('application cookies cannot authenticate another lane or desktop; foreign WS origin is rejected', async t => {
  const f = await fixture(t);
  const app = await f.open(await f.issue({ target: { type: 'application', application_id: '0x200004' } }));
  const other = await f.open(await f.issue({ target: { type: 'application', application_id: '0x200005' } }));
  const first = await f.request(app.base + 'core/rfb.js', { headers: { cookie: app.cookie } });
  const etag = first.headers.get('etag'); await first.arrayBuffer();
  for (const base of ['/desktop/', other.base]) assert.equal((await f.request(base + 'core/rfb.js', { headers: { cookie: app.cookie, 'if-none-match': etag ?? '*' } })).status, 401);
  const settings = await (await f.request(app.base + 'mandatory.json', { headers: { cookie: app.cookie } })).json();
  assert.equal(settings.path, app.base.slice(1) + 'socket');
  await f.upgrade(app, 403, 'https://foreign.invalid');
  assert.equal(f.counts.upstream, 0);
  await f.upgrade(app);
  record('admissions', t.name, { crossLaneStatus: 401, desktopStatus: 401, foreignOriginStatus: 403, applicationUpgradeStatus: 101 });
});

test.after(async () => {
  if (!process.env.NODE_AGENT_DESKTOP_EVIDENCE_DIR) return;
  for (const [filename, rows] of [['ticket-flow.json', evidence.admissions], ['cache-headers.json', evidence.assets], ['cache-renewal.json', evidence.renewals], ['cleanup.json', evidence.cleanup]]) {
    await writeFile(path.join(process.env.NODE_AGENT_DESKTOP_EVIDENCE_DIR, filename), JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 });
  }
});
