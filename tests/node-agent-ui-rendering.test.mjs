import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPaintQueue, createRefresh } from '../tools/node-agent-api/web/client.js';

function clock() {
  let id = 0;
  const frames = new Map(), timers = new Map();
  return {
    frames, timers, isHidden: () => true,
    requestFrame: fn => { frames.set(++id, fn); return id; },
    cancelFrame: id => frames.delete(id),
    setTimer: fn => { timers.set(++id, fn); return id; },
    clearTimer: id => timers.delete(id),
    frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); },
    timer() { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); },
  };
}

test('5000 deltas in 300 frames paint each dirty item once per frame; flush and reset cancel callbacks', () => {
  const time = clock(), rows = new Map(), painted = [];
  const queue = createPaintQueue(() => { painted.push([...rows.values()].join('')); }, time);
  for (let frame = 0; frame < 300; frame++) {
    for (let i = Math.floor(frame * 5000 / 300); i < Math.floor((frame + 1) * 5000 / 300); i++) {
      rows.set('a', (rows.get('a') || '') + '文'); queue.schedule();
    }
    assert.equal(time.frames.size, 1); assert.equal(time.timers.size, 1);
    time.frame();
  }
  assert.equal(painted.length, 300); assert.equal(painted.at(-1), '文'.repeat(5000));
  queue.schedule(); queue.flush(); assert.equal(painted.length, 301);
  assert.equal(time.frames.size + time.timers.size, 0);
  queue.schedule(); const stale = [...time.frames.values()][0]; queue.reset(); stale();
  assert.equal(painted.length, 301);
  queue.schedule(); time.timer(); assert.equal(painted.length, 302);
  assert.equal(time.frames.size + time.timers.size, 0);
});

