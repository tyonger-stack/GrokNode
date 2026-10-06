import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { capabilities, createClient, desktopURL, eventView, projectDownload, readSSE } from '../tools/node-agent-api/web/client.js';

const web = new URL('../tools/node-agent-api/web/', import.meta.url);
const archive = gzipSync(Buffer.alloc(1024));
const exportedArtifact = { id: 'artifact_1', name: 'project.tar.gz', size: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), download_url: '/v1/agents/sessions/session_1/artifacts/artifact_1/content' };

test('artifact binary download uses one authenticated GET without putting key in URL; legacy JSON stays local', async () => {
  const calls = [], signal = new AbortController().signal;
  const client = createClient('private-test-key', 'http://localhost', async (url, options) => {
    calls.push({ url, options });
    return new Response(archive, { headers: { 'Content-Type': 'application/gzip' } });
  });
  const downloaded = await projectDownload(client, { artifact: exportedArtifact }, 'session_1', signal);
  assert.deepEqual(Buffer.from(await downloaded.blob.arrayBuffer()), archive);
  assert.equal(downloaded.name, 'project.tar.gz'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost' + exportedArtifact.download_url);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-test-key');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.redirect, 'error');
  const legacy = { files: [{ path: 'old.txt', content: '兼容导出' }] };
  const json = await projectDownload(client, legacy, 'session_1');
  assert.deepEqual(JSON.parse(await json.blob.text()), legacy);
  assert.equal(json.name, 'session_1-project.json'); assert.equal(calls.length, 1);
});

test('artifact URL rejects cross-origin/non-API and failed content fetch is never retried', async () => {
  let calls = 0;
  const client = createClient('private-test-key', 'http://localhost', async () => {
    calls++; return Response.json({ error: { type: 'download_failed', message: '下载失败' } }, { status: 502 });
  });
  for (const url of ['https://other.invalid/v1/archive', '/desktop/archive']) {
    await assert.rejects(projectDownload(client, { artifact: { ...exportedArtifact, download_url: url } }, 'session_1'), /其他来源/);
  }
  assert.equal(calls, 0);
  await assert.rejects(projectDownload(client, { artifact: exportedArtifact }, 'session_1'), /HTTP 502.*下载失败/);
  assert.equal(calls, 1);
  await assert.rejects(projectDownload(client, { artifact: {} }, 'session_1'), /未生成下载/);
  assert.equal(calls, 1);
});

test('UI capability gates require explicit true, including unknown and old backend', () => {
  assert.ok(Object.values(capabilities()).every(value => value === false));
  const old = capabilities({ writes_enabled: false, events: { sse: true, cancellation: false }, security: { desktop_server_enforced: true } });
  assert.equal(old.sse, true); assert.equal(old.cancel, false); assert.equal(old.view, false);
  assert.equal(capabilities({ project: { diff: 'true' } }).diff, false);
  assert.ok(Object.values(capabilities({ writes_enabled: true, events: { sse: true, cancellation: true, required_actions: true }, project: { diff: true, import: true, export: true }, desktop: { view: true, control: true, applications: true }, environment: { isolation: 'shared_container_separate_display' }, clipboard: { read: true, write: true } })).every(Boolean));
  assert.equal(capabilities({ desktop: { applications: 'true' } }).applications, false);
});

test('Bearer requests stay same-origin, block redirects, and consume complete pagination', async () => {
  const calls = [];
  const client = createClient('test-only-key', 'http://127.0.0.1:9876', async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { data: [{ id: 'a' }], has_more: true, last_id: 'a' } : { data: [{ id: 'b' }], has_more: false });
  });
  assert.deepEqual(await client.list('/v1/agents'), [{ id: 'a' }, { id: 'b' }]);
  assert.equal(new URL(calls[1].url).searchParams.get('after'), 'a');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  await assert.rejects(client.json('https://elsewhere.invalid/v1/agents'), /其他来源/);
  await assert.rejects(client.json('/desktop/not-api'), /其他来源/);
  assert.equal(calls.length, 2);
});

test('HTTP unknown/error and malformed list never become success', async () => {
  const client = createClient('test', 'http://localhost', async () => Response.json({ error: { type: 'upstream_unavailable', message: 'unknown' } }, { status: 502 }));
  await assert.rejects(client.json('/v1/agents'), /HTTP 502.*unknown/);
  const malformed = createClient('test', 'http://localhost', async () => Response.json({ data: [], has_more: true }));
  await assert.rejects(malformed.list('/v1/agents'), /分页游标无效/);
});

