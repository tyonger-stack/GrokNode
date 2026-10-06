import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory } from './runtime/common.mjs';
import { ApiError, badRequest, forbidden, identifier, object } from './errors.mjs';
import { atomicJson, readPrivateJson } from './persistence.mjs';

export const SCOPES = ['agents.read', 'agents.write', 'sessions.read', 'sessions.write', 'desktop.view', 'desktop.control', 'keys.manage'];
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export async function createAuth(directory, clock = Date.now) {
  await privateDirectory(directory);
  const keyFile = join(directory, 'owner.key'), storeFile = join(directory, 'keys.json'), usersFile = join(directory, 'users.json');
  async function privateFile(file) {
    try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe credential file'); await chmod(file, 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await privateFile(keyFile); await privateFile(storeFile); await privateFile(usersFile);
  let ownerKey;
  try { ownerKey = (await readFile(keyFile, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; ownerKey = secret(); await writeFile(keyFile, ownerKey + '\n', { flag: 'wx', mode: 0o600 }); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(ownerKey)) throw new Error('Invalid owner credential');
  const savedUsers = await readPrivateJson(usersFile, []);
  if (!Array.isArray(savedUsers) || savedUsers.some(u => !u || typeof u.id !== 'string' || !/^nuser_[a-f0-9]{24}$/.test(u.id) || typeof u.name !== 'string' || !u.name.trim() || u.name.length > 128 || /[\x00-\x1f\x7f]/.test(u.name) || !Number.isFinite(u.createdAt) || (u.disabledAt !== undefined && !Number.isFinite(u.disabledAt))) || new Set(savedUsers.map(u => u.id)).size !== savedUsers.length) throw new Error('Invalid API user store');
  let users = new Map(savedUsers.map(u => [u.id, u]));
  const saved = await readPrivateJson(storeFile, []);
  if (!Array.isArray(saved) || saved.some(k => !k || typeof k.id !== 'string' || !/^[a-f0-9]{64}$/.test(k.digest ?? '') || !Array.isArray(k.scopes) || k.scopes.some(s => !SCOPES.includes(s)) || !Array.isArray(k.botIds) || !Number.isFinite(k.expiresAt))) throw new Error('Invalid API credential store');
  if (new Set(saved.map(k => k.id)).size !== saved.length || saved.some(k => k.id === 'owner' || (k.user_id !== undefined && k.user_id !== 'owner' && !users.has(k.user_id)))) throw new Error('Invalid API credential subject');
  let keys = new Map(saved.map(k => [k.id, { ...k, user_id: k.user_id === undefined ? 'owner' : k.user_id }]));
  const owner = { id: 'owner', user_id: 'owner', digest: digest(ownerKey), scopes: SCOPES, botIds: ['*'], expiresAt: Infinity };
  await atomicJson(usersFile, savedUsers);
  let saving = Promise.resolve(), fault;
  // The service owns the directory lock. Serialize all auth mutations and publish only after fsync.
  function mutate(kind, operation) {
    const task = saving.then(async () => {
      if (fault) throw fault;
      const next = structuredClone(kind === 'keys' ? keys : users), result = operation(next);
      try { await atomicJson(kind === 'keys' ? storeFile : usersFile, [...next.values()]); }
      catch { fault = new ApiError(503, 'auth_persistence_failed', 'Reopen authentication after checking its state'); throw fault; }
      if (kind === 'keys') keys = next; else users = next;
      return result;
    });
    saving = task.catch(() => {});
    return task;
  }
  function active(principal, seen = new Set()) {
    if (fault || !principal) return false;
    if (principal.id === 'owner') return true;
    const current = keys.get(principal.id);
    if (!current || current.revokedAt !== undefined || current.expiresAt <= clock() || seen.has(current.id) || (current.user_id !== 'owner' && (!users.has(current.user_id) || users.get(current.user_id).disabledAt !== undefined))) return false;
    seen.add(current.id);
    return active({ id: current.parentId ?? 'owner' }, seen);
  }
  function descendant(record, parentId) {
    const seen = new Set();
    let current = record;
    while (current && !seen.has(current.id)) { seen.add(current.id); if (current.parentId === parentId) return true; current = keys.get(current.parentId); }
    return false;
  }
  function authenticate(header) {
    if (fault) throw fault;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized', 'Bearer credential required');
    const value = digest(header.slice(7));
    const principal = [owner, ...keys.values()].find(k => timingSafeEqual(Buffer.from(k.digest, 'hex'), Buffer.from(value, 'hex')) && active(k));
    if (!principal) throw new ApiError(401, 'unauthorized', 'Credential invalid or expired');
    return structuredClone(principal);
  }
  function currentPrincipal(principal) {
    if (fault) throw fault;
    const current = principal?.id === 'owner' ? owner : keys.get(principal?.id);
    if (!current || principal.digest !== current.digest || !active(current)) throw forbidden();
    return current;
  }
  function requireScope(principal, scope, botId) {
    principal = currentPrincipal(principal);
    if (!principal.scopes.includes(scope) || (botId && !principal.botIds.includes('*') && !principal.botIds.includes(botId))) throw forbidden();
  }
  function requireOwner(principal) { if (currentPrincipal(principal).id !== 'owner') throw forbidden(); }
  function managedKey(principal, id) {
    requireScope(principal, 'keys.manage'); identifier(id);
    if (id === 'owner') throw forbidden();
    const record = keys.get(id);
    if (!record) throw new ApiError(404, 'not_found', 'Credential not found');
    if (principal.id !== 'owner' && !descendant(record, principal.id)) throw forbidden();
    return record;
  }
  function keyResponse(record, value) {
    return { object: 'node.api_key', id: record.id, key: value, user_id: record.user_id, scopes: [...record.scopes], bot_ids: [...record.botIds], expires_at: Math.floor(record.expiresAt / 1000) };
  }
  function userResponse(user) {
    return { object: 'node.user', id: user.id, name: user.name, disabled: user.disabledAt !== undefined, ...(user.createdAt === undefined ? {} : { created_at: Math.floor(user.createdAt / 1000) }), ...(user.disabledAt === undefined ? {} : { disabled_at: Math.floor(user.disabledAt / 1000) }) };
  }
  return {
    keyFile, usersFile, authenticate, requireScope,
    async createUser(principal, input) {
      input = structuredClone(object(input, ['name']));
      return mutate('users', next => {
        requireOwner(principal);
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128 || /[\x00-\x1f\x7f]/.test(input.name)) throw badRequest('Invalid user name');
        const user = { id: 'nuser_' + randomBytes(12).toString('hex'), name: input.name.trim(), createdAt: clock() };
        next.set(user.id, user); return userResponse(user);
      });
    },
    listUsers(principal) { requireOwner(principal); return [userResponse({ id: 'owner', name: 'Owner' }), ...[...users.values()].map(userResponse)]; },
    disableUser(principal, id) {
      return mutate('users', next => {
        requireOwner(principal); identifier(id);
        if (id === 'owner') throw forbidden();
        const user = next.get(id);
        if (!user) throw new ApiError(404, 'not_found', 'User not found');
        user.disabledAt ??= clock(); return userResponse(user);
      });
    },
    async issue(principal, input) {
      input = structuredClone(input);
      return mutate('keys', next => {
        requireScope(principal, 'keys.manage'); principal = currentPrincipal(principal);
        const userId = input.user_id === undefined ? principal.user_id : identifier(input.user_id);
        if (principal.id !== 'owner' && userId !== principal.user_id) throw forbidden();
        if (userId !== 'owner' && (!users.has(userId) || users.get(userId).disabledAt !== undefined)) throw badRequest('User must be active');
        const scopes = input.scopes, botIds = input.bot_ids, ttl = input.ttl_seconds ?? 3600;
        if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(s => !SCOPES.includes(s) || !principal.scopes.includes(s)) || !Array.isArray(botIds) || botIds.length === 0 || !Number.isInteger(ttl) || ttl < 1 || ttl > 86400) throw badRequest('Invalid credential scope or lifetime');
        for (const id of botIds) { if (id !== '*') identifier(id); if (!principal.botIds.includes('*') && !principal.botIds.includes(id)) throw forbidden(); }
        const value = secret(), id = 'nkey_' + randomBytes(12).toString('hex');
        const record = { id, user_id: userId, parentId: principal.id, digest: digest(value), scopes: [...new Set(scopes)], botIds: [...new Set(botIds)], expiresAt: Math.min(clock() + ttl * 1000, principal.expiresAt) };
        next.set(id, record); return keyResponse(record, value);
      });
    },
    revoke(principal, id) { return mutate('keys', next => { managedKey(principal, id); next.get(id).revokedAt = clock(); return { id, revoked: true }; }); },
    rotateKey(principal, id) {
      return mutate('keys', next => {
        const previous = managedKey(principal, id);
        if (!active(previous)) throw new ApiError(409, 'key_inactive', 'Only active credentials can be rotated');
        const value = secret(), replacement = { ...structuredClone(previous), id: 'nkey_' + randomBytes(12).toString('hex'), digest: digest(value) };
        next.get(id).revokedAt = clock(); next.set(replacement.id, replacement);
        return keyResponse(replacement, value);
      });
    },
    active,
    async flush() { await saving; if (fault) throw fault; },
  };
}
