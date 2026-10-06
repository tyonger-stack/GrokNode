import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, stat, writeFile, unlink, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWebhookOutbox, validateWebhookDestination, verifyWebhookSignature } from '../tools/node-agent-api/webhooks.mjs';

const alice = { id: 'nkey_alice' }, bob = { id: 'nkey_bob' };
const destination = 'http://127.0.0.1:9999/events';
const moduleUrl = new URL('../tools/node-agent-api/webhooks.mjs', import.meta.url).href;
const code = (value, status) => error => error.code === value && error.status === status;
async function directory(name) {
  const base = process.env.NODE_AGENT_P2_EVIDENCE_DIR ?? tmpdir();
  await mkdir(base, { recursive: true });
  return realpath(await mkdtemp(join(base, 'webhooks-' + name + '-')));
}
async function server(t, handler) {
  const http = createServer(handler);
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { http.closeAllConnections(); http.close(resolve); }));
  return 'http://127.0.0.1:' + http.address().port;
}

test('webhooks: disabled by default and destination validation blocks SSRF inputs before transport', async t => {
  let calls = 0;
  const w = await createWebhookOutbox(await directory('destinations'), { transport: async () => { calls++; return { status: 200 }; } });
  t.after(() => w.close());
  assert.throws(() => w.enqueue(alice, { idempotencyKey: 'one', event: {} }), code('webhooks_disabled', 503));
  assert.throws(() => w.dispatchDue(), code('webhooks_disabled', 503));
  for (const url of ['http://example.com/', 'http://localhost/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://127.0.0.2/', 'http://169.254.169.254/', 'http://10.0.0.1/', 'file:///tmp/test', 'ftp://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://127.0.0.1.evil.test/', 'http://user:password@127.0.0.1/', 'http://127.0.0.1:0/', 'http://127.0.0.1:99999/', 'http://127.0.0.1/?token=secret', 'http://127.0.0.1/#fragment', 'http://127.0.0.1\\@example.com/', ' http://127.0.0.1/', 'http://127.0.0.1/\n']) {
    assert.throws(() => validateWebhookDestination(url), code('invalid_request', 400), url);
    await assert.rejects(w.configure({ destination: url }), code('invalid_request', 400));
  }
  assert.equal(validateWebhookDestination('https://[::1]:444/hook'), 'https://[::1]:444/hook');
  await w.configure({ destination });
  w.disable();
  assert.throws(() => w.enqueue(alice, { idempotencyKey: 'two', event: {} }), code('webhooks_disabled', 503));
  assert.equal(calls, 0);
});

test('webhooks: concurrent idempotent enqueue, conflicts, principal isolation and single-flight delivery', async t => {
  const dir = await directory('concurrency');
  let sends = 0, unblock, signalStart;
  const started = new Promise(resolve => { signalStart = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const w = await createWebhookOutbox(dir, { transport: async () => { sends++; signalStart(); await blocked; return { status: 204 }; } });
  t.after(() => w.close());
  await w.configure({ destination });
  const event = { type: 'session.changed', session_id: 'nsess_test' };
  const entries = await Promise.all(Array.from({ length: 20 }, () => w.enqueue(alice, { idempotencyKey: 'same', event })));
  assert.equal(new Set(entries.map(d => d.id)).size, 1);
  await assert.rejects(w.enqueue(alice, { idempotencyKey: 'same', event: { type: 'different' } }), code('webhook_idempotency_conflict', 409));
  await assert.rejects(w.status(bob, entries[0].id), code('not_found', 404));
  const foreign = await w.enqueue(bob, { idempotencyKey: 'same', event });
  assert.notEqual(foreign.id, entries[0].id);
  const dispatches = Array.from({ length: 10 }, () => w.dispatchDue());
  await started;
  assert.equal(sends, 1);
  assert.equal((await w.status(alice, entries[0].id)).status, 'delivering');
  unblock(); await Promise.all(dispatches);
  assert.equal(sends, 2);
  assert.equal((await w.status(alice, entries[0].id)).status, 'delivered');
  assert.deepEqual(await w.dispatchDue(), []);
  assert.equal(JSON.parse(await readFile(w.stateFile, 'utf8')).deliveries.length, 2);
  assert.equal((await stat(w.stateFile)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'webhooks'))).mode & 0o777, 0o700);
});

