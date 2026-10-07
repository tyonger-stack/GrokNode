import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { createCodexAdapter } from '../tools/node-agent-api/codex.mjs';
import { createHarness, rpcParams } from '../tools/node-agent-api/runtime/harness.mjs';
import { createStore } from '../tools/node-agent-api/store.mjs';
import { createInputHandler } from '../tools/node-agent-api/input.mjs';
import fsPromises from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const realTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const nextTick = () => new Promise(resolve => setImmediate(resolve));

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = realTimeout(() => reject(new Error('Fixture boundary did not complete')), 5000); })]); }
  finally { realClearTimeout(timer); }
}

// Fake harness speaking the real RPC seam: requests are validated by rpcParams,
// the same gate the production harness applies. Scripted replies stand in for
// the app-server child process, so no model ever runs in these tests.
const bots = [
  { object: 'node.agent', id: 'bot-a', name: 'Alpha', description: '', backend: 'codex_harness' },
  { object: 'node.agent', id: 'bot-b', name: 'Beta', description: '', backend: 'codex_harness' },
];

function createFakeHarness() {
  const events = new EventEmitter();
  const calls = [];
  const answers = [];
  let threadSeq = 0;
  let turnSeq = 0;
  return {
    calls,
    answers,
    redact: value => value,
    subscribe(listener) { events.on('event', listener); return () => events.off('event', listener); },
    async request(botId, method, params) {
      // Validate through the production seam before recording the call.
      const safe = rpcParams(method, params);
      calls.push({ botId, method, params: safe });
      if (method === 'thread/start') { threadSeq += 1; return { thread: { id: 'thr_fake_' + threadSeq } }; }
      if (method === 'turn/start') { turnSeq += 1; return { turn: { id: 'turn_fake_' + turnSeq, status: 'inProgress' } }; }
      if (method === 'thread/read') return { thread: { turns: [] } };
      return {};
    },
    async answer(botId, id, result) { answers.push({ botId, id, result }); return { answered: true }; },
    async pending() { return []; },
    async home() { return join(tmpdir(), 'codex-adapter-fake-home'); },
    async disconnect() {},
    async close() {},
    emit(botId, message) { events.emit('event', { botId, message }); },
  };
}

function createFakeRuntime() {
  const ensured = [];
  const shells = [];
  const projects = [];
  return {
    ensured,
    shells,
    projects,
    async ensure(botId) { ensured.push(botId); return { botId, running: true }; },
    async status(botId) { return { botId, exists: true, running: false }; },
    async descriptor() { return { version: 1, namespace: 'grok-node-lab-codex', environments: [] }; },
    async approvedShell(botId, command) { shells.push({ botId, command }); return { exit_code: 0, stdout: 'fake-ok', stderr: '', timed_out: false }; },
    async project(botId, action) {
      projects.push({ botId, action });
      if (action === 'diff') return { diff: '+fake' };
      return { imported: [] };
    },
  };
}

const roster = {
  agents: async () => bots,
  async requireAgent(id) {
    const row = bots.find(bot => bot.id === id);
    if (!row) throw Object.assign(new Error('missing'), { status: 404, code: 'not_found' });
    return row;
  },
};

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-adapter-')));
  const harness = createFakeHarness();
  const runtime = createFakeRuntime();
  const adapter = createCodexAdapter({
    runtime,
    harness,
    roster,
    namespace: 'grok-node-lab-codex',
    stateRoot: join(dir, 'lab'),
    registryFile: join(dir, 'registry.json'),
    artifactRoot: join(dir, 'artifacts'),
  });
  const service = await startNodeAgentApi({ adapter, stateDirectory: join(dir, 'api') });
  const key = (await readFile(service.keyFile, 'utf8')).trim();
  async function call(method, route, data) {
    const response = await fetch(service.origin + route, {
      method,
      headers: { authorization: 'Bearer ' + key, ...(data ? { 'content-type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  return { service, adapter, harness, runtime, call };
}

async function attach(f, botId = 'bot-a') {
  const created = await f.call('POST', '/v1/agents/sessions', { agent_id: botId });
  assert.equal(created.status, 201);
  return created.data;
}

function submit(f, sessionId, text, requestId) {
  return f.call('POST', '/v1/agents/sessions/' + sessionId + '/events', {
    events: [{ type: 'message', text }],
    idempotency_key: requestId,
  });
}

test('attaching a session starts exactly one harness thread with the approved-shell tool', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    assert.equal(session.context, 'codex_harness');
    assert.equal(session.task_status, 'idle');
    assert.match(session.thread_id, /^thr_fake_/);
    const starts = f.harness.calls.filter(call => call.method === 'thread/start');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].botId, 'bot-a');
    assert.equal(starts[0].params.dynamicTools[0].name, 'node_approved_shell');
    assert.deepEqual(f.runtime.ensured, ['bot-a']);
  } finally {
    await f.service.close();
  }
});

test('submitting text starts one turn and records its idempotency key on the running turn', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const accepted = await submit(f, session.id, 'probe the seam', 'nreq_adapter_input');
    assert.equal(accepted.status, 202);
    assert.equal(accepted.data.status, 'accepted');
    assert.equal(accepted.data.completed, false);
    assert.match(accepted.data.turn_id, /^turn_fake_/);
    const starts = f.harness.calls.filter(call => call.method === 'turn/start');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].params.threadId, session.thread_id);
    assert.equal(starts[0].params.input[0].text, 'probe the seam');
    const turns = await f.call('GET', '/v1/agents/sessions/' + session.id + '/turns');
    assert.equal(turns.data.data.length, 1);
    assert.equal(turns.data.data[0].status, 'running');
    assert.equal(turns.data.data[0].request_id, 'nreq_adapter_input');
  } finally {
    await f.service.close();
  }
});

test('replaying the same input key does not start a second harness turn', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const payload = { events: [{ type: 'message', text: 'only once' }], idempotency_key: 'nreq_adapter_dedupe' };
    const url = '/v1/agents/sessions/' + session.id + '/events';
    const replies = await Promise.all(Array.from({ length: 4 }, () => f.call('POST', url, payload)));
    assert.ok(replies.every(reply => reply.status === 202));
    assert.equal(replies.filter(reply => reply.data.replayed === true).length, 3);
    assert.equal(f.harness.calls.filter(call => call.method === 'turn/start').length, 1);
    const conflict = await f.call('POST', url, { ...payload, events: [{ type: 'message', text: 'different' }] });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error.type, 'idempotency_conflict');
  } finally {
    await f.service.close();
  }
});

