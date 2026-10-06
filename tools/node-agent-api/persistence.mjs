import { constants } from 'node:fs';
import { open, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readPrivateJson(file, fallback) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile()) throw new Error('State must be a regular file');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  finally { await handle?.close(); }
}

export async function atomicJson(file, value) {
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe state file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = file + '.tmp-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await rename(temporary, file);
    const directory = await open(dirname(file), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function acquireStateLock(directory) {
  const file = join(directory, 'service.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('State directory is locked; stop its service or verify a stale service.lock before removing it');
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: Date.now() })); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(file); throw error; }
  return async () => { await handle.close(); await unlink(file); };
}

export async function recoverServiceLocks(directory) {
  for (const relative of ['service.lock', 'governance/service.lock', 'webhooks/service.lock']) {
    const file = join(directory, relative), record = await readPrivateJson(file, null);
    if (record === null) continue;
    if (!Number.isInteger(record.pid) || record.pid < 1) throw new Error('Cannot verify stale service lock');
    try { process.kill(record.pid, 0); throw new Error('Service lock owner is still alive'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(file);
  }
}
