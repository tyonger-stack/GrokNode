import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startNodeAgentApi } from '../tools/node-agent-api/server.mjs';
import { createGrokNodeAdapter } from '../tools/node-agent-api/grok-node.mjs';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, rm } from 'node:fs/promises';

async function fixture(directory) {
  const stateDirectory = directory ?? await realpath(await mkdtemp(path.join(tmpdir(), 'node-backends-')));
  const calls = [], transcript = [];
  let store;
  const bots = [{ id: 'bot-a', name: 'A', object: 'node.agent' }];
  const codex = {
    backend: 'codex_harness', independentSessions: true, writesEnabled: true,
    attachStore(value) { store = value; },
    agents: async () => bots, requireAgent: async () => bots[0],
    async bindSession(session) { calls.push({ method: 'thread/start' }); await store.update(session.id, { thread_id: 'thr_' + session.id, task_status: 'idle' }); },
    async inputSession(session, text) { calls.push({ method: 'turn/start', session: session.id, text }); return { accepted: true, turn_id: 'turn-codex' }; },
    itemsSession: async () => [{ id: 'codex-item', type: 'agentMessage', text: 'Harness transcript' }],
    async cancel() { calls.push({ method: 'turn/interrupt' }); return { accepted: true }; },
  };
  const native = createGrokNodeAdapter({ allowNativeChat: true, async execute(_binary, args) {
    const method = args.at(-2), body = JSON.parse(args.at(-1));
    if (method === 'listAgents') return { stdout: JSON.stringify(bots) };
    if (method === 'getAgentTranscript') return { stdout: JSON.stringify(transcript) };
    if (method === 'sendPrompt') { calls.push({ method, ...body }); transcript.push({ id: body.clientNonce, kind: 'message', role: 'user', message: { type: 'text', content: body.prompt } }); return { stdout: JSON.stringify({ accepted: true }) }; }
    throw Error('Unexpected native operation');
  } });
  const service = await startNodeAgentApi({ adapter: codex, nativeAdapter: native, stateDirectory, pollIntervalMs: 10 });
  const key = (await readFile(service.keyFile, 'utf8')).trim();
  async function call(method, route, body, credential = key) {
    const response = await fetch(service.origin + route, { method, headers: { authorization: 'Bearer ' + credential, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  return { service, stateDirectory, calls, transcript, call };
}

test('same bot keeps independent Harness sessions and a separate reusable native attachment', async () => {
  const f = await fixture();
  try {
    const harness = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' });
    const native = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' });
    const again = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' });
    const second = await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'codex' });
    assert.equal(harness.data.backend, 'codex');
    assert.equal(native.data.context, 'grok_node_bot_transcript');
    assert.notEqual(native.data.id, harness.data.id);
    assert.equal(again.status, 200);
    assert.equal(again.data.id, native.data.id);
    assert.notEqual(second.data.id, harness.data.id);
    assert.equal(f.calls.filter(call => call.method === 'thread/start').length, 2);
  } finally { await f.service.close(); }
});

test('native API message reaches sendPrompt once and is read back from the bot transcript', async () => {
  const f = await fixture();
  try {
    const session = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' })).data;
    const base = '/v1/agents/sessions/' + session.id;
    const message = { events: [{ type: 'message', text: 'Native message' }], idempotency_key: 'native-once' };
    const accepted = await f.call('POST', base + '/events', message);
    const replayed = await f.call('POST', base + '/events', message);
    const items = await f.call('GET', base + '/items');
    assert.equal(accepted.status, 202);
    assert.equal(accepted.data.completed, false);
    assert.equal(replayed.data.replayed, true);
    assert.deepEqual(f.calls, [{ method: 'sendPrompt', agentId: 'bot-a', prompt: 'Native message', clientNonce: 'native-once' }]);
    assert.equal(items.data.data[0].message.content, 'Native message');
    assert.equal(session.capabilities.events.cancellation, false);
    assert.equal(session.thread_id, undefined);
    const conflict = await f.call('POST', base + '/events', { ...message, events: [{ type: 'message', text: 'Changed text' }] });
    assert.equal(conflict.status, 409);
  } finally { await f.service.close(); }
});

test('existing Harness session still sends and reads through Harness after native attachment', async () => {
  const f = await fixture();
  try {
    const harness = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a' })).data;
    await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' });
    const base = '/v1/agents/sessions/' + harness.id;
    await f.call('POST', base + '/events', { events: [{ type: 'message', text: 'Harness message' }] });
    assert.equal(f.calls.at(-1).method, 'turn/start');
    assert.equal((await f.call('GET', base + '/items')).data.data[0].id, 'codex-item');
    assert.equal((await f.call('GET', base)).data.backend, 'codex');
  } finally { await f.service.close(); }
});

test('invalid backend, native model overrides and backend mutation fail without starting work', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'invalid' })).status, 400);
    for (const override of [{ model: 'api-model' }, { reasoning_effort: 'high' }]) {
      assert.equal((await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok', ...override })).status, 409);
    }
    const native = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' })).data;
    assert.equal((await f.call('PATCH', '/v1/agents/sessions/' + native.id, { backend: 'codex' })).status, 400);
    assert.equal(f.calls.length, 0);
  } finally { await f.service.close(); }
});

