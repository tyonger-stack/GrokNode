import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import { createFixture, delay } from './fixture.mjs';
import { createRfbFixture, pattern } from './rfb.mjs';
import { sourceIdentity, writeEvidence, syntheticHome } from './performance.mjs';

if (process.env.NODE_AGENT_BENCH_BROWSER_CHILD !== '1') {
  const home = await syntheticHome();
  try {
    const code = await new Promise((resolve, reject) => {
      const child = fork(import.meta.filename, process.argv.slice(2), { env: { ...process.env, HOME: home, NODE_AGENT_BENCH_BROWSER_CHILD: '1' }, stdio: 'inherit' });
      child.once('error', reject); child.once('exit', resolve);
    });
    process.exitCode = code ?? 1;
  } finally { await rm(home, { recursive: true, force: true }); }
} else {

const { values } = parseArgs({ options: { 'source-root': { type: 'string' }, 'novnc-root': { type: 'string' }, loader: { type: 'string' }, output: { type: 'string' }, 'cold-samples': { type: 'string', default: '30' }, 'warm-samples': { type: 'string', default: '100' }, 'rfb-delay-ms': { type: 'string', default: '0' } } });
for (const name of ['source-root', 'novnc-root', 'loader', 'output']) assert.ok(values[name], '--' + name + ' required');
const { loadOmowright } = await import(pathToFileURL(values.loader));
const { omowright } = await loadOmowright();
const report = { schema: 1, invocation: process.argv.slice(1), source: await sourceIdentity(values['source-root']), at: new Date().toISOString(), node: process.version, novnc: JSON.parse(await readFile(path.join(values['novnc-root'], 'package.json'), 'utf8')).version, viewport: { width: 1280, height: 900 }, pattern, samples: [], failures: [], cleanup: [], definitions: { cold: 'Fresh isolated Chrome profile and real API/Harness fixture, existing bound synthetic session; first viewer click.', warm: 'Same isolated profile/service, five complete viewer warmups then repeated viewer clicks.', firstFrameMs: 'Capturing click handler on real View button to first rAF observing matching noVNC-decoded visible canvas pixels, same page performance clock.', dispatch: 'All interactions as in-page DOM operations; automation-client actionability waits time out intermittently on this live page. Timing starts at the real capturing View handler; setup steps untimed.' }, limits: ['Real product UI, noVNC, desktop HTTP authorization and WebSocket/RFB filter; synthetic runtime identity and upstream framebuffer.', 'No model, real desktop content, live state or lease changes. Runtime Docker preparation timings are excluded.'] };
const output = path.resolve(values.output);
await writeEvidence(output, report);

function summarizeSamples() { const out = {}; for (const kind of ['cold', 'warm']) { const rows = report.samples.filter(row => row.kind === kind).map(row => row.firstFrameMs).sort((a, b) => a - b); out[kind] = { samples: rows.length, p50: rows[Math.ceil(rows.length * .5) - 1] ?? null, p95: rows[Math.ceil(rows.length * .95) - 1] ?? null }; } return out; }

const groupSpec = process.env.NODE_AGENT_BENCH_BROWSER_GROUP ? JSON.parse(process.env.NODE_AGENT_BENCH_BROWSER_GROUP) : null;
if (groupSpec) {
  const deliver = payload => new Promise(resolve => {
    if (typeof process.send === 'function') { try { process.send(payload, resolve); return; } catch {} }
    console.error('group-result ' + JSON.stringify(payload).slice(0, 2000));
    resolve();
  });
  try {
    await group(groupSpec.count, groupSpec.warmup, groupSpec.kind);
    let firstFrame = null;
    if (report.samples.length) { try { firstFrame = (await readFile(path.join(path.dirname(output), 'first-frame.png'))).toString('base64'); } catch {} }
    await deliver({ ok: true, samples: report.samples, rfb: report.rfbCounters ?? {}, cleanup: report.cleanup, viewport: report.viewport, browser: report.browser, firstFrame });
  } catch (error) {
    await deliver({ ok: false, code: error.name, message: error.message, stack: String(error.stack).split('\n').slice(0, 8).join('\n') });
    process.exitCode = 1;
  }
  if (process.connected) process.disconnect();
  process.exit(process.exitCode ?? 0);
}

async function group(count, warmup, kind) {
  const f = await createFixture({ sourceRoot: values['source-root'] });
  const rfb = await createRfbFixture({ delayMs: Number(values['rfb-delay-ms']) });
  const profile = await mkdtemp(path.join(tmpdir(), 'node-agent-bench-chrome-'));
  let browser;
  try {
    f.runtime.desktop = async () => ({ object: 'node.environment', type: 'grok_node_codex', display: 3, websocketUrl: rfb.origin, containerGenerationImmutableId: 'synthetic-container', assignmentRevision: 'synthetic-assignment', containerStartedAt: 'synthetic-start', applicationId: null });
    f.runtime.viewerAsset = async asset => { if (asset.split('/').includes('..')) throw new Error('Unsafe asset'); return readFile(path.join(values['novnc-root'], asset)); };
    await f.session();
    browser = await omowright.connectPipe({ browserPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless=new', '--no-first-run', '--disable-background-timer-throttling', '--user-data-dir=' + profile, '--window-size=1280,900'], storageRoot: profile });
    const page = await browser.newTab(f.service.origin + '/ui/');
    const describe = async () => ({ href: await page.evaluate('location.href'), ready: await page.evaluate('document.readyState'), hasKey: await page.evaluate("!!document.querySelector('#key')"), title: await page.evaluate('document.title'), body: String(await page.evaluate("document.body ? document.body.innerText : ''")).slice(0, 100) });
    const wait = async expression => { for (let i = 0; i < 300; i++) { try { if (await page.evaluate(expression)) return; } catch {} await delay(30); } throw new Error('Browser condition timeout: ' + expression + ' at ' + JSON.stringify(await describe())); };
    await page.goto(f.service.origin + '/ui/');
    await wait("!!document.querySelector('#key')");
    report.viewport = await page.evaluate('({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })');
    // All setup interactions run as in-page DOM operations: the automation
    // client's actionability/readiness waits intermittently time out on this
    // live-updating page (NavigationReadinessTimeoutError), while the measured
    // view activation is an in-page click whose timing starts at the real
    // capturing handler. None of these setup steps are timed.
    const act = expression => page.evaluate(expression);
    await act(`{ const el = document.querySelector('#key'); el.value = ${JSON.stringify(f.key)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await act("document.querySelector('#connect').click()");
    await wait("document.querySelector('#bots').options.length === 2");
    await act("{ const s = document.querySelector('#bots'); s.value = 'bench-bot'; s.dispatchEvent(new Event('change', { bubbles: true })); }");
    await wait("document.querySelectorAll('#sessions button').length === 1");
    await act("document.querySelector('#sessions button').click()");
    await wait("!document.querySelector('#view').disabled");
    report.browser = await page.cdp.send('Browser.getVersion');
    await page.evaluate(`(() => {
      document.querySelector('#view').addEventListener('click', () => {
        const previous = document.querySelector('#desktop iframe');
        window.benchFrame = { start: performance.now(), done: false };
        const probe = () => {
          const iframe = document.querySelector('#desktop iframe');
          const canvas = iframe && iframe !== previous && iframe.contentDocument?.querySelector('canvas');
          if (canvas && canvas.width === ${pattern.width} && canvas.height === ${pattern.height} && canvas.getBoundingClientRect().width > 0) {
            const pixel = Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data);
            if (JSON.stringify(pixel) === '${JSON.stringify(pattern.rgba)}') { window.benchFrame = { done: true, ms: performance.now() - window.benchFrame.start, pixel }; return; }
          }
          requestAnimationFrame(probe);
        }; requestAnimationFrame(probe);
      }, { capture: true });
    })()`);
    for (let i = 0; i < count + warmup; i++) {
      await wait("!document.querySelector('#view').disabled");
      // In-page click dispatch: the iframe navigation trips the automation
      // client's navigation-readiness wait; timing still starts at the real
      // capturing View-button handler, so the measured path is unchanged.
      await page.evaluate("document.querySelector('#view').click()");
      await wait('window.benchFrame?.done === true');
      const frame = await page.evaluate('window.benchFrame');
      assert.deepEqual(frame.pixel, pattern.rgba);
      if (i >= warmup) report.samples.push({ kind, firstFrameMs: frame.ms, pixel: frame.pixel });
      if (report.samples.length === 1) {
        await page.evaluate("document.querySelector('#desktop').scrollIntoView()");
        await writeFile(path.join(path.dirname(output), 'first-frame.png'), await page.screenshot({ fullPage: true }), { mode: 0o600 });
    }
    }
    report.rfbCounters = { ...rfb.counters };
    report.summary = summarizeSamples();
    await writeEvidence(output, report);
  } finally {
    if (browser) await browser.close();
    await rm(profile, { recursive: true, force: true });
    report.cleanup.push({ fixture: await f.close(), rfb: await rfb.close(), profileRemoved: true });
  }
}

// Each measurement group runs in its own grandchild process: the automation
// client's page-readiness wait intermittently raises an unhandled rejection
// that escapes in-process try/catch and would otherwise lose the whole series.
// A crashed group is recorded with its kind/index and the series continues.
async function runGroup(count, warmup, kind, index) {
  const trace = message => console.error(`[bench-parent ${new Date().toISOString()} ${kind}#${index}] ${message}`);
  trace('forking group');
  const grandchild = fork(import.meta.filename, process.argv.slice(2), { env: { ...process.env, NODE_AGENT_BENCH_BROWSER_GROUP: JSON.stringify({ count, warmup, kind }) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  trace(`forked pid=${grandchild.pid} channel=${typeof grandchild.send}`);
  let result, diagnostic = '';
  const code = await new Promise(resolve => {
    const timer = setTimeout(() => { trace('grandchild timeout, killing'); grandchild.kill(); resolve('timeout'); }, 300000);
    grandchild.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-2000); });
    grandchild.on('message', value => { trace(`message ok=${value?.ok}`); result = value; });
    grandchild.on('error', error => { trace(`fork error: ${error.message}`); });
    grandchild.on('exit', (exitCode, signal) => { clearTimeout(timer); trace(`exit code=${exitCode} signal=${signal} haveResult=${!!result}`); resolve(exitCode); });
  });
  trace(`settled code=${code}`);
  if (code === 0 && result?.ok) {
    report.samples.push(...result.samples);
    report.cleanup.push(...result.cleanup);
    if (result.viewport && !report.measuredViewport) { report.viewport = result.viewport; report.measuredViewport = true; }
    if (result.browser && !report.measuredBrowser) { report.browser = result.browser; report.measuredBrowser = true; }
    for (const [key, value] of Object.entries(result.rfb)) report.rfbCounters = { ...(report.rfbCounters ?? {}), [key]: (report.rfbCounters?.[key] ?? 0) + value };
    if (result.firstFrame && !report.firstFrame) {
      await writeFile(path.join(path.dirname(output), 'first-frame.png'), Buffer.from(result.firstFrame, 'base64'), { mode: 0o600 });
      report.firstFrame = true;
    }
  } else {
    report.failures.push({ kind, index, code: result?.ok === false ? result.code : 'group_crash', message: (result?.message ?? diagnostic).slice(0, 500) });
  }
  report.summary = summarizeSamples();
  await writeEvidence(output, report);
}
process.on('unhandledRejection', error => { console.error('unhandled:', error?.message); process.exitCode = 1; });
try {
  for (let i = 0; i < Number(values['cold-samples']); i++) await runGroup(1, 0, 'cold', i);
  if (Number(values['warm-samples'])) await runGroup(Number(values['warm-samples']), 5, 'warm', 0);
} catch (error) { report.failures.push({ code: error.name, message: error.message, stack: String(error.stack).split('\n').slice(0, 6).join('\n') }); }
report.summary = {};
for (const kind of ['cold', 'warm']) { const rows = report.samples.filter(row => row.kind === kind).map(row => row.firstFrameMs).sort((a,b) => a-b); report.summary[kind] = { samples: rows.length, p50: rows[Math.ceil(rows.length * .5) - 1] ?? null, p95: rows[Math.ceil(rows.length * .95) - 1] ?? null }; }
report.sourceAfter = await sourceIdentity(values['source-root']);
report.sourceStable = JSON.stringify(report.source.hashes) === JSON.stringify(report.sourceAfter.hashes);
if (!report.sourceStable) report.failures.push({ code: 'source_changed_during_measurement' });
await writeEvidence(output, report);
console.log(JSON.stringify({ artifact: output, summary: report.summary, failures: report.failures }));
if (report.failures.length) process.exitCode = 1;
}
