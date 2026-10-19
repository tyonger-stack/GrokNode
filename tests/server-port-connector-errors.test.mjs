import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['source/packages/agent/tools/mcp/mcp-connector-fault.ts', 'source/packages/agent/tools/mcp/mcp-connector-retry.ts', 'source/packages/agent/tools/mcp/mcp-connector-failure.ts', 'source/packages/agent/tools/mcp/mcp-connector-rate-limits.ts', 'source/shared/node/cursor-backend/backend-mcp-exec.ts', 'source/packages/proto/generated/agent/v1/mcp_exec_pb.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'unused', write: false, external: ['@connectrpc/connect'], logLevel: 'silent' });
function load(file) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', file.text)(module, module.exports, require);
  return module.exports;
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyMcpConnectorFault: classify, parseMcpRetryAfterMs: parse } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-connector-fault.js')));
const { retryMcpRateLimit: retry, waitForMcpRetry: wait } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-connector-retry.js')));
const { classifyConnectorFailure } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-connector-failure.js')));
const { createConnectorRateLimitWaiter } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-connector-rate-limits.js')));
const { createDashboardSandBackendMcpExec } = load(bundled.outputFiles.find(f => f.path.endsWith('backend-mcp-exec.js')));
const { ConnectError, Code } = require('@connectrpc/connect');
const { McpResult } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp_exec_pb.js')));
const wireRoundTrip = value => McpResult.fromBinary(new McpResult(value).toBinary());

test('Retry-After seconds, HTTP-date, invalid, and past dates', () => {
  assert.equal(parse('1.25'), 1250);
  assert.equal(parse('Wed, 21 Oct 2015 07:28:00 GMT', Date.UTC(2015, 9, 21, 7, 27, 58)), 2000);
  assert.equal(parse('0'), 0);
  assert.equal(parse('-1'), 0);
  assert.equal(parse('nonsense'), undefined);
});

test('auth, permanent 403/404, missing tool, argument errors, and malformed boundary', () => {
  for (const input of [{ status: 401 }, { needsAuth: true }, { message: 'invalid_grant' }, { status: 403, message: 'token was revoked' }]) {
    assert.equal(classify(input).kind, 'reauthorize');
  }
  for (const status of [403, 404]) assert.equal(classify({ status }).kind, 'permanent');
  for (const message of ['MCP error -32602: Tool "gone" not found', 'unknown tool: gone', 'no such tool', 'method not found: tools/call']) {
    assert.deepEqual(classify({ message }), { kind: 'permanent', reason: 'unknown_tool' });
  }
  assert.equal(classify({ code: -32601 }).kind, 'permanent');
  for (const message of ['unknown tool arguments', 'tool parameter not found', 'bad input', 'connection closed']) assert.equal(classify({ message }).kind, 'unknown');
  assert.equal(classify({ status: '429' }).kind, 'unknown');
});

test('loopback HTTP 429 waits Retry-After before exactly one retry', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(performance.now());
    res.writeHead(requests.length === 1 ? 429 : 200, { 'Retry-After': '0.08' });
    res.end(requests.length === 1 ? 'rate limited' : 'ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await retry(async signal => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, { signal });
      const text = await response.text();
      return response.ok ? { ok: true, value: text } : { ok: false, fault: classify({ status: response.status, retryAfter: response.headers.get('retry-after'), message: text }) };
    }, { signal: new AbortController().signal });
    assert.deepEqual(result, { ok: true, value: 'ok' });
    assert.equal(requests.length, 2);
    assert.ok(requests[1] - requests[0] >= 80);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('terminal and ambiguous failures never trigger repair/replay; retry budget is finite', async () => {
  for (const fault of [classify({ status: 403 }), classify({ status: 404 }), classify({ status: 401 }), classify({ code: -32601 }), classify({ message: 'socket closed after write' })]) {
    let calls = 0;
    const outcome = await retry(async () => { calls++; return { ok: false, fault }; }, { signal: new AbortController().signal });
    assert.equal(calls, 1);
    assert.equal(outcome.fault, fault);
  }
  let calls = 0;
  await retry(async () => { calls++; return { ok: false, fault: classify({ status: 429, retryAfter: '0' }) }; }, { signal: new AbortController().signal, maxAttempts: 3 });
  assert.equal(calls, 3);
  const failure = new Error('ambiguous write');
  await assert.rejects(retry(async () => { throw failure; }, { signal: new AbortController().signal }), error => error === failure);
});

