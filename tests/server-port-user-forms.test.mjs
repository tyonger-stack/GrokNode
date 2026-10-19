import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, mkdtemp, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { bundleServerPort } from './server-port-bundle.mjs';
const api = await bundleServerPort(['shared/user-forms', 'host/extensions/session/user-form-service', 'host/runner/browser/user-form-fill', 'host/runner/browser/user-form-private-driver', 'host/runner/tools/user-form-tool', 'host/runner/tools/sand-browser-driver-source', 'packages/context/core']);
const evidence = path.resolve(process.env.USER_FORM_EVIDENCE_DIR ?? '.omo/evidence/user-forms-20261019');
await mkdir(evidence, { recursive: true });
const form = (extra = {}) => ({ title: 'Sign in', instruction: 'Enter details', reason: 'auth', domain: 'example.com', fields: [{ id: 'pw', label: 'Password', type: 'password', target: { kind: 'selector', value: '#pw' } }], ...extra });
async function realDriverSnapshot(dir, display, cdpPort) {
  const driver = path.join(dir, 'snapshot-driver.mjs');
  // The box default /workspace/downloads does not exist on this host; only that
  // default is redirected so the snapshot serializer under test stays identical.
  const downloads = path.join(dir, 'downloads');
  const source = api.SAND_BROWSER_DRIVER_SOURCE.replace('async function configureBrowserDownloads(browser, directory = "/workspace/downloads")', `async function configureBrowserDownloads(browser, directory = ${JSON.stringify(downloads)})`);
  assert.notEqual(source, api.SAND_BROWSER_DRIVER_SOURCE, 'downloads default was not redirected');
  await writeFile(driver, source);
  const args = Buffer.from(JSON.stringify({ op: 'snapshot', display, cdpPort, launchBrowser: false, interactive: true, maxDepth: 6, viewId: 'form-under-test' })).toString('base64');
  const child = spawn(process.execPath, [driver, args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, stderr.slice(-300));
  const marker = '__SAND_BROWSER_RESULT__';
  const line = stdout.split('\n').find(item => item.includes(marker));
  assert.ok(line, 'driver produced no result marker');
  const parsed = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  assert.equal(parsed.ok, true, parsed.error);
  assert.ok(parsed.data && parsed.data.length > 0, `empty snapshot: ${JSON.stringify(parsed).slice(0, 300)} targets=${JSON.stringify(globalThis.__formTargets ?? [])}`);
  return parsed.data;
}
async function record(name, observable) { await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ scenario: name, invocation: 'node --test tests/server-port-user-forms.test.mjs', observable, passed: true }, null, 2)); }
function setup(privateFill, timeoutMs) {
  const messages = [];
  const service = new api.UserFormService({ emitForm: async (agentId, message) => { messages.push({ agentId, message }); return "entry-1"; }, privateFill: input => input.probeOnly ? Promise.resolve({ fields: input.entries.map(e => ({ id: e.field.id, status: "filled" })) }) : privateFill(input), ...(timeoutMs ? { timeoutMs } : {}) });
  return { service, messages };
}
test('rejects unsafe definitions and value-bearing remaps', async () => {
  // Given unsafe requests; When parsing; Then reject each boundary violation.
  const cases = [form({ fields: Array(9).fill(form().fields[0]) }), form({ domain: undefined }), form({ fields: [{ id: 'a', label: 'a', type: 'password' }] }), form({ fields: [form().fields[0], form().fields[0]] }), form({ submitAfterFill: true }), form({ domain: 'javascript:alert(1)' }), form({ fields: [{ id: 's', label: 's', type: 'select' }] })];
  for (const request of cases) assert.equal(api.requestUserFormParameters.safeParse(request).success, false);
  assert.equal(api.remapUserFormTargetsParameters.safeParse({ targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#pw' }, value: 'forbidden' }] }).success, false);
  assert.equal(api.requestUserFormParameters.safeParse(form({ submitAfterFill: true, fields: [{ id: 'otp', label: 'OTP', type: 'otp', target: { kind: 'selector', value: '#otp' } }] })).success, true);
  await record('schema', { rejected: cases.length + 1, otpAccepted: true });
});
test('all values stay private and cross-agent submissions are refused', async () => {
  const { service, messages } = setup(async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: 'filled' })) }));
  const request = await service.request('a', 'turn', form());
  assert.equal((await service.submit({ agentId: 'b', requestId: request.requestId, values: { pw: 'synthetic-private' } })).status, 'unavailable');
  const receipt = await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  assert.equal(receipt.fields[0].status, 'filled');
  assert.equal(JSON.stringify([receipt, messages]).includes('synthetic-private'), false);
  assert.equal((await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'again' } })).status, 'unavailable');
  await record('write-only', { filled: true, crossAgentRejected: true, replayRejected: true, valueInMessages: false });
});
test('remaps once without accepting values and clears holds at turn end', async () => {
  let calls = 0;
  const { service } = setup(async input => { calls++; return { fields: input.entries.map(e => ({ id: e.field.id, status: 'failed', reason: 'stale_locator' })) }; });
  const request = await service.request('a', 't', form());
  const receipt = await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  assert.deepEqual(receipt.remapFieldIds, ['pw']);
  const targets = { targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#fresh' } }] };
  assert.equal((await service.remap('a', 'other', targets)).status, 'unavailable');
  assert.equal((await service.remap('a', 't', targets)).status, 'remapped');
  assert.equal((await service.remap('a', 't', targets)).status, 'unavailable');
  assert.equal(calls, 2);
  await record('one-remap', { calls, otherTurnRejected: true, secondRemapRejected: true });
});
test('resume lease is per form so concurrent forms cannot cross wires', async () => {
  const { service } = setup(async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: input.probeOnly ? 'filled' : 'failed', ...(input.probeOnly ? {} : { reason: 'stale_locator' }) })) }));
  const formA = form({ fields: [{ id: 'pw', label: 'Password', type: 'password', target: { kind: 'selector', value: '#pw' } }] });
  const formB = form({ fields: [{ id: 'code', label: 'Code', type: 'otp', target: { kind: 'selector', value: '#code' } }] });
  const a = await service.request('a', 'turn-1', formA);
  const b = await service.request('a', 'turn-2', formB);
  assert.deepEqual((await service.submit({ agentId: 'a', requestId: a.requestId, values: { pw: 'secret-a' } })).remapFieldIds, ['pw']);
  assert.deepEqual((await service.submit({ agentId: 'a', requestId: b.requestId, values: { code: 'secret-b' } })).remapFieldIds, ['code']);
  service.activateResumeTurn('a', 'token-a', a.requestId);
  service.activateResumeTurn('a', 'token-b', b.requestId);
  const targetFor = id => ({ targets: [{ fieldId: id, target: { kind: 'selector', value: `#${id}-fresh` } }] });
  // Each token may only reach its own form's held field.
  assert.equal((await service.remap('a', 'token-b', targetFor('pw'))).status, 'unavailable');
  assert.equal((await service.remap('a', 'token-a', targetFor('code'))).status, 'unavailable');
  assert.equal((await service.remap('a', 'token-unknown', targetFor('pw'))).status, 'unavailable');
  assert.equal((await service.remap('a', 'turn-1', targetFor('pw'))).status, 'unavailable');
  assert.equal((await service.remap('a', 'token-b', targetFor('code'))).status, 'remapped');
  assert.equal((await service.remap('a', 'token-a', targetFor('pw'))).status, 'remapped');
  assert.equal((await service.remap('a', 'token-a', targetFor('pw'))).status, 'unavailable');
  await record('resume-lease-per-form', { crossFormRejected: 3, unknownTokenRejected: true, originalTurnRejected: true, bothRemapped: true, secondRemapRejected: true });
});
for (const mode of ['dismiss', 'stopped', 'turn_ended', 'expired', 'restart']) test(`clears values on ${mode}`, async () => {
  const { service } = setup(async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: 'failed', reason: 'page_moved' })) }), mode === 'expired' ? 15 : undefined);
  const request = await service.request('a', 't', form());
  await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  let target = service;
  if (mode === 'dismiss') service.dismiss({ agentId: 'a', requestId: request.requestId });
  else if (mode === 'expired') await new Promise(resolve => setTimeout(resolve, 25));
  else if (mode === 'restart') target = setup(async () => { throw new Error('must not fill'); }).service;
  else service.settleTurn('a', 't', mode);
  assert.equal((await target.remap('a', 't', { targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#fresh' } }] })).status, 'unavailable');
  service.settleTurn('a', 't');
  await record(`clear-${mode}`, { remapRejected: true });
});
test('stop aborts an in-flight fill and cannot resurrect its hold', async () => {
  let release;
  let signal;
  const { service } = setup(input => { signal = input.signal; return new Promise(resolve => { release = resolve; }); });
  const request = await service.request('a', 't', form());
  const submission = service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  service.settleTurn('a', 't', 'stopped');
  assert.equal(signal.aborted, true);
  release({ fields: [{ id: 'pw', status: 'failed', reason: 'page_moved' }] });
  assert.equal((await submission).status, 'unavailable');
  await record('stop-in-flight', { aborted: true, resurrected: false });
});
test('dispose clears every controller, value and timer and blocks the in-flight fill', async () => {
  let release; let signal; let writes = 0;
  const { service } = setup(input => { signal = input.signal; writes++; return new Promise(resolve => { release = resolve; }); }, 60_000);
  const shown = await service.request('a', 'shown-turn', form());
  const submitted = await service.request('b', 'filling-turn', form());
  const submission = service.submit({ agentId: 'b', requestId: submitted.requestId, values: { pw: 'synthetic-private' } });
  await new Promise(resolve => setImmediate(resolve));
  const receipts = service.dispose();
  assert.equal(signal.aborted, true);
  release({ fields: [{ id: 'pw', status: 'filled' }] });
  assert.equal((await submission).status, 'unavailable');
  assert.deepEqual(receipts.map(r => r.status), ['stopped', 'stopped']);
  assert.equal((await service.submit({ agentId: 'a', requestId: shown.requestId, values: { pw: 'late' } })).status, 'unavailable');
  assert.equal((await service.remap('b', 'filling-turn', { targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#x' } }] })).status, 'unavailable');
  assert.equal(writes, 1);
  await record('dispose', { receipts: receipts.length, statuses: [...new Set(receipts.map(r => r.status))], inFlightAborted: true, lateSubmitRejected: true, lateRemapRejected: true, privateWrites: writes });
});
test('dispose is idempotent and a disposed service cannot be revived', async () => {
  const { service } = setup(async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: 'filled' })) }));
  const request = await service.request('a', 't', form());
  assert.equal(service.dispose().length, 1);
  assert.deepEqual(service.dispose(), []);
  assert.equal((await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'late' } })).status, 'unavailable');
  await record('dispose-idempotent', { firstCount: 1, secondCount: 0, revived: false });
});
test('expireAll awaits expired card callbacks without waking and drops held values', async () => {
  const states = []; const wakes = []; let callbacksDone = false;
  const service = new api.UserFormService({
    emitForm: async (_agent, message) => message.form.id,
    privateFill: async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: input.probeOnly ? 'filled' : 'failed', ...(input.probeOnly ? {} : { reason: 'stale_locator' }) })) }),
    onStateChange: async (agent, entryId, receipt) => { await new Promise(resolve => setTimeout(resolve, 5)); states.push({ agent, entryId, receipt }); },
    onReceipt: async (_agent, receipt) => { wakes.push(receipt); },
  });
  const shown = await service.request('a', 't1', form());
  const held = await service.request('b', 't2', form());
  await service.submit({ agentId: 'b', requestId: held.requestId, values: { pw: 'synthetic-private' } });
  const beforeExpire = states.length;
  const wakesBeforeExpire = wakes.length;
  await service.expireAll();
  callbacksDone = true;
  assert.equal(callbacksDone, true);
  const expired = states.slice(beforeExpire);
  assert.deepEqual(expired.map(state => state.receipt.status), ['expired', 'expired']);
  assert.deepEqual(expired.map(state => state.entryId), [shown.requestId, held.requestId]);
  assert.equal(wakes.length, wakesBeforeExpire);
  assert.equal((await service.submit({ agentId: 'a', requestId: shown.requestId, values: { pw: 'late' } })).status, 'unavailable');
  assert.equal((await service.remap('b', 't2', { targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#x' } }] })).status, 'unavailable');
  await record('expire-all', { receipts: expired.length, statuses: [...new Set(expired.map(s => s.receipt.status))], wakes: wakes.length, lateSubmitRejected: true, lateRemapRejected: true, callbacksAwaited: true });
});
test('timeout aborts an in-flight fill so the page is never written after expiry', async () => {
  let release; let signal; let writes = 0;
  const { service } = setup(input => { signal = input.signal; writes++; return new Promise(resolve => { release = resolve; }); }, 15);
  const request = await service.request('a', 't', form());
  const submission = service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, true);
  release({ fields: [{ id: 'pw', status: 'filled' }] });
  assert.equal((await submission).status, 'unavailable');
  assert.equal(writes, 1);
  await record('timeout-in-flight', { aborted: true, receipt: 'unavailable', privateWrites: writes });
});
test('pending card survives issuing turn end and remap binds to a resumed turn', async () => {
  const states = []; const receipts = [];
  const service = new api.UserFormService({
    emitForm: async () => 'entry-42',
    privateFill: async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: input.probeOnly ? 'filled' : 'failed', ...(input.probeOnly ? {} : { reason: 'stale_locator' }) })) }),
    onStateChange: async (agentId, entryId, receipt) => { states.push({ agentId, entryId, receipt }); },
    onReceipt: async (agentId, receipt) => { receipts.push({ agentId, receipt }); },
  });
  const request = await service.request('a', 'old-turn', form());
  assert.deepEqual(service.settleTurn('a', 'old-turn'), []);
  const result = await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  assert.deepEqual(result.remapFieldIds, ['pw']);
  service.activateResumeTurn('a', 'new-turn');
  const remapped = await service.remap('a', 'new-turn', { targets: [{ fieldId: 'pw', target: { kind: 'selector', value: '#new' } }] });
  assert.equal(remapped.status, 'remapped');
  assert.equal(receipts.length, 1);
  assert.equal(states.length, 2);
  assert.equal(states.every(s => s.entryId === 'entry-42'), true);
  assert.equal(JSON.stringify([states, receipts]).includes('synthetic-private'), false);
  await record('resume-lifecycle', { oldTurnPreservedCard: true, newTurnRemap: remapped.status, stateCallbacks: states.length, wakeCallbacks: receipts.length, leaked: false });
});
test('RequestUserForm uses streaming Agent invocation and suspends the issuing run', async () => {
  const { service } = setup(async () => ({ fields: [] }));
  const ended = [];
  const tools = api.createUserFormTools({ userForms: service, getAgentId: () => 'a', getTurnId: () => 'old', endThisRunAwaitingUser: reason => ended.push(reason) });
  const tool = tools.find(t => t.name === 'RequestUserForm');
  const result = await tool.execute(api.createContext(), { executeToolCall: async (ctx, _initial, _id, run) => run(ctx) }, (async function* () { yield JSON.stringify(form()); })(), { toolCallId: 'request-form' });
  assert.equal(result.result.case, 'success');
  assert.deepEqual(ended, ['user-form']);
  assert.deepEqual(service.settleTurn('a', 'old'), []);
  service.settleTurn('a', 'old', 'stopped');
  await record('streaming-tool', { result: result.result.case, endReason: ended[0], pendingSurvivedNormalEnd: true });
});
test('safe error codes never include third-party error text', async () => {
  const errors = [];
  const service = new api.UserFormService({ emitForm: async () => { throw new Error('synthetic-private'); }, privateFill: async () => ({ fields: [] }), onError: code => errors.push(code) });
  const receipt = await service.request('a', 't', form());
  assert.equal(receipt.status, 'unavailable');
  assert.deepEqual(errors, ['form_emit_failed']);
  assert.equal(JSON.stringify([receipt, errors]).includes('synthetic-private'), false);
  await record('safe-errors', { codes: errors, leaked: false });
});
for (const action of ['stopped', 'dismissed', 'expired']) test(`pending ${action} notifies its card after the issuing turn ended`, async () => {
  const states = []; const wakes = [];
  const service = new api.UserFormService({
    emitForm: async () => 'pending-entry', timeoutMs: action === 'expired' ? 20 : 1000,
    privateFill: async input => ({ fields: input.entries.map(e => ({ id: e.field.id, status: 'filled' })) }),
    onStateChange: async (_agent, entryId, receipt) => { states.push({ entryId, receipt }); },
    onReceipt: async (_agent, receipt) => { wakes.push(receipt); },
  });
  const request = await service.request('a', 'issuing', form());
  service.settleTurn('a', 'issuing');
  if (action === 'stopped') service.settleTurn('a', 'different-active-turn', 'stopped');
  else if (action === 'dismissed') service.dismiss({ agentId: 'a', requestId: request.requestId });
  else await new Promise(resolve => setTimeout(resolve, 35));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.length, 1);
  assert.equal(states[0].entryId, 'pending-entry');
  assert.equal(states[0].receipt.status, action);
  assert.equal(wakes.length, action === 'stopped' ? 0 : 1);
  const submit = await service.submit({ agentId: 'a', requestId: request.requestId, values: { pw: 'synthetic-private' } });
  assert.equal(submit.status, 'unavailable');
  await record(`pending-${action}`, { cardStatus: action, callbackCount: states.length, wakes: wakes.length, lateSubmitRejected: true });
});
test('fails closed when private transport or preflight is unavailable', async () => {
  const fill = api.createPrivateUserFormFill(async () => undefined);
  const messages = [];
  const service = new api.UserFormService({ emitForm: async (...message) => { messages.push(message); return "entry-1"; }, privateFill: fill });
  const result = await service.request('a', 't', form());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.fields[0].reason, 'driver_unavailable');
  assert.equal(messages.length, 0);
  await record('driver-unavailable', { status: result.status, reason: result.fields[0].reason, cardEmitted: false });
});
test('driver refuses a frame whose host differs from the consented domain', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'user-form-frame-'));
  const callsFile = path.join(dir, 'calls.jsonl');
  await mkdir(path.join(dir, 'node_modules', 'playwright-core'), { recursive: true });
  await writeFile(path.join(dir, 'node_modules', 'playwright-core', 'package.json'), JSON.stringify({ name: 'playwright-core', version: '0.0.0', main: 'index.js' }));
  await writeFile(path.join(dir, 'node_modules', 'playwright-core', 'index.js'), [
    'const fs = require("node:fs");',
    'const record = (...args) => fs.appendFileSync(process.env.FAKE_CALLS_FILE, JSON.stringify(args) + "\\n");',
    'const handle = {',
    '  ownerFrame: async () => ({ url: () => process.env.FAKE_FRAME_URL }),',
    '  isVisible: async () => true, isEnabled: async () => true, isEditable: async () => true,',
    '  fill: async value => record("fill", value),',
    '  evaluate: async () => { record("evaluate"); return null; },',
    '  press: async () => record("press"), dispose: async () => {},',
    '};',
    'const locator = () => ({ count: async () => 1, elementHandle: async () => handle });',
    'const page = { url: () => process.env.FAKE_PAGE_URL, evaluate: async () => process.env.FAKE_PAGE_URL, locator, getByLabel: locator, isClosed: () => false };',
    'exports.chromium = { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [page] }], close: async () => {} }) };',
  ].join('\n'));
  await writeFile(path.join(dir, 'driver.mjs'), api.USER_FORM_PRIVATE_DRIVER_SOURCE);
  const runDriver = async (frameUrl, submitAfterFill = false) => {
    await writeFile(callsFile, '');
    const child = spawn(process.execPath, ['driver.mjs'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FAKE_CALLS_FILE: callsFile, FAKE_FRAME_URL: frameUrl, FAKE_PAGE_URL: 'https://acme.example/login' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const entry = { field: { id: 'code', label: 'Code', type: 'otp', secret: true, target: { kind: 'selector', value: '#code' } }, value: 'synthetic-private' };
    child.stdin.end(JSON.stringify({ cdpPort: 9222, domain: 'acme.example', entries: [entry], submitAfterFill }) + '\n');
    const code = await new Promise(resolve => child.on('close', resolve));
    assert.equal(code, 0, stderr.slice(-200));
    const line = stdout.split('\n').find(item => item.startsWith('__USER_FORM_RESULT__'));
    assert.ok(line, stdout.slice(-200));
    const calls = (await readFile(callsFile, 'utf8')).split('\n').filter(Boolean).map(item => JSON.parse(item));
    return { result: JSON.parse(line.slice('__USER_FORM_RESULT__'.length)), calls };
  };
  try {
    const crossHost = await runDriver('https://evil.example/frame');
    assert.equal(crossHost.result.fields[0].reason, 'domain_mismatch');
    assert.equal(crossHost.calls.some(call => call[0] === 'fill'), false);
    const crossHostEnter = await runDriver('https://evil.example/frame', true);
    assert.equal(crossHostEnter.result.fields[0].reason, 'domain_mismatch');
    assert.equal(crossHostEnter.result.submit.attempted, false);
    assert.equal(crossHostEnter.calls.some(call => call[0] === 'press'), false);
    const sameHost = await runDriver('https://acme.example/frame');
    assert.equal(sameHost.result.fields[0].status, 'filled');
    assert.deepEqual(sameHost.calls.filter(call => call[0] === 'fill'), [['fill', 'synthetic-private']]);
    await record('frame-host-guard', { crossHostRejected: true, noWriteOnCrossHost: true, noEnterOnCrossHost: true, sameHostFilled: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('driver adopts the mapped target and exits without closing the browser', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'user-form-mapped-'));
  const callsFile = path.join(dir, 'calls.jsonl');
  const offset = 40000 + Math.floor(Math.random() * 10000);
  const viewsDir = '/tmp/.sand-browser';
  const viewsFile = path.join(viewsDir, `views-${offset}.json`);
  await mkdir(path.join(dir, 'node_modules', 'playwright-core'), { recursive: true });
  await mkdir(viewsDir, { recursive: true });
  await writeFile(path.join(dir, 'node_modules', 'playwright-core', 'package.json'), JSON.stringify({ name: 'playwright-core', version: '0.0.0', main: 'index.js' }));
  await writeFile(path.join(dir, 'node_modules', 'playwright-core', 'index.js'), [
    'const fs = require("node:fs");',
    'const record = (event) => fs.appendFileSync(process.env.FAKE_CALLS_FILE, JSON.stringify(event) + String.fromCharCode(10));',
    'const handleFor = (id, url) => ({',
    '  ownerFrame: async () => ({ url: () => url }),',
    '  isVisible: async () => true, isEnabled: async () => true, isEditable: async () => true,',
    '  fill: async (value) => record({ event: "fill", id, value }),',
    '  evaluate: async () => { record({ event: "evaluate", id }); return null; },',
    '  press: async () => record({ event: "press", id }), dispose: async () => {},',
    '});',
    'const pageFor = (id, url) => ({',
    '  id, url: () => url, isClosed: () => false, evaluate: async () => url,',
    '  setDefaultTimeout: (ms) => record({ event: "timeout", id, ms }),',
    '  locator: () => ({ count: async () => 1, elementHandle: async () => handleFor(id, url) }),',
    '  getByLabel: () => ({ count: async () => 1, elementHandle: async () => handleFor(id, url) }),',
    '});',
    'const pages = [pageFor("target-mapped", "https://acme.example/older"), pageFor("target-recent", "https://acme.example/newer")];',
    'const context = {',
    '  pages: () => pages,',
    '  newCDPSession: async (page) => ({',
    '    send: async (method) => { record({ event: "send", method, id: page.id }); return method === "Target.getTargetInfo" ? { targetInfo: { targetId: page.id } } : {}; },',
    '    detach: async () => record({ event: "detach", id: page.id }),',
    '  }),',
    '};',
    'exports.chromium = { connectOverCDP: async () => ({ contexts: () => [context], close: () => { record({ event: "close" }); return new Promise(() => {}); } }) };',
  ].join('\n'));
  await writeFile(viewsFile, JSON.stringify({ lastViewId: 'form-under-test', views: { 'form-under-test': 'target-mapped' } }));
  await writeFile(path.join(dir, 'driver.mjs'), api.USER_FORM_PRIVATE_DRIVER_SOURCE);
  await writeFile(callsFile, '');
  const started = Date.now();
  const child = spawn(process.execPath, ['driver.mjs'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FAKE_CALLS_FILE: callsFile } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.end(JSON.stringify({ cdpPort: 9222 + offset, domain: 'acme.example', entries: [{ field: { id: 'pw', label: 'Password', type: 'password', secret: true, target: { kind: 'selector', value: '#pw' } }, value: 'synthetic-private' }] }) + '\n');
  const code = await new Promise(resolve => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish('timeout'); }, 2500);
    child.on('close', value => finish(value));
  });
  const elapsed = Date.now() - started;
  try {
    assert.equal(code, 0, stderr.slice(-200));
    assert.ok(elapsed < 2000, `driver stayed up for ${elapsed}ms`);
    const line = stdout.split('\n').find(item => item.startsWith('__USER_FORM_RESULT__'));
    assert.ok(line, stdout.slice(-200));
    const result = JSON.parse(line.slice('__USER_FORM_RESULT__'.length));
    assert.equal(result.fields[0].status, 'filled', JSON.stringify({ result, stderr: stderr.slice(-500) }));
    assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
    const calls = (await readFile(callsFile, 'utf8')).split('\n').filter(Boolean).map(item => JSON.parse(item));
    assert.deepEqual(calls.filter(call => call.event === 'send' && call.method === 'Target.getTargetInfo').map(call => call.id), ['target-mapped']);
    assert.deepEqual(calls.filter(call => call.event === 'fill').map(call => call.id), ['target-mapped']);
    assert.deepEqual(calls.find(call => call.event === 'timeout'), { event: 'timeout', id: 'target-mapped', ms: 2000 });
    assert.equal(calls.some(call => call.id === 'target-recent' || call.event === 'close'), false);
    await record('mapped-target-no-close', { elapsed, mappedPageFilled: true, recentPageUntouched: true, targetInfoMatched: true, browserCloseEntered: false });
  } finally { await rm(dir, { recursive: true, force: true }); await rm(viewsFile, { force: true }); }
});
test('targetless non-secret fields are never sent to the browser', async () => {
  const fill = api.createPrivateUserFormFill(async () => { throw new Error('must not resolve box'); });
  const service = new api.UserFormService({ emitForm: async () => "entry-1", privateFill: fill });
  const request = await service.request('a', 't', form({ domain: undefined, fields: [{ id: 'note', label: 'Note', type: 'text' }] }));
  const result = await service.submit({ agentId: 'a', requestId: request.requestId, values: { note: 'synthetic-private' } });
  assert.equal(result.fields[0].status, 'not_filled');
  assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  await record('targetless', { status: result.fields[0].status, leaked: false });
});
test('fills a real Chromium page through private stdin with no screenshot or value output', async t => {
  const modules = process.env.USER_FORM_PLAYWRIGHT_MODULES ?? '/Users/Apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
  const { chromium } = await import(pathToFileURL(path.join(modules, 'playwright-core/index.mjs')).href);
  const temp = await mkdtemp(path.join(tmpdir(), 'private-form-'));
  await symlink(modules, path.join(temp, 'node_modules'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/evil') { res.end('<input id="evil">'); return; }
    if (req.url === '/same') { res.end('<input id="same">'); return; }
    res.end('<form onsubmit="event.preventDefault();window.enterCount=(window.enterCount||0)+1"><label for="pw">Password</label><input id="pw"><input id="otp"><input id="note"><input id="hidden" style="display:none"><input id="readonly" readonly><input type="checkbox" id="check"><select id="select"><option value="x">X</option></select><button type="submit">Submit</button><iframe src="/same" title="same"></iframe></form>');
  });
  t.after(() => server.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // A cross-host frame on the same port: 127.0.0.1 is the consented domain, localhost is not.
  const evilFrameSrc = `http://localhost:${port}/evil`;
  const browser = await chromium.launchPersistentContext(path.join(temp, 'profile'), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--remote-debugging-port=0'] });
  t.after(() => browser.close());
  // The driver adopts the most recently opened tab when no view is mapped;
  // keep a throwaway tab ahead of the form so adoption lands on the form.
  await browser.newPage();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.evaluate(src => { const frame = document.createElement('iframe'); frame.id = 'evil-frame'; frame.src = src; document.body.appendChild(frame); }, evilFrameSrc);
  await page.frameLocator('#evil-frame').locator('#evil').waitFor();
  await page.frameLocator('iframe[title="same"]').locator('#same').waitFor();
  const { readFile } = await import('node:fs/promises');
  const cdpPort = Number((await readFile(path.join(temp, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const browserApi = browser.browser();
  const browserCdp = browserApi === null ? undefined : await browserApi.newBrowserCDPSession();
  const { targetInfos } = browserCdp === undefined ? { targetInfos: [] } : await browserCdp.send('Target.getTargets');
  globalThis.__formTargets = targetInfos.filter(info => info.type === 'page').map(info => ({ targetId: info.targetId, url: info.url }));
  const formTarget = globalThis.__formTargets.find(info => info.url.includes('127.0.0.1'));
  assert.ok(formTarget, 'form page target missing');
  await mkdir('/tmp/.sand-browser', { recursive: true });
  await writeFile(path.join('/tmp/.sand-browser', `views-${cdpPort - 9222}.json`), JSON.stringify({ views: { 'form-under-test': formTarget.targetId }, urls: { 'form-under-test': formTarget.url }, lastViewId: 'form-under-test' }));
  const processes = new Map();
  let seq = 0;
  const commands = [];
  const outputs = [];
  const box = {
    windowIndex: cdpPort - 9222, terminalsFolder: temp,
    upload: async (_file, bytes) => writeFile(path.join(temp, 'driver.mjs'), bytes),
    spawn: async input => {
      commands.push(input.command); assert.equal(input.suppressStdinLogging, true);
      const child = spawn(process.execPath, [path.join(temp, 'driver.mjs'), '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEBUG: '' } });
      const state = { child, output: '' }; const id = ++seq; processes.set(id, state);
      child.stdout.on('data', data => { state.output += data; });
      child.stderr.on('data', data => { state.output += data; });
      return { shellId: id, stdinLoggingSuppressed: true };
    },
    writeStdin: async (id, chars) => { processes.get(id).child.stdin.end(chars); },
    download: async file => Buffer.from(processes.get(Number(path.basename(file, '.txt'))).output),
    terminate: async id => { const state = processes.get(id); outputs.push(state.output); state.child.kill(); },
  };
  const fill = api.createPrivateUserFormFill(async () => box);
  const fillField = (target, extra = {}) => fill({ agentId: 'a', domain: '127.0.0.1', signal: new AbortController().signal, submitAfterFill: false, entries: [{ field: { id: 'pw', label: 'Password', type: 'password', target }, value: 'synthetic-private' }], ...extra });
  try {
    const probe = await fillField({ kind: 'selector', value: '#pw' }, { probeOnly: true });
    assert.equal(probe.fields[0].status, 'filled');
    assert.equal(await page.locator('#pw').inputValue(), '');
    const filled = await fillField({ kind: 'selector', value: '#pw' });
    assert.equal(filled.fields[0].status, 'filled');
    assert.equal(await page.locator('#pw').inputValue(), 'synthetic-private');
    const hidden = await fillField({ kind: 'selector', value: '#hidden' });
    assert.equal(hidden.fields[0].reason, 'fill_failed');
    const readonly = await fillField({ kind: 'selector', value: '#readonly' });
    assert.equal(readonly.fields[0].reason, 'fill_failed');
    const stale = await fillField({ kind: 'ref', value: 'e999' });
    assert.equal(stale.fields[0].reason, 'stale_locator');
    const mismatch = await fillField({ kind: 'selector', value: '#pw' }, { domain: 'localhost' });
    assert.equal(mismatch.fields[0].reason, 'domain_mismatch');
    const evilFrame = page.frameLocator('#evil-frame').locator('#evil');
    const sameHostFrame = await fillField({ kind: 'selector', value: '#same' });
    assert.equal(sameHostFrame.fields[0].status, 'filled', JSON.stringify(sameHostFrame.fields[0]));
    assert.equal(await page.frameLocator('iframe[title="same"]').locator('#same').inputValue(), 'synthetic-private');
    const crossHostFrame = await fillField({ kind: 'selector', value: '#evil' });
    assert.equal(crossHostFrame.fields[0].status, 'failed', JSON.stringify(crossHostFrame.fields[0]));
    assert.equal(crossHostFrame.fields[0].reason, 'domain_mismatch');
    assert.equal(await evilFrame.inputValue(), '');
    await page.locator('#pw').evaluate(el => el.addEventListener('input', () => history.pushState({}, '', '/next'), { once: true }));
    const moved = await fillField({ kind: 'selector', value: '#pw' });
    assert.equal(moved.fields[0].reason, 'page_moved');
    const otp = await fillField({ kind: 'selector', value: '#otp' }, { submitAfterFill: true, entries: [{ field: { id: 'otp', label: 'OTP', type: 'otp', target: { kind: 'selector', value: '#otp' } }, value: '123456' }] });
    assert.equal(otp.submit.succeeded, true);
    assert.equal(await page.evaluate(() => window.enterCount), 1);
    const note = await fill({ agentId: 'a', domain: '127.0.0.1', signal: new AbortController().signal, submitAfterFill: false, entries: [{ field: { id: 'note', label: 'Note', type: 'text', target: { kind: 'selector', value: '#note' } }, value: 'plain-note' }] });
    assert.equal(note.fields[0].status, 'filled');
    const snapshot = await realDriverSnapshot(temp, cdpPort - 9222, cdpPort);
    assert.equal(await page.locator('#otp').inputValue(), '123456');
    assert.equal(snapshot.includes('123456'), false);
    assert.ok((snapshot.match(/value="<redacted>"/g) ?? []).length >= 2, 'password and OTP must both be redacted');
    assert.equal(snapshot.includes('plain-note'), true);
    const otpStyle = await page.locator('#otp').evaluate(el => ({ security: getComputedStyle(el).getPropertyValue('-webkit-text-security').trim(), type: el.type, value: el.value, marker: el.getAttribute('data-sand-write-only') }));
    assert.deepEqual(otpStyle, { security: 'disc', type: 'text', value: '123456', marker: '1' });
    const pwStyle = await page.locator('#pw').evaluate(el => ({ security: getComputedStyle(el).getPropertyValue('-webkit-text-security').trim(), type: el.type }));
    assert.deepEqual(pwStyle, { security: 'disc', type: 'text' });
    const noteStyle = await page.locator('#note').evaluate(el => ({ security: getComputedStyle(el).getPropertyValue('-webkit-text-security').trim(), marker: el.getAttribute('data-sand-write-only'), value: el.value }));
    assert.deepEqual(noteStyle, { security: 'none', marker: null, value: 'plain-note' });
    assert.equal(await page.evaluate(() => window.enterCount), 1);
    assert.equal(JSON.stringify([outputs, commands, snapshot]).includes('synthetic-private'), false);
    assert.equal(JSON.stringify([outputs, commands]).includes('123456'), false);
    // A driver that fails to parse would otherwise look like a plain timeout here.
    assert.equal(/SyntaxError|ReferenceError|TypeError/.test(JSON.stringify(outputs)), false, JSON.stringify(outputs).slice(0, 300));
    await record('real-chromium', { filled, hidden, readonly, stale, mismatch, moved, otp, DOMValueMatched: true, probeDidNotWrite: true, EnterCount: 1, valuesInTransportOutput: false, commands, snapshotReadback: { otpValueInPage: true, otpValueInSnapshot: false, otpRedactedMarker: true, nonSecretValueInSnapshot: true }, pixelMask: { otp: otpStyle, password: pwStyle, nonSecret: noteStyle, enterStillOnce: true } });
  } finally {
    for (const state of processes.values()) state.child.kill();
    await browser.close(); server.close(); await rm(temp, { recursive: true, force: true });
  }
});