test('backend persists across API restart and native sends keep bot grant checks', async () => {
  const f = await fixture();
  const native = (await f.call('POST', '/v1/agents/sessions', { agent_id: 'bot-a', backend: 'grok' })).data;
  await f.service.close();
  const resumed = await fixture(f.stateDirectory);
  try {
    const base = '/v1/agents/sessions/' + native.id;
    assert.equal((await resumed.call('GET', base)).data.backend, 'grok');
    const restricted = (await resumed.call('POST', '/v1/keys', { scopes: ['sessions.read', 'sessions.write'], bot_ids: ['other-bot'] })).data.key;
    assert.equal((await resumed.call('POST', base + '/events', { events: [{ type: 'message', text: 'Forbidden' }] }, restricted)).status, 403);
    await resumed.call('POST', base + '/events', { events: [{ type: 'message', text: 'After restart' }] });
    assert.equal(resumed.calls.at(-1).method, 'sendPrompt');
  } finally { await resumed.service.close(); }
});

if (process.env.NODE_AGENT_UI_BROWSER === '1') test('browser selects native chat, reads its messages and switches back to Harness for new sessions', { timeout: 60000 }, async () => {
  const f = await fixture();
  const profile = await mkdtemp(path.join(tmpdir(), 'backend-browser-'));
  const evidence = process.env.NODE_AGENT_UI_EVIDENCE;
  const { loadOmowright } = await import(pathToFileURL(process.env.NODE_AGENT_UI_BROWSER_LOADER).href);
  const { omowright } = await loadOmowright();
  let browser;
  try {
    await mkdir(evidence, { recursive: true });
    browser = await omowright.connectPipe({ browserPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless=new', '--no-first-run', '--user-data-dir=' + profile, '--window-size=1280,900'], storageRoot: profile });
    const page = await browser.newTab(f.service.origin + '/ui/');
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await page.evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      assert.fail('Browser condition not reached: ' + expression);
    };
    const key = (await readFile(f.service.keyFile, 'utf8')).trim();
    await page.locator('#key').fill(key); await page.locator('#connect').click();
    await waitFor('document.querySelector("#backend").options.length === 2');
    assert.equal(await page.evaluate('document.querySelector("#backend").value'), 'codex');
    await page.locator('#bots').selectOption('bot-a');
    await page.locator('#backend').selectOption('grok');
    await waitFor('!document.querySelector("#attach").disabled');
    await page.locator('#attach').click();
    await waitFor('document.querySelector("#thread").textContent.includes("Grok Node 原生聊天")');
    assert.equal(await page.evaluate('document.querySelector("#model").disabled && document.querySelector("#cancel").disabled'), true);
    await page.locator('#prompt').fill('Browser native message'); await page.locator('#send').click();
    await waitFor('document.querySelector("#transcript").textContent.includes("Browser native message")');
    assert.equal(f.calls.filter(row => row.method === 'sendPrompt').length, 1);
    for (const width of [375, 768, 1280]) {
      await omowright.emulate(page, { width, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false });
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await writeFile(path.join(evidence, 'native-' + width + '.png'), await page.screenshot({ fullPage: true }));
    }
    await page.locator('#backend').selectOption('codex'); await page.locator('#attach').click();
    await waitFor('document.querySelector("#transcript").textContent.includes("Harness transcript")');
    await page.locator('#prompt').fill('Browser Harness message'); await page.locator('#send').click();
    await waitFor('document.querySelector("#status").textContent.includes("accepted")');
    assert.equal(f.calls.at(-1).method, 'turn/start');
    await writeFile(path.join(evidence, 'backend-browser.json'), JSON.stringify({ nativeSubmissions: f.calls.filter(row => row.method === 'sendPrompt').length, harnessSubmissions: f.calls.filter(row => row.method === 'turn/start').length, widths: [375, 768, 1280], overflow: false }, null, 2));
  } finally { await browser?.close(); await f.service.close(); await rm(profile, { recursive: true, force: true }); }
});