test('fetch SSE decodes fragmented UTF-8, CRLF, multiline data and heartbeats', async () => {
  const source = ': heartbeat\r\nid: nevt_1\r\nevent: node.session.turn.started\r\ndata: {"type":"node.session.turn.started",\r\ndata: "data":{"turn_id":"回合一"}}\r\n\r\ndata: {"type":"node.upstream.unavailable"}\n\n';
  const bytes = new TextEncoder().encode(source), events = [];
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await readSSE(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), event => events.push(event));
  assert.equal(events.length, 2); assert.equal(events[0].id, 'nevt_1');
  assert.equal(eventView(events[0]).turnId, '回合一'); assert.equal(eventView(events[0]).turnStatus, 'running');
  assert.equal(events[1].id, '');
  await assert.rejects(readSSE(Response.json({}), () => {}), /SSE/);
});

test('turn outcomes are authoritative and tool deltas retain their association', () => {
  assert.equal(eventView({ type: 'node.session.input.accepted', data: { data: { status: 'accepted' } } }).turnStatus, undefined);
  assert.equal(eventView({ type: 'node.harness.event', data: { data: { method: 'turn/completed', params: { turn: { id: 't', status: 'failed' } } } } }).turnStatus, 'failed');
  const tool = eventView({ type: 'node.harness.event', data: { data: { method: 'item/commandExecution/outputDelta', params: { itemId: 'tool', turnId: 't', delta: '测试失败' } } } });
  assert.equal(tool.itemId, 'tool'); assert.equal(tool.delta, '测试失败'); assert.equal(tool.turnId, 't');
  assert.equal(eventView({ type: 'custom.unknown', data: {} }).turnStatus, undefined);
});

test('desktop iframe cannot navigate to arbitrary or cross-origin URLs', () => {
  assert.equal(desktopURL('/desktop/ticket/t', 'http://localhost'), 'http://localhost/desktop/ticket/t');
  for (const value of ['https://other.invalid/desktop/t', 'javascript:alert(1)', '/v1/agents', '', 'http://user:pass@localhost/desktop/t']) assert.throws(() => desktopURL(value, 'http://localhost'));
});

test('HTML uses Chinese, external scripts, and no persistent key or clipboard automation', async () => {
  const html = await readFile(new URL('index.html', web), 'utf8');
  const app = await readFile(new URL('app.js', web), 'utf8');
  assert.match(html, /lang="zh-CN"/); assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /\son\w+=/i);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) { assert.match(match[1], /src=/); assert.equal(match[2].trim(), ''); }
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.clipboard|new EventSource/);
  assert.match(app, /agent\.session\.input\.cancel/);
  assert.match(app, /Last-Event-ID/);
});