test('abort during long Retry-After and before call; no timer overflow or extra invocation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const operation = retry(async () => { calls++; return { ok: false, fault: { kind: 'rate_limited', retryAfterMs: 3_000_000_000 } }; }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(retry(async () => { calls++; return { ok: true }; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(wait(Infinity, new AbortController().signal), RangeError);
});

test('real backend catch preserves safe metadata through protobuf binary round trip', async () => {
  const original = new ConnectError('rate limited secret-error-sentinel', Code.ResourceExhausted, { 'retry-after': '0.09', authorization: 'secret-header-sentinel' });
  let captured;
  const executor = createDashboardSandBackendMcpExec({
    getAccessToken: async () => '', getMachineId: async () => '',
    createClient: () => ({ executeSandMcpTool: async () => { throw original; } }),
    recordExecError: (id, error) => { assert.equal(id, 'fixture-call'); captured = error; },
  });
  const result = await executor.executeTool({ serverIdentifier: 'gmail--account-A', toolName: 'fixture', toolCallId: 'fixture-call', args: { secret: 'secret-args-sentinel' } });
  assert.deepEqual(classifyConnectorFailure(wireRoundTrip(result)), { kind: 'rate_limited', retryAfterMs: 90 });
  assert.doesNotMatch(JSON.stringify(result), /secret-(?:error|header|args)-sentinel/);
  assert.equal(JSON.parse(result.result.value.error).connectCode, Code.ResourceExhausted);
  assert.equal(JSON.parse(result.result.value.error).status, 429);
  assert.deepEqual(classifyConnectorFailure(captured), { kind: 'rate_limited', retryAfterMs: 90 });
  assert.deepEqual(classifyConnectorFailure({ error: 'rate limited', retryAfterMs: 125 }), { kind: 'rate_limited', retryAfterMs: 125 });
  assert.equal(classifyConnectorFailure({ result: { case: 'error', value: { error: 'invalid_grant' } } }).kind, 'reauthorize');
});

test('generated success content union handles mixed image/text and only explicit tool errors', () => {
  for (const [text, kind] of [['rate limited', 'rate_limited'], ['invalid_grant', 'reauthorize'], ['no such tool', 'permanent']]) {
    const content = [{ content: { case: 'image', value: { data: new Uint8Array([1]), mimeType: 'image/png' } } },
      { content: { case: 'text', value: { text } } }];
    assert.equal(classifyConnectorFailure(wireRoundTrip({ result: { case: 'success', value: { isError: true, content } } })).kind, kind);
    assert.equal(classifyConnectorFailure(wireRoundTrip({ result: { case: 'success', value: { isError: false, content } } })).kind, 'unknown');
  }
  assert.equal(classifyConnectorFailure({ isError: true, content: [{ type: 'image', data: '' }, { type: 'text', text: 'no such tool' }] }).kind, 'permanent');
  assert.equal(classifyConnectorFailure('{malformed-json').kind, 'unknown');
});

test('backend auth and permanent errors survive wire; canceled/deadline failures never become retryable', async () => {
  for (const [code, kind] of [[Code.Unauthenticated, 'reauthorize'], [Code.PermissionDenied, 'permanent'], [Code.NotFound, 'permanent'], [Code.Canceled, 'unknown'], [Code.DeadlineExceeded, 'unknown']]) {
    const executor = createDashboardSandBackendMcpExec({
      getAccessToken: async () => '', getMachineId: async () => '',
      createClient: () => ({ executeSandMcpTool: async () => { throw new ConnectError('transport failure', code, { 'retry-after': '1' }); } }),
    });
    const result = await executor.executeTool({ serverIdentifier: 'account', toolName: 'fixture', toolCallId: 'id', args: {} });
    assert.equal(classifyConnectorFailure(wireRoundTrip(result)).kind, kind);
  }
  assert.equal(classifyConnectorFailure(new ConnectError('rate limited', Code.DeadlineExceeded, { 'retry-after': '1' })).kind, 'unknown');
});

test('account A cooldown does not block B; cancellation retains A deadline for other callers', async () => {
  const limiter = createConnectorRateLimitWaiter();
  limiter.defer('gmail--account-A', { kind: 'rate_limited', retryAfterMs: 150 });
  const controller = new AbortController();
  let aFinished = false;
  const a = limiter.wait('gmail--account-A', controller.signal).then(() => { aFinished = true; });
  await limiter.wait('gmail--account-B', new AbortController().signal);
  assert.equal(aFinished, false);
  controller.abort();
  await assert.rejects(a, { name: 'AbortError' });
  const started = performance.now();
  await limiter.wait('gmail--account-A', new AbortController().signal);
  assert.ok(performance.now() - started >= 100);
});
