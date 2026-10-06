import { createHash } from 'node:crypto';
import { mkdir, chmod, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const OWNER = 'com.groknode.lab.namespace';
export const BOT = 'com.groknode.lab.bot-id';

// These names identify private API state; no container management occurs here.
export function resourceNames(namespace, botId) {
  if (!/^grok-node-lab-[a-z0-9][a-z0-9-]{0,30}$/.test(namespace)) throw new Error('Invalid API namespace');
  if (typeof botId !== 'string' || !botId.trim() || botId.length > 512 || /[\x00-\x1f\x7f]/.test(botId)) throw new Error('Invalid botId');
  const key = createHash('sha256').update(botId).digest('hex').slice(0, 32), name = `${namespace}-${key}`;
  return { key, container: name, network: `${name}-net`, workspace: `${name}-workspace`, data: `${name}-data`, runtime: `${name}-runtime` };
}

export async function privateDirectory(directory) {
  const absolute = resolve(directory);
  for (let current = absolute; ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('State paths cannot contain symlinks'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
  const home = homedir(), protectedPaths = ['.codex', '.codex-vm', '.grokbot', '.groknode'].map(p => join(home, p));
  if (absolute === '/' || absolute === home || protectedPaths.some(p => absolute === p || absolute.startsWith(p + '/') || p.startsWith(absolute + '/'))) throw new Error('State path overlaps production');
  await mkdir(absolute, { recursive: true, mode: 0o700 }); await chmod(absolute, 0o700); return absolute;
}
