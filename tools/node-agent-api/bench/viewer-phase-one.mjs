import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createFixture, delay } from './fixture.mjs';
import { createRfbFixture, pattern } from './rfb.mjs';
import { sourceIdentity, syntheticHome, writeEvidence } from './performance.mjs';

export const kinds = ['no-prewarm-first-open', 'prewarmed-open', 'repeat-open'];

export function summarizeSamples(samples) {
  return Object.fromEntries(kinds.map(kind => {
    const values = samples.filter(row => row.kind === kind).map(row => row.firstPixelMs).sort((a, b) => a - b);
    return [kind, { samples: values.length, p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null }];
  }));
}

export function verifyPixel(frame) {
  assert.equal(frame.width, pattern.width, 'real framebuffer width');
  assert.equal(frame.height, pattern.height, 'real framebuffer height');
  assert.deepEqual(frame.pixel, pattern.rgba, 'known RFB pattern decoded by the built noVNC bundle');
}

export function verifyReuse(before, after) {
  assert.equal(after.frameId, before.frameId, 'View must retain the same iframe');
  assert.equal(after.authorizations, before.authorizations, 'View must not authorize again');
  assert.equal(after.connections, before.connections, 'View must not open another upstream socket');
}

export function failureKind(error) {
  if (/SyntaxError|wasn't found|Raw channel missing property/.test(error.name + ' ' + error.message)) return 'benchmark';
  if (/listen EPERM|ENOENT/.test(error.message)) return 'environment';
  return /NavigationReadinessTimeout|BrowserClosed|TargetClosed|PipeClosed|CDP.*(?:closed|timeout)|readiness.*timeout/i.test(error.name + ' ' + error.message)
    ? 'browser-runtime' : 'product-or-contract';
}

// Installed before any product script. These observers retain native fetch and
// WebSocket behavior; the one response gate is used only for the cancellation race.
function instrumentation(expected) {
  window.__phaseSockets = [];
  window.__phaseErrors = [];
  addEventListener('error', event => window.__phaseErrors.push({ message: event.message, stack: event.error?.stack }));
  const Socket = window.WebSocket;
  window.WebSocket = new Proxy(Socket, {
    construct(target, args) { const socket = Reflect.construct(target, args); window.__phaseSockets.push(socket); return socket; },
  });
  if (window !== window.top) return;
  const b = window.__phase = { requests: [], messages: [], clicks: [], nextFrame: 0, gate: null };
  const ids = new WeakMap();
  b.id = frame => { if (!frame) return null; if (!ids.has(frame)) ids.set(frame, ++b.nextFrame); return ids.get(frame); };
  b.pixel = frame => {
    try {
      const canvas = frame?.contentDocument?.querySelector('canvas');
      if (!canvas || canvas.width !== expected.width || canvas.height !== expected.height) return null;
      return { width: canvas.width, height: canvas.height, pixel: Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data) };
    } catch { return null; }
  };
  const nativeFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
    const options = args[1] ?? {};
    if (url.origin !== location.origin || !/\/(desktop|handback|close)$/.test(url.pathname)) return nativeFetch(...args);
    const row = { path: url.pathname, method: options.method ?? 'GET', at: performance.now(), aborted: false };
    if (typeof options.body === 'string' && options.body.startsWith('{')) row.body = JSON.parse(options.body);
    b.requests.push(row);
    options.signal?.addEventListener('abort', () => { row.aborted = true; }, { once: true });
    try {
      const response = await nativeFetch(...args);
      row.status = response.status; row.responseAt = performance.now();
      if (b.gate && row.body?.existing_only === true) {
        const gate = b.gate; row.held = true;
        await new Promise(resolve => { gate.release = resolve; });
        row.released = true;
      }
      row.deliveredAt = performance.now();
      return response;
    } catch (error) { row.error = error.name; throw error; }
  };
  addEventListener('message', event => {
    if (event.data?.source !== 'node-agent-viewer') return;
    const frame = document.querySelector('#desktop iframe');
    const current = event.origin === location.origin && event.source === frame?.contentWindow;
    b.messages.push({ type: event.data.type, mode: event.data.mode, at: performance.now(), trusted: event.isTrusted,
      current, frameId: b.id(frame), ...(current && event.data.type === 'first-frame' ? { framebuffer: b.pixel(frame) } : {}) });
  });
  document.addEventListener('click', event => {
    if (!['view', 'control', 'handback'].includes(event.target.id) || event.target.disabled) return;
    const row = { button: event.target.id, at: performance.now(), done: false };
    b.clicks.push(row);
    const probe = () => {
      const frame = document.querySelector('#desktop iframe'), pixel = b.pixel(frame);
      if (frame && !frame.hidden && frame.getBoundingClientRect().width > 0 && pixel && JSON.stringify(pixel.pixel) === JSON.stringify(expected.rgba)) {
        Object.assign(row, { done: true, firstPixelMs: performance.now() - row.at, frameId: b.id(frame), ...pixel });
      } else if (performance.now() - row.at < 15000) requestAnimationFrame(probe);
    };
    // The product click handler runs before this animation-frame observation.
    requestAnimationFrame(probe);
  }, true);
}

