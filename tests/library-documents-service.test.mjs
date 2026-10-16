import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(root, 'source/host/extensions/library/catalog.ts'))};`,
      `export * from ${JSON.stringify(join(root, 'source/host/extensions/library/documents-service.ts'))};`,
      `export * from ${JSON.stringify(join(root, 'source/shared/library/schemas.ts'))};`,
    ].join('\n'),
    resolveDir: root,
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const modules = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { LibraryCatalog, createDocumentsService, documentSourcePath, deriveDocumentTitle,
  DocumentNotFoundError, DocumentReadOnlyError, DocumentRejectedError, DocumentVisibilityEchoError,
  LibraryCatalogError, libraryResultSchemas } = modules;

const origin = 'https://library.example.test';
const hash = source => createHash('sha256').update(source).digest('hex');
const keyOf = doc => ({ storeId: doc.locator.storeId, kind: 'document', objectId: doc.locator.documentId });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function delegateCatalog(catalog, overrides) {
  return Object.assign(Object.create(Object.getPrototypeOf(catalog)), catalog, overrides);
}

function fixture(t, serviceDefaults = {}) {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'library-documents-')));
  let catalog = new LibraryCatalog({ dataRoot, providerOrigin: origin });
  t.after(() => { catalog.close(); rmSync(dataRoot, { recursive: true, force: true }); });
  const alice = catalog.identity.createLocalPrincipal();
  const bob = catalog.identity.createLocalPrincipal(alice.accountId);
  const stranger = catalog.identity.createLocalPrincipal();
  for (const user of [alice, bob]) catalog.identity.assignTeam({ ...user, teamId: 'team-local' }, true);
  const storeId = `node-store:${randomUUID()}`;
  catalog.identity.registerStore({ accountId: alice.accountId, principalId: alice.principalId, storeId, teamId: 'team-local' });
  const context = (user, overrides = {}) => ({ ...catalog.identity.resolveCredential(user.credential, new AbortController().signal), ...overrides });
  const service = (options = {}) => createDocumentsService({ dataRoot, catalog, ...serviceDefaults, ...options });
  const seed = ({ source = '# Original\nbody\n', title = 'Original', visibility = 'private', createdAtMs = 1000, updatedAtMs = 2000, store = storeId, documentId = randomUUID() } = {}) => {
    const contentPath = documentSourcePath(store, documentId);
    const file = join(dataRoot, contentPath);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, source, { mode: 0o600 });
    const object = { storeId: store, kind: 'document', objectId: documentId, title, createdAtMs, updatedAtMs,
      visibility, contentPath, contentHash: hash(source), revision: 1 };
    const stored = catalog.upsertObject(context(alice), object);
    return { documentId, locator: { storeId: store, documentId }, file, object: stored };
  };
  return {
    dataRoot, alice, bob, stranger, storeId, context, service, seed,
    get catalog() { return catalog; },
    reopen() { catalog.close(); catalog = new LibraryCatalog({ dataRoot, providerOrigin: origin }); },
  };
}

test('owner loads content and edit right in parallel with real share state', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service();
  const alice = f.context(f.alice);
  const [read, right] = await Promise.all([
    service.getDocument({ locator: doc.locator }, alice),
    service.getDocumentEditRight({ locator: doc.locator }, alice),
  ]);
  assert.deepEqual(read, { locator: doc.locator, source: '# Original\nbody\n', share: { visibility: 'private', canShareToTeam: true } });
  assert.deepEqual(right, { locator: doc.locator, canEdit: true });
  assert.equal(libraryResultSchemas.getDocument.safeParse(read).success, true);
  assert.equal(libraryResultSchemas.getDocumentEditRight.safeParse(right).success, true);
});

test('team reader reads team-view content but every write reports the original read-only error', async t => {
  const f = fixture(t);
  const doc = f.seed({ visibility: 'team-view' });
  const service = f.service();
  const bob = f.context(f.bob);
  const [read, right] = await Promise.all([
    service.getDocument({ locator: doc.locator }, bob),
    service.getDocumentEditRight({ locator: doc.locator }, bob),
  ]);
  assert.equal(read.source, '# Original\nbody\n');
  assert.deepEqual(read.share, { visibility: 'team-view', canShareToTeam: false });
  assert.deepEqual(right, { locator: doc.locator, canEdit: false });
  await assert.rejects(service.saveDocument({ locator: doc.locator, source: '# Hijack\n' }, f.context(f.bob)),
    error => error.name === 'DocumentReadOnlyError' && error instanceof DocumentReadOnlyError &&
      error.code === 'read-only' && error.message === "Only the document's owner can edit it.");
  await assert.rejects(service.setDocumentVisibility({ locator: doc.locator, visibility: 'private' }, f.context(f.bob)),
    error => error.name === 'DocumentReadOnlyError' && error.message === "Only the document's owner can edit it.");
  assert.equal(readFileSync(doc.file, 'utf8'), '# Original\nbody\n');
  assert.equal(f.catalog.readObject(f.context(f.alice), keyOf(doc)).visibility, 'team-view');

  const privateDoc = f.seed();
  await assert.rejects(service.getDocument({ locator: privateDoc.locator }, f.context(f.bob)),
    error => error.name === 'DocumentNotFoundError' && error instanceof DocumentNotFoundError &&
      error.message === `Document ${privateDoc.documentId} was not found.`);
  assert.equal((await service.getDocumentEditRight({ locator: privateDoc.locator }, f.context(f.bob))).canEdit, false);
  await assert.rejects(service.saveDocument({ locator: privateDoc.locator, source: 'x' }, f.context(f.bob)),
    error => error.name === 'DocumentReadOnlyError');

  const stranger = f.context(f.stranger);
  await assert.rejects(service.getDocument({ locator: doc.locator }, stranger),
    error => error.name === 'DocumentNotFoundError');
  assert.equal((await service.getDocumentEditRight({ locator: doc.locator }, stranger)).canEdit, false);

  const missing = { storeId: `node-store:${randomUUID()}`, documentId: randomUUID() };
  await assert.rejects(service.saveDocument({ locator: missing, source: 'x' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError' && error.message === `Document ${missing.documentId} was not found.`);
  await assert.rejects(service.setDocumentVisibility({ locator: missing, visibility: 'private' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError');
});

test('save rewrites source atomically, updates the h1 title and revision, and keeps the original creation time', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service({ now: () => 5000 });
  const saved = await service.saveDocument({ locator: doc.locator, source: '\n\n#  New Title  \nupdated body\n' }, f.context(f.alice));
  assert.deepEqual(saved, { locator: doc.locator, title: 'New Title' });
  assert.equal(libraryResultSchemas.saveDocument.safeParse(saved).success, true);
  const stored = f.catalog.readObject(f.context(f.alice), keyOf(doc));
  assert.equal(stored.revision, 2);
  assert.equal(stored.title, 'New Title');
  assert.equal(stored.createdAtMs, 1000);
  assert.equal(stored.updatedAtMs, 5000);
  assert.equal(stored.contentHash, hash('\n\n#  New Title  \nupdated body\n'));
  assert.equal(readFileSync(doc.file, 'utf8'), '\n\n#  New Title  \nupdated body\n');
  assert.equal(statSync(doc.file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dirname(doc.file)).filter(name => name.includes('.tmp-')), []);
  const reread = await service.getDocument({ locator: doc.locator }, f.context(f.alice));
  assert.equal(reread.source, '\n\n#  New Title  \nupdated body\n');

  assert.equal(deriveDocumentTitle('text\n# Later\n'), null);
  assert.equal(deriveDocumentTitle('   \n# Trimmed  \nx'), 'Trimmed');
  assert.equal(deriveDocumentTitle('# \n'), null);
  assert.equal(deriveDocumentTitle(''), null);
  assert.equal(deriveDocumentTitle('#heading\n'), null);

  const kept = await service.saveDocument({ locator: doc.locator, source: 'no heading here\n' }, f.context(f.alice));
  assert.equal(kept.title, 'New Title');
  assert.equal(f.catalog.readObject(f.context(f.alice), keyOf(doc)).revision, 3);

  await assert.rejects(service.saveDocument({ locator: doc.locator, source: `# ${'x'.repeat(20000)}\n` }, f.context(f.alice)),
    error => error.name === 'DocumentRejectedError' && error instanceof DocumentRejectedError && error.code === 'rejected');
  assert.equal(readFileSync(doc.file, 'utf8'), 'no heading here\n');
  assert.equal(f.catalog.readObject(f.context(f.alice), keyOf(doc)).revision, 3);
});

