import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStore } from '../tools/node-agent-api/store.mjs';
import { ApiError } from '../tools/node-agent-api/errors.mjs';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';

async function evidence(name, value) {
  const dir = process.env.NODE_AGENT_STORE_EVIDENCE_DIR;
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(join(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'node-store-commit-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await createStore(dir);
  const a = (await store.create('a')).session, b = (await store.create('b')).session;
  return { dir, file: join(dir, 'sessions.json'), store, a, b };
}

function replaceFs(t, name, implementation) {
  const original = fs[name];
  fs[name] = implementation;
  syncBuiltinESMExports();
  t.after(() => { fs[name] = original; syncBuiltinESMExports(); });
}

const delta = n => ({ type: 'node.harness.event', data: { sequence: n } });

test('commit patches and interleaved batch events persist once before publishing stable sessions', async t => {
  const { store, file, a, b } = await fixture(t);
  let writes = 0, guards = 0;
  const rename = fs.rename;
  replaceFs(t, 'rename', async (...args) => { writes++; return rename(...args); });
  store.setWriteGuard(async () => { guards++; });
  const emitted = [], local = [];
  store.subscribe(a.id, event => local.push(event));
  store.subscribeAll(event => {
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk, store.list());
    assert.equal(store.get(a.id), a);
    assert.equal(store.get(b.id), b);
    emitted.push(event);
  });
  const single = await store.commit(a.id, { changes: { task_status: 'running' }, events: [delta(0)] });
  assert.equal(writes, 1); assert.equal(guards, 1);
  assert.equal(single.length, 1); assert.equal(single[0], emitted[0]);
  const batch = await store.commitBatch([
    { id: a.id, changes: { metadata: { first: true } }, events: [delta(1), delta(2)] },
    { id: b.id, changes: { task_status: 'done' }, events: [delta(3)] },
    { id: a.id, changes: { task_status: 'done' }, events: [delta(4)] },
  ]);
  assert.equal(writes, 2); assert.equal(guards, 2);
  assert.deepEqual(batch.map(e => e.data.sequence), [1, 2, 3, 4]);
  assert.deepEqual(emitted, [...single, ...batch]);
  assert.deepEqual(local.map(e => e.data.sequence), [0, 1, 2, 4]);
  assert.deepEqual(a.metadata, { first: true }); assert.equal(a.task_status, 'done');
  const legacy = await store.append(a.id, 'legacy', { ok: true });
  assert.equal(legacy, a.events.at(-1));
  assert.equal(await store.update(a.id, { status: 'idle' }), a);
  assert.equal(writes, 4); assert.equal(guards, 4);
  assert.deepEqual(await store.commitBatch([]), []); assert.equal(writes, 4);
  await evidence('commit-counts', { singleWrites: 1, batchWrites: 1, batchEvents: 4, legacyWrites: 2, totalWrites: writes, guards, sequence: batch.map(e => e.data.sequence), stableReferences: true, durableBeforePublish: true });
});

test('queued commits clone inputs and flush waits for the persistence barrier', async t => {
  const { store, file, a } = await fixture(t);
  const before = store.snapshot();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  store.setWriteGuard(async () => { entered.resolve(); await release.promise; });
  const operations = [{ id: a.id, changes: { metadata: { value: 'original' } }, events: [{ type: 'first', data: { value: 'original' } }] }];
  let emits = 0, flushed = false;
  store.subscribeAll(() => emits++);
  const first = store.commitBatch(operations);
  await entered.promise;
  operations[0].changes.metadata.value = 'mutated'; operations[0].events[0].data.value = 'mutated';
  operations.push({ id: a.id, events: [delta(9)] });
  const second = store.commit(a.id, { changes: { task_status: 'done' }, events: [delta(2)] });
  const flush = store.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.snapshot(), before); assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal(emits, 0); assert.equal(flushed, false);
  release.resolve();
  await Promise.all([first, second, flush]);
  assert.equal(a.metadata.value, 'original'); assert.equal(a.events[1].data.value, 'original');
  assert.deepEqual(a.events.slice(1).map(e => e.type), ['first', 'node.harness.event']);
  assert.equal(emits, 2); assert.equal(flushed, true);
  await evidence('queue-barrier', { unpublishedWhileBlocked: true, clonedInputs: true, events: 2, flushDrained: true });
});