async function sourceWithViewer(root) {
  const identity = await sourceIdentity(root);
  for (const name of ['viewer.mjs', 'web/viewer.js', 'web/viewer-frame.js']) {
    identity.hashes[name] = createHash('sha256').update(await readFile(path.join(root, 'tools/node-agent-api', name))).digest('hex');
  }
  const directory = path.join(root, '.lab/node-agent-viewer');
  identity.bundle = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  identity.bundle.sha256 = createHash('sha256').update(await readFile(path.join(directory, identity.bundle.file))).digest('hex');
  assert.equal(identity.bundle.file, `viewer-${identity.bundle.sha256}.js`);
  return identity;
}

async function runGroup({ root, omowright, browserPath, output, index, report }) {
  const { loadEmbeddedViewer } = await import(pathToFileURL(path.join(root, 'tools/node-agent-api/viewer.mjs')));
  const embeddedViewer = loadEmbeddedViewer({ directory: path.join(root, '.lab/node-agent-viewer') });
  assert.ok(embeddedViewer, 'Build .lab/node-agent-viewer before running this benchmark');
  const profile = await mkdtemp(path.join(tmpdir(), 'viewer-phase-one-chrome-'));
  const group = { index, checks: [], samples: [], artifacts: [], runtimeDesktop: [] };
  report.groups.push(group);
  let f, rfb, browser, page;
  let stage = 'setup';
  const save = () => writeEvidence(output, report);
  const check = async (scenario, observed) => { group.checks.push({ scenario, pass: true, observed }); await save(); };
  try {
    f = await createFixture({ sourceRoot: root, embeddedViewer });
    rfb = await createRfbFixture({ delayMs: 100 });
    f.runtime.desktop = async (_id, _target, mode, options) => {
      group.runtimeDesktop.push({ mode, prepare: options.prepare });
      return { object: 'node.environment', type: 'grok_node_codex', display: 3, websocketUrl: rfb.origin,
        containerGenerationImmutableId: 'synthetic-container', assignmentRevision: 'synthetic-assignment', containerStartedAt: 'synthetic-start', applicationId: null };
    };
    f.runtime.viewerAsset = async () => { throw new Error('Embedded benchmark must never use fallback viewer assets'); };
    const first = await f.session(), second = await f.session();
    browser = await omowright.connectPipe({ browserPath, browserArgs: ['--headless=new', '--no-first-run', '--disable-background-timer-throttling', '--user-data-dir=' + profile, '--window-size=1280,900'], storageRoot: profile });
    page = await browser.newTab('about:blank');
    await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${instrumentation.toString()})(${JSON.stringify(pattern)})` }, await page.resolveSessionId());
    group.wire = [];
    await page.cdp.send('Network.enable', {}, await page.resolveSessionId());
    for (const event of ['Network.webSocketFrameSent', 'Network.webSocketFrameReceived', 'Network.webSocketFrameError']) {
      page.cdp.on(event, data => group.wire.push({ event, opcode: data.response?.opcode, payload: data.response?.payloadData?.slice(0, 80), error: data.errorMessage }));
    }
    report.browser ??= await page.cdp.send('Browser.getVersion');
    const evaluate = expression => page.evaluate(expression);
    const wait = async (expression, label = expression) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await delay(25);
      }
      throw new Error('Product condition timeout: ' + label);
    };
    const state = async () => ({ ...await evaluate(`({ frameId: __phase.id(document.querySelector('#desktop iframe')), authorizations: __phase.requests.filter(r => r.path.endsWith('/desktop')).length })`), connections: rfb.counters.connections });
    const click = async button => {
      await wait(`!document.querySelector('#${button}').disabled`);
      await evaluate(`document.querySelector('#${button}').click()`);
      await wait('__phase.clicks.at(-1)?.done === true', button + ' visible decoded pixel');
      const row = await evaluate('__phase.clicks.at(-1)');
      verifyPixel(row);
      return row;
    };
    const capture = async name => {
      await evaluate("document.querySelector('#desktop').scrollIntoView()");
      const file = output.replace(/\.json$/, '') + `-${index}-${name}.png`;
      await writeFile(file, await page.screenshot({ fullPage: true }), { mode: 0o600 });
      assert.ok((await readFile(file)).length > 0);
      group.artifacts.push(file);
    };
    const select = id => evaluate(`document.querySelector('#sessions button[title=${JSON.stringify(id)}]').click()`);
    const remember = () => evaluate(`(() => { const frame = document.querySelector('#desktop iframe'); __phase.oldFrame = frame; __phase.oldWindow = frame.contentWindow; __phase.oldSockets = [...frame.contentWindow.__phaseSockets]; __phase.oldLane = frame.contentWindow.location.pathname.replace('vnc.html', ''); })()`);
    const observeDisposal = async label => {
      await wait('__phase.oldSockets.length > 0 && __phase.oldSockets.every(socket => socket.readyState === 3)', label + ' old socket closed');
      const closed = await evaluate(`fetch(__phase.oldLane + 'mandatory.json').then(response => response.status)`);
      assert.equal(closed, 401, label + ' old lane revoked');
      return { socketStates: await evaluate('__phase.oldSockets.map(socket => socket.readyState)'), oldLaneStatus: closed };
    };
    const open = async () => {
      await page.goto(f.service.origin + '/ui/');
      await wait("!!document.querySelector('#key')");
      await evaluate(`{ const key = document.querySelector('#key'); key.value = ${JSON.stringify(f.key)}; key.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#connect').click(); }`);
      await wait("document.querySelector('#bots').options.length === 2");
      await delay(450);
      assert.equal((await state()).authorizations, 0, 'key entry alone cannot prewarm');
      await evaluate("{ const bot = document.querySelector('#bots'); bot.value = 'bench-bot'; bot.dispatchEvent(new Event('change', { bubbles: true })); }");
      await wait("document.querySelectorAll('#sessions button').length === 2");
    };
    stage = 'no-prewarm-first-open';
    await open();
    // Activate the real View button in the first enabled microtask, before the
    // product's normal prewarm timer; do not alter product timers or code.
    await evaluate(`(() => { const view = document.querySelector('#view'); const observer = new MutationObserver(() => { if (!view.disabled) { observer.disconnect(); view.click(); } }); observer.observe(view, { attributes: true, attributeFilter: ['disabled'] }); })()`);
    await select(first.id);
    await wait('__phase.clicks.at(-1)?.done === true', 'first visible decoded framebuffer');
    const firstPixel = await evaluate('__phase.clicks.at(-1)');
    verifyPixel(firstPixel);
    await wait("__phase.messages.some(m => m.type === 'first-frame' && m.current && m.trusted)");
    const firstFrame = await evaluate("__phase.messages.find(m => m.type === 'first-frame' && m.current && m.trusted)");
    verifyPixel(firstFrame.framebuffer);
    const initialRequests = await evaluate('__phase.requests');
    assert.equal(initialRequests.filter(row => row.path.endsWith('/desktop')).length, 1);
    assert.equal(initialRequests[0].body.existing_only, undefined);
    assert.equal(rfb.counters.frames, 1);
    assert.equal(rfb.counters.connections, 1);
    const assets = await evaluate("Array.from(document.querySelector('#desktop iframe').contentDocument.scripts).filter(s => s.src).map(s => new URL(s.src).pathname.split('/').at(-1))");
    assert.deepEqual(assets, [report.source.bundle.file]);
    group.samples.push({ kind: stage, ...firstPixel, firstFrameMessageMs: firstFrame.at - firstPixel.at });
    await capture('first-frame');
    await check('genuine first framebuffer, pixel and built embedded bundle', { firstFrame, frames: rfb.counters.frames, assets, initialRequests });

    stage = 'repeat-open';
    const beforeRepeat = await state(), repeated = await click('view');
    await delay(450);
    const afterRepeat = await state();
    verifyReuse(beforeRepeat, afterRepeat);
    group.samples.push({ kind: stage, ...repeated });
    await check('View reuses connected iframe without authorization or upstream connection', { beforeRepeat, afterRepeat });

    stage = 'selection-disposes';
    await remember();
    await select(second.id);
    const disposal = await observeDisposal('selection');
    await wait("__phase.messages.some(m => m.type === 'first-frame' && m.current && m.frameId !== __phase.id(__phase.oldFrame))", 'new selection prewarm real framebuffer');
    await check('session selection disposes old RFB and revokes old lane', disposal);

    stage = 'stale-iframe-messages';
    const beforeStale = await state();
    const statusBefore = await evaluate("document.querySelector('#desktop-status').textContent");
    await evaluate(`(() => { for (const type of ['disconnected', 'ready', 'connected', 'first-frame']) dispatchEvent(new MessageEvent('message', { origin: location.origin, source: __phase.oldWindow, data: { source: 'node-agent-viewer', type, mode: 'view', expiresAt: 1 } })); })()`);
    await delay(100);
    verifyReuse(beforeStale, await state());
    assert.equal(await evaluate("document.querySelector('#desktop-status').textContent"), statusBefore);
    await click('view');
    verifyReuse(beforeStale, await state());
    await check('detached old iframe messages cannot change or dispose replacement', { beforeStale, after: await state(), statusUnchanged: true });

    stage = 'prewarmed-open';
    // A separate synthetic control lease must survive background prewarming.
    const issued = await f.call('POST', `/v1/agents/sessions/${first.id}/desktop`, { mode: 'control', replace_own_control: true });
    assert.equal(issued.status, 201);
    const redeemed = await fetch(issued.data.url, { redirect: 'manual' });
    assert.equal(redeemed.status, 303);
    const cookie = redeemed.headers.get('set-cookie').split(';')[0];
    const mandatory = new URL(redeemed.headers.get('location').replace('vnc.html', 'mandatory.json'), f.service.origin);
    const controlStatus = async () => {
      const response = await fetch(mandatory, { headers: { cookie } });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await controlStatus()).body.view_only, false);
    await open();
    const desktopBefore = group.runtimeDesktop.length;
    await select(first.id);
    await wait("__phase.messages.some(m => m.type === 'first-frame' && m.current && m.trusted)", 'hidden prewarm first-frame');
    const warmed = await state();
    const prewarmRequests = await evaluate('__phase.requests.filter(r => r.path.endsWith("/desktop"))');
    assert.equal(prewarmRequests.length, 1);
    assert.deepEqual(prewarmRequests[0].body, { mode: 'view', replace_own_control: false, existing_only: true });
    assert.equal(await evaluate("document.querySelector('#desktop iframe').hidden"), true);
    assert.ok(group.runtimeDesktop.slice(desktopBefore).length > 0);
    assert.ok(group.runtimeDesktop.slice(desktopBefore).every(row => row.prepare === false));
    const retainedControl = await controlStatus();
    assert.equal(retainedControl.status, 200);
    assert.equal(retainedControl.body.view_only, false);
    const prewarmed = await click('view');
    verifyReuse(warmed, await state());
    group.samples.push({ kind: stage, ...prewarmed, selectionPrewarmMs: (await evaluate("__phase.messages.find(m => m.type === 'first-frame' && m.current).at")) - prewarmRequests[0].at });
    await capture('prewarmed');
    await check('prewarm is existing_only, prepare=false and preserves existing control', { prewarmRequests, runtime: group.runtimeDesktop.slice(desktopBefore), retainedControl, before: warmed, after: await state() });

    stage = 'explicit-control-handback';
    await remember();
    const beforeControl = await state();
    await click('control');
    await wait("document.querySelector('#desktop iframe').title.includes('接管')");
    await wait("__phase.messages.some(m => m.mode === 'control' && m.type === 'first-frame' && m.current)");
    const afterControl = await state();
    assert.equal(afterControl.authorizations, beforeControl.authorizations + 1);
    assert.equal(afterControl.connections, beforeControl.connections + 1);
    assert.notEqual(afterControl.frameId, beforeControl.frameId);
    await observeDisposal('Control replacement');
    assert.equal((await controlStatus()).status, 401);
    const controlRequest = await evaluate('__phase.requests.filter(r => r.path.endsWith("/desktop")).at(-1)');
    assert.deepEqual(controlRequest.body, { mode: 'control', replace_own_control: true });
    const currentMandatory = () => evaluate("fetch(new URL('mandatory.json', document.querySelector('#desktop iframe').contentWindow.location.href)).then(async r => ({ status: r.status, body: await r.json() }))");
    assert.equal((await currentMandatory()).body.view_only, false);
    await remember();
    await click('handback');
    await wait("__phase.messages.some(m => m.mode === 'view' && m.type === 'first-frame' && m.current && m.frameId === __phase.id(document.querySelector('#desktop iframe')))");
    const released = await observeDisposal('Handback');
    const afterHandback = await state();
    assert.equal(afterHandback.authorizations, afterControl.authorizations + 1);
    assert.equal(afterHandback.connections, afterControl.connections + 1);
    assert.equal((await currentMandatory()).body.view_only, true);
    const transitions = await evaluate('__phase.requests.filter(r => r.path.endsWith("/desktop") || r.path.endsWith("/handback")).slice(-3)');
    assert.ok(transitions[1].path.endsWith('/handback'));
    assert.equal(transitions[1].status, 200);
    assert.ok(transitions[2].at >= transitions[1].deliveredAt, 'new View follows confirmed Handback');
    await check('Control freshly authorizes; confirmed Handback releases then reconnects view', { beforeControl, afterControl, afterHandback, transitions, released });

    stage = 'selection-cancels-prewarm';
    await evaluate('__phase.gate = {}');
    await select(second.id);
    await wait('__phase.requests.some(r => r.held)', 'real prewarm response held for selection race');
    await select(first.id);
    await wait("__phase.requests.find(r => r.held).aborted === true", 'selection abort signal');
    await evaluate('{ const gate = __phase.gate; __phase.gate = null; gate.release(); }');
    await wait("__phase.messages.some(m => m.type === 'first-frame' && m.current && m.frameId === __phase.id(document.querySelector('#desktop iframe')))");
    const held = await evaluate('__phase.requests.find(r => r.held)');
    assert.equal(held.released, true);
    const finalRequests = await evaluate('__phase.requests.filter(r => r.path.endsWith("/desktop"))');
    assert.ok(finalRequests.at(-1).path.includes(first.id));
    assert.equal(await evaluate("document.querySelectorAll('#desktop iframe').length"), 1);
    await check('selection cancels in-flight prewarm and ignores its late response', { held, currentRequest: finalRequests.at(-1), iframeCount: 1 });
    await remember();
    await evaluate("document.querySelector('#disconnect').click()");
    await observeDisposal('Disconnect');
    assert.equal(await evaluate("document.querySelectorAll('#desktop iframe').length"), 0);
    group.pass = true;
  } catch (error) {
    group.pass = false;
    report.failures.push({ index, stage, kind: failureKind(error), name: error.name, message: error.message });
    if (page) {
      try {
        group.diagnostic = await page.evaluate(`({ status: document.querySelector('#desktop-status')?.textContent, requests: window.__phase?.requests, messages: window.__phase?.messages, clicks: window.__phase?.clicks, errors: window.__phaseErrors, childErrors: document.querySelector('#desktop iframe')?.contentWindow?.__phaseErrors })`);
        const file = output.replace(/\.json$/, '') + `-${index}-failure.png`;
        await writeFile(file, await page.screenshot({ fullPage: true }), { mode: 0o600 });
        group.artifacts.push(file);
      } catch (diagnosticError) { group.diagnosticError = { name: diagnosticError.name, message: diagnosticError.message }; }
    }
  } finally {
    group.rfb = { ...rfb?.counters };
    group.fixtureCounters = { ...f?.counters };
    group.cleanup = {};
    for (const [name, cleanup] of [
      ['browserClosed', async () => { if (browser) await browser.close(); return true; }],
      ['fixture', async () => f ? f.close() : null],
      ['rfb', async () => rfb ? rfb.close() : null],
      ['profileRemoved', async () => { await rm(profile, { recursive: true, force: true }); await assert.rejects(access(profile), { code: 'ENOENT' }); return true; }],
    ]) {
      try { group.cleanup[name] = await cleanup(); }
      catch (error) { group.pass = false; report.failures.push({ index, stage: 'cleanup:' + name, kind: 'cleanup', message: error.message }); }
    }
    await save();
  }
}