test('turn completion stores native token usage and lets the next turn start', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const first = await submit(f, session.id, 'first job', 'nreq_adapter_first');
    const turnId = first.data.turn_id;
    f.harness.emit('bot-a', { method: 'thread/tokenUsage/updated', params: { threadId: session.thread_id, turnId, tokenUsage: { inputTokens: 3, outputTokens: 7 } } });
    f.harness.emit('bot-a', { method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: turnId, status: 'completed' } } });
    await f.adapter.flush();
    const turns = await f.call('GET', '/v1/agents/sessions/' + session.id + '/turns');
    const turn = turns.data.data.find(row => row.id === turnId);
    assert.equal(turn.status, 'completed');
    assert.ok(Number.isFinite(turn.ended_at));
    assert.equal(turn.usage.source, 'thread/tokenUsage/updated');
    assert.equal(turn.usage.native.outputTokens, 7);
    const second = await submit(f, session.id, 'second job', 'nreq_adapter_second');
    assert.equal(second.status, 202);
    assert.notEqual(second.data.turn_id, turnId);
  } finally {
    await f.service.close();
  }
});

test('cancel interrupts the running turn and is refused once the bot is idle', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const started = await submit(f, session.id, 'long job', 'nreq_adapter_cancel');
    const turnId = started.data.turn_id;
    const url = '/v1/agents/sessions/' + session.id + '/events';
    const cancelled = await f.call('POST', url, { events: [{ type: 'agent.session.input.cancel', turn_id: turnId }] });
    assert.equal(cancelled.status, 202);
    const interrupts = f.harness.calls.filter(call => call.method === 'turn/interrupt');
    assert.equal(interrupts.length, 1);
    assert.equal(interrupts[0].params.turnId, turnId);
    f.harness.emit('bot-a', { method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: turnId, status: 'interrupted' } } });
    await f.adapter.flush();
    const turns = await f.call('GET', '/v1/agents/sessions/' + session.id + '/turns');
    assert.equal(turns.data.data[0].status, 'cancelled');
    const idle = await f.call('POST', url, { events: [{ type: 'agent.session.input.cancel', turn_id: turnId }] });
    assert.equal(idle.status, 409);
    assert.equal(idle.data.error.type, 'turn_not_active');
  } finally {
    await f.service.close();
  }
});

test('a second turn is refused while the bot is still working', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    await submit(f, session.id, 'first', 'nreq_adapter_busy_1');
    const second = await submit(f, session.id, 'second', 'nreq_adapter_busy_2');
    assert.equal(second.status, 409);
    assert.equal(second.data.error.type, 'turn_active');
    assert.equal(f.harness.calls.filter(call => call.method === 'turn/start').length, 1);
  } finally {
    await f.service.close();
  }
});

test('harness disconnect marks the running turn unknown and appends a no-replay event', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    await submit(f, session.id, 'doomed job', 'nreq_adapter_doomed');
    f.harness.emit('bot-a', { method: 'lab/status', params: { status: 'unknown', replayed: false } });
    await f.adapter.flush();
    const current = await f.call('GET', '/v1/agents/sessions/' + session.id);
    assert.equal(current.data.task_status, 'unknown');
    assert.equal(current.data.active_turn_id, null);
    const events = await f.call('GET', '/v1/agents/sessions/' + session.id + '/events');
    const marker = events.data.data.find(event => event.type === 'node.session.turn.unknown');
    assert.ok(marker);
    assert.equal(marker.data.reason, 'harness_disconnected');
    assert.equal(marker.data.replayed, false);
  } finally {
    await f.service.close();
  }
});

test('cancellation terminates only processes recorded on the active turn in its own thread', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const old = await submit(f, session.id, 'earlier job', 'nreq_old_process');
    f.harness.emit('bot-a', { method: 'item/started', params: { threadId: session.thread_id, turnId: old.data.turn_id, item: { type: 'commandExecution', id: 'old_process', processId: '100', status: 'inProgress' } } });
    f.harness.emit('bot-a', { method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: old.data.turn_id, status: 'completed' } } });
    await f.adapter.flush();
    const active = await submit(f, session.id, 'current job', 'nreq_current_process');
    f.harness.emit('bot-a', { method: 'item/started', params: { threadId: session.thread_id, turnId: active.data.turn_id, item: { type: 'commandExecution', id: 'current_process', processId: '200', status: 'inProgress' } } });
    await f.adapter.flush();
    assert.equal((await f.call('POST', '/v1/agents/sessions/' + session.id + '/events', { events: [{ type: 'agent.session.input.cancel', turn_id: active.data.turn_id }] })).status, 202);
    const terminations = f.harness.calls.filter(call => call.method === 'thread/backgroundTerminals/terminate');
    assert.deepEqual(terminations.map(call => ({ bot: call.botId, ...call.params })), [{ bot: 'bot-a', threadId: session.thread_id, processId: '200' }]);
  } finally { await f.service.close(); }
});

test('accepting a shell approval runs the command once and answers the harness', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const started = await submit(f, session.id, 'needs approval', 'nreq_adapter_approve');
    f.harness.emit('bot-a', {
      method: 'item/tool/call',
      id: 'rpc_approve_1',
      params: { threadId: session.thread_id, turnId: started.data.turn_id, itemId: 'item_1', tool: 'node_approved_shell', arguments: { command: 'echo approved' } },
    });
    await f.adapter.flush();
    const pending = await f.call('GET', '/v1/agents/sessions/' + session.id + '/actions');
    assert.equal(pending.data.data.length, 1);
    assert.equal(pending.data.data[0].type, 'item/tool/call');
    const answered = await f.call('POST', '/v1/agents/sessions/' + session.id + '/actions/' + pending.data.data[0].id, { decision: 'accept' });
    assert.equal(answered.status, 200);
    assert.deepEqual(f.runtime.shells.map(shell => shell.command), ['echo approved']);
    assert.equal(f.harness.answers.length, 1);
    assert.equal(f.harness.answers[0].id, 'rpc_approve_1');
    assert.equal(f.harness.answers[0].result.success, true);
  } finally {
    await f.service.close();
  }
});

