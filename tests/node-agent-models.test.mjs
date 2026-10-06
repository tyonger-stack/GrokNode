import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { createCodexAdapter } from '../tools/node-agent-api/codex.mjs';
import { rpcParams } from '../tools/node-agent-api/runtime/harness.mjs';

async function fixture({ returnedModel, defaultModel = 'gpt-6.1-sol' } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'node-models-'))), catalogFile = join(dir, 'catalog.json');
  await writeFile(catalogFile, JSON.stringify({ models: [{ slug: 'gpt-6.1-sol' }, { slug: 'model-b' }, { slug: 'unverified' }] }));
  const calls = [], events = new EventEmitter(), threads = new Map(); let seq = 0;
  const harness = {
    redact: value => value, subscribe(fn) { events.on('event', fn); return () => events.off('event', fn); },
    async request(bot, method, params) {
      const safe = rpcParams(method, params); calls.push({ bot, method, params: safe });
      if (method === 'thread/start') { const id = 'thread_' + ++seq; threads.set(id, safe.model); return { thread: { id }, model: returnedModel ?? safe.model }; }
      if (method === 'thread/resume') return { model: threads.get(safe.threadId) };
      if (method === 'thread/read') return { thread: { turns: [] } };
      if (method === 'turn/start') return { turn: { id: 'turn_' + ++seq, status: 'completed' } };
      return {};
    },
    async disconnect() {}, async close() {},
  };
  const roster = { async requireAgent(id) { if (!['bot-a', 'bot-b'].includes(id)) throw Object.assign(new Error('missing'), { status: 404 }); return { id }; }, async agents() { return [{ id: 'bot-a' }, { id: 'bot-b' }]; } };
  const runtime = { shared: true, async ensure() {}, async status() { return { containerId: 'shared' }; }, async close() {} };
  const createAdapter = () => createCodexAdapter({ runtime, harness, roster, namespace: 'grok-node-lab-test', stateRoot: dir });
  const adapter = createAdapter();
  const stateDirectory = join(dir, 'api');
  let service = await startNodeAgentApi({ adapter, stateDirectory, modelOptions: { catalogFile, defaultModel } });
  const owner = (await readFile(service.keyFile, 'utf8')).trim();
  async function call(method, route, data, key = owner) {
    const r = await fetch(service.origin + route, { method, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  }
  return { dir, calls, catalogFile, call, async close() { await service.close(); }, async restart() { await service.close(); service = await startNodeAgentApi({ adapter: createAdapter(), stateDirectory, modelOptions: { catalogFile, defaultModel } }); } };
}
const approval = { allowed_models: ['gpt-6.1-sol', 'model-b'], verified_models: [{ id: 'gpt-6.1-sol', evidence: 'fixture baseline' }, { id: 'model-b', evidence: 'fixture native tools and cancellation verified' }] };

test('owner alone manages defaults and approval requires tool-workflow evidence', async () => {
  const f = await fixture();
  try {
    const issued = await f.call('POST', '/v1/keys', { scopes: ['agents.read', 'agents.write', 'sessions.read', 'sessions.write', 'keys.manage'], bot_ids: ['bot-a'], ttl_seconds: 600 });
    const key = issued.body.key;
    assert.equal((await f.call('PATCH', '/v1/settings/models', { default_model: 'gpt-6.1-sol' }, key)).status, 403);
    assert.equal((await f.call('PATCH', '/v1/agents/bot-a/model', { default_model: 'gpt-6.1-sol' }, key)).status, 403);
    assert.equal((await f.call('GET', '/v1/models?agent_id=bot-b', undefined, key)).status, 403);
    assert.equal((await f.call('PATCH', '/v1/settings/models', { allowed_models: ['unverified'] })).status, 400);
    assert.equal((await f.call('PATCH', '/v1/settings/models', { default_model: 123 })).status, 400);
    assert.equal((await f.call('PATCH', '/v1/settings/models', { bot_defaults: {} })).status, 400);
    assert.equal((await f.call('PATCH', '/v1/settings/models', { verified_models: [{ id: 'model-b', evidence: '' }] })).status, 400);
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'unverified' }, key)).status, 400);
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'absent' }, key)).status, 400);
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: null }, key)).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.call('PATCH', '/v1/settings/models', approval)).status, 200);
    const selected = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'model-b' }, key);
    assert.equal(selected.status, 201); assert.equal(selected.body.model, 'model-b');
  } finally { await f.close(); }
});