async function main() {
  const { values } = parseArgs({ options: { loader: { type: 'string' }, output: { type: 'string' }, 'source-root': { type: 'string', default: path.resolve(import.meta.dirname, '../../..') }, samples: { type: 'string', default: '5' }, 'browser-path': { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } } });
  assert.ok(values.loader && values.output, '--loader (installed omowright loader) and --output required');
  const count = Number(values.samples);
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 100, '--samples must be an integer between 1 and 100');
  const output = path.resolve(values.output), root = path.resolve(values['source-root']);
  const report = { schema: 1, at: new Date().toISOString(), invocation: [process.execPath, ...process.argv.slice(1)], node: process.version, requestedSamplesPerKind: count, groups: [], failures: [],
    definitions: { 'no-prewarm-first-open': 'Fresh isolated Chromium profile and real API/fake-Codex fixture. Real View activates at first enabled microtask before prewarm; verified no existing_only request.', 'prewarmed-open': 'Same group browser after reload; wait for hidden genuine first-frame, then real View reveals the retained iframe.', 'repeat-open': 'Second explicit View on the first connected, unexpired read-only iframe.', firstPixelMs: 'Real button capture handler to next requestAnimationFrame with visible correctly decoded canvas pixels, same page performance clock.', selectionPrewarmMs: 'Background prewarm request dispatch to real first-frame message; excluded from prewarmed click latency.', quantiles: 'Nearest-rank p50/p95 over successful samples only; counts and failed stages retained independently.' },
    limits: ['Controlled Chromium, synthetic RFB pattern and fake Codex; no real credentials, models, Docker, live state or live leases.', 'In-page DOM button dispatch, not OS pointer latency. 100ms synthetic frame delay exercises handshake-versus-pixel distinction.', 'A held real HTTP response is used only for cancellation; no product source, timers or viewer events are replaced.', 'Small sample p95 is descriptive, not a production latency claim.'] };
  await writeEvidence(output, report);
  const onUnhandled = error => { report.failures.push({ stage: 'unhandled-rejection', kind: failureKind(error), name: error?.name, message: String(error?.message ?? error) }); };
  process.on('unhandledRejection', onUnhandled);
  try {
    report.source = await sourceWithViewer(root);
    const { loadOmowright } = await import(pathToFileURL(path.resolve(values.loader)));
    const { omowright } = await loadOmowright();
    for (let index = 0; index < count; index++) await runGroup({ root, omowright, browserPath: values['browser-path'], output, index, report });
    report.sourceAfter = await sourceWithViewer(root);
    report.sourceStable = JSON.stringify(report.source) === JSON.stringify(report.sourceAfter);
    if (!report.sourceStable) report.failures.push({ stage: 'source-stability', kind: 'environment', message: 'Sources or embedded bundle changed during run; rerun after workers settle.' });
  } catch (error) { report.failures.push({ stage: 'setup', kind: failureKind(error), name: error.name, message: error.message }); }
  report.summary = summarizeSamples(report.groups.flatMap(group => group.samples));
  report.pass = report.failures.length === 0 && report.groups.length === count && report.groups.every(group => group.pass)
    && kinds.every(kind => report.summary[kind].samples === count);
  await writeEvidence(output, report);
  process.off('unhandledRejection', onUnhandled);
  console.log(JSON.stringify({ artifact: output, pass: report.pass, summary: report.summary, failures: report.failures }));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  if (process.env.NODE_AGENT_PHASE_ONE_CHILD === '1') await main();
  else {
    const home = await syntheticHome();
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        const child = fork(import.meta.filename, process.argv.slice(2), { env: { ...process.env, HOME: home, NODE_AGENT_PHASE_ONE_CHILD: '1' }, stdio: 'inherit' });
        child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
      });
    } finally { await rm(home, { recursive: true, force: true }); }
  }
}