// This opt-in browser scenario uses existing local QA tooling, never a project dependency.
if (process.env.NODE_AGENT_UI_BROWSER === '1') test('real Chromium UI contract: session, stream, actions, project, desktop, clipboard and responsive states', { timeout: 90000 }, async () => {
  const evidence = process.env.NODE_AGENT_UI_EVIDENCE;
  assert.ok(evidence, 'NODE_AGENT_UI_EVIDENCE must name an artifact directory');
  await mkdir(evidence, { recursive: true });
  const { loadOmowright } = await import(pathToFileURL(process.env.NODE_AGENT_UI_BROWSER_LOADER).href);
  const { omowright } = await loadOmowright();
  const requests = [], streams = new Set();
  let approvalPending = true, failDiff = false, capabilityMode = 'full', exportMode = 'files', failDownload = false;
  const caps = { writes_enabled: true, sessions: { independent_conversations: false }, events: { sse: true, cancellation: true, required_actions: true }, desktop: { view: true, control: true }, project: { diff: true, import: true, export: true }, clipboard: { read: true, write: true } };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/' || /^\/(?:app\.js|client\.js|style\.css)$/.test(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'" });
      res.end(await readFile(new URL(name, web))); return;
    }
    if (url.pathname === '/desktop/ticket/test') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="zh-CN"><title>测试桌面契约</title><body>测试专用桌面路由</body></html>'); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: req.method, path: url.pathname, query: url.search, body, bearer: req.headers.authorization === 'Bearer contract-test-key', cursor: req.headers['last-event-id'] });
    if (req.headers.authorization !== 'Bearer contract-test-key') return json({ error: { type: 'unauthorized', message: '测试认证失败' } }, 401);
    if (url.pathname === '/v1/capabilities') return json(capabilityMode === 'full' ? caps : { events: { sse: false }, writes_enabled: false });
    if (url.pathname === '/v1/agents') return json({ data: [{ id: 'bot_1', name: '契约测试机器人' }, { id: 'bot_2', name: '第二个测试机器人' }], has_more: false });
    if (url.pathname === '/v1/agents/sessions') return json(req.method === 'POST' ? { id: 'session_1', agent_id: body.agent_id, status: 'idle' } : { data: [{ id: 'session_1', agent_id: 'bot_1', status: 'idle' }], has_more: false });
    if (url.pathname === '/v1/agents/sessions/session_1') return json({ id: 'session_1', agent_id: 'bot_1', status: 'idle' });
    if (url.pathname.endsWith('/items')) return json({ data: [{ id: 'item_1', role: 'assistant', text: '来自测试 API 的既有记录 <img src=x onerror=alert(1)>' }], has_more: false });
    if (url.pathname.endsWith('/events') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    if (url.pathname.endsWith('/events')) return json({ status: 'accepted', completed: false, request_id: 'req_1' }, 202);
    if (url.pathname.endsWith('/actions')) return json({ data: approvalPending ? [{ id: 'action_1', type: 'command', command: '测试审批操作' }] : [], has_more: false });
    if (url.pathname.endsWith('/actions/action_1')) { approvalPending = false; return json({ decision: body.decision }); }
    if (url.pathname.endsWith('/project/diff')) return failDiff ? json({ error: { type: 'upstream_unavailable', message: '差异未知' } }, 502) : json({ diff: '+测试项目修改' });
    if (url.pathname.endsWith('/project/import')) return json({ imported: body.files.map(file => file.path) });
    if (url.pathname.endsWith('/project/export')) return json(exportMode === 'artifact' ? { artifact: exportedArtifact } : { files: [{ path: 'hello.txt', content: '导出内容' }] });
    if (url.pathname === exportedArtifact.download_url) {
      if (failDownload) return json({ error: { type: 'download_failed', message: '下载失败' } }, 502);
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': archive.length }); res.end(archive); return;
    }
    if (url.pathname.endsWith('/desktop')) return json({ url: '/desktop/ticket/test', mode: body.mode, pauses_agent: false });
    if (url.pathname.endsWith('/handback')) return json({ released: true });
    if (url.pathname.endsWith('/clipboard')) return json(req.method === 'GET' ? { text: '测试剪贴板内容' } : { written: true });
    return json({ error: { type: 'not_found', message: '未实现测试路由' } }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'node-agent-ui-'));
  let browser;
  const observations = [];
  try {
    browser = await omowright.connectPipe({ browserPath: process.env.NODE_AGENT_UI_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless=new', '--no-first-run', `--user-data-dir=${profile}`, '--window-size=1280,900'], storageRoot: profile });
    const page = await browser.newTab(origin);
    await page.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: evidence });
    const evaluate = expression => page.evaluate(expression);
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      assert.fail(`Browser condition not reached: ${expression}`);
    };
    const click = selector => page.locator(selector).click();
    const fill = (selector, value) => page.locator(selector).fill(value);
    const capture = async name => { await writeFile(join(evidence, name + '.png'), await page.screenshot({ fullPage: true })); };
    const emit = (id, type, data) => { for (const stream of streams) stream.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, session_id: 'session_1', data })}\n\n`); };
    await waitFor("document.getElementById('send').disabled"); await capture('disconnected-desktop');
    await fill('#key', 'contract-test-key'); await click('#connect');
    await waitFor("document.getElementById('bots').options.length === 3");
    assert.equal(await evaluate("document.getElementById('key').value"), '');
    await page.locator('#bots').selectOption('bot_1');
    await waitFor("document.querySelectorAll('#sessions button').length === 1");
    await click('#sessions button');
    await waitFor("document.getElementById('stream-status').textContent === '事件流已连接'");
    assert.equal(await evaluate("document.querySelector('#transcript img') === null"), true);
    assert.equal(requests.some(row => row.path.endsWith('/clipboard')), false);
    observations.push({ scenario: 'manual authentication, bot/session resume, safe transcript', passed: true });
    await fill('#prompt', '契约测试消息'); await click('#send');
    await waitFor("document.getElementById('status').textContent.includes('accepted')");
    assert.equal(await evaluate("document.getElementById('turn-status').textContent.includes('已完成')"), false);
    const message = requests.find(row => row.method === 'POST' && row.body?.events?.[0]?.type === 'message');
    assert.deepEqual(message.body.events, [{ type: 'message', text: '契约测试消息' }]);
    assert.match(message.body.idempotency_key, /^nui_/);
    emit('nevt_1', 'node.harness.event', { method: 'turn/started', params: { turn: { id: 'turn_1' } } });
    emit('nevt_2', 'node.harness.event', { method: 'item/commandExecution/outputDelta', params: { itemId: 'tool_1', turnId: 'turn_1', delta: '实时工具输出' } });
    await waitFor("!document.getElementById('cancel').disabled && document.getElementById('transcript').textContent.includes('实时工具输出')");
    await capture('running-tools-approval');
    await click('#cancel');
    await waitFor("document.getElementById('status').textContent.includes('取消请求响应')");
    assert.deepEqual(requests.find(row => row.body?.events?.[0]?.type === 'agent.session.input.cancel').body, { events: [{ type: 'agent.session.input.cancel', turn_id: 'turn_1' }] });
    emit('nevt_3', 'node.session.turn.cancelled', { turn_id: 'turn_1' });
    await waitFor("document.getElementById('turn-status').textContent.includes('已取消')");
    assert.equal(await evaluate("document.getElementById('cancel').disabled"), true);
    await click('#approvals button'); await waitFor("document.getElementById('approvals').textContent.includes('没有待审批')");
    assert.deepEqual(requests.find(row => row.path.endsWith('/actions/action_1')).body, { decision: 'accept' });
    approvalPending = true; await click('#actions-refresh');
    await waitFor("document.querySelectorAll('#approvals button').length === 2");
    await click('#approvals button:last-child');
    await waitFor("document.getElementById('approvals').textContent.includes('没有待审批')");
    assert.deepEqual(requests.filter(row => row.path.endsWith('/actions/action_1')).at(-1).body, { decision: 'decline' });
    await click('#diff-refresh'); await waitFor("document.getElementById('diff').textContent === '+测试项目修改'");
    const importPath = join(evidence, 'import-fixture.json'); await writeFile(importPath, JSON.stringify({ files: [{ path: 'hello.txt', content: '导入内容' }] }));
    await page.locator('#import-file').setInputFiles(importPath); await click('#import');
    await waitFor("document.getElementById('workspace-status').textContent.includes('导入响应')");
    assert.deepEqual(requests.find(row => row.path.endsWith('/project/import')).body, { files: [{ path: 'hello.txt', content: '导入内容' }] });
    await click('#export'); await waitFor("document.getElementById('workspace-status').textContent.includes('已收到 1 个文件')");
    assert.equal(requests.find(row => row.path.endsWith('/project/export')).method, 'POST');
    const exportPath = join(evidence, 'session_1-project.json');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await readFile(exportPath); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.deepEqual(JSON.parse(await readFile(exportPath, 'utf8')), { files: [{ path: 'hello.txt', content: '导出内容' }] });
    exportMode = 'artifact';
    await click('#export'); await waitFor("document.getElementById('workspace-status').textContent.includes('project.tar.gz')");
    const archivePath = join(evidence, 'project.tar.gz');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await readFile(archivePath); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.deepEqual(await readFile(archivePath), archive);
    assert.equal(requests.filter(row => row.path.endsWith('/project/export')).length, 2);
    assert.deepEqual(requests.filter(row => row.path === exportedArtifact.download_url).map(row => [row.method, row.query, row.bearer]), [['GET', '', true]]);
    await capture('artifact-downloaded');
    failDownload = true;
    await click('#export'); await waitFor("document.getElementById('status').textContent.includes('download_failed')");
    assert.equal(requests.filter(row => row.path.endsWith('/project/export')).length, 3);
    assert.equal(requests.filter(row => row.path === exportedArtifact.download_url).length, 2);
    await capture('artifact-download-failed');
    observations.push({ scenario: 'legacy JSON and authenticated artifact tar.gz download bytes match; failed GET shows 502 without automatically repeating export', passed: true, archive: 'project.tar.gz', sha256: exportedArtifact.sha256 });
    await click('#view'); await waitFor("document.querySelector('#desktop iframe') !== null");
    assert.equal(requests.filter(row => row.path.endsWith('/desktop')).at(-1).body.mode, 'view');
    await click('#control'); await waitFor("document.getElementById('desktop-status').textContent.includes('接管授权')");
    assert.equal(requests.filter(row => row.path.endsWith('/desktop')).at(-1).body.mode, 'control');
    assert.equal(await evaluate("document.querySelector('#desktop iframe').src.startsWith(location.origin + '/desktop/')"), true);
    assert.equal(requests.some(row => row.path.endsWith('/clipboard')), false);
    await click('#clipboard-read'); await waitFor("document.getElementById('clipboard').value === '测试剪贴板内容'");
    await fill('#clipboard', '手动发送'); await click('#clipboard-write');
    await waitFor("document.getElementById('status').textContent.includes('剪贴板写入响应')");
    assert.deepEqual(requests.filter(row => row.path.endsWith('/clipboard')).map(row => [row.method, row.body]), [['GET', undefined], ['POST', { text: '手动发送' }]]);
    await capture('desktop-project-clipboard');
    await click('#handback'); await waitFor("document.querySelector('#desktop iframe') === null");
    assert.equal(requests.find(row => row.path.endsWith('/handback')).method, 'POST');
    for (const stream of streams) stream.end();
    await waitFor("document.getElementById('stream-status').textContent.includes('已断开')");
    await click('#resume'); await waitFor("document.getElementById('stream-status').textContent === '事件流已连接'");
    assert.equal(requests.filter(row => row.path.endsWith('/events') && row.method === 'GET').at(-1).cursor, 'nevt_3');
    assert.equal(requests.filter(row => row.body?.events?.[0]?.type === 'message').length, 1);
    failDiff = true; await click('#diff-refresh'); await waitFor("document.getElementById('status').textContent.includes('HTTP 502')");
    await capture('error-honesty');
    observations.push({ scenario: 'chat, streamed tools, cancel terminal event, both approval decisions, diff/import/export, desktop/handback, explicit clipboard, cursor resume and 502', passed: true });
    for (const width of [375, 768, 1280]) {
      await page.evaluate(`window.scrollTo(0,0)`);
      await omowright.emulate(page, { width, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `horizontal overflow at ${width}`);
      await capture(`responsive-${width}`);
    }
    await page.locator('#bots').selectOption('bot_2');
    assert.equal(await evaluate("document.getElementById('clipboard').value === '' && document.querySelector('#desktop iframe') === null && document.getElementById('send').disabled"), true);
    await click('#disconnect'); assert.equal(await evaluate("document.getElementById('bots').disabled"), true);
    capabilityMode = 'unknown'; await fill('#key', 'contract-test-key'); await click('#connect');
    await waitFor("document.getElementById('bots').options.length === 3");
    await page.locator('#bots').selectOption('bot_1'); await click('#attach');
    await waitFor("document.getElementById('thread').textContent === 'session_1'");
    assert.equal(await evaluate("['send','cancel','view','control','clipboard-read','clipboard-write','actions-refresh','diff-refresh','import','export'].every(id=>document.getElementById(id).disabled)"), true);
    await capture('unsupported-capabilities');
    assert.equal(await evaluate('localStorage.length === 0 && sessionStorage.length === 0'), true);
    await page.goto(origin); await waitFor("document.getElementById('bots').disabled");
    assert.equal(await evaluate("document.getElementById('key').value"), '');
    assert.ok(requests.every(row => row.bearer));
    assert.equal(requests.filter(row => row.path.endsWith('/project/export')).length, 3);
    assert.equal(requests.filter(row => row.path === exportedArtifact.download_url).length, 2);
    observations.push({ scenario: 'responsive widths, clear on bot switch/disconnect, unsupported gates, reload forgets key', passed: true });
    await writeFile(join(evidence, 'browser-observations.json'), JSON.stringify(observations, null, 2));
    await writeFile(join(evidence, 'requests.json'), JSON.stringify(requests, null, 2));
  } finally {
    await writeFile(join(evidence, 'requests.json'), JSON.stringify(requests, null, 2));
    for (const stream of streams) stream.end();
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
