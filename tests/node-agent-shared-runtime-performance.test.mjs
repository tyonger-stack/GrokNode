import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createSharedRuntime } from '../tools/node-agent-api/shared-runtime.mjs';

const require = createRequire(import.meta.url);

async function fixture(t) {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'shared-snapshot-')));
  const state = { id: 'fixture-container', started: 'start-1', running: true, roster: true, display: 2, assignment: 2, token: 'fixture-private-token', fileToken: 'fixture-private-token', ready: true, fail: false, prepareFail: false };
  const counts = { inspect: 0, exec: 0, ensure: 0, version: 0, preparation: 0, methods: [], containers: [] };
  const server = createServer(async (req, res) => {
    const method = req.url.split('/').at(-1); counts.methods.push(method);
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, 'Bearer fixture-gateway-token');
    if (state.fail) { res.writeHead(503); res.end('{}'); return; }
    if (method === 'ensureForeverBox') {
      counts.ensure++;
      await new Promise(resolve => setTimeout(resolve, 20));
      if (state.prepareFail) { res.writeHead(503); res.end('{}'); return; }
      state.ready = true;
    }
    const result = method === 'listAgents' ? (state.roster ? [{ id: 'bot-a' }] : []) : method === 'getForeverBoxStatus' ? { state: state.ready ? 'running' : 'stopped', vncUrl: `http://127.0.0.1:6081/vnc.html?path=${encodeURIComponent('websockify?token=' + state.display)}` } : {};
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const runtime = await createSharedRuntime({ stateRoot, spawnProcess: () => { throw new Error('Injected execute must not spawn Docker'); }, execute: async (_file, args) => {
    if (args[0] === 'inspect') { counts.inspect++; return { stdout: JSON.stringify([{ Id: state.id, Name: '/grok-node-local-vm', State: { Running: state.running, StartedAt: state.started } }]) }; }
    counts.exec++;
    counts.containers.push(args[1]);
    assert.ok([state.id, 'grok-node-local-vm'].includes(args[1]));
    if (args.includes('--version')) { counts.version++; return { stdout: 'codex-cli 0.160.0' }; }
    const index = args.indexOf('-e'); assert.ok(index > 0);
    const program = args[index + 1];
    if (program.includes('executor_private_home_ready')) { counts.preparation++; return { stdout: 'executor_private_home_ready' }; }
    const outputs = [], processStub = { argv: ['node', ...args.slice(index + 2).filter((arg, i) => !(i === 0 && arg === '--'))], exitCode: 0, exit(code) { throw new Error('probe exit ' + code); } };
    await runInNewContext(program, {
      require(name) {
        if (name === 'node:http' || name === 'http') {
          const real = require('node:http');
          return { ...real, request: (options, cb) => real.request(Number(options?.port) === 1340 ? { ...options, port: server.address().port } : options, cb) };
        }
        if (!['fs', 'node:fs'].includes(name)) return require(name);
        const files = { readFileSync(file) {
          if (file.endsWith('gateway.json')) return JSON.stringify({ token: 'fixture-gateway-token' });
          if (file.endsWith('.sand-window-assignments.json')) return JSON.stringify({ assignments: { 'bot-a': state.assignment }, tokens: { 'bot-a': state.token } });
          if (file.startsWith('/tmp/sand-window-tokens.d/')) return state.fileToken;
          throw new Error('Unexpected fixture file');
        } };
        return { ...files, constants: { O_RDONLY: 0, O_NONBLOCK: 0 }, openSync: file => ({ bytes: Buffer.from(files.readFileSync(file)), offset: 0 }), fstatSync: () => ({ isFile: () => true }), closeSync() {}, readSync(fd, buffer, offset, length) { const count = fd.bytes.copy(buffer, offset, fd.offset, fd.offset + length); fd.offset += count; return count; } };
      },
      process: processStub, URL, URLSearchParams, AbortSignal, Buffer,
      fetch: (url, options) => fetch(String(url).replace('http://127.0.0.1:1340', 'http://127.0.0.1:' + server.address().port), options),
      console: { log: value => outputs.push(String(value)), error() {} },
    });
    if (processStub.exitCode) throw new Error('Gateway probe failed');
    return { stdout: outputs.join('\n') };
  } });
  t.after(async () => { await runtime.close(); await new Promise(resolve => server.close(resolve)); await rm(stateRoot, { recursive: true, force: true }); });
  return { runtime, state, counts };
}

