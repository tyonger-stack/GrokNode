import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { verifyWebhookSignature } from '../tools/node-agent-api/webhooks.mjs';

const bots = [{ object: 'node.agent', id: 'a', name: 'A', description: '', backend: 'grok_node' }, { object: 'node.agent', id: 'b', name: 'B', description: '', backend: 'grok_node' }];
const adapter = { writesEnabled: false, agents: async () => bots, requireAgent: async id => { const row = bots.find(b => b.id === id); if (!row) throw Error('missing'); return row; }, items: async () => [] };
async function fixture(limits = {}) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'node-http-')));
  const service = await startNodeAgentApi({ adapter, stateDirectory: dir, governanceOptions: { limits: { requests: 1000, ...limits } } });
  const key = (await readFile(service.keyFile, 'utf8')).trim();
  async function call(method, route, data, credential = key) { const r = await fetch(service.origin + route, { method, headers: { authorization: 'Bearer ' + credential, ...(data ? { 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: r.status, data: await r.json() }; }
  return { dir, service, key, call };
}

test('HTTP users, bot grants and rotation enforce boundaries across real requests', async () => {
  const f = await fixture();
  try {
    const alice = (await f.call('POST', '/v1/users', { name: 'Alice' })).data;
    const bob = (await f.call('POST', '/v1/users', { name: 'Bob' })).data;
    const grants = ['agents.read', 'sessions.read', 'sessions.write'];
    const a = (await f.call('POST', '/v1/keys', { user_id: alice.id, scopes: grants, bot_ids: ['a'] })).data;
    const b = (await f.call('POST', '/v1/keys', { user_id: bob.id, scopes: grants, bot_ids: ['b'] })).data;
    assert.deepEqual((await f.call('GET', '/v1/agents', undefined, a.key)).data.data.map(row => row.id), ['a']);
    assert.equal((await f.call('GET', '/v1/agents/b', undefined, a.key)).status, 403);
    const sb = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'b' }, b.key)).data;
    assert.equal((await f.call('GET', '/v1/agents/sessions/' + sb.id, undefined, a.key)).status, 403);
    const replacement = (await f.call('POST', '/v1/keys/' + a.id + '/rotate', {})).data;
    assert.equal((await f.call('GET', '/v1/agents', undefined, a.key)).status, 401);
    assert.equal((await f.call('GET', '/v1/agents', undefined, replacement.key)).status, 200);
    await f.call('POST', '/v1/users/' + bob.id + '/disable', {});
    assert.equal((await f.call('GET', '/v1/agents', undefined, b.key)).status, 401);
    assert.equal((await f.call('POST', '/v1/users', { name: 'Forbidden' }, replacement.key)).status, 403);
  } finally { await f.service.close(); }
});

test('HTTP concurrent requests enforce rate, stream and physical state quotas', async () => {
  const f = await fixture({ requests: 5, streams: 1, storageBytes: 4096 });
  try {
    const replies = await Promise.all(Array.from({ length: 12 }, () => f.call('GET', '/v1/agents')));
    assert.equal(replies.filter(r => r.status === 200).length, 5);
    assert.equal(replies.filter(r => r.status === 429).length, 7);
  } finally { await f.service.close(); }
  const g = await fixture({ streams: 1, storageBytes: 4096 });
  try {
    const session = (await g.call('POST', '/v1/agents/sessions', { agent_id: 'a' })).data;
    const url = g.service.origin + '/v1/agents/sessions/' + session.id + '/events';
    const first = await fetch(url, { headers: { authorization: 'Bearer ' + g.key, accept: 'text/event-stream' } });
    const second = await fetch(url, { headers: { authorization: 'Bearer ' + g.key, accept: 'text/event-stream' } });
    assert.equal(second.status, 429); await first.body.cancel();
    const large = await g.call('PATCH', '/v1/agents/sessions/' + session.id, { metadata: Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['k' + i, 'x'.repeat(500)])) });
    assert.equal(large.status, 413);
    assert.deepEqual((await g.call('GET', '/v1/agents/sessions/' + session.id)).data.metadata, {}, 'rejected data must not alter the live session');
    assert.equal((await g.call('PATCH', '/v1/agents/sessions/' + session.id, { metadata: { accepted: 'small' } })).status, 200, 'quota rejection must not poison other writes');
  } finally { await g.service.close().catch(error => { assert.equal(error.code, 'storage_quota'); }); }
});

test('HTTP webhook configuration signs a persisted event and delivery status is verifiable', async () => {
  const f = await fixture(); let signingKey, received;
  const receiver = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts).toString();
    // HTTP header values arrive as strings; verifyWebhookSignature takes a parsed
    // epoch-seconds value, so convert before verifying (same as the webhook suite).
    assert.equal(verifyWebhookSignature({ keys: [signingKey], keyId: req.headers['x-node-webhook-key-id'], timestamp: Number(req.headers['x-node-webhook-timestamp']), deliveryId: req.headers['x-node-webhook-id'], body, signature: req.headers['x-node-webhook-signature'] }), true);
    received = JSON.parse(body); res.writeHead(204); res.end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  try {
    const configured = await f.call('POST', '/v1/webhooks', { destination: 'http://127.0.0.1:' + receiver.address().port + '/hook' });
    assert.equal(configured.status, 201); signingKey = configured.data.signingKey;
    const session = await f.call('POST', '/v1/agents/sessions', { agent_id: 'a' }); assert.equal(session.status, 201);
    const deadline = Date.now() + 5000;
    while (!received && Date.now() < deadline) { await f.call('POST', '/v1/webhooks/dispatch', {}); if (!received) await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.ok(received); assert.equal(received.event.type, 'node.session.created');
    const status = await f.call('GET', '/v1/webhooks/' + received.delivery_id); assert.equal(status.data.status, 'delivered');
    assert.equal((await f.call('POST', '/v1/webhooks', { destination: 'http://169.254.169.254/latest' })).status, 400);
  } finally { await f.service.close(); await new Promise(resolve => receiver.close(resolve)); }
});