test('webhooks: real HTTP exact-body HMAC, timestamp and delivery ID verification with key rotation', async t => {
  const captures = [], dir = await directory('wire');
  const url = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    captures.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(204); res.end();
  });
  let now = 1000000;
  const w = await createWebhookOutbox(dir, { clock: () => now }); t.after(() => w.close());
  const first = (await w.configure({ destination: url })).signingKey;
  const entry = await w.enqueue(alice, { idempotencyKey: 'signed', event: { type: 'session.changed', value: 'UTF-8: 测试' } });
  await w.dispatchDue();
  const c = captures[0], h = c.headers;
  assert.equal(h['x-node-webhook-id'], entry.id);
  assert.equal(h['x-node-webhook-timestamp'], '1000');
  assert.equal(h['x-node-webhook-signature'], 'v1=' + createHmac('sha256', Buffer.from(first.secret, 'base64url')).update('1000.' + entry.id + '.' + c.body).digest('hex'));
  assert.equal(Number(h['content-length']), Buffer.byteLength(c.body));
  const verification = { keys: [first], keyId: first.id, timestamp: 1000, deliveryId: entry.id, body: c.body, signature: h['x-node-webhook-signature'], now };
  assert.equal(verifyWebhookSignature(verification), true);
  for (const changes of [{ body: c.body + ' ' }, { deliveryId: 'whd_other' }, { timestamp: 1001 }, { keyId: 'missing' }, { now: now + 300001 }, { now: now - 300001 }, { signature: 'v1=garbage' }]) assert.equal(verifyWebhookSignature({ ...verification, ...changes }), false);
  const secondEntry = await w.enqueue(alice, { idempotencyKey: 'rotated', event: { type: 'session.changed' } });
  const second = await w.rotateKey(); now += 1000;
  await w.dispatchDue();
  assert.notEqual(first.id, second.id); assert.notEqual(first.secret, second.secret);
  assert.equal(captures[1].headers['x-node-webhook-key-id'], second.id);
  assert.equal(verifyWebhookSignature({ keys: [first, second], keyId: second.id, timestamp: 1001, deliveryId: secondEntry.id, body: captures[1].body, signature: captures[1].headers['x-node-webhook-signature'], now }), true);
  assert.equal(verifyWebhookSignature({ ...verification, keys: [second] }), false);
  await writeFile(join(dir, 'wire-capture.json'), JSON.stringify(captures, null, 2));
});

test('webhooks: durable backoff across reopen, retry caps and sanitized transport errors', async t => {
  const dir = await directory('retry'); let now = 1000, count = 0;
  const attemptedKeys = [];
  const policy = { baseDelayMs: 100, maxDelayMs: 150, maxAttempts: 3 };
  let w = await createWebhookOutbox(dir, { clock: () => now, policy, transport: async () => { count++; return { status: 503 }; } });
  t.after(() => w.close());
  await w.configure({ destination });
  const entry = await w.enqueue(alice, { idempotencyKey: 'retry', event: { type: 'retry' } });
  await w.dispatchDue();
  assert.deepEqual((await w.status(alice, entry.id)), { ...entry, status: 'retry', attempts: 1, nextAttemptAt: 1100, lastError: 'http_status', lastStatus: 503 });
  const key = await w.rotateKey();
  await w.close();
  w = await createWebhookOutbox(dir, { clock: () => now, policy, transport: async ({ headers }) => { count++; attemptedKeys.push(headers['x-node-webhook-key-id']); throw new Error('Bearer CREDENTIAL_SENTINEL / PROMPT_SENTINEL'); } });
  assert.throws(() => w.dispatchDue(), code('webhooks_disabled', 503));
  assert.deepEqual((await w.configure({ destination })).signingKey, key);
  assert.equal((await w.enqueue(alice, { idempotencyKey: 'retry', event: { type: 'retry' } })).id, entry.id);
  now = 1099; await w.dispatchDue(); assert.equal(count, 1);
  now = 1100; await w.dispatchDue(); assert.equal(count, 2);
  assert.equal((await w.status(alice, entry.id)).nextAttemptAt, 1250);
  now = 1250; await w.dispatchDue(); assert.equal(count, 3);
  const failed = await w.status(alice, entry.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.lastError, 'transport');
  now = 99999; await w.dispatchDue(); assert.equal(count, 3);
  assert.deepEqual(attemptedKeys, [key.id, key.id]);
  assert.ok(!/CREDENTIAL_SENTINEL|PROMPT_SENTINEL/.test(await readFile(w.stateFile, 'utf8')));
});

