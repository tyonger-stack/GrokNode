import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, stat, writeFile, symlink, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGovernance, sanitizeAuditRecord } from '../tools/node-agent-api/governance.mjs';

const alice = { id: 'nkey_alice', digest: 'CREDENTIAL_SENTINEL', authorization: 'Bearer CREDENTIAL_SENTINEL' };
const bob = { id: 'nkey_bob' };
const moduleUrl = new URL('../tools/node-agent-api/governance.mjs', import.meta.url).href;
async function directory(name) {
  const base = process.env.NODE_AGENT_P2_EVIDENCE_DIR ?? tmpdir();
  await mkdir(base, { recursive: true });
  return realpath(await mkdtemp(join(base, 'governance-' + name + '-')));
}
const code = (value, status) => error => error.code === value && error.status === status;

test('governance: concurrent request admissions are principal scoped and fixed-window bounded', async t => {
  let now = 1000;
  const dir = await directory('rate'), g = await createGovernance(dir, { clock: () => now, limits: { requests: 3, windowMs: 1000 }, principals: { nkey_bob: { requests: 1 } } });
  t.after(() => g.close());
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => g.consumeRequest(alice)));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 3);
  for (const r of attempts.filter(r => r.status === 'rejected')) { assert.equal(r.reason.code, 'request_rate_limit'); assert.equal(r.reason.status, 429); assert.equal(r.reason.retryAfterMs, 1000); }
  await g.consumeRequest(bob);
  await assert.rejects(g.consumeRequest(bob), code('request_rate_limit', 429));
  now = 1999;
  await assert.rejects(g.consumeRequest(alice), e => e.retryAfterMs === 1);
  now = 2000;
  assert.equal((await g.consumeRequest(alice)).remaining, 2);
  assert.equal((await g.usage(bob)).requests, 0);
});

test('governance: concurrent stream leases cap admissions and release exactly once', async t => {
  const g = await createGovernance(await directory('streams'), { limits: { streams: 2 } });
  t.after(() => g.close());
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => g.acquireStream(alice)));
  const releases = attempts.filter(r => r.status === 'fulfilled').map(r => r.value);
  assert.equal(releases.length, 2);
  assert.equal(attempts.filter(r => r.status === 'rejected' && r.reason.code === 'stream_limit').length, 10);
  const bobRelease = await g.acquireStream(bob);
  assert.equal((await g.usage(alice)).streams, 2);
  releases[0](); releases[0]();
  const release = await g.acquireStream(alice);
  await assert.rejects(g.acquireStream(alice), code('stream_limit', 429));
  try { throw new Error('consumer failed'); } catch {} finally { release(); releases[1](); bobRelease(); }
  assert.equal((await g.usage(alice)).streams, 0);
});

test('governance: storage reservations are atomic, idempotent, isolated and reject invalid bytes', async t => {
  const g = await createGovernance(await directory('storage'), { limits: { storageBytes: 10 } });
  t.after(() => g.close());
  const writes = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => g.reserveStorage(alice, 'resource_' + i, 3)));
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 3);
  assert.equal(writes.filter(r => r.status === 'rejected' && r.reason.code === 'storage_quota').length, 7);
  assert.equal((await g.usage(alice)).storageBytes, 9);
  await g.reserveStorage(alice, 'resource_0', 3);
  await g.reserveStorage(bob, 'resource_0', 10);
  await assert.rejects(g.reserveStorage(alice, 'resource_0', 5), code('storage_quota', 413));
  for (const value of [-1, NaN, Infinity, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => g.reserveStorage(alice, 'invalid', value), code('invalid_request', 400));
  await g.reserveStorage(alice, 'resource_0', 0);
  assert.equal((await g.reserveStorage(alice, 'new', 4)).storageBytes, 10);
  assert.equal((await g.usage(bob)).storageBytes, 10);
});

test('governance: audit journal is private, bounded and never copies credentials or prompt bodies', async t => {
  const dir = await directory('audit'), g = await createGovernance(dir, { journalLimit: 2 });
  t.after(() => g.close());
  for (let i = 0; i < 3; i++) await g.recordAudit({ principal: alice, action: 'authorization', outcome: 'denied', status: 403, resourceId: 'bot_1', requestId: 'req_' + i, headers: { authorization: 'CREDENTIAL_SENTINEL' }, prompt: 'PROMPT_SENTINEL', error: new Error('CREDENTIAL_SENTINEL'), body: { prompt: 'PROMPT_SENTINEL' } });
  const raw = await readFile(g.journalFile, 'utf8'), saved = JSON.parse(raw);
  assert.equal(saved.journal.length, 2);
  assert.ok(!/CREDENTIAL_SENTINEL|PROMPT_SENTINEL|nkey_alice|bot_1|req_/.test(raw));
  assert.match(saved.journal[0].principal, /^[a-f0-9]{64}$/);
  assert.equal((await stat(g.journalFile)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'governance'))).mode & 0o777, 0o700);
  assert.throws(() => sanitizeAuditRecord({ principal: alice, action: 'PROMPT_SENTINEL', outcome: 'failed' }), code('invalid_request', 400));
  assert.throws(() => sanitizeAuditRecord({ principal: alice, action: 'request', outcome: 'failed', status: 'SECRET' }), code('invalid_request', 400));
});

