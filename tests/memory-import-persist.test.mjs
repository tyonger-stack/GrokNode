import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debounce = { name: 'test', wrap: (fn) => Object.assign(fn, { dispose() {} }) };
const agentId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const now = Date.UTC(2026, 9, 23);

async function load(entry) {
  const result = await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const memory = await load('source/host/extensions/memory/memory-service.ts');
const protocol = await load('source/host/gateway-protocol.ts');

test('importMemories writes the fact once and a second import dedupes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'memory-import-'));
  try {
    const service = new memory.MemoryService({ agentsRootDir: path.join(root, 'agents'), debounce });
    const first = service.importMemories({ id: agentId, kind: 'paste', text: 'Lives in Shanghai.\n' }, now);
    assert.equal(first.added.length, 1);
    const logPath = path.join(root, 'agents', agentId, 'memory', 'log', '2026-10.md');
    const written = await readFile(logPath, 'utf8');
    assert.equal(written.split('Lives in Shanghai.').length - 1, 1);
    assert.match(written, /- \(2026-10-23\) Lives in Shanghai\./);
    const second = service.importMemories({ id: agentId, kind: 'paste', text: 'Lives in Shanghai.\n' }, now);
    assert.equal(second.added.length, 0);
    assert.deepEqual(second.duplicates, ['Lives in Shanghai.']);
    const again = await readFile(logPath, 'utf8');
    assert.equal(again.split('Lives in Shanghai.').length - 1, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gateway command forwards importAgentMemories to the host api', () => {
  let received = null;
  const api = { importAgentMemories: (args) => { received = args; return { added: [] }; } };
  protocol.SAND_GATEWAY_COMMANDS.importAgentMemories(api, JSON.stringify({ id: agentId, kind: 'paste', text: 'Hi' }));
  assert.deepEqual(received, { id: agentId, kind: 'paste', text: 'Hi' });
});

test('renderer, gateway, and transcript all name the import method', () => {
  const coordinator = readFileSync(path.join(repoRoot, 'source/shared/rpc/coordinator.ts'), 'utf8');
  const gateway = readFileSync(path.join(repoRoot, 'source/host/host-gateway-api.ts'), 'utf8');
  const transcript = readFileSync(path.join(repoRoot, 'source/host/extensions/transcript/transcript-manager.ts'), 'utf8');
  assert.match(coordinator, /getAgentMemories: \{ args: "object", reply: "array" \}/);
  assert.match(coordinator, /importAgentMemories: \{ args: "object", reply: "record" \}/);
  assert.match(gateway, /importAgentMemories: \(args: any\) =>\s+method\(manager, "importAgentMemories"\)\(args\.id, args\)/);
  const body = transcript.slice(transcript.indexOf('async importAgentMemories'), transcript.indexOf('async importAgentMemories') + 700);
  assert.match(body, /id: agentId/);
  assert.match(body, /parseMemoryImportRequest/);
});