test('concurrent saves on one document serialize through catalog revisions', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service();
  const [a, b] = await Promise.all([
    service.saveDocument({ locator: doc.locator, source: '# A\na\n' }, f.context(f.alice)),
    service.saveDocument({ locator: doc.locator, source: '# B\nb\n' }, f.context(f.alice)),
  ]);
  assert.deepEqual([a.title, b.title], ['A', 'B']);
  const stored = f.catalog.readObject(f.context(f.alice), keyOf(doc));
  assert.equal(stored.revision, 3);
  assert.equal(readFileSync(doc.file, 'utf8'), '# B\nb\n');
  assert.equal(stored.contentHash, hash('# B\nb\n'));
  assert.equal(stored.title, 'B');
});

test('visibility changes echo persisted state and unknown echoes throw the original error', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service();
  assert.equal(await service.setDocumentVisibility({ locator: doc.locator, visibility: 'team-view' }, f.context(f.alice)), 'team-view');
  const stored = f.catalog.readObject(f.context(f.alice), keyOf(doc));
  assert.equal(stored.visibility, 'team-view');
  assert.equal(stored.revision, 2);
  assert.equal((await service.getDocument({ locator: doc.locator }, f.context(f.bob))).source, '# Original\nbody\n');
  assert.equal(await service.setDocumentVisibility({ locator: doc.locator, visibility: 'private' }, f.context(f.alice)), 'private');
  assert.equal(f.catalog.readObject(f.context(f.alice), keyOf(doc)).revision, 3);
  await assert.rejects(service.getDocument({ locator: doc.locator }, f.context(f.bob)), /not found/);

  const corrupt = f.service({ catalog: delegateCatalog(f.catalog, {
    setVisibility: (context, key, visibility) => ({ ...f.catalog.setVisibility(context, key, visibility), visibility: 'public' }),
  }) });
  await assert.rejects(corrupt.setDocumentVisibility({ locator: doc.locator, visibility: 'team-view' }, f.context(f.alice)),
    error => error.name === 'DocumentVisibilityEchoError' && error instanceof DocumentVisibilityEchoError &&
      error.code === 'visibility-echo' && error.message === 'Document visibility echo was not recognized.');

  const swapped = f.service({ catalog: delegateCatalog(f.catalog, {
    setVisibility: (context, key, visibility) => ({ ...f.catalog.setVisibility(context, key, visibility), visibility: visibility === 'team-view' ? 'private' : 'team-view' }),
  }) });
  await assert.rejects(swapped.setDocumentVisibility({ locator: doc.locator, visibility: 'private' }, f.context(f.alice)),
    error => error.name === 'DocumentVisibilityEchoError');
});