test('webhooks: real HTTP redirect is not followed, 400 is terminal and 429 retries', async t => {
  let redirected = 0;
  const target = await server(t, (_req, res) => { redirected++; res.end(); });
  const source = await server(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: target }); res.end(); }
    else { res.writeHead(req.url === '/rate' ? 429 : 400); res.end(); }
  });
  const w = await createWebhookOutbox(await directory('http-negative')); t.after(() => w.close());
  const entries = [];
  for (const [path, status] of [['/redirect', 'failed'], ['/bad', 'failed'], ['/rate', 'retry']]) {
    await w.configure({ destination: source + path });
    const d = await w.enqueue(alice, { idempotencyKey: path.slice(1), event: { type: 'notice' } });
    entries.push({ id: d.id, status });
  }
  await w.dispatchDue();
  for (const entry of entries) assert.equal((await w.status(alice, entry.id)).status, entry.status);
  assert.equal(redirected, 0);
});

test('webhooks: disable and close win over pending configuration and prevent new dispatch claims', async () => {
  const dir = await directory('lifecycle'); let calls = 0;
  let finish, started;
  const begin = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { finish = resolve; });
  const w = await createWebhookOutbox(dir, { transport: async () => { calls++; started(); await blocked; return { status: 204 }; } });
  const configuration = w.configure({ destination }); w.disable(); await configuration;
  assert.throws(() => w.dispatchDue(), code('webhooks_disabled', 503));
  await w.configure({ destination });
  const one = await w.enqueue(alice, { idempotencyKey: 'one', event: {} });
  const two = await w.enqueue(alice, { idempotencyKey: 'two', event: {} });
  const dispatch = w.dispatchDue(); await begin;
  const pendingConfiguration = w.configure({ destination });
  const closed = w.close(); finish();
  await Promise.all([dispatch, pendingConfiguration, closed]);
  assert.equal(calls, 1);
  const state = JSON.parse(await readFile(w.stateFile, 'utf8'));
  assert.equal(state.deliveries.find(d => d.id === one.id).status, 'delivered');
  assert.equal(state.deliveries.find(d => d.id === two.id).status, 'pending');
  assert.throws(() => w.dispatchDue(), code('webhooks_closed', 503));
});

test('webhooks: timeout bounds a stalled HTTP body and aborts injected transport', async t => {
  const url = await server(t, (_req, res) => { res.writeHead(200); res.write('never finishes'); });
  const w = await createWebhookOutbox(await directory('http-timeout'), { policy: { timeoutMs: 40, maxAttempts: 1 } }); t.after(() => w.close());
  await w.configure({ destination: url });
  const d = await w.enqueue(alice, { idempotencyKey: 'timeout', event: {} });
  const start = Date.now(); await w.dispatchDue();
  assert.ok(Date.now() - start < 2000);
  assert.equal((await w.status(alice, d.id)).lastError, 'timeout');
  assert.equal((await w.status(alice, d.id)).status, 'failed');
  let aborted = false;
  const injected = await createWebhookOutbox(await directory('injected-timeout'), { policy: { timeoutMs: 30 }, transport: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true })) });
  t.after(() => injected.close()); await injected.configure({ destination });
  const pending = await injected.enqueue(alice, { idempotencyKey: 'hang', event: {} });
  await injected.dispatchDue();
  assert.equal(aborted, true); assert.equal((await injected.status(alice, pending.id)).status, 'retry');
});