test('declining a shell approval answers the harness without executing anything', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const started = await submit(f, session.id, 'needs approval', 'nreq_adapter_decline');
    f.harness.emit('bot-a', {
      method: 'item/tool/call',
      id: 'rpc_approve_2',
      params: { threadId: session.thread_id, turnId: started.data.turn_id, itemId: 'item_2', tool: 'node_approved_shell', arguments: { command: 'echo never-runs' } },
    });
    await f.adapter.flush();
    const pending = await f.call('GET', '/v1/agents/sessions/' + session.id + '/actions');
    const answered = await f.call('POST', '/v1/agents/sessions/' + session.id + '/actions/' + pending.data.data[0].id, { decision: 'decline' });
    assert.equal(answered.status, 200);
    assert.equal(f.runtime.shells.length, 0);
    assert.equal(f.harness.answers.length, 1);
    assert.equal(f.harness.answers[0].result.success, false);
    assert.match(f.harness.answers[0].result.contentItems[0].text, /"executed":false/);
  } finally {
    await f.service.close();
  }
});

test('approving a tool the adapter does not implement is refused without side effects', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const started = await submit(f, session.id, 'risky tool', 'nreq_adapter_other_tool');
    f.harness.emit('bot-a', {
      method: 'item/tool/call',
      id: 'rpc_other_1',
      params: { threadId: session.thread_id, turnId: started.data.turn_id, itemId: 'item_9', tool: 'other_tool', arguments: {} },
    });
    await f.adapter.flush();
    const pending = await f.call('GET', '/v1/agents/sessions/' + session.id + '/actions');
    assert.equal(pending.data.data.length, 1);
    const rejected = await f.call('POST', '/v1/agents/sessions/' + session.id + '/actions/' + pending.data.data[0].id, { decision: 'accept' });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.error.type, 'tool_unavailable');
    assert.equal(f.harness.answers.length, 0);
    assert.equal(f.runtime.shells.length, 0);
  } finally {
    await f.service.close();
  }
});

test('project writes are refused while a turn runs and reads stay available after it', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const started = await submit(f, session.id, 'busy job', 'nreq_adapter_project');
    const busy = await f.call('POST', '/v1/agents/sessions/' + session.id + '/project/import', { files: [] });
    assert.equal(busy.status, 409);
    // The HTTP route rejects a busy session before the adapter is reached;
    // the adapter's own guard raises turn_active for direct adapter callers.
    assert.equal(busy.data.error.type, 'session_busy');
    assert.equal(f.runtime.projects.length, 0);
    f.harness.emit('bot-a', { method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: started.data.turn_id, status: 'completed' } } });
    await f.adapter.flush();
    const diff = await f.call('GET', '/v1/agents/sessions/' + session.id + '/project/diff');
    assert.equal(diff.status, 200);
    assert.equal(diff.data.diff, '+fake');
  } finally {
    await f.service.close();
  }
});

test('resume keeps the live harness thread instead of starting another', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const resumed = await f.call('POST', '/v1/agents/sessions/' + session.id + '/resume');
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.thread_id, session.thread_id);
    assert.equal(f.harness.calls.filter(call => call.method === 'thread/start').length, 1);
    assert.equal(f.harness.calls.filter(call => call.method === 'thread/resume').length, 0);
  } finally {
    await f.service.close();
  }
});

test('handoff unsubscribes the thread and reports it without replay', async () => {
  const f = await fixture();
  try {
    const session = await attach(f);
    const handoff = await f.call('POST', '/v1/agents/sessions/' + session.id + '/handoff');
    assert.equal(handoff.status, 200);
    assert.equal(handoff.data.thread_id, session.thread_id);
    assert.equal(handoff.data.bot_id, 'bot-a');
    assert.equal(handoff.data.target, 'codex_cli');
    assert.equal(handoff.data.replayed, false);
    const unsubscribes = f.harness.calls.filter(call => call.method === 'thread/unsubscribe');
    assert.equal(unsubscribes.length, 1);
    assert.equal(unsubscribes[0].params.threadId, session.thread_id);
  } finally {
    await f.service.close();
  }
});