test('later missing session, invalid arguments and aggregate event cap discard the whole candidate', async t => {
  const { store, file, a, b } = await fixture(t);
  let writes = 0, emits = 0;
  store.setWriteGuard(async () => { writes++; }); store.subscribeAll(() => emits++);
  const before = store.snapshot();
  const invalid = [null, {}, [null], [{ id: '' }], [{ id: 1 }], [{ id: a.id, events: {} }], [{ id: a.id, events: [null] }], [{ id: a.id, events: [{ type: 1 }] }], [{ id: a.id, events: new Array(1) }], [{ id: a.id, changes: [] }], [{ id: a.id, changes: null }], [{ id: a.id, changes: { id: b.id } }], [{ id: a.id, changes: { events: [] } }]];
  for (const operations of invalid) await assert.rejects(store.commitBatch(operations));
  for (const patch of [null, [], 1]) await assert.rejects(store.commit(a.id, patch), { code: 'invalid_request' });
  await assert.rejects(store.commitBatch([{ id: a.id, changes: { metadata: { leak: true } }, events: [delta(1)] }, { id: 'missing', events: [delta(2)] }]), { code: 'not_found' });
  await assert.rejects(store.commitBatch([{ id: a.id, changes: { status: 'closed' }, events: [delta(0)] }, { id: b.id, events: Array.from({ length: 9999 }, (_, i) => delta(i)) }, { id: b.id, events: [delta(10000)] }]), { code: 'event_limit' });
  await assert.rejects(store.commitBatch([{ id: a.id, changes: { status: 'closed' }, events: [delta(1)] }, { id: b.id, events: [{ type: 'invalid-json', data: 1n }] }]), TypeError);
  assert.equal(store.snapshot(), before); assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal(writes, 0); assert.equal(emits, 0);
  await store.commit(b.id, { events: Array.from({ length: 9999 }, (_, i) => delta(i)) });
  assert.equal(b.events.length, 10000);
  await assert.rejects(store.append(b.id, 'overflow', {}), { code: 'event_limit' });
  assert.equal(writes, 1); assert.equal(emits, 9999);
  await evidence('candidate-rejection', { invalidCases: invalid.length + 3, missingSessionRejected: true, aggregateCapRejected: true, serializationFailureRejected: true, rejectedWrites: 0, rejectedEmits: 0, acceptedEventCount: b.events.length });
});

test('quota guard rejects a complete candidate without poisoning the next small commit', async t => {
  const { store, file, a, b } = await fixture(t);
  const before = store.snapshot(); let guards = 0, emits = 0;
  store.subscribeAll(() => emits++);
  store.setWriteGuard(async rows => {
    guards++;
    if (Buffer.byteLength(JSON.stringify(rows)) > 2000) throw new ApiError(413, 'storage_quota', 'fixture quota');
  });
  await assert.rejects(store.commitBatch([{ id: a.id, events: [delta(1)] }, { id: b.id, changes: { metadata: { oversized: 'x'.repeat(3000) } }, events: [delta(2)] }]), { code: 'storage_quota' });
  assert.equal(store.snapshot(), before); assert.equal(await fs.readFile(file, 'utf8'), before); assert.equal(emits, 0);
  await store.commit(a.id, { changes: { metadata: { small: true } }, events: [delta(3)] });
  await store.flush();
  assert.equal(guards, 2); assert.equal(emits, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), store.list());
  await evidence('quota-retry', { rejectedEmits: 0, rejectedMemoryChanges: 0, guards, acceptedEmits: emits, flushSucceeded: true });
});

for (const stage of ['file-fsync', 'rename', 'directory-fsync']) {
  test(`real atomicJson ${stage} fault publishes nothing, stays closed, and reopens a complete snapshot`, async t => {
    const { store, file, dir, a, b } = await fixture(t);
    const before = store.snapshot(), failure = Object.assign(new Error('fixture ' + stage), { code: 'EIO' });
    let hits = 0, emits = 0;
    store.subscribeAll(() => emits++);
    if (stage === 'rename') {
      replaceFs(t, 'rename', async () => { hits++; throw failure; });
    } else {
      const open = fs.open;
      replaceFs(t, 'open', async (path, ...args) => {
        const handle = await open(path, ...args);
        if (stage === 'directory-fsync' ? path === dir : String(path).startsWith(file + '.tmp-')) {
          handle.sync = async () => { hits++; throw failure; };
        }
        return handle;
      });
    }
    const changes = [{ id: a.id, changes: { task_status: 'done' }, events: [delta(1)] }, { id: b.id, changes: { task_status: 'done' }, events: [delta(2)] }];
    await assert.rejects(store.commitBatch(changes), error => error === failure);
    assert.equal(hits, 1); assert.equal(emits, 0); assert.equal(store.snapshot(), before);
    await assert.rejects(store.append(a.id, 'retry', {}), error => error === failure);
    await assert.rejects(store.update(a.id, { status: 'closed' }), error => error === failure);
    await assert.rejects(store.flush(), error => error === failure);
    assert.equal(hits, 1);
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    const afterRename = stage === 'directory-fsync';
    if (afterRename) {
      assert.deepEqual(disk.map(row => row.task_status), ['done', 'done']);
      assert.deepEqual(disk.map(row => row.events.at(-1).data.sequence), [1, 2]);
    } else assert.equal(JSON.stringify(disk), before);
    const reopened = await createStore(dir);
    assert.deepEqual(reopened.list(), disk);
    await evidence(stage, { hits, emits, memoryUnchanged: true, retryFailedClosed: true, flushFailedClosed: true, reopenedWholeSnapshot: true, disk: afterRename ? 'complete-new-snapshot' : 'complete-old-snapshot' });
  });
}