test('team-view requires persisted team authority', async t => {
  const f = fixture(t);
  const solo = `node-store:${randomUUID()}`;
  f.catalog.identity.registerStore({ accountId: f.alice.accountId, principalId: f.alice.principalId, storeId: solo, teamId: null });
  const doc = f.seed({ store: solo });
  const service = f.service();
  const alice = f.context(f.alice);
  const read = await service.getDocument({ locator: doc.locator }, alice);
  assert.deepEqual(read.share, { visibility: 'private', canShareToTeam: false });
  await assert.rejects(service.setDocumentVisibility({ locator: doc.locator, visibility: 'team-view' }, alice),
    error => error.name === 'DocumentReadOnlyError' && error.message === "Only the document's owner can edit it.");
  const stored = f.catalog.readObject(f.context(f.alice), keyOf(doc));
  assert.equal(stored.visibility, 'private');
  assert.equal(stored.revision, 1);
});

test('group fallback runs only when the caller passed groupChatId and the catalog read is absent', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const calls = [];
  const readGroupChatDocument = async (args, context) => {
    calls.push({ args, accountId: context.principal.accountId });
    return args.groupChatId === 'group-1' ? { source: 'group copy' } : null;
  };
  const service = f.service({ readGroupChatDocument });
  const alice = f.context(f.alice);

  const normal = await service.getDocument({ locator: doc.locator, groupChatId: 'group-1' }, alice);
  assert.equal(normal.source, '# Original\nbody\n');
  assert.deepEqual(normal.share, { visibility: 'private', canShareToTeam: true });
  assert.equal('groupChatId' in normal, false);
  assert.equal(calls.length, 0);

  const absentId = randomUUID();
  const absent = { storeId: f.storeId, documentId: absentId };
  const group = await service.getDocument({ locator: absent, groupChatId: 'group-1' }, alice);
  assert.deepEqual(group, { locator: absent, source: 'group copy', share: null, groupChatId: 'group-1' });
  assert.equal(libraryResultSchemas.getDocument.safeParse(group).success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].accountId, f.alice.accountId);

  await assert.rejects(service.getDocument({ locator: absent }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError' && error.message === `Document ${absentId} was not found.`);
  assert.equal(calls.length, 1);

  await assert.rejects(service.getDocument({ locator: absent, groupChatId: 'group-x' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError');
  assert.equal(calls.length, 2);

  const plain = f.service();
  await assert.rejects(plain.getDocument({ locator: absent, groupChatId: 'group-1' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError');
});

test('edit-right cache dedups parallel reads and discards stale account-scope results', async t => {
  const f = fixture(t);
  const doc = f.seed();
  let scope = 'scope-a';
  let gate = deferred();
  let ownershipCalls = 0;
  const service = f.service({
    getAccountScope: () => scope,
    readStoreOwnership: async storeId => { ownershipCalls += 1; await gate.promise; return storeId === f.storeId; },
  });
  const alice = f.context(f.alice);
  const first = service.getDocumentEditRight({ locator: doc.locator }, alice);
  const second = service.getDocumentEditRight({ locator: doc.locator }, alice);
  assert.equal(ownershipCalls, 1);
  scope = 'scope-b';
  gate.resolve();
  assert.deepEqual(await first, { locator: doc.locator, canEdit: false });
  assert.deepEqual(await second, { locator: doc.locator, canEdit: false });

  gate = deferred();
  const third = service.getDocumentEditRight({ locator: doc.locator }, f.context(f.alice));
  assert.equal(ownershipCalls, 2);
  gate.resolve();
  assert.equal((await third).canEdit, true);
  const cached = await service.getDocumentEditRight({ locator: doc.locator }, f.context(f.alice));
  assert.equal(cached.canEdit, true);
  assert.equal(ownershipCalls, 2);

  const unknownStore = `node-store:${randomUUID()}`;
  gate = deferred();
  const miss = service.getDocumentEditRight({ locator: { storeId: unknownStore, documentId: doc.documentId } }, f.context(f.alice));
  gate.resolve();
  assert.equal((await miss).canEdit, false);
  assert.equal(ownershipCalls, 3);
  gate = deferred();
  const missAgain = service.getDocumentEditRight({ locator: { storeId: unknownStore, documentId: doc.documentId } }, f.context(f.alice));
  gate.resolve();
  assert.equal((await missAgain).canEdit, false);
  assert.equal(ownershipCalls, 4);

  let uncachedCalls = 0;
  const uncached = f.service({ getAccountScope: () => undefined,
    readStoreOwnership: async storeId => { uncachedCalls += 1; return storeId === f.storeId; } });
  await uncached.getDocumentEditRight({ locator: doc.locator }, f.context(f.alice));
  await uncached.getDocumentEditRight({ locator: doc.locator }, f.context(f.alice));
  assert.equal(uncachedCalls, 2);
});

test('content guards reject tampered bytes and symlinked files and failed commits restore the previous source', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service();
  const alice = f.context(f.alice);

  writeFileSync(doc.file, 'tampered', { mode: 0o600 });
  await assert.rejects(service.getDocument({ locator: doc.locator }, alice),
    error => error instanceof LibraryCatalogError && error.code === 'invalid' && /hash mismatch/i.test(error.message));
  writeFileSync(doc.file, '# Original\nbody\n', { mode: 0o600 });
  assert.equal((await service.getDocument({ locator: doc.locator }, f.context(f.alice))).source, '# Original\nbody\n');

  rmSync(doc.file);
  symlinkSync(join(f.dataRoot, 'library/catalog.db'), doc.file);
  await assert.rejects(service.getDocument({ locator: doc.locator }, f.context(f.alice)),
    error => error.name === 'AgentStorePathError' || (error instanceof LibraryCatalogError && error.code === 'path'));
  rmSync(doc.file);
  writeFileSync(doc.file, '# Original\nbody\n', { mode: 0o600 });

  const failing = f.service({ catalog: delegateCatalog(f.catalog, {
    upsertObject: () => { throw new LibraryCatalogError('denied', 'ownership revoked'); },
  }) });
  await assert.rejects(failing.saveDocument({ locator: doc.locator, source: '# Rejected save\n' }, f.context(f.alice)),
    error => error.name === 'DocumentReadOnlyError' && error.message === "Only the document's owner can edit it.");
  assert.equal(readFileSync(doc.file, 'utf8'), '# Original\nbody\n');
  assert.equal(f.catalog.readObject(f.context(f.alice), keyOf(doc)).revision, 1);
});

test('catalog-foreign document ids and aborted signals report the original errors', async t => {
  const f = fixture(t);
  const service = f.service();
  const legacy = { storeId: f.storeId, documentId: 'doc-legacy-01' };
  await assert.rejects(service.getDocument({ locator: legacy }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError' && error.message === 'Document doc-legacy-01 was not found.');
  await assert.rejects(service.saveDocument({ locator: legacy, source: 'x' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError' && error.message === 'Document doc-legacy-01 was not found.');
  await assert.rejects(service.setDocumentVisibility({ locator: legacy, visibility: 'private' }, f.context(f.alice)),
    error => error.name === 'DocumentNotFoundError');
  const doc = f.seed();
  const aborted = f.context(f.alice, { signal: AbortSignal.abort() });
  await assert.rejects(service.getDocument({ locator: doc.locator }, aborted), /abort/i);
  await assert.rejects(service.saveDocument({ locator: doc.locator, source: 'x' }, aborted), /abort/i);
  await assert.rejects(service.getDocumentEditRight({ locator: doc.locator }, aborted), /abort/i);
});

test('saved documents survive a catalog restart', async t => {
  const f = fixture(t);
  const doc = f.seed();
  const service = f.service();
  await service.saveDocument({ locator: doc.locator, source: '# Persisted\nbody\n' }, f.context(f.alice));
  assert.equal(await service.setDocumentVisibility({ locator: doc.locator, visibility: 'team-view' }, f.context(f.alice)), 'team-view');
  f.reopen();
  const restarted = f.service();
  const read = await restarted.getDocument({ locator: doc.locator }, f.context(f.alice));
  assert.equal(read.source, '# Persisted\nbody\n');
  assert.deepEqual(read.share, { visibility: 'team-view', canShareToTeam: true });
  assert.equal((await restarted.getDocumentEditRight({ locator: doc.locator }, f.context(f.alice))).canEdit, true);
  const bobRead = await restarted.getDocument({ locator: doc.locator }, f.context(f.bob));
  assert.equal(bobRead.source, '# Persisted\nbody\n');
  assert.deepEqual(bobRead.share, { visibility: 'team-view', canShareToTeam: false });
  assert.equal(statSync(doc.file).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(doc.file)).mode & 0o777, 0o700);
  assert.equal(hash(readFileSync(doc.file)), f.catalog.readObject(f.context(f.alice), keyOf(doc)).contentHash);
});
