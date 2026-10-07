import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedRuntime } from '../tools/node-agent-api/shared-runtime.mjs';

test('viewer assets reuse bytes within the container generation without querying bot desktop per module', async () => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'viewer-assets-')));
  let generation = 'container-a', started = 'start-1', image = 'sha256:img1', reads = 0, inspections = 0, failed = true;
  const runtime = await createSharedRuntime({ stateRoot, execute: async (file, args) => {
    if (args[0] === 'inspect') { inspections++; return { stdout: JSON.stringify([{ Id: generation, Image: image, Name: '/grok-node-local-vm', State: { Running: true, StartedAt: started } }]) }; }
    assert.deepEqual(args.slice(0, 3), ['exec', generation, 'cat']);
    reads++;
    if (args[3].endsWith('missing.js') && failed) { failed = false; throw new Error('fixture missing'); }
    return { stdout: Buffer.from(generation + ':' + started + ':' + image) };
  } });
  try {
    const bytes = await Promise.all([runtime.viewerAsset('app/ui.js'), runtime.viewerAsset('app/ui.js')]);
    assert.equal(reads, 1); assert.equal(bytes[0].toString(), 'container-a:start-1:sha256:img1');
    assert.equal(inspections, 1);
    await runtime.viewerAsset('app/ui.js'); assert.equal(reads, 1);
    generation = 'container-b';
    assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'container-b:start-1:sha256:img1'); assert.equal(reads, 2);
    started = 'start-2';
    assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'container-b:start-2:sha256:img1'); assert.equal(reads, 3);
    image = 'sha256:img2';
    assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'container-b:start-2:sha256:img2'); assert.equal(reads, 4);
    await assert.rejects(runtime.viewerAsset('core/missing.js'));
    await runtime.viewerAsset('core/missing.js'); assert.equal(reads, 6);
    await assert.rejects(runtime.viewerAsset('core/../../secret.js'), error => error.status === 404);
    assert.equal(reads, 6);
  } finally { await runtime.close(); await rm(stateRoot, { recursive: true, force: true }); }
});

test('asset cache evicts by entries and bytes and never serves stopped containers', async () => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'viewer-bounds-')));
  let running = true, reads = 0, large = false;
  const runtime = await createSharedRuntime({ stateRoot, execute: async (_file, args) => {
    if (args[0] === 'inspect') return { stdout: JSON.stringify([{ Id: 'fixture', Image: 'sha256:img1', Name: '/grok-node-local-vm', State: { Running: running, StartedAt: 'start' } }]) };
    reads++; return { stdout: Buffer.alloc(large ? 4 * 1024 * 1024 : 10, 65) };
  } });
  try {
    for (let i = 0; i < 130; i++) await runtime.viewerAsset('core/file' + i + '.js');
    const beforeEntries = reads; await runtime.viewerAsset('core/file0.js'); assert.equal(reads, beforeEntries + 1);
    large = true;
    for (let i = 0; i < 6; i++) await runtime.viewerAsset('vendor/large' + i + '.js');
    const beforeBytes = reads; await runtime.viewerAsset('vendor/large0.js'); assert.equal(reads, beforeBytes + 1);
    running = false; await assert.rejects(runtime.viewerAsset('vendor/large0.js'), { code: 'execution_unavailable' });
    assert.equal(reads, beforeBytes + 1);
  } finally { await runtime.close(); await rm(stateRoot, { recursive: true, force: true }); }
});

test('pending old-generation bytes cannot poison a replacement cache', async () => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'viewer-pending-')));
  let generation = 'old', release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const runtime = await createSharedRuntime({ stateRoot, execute: async (_file, args) => {
    if (args[0] === 'inspect') return { stdout: JSON.stringify([{ Id: generation, Image: 'sha256:img1', Name: '/grok-node-local-vm', State: { Running: true, StartedAt: 'start' } }]) };
    if (args[1] === 'old') { entered(); await new Promise(resolve => { release = resolve; }); }
    return { stdout: Buffer.from(args[1]) };
  } });
  try {
    const old = runtime.viewerAsset('app/ui.js'); await started;
    generation = 'new'; assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'new');
    release(); await old;
    assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'new');
  } finally { release?.(); await runtime.close(); await rm(stateRoot, { recursive: true, force: true }); }
});
