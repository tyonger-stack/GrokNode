import { parseArgs } from 'node:util';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture, measureSample, delay } from './fixture.mjs';

export function summarize(rows) {
  const metrics = {};
  for (const name of ['localDispatchMs', 'httpAcceptedMs', 'notificationToSseClientMs', 'cpuMs', 'rssBytes']) {
    const values = rows.map(row => row[name]).filter(Number.isFinite).sort((a, b) => a - b);
    metrics[name] = { samples: values.length, p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null, min: values[0] ?? null, max: values.at(-1) ?? null };
  }
  return metrics;
}

export async function sourceIdentity(root) {
  const names = ['server.mjs', 'codex.mjs', 'runtime/harness.mjs', 'runtime/codex.mjs', 'store.mjs', 'persistence.mjs', 'shared-runtime.mjs', 'grok-node.mjs', 'desktop.mjs', 'web/app.js', 'web/client.js'];
  const hashes = {};
  for (const name of names) hashes[name] = createHash('sha256').update(await readFile(path.join(root, 'tools/node-agent-api', name))).digest('hex');
  let revision = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Archives are identified by file hashes. */ }
  return { root, revision, hashes };
}

export async function writeEvidence(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
}

async function worker(options) {
  const f = await createFixture(options);
  const rows = [], failures = [];
  let cleanup;
  try {
    const session = await f.session();
    if (options.scenario === 'timeout') {
      const route = `/v1/agents/sessions/${session.id}/events`;
      const body = { events: [{ type: 'message', text: 'synthetic timeout' }], idempotency_key: 'bench-timeout' };
      assert.equal((await f.call('POST', route, body)).status, 500);
      await f.call('POST', route, body);
      assert.equal(f.counters.turnStart, 1);
      assert.equal(f.store.get(session.id).requests['bench-timeout'].status, 'unknown');
      rows.push({ unknown: true, turnStart: f.counters.turnStart });
    }
    for (let index = 0; index < options.warmup + options.samples; index++) {
      try { const row = await measureSample(f, session, index); if (index >= options.warmup) rows.push(row); }
      catch (error) { failures.push({ sample: index, code: error.code ?? error.name }); break; }
    }
    if (options.scenario === 'replay') {
      const replay = await f.call('POST', `/v1/agents/sessions/${session.id}/events`, { events: [{ type: 'message', text: 'synthetic benchmark' }], idempotency_key: 'bench-0' });
      assert.equal(replay.status, 202); assert.equal(replay.data.replayed, true); assert.equal(f.counters.turnStart, 1);
    }
  } finally { cleanup = await f.close(); }
  return { rows, failures, cleanup };
}

export async function runWorker(options) {
  const home = await syntheticHome();
  try { return await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let result, diagnostic = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Benchmark worker timeout')); }, 180000);
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-2000); });
    child.on('message', value => { result = value; });
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); if (code === 0 && result) resolve(result); else reject(new Error('Benchmark worker failed: ' + diagnostic)); });
    child.send(options);
  }); } finally { await rm(home, { recursive: true, force: true }); }
}

export async function syntheticHome() {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'node-agent-bench-home-')));
  await mkdir(path.join(home, '.codex'), { mode: 0o700 });
  await writeFile(path.join(home, '.codex/auth.json'), '{}', { mode: 0o600 });
  return home;
}

