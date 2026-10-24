import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { AGENT_DATA_METHODS, buildAgentDataRuntimePort, patchAgentDataMain, patchAgentDataPreload } from '../scripts/lib/agent-data-runtime-patch.mjs';

const port = await buildAgentDataRuntimePort();
const table = 'var MAIN_METHOD_TABLE={getAgentOpenRouterEffort:{args:"object"}};';
const main = table + 'const LOCAL_DOCKER_BOX_CONTAINER="grok-node-local-vm";function runDocker(args){return docker(args)}function req(raw){return raw}function invariant(ok,message){if(!ok)throw Error(message)}function createMainEdgeHandlers(){return{getAgentOpenRouterEffort:async()=>null}}';
const preload = table + 'function createDesktopPreloadBridge(){const edge=(method,args)=>({method,args});return{agent:{getAgentOpenRouterEffort:agentId=>edge("getAgentOpenRouterEffort",{agentId})}}}';
test('source-derived main handlers retain validation, use the installed Docker adapter, and are registered', async () => {
  const calls = [];
  const context = vm.createContext({ Buffer, docker: async args => { calls.push(args); return { ok: true, output: args[0] === 'inspect' ? 'false' : args.at(-1).includes('/memory/log ') ? '2026-10.md' : 'fixture content' }; } });
  const api = vm.runInContext(patchAgentDataMain(main, port) + ';({handlers:createMainEdgeHandlers(),table:MAIN_METHOD_TABLE})', context);
  for (const name of AGENT_DATA_METHODS) {
    assert.equal(api.table[name].args, 'object');
    assert.equal(typeof api.handlers[name], 'function');
  }
  const id = '11111111-1111-4111-8111-111111111111';
  const overview = await api.handlers.getAgentDataOverview({ agentId: id });
  assert.equal(overview.ok, true);
  assert.equal(overview.data.soul, 'fixture content');
  assert.deepEqual(Array.from(overview.data.memoryLogMonths), ['2026-10']);
  assert.equal((await api.handlers.getAgentMemoryLog({ agentId: id, month: '2026-10' })).data.content, 'fixture content');
  assert.equal((await api.handlers.getAgentWorkflowContent({ slug: 'weekly-report' })).data.content, 'fixture content');
  assert(calls.every(args => args[0] === 'inspect' || args[0] === 'exec'));
  await assert.rejects(() => api.handlers.getAgentDataOverview({}), /Choose a Bot/);
  const count = calls.length;
  assert.equal((await api.handlers.getAgentDataOverview({ agentId: '../bad' })).ok, false);
  assert.equal(calls.length, count);
  assert.equal(api.handlers.importAgentMemory, undefined);
});
test('source-derived preload methods invoke only the three canonical methods with the right arguments', () => {
  const api = vm.runInNewContext(patchAgentDataPreload(preload, port) + ';({bridge:createDesktopPreloadBridge(),table:MAIN_METHOD_TABLE})');
  assert.equal(JSON.stringify(api.bridge.agent.getAgentMemoryLog('bot', '2026-10')), JSON.stringify({ method: 'getAgentMemoryLog', args: { agentId: 'bot', month: '2026-10' } }));
  assert.equal(api.bridge.agent.getAgentDataOverview('bot').method, 'getAgentDataOverview');
  assert.equal(api.bridge.agent.getAgentWorkflowContent('weekly').args.slug, 'weekly');
  assert(AGENT_DATA_METHODS.every(name => api.table[name].args === 'object'));
  assert.equal(api.bridge.agent.importAgentMemory, undefined);
});
test('runtime ports reject repeated application or missing anchors', () => {
  assert.throws(() => patchAgentDataMain(patchAgentDataMain(main, port), port), /already/);
  assert.throws(() => patchAgentDataPreload(patchAgentDataPreload(preload, port), port), /already/);
  assert.throws(() => patchAgentDataMain(main.replace('function runDocker(', 'function otherDocker('), port), /adapter missing/);
  assert.throws(() => patchAgentDataPreload(preload.replaceAll('getAgentOpenRouterEffort', 'otherEffort'), port), /missing or ambiguous/);
});
