import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedRuntime } from '../tools/node-agent-api/shared-runtime.mjs';

test('viewer assets reuse bytes within the container generation without querying bot desktop per module', async () => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'viewer-assets-')));
  let generation = 'container-a', reads = 0, failed = true;
  const runtime = await createSharedRuntime({ stateRoot, execute: async (file, args) => {
    if (args[0] === 'inspect') return { stdout: JSON.stringify([{ Id: generation, Name: '/grok-node-local-vm', State: { Running: true } }]) };
    assert.deepEqual(args.slice(0, 3), ['exec', generation, 'cat']);
    reads++;
    if (args[3].endsWith('missing.js') && failed) { failed = false; throw new Error('fixture missing'); }
    return { stdout: Buffer.from(generation + ':asset') };
  } });
  try {
    const bytes = await Promise.all([runtime.viewerAsset('app/ui.js'), runtime.viewerAsset('app/ui.js')]);
    assert.equal(reads, 1); assert.equal(bytes[0].toString(), 'container-a:asset');
    await runtime.viewerAsset('app/ui.js'); assert.equal(reads, 1);
    generation = 'container-b';
    assert.equal((await runtime.viewerAsset('app/ui.js')).toString(), 'container-b:asset'); assert.equal(reads, 2);
    await assert.rejects(runtime.viewerAsset('core/missing.js'));
    await runtime.viewerAsset('core/missing.js'); assert.equal(reads, 4);
    await assert.rejects(runtime.viewerAsset('core/../../secret.js'), error => error.status === 404);
    assert.equal(reads, 4);
  } finally { await runtime.close(); }
});
