import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const bundle = await build({ stdin: { contents: `export * from './source/host/extensions/memory/local-user-profile.ts'; export * from './source/host/extensions/session/agent-db.ts';`, resolveDir: root }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const instruction = '以后请用中文';
const conversations = Array.from({ length: 4 }, (_, i) => `human-${i}`);
const candidate = (text, quote = instruction) => ({ section: 'workstyle', text, sources: conversations.map(conversationId => ({ conversationId, messageId: 'u1', quote })) });
const approve = (claim, overrides = {}) => ({ id: claim.id, decision: 'accept', basis: 'repeated_evidence', supportedSources: claim.sources.map((_, i) => i), lastingScope: { sourceIndex: 0, quote: instruction }, corrections: claim.sources.map((source, sourceIndex) => ({ sourceIndex, quote: source.quote })), reason: 'Each full user message explicitly states the same lasting preference.', ...overrides });

async function fixture(t, propose, judge) {
  const dir = await mkdtemp(path.join(tmpdir(), 'profile-validation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbs = conversations.map(id => {
    const db = new m.SandAgentDb(path.join(dir, 'agents', id, 'store.db'));
    db.appendTranscriptEntry({ id: 'u1', kind: 'message', role: 'user', content: instruction, timestampMs: 100 });
    return db;
  });
  t.after(() => dbs.forEach(db => db.close()));
  let calls = 0;
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot: path.join(dir, 'agents'), generate: async (system, input) => {
    calls++;
    if (system.includes('LOCAL_USER_PROFILE_VERIFY')) return judge(JSON.parse(input));
    if (system.includes('only repair attempt')) return '{"claims":[]}';
    return JSON.stringify({ claims: propose });
  } });
  t.after(() => service.dispose());
  return { dir, service, calls: () => calls };
}

test('valid short Chinese citation survives beside malformed, invented and semantically rejected claims', async t => {
  const claims = [candidate('用户要求以后使用中文。'), { section: 42 }, candidate('invented', 'not in the source'), candidate('用户性格果断。')];
  const { dir, service, calls } = await fixture(t, claims, ({ claims: checked, conversations: evidence }) => {
    assert.equal(checked.length, 2);
    assert.equal(evidence[0].messages[0].content, instruction);
    return JSON.stringify({ verdicts: checked.map((claim, i) => approve(claim, i === 1 ? { decision: 'reject', basis: 'unsupported', supportedSources: [], reason: 'A language request does not establish personality.' } : {})) });
  });
  assert.equal(await service.refresh(), 'updated');
  assert.equal(calls(), 3);
  const saved = await readFile(m.localUserProfilePath(dir), 'utf8');
  assert.match(saved, /用户要求以后使用中文/);
  assert.doesNotMatch(saved, /果断|invented/);
});

test('one malformed or duplicate verdict cannot invalidate a different approved claim', async t => {
  const { dir, service } = await fixture(t, [candidate('valid'), candidate('duplicate'), candidate('malformed')], ({ claims }) => JSON.stringify({ verdicts: [approve(claims[0]), approve(claims[1]), approve(claims[1], { decision: 'reject' }), { id: claims[2].id, decision: 'accept' }] }));
  assert.equal(await service.refresh(), 'updated');
  const saved = await readFile(m.localUserProfilePath(dir), 'utf8');
  assert.match(saved, /- valid/);
  assert.doesNotMatch(saved, /- duplicate|- malformed/);
});

test('reviewer must support four distinct conversations for a repeated observation', async t => {
  const { dir, service } = await fixture(t, [candidate('unsupported')], ({ claims }) => JSON.stringify({ verdicts: [approve(claims[0], { supportedSources: [0, 1, 2] })] }));
  assert.equal(await service.refresh(), 'insufficient-evidence');
  assert.equal(m.readLocalUserProfile(dir), '');
});

test('no approval, unknown ID or an invalid review envelope cannot publish a profile', async t => {
  for (const reply of [{ verdicts: [] }, { verdicts: [{ id: 'other', decision: 'accept', basis: 'explicit_instruction', supportedSources: [0], reason: 'yes' }] }, {}]) {
    const { dir, service } = await fixture(t, [candidate('must not publish')], () => JSON.stringify(reply));
    assert.notEqual(await service.refresh(), 'updated');
    assert.equal(m.readLocalUserProfile(dir), '');
  }
});

test('explicit semantic approval can accept one directly stated preference without inventing four citations', async t => {
  const single = candidate('用户要求以后使用中文。');
  single.sources = single.sources.slice(0, 1);
  const { dir, service } = await fixture(t, [single], ({ claims }) => JSON.stringify({ verdicts: [approve(claims[0], { basis: 'explicit_instruction' })] }));
  assert.equal(await service.refresh(), 'updated');
  assert.match(m.readLocalUserProfile(dir), /以后使用中文/);
});