test('session override wins over bot then service default and two threads keep their models after defaults change and restart', async () => {
  const f = await fixture();
  try {
    await f.call('PATCH', '/v1/settings/models', approval);
    const service = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' });
    assert.equal(service.body.model_source, 'service_default');
    await f.call('PATCH', '/v1/agents/bot-a/model', { default_model: 'model-b' });
    const bot = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' });
    const override = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'gpt-6.1-sol' });
    assert.equal(bot.body.model_source, 'bot_default'); assert.equal(bot.body.model, 'model-b');
    assert.equal(override.body.model_source, 'session'); assert.equal(override.body.model, 'gpt-6.1-sol');
    assert.notEqual(bot.body.thread_id, override.body.thread_id);
    await f.call('PATCH', '/v1/settings/models', { default_model: 'model-b' });
    assert.equal((await f.call('PATCH', '/v1/agents/sessions/' + bot.body.id, { model: 'gpt-6.1-sol' })).status, 400);
    await f.restart();
    assert.equal((await f.call('GET', '/v1/agents/sessions/' + service.body.id)).body.model, 'gpt-6.1-sol');
    assert.equal((await f.call('GET', '/v1/agents/bot-a/model')).body.default_model, 'model-b');
    for (const s of [bot.body, override.body]) {
      assert.equal((await f.call('POST', '/v1/agents/sessions/' + s.id + '/events', { events: [{ type: 'message', text: 'probe' }] })).status, 202);
      assert.equal(f.calls.findLast(c => c.method === 'thread/resume').params.model, s.model);
      assert.equal(f.calls.findLast(c => c.method === 'turn/start').params.model, s.model);
    }
  } finally { await f.close(); }
});

test('missing catalog rejects new sessions before side effects and existing pinned threads continue', async () => {
  const f = await fixture();
  try {
    const session = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' })).body;
    await unlink(f.catalogFile); const count = f.calls.length;
    const result = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' });
    assert.equal(result.status, 503); assert.equal(result.body.error.type, 'model_catalog_unavailable'); assert.equal(f.calls.length, count);
    assert.equal((await f.call('GET', '/v1/models')).status, 503);
    assert.equal((await f.call('GET', '/v1/agents/sessions/' + session.id)).body.model, 'gpt-6.1-sol');
    assert.equal((await f.call('POST', '/v1/agents/sessions/' + session.id + '/events', { events: [{ type: 'message', text: 'continue' }] })).status, 202);
    assert.equal(f.calls.at(-1).params.model, 'gpt-6.1-sol');
  } finally { await f.close(); }
});

test('native Harness model mismatch is refused and no inference turn is submitted', async () => {
  const f = await fixture({ returnedModel: 'unexpected-model' });
  try {
    const result = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'gpt-6.1-sol' });
    assert.equal(result.status, 502); assert.equal(result.body.error.type, 'model_mismatch');
    assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  } finally { await f.close(); }
});

test('empty service default persists and requires explicit model while existing sessions and bot overrides keep working', async () => {
  const f = await fixture({ defaultModel: null });
  try {
    assert.equal((await f.call('GET', '/v1/settings/models')).body.default_model, null);
    assert.equal((await f.call('GET', '/v1/models?agent_id=bot-a')).body.default_model, null);
    const rejected = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' });
    assert.equal(rejected.status, 400); assert.equal(rejected.body.error.type, 'model_required'); assert.equal(f.calls.length, 0);
    const session = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', model: 'gpt-6.1-sol' });
    assert.equal(session.status, 201);
    await f.call('PATCH', '/v1/settings/models', { default_model: 'gpt-6.1-sol' });
    assert.equal((await f.call('PATCH', '/v1/settings/models', { default_model: '' })).body.default_model, null);
    await f.restart();
    assert.equal((await f.call('GET', '/v1/settings/models')).body.default_model, null);
    assert.equal((await f.call('GET', '/v1/agents/sessions/' + session.body.id)).body.model, 'gpt-6.1-sol');
    await f.call('PATCH', '/v1/agents/bot-a/model', { default_model: 'gpt-6.1-sol' });
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' })).body.model_source, 'bot_default');
    await f.call('PATCH', '/v1/agents/bot-a/model', { default_model: null });
    assert.equal((await f.call('GET', '/v1/agents/bot-a/model')).body.effective_model, null);
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' })).body.error.type, 'model_required');
  } finally { await f.close(); }
});