test('governance: lower limits after restart allow storage reclamation and zero quotas deny admissions', async t => {
  const dir = await directory('lower-limits');
  let g = await createGovernance(dir, { limits: { storageBytes: 10 } });
  await g.reserveStorage(alice, 'file', 10); await g.close();
  g = await createGovernance(dir, { limits: { storageBytes: 2, requests: 0, streams: 0 }, maxPrincipals: 1 });
  t.after(() => g.close());
  assert.deepEqual(await g.reserveStorage(alice, 'file', 8), { storageBytes: 8, remaining: 0 });
  await assert.rejects(g.reserveStorage(alice, 'file', 9), code('storage_quota', 413));
  await g.reserveStorage(alice, 'file', 0);
  assert.equal((await g.reserveStorage(alice, 'file', 2)).remaining, 0);
  await assert.rejects(g.consumeRequest(alice), code('request_rate_limit', 429));
  await assert.rejects(g.acquireStream(alice), code('stream_limit', 429));
  await assert.rejects(g.reserveStorage(bob, 'file', 1), code('principal_capacity', 503));
});

test('governance: fresh process after SIGKILL preserves quotas and audit but releases dead streams', async t => {
  const dir = await directory('restart');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createGovernance } from ${JSON.stringify(moduleUrl)};
    const g = await createGovernance(${JSON.stringify(dir)}, { clock: () => 1000, limits: { requests: 1, streams: 1, storageBytes: 8 } });
    await g.consumeRequest({id:'nkey_alice'});
    await g.reserveStorage({id:'nkey_alice'}, 'retained', 8);
    await g.acquireStream({id:'nkey_alice'});
    process.stdout.write('durable\\n'); setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; });
  const ready = await Promise.race([once(child.stdout, 'data').then(([bytes]) => bytes.toString()), once(child, 'exit').then(() => { throw new Error(errors); })]);
  assert.equal(ready, 'durable\n');
  const exit = once(child, 'exit'); child.kill('SIGKILL'); assert.equal((await exit)[1], 'SIGKILL');
  await assert.rejects(createGovernance(dir), /locked/);
  // Deliberate stale-lock recovery only after observing the writer process exit.
  await unlink(join(dir, 'governance', 'service.lock'));
  const g = await createGovernance(dir, { clock: () => 1000, limits: { requests: 1, streams: 1, storageBytes: 8 } });
  t.after(() => g.close());
  await assert.rejects(g.consumeRequest(alice), code('request_rate_limit', 429));
  await assert.rejects(g.reserveStorage(alice, 'overflow', 1), code('storage_quota', 413));
  const release = await g.acquireStream(alice); release();
  assert.equal((await g.usage(alice)).storageBytes, 8);
  assert.equal(JSON.parse(await readFile(g.journalFile, 'utf8')).journal.filter(r => r.action === 'request' && r.outcome === 'allowed').length, 1);
  await writeFile(join(dir, 'restart-observation.json'), JSON.stringify({ childSignal: 'SIGKILL', requestDenied: true, storageDenied: true, streamReacquired: true }));
});

test('governance: corrupt state, symlinks, second writers, closed operations and persistence faults fail closed', async () => {
  const dir = await directory('negative'), g = await createGovernance(dir);
  await assert.rejects(createGovernance(dir), /locked/);
  await g.consumeRequest(alice);
  await g.close(); await g.close();
  await assert.rejects(g.acquireStream(alice), code('governance_closed', 503));
  await writeFile(g.journalFile, '{bad json');
  await assert.rejects(createGovernance(dir), SyntaxError);
  await unlink(g.journalFile);
  const target = join(dir, 'target.json'); await writeFile(target, '{}');
  await symlink(target, g.journalFile);
  await assert.rejects(createGovernance(dir));
  await unlink(g.journalFile);
  const next = await createGovernance(dir);
  await symlink(target, next.journalFile);
  await assert.rejects(next.acquireStream(alice), code('governance_persistence_failed', 503));
  await assert.rejects(next.consumeRequest(alice), code('governance_persistence_failed', 503));
  assert.equal(await readFile(target, 'utf8'), '{}');
  await next.close();
  for (const limits of [{ requests: -1 }, { windowMs: 0 }, { streams: Infinity }, { storageBytes: 1.1 }]) await assert.rejects(createGovernance(dir, { limits }), code('invalid_request', 400));
});