test('real disk opens in a fresh process with original cursor IDs and pending input recovery', async t => {
  const { store, dir, a, b } = await fixture(t);
  const events = await store.commitBatch([{ id: a.id, changes: { status: 'pending', requests: { request_fixture: { status: 'pending', fingerprint: 'fixture' } } }, events: [delta(1), delta(2)] }, { id: b.id, events: [delta(3)] }]);
  await store.flush();
  const script = `import { createStore } from ${JSON.stringify(new URL('../tools/node-agent-api/store.mjs', import.meta.url).href)};
    const store = await createStore(process.argv[1]); await store.flush(); console.log(store.snapshot());`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, dir]);
  const rows = JSON.parse(stdout), recovered = rows.find(row => row.id === a.id);
  assert.deepEqual(recovered.events.slice(1, 3), events.slice(0, 2));
  const replay = recovered.events.slice(recovered.events.findIndex(event => event.id === events[0].id) + 1);
  assert.equal(replay[0].id, events[1].id); assert.equal(replay[1].type, 'node.session.input.unknown');
  assert.equal(replay[1].data.replayed, false); assert.equal(recovered.status, 'unknown');
  assert.equal(recovered.requests.request_fixture.status, 'unknown');
  const reopened = await createStore(dir);
  assert.equal(reopened.get(a.id).events.length, recovered.events.length);
  assert.deepEqual(reopened.get(b.id).events.at(-1), events[2]);
  await evidence('restart-replay', { freshProcess: true, originalEventIds: events.map(e => e.id), cursor: events[0].id, replayIds: replay.map(e => e.id), recoveryEvents: 1, replayed: false, repeatedOpenAddedEvents: 0 });
});

test('real HTTP SSE exposes committed envelopes exactly once and resumes from cursor after reopen', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'node-store-sse-')));
  let store, service; const readers = [];
  const adapter = { independentSessions: true, writesEnabled: false, attachStore(value) { store = value; }, agents: async () => [], items: async () => [] };
  t.after(async () => {
    for (const reader of readers) await reader.cancel();
    try { if (service) await service.close(); }
    finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  service = await startNodeAgentApi({ adapter, stateDirectory: dir });
  const a = (await store.create('a')).session;
  const key = (await fs.readFile(service.keyFile, 'utf8')).trim();
  const route = '/v1/agents/sessions/' + a.id + '/events';
  async function stream(cursor) {
    const response = await fetch(service.origin + route, { headers: { authorization: 'Bearer ' + key, accept: 'text/event-stream', 'last-event-id': cursor }, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    readers.push(reader);
    return { reader, async next() {
      while (!buffer.includes('\n\n')) { const { value, done } = await reader.read(); assert.equal(done, false); buffer += decoder.decode(value, { stream: true }); }
      const boundary = buffer.indexOf('\n\n'), frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      return JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
    } };
  }
  const live = await stream(a.events[0].id);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  store.setWriteGuard(async () => { entered.resolve(); await release.promise; });
  const write = store.commit(a.id, { changes: { task_status: 'done' }, events: [delta(1), delta(2)] });
  await entered.promise;
  let received = false;
  const first = live.next().then(event => { received = true; return event; });
  const history = await fetch(service.origin + route, { headers: { authorization: 'Bearer ' + key } });
  const historyBody = await history.json();
  assert.deepEqual(historyBody.data.map(e => e.id), [a.events[0].id]); assert.equal(received, false);
  release.resolve(); const events = await write;
  assert.deepEqual(await first, events[0]); assert.deepEqual(await live.next(), events[1]);
  store.setWriteGuard(async () => { throw new ApiError(413, 'storage_quota', 'fixture'); });
  await assert.rejects(store.commit(a.id, { events: [delta(99)] }), { code: 'storage_quota' });
  store.setWriteGuard(async () => {});
  const final = await store.append(a.id, 'sentinel', {});
  assert.deepEqual(await live.next(), final);
  await live.reader.cancel(); await service.close(); service = undefined;
  service = await startNodeAgentApi({ adapter, stateDirectory: dir });
  const replay = await stream(events[0].id);
  assert.deepEqual(await replay.next(), events[1]); assert.deepEqual(await replay.next(), final);
  await replay.reader.cancel();
  await evidence('sse-replay', { unpublishedWhileBlocked: true, historyCommittedOnly: true, liveIds: [...events, final].map(e => e.id), rejectedEventObserved: false, resumedIds: [events[1].id, final.id] });
});