async function main() {
  const { values } = parseArgs({ options: { fixture: { type: 'boolean' }, 'read-only-live': { type: 'boolean' }, 'source-root': { type: 'string', default: path.resolve(import.meta.dirname, '../../..') }, 'cold-samples': { type: 'string', default: '30' }, 'warm-samples': { type: 'string', default: '100' }, output: { type: 'string' }, origin: { type: 'string', default: 'http://127.0.0.1:18770' }, 'key-file': { type: 'string' }, 'gateway-delay-ms': { type: 'string', default: '0' }, 'harness-delay-ms': { type: 'string', default: '0' } } });
  if (!values.output || Boolean(values.fixture) === Boolean(values['read-only-live'])) throw new Error('Choose --fixture or --read-only-live and --output');
  const cold = Number(values['cold-samples']), warm = Number(values['warm-samples']);
  if (![cold, warm].every(value => Number.isInteger(value) && value >= 0 && value <= 1000) || cold + warm === 0) throw new Error('Invalid sample count');
  const report = { schema: 1, at: new Date().toISOString(), invocation: process.argv.slice(1), node: process.version, platform: process.platform, architecture: process.arch, source: await sourceIdentity(values['source-root']), requested: { cold, warm }, failures: [], mode: values.fixture ? 'fixture' : 'read-only-live' };
  if (values['read-only-live']) {
    const origin = new URL(values.origin);
    if (origin.origin !== values.origin || origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || origin.username || origin.password) throw new Error('Loopback origin required');
    if (cold + warm > 10 || cold !== 0) throw new Error('Live reads require --cold-samples 0 and at most 10 warm samples; live cold cannot be controlled');
    const key = values['key-file'] ? (await readFile(values['key-file'], 'utf8')).trim() : null;
    report.definition = 'Low-frequency GET /health and authenticated GET /v1/agents only. No bodies, identifiers, credentials, viewer tickets, or model requests recorded.';
    report.observations = [];
    for (let i = 0; i < warm; i++) {
      for (const route of key ? ['/health', '/v1/agents'] : ['/health']) {
        const start = performance.now();
        const response = await fetch(values.origin + route, { headers: key ? { authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(30000) });
        const bytes = (await response.arrayBuffer()).byteLength;
        report.observations.push({ route, status: response.status, ms: performance.now() - start, bytes });
        if (!response.ok) report.failures.push({ route, status: response.status });
      }
      if (i + 1 < warm) await delay(1000);
    }
    report.limits = ['Observes already-running service; sourceRoot does not prove deployed revision.', 'At most ten samples; no high-confidence p95 or cold claim.'];
  } else {
    const options = { sourceRoot: values['source-root'], gatewayDelayMs: Number(values['gateway-delay-ms']), harnessDelayMs: Number(values['harness-delay-ms']) };
    report.configuration = options;
    report.configuration.fixtureRequestsPerMinute = 10000;
    report.configuration.authIsolation = 'Worker child env.HOME is a fresh synthetic directory containing empty auth JSON; parent environment unchanged. Candidate also receives explicit fixture authFile. Archived sources without authFile get a setup-only lstat/symlink/readlink redirect of exactly the default auth path to the fixture dummy (never read); close() audits every fixture symlink and fails on any target resolving to the real user credential path.';
    report.definitions = { cold: 'Fresh Node process, fresh private state, one synthetic session/thread; first turn after bind. Does not include process start or session bind.', warm: 'One process/session, five completed warmup turns, then serial measured turns; history grows identically in both revisions.', localDispatchMs: 'Client immediately before HTTP POST to real Harness child stdin turn/start write, same parent monotonic clock; includes loopback transit; excludes synthetic provider reply delay.', notificationToSseClientMs: 'Real Harness notification callback to SSE bytes observed by loopback client; includes persistence and network, not exact server write.', storeWrites: 'Successful rename of sessions.json atomic snapshots; no persistence bypass.', cpuMs: 'Parent process CPU only, child excluded.' };
    report.limits = ['Synthetic runtime identity/ensure/status seam; no real Docker or gateway timing.', 'Real HTTP, governance, adapter, store fsync/rename, Harness JSON-RPC child transport; fake Codex version endpoint, no model invocation.', 'Browser/RFB measurement is a separate artifact; iframe load and WebSocket open are not first paint.', 'This series is one active session and one delta per turn, not the 1/2/4-session 5000-delta stress matrix.'];
    report.cold = []; report.warm = []; report.cleanup = [];
    for (let i = 0; i < cold; i++) {
      const result = await runWorker({ ...options, warmup: 0, samples: 1 });
      report.cold.push(...result.rows); report.failures.push(...result.failures); report.cleanup.push(result.cleanup);
    }
    if (warm) { const result = await runWorker({ ...options, warmup: 5, samples: warm }); report.warm.push(...result.rows); report.failures.push(...result.failures); report.cleanup.push(result.cleanup); }
    report.credentialAudit = { workers: report.cleanup.length, symlinksChecked: report.cleanup.reduce((n, entry) => n + (entry.credentialAudit?.symlinksChecked ?? 0), 0), violations: report.cleanup.flatMap(entry => entry.credentialAudit?.violations ?? []), shimSymlinkRedirects: [...report.cold, ...report.warm].reduce((n, row) => n + (row.counters?.credentialShimSymlink ?? 0), 0) };
    if (report.credentialAudit.violations.length) report.failures.push({ code: 'credential_audit' });
    report.summary = { cold: summarize(report.cold), warm: summarize(report.warm) };
    report.failureRate = report.failures.length / (cold + warm);
    report.sourceAfter = await sourceIdentity(values['source-root']);
    report.sourceStable = JSON.stringify(report.source.hashes) === JSON.stringify(report.sourceAfter.hashes);
    if (!report.sourceStable) report.failures.push({ code: 'source_changed_during_measurement' });
  }
  await writeEvidence(path.resolve(values.output), report);
  console.log(JSON.stringify({ artifact: path.resolve(values.output), failures: report.failures.length, summary: report.summary }));
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[2] === '--worker') {
  process.once('message', async options => { try { process.send(await worker(options)); process.disconnect(); } catch (error) { console.error(error.stack); process.exitCode = 1; process.disconnect(); } });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
