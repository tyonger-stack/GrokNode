import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['source/shared/node/mcp/tools-discovery.ts', 'source/packages/agent/tools/mcp/mcp-result-boundary.ts', 'source/packages/agent/tools/mcp/mcp-connector-failure.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'unused', write: false, logLevel: 'silent' });
function load(file) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', file.text)(module, module.exports, require);
  return module.exports;
}
const require = createRequire(import.meta.url);
const { createMcpToolsDiscovery } = load(bundled.outputFiles.find(f => f.path.endsWith('tools-discovery.js')));
const { createMcpTransportError } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-result-boundary.js')));
const { classifyConnectorFailure } = load(bundled.outputFiles.find(f => f.path.endsWith('mcp-connector-failure.js')));

function faultEnvelope(fault, connectCode = 8, status = 429) {
  return JSON.stringify({ type: 'mcp-connector-failure', version: 1, connectCode, status, fault });
}
function errorReceipt(message) {
  return { result: { case: 'error', value: { error: message } } };
}
function fakeCore(backendMcpExec) {
  return {
    localOnly: false,
    backendMcpExec,
    definitionSource: {
      getServerUrlForIdentifier: async () => 'https://connector.example/mcp',
      getStdioServerConfigs: async () => ({}),
    },
    settingsStore: () => ({
      getMcpDisabledToolsByServerId: () => ({}),
      getRawMcpCustomInstructionByServerId: () => '',
      getRawMcpCustomInstruction: () => '',
    }),
    lastAccountDisplayConfig: () => null,
  };
}
function callArgs(providerIdentifier) {
  return { providerIdentifier, name: 'fixture-tool', toolName: 'fixture-tool', args: {}, toolCallId: 'call-' + providerIdentifier };
}

test('confirmed 429 defers the account gate and spaces the next explicit call without hidden replay', async () => {
  let calls = 0;
  const backend = { executeTool: async () => { calls++; return calls === 1 ? errorReceipt(faultEnvelope({ kind: 'rate_limited', retryAfterMs: 150 })) : { result: { case: 'success', value: { isError: false, content: [] } } }; } };
  const discovery = createMcpToolsDiscovery(fakeCore(backend), {});
  const first = await discovery.executeTool(undefined, callArgs('gmail--account-A'));
  assert.equal(first.result.case, 'error');
  assert.equal(calls, 1);
  const started = performance.now();
  const second = await discovery.executeTool(undefined, callArgs('gmail--account-A'));
  const waited = performance.now() - started;
  assert.equal(second.result.case, 'success');
  assert.equal(calls, 2);
  assert.ok(waited >= 100, 'gate held the second explicit call for ' + waited + 'ms');
});

test('one account cooldown does not block a different providerIdentifier', async () => {
  const backend = { executeTool: async (request) => request.serverIdentifier === 'gmail--account-A' ? errorReceipt(faultEnvelope({ kind: 'rate_limited', retryAfterMs: 500 })) : { result: { case: 'success', value: { isError: false, content: [] } } } };
  const discovery = createMcpToolsDiscovery(fakeCore(backend), {});
  const cooled = await discovery.executeTool(undefined, callArgs('gmail--account-A'));
  assert.equal(cooled.result.case, 'error');
  const started = performance.now();
  const other = await discovery.executeTool(undefined, callArgs('slack--account-B'));
  assert.equal(other.result.case, 'success');
  assert.ok(performance.now() - started < 400, 'unrelated account must not wait out the cooldown');
});

test('thrown unknown transport failure becomes a terminal receipt without re-fire', async () => {
  let calls = 0;
  const backend = { executeTool: async () => { calls++; throw new Error('socket closed after write'); } };
  const discovery = createMcpToolsDiscovery(fakeCore(backend), {});
  const result = await discovery.executeTool(undefined, callArgs('slack--account-C'));
  assert.equal(result.result.case, 'error');
  assert.equal(calls, 1);
  assert.equal(classifyConnectorFailure(result).kind, 'unknown');
});

test('transport boundary maps connector faults onto terminal decisions and preserves retry metadata', () => {
  const auth = createMcpTransportError(faultEnvelope({ kind: 'reauthorize' }, 16, 401));
  const directAuth = createMcpTransportError('invalid_grant');
  assert.equal(auth.classification, directAuth.classification);
  const gone = createMcpTransportError(faultEnvelope({ kind: 'permanent', reason: 'unknown_tool' }, 5, 404));
  const directGone = createMcpTransportError('MCP error -32601: method not found');
  assert.equal(gone.classification, directGone.classification);
  const limited = createMcpTransportError(faultEnvelope({ kind: 'rate_limited', retryAfterMs: 125 }));
  assert.deepEqual(classifyConnectorFailure(limited.message), { kind: 'rate_limited', retryAfterMs: 125 });
});

test('a cancelled gate wait aborts without touching the backend', async () => {
  let calls = 0;
  const backend = { executeTool: async () => { calls++; return errorReceipt(faultEnvelope({ kind: 'rate_limited', retryAfterMs: 5000 })); } };
  const discovery = createMcpToolsDiscovery(fakeCore(backend), {});
  await discovery.executeTool(undefined, callArgs('gmail--account-D'));
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discovery.executeTool({ signal: controller.signal }, callArgs('gmail--account-D')), { name: 'AbortError' });
  assert.equal(calls, 1);
});
