import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function createFixture({ sourceRoot, gatewayDelayMs = 0, harnessDelayMs = 0, stallMethod, timeoutMs = 2000, embeddedViewer = null } = {}) {
  const load = file => import(pathToFileURL(path.join(sourceRoot, 'tools/node-agent-api', file)).href);
  const [{ startNodeAgentApi }, { createCodexAdapter }, { createHarness }] = await Promise.all([load('server.mjs'), load('codex.mjs'), load('runtime/harness.mjs')]);
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-bench-')));
  await mkdir(path.join(directory, '.codex'), { mode: 0o700 });
  await writeFile(path.join(directory, '.codex/auth.json'), '{}', { mode: 0o600 });
  const binary = path.join(import.meta.dirname, 'fake-codex.mjs');
  await chmod(binary, 0o700);
  const counters = { ensure: 0, status: 0, validate: 0, turnStart: 0, threadResume: 0, spawn: 0, storeWrites: 0, realDockerCalls: 0, credentialShimLstat: 0, credentialShimSymlink: 0, credentialShimReadlink: 0, credentialLinksChecked: 0 };
  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => { const result = await originalRename(from, to); if (to === path.join(directory, 'api/sessions.json')) counters.storeWrites++; return result; };
  syncBuiltinESMExports();
  // Archived sources predate the explicit authFile option: their Harness falls
  // back to the process-homedir default auth path. Redirect exactly that path
  // to the fixture dummy file (setup only; measured logic untouched). The auth
  // file itself is only ever lstat-checked, never read, by prepareCodex.
  const realDefaultAuth = path.resolve(homedir(), '.codex/auth.json');
  const dummyAuth = path.join(directory, '.codex/auth.json');
  const originalLstat = fsPromises.lstat, originalSymlink = fsPromises.symlink, originalReadlink = fsPromises.readlink;
  const isDefaultAuth = value => typeof value === 'string' && path.resolve(value) === realDefaultAuth;
  fsPromises.lstat = async value => isDefaultAuth(value) ? (counters.credentialShimLstat++, originalLstat(dummyAuth)) : originalLstat(value);
  fsPromises.symlink = async (target, linkPath, type) => {
    if (isDefaultAuth(target) && typeof linkPath === 'string' && linkPath.startsWith(directory + path.sep)) {
      counters.credentialShimSymlink++;
      return originalSymlink(dummyAuth, linkPath, type);
    }
    return originalSymlink(target, linkPath, type);
  };
  fsPromises.readlink = async (value, options) => {
    const actual = await (options === undefined ? originalReadlink(value) : originalReadlink(value, options));
    if (typeof value === 'string' && value.startsWith(directory + path.sep) && typeof actual === 'string' && path.resolve(path.dirname(value), actual) === dummyAuth) {
      counters.credentialShimReadlink++;
      return realDefaultAuth;
    }
    return actual;
  };
  syncBuiltinESMExports();
  function restoreFs() { fsPromises.rename = originalRename; fsPromises.lstat = originalLstat; fsPromises.symlink = originalSymlink; fsPromises.readlink = originalReadlink; syncBuiltinESMExports(); }
  async function auditCredentialLinks() {
    let checked = 0; const violations = [];
    async function walk(dir) {
      for (const entry of await fsPromises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          checked++;
          if (path.resolve(path.dirname(full), await originalReadlink(full)) === realDefaultAuth) violations.push({ link: full });
        } else if (entry.isDirectory()) await walk(full);
      }
    }
    await walk(directory);
    return { symlinksChecked: checked, violations };
  }
  const stamps = { notifications: new Map(), turnDispatch: 0 };
  const children = new Set();
  const identity = { containerId: 'synthetic-container', containerStartedAt: 'synthetic-start', assignmentRevision: 'synthetic-assignment', display: 3 };
  const runtime = {
    shared: true,
    async ensure() { counters.ensure++; await delay(gatewayDelayMs); return { running: true, ...identity }; },
    async status() { counters.status++; await delay(gatewayDelayMs); return { running: true, exists: true, ...identity }; },
    async validateExecutor() { counters.validate++; await delay(gatewayDelayMs); return identity; },
    async descriptor() { return { version: 1, namespace: 'grok-node-lab-bench', environments: [{ transport: 'stdio', program: '/synthetic/never-executed', args: ['exec-server', 'stdio', '--no-new-privs'], ...identity }] }; },
    async close() {},
  };
  const harness = createHarness({ runtime, namespace: 'grok-node-lab-bench', stateRoot: directory, binary, timeoutMs, authFile: path.join(directory, '.codex/auth.json'),
    spawnProcess(_file, _args, options) {
      counters.spawn++;
      const child = spawn(process.execPath, [binary], { ...options, env: { ...options.env, BENCH_HARNESS_DELAY_MS: String(harnessDelayMs), BENCH_STALL_METHOD: stallMethod ?? '' } });
      children.add(child); child.once('exit', () => children.delete(child));
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (data, ...args) => {
        const message = JSON.parse(data);
        if (message.method === 'turn/start') { counters.turnStart++; stamps.turnDispatch = performance.now(); }
        if (message.method === 'thread/resume') counters.threadResume++;
        return write(data, ...args);
      };
      return child;
    },
  });
  harness.subscribe(({ message }) => {
    const id = message.params?.itemId;
    if (id) stamps.notifications.set(id, performance.now());
  });
  const bot = { object: 'node.agent', id: 'bench-bot', name: 'Synthetic benchmark', description: '', backend: 'codex_harness' };
  const roster = { agents: async () => [bot], requireAgent: async id => { assert.equal(id, bot.id); return bot; } };
  const adapter = createCodexAdapter({ runtime, harness, roster, namespace: 'grok-node-lab-bench', stateRoot: directory, artifactRoot: path.join(directory, 'artifacts') });
  let store;
  const attach = adapter.attachStore.bind(adapter);
  adapter.attachStore = value => {
    store = value;
    return attach(value);
  };
  let service;
  try { service = await startNodeAgentApi({ adapter, stateDirectory: path.join(directory, 'api'), governanceOptions: { limits: { requests: 10000 } }, embeddedViewer }); }
  catch (error) { await harness.close(); restoreFs(); await rm(directory, { recursive: true, force: true }); throw error; }
  const key = (await readFile(service.keyFile, 'utf8')).trim();
  async function call(method, route, body) {
    const response = await fetch(service.origin + route, { method, headers: { authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json() };
  }
  return {
    service, adapter, harness, runtime, counters, stamps, directory, key, call, get store() { return store; },
    async session() { const reply = await call('POST', '/v1/agents/sessions', { agent_id: bot.id }); assert.equal(reply.status, 201); return reply.data; },
    notify(message) { assert.equal(children.size, 1); [...children][0].stdin.write(JSON.stringify({ id: -1, method: 'bench/notify', params: message }) + '\n'); },
    async close() {
      const active = [...children];
      const exited = active.map(child => once(child, 'exit'));
      let credentialAudit = { symlinksChecked: 0, violations: [] };
      try {
        await service.close(); for (const child of active) if (child.exitCode === null && !child.killed) child.kill(); await Promise.all(exited);
        credentialAudit = await auditCredentialLinks();
        counters.credentialLinksChecked = credentialAudit.symlinksChecked;
        if (credentialAudit.violations.length) throw new Error('Fixture credential audit failed: a fixture symlink targets the real user credential path');
      }
      finally { restoreFs(); await rm(directory, { recursive: true, force: true }); }
      return { children: children.size, stateRemoved: true, credentialAudit };
    },
  };
}

export async function measureSample(f, session, index) {
  const before = { ...f.counters }, cpu = process.cpuUsage();
  const start = performance.now();
  const accepted = await f.call('POST', `/v1/agents/sessions/${session.id}/events`, { events: [{ type: 'message', text: 'synthetic benchmark' }], idempotency_key: 'bench-' + index });
  const acceptedAt = performance.now();
  assert.equal(accepted.status, 202);
  assert.equal(f.counters.turnStart - before.turnStart, 1);
  const itemId = 'item-' + index;
  const abort = new AbortController();
  const response = await fetch(`${f.service.origin}/v1/agents/sessions/${session.id}/events`, { headers: { authorization: 'Bearer ' + f.key, accept: 'text/event-stream' }, signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  f.notify({ method: 'item/agentMessage/delta', params: { threadId: session.thread_id, turnId: accepted.data.turn_id, itemId, delta: 'x' } });
  let text = '', receivedAt;
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    while (!text.includes('"itemId":"' + itemId + '"')) { const part = await reader.read(); assert.equal(part.done, false); text += new TextDecoder().decode(part.value); }
    receivedAt = performance.now();
    const persisted = JSON.parse(await readFile(path.join(f.directory, 'api/sessions.json'), 'utf8'));
    assert.ok(persisted.find(row => row.id === session.id).events.some(event => event.data?.params?.itemId === itemId));
  } finally { clearTimeout(timer); abort.abort(); await reader.cancel().catch(() => {}); }
  f.notify({ method: 'turn/completed', params: { threadId: session.thread_id, turn: { id: accepted.data.turn_id, status: 'completed' } } });
  for (let attempt = 0; attempt < 1000 && f.store.get(session.id).task_status === 'running'; attempt++) { await delay(2); await f.adapter.flush(); }
  assert.equal(f.store.get(session.id).task_status, 'completed');
  const used = process.cpuUsage(cpu);
  return { localDispatchMs: f.stamps.turnDispatch - start, httpAcceptedMs: acceptedAt - start, notificationToSseClientMs: receivedAt - f.stamps.notifications.get(itemId), cpuMs: (used.user + used.system) / 1000, rssBytes: process.memoryUsage().rss, counters: Object.fromEntries(Object.keys(before).map(key => [key, f.counters[key] - before[key]])), durableBeforeObserved: true, exactlyOneTurn: true };
}