test('refresh requests coalesce, suppress stale snapshots, and drain trailing dirty updates', async () => {
  const barriers = [], applied = [];
  const refresh = createRefresh(async current => {
    const value = await new Promise(resolve => barriers.push(resolve));
    if (current()) applied.push(value);
  });
  const first = refresh();
  assert.equal(refresh(), first); assert.equal(refresh(), first);
  assert.equal(barriers.length, 1);
  barriers[0]('old'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(barriers.length, 2); assert.deepEqual(applied, []);
  refresh(); barriers[1]('middle'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(barriers.length, 3);
  barriers[2]('final'); await first; assert.deepEqual(applied, ['final']);
});

test('reset fences pending refreshes; failed dirty fetch still drains the final request', async () => {
  const barriers = [], applied = [];
  const refresh = createRefresh(async current => {
    const value = await new Promise((resolve, reject) => barriers.push({ resolve, reject }));
    if (current()) applied.push(value);
  });
  const old = refresh(); refresh(); refresh.reset();
  const next = refresh(); barriers[0].resolve('old session'); await old;
  barriers[1].resolve('new session'); await next;
  assert.deepEqual(applied, ['new session']); assert.equal(barriers.length, 2);
  const failure = refresh(); refresh(); barriers[2].reject(new Error('transient read'));
  await new Promise(resolve => setImmediate(resolve));
  barriers[3].resolve('latest'); await failure;
  assert.deepEqual(applied, ['new session', 'latest']);
  const finalFailure = refresh(); barriers[4].reject(new Error('final read failed'));
  await assert.rejects(finalFailure, /final read failed/);
});

const probe = `
const p = window.probe = { frame: 0, writes: [], latencies: [], arrivals: {}, parsed: [], formatted: 0, controls: 0, held: [], holdFrames: false, holdTimers: false };
p.itemsResponses = 0;
const fetcher = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await fetcher(...args);
  if (String(args[0]).includes('/items')) {
    const json = response.json.bind(response);
    response.json = async () => { const value = await json(); p.itemsResponses++; return value; };
  }
  return response;
};
const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
function tick() { p.frame++; raf(tick); } raf(tick);
window.requestAnimationFrame = fn => p.holdFrames ? (p.held.push(fn), -p.held.length) : raf(fn);
window.cancelAnimationFrame = id => { if (id >= 0) cancel(id); };
const timer = window.setTimeout.bind(window);
window.setTimeout = (fn, delay, ...args) => p.holdTimers && delay === 100 ? (p.held.push(fn), -p.held.length) : timer(fn, delay, ...args);
const parse = JSON.parse, stringify = JSON.stringify;
JSON.parse = (...args) => {
  const value = parse(...args);
  if (value?.id?.startsWith('evt_')) {
    p.parsed.push(value.id);
    const params = value.data?.params;
    if (params?.delta !== undefined) (p.arrivals[params.itemId] ??= []).push(performance.now());
  }
  return value;
};
JSON.stringify = (...args) => { if (args[0]?.id?.startsWith('evt_')) p.formatted++; return stringify(...args); };
const detached = new WeakMap();
function record(node, value, frame, at) {
  const label = node.parentElement?.querySelector('strong')?.textContent || '';
  if (label.startsWith('流式输出')) {
    const item = label.split(' · ').at(-1);
    p.writes.push({ item, frame, length: value.length });
    for (const arrived of p.arrivals[item] || []) p.latencies.push(at - arrived);
    delete p.arrivals[item];
  }
}
const append = Element.prototype.append;
Element.prototype.append = function(...nodes) {
  append.apply(this, nodes);
  for (const node of nodes) {
    const row = detached.get(node);
    if (row) { record(node, ...row); detached.delete(node); }
  }
};
const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
Object.defineProperty(Node.prototype, 'textContent', { ...descriptor, set(value) {
  if (this.tagName === 'PRE') {
    if (!this.parentElement) detached.set(this, [value, p.frame, performance.now()]);
    else record(this, value, p.frame, performance.now());
  }
  descriptor.set.call(this, value);
} });
const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
Object.defineProperty(HTMLButtonElement.prototype, 'disabled', { ...disabled, set(value) { p.controls++; disabled.set.call(this, value); } });
`;

if (process.env.NODE_AGENT_UI_BROWSER === '1') test('Chromium: burst, terminal, visibility, session epochs, dirty refreshes and cursor recovery', { timeout: 90000 }, async () => {
  const evidence = process.env.NODE_AGENT_UI_EVIDENCE;
  assert.ok(evidence); await mkdir(evidence, { recursive: true, mode: 0o700 });
  const { loadOmowright } = await import(pathToFileURL(process.env.NODE_AGENT_UI_BROWSER_LOADER).href);
  const { omowright } = await loadOmowright();
  const web = new URL('../tools/node-agent-api/web/', import.meta.url);
  const streams = new Map(), requests = [], pending = { items: [], actions: [] };
  const hold = { items: false, actions: false };
  let itemRows = [{ id: 'seed', role: 'assistant', text: 'Fixture history' }], actionRows = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/probe.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(probe); return; }
    if (url.pathname === '/' || /^\/(app\.js|client\.js|style\.css)$/.test(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      let body = await readFile(new URL(name, web), 'utf8');
      if (name === 'index.html') body = body.replace('<head>', '<head><script src="/probe.js"></script>');
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(body); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    requests.push({ method: req.method, path: url.pathname, cursor: req.headers['last-event-id'] || '', bearer: req.headers.authorization === 'Bearer rendering-fixture' });
    if (url.pathname === '/v1/capabilities') return json({ writes_enabled: true, events: { sse: true, cancellation: true, required_actions: true } });
    if (url.pathname === '/v1/agents') return json({ data: [{ id: 'bot', name: 'Rendering fixture' }] });
    if (url.pathname === '/v1/agents/sessions') return json({ data: ['s1', 's2'].map(id => ({ id, agent_id: 'bot', status: 'idle' })) });
    const id = url.pathname.split('/')[4], resource = url.pathname.split('/')[5];
    if (!resource) return json({ id, agent_id: 'bot', status: 'idle' });
    if (resource === 'items' || resource === 'actions') {
      if (hold[resource]) { pending[resource].push(rows => json({ data: rows })); return; }
      return json({ data: resource === 'items' ? itemRows : actionRows });
    }
    if (resource === 'events') {
      assert.equal(req.method, 'GET');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n');
      streams.set(id, res); req.on('close', () => { if (streams.get(id) === res) streams.delete(id); }); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'ui-rendering-'));
  let browser, sequence = 0;
  const observations = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async condition => { for (let i = 0; i < 200; i++) { if (await condition()) return; await pause(20); } assert.fail('fixture condition timed out'); };
  const emit = (type, data, session = 's1', fragmented = false) => {
    const id = 'evt_' + ++sequence;
    const bytes = Buffer.from(`id: ${id}\r\nevent: ${type}\r\ndata: ${JSON.stringify({ id, type, session_id: session, data })}\r\n\r\n`);
    if (fragmented) for (const byte of bytes) streams.get(session).write(Buffer.of(byte));
    else streams.get(session).write(bytes);
    return id;
  };
  const delta = (itemId, value, session, fragmented) => emit('node.harness.event', { method: 'item/agentMessage/delta', params: { itemId, delta: value } }, session, fragmented);
  try {
    browser = await omowright.connectPipe({ browserPath: process.env.NODE_AGENT_UI_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless=new', '--no-first-run', `--user-data-dir=${profile}`, '--window-size=1280,900'], storageRoot: profile });
    const page = await browser.newTab(`http://127.0.0.1:${server.address().port}`);
    const evaluate = expression => page.evaluate(expression);
    const wait = expression => until(() => evaluate(expression));
    await wait("document.getElementById('send').disabled");
    await page.locator('#key').fill('rendering-fixture'); await page.locator('#connect').click();
    await wait("document.getElementById('bots').options.length === 2");
    await page.locator('#bots').selectOption('bot');
    await wait("document.querySelectorAll('#sessions button').length === 2");
    await page.locator('#sessions button').first().click();
    await until(() => streams.has('s1'));
    emit('node.session.turn.started', { turn_id: 'turn-fixture' });
    await wait("!document.getElementById('cancel').disabled");
    await evaluate('probe.controls = 0');
    const start = performance.now();
    for (let batch = 0; batch < 250; batch++) {
      await pause(Math.max(0, start + batch * 20 - performance.now()));
      for (let i = 0; i < 20; i++) delta(i % 2 ? 'stream-b' : 'stream-a', '文🙂');
    }
    await wait("[...document.querySelectorAll('#transcript pre')].filter(n => n.textContent === '文🙂'.repeat(2500)).length === 2");
    const burst = await evaluate(`(() => {
      const counts = {};
      for (const row of probe.writes) counts[row.item + ':' + row.frame] = (counts[row.item + ':' + row.frame] || 0) + 1;
      const times = [...probe.latencies].sort((a,b) => a-b);
      return { deltas: times.length, writes: probe.writes.length, maxWritesPerItemFrame: Math.max(...Object.values(counts)), p95Ms: times[Math.ceil(times.length * .95)-1], controls: probe.controls, formattedFolded: probe.formatted, text: [...document.querySelectorAll('#transcript pre')].map(n => n.textContent) };
    })()`);
    await writeFile(join(evidence, 'dom-burst.json'), JSON.stringify(burst, null, 2));
    assert.equal(burst.deltas, 5000); assert.equal(burst.maxWritesPerItemFrame, 1);
    assert.equal(burst.controls, 0); assert.equal(burst.formattedFolded, 0);
    assert.ok(burst.p95Ms <= 100, `DOM p95 ${burst.p95Ms} exceeds 100ms`);
    assert.ok(burst.writes < 1000); burst.elapsedMs = performance.now() - start;
    await writeFile(join(evidence, 'dom-burst.json'), JSON.stringify(burst, null, 2));
    await writeFile(join(evidence, 'dom-burst.png'), await page.screenshot({ fullPage: true }));
    observations.push({ scenario: '1000 deltas/s for 5 seconds, two items, actual textContent setter spy', passed: true });

    await evaluate('probe.holdFrames = true; probe.holdTimers = true');
    const fragmentId = delta('terminal', '分片 UTF-8 🙂', 's1', true);
    await wait(`probe.parsed.includes('${fragmentId}')`);
    assert.equal(await evaluate("document.getElementById('transcript').textContent.includes('分片 UTF-8')"), false);
    const terminalId = emit('node.session.turn.cancelled', { turn_id: 'turn-fixture' });
    await wait("document.getElementById('cancel').disabled && document.getElementById('turn-status').textContent.includes('已取消') && document.getElementById('transcript').textContent.includes('分片 UTF-8 🙂')");
    observations.push({ scenario: 'byte-fragmented UTF-8 and terminal flush while both paint callbacks suspended', passed: true, cursor: terminalId });
    delta('visibility', 'visible after transition'); await wait("probe.arrivals.visibility?.length === 1");
    await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await evaluate("document.getElementById('transcript').textContent.includes('visible after transition')"), true);
    await evaluate("probe.holdTimers = false; Object.defineProperty(document, 'hidden', { configurable: true, value: true })");
    delta('background', 'timer painted');
    await wait("document.getElementById('transcript').textContent.includes('timer painted')");
    observations.push({ scenario: 'visibilitychange flush and timer fallback with rAF suspended', passed: true });
    await evaluate("delete document.hidden; probe.holdFrames = false; document.getElementById('logs').closest('details').open = true");
    await wait("document.getElementById('logs').textContent.includes('timer painted')");
    assert.equal(await evaluate("document.getElementById('logs').textContent.length <= 100000"), true);
    assert.equal(await evaluate('probe.formatted'), 100);
    await evaluate("document.getElementById('logs').closest('details').open = false");
    observations.push({ scenario: 'folded logs format zero events; opening formats only retained 100, display bounded', passed: true });

    hold.items = true; hold.actions = true;
    emit('node.session.items.changed', {}); emit('node.session.actions.changed', {});
    await until(() => pending.items.length === 1 && pending.actions.length === 1);
    emit('node.session.items.changed', {}); emit('node.session.actions.changed', {});
    await wait(`probe.parsed.includes('evt_${sequence}')`);
    assert.equal(pending.items.length, 1); assert.equal(pending.actions.length, 1);
    pending.items[0]([{ id: 'stale', text: 'STALE SNAPSHOT' }]); pending.actions[0]([{ id: 'stale-action' }]);
    await until(() => pending.items.length === 2 && pending.actions.length === 2);
    assert.equal(await evaluate("document.body.textContent.includes('STALE SNAPSHOT') || document.body.textContent.includes('stale-action')"), false);
    itemRows = [{ id: 'latest', text: 'FINAL SNAPSHOT' }]; actionRows = [{ id: 'latest-action', type: 'command' }];
    pending.items[1](itemRows); pending.actions[1](actionRows); hold.items = false; hold.actions = false;
    await wait("document.getElementById('transcript').textContent.includes('FINAL SNAPSHOT') && document.getElementById('approvals').textContent.includes('latest-action')");
    observations.push({ scenario: 'items/actions each one active request plus trailing dirty request, stale snapshot suppressed', passed: true, items: pending.items.length, actions: pending.actions.length });

    await evaluate('probe.holdFrames = true; probe.holdTimers = true');
    const retainedCursor = delta('stale-paint', 'OLD SESSION MUST NOT PAINT');
    await wait(`probe.parsed.includes('${retainedCursor}')`);
    await page.locator('#sessions button').nth(1).click(); await until(() => streams.has('s2'));
    await evaluate('probe.held.splice(0).forEach(fn => fn()); probe.holdFrames = false; probe.holdTimers = false');
    assert.equal(await evaluate("document.body.textContent.includes('OLD SESSION MUST NOT PAINT')"), false);
    await writeFile(join(evidence, 'session-switch.png'), await page.screenshot({ fullPage: true }));
    await page.locator('#sessions button').first().click(); await until(() => streams.has('s1'));
    assert.equal(requests.filter(row => row.path === '/v1/agents/sessions/s1/events').at(-1).cursor, retainedCursor);
    await evaluate('probe.holdFrames = true; probe.holdTimers = true');
    const endCursor = delta('disconnect', 'flush on EOF');
    streams.get('s1').end(); await wait("document.getElementById('stream-status').textContent.includes('已断开')");
    assert.equal(await evaluate("document.getElementById('transcript').textContent.includes('flush on EOF')"), true);
    await page.locator('#resume').click(); await until(() => streams.has('s1'));
    assert.equal(requests.filter(row => row.path === '/v1/agents/sessions/s1/events').at(-1).cursor, endCursor);
    assert.ok(requests.every(row => row.method === 'GET' && row.bearer));
    observations.push({ scenario: 'session reset cancels captured callbacks, cursors survive switch and EOF, no input replay', passed: true, retainedCursor, endCursor });

    const races = [];
    await evaluate('probe.holdFrames = false; probe.holdTimers = false');
    for (const snapshot of ['empty', 'old', 'item-started', 'terminal', 'completed']) {
      const itemId = 'race-' + snapshot, prefix = snapshot + ' prefix · ', suffix = 'last delta 🙂';
      const itemType = snapshot === 'item-started' ? 'commandExecution' : 'agentMessage';
      emit('node.harness.event', { method: 'item/started', params: { turnId: 'race-turn', item: { id: itemId, type: itemType, text: '', status: 'inProgress' } } });
      delta(itemId, prefix);
      await wait(`document.getElementById('transcript').textContent.includes(${JSON.stringify(prefix)})`);
      const barrier = pending.items.length, responses = await evaluate('probe.itemsResponses');
      hold.items = true; emit('node.session.items.changed', {});
      await until(() => pending.items.length === barrier + 1);
      await evaluate('probe.holdFrames = true; probe.holdTimers = true');
      const id = delta(itemId, suffix);
      await wait(`probe.parsed.includes('${id}')`);
      let expected = prefix + suffix;
      if (snapshot === 'terminal') {
        emit('node.session.turn.cancelled', { turn_id: 'race-turn' });
        await wait("document.getElementById('turn-status').textContent.includes('已取消')");
      }
      if (snapshot === 'completed') {
        expected = 'authoritative complete text';
        const completed = emit('node.harness.event', { method: 'item/completed', params: { turnId: 'race-turn', item: { id: itemId, type: 'agentMessage', text: expected } } });
        await wait(`probe.parsed.includes('${completed}')`);
      }
      const rows = snapshot === 'empty' || snapshot === 'terminal' ? [] : [{ id: itemId, type: itemType, text: 'OLD SNAPSHOT', status: 'inProgress' }];
      pending.items[barrier](rows); hold.items = false;
      await wait(`probe.itemsResponses === ${responses + 1}`);
      await evaluate('probe.held.splice(0).forEach(fn => fn()); probe.holdFrames = false; probe.holdTimers = false');
      const sample = await evaluate(`({ text: [...document.querySelectorAll('#transcript pre')].map(n => n.textContent), status: document.getElementById('turn-status').textContent, placeholder: document.getElementById('transcript').textContent.includes('没有返回对话记录') })`);
      races.push({ snapshot, expected, observed: sample });
      await writeFile(join(evidence, 'refresh-race.json'), JSON.stringify(races, null, 2));
      assert.equal(sample.text.filter(value => value === expected).length, 1, `${snapshot} snapshot lost or duplicated live text`);
      assert.equal(sample.text.includes('OLD SNAPSHOT'), false);
      assert.equal(sample.placeholder, false);
    }
    await writeFile(join(evidence, 'refresh-race.png'), await page.screenshot({ fullPage: true }));

    const barrier = pending.items.length;
    hold.items = true; emit('node.session.items.changed', {});
    await until(() => pending.items.length === barrier + 1);
    await evaluate('probe.holdFrames = true; probe.holdTimers = true');
    const switched = delta('reset-race', 'old session race text');
    await wait(`probe.parsed.includes('${switched}')`);
    await page.locator('#sessions button').nth(1).click();
    await until(() => pending.items.length === barrier + 2);
    pending.items[barrier]([{ id: 'old-session', text: 'old session race snapshot' }]);
    pending.items[barrier + 1]([{ id: 'new-session', text: 'NEW SESSION SNAPSHOT' }]); hold.items = false;
    await until(() => streams.has('s2'));
    await evaluate('probe.held.splice(0).forEach(fn => fn()); probe.holdFrames = false; probe.holdTimers = false');
    assert.equal(await evaluate("document.getElementById('transcript').textContent.includes('NEW SESSION SNAPSHOT') && !document.getElementById('transcript').textContent.includes('old session race')"), true);
    races.push({ snapshot: 'session-reset', passed: true });
    await writeFile(join(evidence, 'refresh-race.json'), JSON.stringify(races, null, 2));
    await writeFile(join(evidence, 'refresh-session-switch.png'), await page.screenshot({ fullPage: true }));
    await writeFile(join(evidence, 'rendering-observations.json'), JSON.stringify(observations, null, 2));
    await writeFile(join(evidence, 'rendering-requests.json'), JSON.stringify(requests, null, 2));
  } finally {
    for (const stream of streams.values()) stream.end();
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
