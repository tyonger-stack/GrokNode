import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { failureKind, kinds, summarizeSamples, verifyPixel, verifyReuse } from '../tools/node-agent-api/bench/viewer-phase-one.mjs';
import { pattern } from '../tools/node-agent-api/bench/rfb.mjs';

test('browser oracle rejects blank/incorrect pixels and wrong framebuffer dimensions', () => {
  const frame = { width: pattern.width, height: pattern.height, pixel: [...pattern.rgba] };
  verifyPixel(frame);
  for (const changed of [{ pixel: [0, 0, 0, 255] }, { pixel: [37, 149, 211, 0] }, { width: 0 }, { height: 1 }]) {
    assert.throws(() => verifyPixel({ ...frame, ...changed }), assert.AssertionError);
  }
});

test('View reuse oracle independently rejects replacement, authorization and socket churn', () => {
  const before = { frameId: 1, authorizations: 1, connections: 1 };
  verifyReuse(before, { ...before });
  for (const key of Object.keys(before)) assert.throws(() => verifyReuse(before, { ...before, [key]: 2 }), assert.AssertionError);
});

test('latency quantiles keep unprewarmed, prewarmed and repeat samples separate', () => {
  const rows = [40, 10, 30, 20].map(firstPixelMs => ({ kind: kinds[0], firstPixelMs }));
  rows.push({ kind: kinds[1], firstPixelMs: 2 });
  assert.deepEqual(summarizeSamples(rows), {
    'no-prewarm-first-open': { samples: 4, p50: 20, p95: 40 },
    'prewarmed-open': { samples: 1, p50: 2, p95: 2 },
    'repeat-open': { samples: 0, p50: null, p95: null },
  });
});

test('browser runtime failures never turn product assertions into transient passes', () => {
  assert.equal(failureKind({ name: 'NavigationReadinessTimeoutError', message: 'navigation' }), 'browser-runtime');
  assert.equal(failureKind(new Error('Product condition timeout: hidden prewarm first-frame')), 'product-or-contract');
  assert.equal(failureKind(new assert.AssertionError({ message: 'extra authorization' })), 'product-or-contract');
});

// Opt into the installed browser, without downloading dependencies:
// NODE_AGENT_VIEWER_BROWSER_LOADER=/installed/omowright.mjs node --test tests/node-agent-viewer-browser.test.mjs
// The CLI is also independently runnable with --loader, --output and --samples.
if (process.env.NODE_AGENT_VIEWER_BROWSER_LOADER) {
  test('controlled Chromium exercises real API, fake Codex, product UI and bundled noVNC', { timeout: 240000 }, async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const output = path.resolve(process.env.NODE_AGENT_VIEWER_BROWSER_OUTPUT ?? path.join(root, '.omo/evidence/viewer-phase-one-sidecar/browser-test.json'));
    await mkdir(path.dirname(output), { recursive: true });
    const args = [path.join(root, 'tools/node-agent-api/bench/viewer-phase-one.mjs'), '--loader', process.env.NODE_AGENT_VIEWER_BROWSER_LOADER, '--output', output, '--samples', '1'];
    let log = '';
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { log += data; });
      child.stderr.on('data', data => { log += data; });
      child.once('error', reject); child.once('exit', resolve);
    });
    await writeFile(output + '.log', log, { mode: 0o600 });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(code, 0, JSON.stringify(report.failures));
    assert.equal(report.pass, true);
    assert.equal(report.sourceStable, true);
    assert.deepEqual(report.failures, []);
    for (const kind of kinds) assert.equal(report.summary[kind].samples, 1);
    const [group] = report.groups;
    assert.equal(group.checks.length, 7);
    assert.ok(group.checks.every(check => check.pass));
    assert.equal(group.cleanup.browserClosed, true);
    assert.equal(group.cleanup.profileRemoved, true);
    assert.equal(group.cleanup.fixture.children, 0);
    assert.equal(group.cleanup.fixture.stateRemoved, true);
    assert.deepEqual(group.cleanup.fixture.credentialAudit.violations, []);
    assert.deepEqual(group.cleanup.rfb, { sockets: 0, timers: 0 });
    assert.equal(group.fixtureCounters.realDockerCalls, 0);
    assert.equal(group.fixtureCounters.turnStart, 0);
    assert.ok(group.artifacts.length >= 2);
    for (const artifact of group.artifacts) assert.ok((await stat(artifact)).size > 0);
  });
}
