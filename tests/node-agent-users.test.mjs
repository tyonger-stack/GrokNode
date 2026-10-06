import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, readFile, writeFile, stat, symlink, unlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuth, SCOPES } from '../tools/node-agent-api/auth.mjs';

const execute = promisify(execFile);
const moduleUrl = new URL('../tools/node-agent-api/auth.mjs', import.meta.url).href;
const denied = error => error.code === 'permission_denied' && error.status === 403;
const invalid = error => error.code === 'invalid_request' && error.status === 400;
const unauthorized = error => error.code === 'unauthorized' && error.status === 401;
const principal = (auth, issued) => auth.authenticate('Bearer ' + issued.key);
async function fixture(name, clock) {
  const base = process.env.NODE_AGENT_USERS_EVIDENCE_DIR ?? tmpdir();
  await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(join(base, 'users-' + name + '-')));
  const auth = await createAuth(directory, clock);
  const owner = auth.authenticate('Bearer ' + (await readFile(auth.keyFile, 'utf8')).trim());
  return { directory, auth, owner };
}
const grant = (user_id, bot = 'bot-a') => ({ user_id, scopes: ['keys.manage', 'agents.read', 'sessions.read'], bot_ids: [bot], ttl_seconds: 10 });

test('users: private persistent identities give two users distinct bot scopes and owner-only management', async () => {
  const { directory, auth, owner } = await fixture('isolation');
  const alice = await auth.createUser(owner, { name: 'Alice' });
  const bob = await auth.createUser(owner, { name: 'Bob' });
  assert.notEqual(alice.id, bob.id);
  const a = await auth.issue(owner, grant(alice.id));
  const b = await auth.issue(owner, grant(bob.id, 'bot-b'));
  const pa = principal(auth, a), pb = principal(auth, b);
  assert.equal(a.user_id, alice.id); assert.equal(pa.user_id, alice.id);
  assert.equal(b.user_id, bob.id); assert.equal(pb.user_id, bob.id);
  auth.requireScope(pa, 'agents.read', 'bot-a'); auth.requireScope(pb, 'agents.read', 'bot-b');
  assert.throws(() => auth.requireScope(pa, 'agents.read', 'bot-b'), denied);
  assert.throws(() => auth.requireScope(pb, 'agents.read', 'bot-a'), denied);
  await assert.rejects(auth.createUser(pa, { name: 'Intruder' }), denied);
  assert.throws(() => auth.listUsers(pa), denied);
  await assert.rejects(auth.disableUser(pa, bob.id), denied);
  const listed = auth.listUsers(owner);
  assert.deepEqual(listed.map(u => u.id), ['owner', alice.id, bob.id]);
  listed[1].name = 'mutated'; assert.equal(auth.listUsers(owner)[1].name, 'Alice');
  const raw = await readFile(auth.usersFile, 'utf8');
  assert.equal(JSON.parse(raw).length, 2);
  for (const token of [a.key, b.key, owner.digest]) assert.equal(raw.includes(token), false);
  assert.equal((await stat(auth.usersFile)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test('users: user switching, forged principal fields and scope expansion cannot escalate delegation', async () => {
  const { auth, owner } = await fixture('switching');
  const alice = await auth.createUser(owner, { name: 'Alice' }), bob = await auth.createUser(owner, { name: 'Bob' });
  const parent = await auth.issue(owner, grant(alice.id));
  const pa = principal(auth, parent);
  for (const user_id of [bob.id, 'owner']) await assert.rejects(auth.issue(pa, grant(user_id)), denied);
  const child = await auth.issue(pa, { scopes: ['agents.read'], bot_ids: ['bot-a'] });
  assert.equal(child.user_id, alice.id);
  const explicit = await auth.issue(pa, { ...grant(alice.id), scopes: ['agents.read'] });
  assert.equal(explicit.user_id, alice.id);
  pa.user_id = bob.id; pa.scopes.push('agents.write'); pa.botIds.push('bot-b');
  assert.equal((await auth.issue(pa, { scopes: ['agents.read'], bot_ids: ['bot-a'] })).user_id, alice.id);
  await assert.rejects(auth.issue(pa, { scopes: ['agents.write'], bot_ids: ['bot-a'] }), invalid);
  await assert.rejects(auth.issue(pa, { scopes: ['agents.read'], bot_ids: ['bot-b'] }), denied);
  assert.throws(() => auth.requireScope(pa, 'agents.write', 'bot-b'), denied);
  await assert.rejects(auth.createUser({ ...pa, id: 'owner' }, { name: 'Forged' }), denied);
  await assert.rejects(auth.issue(owner, grant('missing_user')), invalid);
});

test('users: disabling a user invalidates existing descendants and stale principals without affecting peers', async () => {
  const { auth, owner, directory } = await fixture('disabled');
  const alice = await auth.createUser(owner, { name: 'Alice' }), bob = await auth.createUser(owner, { name: 'Bob' });
  const parent = await auth.issue(owner, grant(alice.id)), peer = await auth.issue(owner, grant(bob.id, 'bot-b'));
  const pa = principal(auth, parent), child = await auth.issue(pa, grant(alice.id));
  const pc = principal(auth, child), grandchild = await auth.issue(pc, { scopes: ['agents.read'], bot_ids: ['bot-a'] });
  const disabled = await auth.disableUser(owner, alice.id);
  assert.equal(disabled.disabled, true);
  assert.deepEqual(await auth.disableUser(owner, alice.id), disabled);
  for (const key of [parent, child, grandchild]) assert.throws(() => principal(auth, key), unauthorized);
  assert.equal(auth.active(pa), false); assert.equal(auth.active(pc), false);
  assert.throws(() => auth.requireScope(pa, 'agents.read', 'bot-a'), denied);
  await assert.rejects(auth.issue(pa, grant(alice.id)), denied);
  await assert.rejects(auth.issue(owner, grant(alice.id)), invalid);
  await assert.rejects(auth.rotateKey(owner, parent.id), e => e.code === 'key_inactive');
  assert.equal(principal(auth, peer).user_id, bob.id);
  const reopened = await createAuth(directory);
  assert.throws(() => principal(reopened, parent), unauthorized);
  assert.equal(principal(reopened, peer).user_id, bob.id);
});

test('users: owner defaults and missing user_id records migrate without changing SCOPES or privileges', async () => {
  let now = 1000000;
  const { auth, owner, directory } = await fixture('migration', () => now);
  assert.deepEqual(SCOPES, ['agents.read', 'agents.write', 'sessions.read', 'sessions.write', 'desktop.view', 'desktop.control', 'keys.manage']);
  const parent = await auth.issue(owner, { scopes: ['keys.manage', 'agents.read'], bot_ids: ['bot-a'] });
  assert.equal(parent.user_id, 'owner'); assert.equal(parent.expires_at, 4600);
  const file = join(directory, 'keys.json'), saved = JSON.parse(await readFile(file, 'utf8'));
  for (const key of saved) { delete key.user_id; delete key.parentId; }
  await writeFile(file, JSON.stringify(saved)); await unlink(auth.usersFile);
  const reopened = await createAuth(directory, () => now), legacy = principal(reopened, parent);
  assert.equal(legacy.user_id, 'owner'); assert.equal(legacy.id, parent.id);
  const child = await reopened.issue(legacy, { scopes: ['agents.read'], bot_ids: ['bot-a'], ttl_seconds: 86400 });
  assert.equal(child.user_id, 'owner'); assert.equal(child.expires_at, parent.expires_at);
  await assert.rejects(reopened.createUser(legacy, { name: 'NotOwner' }), denied);
  const next = await reopened.rotateKey(owner, parent.id);
  assert.equal(next.user_id, 'owner'); assert.equal(next.expires_at, parent.expires_at);
  assert.throws(() => principal(reopened, child), unauthorized);
  now += 3600000; assert.throws(() => principal(reopened, next), unauthorized);
});

test('users: rotation durably revokes old secret and descendants without extending scope, bots, user or expiry', async () => {
  let now = 1000000;
  const { auth, owner, directory } = await fixture('rotation', () => now);
  const alice = await auth.createUser(owner, { name: 'Alice' });
  const parent = await auth.issue(owner, grant(alice.id)), oldPrincipal = principal(auth, parent);
  const child = await auth.issue(oldPrincipal, grant(alice.id));
  now += 3000;
  const rotated = await auth.rotateKey(owner, parent.id);
  assert.notEqual(rotated.id, parent.id); assert.notEqual(rotated.key, parent.key);
  for (const field of ['user_id', 'scopes', 'bot_ids', 'expires_at']) assert.deepEqual(rotated[field], parent[field]);
  assert.throws(() => principal(auth, parent), unauthorized); assert.throws(() => principal(auth, child), unauthorized);
  assert.equal(auth.active(oldPrincipal), false);
  const nextPrincipal = principal(auth, rotated); auth.requireScope(nextPrincipal, 'agents.read', 'bot-a');
  assert.throws(() => auth.requireScope(nextPrincipal, 'agents.read', 'bot-b'), denied);
  const persisted = JSON.parse(await readFile(join(directory, 'keys.json'), 'utf8'));
  assert.equal(persisted.find(k => k.id === parent.id).revokedAt, now);
  assert.equal(persisted.find(k => k.id === rotated.id).parentId, 'owner');
  assert.equal(persisted.find(k => k.id === rotated.id).expiresAt, 1010000);
  for (const key of [parent, child, rotated]) assert.equal(JSON.stringify(persisted).includes(key.key), false);
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createAuth } from ${JSON.stringify(moduleUrl)};
    const auth = await createAuth(${JSON.stringify(directory)}, () => 1003000);
    assert.throws(() => auth.authenticate('Bearer ' + process.env.TEST_OLD_KEY), e => e.status === 401);
    assert.throws(() => auth.authenticate('Bearer ' + process.env.TEST_CHILD_KEY), e => e.status === 401);
    const p = auth.authenticate('Bearer ' + process.env.TEST_NEW_KEY);
    assert.equal(p.user_id, ${JSON.stringify(alice.id)}); assert.equal(p.expiresAt, 1010000);
    process.stdout.write(JSON.stringify({oldRejected:true,childRejected:true,newAccepted:true,user:p.user_id,expiresAt:p.expiresAt}));
  `], { env: { ...process.env, TEST_OLD_KEY: parent.key, TEST_NEW_KEY: rotated.key, TEST_CHILD_KEY: child.key } });
  assert.equal(JSON.parse(stdout).newAccepted, true);
  await writeFile(join(directory, 'restart-observation.json'), stdout);
  now = 1010000; assert.throws(() => principal(auth, rotated), unauthorized);
});

test('users: authorized managers rotate only active descendants and parent revocation still cascades', async () => {
  const { auth, owner } = await fixture('delegated-rotation');
  const alice = await auth.createUser(owner, { name: 'Alice' }), bob = await auth.createUser(owner, { name: 'Bob' });
  const manager = await auth.issue(owner, grant(alice.id)), peer = await auth.issue(owner, grant(bob.id, 'bot-b'));
  const p = principal(auth, manager), child = await auth.issue(p, { scopes: ['agents.read'], bot_ids: ['bot-a'] });
  const sibling = await auth.issue(owner, grant(alice.id));
  for (const id of [manager.id, peer.id, sibling.id, 'owner']) await assert.rejects(auth.rotateKey(p, id), denied);
  await assert.rejects(auth.rotateKey(principal(auth, child), manager.id), denied);
  const replacement = await auth.rotateKey(p, child.id);
  assert.equal(replacement.user_id, alice.id); assert.equal(replacement.expires_at, child.expires_at);
  assert.throws(() => principal(auth, child), unauthorized);
  assert.equal(principal(auth, replacement).parentId, manager.id);
  await assert.rejects(auth.rotateKey(p, child.id), e => e.code === 'key_inactive');
  await auth.revoke(owner, manager.id);
  assert.throws(() => principal(auth, replacement), unauthorized);
  await assert.rejects(auth.rotateKey(p, replacement.id), denied);
  assert.equal(principal(auth, peer).user_id, bob.id);
});

test('users: concurrent rotations yield one replacement and disable wins queued issuance', async () => {
  const { auth, owner, directory } = await fixture('concurrency');
  const alice = await auth.createUser(owner, { name: 'Alice' });
  const key = await auth.issue(owner, grant(alice.id));
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => auth.rotateKey(owner, key.id)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(r => r.status === 'rejected' && r.reason.code === 'key_inactive').length, 11);
  assert.equal(JSON.parse(await readFile(join(directory, 'keys.json'), 'utf8')).length, 2);
  const disabling = auth.disableUser(owner, alice.id);
  const issuance = auth.issue(owner, grant(alice.id));
  await disabling; await assert.rejects(issuance, invalid);
  const fresh = outcomes.find(r => r.status === 'fulfilled').value;
  assert.throws(() => principal(auth, fresh), unauthorized);
});

test('users: owner token and identity are immutable through management methods', async () => {
  const { auth, owner, directory } = await fixture('owner-protection');
  const before = await readFile(auth.keyFile, 'utf8');
  await assert.rejects(auth.rotateKey(owner, 'owner'), denied);
  await assert.rejects(auth.revoke(owner, 'owner'), denied);
  await assert.rejects(auth.disableUser(owner, 'owner'), denied);
  await assert.rejects(auth.createUser(owner, { name: 'Replacement', id: 'owner' }), invalid);
  for (const name of ['', '   ', 'x'.repeat(129), 'Alice\nInjected', 123]) await assert.rejects(auth.createUser(owner, { name }), invalid);
  await assert.rejects(auth.disableUser(owner, 'missing'), e => e.status === 404);
  assert.equal(await readFile(auth.keyFile, 'utf8'), before);
  const reopened = await createAuth(directory);
  assert.equal(reopened.authenticate('Bearer ' + before.trim()).id, 'owner');
  assert.equal(reopened.authenticate('Bearer ' + before.trim()).user_id, 'owner');
  assert.equal(reopened.listUsers(owner).length, 1);
});

test('users: corrupt and symlink user state fail closed and existing file permissions are repaired', async () => {
  const { auth, directory, owner } = await fixture('unsafe');
  await chmod(auth.usersFile, 0o644); await createAuth(directory);
  assert.equal((await stat(auth.usersFile)).mode & 0o777, 0o600);
  await writeFile(auth.usersFile, '{broken'); await assert.rejects(createAuth(directory), SyntaxError);
  await writeFile(auth.usersFile, JSON.stringify([{ id: 'owner', name: 'owner', createdAt: 0 }]));
  await assert.rejects(createAuth(directory), /Invalid API user store/);
  await unlink(auth.usersFile); const target = join(directory, 'target.json'); await writeFile(target, '[]');
  await symlink(target, auth.usersFile); await assert.rejects(createAuth(directory), /Unsafe credential file/);
  await assert.rejects(auth.createUser(owner, { name: 'Alice' }), e => e.code === 'auth_persistence_failed');
  assert.equal(await readFile(target, 'utf8'), '[]');
  assert.equal(auth.active(owner), false);
  assert.throws(() => auth.listUsers(owner), e => e.code === 'auth_persistence_failed');
});

test('users: failed rotation never publishes a replacement and reopening retains the prior durable key', async () => {
  const { auth, directory, owner } = await fixture('rotation-failure');
  const old = await auth.issue(owner, { scopes: ['agents.read'], bot_ids: ['bot-a'] });
  const file = join(directory, 'keys.json'), durable = await readFile(file, 'utf8');
  const target = join(directory, 'unchanged-keys.json'); await writeFile(target, durable);
  await unlink(file); await symlink(target, file);
  await assert.rejects(auth.rotateKey(owner, old.id), e => e.code === 'auth_persistence_failed');
  assert.equal(await readFile(target, 'utf8'), durable);
  assert.throws(() => principal(auth, old), e => e.code === 'auth_persistence_failed');
  await assert.rejects(auth.flush(), e => e.code === 'auth_persistence_failed');
  await unlink(file); await writeFile(file, durable, { mode: 0o600 });
  const reopened = await createAuth(directory);
  assert.equal(principal(reopened, old).id, old.id);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1);
});