async function validatedFixture({ legacy = false, realHarness = false } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-validated-')));
  const store = await createStore(join(dir, 'api'));
  const counts = { ensure: 0, validate: 0, status: 0, containerSave: 0, disconnect: 0 };
  const identity = { containerId: 'fixture-container', containerStartedAt: 'start-1', assignmentRevision: 'seat-1', display: 5 };
  const runtime = {
    ...createFakeRuntime(), shared: true,
    async ensure() { counts.ensure++; return { running: true, ...identity }; },
    async status() { counts.status++; return { running: true, ...identity }; },
    async validateExecutor() { counts.validate++; return { ...identity }; },
    async restore() { return { restored: true }; },
  };
  const wire = [], children = [];
  const authFile = join(dir, 'dummy-auth.json'), binary = join(dir, 'fake-codex');
  let harness;
  if (realHarness) {
    await writeFile(authFile, '{}', { mode: 0o600 });
    await writeFile(binary, '#!/bin/sh\nprintf "codex-cli 0.160.0\\n"\n', { mode: 0o700 });
    runtime.descriptor = async () => ({ environments: [{ ...identity, transport: 'stdio', program: '/fixture/docker', args: ['exec', identity.containerId, '--no-new-privs', 'exec-server', '--listen', 'stdio'] }] });
    harness = createHarness({ runtime, namespace: 'grok-node-lab-fixture', stateRoot: dir, authFile, binary,
      spawnProcess(_binary, _args, options) {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.options = options;
        child.stdin = new Writable({ write(chunk, _encoding, done) {
          const request = JSON.parse(chunk.toString()); wire.push(request);
          const result = request.method === 'thread/start' ? { thread: { id: 'thr_native' }, model: 'fixture-model' }
            : request.method === 'thread/resume' ? { model: 'fixture-model' }
              : request.method === 'thread/read' ? { thread: { turns: [] } }
                : request.method === 'turn/start' ? { turn: { id: 'turn_native', status: 'inProgress' } } : {};
          if (request.id != null) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'));
          done();
        } });
        child.kill = () => { child.killed = true; child.emit('exit', 0); };
        children.push(child);
        return child;
      },
    });
    harness.calls = [];
  } else harness = createFakeHarness();
  let connection = null, connectionSeq = 0;
  const originalRequest = harness.request;
  if (realHarness) {
    const disconnect = harness.disconnect;
    harness.disconnect = async botId => { counts.disconnect++; await disconnect(botId); };
  } else {
    harness.connectionIdentity = () => connection;
    harness.disconnect = async () => { counts.disconnect++; connection = null; };
  }
  harness.request = async (botId, method, params) => {
    if (realHarness) harness.calls.push({ botId, method, params });
    else connection ??= ++connectionSeq;
    if (method === 'turn/start') {
      const disk = JSON.parse(await readFile(join(dir, 'api/sessions.json'), 'utf8'));
      assert.ok(Object.values(disk[0].requests).some(request => request.status === 'pending'), 'pending input must be durable before turn/start');
    }
    const result = await originalRequest(botId, method, params);
    if (!realHarness && (method === 'thread/start' || method === 'thread/resume')) result.model = 'fixture-model';
    return result;
  };
  const update = store.update;
  store.update = async (id, changes) => {
    if (Object.hasOwn(changes, 'executor_container_id')) counts.containerSave++;
    return update.call(store, id, changes);
  };
  if (legacy) { delete runtime.validateExecutor; delete harness.connectionIdentity; }
  const adapter = createCodexAdapter({ runtime, harness, roster, namespace: 'grok-node-lab-fixture', stateRoot: dir });
  adapter.attachStore(store);
  const { session } = await store.create('bot-a', {}, { model: 'fixture-model' });
  const input = createInputHandler({ adapter, store });
  return {
    adapter, runtime, harness, store, session, identity, counts, wire, children, authFile,
    resetCounts() { for (const key of Object.keys(counts)) counts[key] = 0; harness.calls.length = 0; },
    submit: key => input(session, { events: [{ type: 'message', text: 'synthetic input' }], idempotency_key: key }),
    async close() { await adapter.close(); await store.flush(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('validated warm submit preserves the thread, model and durable dedupe without preparation or container saves', async t => {
  const f = await validatedFixture();
  try {
    await f.adapter.bindSession(f.session);
    const threadId = f.session.thread_id;
    f.resetCounts();
    const replies = await Promise.all(Array.from({ length: 4 }, () => f.submit('nreq_validated_warm')));
    assert.equal(replies.filter(reply => reply.replayed).length, 3);
    assert.equal(f.session.thread_id, threadId);
    assert.equal(f.session.turns[0].model, 'fixture-model');
    assert.equal(f.session.requests.nreq_validated_warm.status, 'accepted');
    assert.deepEqual(f.harness.calls.map(call => call.method), ['turn/start']);
    assert.equal(f.harness.calls[0].params.threadId, threadId);
    assert.equal(f.harness.calls[0].params.model, 'fixture-model');
    t.diagnostic(JSON.stringify({ scenario: 'warm', ...f.counts, turnStart: f.harness.calls.length }));
    assert.equal(f.counts.validate, 1);
    assert.equal(f.counts.ensure, 0);
    assert.equal(f.counts.status, 0);
    assert.equal(f.counts.containerSave, 0);
  } finally { await f.close(); }
});

for (const [field, value] of [['containerId', 'replacement'], ['containerStartedAt', 'start-2'], ['assignmentRevision', 'seat-2'], ['display', 6]]) {
  test(`validated submit recovers changed ${field} before sending exactly one new turn`, async t => {
    const f = await validatedFixture();
    try {
      await f.adapter.bindSession(f.session);
      const threadId = f.session.thread_id;
      f.resetCounts();
      f.identity[field] = value;
      const result = await f.submit('nreq_validated_changed');
      assert.equal(result.status, 'accepted');
      assert.equal(f.session.thread_id, threadId);
      assert.deepEqual(f.harness.calls.map(call => call.method), ['thread/resume', 'thread/read', 'turn/start']);
      assert.equal(f.harness.calls[0].params.model, 'fixture-model');
      assert.equal(f.harness.calls[2].params.threadId, threadId);
      assert.equal(f.counts.disconnect, 1);
      assert.equal(f.counts.ensure, 1);
      assert.equal(f.session.executor_container_id, f.identity.containerId);
      assert.equal(f.counts.containerSave, field === 'containerId' ? 1 : 0);
      t.diagnostic(JSON.stringify({ scenario: field, ...f.counts, turnStart: 1 }));
    } finally { await f.close(); }
  });
}

test('validated cold resume ensures once and restores history before sending the new input', async t => {
  const f = await validatedFixture();
  try {
    await f.store.update(f.session.id, { thread_id: 'thr_existing', executor_container_id: f.identity.containerId, turns: [], actions: [], task_status: 'idle' });
    f.resetCounts();
    const request = f.harness.request;
    f.harness.request = async (...args) => {
      const result = await request(...args);
      return args[1] === 'thread/read' ? { thread: { turns: [{ id: 'turn_old', status: 'completed', items: [{ id: 'item_old', type: 'agentMessage', text: 'saved' }] }] } } : result;
    };
    await f.submit('nreq_validated_cold');
    assert.deepEqual(f.harness.calls.map(call => call.method), ['thread/resume', 'thread/read', 'turn/start']);
    assert.equal(f.session.turns[0].items[0].text, 'saved');
    assert.equal(f.session.turns[1].request_id, 'nreq_validated_cold');
    t.diagnostic(JSON.stringify({ scenario: 'cold', ...f.counts, turnStart: 1 }));
    assert.equal(f.counts.ensure, 1);
    assert.equal(f.counts.containerSave, 0);
  } finally { await f.close(); }
});

test('fresh validation failure refuses a live thread and keeps unknown input non-replayable', async () => {
  const f = await validatedFixture();
  try {
    await f.adapter.bindSession(f.session);
    f.resetCounts();
    f.runtime.validateExecutor = async () => { throw Object.assign(new Error('Executor removed'), { code: 'execution_unavailable' }); };
    await assert.rejects(f.submit('nreq_validated_missing'), /Executor removed/);
    assert.equal(f.session.requests.nreq_validated_missing.status, 'unknown');
    const replay = await f.submit('nreq_validated_missing');
    assert.equal(replay.replayed, true);
    assert.equal(replay.status, 'unknown');
    assert.equal(f.harness.calls.length, 0);
    assert.equal(f.runtime.shells.length, 0);
    assert.equal(f.counts.ensure, 0);
  } finally { await f.close(); }
});

for (const failure of ['model mismatch', 'resume timeout']) {
  test(`changed assignment ${failure} blocks turn/start and does not replay input`, async () => {
    const f = await validatedFixture();
    try {
      await f.adapter.bindSession(f.session);
      f.identity.assignmentRevision = 'new-seat';
      f.resetCounts();
      const request = f.harness.request;
      f.harness.request = async (...args) => {
        const result = await request(...args);
        if (args[1] === 'thread/resume') {
          if (failure === 'resume timeout') throw new Error('RPC timeout; outcome unknown; no replay');
          return { model: 'wrong-model' };
        }
        return result;
      };
      await assert.rejects(f.submit('nreq_validated_failed'), failure === 'resume timeout' ? /RPC timeout/ : { code: 'model_mismatch' });
      assert.equal(f.harness.calls.some(call => call.method === 'turn/start'), false);
      assert.equal(f.session.requests.nreq_validated_failed.status, 'unknown');
      assert.equal((await f.submit('nreq_validated_failed')).replayed, true);
      assert.equal(f.harness.calls.filter(call => call.method === 'thread/resume').length, 1);
    } finally { await f.close(); }
  });
}

for (const invalidation of ['connection lost', 'handoff', 'restore']) {
  test(`validated preparation is invalid after ${invalidation}`, async () => {
    const f = await validatedFixture();
    try {
      await f.adapter.bindSession(f.session);
      if (invalidation === 'connection lost') await f.harness.disconnect('bot-a');
      if (invalidation === 'handoff') await f.adapter.handoff(f.session);
      if (invalidation === 'restore') await f.adapter.restore(f.session, { backup_id: 'fixture-backup' });
      f.resetCounts();
      await f.submit('nreq_validated_invalidated');
      assert.deepEqual(f.harness.calls.map(call => call.method), ['thread/resume', 'thread/read', 'turn/start']);
      assert.equal(f.counts.ensure, 1);
      assert.equal(f.session.turns.at(-1).request_id, 'nreq_validated_invalidated');
    } finally { await f.close(); }
  });
}

test('shared desktop forwards preparation policy and fresh assignment identity unchanged', async () => {
  const runtime = createFakeRuntime();
  runtime.shared = true;
  const environment = { containerStartedAt: 'start-1', assignmentRevision: 'seat-1', display: 5 };
  const options = { prepare: true }, target = { type: 'desktop' };
  runtime.desktop = async (...args) => { assert.deepEqual(args, ['bot-a', target, 'view', options]); return environment; };
  const adapter = createCodexAdapter({ runtime, harness: createFakeHarness(), roster });
  assert.equal(await adapter.desktop('bot-a', target, 'view', options), environment);
});

test('validated disconnect marks running work unknown and never resubmits its input', async () => {
  const f = await validatedFixture();
  try {
    await f.adapter.bindSession(f.session);
    await f.submit('nreq_validated_disconnect');
    await f.harness.disconnect('bot-a');
    f.harness.emit('bot-a', { method: 'lab/status', params: { status: 'unknown', replayed: false } });
    await f.adapter.flush();
    assert.equal(f.session.task_status, 'unknown');
    assert.equal(f.session.turns[0].status, 'unknown');
    assert.equal(f.session.events.at(-1).data.replayed, false);
    const calls = f.harness.calls.length;
    assert.equal((await f.submit('nreq_validated_disconnect')).replayed, true);
    assert.equal(f.harness.calls.length, calls);
  } finally { await f.close(); }
});

test('legacy shared runtime without executor validation retains ensure before live-thread reuse', async () => {
  const f = await validatedFixture({ legacy: true });
  try {
    await f.adapter.bindSession(f.session);
    f.resetCounts();
    assert.equal((await f.submit('nreq_legacy_shared')).status, 'accepted');
    assert.equal(f.counts.ensure, 1);
    assert.deepEqual(f.harness.calls.map(call => call.method), ['turn/start']);
  } finally { await f.close(); }
});

test('cold recovery prepares an explicitly unavailable bot desktop before resuming its thread', async t => {
  const f = await validatedFixture();
  try {
    await f.store.update(f.session.id, { thread_id: 'thr_existing', executor_container_id: f.identity.containerId, turns: [], actions: [], task_status: 'idle' });
    const validate = f.runtime.validateExecutor;
    let attempts = 0;
    f.runtime.validateExecutor = async botId => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('Bot desktop is not running'), { code: 'desktop_unavailable' });
      return validate(botId);
    };
    f.resetCounts();
    assert.equal((await f.submit('nreq_cold_desktop_unavailable')).status, 'accepted');
    assert.deepEqual(f.harness.calls.map(call => call.method), ['thread/resume', 'thread/read', 'turn/start']);
    assert.equal(f.session.turns.at(-1).request_id, 'nreq_cold_desktop_unavailable');
    assert.equal(f.session.executor_container_id, f.identity.containerId);
    t.diagnostic(JSON.stringify({ scenario: 'cold-desktop-unavailable', attempts, ...f.counts }));
    assert.equal(attempts, 2);
    assert.equal(f.counts.ensure, 1);
  } finally { await f.close(); }
});

for (const [label, code] of [['stale executor token', 401], ['ownership denial', 403], ['transport fault', 502]]) {
  test(`cold recovery fails closed on ${label} without preparing`, async () => {
    const f = await validatedFixture();
    try {
      await f.store.update(f.session.id, { thread_id: 'thr_existing', executor_container_id: f.identity.containerId, turns: [], actions: [], task_status: 'idle' });
      f.runtime.validateExecutor = async () => { throw Object.assign(new Error('Executor identity refused'), { code: code === 403 ? 'permission_denied' : 'execution_failed', status: code }); };
      f.resetCounts();
      await assert.rejects(f.submit('nreq_cold_refused'), /Executor identity refused/);
      assert.equal(f.session.requests.nreq_cold_refused.status, 'unknown');
      assert.equal(f.harness.calls.length, 0);
      assert.equal(f.runtime.shells.length, 0);
      assert.equal(f.counts.ensure, 0);
      assert.equal((await f.submit('nreq_cold_refused')).replayed, true);
      assert.equal(f.harness.calls.length, 0);
    } finally { await f.close(); }
  });
}

test('a prepared generation going unavailable fails closed instead of preparing', async () => {
  const f = await validatedFixture();
  try {
    await f.adapter.bindSession(f.session);
    f.runtime.validateExecutor = async () => { throw Object.assign(new Error('Bot desktop is not running'), { code: 'desktop_unavailable' }); };
    f.resetCounts();
    await assert.rejects(f.submit('nreq_prepared_desktop_unavailable'), /Bot desktop is not running/);
    assert.equal(f.counts.ensure, 0);
    assert.equal(f.harness.calls.length, 0);
    assert.equal(f.runtime.shells.length, 0);
    assert.equal(f.session.requests.nreq_prepared_desktop_unavailable.status, 'unknown');
  } finally { await f.close(); }
});

test('real Harness uses explicit fixture auth, prepares once, reuses warm connection and recovers replacement', async t => {
  const f = await validatedFixture({ realHarness: true });
  try {
    await f.adapter.bindSession(f.session);
    assert.equal(f.counts.ensure, 1);
    assert.equal(f.children.length, 1);
    const home = f.children[0].options.cwd;
    assert.equal(await readlink(join(home, 'auth.json')), f.authFile);
    assert.match(await readFile(join(home, 'environments.toml'), 'utf8'), /include_local = false/);
    const initialConnection = f.harness.connectionIdentity('bot-a');
    f.resetCounts();
    assert.equal((await f.submit('nreq_real_warm')).status, 'accepted');
    assert.equal(f.counts.ensure, 0);
    assert.equal(f.counts.status, 0);
    assert.equal(f.counts.validate, 1);
    assert.equal(f.counts.containerSave, 0);
    assert.equal(f.children.length, 1);
    assert.equal(f.harness.connectionIdentity('bot-a'), initialConnection);
    assert.equal(f.wire.filter(call => call.method === 'turn/start').length, 1);
    f.children[0].stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: f.session.thread_id, turn: { id: 'turn_native', status: 'completed' } } }) + '\n');
    await f.adapter.flush();
    f.identity.containerId = 'native-replacement';
    f.resetCounts();
    assert.equal((await f.submit('nreq_real_replacement')).status, 'accepted');
    assert.equal(f.counts.ensure, 1);
    assert.equal(f.counts.disconnect, 1);
    assert.equal(f.children.length, 2);
    assert.equal(f.children[0].killed, true);
    assert.notEqual(f.harness.connectionIdentity('bot-a'), initialConnection);
    assert.match(await readFile(join(home, 'environments.toml'), 'utf8'), /native-replacement/);
    assert.deepEqual(f.harness.calls.map(call => call.method), ['thread/resume', 'thread/read', 'turn/start']);
    assert.equal(f.wire.filter(call => call.method === 'turn/start').length, 2);
    t.diagnostic(JSON.stringify({ scenario: 'real-harness-replacement', ...f.counts, spawned: f.children.length, turnStart: 2 }));
  } finally { await f.close(); }
  assert.ok(f.children.every(child => child.killed));
});

