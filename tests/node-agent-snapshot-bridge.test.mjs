import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedRuntime } from '../tools/node-agent-api/shared-runtime.mjs';
import { createSnapshotBridge, snapshotBridgeProgram } from '../tools/node-agent-api/snapshot-bridge.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'snapshot-bridge-')));
  const state = { id: 'container-one', started: 'start-one', running: true, display: 2, token: 'private-assignment', gatewayToken: 'private-gateway', ready: true, roster: true, inspectFail: false, statusHook: null };
  const children = [], exits = [], calls = [], counts = { inspect: 0 };
  const save = async () => {
    await writeFile(join(root, 'gateway.json'), JSON.stringify({ token: state.gatewayToken }));
    await writeFile(join(root, 'assignments.json'), JSON.stringify({ assignments: { bot: state.display }, tokens: { bot: state.token } }));
    await writeFile(join(root, String(state.display)), state.token);
  };
  await save();
  const server = createServer(async (req, res) => {
    const method = req.url.split('/').at(-1); calls.push(method);
    assert.equal(req.headers.authorization, 'Bearer ' + state.gatewayToken);
    for await (const _chunk of req) { /* consume the read-only request */ }
    if (method === 'getForeverBoxStatus') await state.statusHook?.();
    const data = method === 'listAgents' ? (state.roster ? [{ id: 'bot' }] : []) : { state: state.ready ? 'running' : 'stopped', vncUrl: 'http://127.0.0.1:6081/vnc.html?path=' + encodeURIComponent('websockify?token=' + state.display) };
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transform = program => program.replaceAll('/home/box/sand-data/gateway.json', join(root, 'gateway.json')).replaceAll('/home/box/.sand-window-assignments.json', join(root, 'assignments.json')).replaceAll('/tmp/sand-window-tokens.d/', root + '/').replace('port:1340', 'port:' + server.address().port);
  const spawnSnapshot = (_file, args, options) => {
    assert.deepEqual(args.slice(0, 3), ['exec', '-i', state.id]);
    for (const flag of ['--reuid=box', '--regid=box', '--init-groups', '--bounding-set=-all', '--no-new-privs']) assert.ok(args.includes(flag));
    assert.equal(options.stdio[2], 'ignore');
    const program = args[args.indexOf('-e') + 1];
    const child = spawn(process.execPath, ['-e', transform(program)], options);
    children.push(child); exits.push(once(child, 'close'));
    return child;
  };
  const runtime = await createSharedRuntime({ stateRoot: join(root, 'runtime'), spawnSnapshot, execute: async (_file, args) => {
    assert.equal(args[0], 'inspect'); counts.inspect++;
    if (state.inspectFail) throw new Error('inspect failed');
    return { stdout: JSON.stringify([{ Id: state.id, Name: '/grok-node-local-vm', State: { Running: state.running, StartedAt: state.started } }]) };
  } });
  t.after(async () => { await runtime.close(); await Promise.all(exits); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { runtime, state, root, save, children, exits, calls, counts, transform };
}

test('persistent lowpriv bridge rereads assignments, token hash and authenticated gateway on every call', async t => {
  const f = await fixture(t);
  const first = await f.runtime.desktop('bot');
  const same = await f.runtime.validateDesktop('bot', first);
  assert.equal(same.assignmentRevision, first.assignmentRevision);
  f.state.token = 'rotated-assignment'; f.state.gatewayToken = 'rotated-gateway'; await f.save();
  await assert.rejects(f.runtime.validateDesktop('bot', first), { code: 'desktop_changed' });
  const fresh = await f.runtime.desktop('bot');
  assert.notEqual(fresh.assignmentRevision, first.assignmentRevision);
  assert.equal(JSON.stringify(fresh).includes('rotated-'), false);
  assert.equal(f.children.length, 1);
  assert.equal(f.counts.inspect, 8);
  assert.deepEqual(f.calls, Array.from({ length: 4 }, () => ['listAgents', 'getForeverBoxStatus']).flat());
  f.state.ready = false;
  await assert.rejects(f.runtime.desktop('bot'), { code: 'desktop_unavailable' });
  f.state.roster = false;
  await assert.rejects(f.runtime.desktop('bot'), { code: 'not_found' });
  assert.equal(f.calls.includes('ensureForeverBox'), false);
});

test('fresh inspect replaces the bridge for same-ID restart and container replacement', async t => {
  const f = await fixture(t), first = await f.runtime.desktop('bot');
  f.state.started = 'start-two';
  await assert.rejects(f.runtime.validateDesktop('bot', first), { code: 'desktop_changed' });
  await f.exits[0];
  assert.equal(f.children[0].killed, true);
  f.state.id = 'container-two';
  const fresh = await f.runtime.desktop('bot');
  assert.equal(fresh.containerId, 'container-two');
  assert.equal(f.children.length, 3);
});

test('post-snapshot inspect rejects a restart during the gateway response', async t => {
  const f = await fixture(t);
  f.state.statusHook = () => { f.state.started = 'changed-in-flight'; };
  await assert.rejects(f.runtime.desktop('bot'), { code: 'desktop_changed' });
  await f.exits[0];
  assert.equal(f.children[0].killed, true);
});

test('stopped and uninspectable containers invalidate live bridge and never return old snapshots', async t => {
  const f = await fixture(t);
  await f.runtime.desktop('bot'); f.state.running = false;
  await assert.rejects(f.runtime.desktop('bot'), { code: 'execution_unavailable' });
  await f.exits[0];
  f.state.running = true; await f.runtime.desktop('bot'); f.state.inspectFail = true;
  await assert.rejects(f.runtime.desktop('bot'), { code: 'execution_unavailable' });
  await f.exits[1];
  assert.equal(f.children.length, 2);
});

test('crash rejects an in-flight request and a later call obtains a fresh bridge', async t => {
  const f = await fixture(t);
  await f.runtime.desktop('bot');
  let signal;
  const entered = new Promise(resolve => { signal = resolve; });
  f.state.statusHook = () => { signal(); f.children[0].kill('SIGKILL'); };
  const pending = f.runtime.desktop('bot');
  const rejection = assert.rejects(pending, { code: 'upstream_unavailable' });
  await entered; await rejection; await f.exits[0];
  f.state.statusHook = null;
  assert.equal((await f.runtime.desktop('bot')).display, 2);
  assert.equal(f.children.length, 2);
});

test('stale token and oversized assignment files fail closed without exposing file contents', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, '2'), 'wrong-token');
  await assert.rejects(f.runtime.desktop('bot'), { code: 'upstream_unavailable' });
  await f.save();
  await writeFile(join(f.root, 'assignments.json'), ' '.repeat(1048577));
  await assert.rejects(f.runtime.desktop('bot'), { code: 'upstream_unavailable' });
});

