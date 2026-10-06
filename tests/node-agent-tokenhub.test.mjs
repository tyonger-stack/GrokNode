import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenHub, endpointUrl } from '../tools/node-agent-api/tokenhub.mjs';
import { createModelPolicy } from '../tools/node-agent-api/models.mjs';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tokenhub-'))), requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: req.url, auth: req.headers.authorization, body });
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.authorization !== 'Bearer fixture-secret') return json(401, { error: { message: 'fixture-secret must never be echoed' } });
    if (req.url === '/v1/models') return json(200, { data: [{ id: 'glm-test', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] });
    if (body.reasoning_effort === 'ultra') return json(400, { error: { message: 'unsupported' } });
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const calls = body.tools?.length && !body.messages.some(m => m.role === 'tool');
      const name = body.tools?.[0]?.function?.name;
      const delta = calls ? { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name, arguments: '{"command":"echo hi"}' } }] } : { content: 'OK fixture reply' };
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }) + '\n\n'); res.end('data: [DONE]\n\n'); return;
    }
    return json(200, { id: 'chat_fixture', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base_url = `http://127.0.0.1:${server.address().port}/v1`;
  const hub = await createTokenHub(dir);
  return { dir, requests, base_url, hub, async close() { await hub.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('TokenHub encrypts secrets, discovers remote models, tests actual requests and invalidates evidence on URL/key revisions', async () => {
  const f = await fixture();
  try {
    const changed = await f.hub.update({ base_url: f.base_url, api_key: 'fixture-secret', wire_api: 'chat' });
    assert.equal(changed.key_saved, true); assert.doesNotMatch(JSON.stringify(changed), /fixture-secret/);
    assert.doesNotMatch(await readFile(join(f.dir, 'tokenhub.json'), 'utf8'), /fixture-secret/);
    assert.equal((await stat(join(f.dir, 'tokenhub.json'))).mode & 0o777, 0o600);
    const rows = await f.hub.refresh(); assert.equal(rows.data[0].id, 'glm-test');
    const policy = await createModelPolicy(f.dir, { tokenhub: f.hub });
    await assert.rejects(policy.update({ allowed_models: ['glm-test'] }), /Test this model/);
    const result = await f.hub.test({ model: 'glm-test', reasoning_effort: 'low' });
    assert.equal(result.verification_level, 'connection');
    await policy.update({ allowed_models: ['glm-test'] });
    const chosen = await policy.resolve('bot-a', 'glm-test', 'low'); assert.equal(chosen.endpoint_revision, changed.revision);
    assert.equal((await policy.list('bot-a')).data[0].verification_level, 'connection');
    await assert.rejects(f.hub.test({ model: 'glm-test', reasoning_effort: 'ultra' }), error => error.code === 'model_endpoint_rejected');
    await f.hub.update({ api_key: 'new-secret' });
    assert.equal((await f.hub.catalog()).tests.length, 0);
    assert.equal(f.requests[1].body.reasoning_effort, 'low');
    assert.equal(f.hub.redact(new Error('new-secret fixture-secret')), '[redacted] [redacted]');
    await f.hub.update({ base_url: 'https://example.com/v1' }); assert.equal((await f.hub.settings()).key_saved, false);
    for (const bad of ['http://remote.example/v1', 'https://user:password@example.com', 'https://example.com?api_key=secret', 'http://169.254.169.254/']) assert.throws(() => endpointUrl(bad));
  } finally { await f.close(); }
});

test('installed opencodex relay carries actual streaming function calls and tool results without exposing upstream key to client', async () => {
  const f = await fixture();
  try {
    const configured = await f.hub.update({ base_url: f.base_url, api_key: 'fixture-secret', wire_api: 'chat' });
    const relay = await f.hub.connection(configured.revision, 'low');
    assert.ok(relay.baseUrl.startsWith('http://127.0.0.1:')); assert.notEqual(relay.token, 'fixture-secret');
    const tools = [{ type: 'function', name: 'probe_shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }];
    async function send(input) {
      const r = await fetch(relay.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + relay.token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-test', stream: true, input, tools }) });
      assert.equal(r.status, 200); return r.text();
    }
    const first = await send([{ role: 'user', content: 'Run a tool' }]);
    assert.match(first, /response.completed/); assert.match(first, /function_call/); assert.match(first, /probe_shell/);
    assert.doesNotMatch(first, /fixture-secret/);
    const second = await send([{ role: 'user', content: 'Run a tool' }, { type: 'function_call', call_id: 'call_fixture', name: 'probe_shell', arguments: '{"command":"echo hi"}' }, { type: 'function_call_output', call_id: 'call_fixture', output: 'hi' }]);
    assert.match(second, /OK fixture reply/); assert.match(second, /response.completed/);
    assert.equal(f.requests.at(-1).body.messages.at(-1).role, 'tool');
    assert.equal(f.requests.at(-1).body.reasoning_effort, 'low');
    const unauthorized = await fetch(relay.baseUrl + '/responses', { method: 'POST', body: '{}' }); assert.equal(unauthorized.status, 401);
  } finally { await f.close(); }
});

test('failed or empty model tests never grant verification and disable-thinking only uses known model contracts', async () => {
  const f = await fixture();
  try {
    await f.hub.update({ base_url: f.base_url, api_key: 'wrong-key', wire_api: 'chat' });
    await assert.rejects(f.hub.refresh(), error => error.code === 'model_endpoint_rejected');
    assert.equal((await f.hub.catalog()).models.length, 0);
    await f.hub.update({ api_key: 'fixture-secret' }); await f.hub.refresh();
    await assert.rejects(f.hub.test({ model: 'glm-test', reasoning_effort: 'ultra' }), error => error.code === 'model_endpoint_rejected');
    await assert.rejects(f.hub.test({ model: 'glm-test', reasoning_effort: 'none' }), /known disable-thinking/);
    assert.equal((await f.hub.catalog()).tests.length, 0);
    const empty = await createTokenHub(join(f.dir, 'empty'), { fetcher: async (url) => Response.json(url.endsWith('/models') ? { data: [{ id: 'empty-model' }] } : { choices: [{ message: { content: '' } }] }) });
    try {
      await empty.update({ base_url: f.base_url, api_key: 'fixture-secret', wire_api: 'chat' }); await empty.refresh();
      await assert.rejects(empty.test({ model: 'empty-model' }), error => error.code === 'model_test_incomplete');
      assert.equal((await empty.catalog()).tests.length, 0);
    } finally { await empty.close(); }
  } finally { await f.close(); }
});

test('TokenHub REST owner-only configuration never returns API key and performs real list/test before approval', async () => {
  const f = await fixture(); let api;
  try {
    const catalog = join(f.dir, 'catalog.json'); await writeFile(catalog, JSON.stringify({ models: [{ slug: 'gpt-6.1-sol' }] }));
    api = await startNodeAgentApi({ stateDirectory: join(f.dir, 'api'), adapter: { independentSessions: true, writesEnabled: true, async close() {} }, modelOptions: { catalogFile: catalog } });
    const owner = (await readFile(api.keyFile, 'utf8')).trim();
    async function call(method, path, body, token = owner) { const r = await fetch(api.origin + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
    const key = await call('POST', '/v1/keys', { scopes: ['agents.read','sessions.read'], bot_ids: ['*'], ttl_seconds: 300 });
    assert.equal((await call('PATCH', '/v1/settings/tokenhub', { base_url: f.base_url }, key.data.key)).status, 403);
    const saved = await call('PATCH', '/v1/settings/tokenhub', { base_url: f.base_url, api_key: 'fixture-secret', wire_api: 'chat' });
    assert.equal(saved.status, 200); assert.doesNotMatch(JSON.stringify(saved.data), /fixture-secret/);
    assert.equal((await call('POST', '/v1/settings/tokenhub/models', {})).status, 200);
    assert.equal((await call('POST', '/v1/settings/tokenhub/test', { model: 'glm-test' })).status, 200);
    assert.equal((await call('PATCH', '/v1/settings/models', { allowed_models: ['glm-test'] })).status, 200);
    assert.equal((await call('GET', '/v1/models')).data.data[0].approved, true);
    assert.equal((await call('GET', '/v1/settings/models')).data.default_model, null);
  } finally { await api?.close(); await f.close(); }
});