test('semantic rejection or verifier outage keeps the last successful profile', async t => {
  const { dir, service } = await fixture(t, [candidate('saved preference')], ({ claims }) => JSON.stringify({ verdicts: claims.map(claim => approve(claim)) }));
  assert.equal(await service.refresh(), 'updated');
  const before = await readFile(m.localUserProfilePath(dir), 'utf8');
  for (const mode of ['reject', 'outage', 'malformed']) {
    const next = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot: path.join(dir, 'agents'), now: () => Date.now() + m.LOCAL_PROFILE_REFRESH_MS + 100,
      generate: async (system, input) => {
        if (!system.includes('LOCAL_USER_PROFILE_VERIFY')) return JSON.stringify({ claims: [candidate('new unsupported preference')] });
        if (mode === 'outage') throw new Error('verifier unavailable');
        if (mode === 'malformed') return '{';
        return JSON.stringify({ verdicts: JSON.parse(input).claims.map(claim => approve(claim, { decision: 'reject', basis: 'unsupported', supportedSources: [] })) });
      },
    });
    t.after(() => next.dispose());
    const db = new m.SandAgentDb(path.join(dir, 'agents', 'human-0', 'store.db'));
    db.appendTranscriptEntry({ id: `change-${mode}`, kind: 'message', role: 'user', content: `Updated evidence ${mode}`, timestampMs: Date.now() });
    db.close();
    assert.equal(await next.refresh(), mode === 'reject' ? 'insufficient-evidence' : 'failed');
    assert.equal(await readFile(m.localUserProfilePath(dir), 'utf8'), before);
  }
});

test('a bounded citation repair recovers a mistyped message ID and still requires semantic approval', async t => {
  const { dir } = await fixture(t, [], () => '{}');
  const good = candidate('用户要求以后使用中文。');
  const bad = structuredClone(good);
  bad.sources[0].messageId = 'u';
  const stages = [];
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot: path.join(dir, 'agents'), generate: async (system, input) => {
    if (system.includes('LOCAL_USER_PROFILE_VERIFY')) { stages.push('review'); return JSON.stringify({ verdicts: JSON.parse(input).claims.map(claim => approve(claim)) }); }
    if (system.includes('only repair attempt')) { stages.push('repair'); assert.equal(JSON.parse(input).rejectedItems.length, 1); return JSON.stringify({ claims: [good] }); }
    stages.push('generate'); return JSON.stringify({ claims: [bad] });
  } });
  t.after(() => service.dispose());
  assert.equal(await service.refresh(), 'updated');
  assert.deepEqual(stages, ['generate', 'repair', 'review']);
  assert.match(m.readLocalUserProfile(dir), /以后使用中文/);
});

test('failed citation repair preserves structurally valid candidates for semantic review', async t => {
  const { dir } = await fixture(t, [], () => '{}');
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot: path.join(dir, 'agents'), generate: async (system, input) => {
    if (system.includes('LOCAL_USER_PROFILE_VERIFY')) return JSON.stringify({ verdicts: JSON.parse(input).claims.map(claim => approve(claim)) });
    if (system.includes('only repair attempt')) throw new Error('repair provider unavailable');
    return JSON.stringify({ claims: [candidate('valid survives'), { text: 42 }] });
  } });
  t.after(() => service.dispose());
  assert.equal(await service.refresh(), 'updated');
  assert.match(m.readLocalUserProfile(dir), /valid survives/);
});

test('semantic approvals without exact lasting-scope or correction evidence are rejected individually', async t => {
  const { dir, service } = await fixture(t, [candidate('good'), candidate('invented scope'), candidate('missing corrections')], ({ claims }) => JSON.stringify({ verdicts: [
    approve(claims[0], { basis: 'explicit_instruction' }),
    approve(claims[1], { basis: 'explicit_instruction', lastingScope: { sourceIndex: 0, quote: 'always do this' } }),
    approve(claims[2], { corrections: [] }),
  ] }));
  assert.equal(await service.refresh(), 'updated');
  const content = m.readLocalUserProfile(dir);
  assert.match(content, /- good/);
  assert.doesNotMatch(content, /invented scope|missing corrections/);
});

test('an exact semantic witness supplies the source index when the redundant index list is omitted', async t => {
  const { dir, service } = await fixture(t, [candidate('用户要求以后使用中文。')], ({ claims }) => {
    const verdict = approve(claims[0], { basis: 'explicit_instruction' });
    delete verdict.supportedSources;
    return JSON.stringify({ verdicts: [verdict] });
  });
  assert.equal(await service.refresh(), 'updated');
  assert.match(m.readLocalUserProfile(dir), /以后使用中文/);
});
