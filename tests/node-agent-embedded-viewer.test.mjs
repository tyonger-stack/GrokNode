import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadEmbeddedViewer } from '../tools/node-agent-api/viewer.mjs';
import { observeFirstFrame } from '../tools/node-agent-api/web/viewer-frame.js';

async function artifacts(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'embedded-viewer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const body = Buffer.from('export const fixture = 1;');
  const file = 'viewer-' + createHash('sha256').update(body).digest('hex') + '.js';
  await writeFile(path.join(directory, file), body);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schema: 1, file, novncVersion: 'fixture' }));
  return { directory, file, body };
}

test('embedded viewer serves one hashed static resource and lane-specific authoritative configuration', async t => {
  const { directory, file, body } = await artifacts(t);
  const viewer = loadEmbeddedViewer({ directory });
  const html = viewer.html({ mode: 'view', expiresAt: 100000, socketPath: 'desktop/lane/fixture/socket' });
  assert.equal((html.match(/src=/g) ?? []).length, 1);
  assert.ok(html.includes('./' + file));
  const configuration = JSON.parse(/type="application\/json">(.*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(configuration, { mode: 'view', expiresAt: 100000, socketPath: '/desktop/lane/fixture/socket' });
  assert.deepEqual(viewer.asset(file).body, body);
  assert.equal(viewer.asset('../' + file), null);
  assert.equal(viewer.asset(file).cacheControl, 'private, max-age=31536000, immutable');
  assert.throws(() => viewer.html({ mode: 'view', expiresAt: 1, socketPath: '//other.invalid/socket' }));
  assert.throws(() => viewer.html({ mode: 'admin', expiresAt: 1, socketPath: 'desktop/lane/fixture/socket' }));
});

test('invalid or changed embedded build artifact fails checksum validation', async t => {
  const { directory, file } = await artifacts(t);
  await writeFile(path.join(directory, file), 'changed');
  assert.throws(() => loadEmbeddedViewer({ directory }), /checksum/);
});

test('missing build artifacts preserve fallback', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'embedded-viewer-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(loadEmbeddedViewer({ directory }), null);
});

function frameFixture() {
  const tasks = new Map(), reports = [];
  let sequence = 0, pending = false, rectResult = true, updateResult = true;
  const rfb = { _fb_width: 32, _fb_height: 24, _FBU: { encoding: 0, width: 32, height: 24 }, _display: { pending: () => pending }, _handleRect() { return rectResult; }, _framebufferUpdate() { this._handleRect(); return updateResult; } };
  const scheduler = { requestFrame(fn) { tasks.set(++sequence, fn); return sequence; }, cancelFrame(id) { tasks.delete(id); } };
  const stop = observeFirstFrame(rfb, value => reports.push(value), scheduler);
  const tick = () => { const wave = [...tasks.values()]; tasks.clear(); for (const task of wave) task(); };
  return { rfb, stop, tick, reports, setPending(value) { pending = value; }, setResults(rect, update) { rectResult = rect; updateResult = update; } };
}

test('first-frame excludes pseudo rectangles and incomplete updates, waits for display flush and reports once', () => {
  const f = frameFixture();
  f.rfb._FBU.encoding = -223; f.rfb._framebufferUpdate(); f.tick();
  assert.deepEqual(f.reports, []);
  f.rfb._FBU.encoding = 7; f.setResults(false, false); f.rfb._framebufferUpdate(); f.tick();
  assert.deepEqual(f.reports, []);
  f.setResults(true, false); f.rfb._framebufferUpdate(); f.tick();
  assert.deepEqual(f.reports, []);
  f.setResults(true, true); f.setPending(true); f.rfb._framebufferUpdate(); f.tick();
  assert.deepEqual(f.reports, []);
  f.setPending(false); f.tick();
  assert.deepEqual(f.reports, [{ width: 32, height: 24 }]);
  f.rfb._framebufferUpdate(); f.tick();
  assert.equal(f.reports.length, 1);
  f.stop();
});

test('disposal cancels outstanding first-frame reports', () => {
  const f = frameFixture();
  f.rfb._framebufferUpdate(); f.stop(); f.tick();
  assert.deepEqual(f.reports, []);
});
