import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildMemoryImportRuntimePort, patchMemoryImportMain, patchMemoryImportPreload } from '../scripts/lib/memory-import-runtime-patch.mjs';

// The 0770 import pipeline compiles the desktop edge from source, so this legacy
// hydrate-dist patch helper is no longer in the build path — but it bundles the same
// shared contract, so keep it green against the official 0.77.0 handler shape: the
// renderer composes the turn, the edge validates and forwards (prompt + richText).
const port = await buildMemoryImportRuntimePort();
const table = 'var MAIN_METHOD_TABLE={getAgentOpenRouterEffort:{args:"object"}};';
const main = table + 'async function startLocalDockerBox(path){return connect(path)}function req(raw){return raw}function invariant(ok,message){if(!ok)throw Error(message)}function createMainEdgeHandlers(deps2){return{getAgentOpenRouterEffort:async()=>null}}';
const preload = table + 'function createDesktopPreloadBridge(){const edge=(method,args)=>({method,args});return{agent:{getAgentOpenRouterEffort:agentId=>edge("getAgentOpenRouterEffort",{agentId})}}}';
function runtime(response) {
  const calls = [], connections = [];
  const context = vm.createContext({ AbortSignal, connect: async path => { connections.push(path); return { baseUrl: 'http://fixture.invalid', token: 'fixture-token' }; }, fetch: async (...args) => { calls.push(args); return response; } });
  const api = vm.runInContext(patchMemoryImportMain(main, port) + ';({methods:MAIN_METHOD_TABLE,handler:createMainEdgeHandlers({settingsStore:{settingsPath:"/fixture/settings.json"}}).importAgentMemory})', context);
  return { ...api, calls, connections };
}
test('canonical import forwards one authenticated turn carrying prompt and richText', async () => {
  const api = runtime({ ok: true });
  assert.equal(api.methods.importAgentMemory.args, 'object');
  const prompt = '添加这些来自我另一个 AI 助手的记忆\n\n<imported_memory>\n## 偏好\n- 用户喜欢简短回复。\n</imported_memory>';
  const richText = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '添加这些来自我另一个 AI 助手的记忆' }] }] });
  assert.equal((await api.handler({ agentId: '  main-bot  ', prompt, richText })).ok, true);
  assert.deepEqual(api.connections, ['/fixture/settings.json']);
  assert.equal(api.calls.length, 1);
  const [url, request] = api.calls[0], body = JSON.parse(request.body);
  assert.equal(url, 'http://fixture.invalid/api/sendPrompt');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.authorization, 'Bearer fixture-token');
  assert.equal(body.agentId, 'main-bot');
  assert.match(body.clientNonce, /^memory-import-/);
  assert.equal(body.prompt, prompt, 'the composed turn passes through untouched');
  assert.equal(body.richText, richText, 'richText rides along when present');
});
test('omitting richText keeps the wire shape minimal; invalid turns are rejected before connecting', async () => {
  const api = runtime({ ok: true });
  await api.handler({ agentId: 'main', prompt: 'turn' });
  assert.equal(Object.keys(JSON.parse(api.calls[0][1].body)).includes('richText'), false);
  const invalid = runtime({ ok: true });
  for (const payload of [{ agentId: '', prompt: 'x' }, { agentId: 'main', prompt: '' }, { agentId: 'main', prompt: 'x'.repeat(100_001) }, { agentId: 'main', prompt: 'x', richText: 42 }]) await assert.rejects(() => invalid.handler(payload));
  assert.equal(invalid.connections.length, 0);
  assert.equal(invalid.calls.length, 0);
  const failed = runtime({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'Bot offline' });
  const result = await failed.handler({ agentId: 'main', prompt: '用户偏好' });
  assert.equal(result.ok, false);
  assert(result.reason.includes('503') && result.reason.includes('Bot offline'));
});
test('preload registers only the existing import method and forwards its exact request shape', () => {
  const api = vm.runInNewContext(patchMemoryImportPreload(preload, port) + ';({methods:MAIN_METHOD_TABLE,agent:createDesktopPreloadBridge().agent})');
  assert.equal(api.methods.importAgentMemory.args, 'object');
  assert.equal(JSON.stringify(api.agent.importAgentMemory('main', 'turn')), JSON.stringify({ method: 'importAgentMemory', args: { agentId: 'main', prompt: 'turn' } }));
  assert.equal(JSON.stringify(api.agent.importAgentMemory('main', 'turn', '<doc/>')), JSON.stringify({ method: 'importAgentMemory', args: { agentId: 'main', prompt: 'turn', richText: '<doc/>' } }));
  assert.throws(() => patchMemoryImportMain(patchMemoryImportMain(main, port), port), /already/);
  assert.throws(() => patchMemoryImportPreload(patchMemoryImportPreload(preload, port), port), /already/);
});
