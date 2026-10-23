import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const memory = await load('source/host/runner/sand-memory.ts');

function store(existing = []) {
  const records = [...existing];
  return {
    records,
    removeMemoryByContent: () => false,
    addMemory: (content, now, kind) => {
      const record = { id: `memory-${now}-${records.length}`, content, createdAt: now, kind };
      records.push(record);
      return record;
    },
  };
}

test('pasted export parses one fact per line and drops empties', () => {
  const plan = memory.planMemoryImport({ kind: 'paste', text: 'User prefers dark mode.\n\n- Speaks Shanghainese\n1. Allergic to peanuts\n' }, []);
  assert.deepEqual(plan.items.map((item) => item.content), [
    'User prefers dark mode.',
    'Speaks Shanghainese',
    'Allergic to peanuts',
  ]);
  assert.deepEqual(plan.duplicates, []);
  assert.equal(plan.skipped.length, 2);
});

test('existing facts dedupe case-insensitively and store write applies the rest', () => {
  const existing = [{ content: 'User prefers dark mode.', createdAt: 1, kind: 'log' }];
  const plan = memory.planMemoryImport({ kind: 'file', fileName: 'export.md', text: 'user PREFERS dark mode.\nLives in Shanghai.\n' }, existing);
  assert.deepEqual(plan.items.map((item) => item.content), ['Lives in Shanghai.']);
  assert.deepEqual(plan.duplicates, ['user PREFERS dark mode.']);
  const backing = store(existing);
  const applied = memory.applyMemoryImport(backing, plan, 7);
  assert.equal(applied.added.length, 1);
  assert.equal(applied.added[0].content, 'Lives in Shanghai.');
  assert.deepEqual(applied.duplicates, plan.duplicates);
});

test('failed store writes are left out while duplicates still report', () => {
  const plan = memory.planMemoryImport({ kind: 'paste', text: 'A\nB\n' }, []);
  const backing = { removeMemoryByContent: () => false, addMemory: (content) => content === 'A' ? null : { id: 'x', content, createdAt: 1, kind: 'log' } };
  const applied = memory.applyMemoryImport(backing, plan, 1);
  assert.deepEqual(applied.added.map((record) => record.content), ['B']);
});

test('a thrown store write rolls back facts already added', () => {
  const plan = memory.planMemoryImport({ kind: 'paste', text: 'A\nB\n' }, []);
  const records = [];
  const backing = {
    records,
    addMemory: (content, now, kind) => {
      if (content === 'B') throw new Error('disk full');
      const record = { id: 'a', content, createdAt: now, kind };
      records.push(record);
      return record;
    },
    removeMemoryByContent: (content) => {
      const index = records.findIndex((record) => record.content === content);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
  };
  assert.throws(() => memory.applyMemoryImport(backing, plan, 1), /disk full/);
  assert.deepEqual(records, []);
});

test('parseMemoryImportRequest accepts a paste id and rejects traversal', () => {
  const accepted = memory.parseMemoryImportRequest({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', text: 'Lives in Shanghai.' });
  assert.equal(accepted.kind, 'paste');
  assert.equal(accepted.text, 'Lives in Shanghai.');
  assert.equal(memory.parseMemoryImportRequest({ id: '../x', text: 'A' }), null);
  assert.equal(memory.parseMemoryImportRequest({ id: 'agent-1', text: 'A', fileName: 'a/b.md' }), null);
  assert.equal(memory.parseMemoryImportRequest({ id: 'agent-1', text: 'x'.repeat(memory.MEMORY_IMPORT_TEXT_LIMIT + 1) }), null);
  assert.equal(memory.parseMemoryImportRequest({ id: 'agent-1', text: 'A', kind: 'url' }), null);
});