test('runtime.close kills the persistent process and rejects subsequent validation', async t => {
  const f = await fixture(t);
  await f.runtime.desktop('bot');
  await f.runtime.close(); await f.exits[0];
  assert.equal(f.children[0].killed, true);
  await assert.rejects(f.runtime.desktop('bot'), { code: 'execution_unavailable' });
});

test('concurrent snapshots correlate distinct responses on a single process', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.runtime.desktop('bot')));
  assert.equal(results.every(result => result.display === 2), true);
  assert.equal(f.children.length, 1);
  assert.equal(f.calls.filter(method => method === 'getForeverBoxStatus').length, 8);
  assert.equal(f.counts.inspect, 16);
});

function transport(t, program, options = {}) {
  const children = [], exits = [];
  const bridge = createSnapshotBridge({ docker: process.execPath, spawnSnapshot: (file, args, spawnOptions) => {
    const child = spawn(file, args, spawnOptions); children.push(child); exits.push(once(child, 'close')); return child;
  }, argsFor: () => ['-e', program], ...options });
  t.after(async () => { bridge.close(); await Promise.all(exits); });
  return { bridge, children, exits, row: { Id: 'id', State: { Running: true, StartedAt: 'start' } } };
}

test('request capacity rejects excess work and timeout kills the hung bridge', async t => {
  const f = transport(t, 'process.stdin.resume()', { maxPending: 1, timeoutMs: 100 });
  const pending = f.bridge.read('bot', f.row);
  const rejection = assert.rejects(pending, { code: 'snapshot_unavailable' });
  await assert.rejects(f.bridge.read('bot', f.row), { code: 'snapshot_capacity' });
  await rejection; await f.exits[0];
  assert.equal(f.children[0].killed, true);
});

test('closing the bridge rejects every pending request and prevents respawn', async t => {
  const f = transport(t, 'process.stdin.resume()');
  const rejected = [f.bridge.read('bot', f.row), f.bridge.read('other', f.row)].map(pending => assert.rejects(pending, { code: 'snapshot_unavailable' }));
  f.bridge.close();
  await Promise.all(rejected); await f.exits[0];
  await assert.rejects(f.bridge.read('bot', f.row), { code: 'snapshot_unavailable' });
  assert.equal(f.children.length, 1);
});

test('oversized and malformed bridge output fail closed', async t => {
  for (const output of ['x'.repeat(65), 'not-json\n', '{"id":900,"result":{}}\n']) {
    const f = transport(t, 'process.stdin.once("data",()=>process.stdout.write(' + JSON.stringify(output) + '));process.stdin.resume()', { maxBytes: 64 });
    await assert.rejects(f.bridge.read('bot', f.row), { code: 'snapshot_unavailable' });
    await f.exits[0]; assert.equal(f.children[0].killed, true);
  }
});

test('wire accepts no arbitrary command or gateway method and bounds input size', async t => {
  for (const payload of ['{"id":1,"botId":"bot","command":"touch forbidden"}\n', '{"id":1,"botId":"bot","method":"ensureForeverBox"}\n', 'x'.repeat(16385)]) {
    const child = spawn(process.execPath, ['-e', snapshotBridgeProgram], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(child, 'close'); let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdin.on('error', () => {});
    t.after(() => child.kill('SIGKILL'));
    child.stdin.write(payload);
    const [code] = await closed;
    assert.equal(code, 1); assert.equal(stdout, ''); assert.equal(stderr, '');
  }
});