test('webhooks: SIGKILL during delivery recovers with same delivery ID and payload, never false success', async t => {
  const dir = await directory('crash'), captured = [], arrivals = [];
  let notify;
  const received = new Promise(resolve => { notify = resolve; });
  const url = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    captured.push(body); arrivals.push(req.headers['x-node-webhook-id']);
    if (captured.length === 1) notify(); else { res.writeHead(204); res.end(); }
  });
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createWebhookOutbox } from ${JSON.stringify(moduleUrl)};
    const w = await createWebhookOutbox(${JSON.stringify(dir)});
    await w.configure({destination:${JSON.stringify(url)}});
    await w.enqueue({id:'nkey_alice'}, {idempotencyKey:'crash',event:{type:'session.changed'}});
    await w.dispatchDue();
  `], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; });
  await Promise.race([received, once(child, 'exit').then(() => { throw new Error(errors || 'child exited before delivery'); })]);
  const exit = once(child, 'exit'); child.kill('SIGKILL'); assert.equal((await exit)[1], 'SIGKILL');
  assert.equal(JSON.parse(await readFile(join(dir, 'webhooks', 'outbox.json'), 'utf8')).deliveries[0].status, 'delivering');
  await assert.rejects(createWebhookOutbox(dir), /locked/);
  await unlink(join(dir, 'webhooks', 'service.lock'));
  const w = await createWebhookOutbox(dir); t.after(() => w.close());
  const recovered = await w.status(alice, arrivals[0]);
  assert.equal(recovered.status, 'retry'); assert.equal(recovered.lastError, 'interrupted');
  assert.throws(() => w.dispatchDue(), code('webhooks_disabled', 503));
  await w.configure({ destination: url });
  await w.dispatchDue();
  assert.deepEqual(arrivals, [arrivals[0], arrivals[0]]);
  assert.equal(captured[0], captured[1]);
  assert.equal((await w.status(alice, arrivals[0])).status, 'delivered');
  assert.equal((await w.status(alice, arrivals[0])).attempts, 2);
  await writeFile(join(dir, 'crash-replay-observation.json'), JSON.stringify({ arrivals, captured, signal: 'SIGKILL', recovered }));
});

test('webhooks: capacity, payload bounds, invalid policy, corruption, symlinks and persistence errors fail closed', async () => {
  const dir = await directory('negative'); let calls = 0;
  const w = await createWebhookOutbox(dir, { policy: { maxEntries: 1, maxBodyBytes: 200 }, transport: async () => { calls++; return { status: 204 }; } });
  await assert.rejects(createWebhookOutbox(dir), /locked/);
  await w.configure({ destination });
  assert.throws(() => w.enqueue(alice, { idempotencyKey: 'large', event: { text: 'x'.repeat(201) } }), code('invalid_request', 400));
  const d = await w.enqueue(alice, { idempotencyKey: 'one', event: {} });
  await assert.rejects(w.enqueue(alice, { idempotencyKey: 'two', event: {} }), code('webhook_capacity', 429));
  await unlink(w.stateFile); const target = join(dir, 'target'); await writeFile(target, '{}'); await symlink(target, w.stateFile);
  await assert.rejects(w.dispatchDue(), code('webhook_persistence_failed', 503));
  assert.equal(calls, 0);
  await assert.rejects(w.status(alice, d.id), code('webhook_persistence_failed', 503));
  await w.close(); await w.close();
  await assert.rejects(createWebhookOutbox(dir));
  assert.equal(await readFile(target, 'utf8'), '{}');
  await unlink(w.stateFile); await writeFile(w.stateFile, '{broken');
  await assert.rejects(createWebhookOutbox(dir), SyntaxError);
  for (const policy of [{ timeoutMs: 0 }, { maxAttempts: Infinity }, { maxEntries: -1 }]) await assert.rejects(createWebhookOutbox(dir, { policy }), code('invalid_request', 400));
});
