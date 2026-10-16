import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, mkdirSync, rmSync, symlinkSync, chmodSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundled = await build({ entryPoints: ['source/host/extensions/library/catalog.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { LibraryCatalog } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const providerOrigin = 'https://library.example.test';
function root(t) { const value = realpathSync(mkdtempSync(join(tmpdir(), 'library-migrations-'))); t.after(() => rmSync(value, { recursive: true })); return value; }
const open = dataRoot => new LibraryCatalog({ dataRoot, providerOrigin });
test('migration is repeatable; foreign root, unknown and dirty unversioned schemas fail closed', t => {
  const a = root(t); open(a).close(); open(a).close();
  const b = root(t); mkdirSync(join(b, 'library'), { mode: 0o700 });
  copyFileSync(join(a, 'library/catalog.db'), join(b, 'library/catalog.db'));
  assert.throws(() => open(b), /root/);
  const db = new DatabaseSync(join(a, 'library/catalog.db')); db.exec('PRAGMA user_version=999'); db.close();
  assert.throws(() => open(a), /schema/);
  const c = root(t); mkdirSync(join(c, 'library'), { mode: 0o700 });
  writeFileSync(join(c, 'library/catalog.db'), '', { mode: 0o600 });
  const dirty = new DatabaseSync(join(c, 'library/catalog.db')); dirty.exec('CREATE TABLE unrelated(x)'); dirty.close();
  assert.throws(() => open(c), /nonempty/);
});
test('symlink root/directory/database/sidecar and broad permissions are rejected', t => {
  const a = root(t), b = root(t);
  symlinkSync(b, join(a, 'alias'));
  assert.throws(() => open(join(a, 'alias')), /symlink/i);
  symlinkSync(b, join(a, 'library'));
  assert.throws(() => open(a), /symlink/i);
  const c = root(t); mkdirSync(join(c, 'library'), { mode: 0o700 });
  const target = join(b, 'target'); writeFileSync(target, '', { mode: 0o600 });
  symlinkSync(target, join(c, 'library/catalog.db')); assert.throws(() => open(c), /symlink/i);
  const d = root(t); open(d).close();
  symlinkSync(target, join(d, 'library/catalog.db-journal')); assert.throws(() => open(d), /symlink/i);
  const e = root(t); chmodSync(e, 0o755); assert.throws(() => open(e), /private/);
});
test('process interruption during SQLite transaction recovers without partial authority', t => {
  const a = root(t); open(a).close(); const file = join(a, 'library/catalog.db');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(process.argv[1]); d.exec("BEGIN IMMEDIATE; INSERT INTO principals VALUES ('crash','partial')"); process.kill(process.pid,'SIGKILL');`, file], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL');
  open(a).close();
  const db = new DatabaseSync(file);
  assert.equal(db.prepare("SELECT count(*) AS n FROM principals WHERE account='crash'").get().n, 0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); db.close();
});