async function batchFixture(t, { http = false, botCount = 1 } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-batch-')));
  const file = join(dir, 'api/sessions.json');
  const harness = createFakeHarness(), runtime = createFakeRuntime();
  const adapter = createCodexAdapter({ runtime, harness, roster, namespace: 'grok-node-lab-fixture', stateRoot: dir });
  let store, service, key;
  if (http) {
    const attachStore = adapter.attachStore;
    adapter.attachStore = value => { store = value; attachStore(value); };
    service = await startNodeAgentApi({ adapter, stateDirectory: join(dir, 'api') });
    key = (await readFile(service.keyFile, 'utf8')).trim();
  } else {
    store = await createStore(join(dir, 'api'));
    adapter.attachStore(store);
  }
  const sessions = [];
  for (const bot of bots.slice(0, botCount)) {
    const { session } = await store.create(bot.id, {}, { reuse: false });
    await adapter.bindSession(session);
    await store.update(session.id, { turns: [{ object: 'node.turn', id: 'turn_' + bot.id, status: 'running', items: [{ id: 'item_' + bot.id, type: 'agentMessage', text: '' }], usage: null }], active_turn_id: 'turn_' + bot.id, task_status: 'running' });
    sessions.push(session);
  }
  const commits = [], published = [];
  let renameFault;
  const rename = fsPromises.rename;
  t.mock.method(fsPromises, 'rename', async (from, to) => {
    if (to === file && renameFault) throw renameFault;
    const result = await rename(from, to);
    if (to === file) commits.push(JSON.parse(readFileSync(file, 'utf8')));
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const unsubscribe = store.subscribeAll(event => {
    const disk = JSON.parse(readFileSync(file, 'utf8')).find(session => session.id === event.session_id);
    assert.deepEqual(disk.events.find(row => row.id === event.id), event, 'the full envelope must be durable before publication');
    published.push(event);
  });
  const delta = (index, session = sessions[0], method = 'item/agentMessage/delta') => ({ method, params: { threadId: session.thread_id, turnId: session.active_turn_id, itemId: 'item_' + session.agent_id, delta: '片段-' + index } });
  const emit = (message, session = sessions[0]) => harness.emit(session.agent_id, message);
  const notifications = session => session.events.filter(event => event.type === 'node.harness.event');
  const controllers = new Set();
  return {
    dir, file, adapter, harness, runtime, store, service, sessions, commits, published, delta, emit, notifications,
    failRename(error) { renameFault = error; },
    disk: () => JSON.parse(readFileSync(file, 'utf8')),
    async call(route) {
      const response = await fetch(service.origin + route, { headers: { authorization: 'Bearer ' + key } });
      assert.equal(response.status, 200);
      return response.json();
    },
    async stream(route, after) {
      const controller = new AbortController(); controllers.add(controller);
      const response = await fetch(service.origin + route, { signal: controller.signal, headers: { authorization: 'Bearer ' + key, accept: 'text/event-stream', ...(after ? { 'Last-Event-ID': after } : {}) } });
      assert.equal(response.status, 200);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = '';
      return {
        async until(count) {
          while ((text.match(/\ndata: /g) ?? []).length < count) {
            const part = await bounded(reader.read());
            if (part.done) throw new Error('SSE ended before its committed events');
            text += decoder.decode(part.value, { stream: true });
          }
          return text.split('\n\n').filter(frame => frame.includes('\ndata: ')).map(frame => JSON.parse(frame.split('\ndata: ')[1]));
        },
        close() { controller.abort(); controllers.delete(controller); },
      };
    },
    async close({ fault = false } = {}) {
      for (const controller of controllers) controller.abort();
      unsubscribe();
      try {
        await (service ? service.close() : adapter.close());
        await store.flush();
      } catch (error) { if (!fault) throw error; }
      finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}

test('batch: a low-frequency ordinary delta commits at 25ms, never at 24ms', async t => {
  const f = await batchFixture(t);
  try {
    let attempts = 0; f.store.setWriteGuard(async () => { attempts++; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const message = f.delta(0); f.emit(message);
    await nextTick();
    assert.equal(attempts, 0);
    t.mock.timers.tick(24); await nextTick();
    assert.equal(attempts, 0);
    assert.equal(f.notifications(f.sessions[0]).length, 0);
    t.mock.timers.tick(1); await nextTick(); await f.store.flush();
    assert.equal(attempts, 1);
    assert.equal(f.commits.length, 1);
    assert.deepEqual(f.notifications(f.sessions[0]).map(event => event.data), [message]);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test('batch: the 64th delta flushes immediately and the 65th stays buffered until its own deadline', async t => {
  const f = await batchFixture(t);
  try {
    let attempts = 0; f.store.setWriteGuard(async () => { attempts++; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const expected = Array.from({ length: 65 }, (_, index) => f.delta(index));
    for (const message of expected.slice(0, 63)) f.emit(message);
    await nextTick(); assert.equal(attempts, 0);
    f.emit(expected[63]); await nextTick(); await f.store.flush();
    assert.equal(f.commits.length, 1);
    assert.deepEqual(f.notifications(f.sessions[0]).map(event => event.data), expected.slice(0, 64));
    f.emit(expected[64]); await nextTick(); assert.equal(attempts, 1);
    t.mock.timers.tick(25); await nextTick(); await f.store.flush();
    assert.equal(f.commits.length, 2);
    assert.deepEqual(f.notifications(f.sessions[0]).map(event => event.data), expected);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test('batch: a 256-delta cross-bot burst reduces actual disk commits by at least 80% without losing envelopes or cursor order', async t => {
  const f = await batchFixture(t, { botCount: 2 });
  try {
    const expected = [];
    for (let index = 0; index < 256; index++) {
      const session = f.sessions[index % 2], message = f.delta(index, session);
      expected.push({ session_id: session.id, ...message }); f.emit(message, session);
    }
    await f.adapter.flush();
    assert.equal(f.published.length, expected.length);
    assert.deepEqual(f.published.map(event => ({ session_id: event.session_id, ...event.data })), expected);
    for (const session of f.sessions) {
      const events = f.notifications(session);
      assert.deepEqual(events.map(event => event.data), expected.filter(row => row.session_id === session.id).map(({ session_id, ...message }) => message));
      assert.equal(new Set(events.map(event => event.id)).size, events.length);
      assert.equal(f.disk().find(row => row.id === session.id).events.length, session.events.length);
    }
    const reduction = 1 - f.commits.length / expected.length;
    t.diagnostic(JSON.stringify({ scenario: 'delta-burst', deltas: expected.length, diskCommits: f.commits.length, reduction, published: f.published.length }));
    assert.ok(reduction >= 0.8, 'a burst must remove at least 80% of actual atomic disk writes');
  } finally { await f.close(); }
});

for (const boundary of ['terminal', 'approval', 'item completed', 'disconnect']) {
  test(`batch: ${boundary} flushes preceding deltas without waiting for 25ms and commits its state with its event`, async t => {
    const f = await batchFixture(t);
    try {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const session = f.sessions[0], first = f.delta(0), second = f.delta(1);
      f.emit(first); f.emit(second);
      const critical = boundary === 'terminal' ? { method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: session.active_turn_id, status: 'completed' } } }
        : boundary === 'approval' ? { id: 'rpc_batch_approval', method: 'item/tool/call', params: { threadId: session.thread_id, turnId: session.active_turn_id, itemId: 'tool_item', tool: 'node_approved_shell', arguments: { command: 'synthetic-only' } } }
          : boundary === 'item completed' ? { method: 'item/completed', params: { threadId: session.thread_id, turnId: session.active_turn_id, item: { id: 'item_bot-a', type: 'agentMessage', text: '片段-0片段-1' } } }
            : { method: 'lab/status', params: { status: 'unknown', replayed: false } };
      let observed;
      const delivery = new Promise(resolve => { const off = f.store.subscribe(session.id, event => {
        if (event.data?.method === critical.method || (boundary === 'disconnect' && event.type === 'node.session.turn.unknown')) {
          observed = f.disk()[0]; off(); resolve(event);
        }
      }); });
      f.emit(critical); await bounded(delivery);
      assert.deepEqual(f.published.slice(0, 2).map(event => event.data), [first, second]);
      if (boundary === 'terminal') { assert.equal(observed.task_status, 'completed'); assert.equal(observed.active_turn_id, null); }
      if (boundary === 'approval') assert.equal(observed.actions[0].status, 'pending');
      if (boundary === 'item completed') assert.equal(observed.turns[0].items[0].text, '片段-0片段-1');
      if (boundary === 'disconnect') { assert.equal(observed.turns[0].status, 'unknown'); assert.equal(f.published.at(-1).data.replayed, false); }
      t.diagnostic(JSON.stringify({ scenario: boundary, diskCommits: f.commits.length, published: f.published.length }));
      assert.equal(f.commits.length, 2, 'one delta batch and one atomic critical notification');
    } finally { t.mock.timers.reset(); await f.close(); }
  });
}

for (const boundary of ['items', 'actions', 'cancel', 'flush', 'close']) {
  test(`batch: adapter ${boundary} drains already-received deltas before returning or issuing a side effect`, async t => {
    const f = await batchFixture(t);
    try {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const session = f.sessions[0], message = f.delta(0);
      const request = f.harness.request;
      f.harness.request = async (...args) => {
        if (args[1] === 'turn/interrupt') assert.deepEqual(f.notifications(session).map(event => event.data), [message]);
        return request(...args);
      };
      const close = f.harness.close;
      f.harness.close = async () => { assert.deepEqual(f.disk()[0].events.filter(event => event.type === 'node.harness.event').map(event => event.data), [message]); await close(); };
      f.emit(message);
      if (boundary === 'items') await bounded(f.adapter.itemsSession(session));
      if (boundary === 'actions') await bounded(f.adapter.actions(session));
      if (boundary === 'cancel') await bounded(f.adapter.cancel(session, session.active_turn_id));
      if (boundary === 'flush') await bounded(f.adapter.flush());
      if (boundary === 'close') await bounded(f.adapter.close());
      assert.deepEqual(f.notifications(session).map(event => event.data), [message]);
      assert.equal(f.published.length, 1);
    } finally { t.mock.timers.reset(); await f.close(); }
  });
}

test('batch: input drains preceding deltas before rejecting an already-running turn and never replays it', async t => {
  const f = await batchFixture(t);
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const session = f.sessions[0], message = f.delta(0);
    f.emit(message);
    await assert.rejects(bounded(f.adapter.inputSession(session, 'synthetic next input', 'nreq_batch_input')), { code: 'turn_active' });
    assert.deepEqual(f.notifications(session).map(event => event.data), [message]);
    assert.equal(f.harness.calls.filter(call => call.method === 'turn/start').length, 0);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test('batch: a rename fault publishes no pending delta and poisons subsequent adapter operations without replay', async t => {
  const f = await batchFixture(t);
  try {
    const before = f.store.snapshot(), onDisk = readFileSync(f.file, 'utf8');
    f.failRename(new Error('Synthetic atomic rename fault'));
    f.emit(f.delta(0)); f.emit(f.delta(1));
    await assert.rejects(f.adapter.flush(), /Synthetic atomic rename fault/);
    assert.equal(f.store.snapshot(), before);
    assert.equal(readFileSync(f.file, 'utf8'), onDisk);
    assert.equal(f.published.length, 0);
    assert.equal(f.commits.length, 0);
    f.failRename(null);
    await assert.rejects(f.adapter.itemsSession(f.sessions[0]), /Synthetic atomic rename fault/);
    assert.equal(f.harness.calls.some(call => call.method === 'turn/start'), false);
  } finally { f.failRename(null); await f.close({ fault: true }); }
});

test('batch: answering an approval drains prior deltas and keeps the responding marker durable before exactly one tool execution', async t => {
  const f = await batchFixture(t);
  try {
    const session = f.sessions[0];
    f.emit({ id: 'rpc_batch_tool', method: 'item/tool/call', params: { threadId: session.thread_id, turnId: session.active_turn_id, itemId: 'tool_batch', tool: 'node_approved_shell', arguments: { command: 'synthetic-only' } } });
    await f.adapter.flush();
    const action = session.actions[0];
    f.commits.length = 0; f.published.length = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const message = f.delta(0); f.emit(message);
    const shell = f.runtime.approvedShell;
    f.runtime.approvedShell = async (...args) => {
      const disk = f.disk()[0];
      assert.equal(disk.actions[0].status, 'responding');
      assert.deepEqual(disk.events.filter(event => event.data?.method === message.method).map(event => event.data), [message]);
      return shell(...args);
    };
    const answers = await Promise.allSettled([f.adapter.answer(session, action.id, 'accept'), f.adapter.answer(session, action.id, 'accept')]);
    assert.equal(answers.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(f.runtime.shells.length, 1);
    assert.equal(f.harness.answers.length, 1);
    assert.equal(session.actions[0].status, 'accept');
    const responding = f.commits.find(snapshot => snapshot[0].actions[0].status === 'responding');
    assert.ok(responding);
    assert.equal(responding[0].events.some(event => event.type === 'node.action.resolved'), false);
    assert.equal(f.published.at(-1).type, 'node.action.resolved');
  } finally { t.mock.timers.reset(); await f.close(); }
});

test('batch: ordinary reasoning and command-output deltas retain their native envelopes in one commit', async t => {
  const f = await batchFixture(t);
  try {
    const methods = ['item/agentMessage/delta', 'item/reasoning/textDelta', 'item/commandExecution/outputDelta'];
    const messages = methods.map((method, index) => f.delta(index, f.sessions[0], method));
    for (const message of messages) f.emit(message);
    await f.adapter.flush();
    assert.deepEqual(f.notifications(f.sessions[0]).map(event => event.data), messages);
    assert.equal(f.commits.length, 1);
  } finally { await f.close(); }
});

test('batch: JSON history and initial SSE show committed events only, then live flush and cursor reconnect deliver every delta once', async t => {
  const f = await batchFixture(t, { http: true });
  try {
    const session = f.sessions[0], route = '/v1/agents/sessions/' + session.id + '/events';
    const committed = session.events.slice(), first = f.delta(0), second = f.delta(1);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    f.emit(first); f.emit(second);
    const history = await bounded(f.call(route));
    assert.deepEqual(history.data, committed);
    assert.equal(f.published.length, 0);
    const stream = await bounded(f.stream(route));
    assert.deepEqual(await stream.until(committed.length), committed);
    assert.equal(f.commits.length, 0);
    await f.adapter.flush();
    const all = await stream.until(committed.length + 2);
    assert.deepEqual(all.slice(committed.length).map(event => event.data), [first, second]);
    assert.equal(new Set(all.map(event => event.id)).size, all.length);
    stream.close();
    const cursor = all.at(-2).id;
    const resumed = await bounded(f.stream(route, cursor));
    assert.deepEqual(await resumed.until(1), [all.at(-1)]);
    resumed.close();
    assert.deepEqual((await f.call(route)).data, all);
  } finally { t.mock.timers.reset(); await f.close(); }
});