test('healthy snapshot executes existing HTTP methods once and never prepares', async t => {
  const { runtime, counts } = await fixture(t);
  const result = await runtime.desktop('bot-a', { type: 'desktop' }, 'view', { prepare: true });
  assert.equal(result.display, 2);
  assert.equal(result.containerStartedAt, 'start-1');
  assert.match(result.assignmentRevision, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('fixture-private-token'), false);
  assert.deepEqual(counts.methods, ['listAgents', 'getForeverBoxStatus']);
  assert.deepEqual(counts.containers, ['fixture-container']);
  assert.equal(counts.inspect, 1); assert.equal(counts.exec, 1); assert.equal(counts.ensure, 0);
});

test('fresh executor identity changes for token, assignment, replacement and same-ID restart', async t => {
  const { runtime, state } = await fixture(t);
  const first = await runtime.validateExecutor('bot-a');
  state.token = state.fileToken = 'rotated-fixture-token';
  const rotated = await runtime.validateExecutor('bot-a'); assert.notEqual(first.assignmentRevision, rotated.assignmentRevision);
  state.display = state.assignment = 3;
  const reassigned = await runtime.validateExecutor('bot-a'); assert.equal(reassigned.display, 3); assert.notEqual(rotated.assignmentRevision, reassigned.assignmentRevision);
  state.started = 'start-2'; assert.equal((await runtime.validateExecutor('bot-a')).containerStartedAt, 'start-2');
  state.id = 'fixture-replacement'; assert.equal((await runtime.validateExecutor('bot-a')).containerId, state.id);
  state.running = false; await assert.rejects(runtime.validateExecutor('bot-a'), { code: 'execution_unavailable' });
});

test('deleted bot, stale assignment/token and transport errors fail closed without prepare', async t => {
  const { runtime, state, counts } = await fixture(t);
  for (const [field, value] of [['roster', false], ['assignment', 7], ['fileToken', 'stale'], ['fail', true]]) {
    const previous = state[field]; state[field] = value;
    await assert.rejects(runtime.desktop('bot-a', { type: 'desktop' }, 'view', { prepare: true }));
    state[field] = previous;
  }
  assert.equal(counts.ensure, 0);
});

test('tokenless primary seat validates without a token file', async t => {
  const { runtime, state } = await fixture(t);
  state.token = undefined; state.fileToken = undefined;
  const result = await runtime.validateExecutor('bot-a');
  assert.equal(result.display, 2);
  assert.match(result.assignmentRevision, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('fixture-private-token'), false);
});

test('only explicit unavailable issue prepares, concurrent failures clear the single flight for retry', async t => {
  const { runtime, state, counts } = await fixture(t);
  state.ready = false;
  await assert.rejects(runtime.desktop('bot-a'), { code: 'desktop_unavailable' }); assert.equal(counts.ensure, 0);
  state.prepareFail = true;
  const issue = () => runtime.desktop('bot-a', { type: 'desktop' }, 'view', { prepare: true });
  const failed = await Promise.allSettled([issue(), issue(), issue()]);
  assert.equal(failed.every(result => result.status === 'rejected'), true); assert.equal(counts.ensure, 1);
  state.prepareFail = false;
  const ready = await Promise.all([issue(), issue(), issue()]);
  assert.equal(ready.every(result => result.display === 2), true); assert.equal(counts.ensure, 2);
});

test('executor preparation is shared and bound to assignment and container start', async t => {
  const { runtime, state, counts } = await fixture(t);
  await Promise.all([runtime.ensure('bot-a'), runtime.ensure('bot-a')]);
  assert.equal(counts.version, 1); assert.equal(counts.preparation, 1); assert.equal(counts.ensure, 0);
  await runtime.ensure('bot-a'); assert.equal(counts.preparation, 1);
  state.started = 'start-2'; await runtime.ensure('bot-a'); assert.equal(counts.preparation, 2);
  state.token = state.fileToken = 'new-token'; await runtime.ensure('bot-a'); assert.equal(counts.preparation, 3);
});
