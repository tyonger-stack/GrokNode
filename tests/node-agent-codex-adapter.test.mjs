import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { createCodexAdapter } from '../tools/node-agent-api/codex.mjs';
import { rpcParams } from '../tools/node-agent-api/runtime/harness.mjs';

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
