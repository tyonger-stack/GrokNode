import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { build, transform } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import * as React from 'react';
import * as compiler from 'react/compiler-runtime';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { patchConversationComputerCard, RConversationOfficialCardFactory } from '../scripts/lib/conversation-computer-card-renderer-patch.mjs';

const repo = resolve(import.meta.dirname, '..');
const evidence = resolve(process.env.COMPUTER_CARD_REGISTRATION_EVIDENCE ?? resolve(repo, '.omo/evidence/conversation-computer-card-registration-20261015'));
mkdirSync(evidence, { recursive: true });
const observations = [];
const acceptance = { productionRegistrationConnected: false, createsCardsFromEmptyTranscript: false, completionWireCompatible: false, englishCatalogCorrect: false, registrationBeforePause: false, staleRequestProtected: false, legacyInputsCompatible: false };
writeFileSync(resolve(evidence, 'registration-verdict.json'), JSON.stringify({ running: true, overallFeatureAcceptance: false }) + '\n');
const capture = (scenario, data) => {
  observations.push({ scenario, ...data });
  writeFileSync(resolve(evidence, 'registration-observations.json'), JSON.stringify(observations, null, 2) + '\n');
};
const modules = {
  './source/host/runner/tools/turn-toolset.ts': ['createTurnToolsetFactoriesForTurn', 'buildTurnTools'],
  './source/host/runner/tools/box-help-tool.ts': ['createRequestBoxHelpTool'],
  './source/packages/context/core.ts': ['createContext'],
  './source/host/extensions/session/box-handoff-service.ts': ['BoxHandoffService'],
  './source/host/extensions/session/agent-db.ts': ['SandAgentDb'],
  './source/host/extensions/transcript/turn-runtime.ts': ['TurnRuntime'],
  './source/host/extensions/transcript/send-pipeline.ts': ['SendPipeline'],
  './source/host/extensions/transcript/session-runtime.ts': ['SessionRuntime'],
  './source/host/extensions/transcript/box-handoff-resume.ts': ['BoxHandoffResume'],
  './source/host/extensions/transcript/transcript-store.ts': ['getTranscript', 'setTranscript'],
  './source/host/sand-host.ts': ['SandHost'],
  './source/host/host-gateway-api.ts': ['createHostGatewayApi'],
  './source/host/gateway-protocol.ts': ['SAND_GATEWAY_COMMANDS'],
  './source/node-agent-coordinator/gateway/gateway-client.ts': ['CoordinatorGatewayClient'],
  './source/node-agent-coordinator/gateway/box-vnc-proxy.ts': ['proxifyForeverBoxStatus'],
  './frontend/src/recovered/features/conversation/cards/transcript-card/protocol.ts': ['projectTranscriptCardEntries'],
};
const auditedSources = [...Object.keys(modules), './source/host/host-runner-composition.ts', './source/host/runner/production-turn-run-shell-adapter.ts', './source/host/runner/sand-agent-runner.ts', './source/shared/forever-box.ts', './scripts/lib/conversation-computer-card-renderer-patch.mjs'];
const sourceHashes = Object.fromEntries(auditedSources.map(file => [file, createHash('sha256').update(readFileSync(resolve(repo, file))).digest('hex')]));
const providerFile = resolve(repo, 'source/host/host-runner-composition.ts');
const providerText = readFileSync(providerFile, 'utf8');
const providerJS = (await transform(providerText, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const providerAST = parse(providerJS, { ecmaVersion: 'latest', sourceType: 'module' });
let providerNode;
function findProvider(node) {
  if (node.type === 'VariableDeclarator' && node.id.name === 'createTurnToolsetFactoryProvider') providerNode = node.init;
  for (const value of Object.values(node)) if (Array.isArray(value)) value.filter(v => v?.type).forEach(findProvider); else if (value?.type) findProvider(value);
}
findProvider(providerAST);assert.ok(providerNode);
const providerBody = providerJS.slice(providerNode.start, providerNode.end);
const methodNode = providerAST.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'method');assert.ok(methodNode);
writeFileSync(resolve(evidence, 'production-provider.txt'), providerBody);
function actualProvider(boundaries, agentId) {
  const context = vm.createContext({
    session: { id: 'factory-root-not-the-requester' }, autoReviewGate: undefined, autoReviewController: undefined,
    extractProductionTurnAutoReviewConversationContext() {}, remoteBox: {}, isSharedRoomTurn: false,
    ...boundaries,
  });
  vm.runInContext(providerJS.slice(methodNode.start, methodNode.end) + ';var produce=' + providerBody + ';', context);
  return context.produce({}, {}, agentId);
}
const bundle = resolve(evidence, 'registration-source.cjs');
await build({
  stdin: { contents: Object.entries(modules).map(([file, names]) => `export {${names.join(',')}} from ${JSON.stringify(file)};`).join('\n'), resolveDir: repo },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error',
});
const api = createRequire(import.meta.url)(bundle);
after(() => {
  for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(createHash('sha256').update(readFileSync(resolve(repo, file))).digest('hex'), hash, 'Concurrent source modification: rerun this probe for ' + file);
  writeFileSync(resolve(evidence, 'registration-verdict.json'), JSON.stringify({
    scope: 'isolated execution of checkout source; no native app/model/network/container',
    ...acceptance,
    serverRegistrationImplementationExists: true,
    overallFeatureAcceptance: Object.values(acceptance).every(Boolean),
    sourceHashes,
    scenarios: observations.map(x => x.scenario),
  }, null, 2) + '\n');
  assert.ok(Object.values(acceptance).every(Boolean), 'All repaired-path acceptance scenarios must execute and pass');
});
const source = readFileSync(resolve(process.env.COMPUTER_CARD_BASELINE ?? resolve(repo, '../.tmp-app-verify-20261013/src/app/dist/renderer/assets/index-UbX-y3il.js')), 'utf8');
const patched = patchConversationComputerCard(source);
const ast = parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
function declaration(name) {
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name);
  return patched.slice(node.start, node.end);
}
const style = vm.createContext({});
vm.runInContext('var lie={},x_e;' + declaration('C2t') + ';var I2t=C2t();' + declaration('Fe'), style);
const View = RConversationOfficialCardFactory(React, compiler, jsx, style.Fe, (...x) => x.filter(Boolean).join(' '), props => jsx.jsx('i', { 'data-icon-name': props.name }), (_en, zh) => zh);
function renderCard(card) {
  return renderToStaticMarkup(jsx.jsx(View, { instruction: card.instruction, status: card.status, screen: { agentId: card.agentId, dataUrl: card.snapshotDataUrl }, surface: 'elevated', onOpen() {}, onHandBack() {}, onDismiss() {} }));
}
const turn = { autoReviewModes: { hostShell: 'off', boxShell: 'off', mcp: 'off', computer: 'off', automationWrite: 'off', cloudAgent: 'off', subagentLaunch: 'off' } };
function toolset(factories, overrides = {}) {
  return api.buildTurnTools({
    factories, isSubagentRunner: false, isSharedRoomRunner: false, isBoxScopedSubagent: false,
    isSystemPromptOverridden: false, remoteBoxHasDesktop: true, getConversationId: () => 'A',
    getRemoteBoxAvailable: () => true, cloudAgentsDisabledByTeam: () => true, spotlightEnabled: () => false,
    ...overrides,
  }, turn);
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const dir = mkdtempSync(resolve(evidence, 'isolated-'));
  const events = [], resumed = [], ends = [], calls = [], statuses = new Map();
  const sessions = new Map(['A', 'B', 'child'].map(id => [id, { id, db: new api.SandAgentDb(resolve(dir, id, 'store.db')), agentStore: { async dispose() {} } }]));
  const tm = {
    execution: { canExecute: true },
    roster: { emit: e => events.push(e), emitAgentUpdate: async id => events.push({ agentUpdate: id }), applyAgentUpdateToOutline() {} },
    sessionStore: {
      agentExists: id => sessions.has(id),
      async setAwaitingUserResponse(id, state) { sessions.get(id).db.setAwaitingUserResponse(state); },
      async openSession(id) { return sessions.get(id); },
      markSessionActivity() {}, markSessionViewedNow() {},
    },
    runLifecycle: {
      trackProgressFromUpdate() {}, trackComposingFromUpdate() {}, trackRetryingFromUpdate() {}, trackActivityFromUpdate() {},
      beginSessionRun() {}, endSessionRun() {}, lastRequestIdBySession: new Map(),
      enqueueExclusiveRun: async (_id, run) => run(),
    },
    groupChat: { isGroupSession: () => false },
    runnerRegistry: { getRunner: s => ({ run: async (prompt, options) => resumed.push({ agentId: s.id, prompt, options }) }) },
    ackObligations: { fulfillAckObligation() {}, mintAckRunToken: id => 'ack-' + id, retireAckRunToken() {} },
  };
  tm.sessions = new api.SessionRuntime(tm);
  for (const [id, session] of sessions) tm.sessions.liveSessions.set(id, session);
  tm.sessions.resolveBackgroundSession = async id => sessions.get(id);
  tm.sessions.activeSession = sessions.get('A');
  tm.sessions.inMemoryTranscriptAgentId = 'A';
  api.setTranscript([]);
  tm.appendEntry = (...args) => tm.sessions.appendEntry(...args);
  tm.sendPipeline = new api.SendPipeline(tm);
  tm.turnRuntime = new api.TurnRuntime(tm);
  const resume = new api.BoxHandoffResume(tm);
  tm.createAwaitingStateSink = () => resume.createAwaitingStateSink();
  tm.resolveBoxRequestEntry = (...args) => tm.sendPipeline.resolveBoxRequestEntry(...args);
  tm.resumeAfterBoxHandoff = (agentId, trigger) => {
    calls.push({ stage: 'resume', agentId, trigger });
    return resume.resumeAfterBoxHandoff(agentId, trigger);
  };
  const host = new api.SandHost({ now: () => 1700000000000 });
  const service = new api.BoxHandoffService({
    grabScreenshot: async id => Buffer.from('isolated-snapshot-' + id),
    onStarted: value => { void host.hostEvents.emit('session.box-handoff-started', value); },
    onEnded: value => { ends.push(value); return host.hostEvents.emit('session.box-handoff-ended', value, { failureMode: 'reject' }); },
    onStatusChanged: agentId => { void host.hostEvents.emit('session.box-handoff-status-changed', { agentId }); },
  });
  const box = { prewarm: async () => {}, getStatus: async ({ id }) => ({ agentId: id, phase: 'ready', vncUrl: 'http://127.0.0.1:6080/vnc.html' }) };
  const ports = { transcript: tm, session: { startHandoff: request => {
    calls.push({ stage: 'start', agentId: request.agentId });
    const outcome = service.start(request);
    calls.push({ stage: outcome.kind, agentId: request.agentId, requestId: outcome.requestId });
    return outcome;
  }, pendingHandoff: id => service.get(id), endHandoff: (id, trigger) => service.end(id, trigger) }, 'forever-box': box, 'host-upgrade': { getVersionState: () => ({}) }, 'auto-review': { pendingAwaitingState: () => null } };
  const extensions = { api: id => ports[id] ?? {} };
  host.hostExtensions = extensions;
  host.listeners.add(event => {
    events.push(event);
    if (event.channel === 'forever-box') statuses.set(event.payload.agentId, api.proxifyForeverBoxStatus(event.payload, { primaryUrl: 'http://test-proxy.invalid/vnc.html', forkBaseUrl: 'http://test-proxy.invalid', networkToken: 'isolated' }));
  });
  host.wireBoxHandoffEvents();
  const gateway = api.createHostGatewayApi({ extensions, hostEvents: host.hostEvents, decorateForeverBoxStatus: s => host.decorateForeverBoxStatus(s), getHealth: () => ({ isBusy: false }) });
  const coordinator = Object.create(api.CoordinatorGatewayClient.prototype);
  coordinator.request = async (method, args) => {
    calls.push({ boundary: 'coordinator-command', method, args });
    return { result: await api.SAND_GATEWAY_COMMANDS[method](gateway, JSON.stringify(args)) };
  };
  let selected = 'B', owner, monitors = [];
  const runtime = {
    selection: { select: id => { selected = id; calls.push({ select: id }); }, waitForReady: async () => {}, readCurrentAgentId: () => selected },
    foreverBox: { getStatus: id => statuses.get(id), ensure: id => calls.push({ ensure: id }), handBack: (id, trigger) => coordinator.dispatchCommand('handBackForeverBox', { id, trigger }) },
  };
  const renderer = vm.createContext({ S: { useMemo: f => f() }, Mee: () => owner, Qe: () => runtime, NTn: id => ({ handoff: statuses.get(id)?.handoff ?? null }), MTn: () => monitors, W1t: new Map(), Dzn: { openComputer: id => calls.push({ openComputer: id ?? null, selected }) }, ETn: error => { throw error; } });
  vm.runInContext([declaration('Obn'), declaration('RConversationComputerCardActions'), declaration('Dbn')].join('\n'), renderer);
  function binding(id, row, children = []) { owner = id; monitors = children; return renderer.Dbn(row.id, undefined, row); }
  function providerInputs(id, { fallback = false } = {}) {
    const emit = (via, update) => {
      calls.push({ stage: 'emit', agentId: id, via, update: structuredClone(update) });
      tm.turnRuntime.handleAgentUpdate(update, sessions.get(id));
      calls.push({ stage: 'persisted', agentId: id, requestId: update.boxHandoff?.requestId });
    };
    const pause = (via, reason) => {
      const pending = service.get(id);
      assert.ok(pending, 'pause must follow service registration');
      assert.ok(sessions.get(id).db.getTranscriptEntries().some(e => e.boxRequestId === pending.requestId), 'pause must follow durable card emission');
      calls.push({ stage: 'pause', agentId: id, via, reason, requestId: pending.requestId });
    };
    const produced = actualProvider({ extensions, hooks: { transport: { onUpdate: update => emit('transport', update) } }, builtRunner: { endTurnAwaitingUser: reason => pause('runner', reason) } }, id);
    assert.equal(typeof produced.createRequestBoxHelpToolInputs, 'function');
    const scopedTurn = { ...turn, ackToken: 'ack-' + id, ...fallback ? {} : { emitUpdate: update => emit('turn', update), endThisRunAwaitingUser: reason => pause('turn', reason) } };
    return { produced, scopedTurn };
  }
  async function request(id, instruction, options) {
    const { produced, scopedTurn } = providerInputs(id, options);
    // Other real provider slots require unrelated live services. The box-help
    // slot is copied by identity, never implemented or replaced in the fixture.
    const factories = api.createTurnToolsetFactoriesForTurn({ createRequestBoxHelpToolInputs: produced.createRequestBoxHelpToolInputs }, scopedTurn, {});
    const tool = toolset(factories).getAllTools().find(t => t.name === 'request_box_help');
    assert.ok(tool);
    const ctx = api.createContext('handoff-registration-probe');
    const interaction = { getAbortSignal: () => ctx.signal, emitPartialToolCall() {}, executeToolCall: (ctx, _call, _id, run) => run(ctx) };
    const result = await tool.execute(ctx, interaction, (async function* () { yield JSON.stringify({ instruction, reason: 'auth' }); })(), { toolCallId: 'request-' + id, workspacePaths: [] });
    await settle(); await settle();
    assert.equal(result.result.case, 'success', result.result.value?.error);
    return result;
  }
  return { dir, sessions, service, statuses, events, calls, ends, resumed, request, binding, providerInputs, handBackViaGateway: (id, trigger) => coordinator.dispatchCommand('handBackForeverBox', { id, trigger }), close() { for (const s of sessions.values()) s.db.close(); api.setTranscript([]); } };
}

test('actual production provider registers box help for ordinary Bots, excluding shared rooms and subagents', () => {
  const f = fixture();
  try {
    const { produced, scopedTurn } = f.providerInputs('B');
    const input = produced.createRequestBoxHelpToolInputs(scopedTurn, {});
    assert.equal(input.dependencies.getAgentId(), 'B', 'explicit owner must win over factory session.id');
    const factories = api.createTurnToolsetFactoriesForTurn({ createRequestBoxHelpToolInputs: produced.createRequestBoxHelpToolInputs }, scopedTurn, {});
    const names = toolset(factories).getAllTools().map(t => t.name);
    assert.ok(names.includes('request_box_help'));
    assert.equal(toolset(factories, { isSharedRoomRunner: true }).getAllTools().some(t => t.name === 'request_box_help'), false);
    assert.equal(toolset(factories, { isSubagentRunner: true, isComputerUseSubagent: true }).getAllTools().some(t => t.name === 'request_box_help'), false);
    acceptance.productionRegistrationConnected = true;
    capture('production-registration-connected', { productionRegistrationConnected: true, actualProviderExecuted: true, actualProviderKeys: Object.keys(produced), suppliedAgentId: 'B', factorySessionId: 'factory-root-not-the-requester', sharedRoomAndSubagentExcluded: true, toolNames: names, source: providerFile, sourceSha256: sourceHashes['./source/host/host-runner-composition.ts'] });
  } finally { f.close(); }
});

test('actual tool creates durable per-agent waiting entries and snapshots without pre-existing cards', async () => {
  const f = fixture();
  try {
    for (const id of ['A', 'B']) assert.deepEqual(f.sessions.get(id).db.getTranscriptEntries(), []);
    await f.request('A', 'Controlled login A');
    await f.request('B', 'Controlled login B');
    const rows = {};
    for (const id of ['A', 'B']) {
      const entries = f.sessions.get(id).db.getTranscriptEntries();assert.equal(entries.length, 1);
      const entry = entries[0];rows[id] = entry;
      assert.equal(entry.kind, 'send-message');assert.ok(entry.boxRequestId);
      assert.equal(entry.boxInstruction, 'Controlled login ' + id);assert.equal(entry.boxResolution, undefined);
      assert.equal(f.statuses.get(id).handoff.requestId, entry.boxRequestId);
      assert.match(f.statuses.get(id).handoff.snapshotDataUrl, /^data:image\/webp;base64,/);
      assert.equal(f.sessions.get(id).db.getAwaitingUserResponse().reason, 'Controlled login ' + id);
      const projected = api.projectTranscriptCardEntries(entries);assert.equal(projected.entries[0].boxRequestId, entry.boxRequestId);
      const card = f.binding(id, projected.entries[0]);assert.equal(card.card.status, 'waiting');
      const html = renderCard(card.card);assert.match(html, /接管/);assert.match(html, new RegExp('Controlled login ' + id));
      writeFileSync(resolve(evidence, 'registered-' + id + '.html'), html);
      await card.openBox();assert.deepEqual(f.calls.at(-1), { ensure: id });
      assert.equal(f.ends.length, 0, 'takeover must never resolve');
    }
    assert.notEqual(rows.A.boxRequestId, rows.B.boxRequestId);
    await f.request('A', 'Duplicate request must not emit a second entry');
    assert.equal(f.sessions.get('A').db.getTranscriptEntries().length, 1);
    acceptance.createsCardsFromEmptyTranscript = true;
    capture('actual-production-provider-registration-to-PV', { actualProductionProvider: true, isolatedDbDir: f.dir, entries: rows, statuses: Object.fromEntries(f.statuses), calls: f.calls, priorCardCount: 0, finalCardCount: 2, duplicateCardCount: 1 });
  } finally { f.close(); }
});

test('actual coordinator Done/Skip persist handed_back/dismissed and resume the correct Bot', async () => {
  const f = fixture();
  try {
    await f.request('A', 'Complete A');await f.request('B', 'Decline B');
    for (const [id, action, expected] of [['A', 'handBack', 'handed_back'], ['B', 'dismiss', 'dismissed']]) {
      const before = f.sessions.get(id).db.getTranscriptEntries()[0];
      await f.binding(id, before)[action]();await settle();
      const after = f.sessions.get(id).db.getTranscriptEntries()[0];
      assert.equal(after.boxRequestId, before.boxRequestId);
      assert.equal(after.boxResolution, expected);
      assert.equal(f.service.get(id), null);assert.equal(f.statuses.get(id).handoff, null);
      const projected = api.projectTranscriptCardEntries([after]).entries[0];
      const binding = f.binding(id, projected);
      const html = renderCard(binding.card);assert.doesNotMatch(html, /状态不可用/);
      assert.match(html, action === 'handBack' ? /完成/ : /已跳过/);
      assert.equal(f.resumed.at(-1).agentId, id);
      assert.equal(f.resumed.at(-1).options.hidden, true);
      writeFileSync(resolve(evidence, 'resolved-' + id + '.html'), html);
      capture('resolution-contract-' + action, { owner: id, expected, actual: after.boxResolution, compatible: true, persistedEntry: after, endedEvent: f.ends.at(-1), resumed: f.resumed.at(-1), html: resolve(evidence, 'resolved-' + id + '.html') });
    }
    assert.match(f.resumed.find(r => r.agentId === 'B').prompt, /dismissed your box help request/);
    assert.match(f.resumed.find(r => r.agentId === 'A').prompt, /handed the box back/);
    acceptance.completionWireCompatible = true;
  } finally { f.close(); }
});

test('PV English catalog uses the corrected official English labels', () => {
  const English = RConversationOfficialCardFactory(React, compiler, jsx, style.Fe, (...x) => x.filter(Boolean).join(' '), () => null, en => en);
  const html = renderToStaticMarkup(jsx.jsx(English, { instruction: 'isolated', status: 'waiting', surface: 'elevated' }));
  assert.match(html, /Action needed/);
  assert.match(html, /Take over/);
  assert.doesNotMatch(html, /Azione richiesta|Prendi il controllo/);
  acceptance.englishCatalogCorrect = true;
  writeFileSync(resolve(evidence, 'english-catalog-corrected.html'), html);
  capture('english-catalog-corrected', { correctEnglish: true, actualHeading: 'Action needed', artifact: resolve(evidence, 'english-catalog-corrected.html'), source: 'dist/renderer/assets/index.eager-app-fbmFpqqH.js embedded English catalog' });
});

test('a retained callback cannot resolve a newly registered request for the same agent', async () => {
  const f = fixture();
  try {
    await f.request('A', 'First request');
    const prior = f.sessions.get('A').db.getTranscriptEntries()[0];
    const retained = f.binding('A', prior);
    await f.service.end('A', 'button');
    await f.request('A', 'Second request');
    const current = f.service.get('A');
    assert.notEqual(current.requestId, prior.boxRequestId);
    assert.equal(await retained.handBack(), false);
    assert.equal(await retained.dismiss(), false);
    assert.equal(f.service.get('A').requestId, current.requestId);
    assert.equal(f.ends.length, 1);
    acceptance.staleRequestProtected = true;
    capture('real-registration-stale-request-guard', { oldRequestId: prior.boxRequestId, currentRequestId: current.requestId, endedCount: f.ends.length, pendingRequestPreserved: true, isolatedDbDir: f.dir });
  } finally { f.close(); }
});

test('production endRequested emits and persists before pause; duplicate requests pause without another emission', async () => {
  for (const fallback of [false, true]) {
    const f = fixture();
    try {
      const { produced, scopedTurn } = f.providerInputs('B', { fallback });
      const direct = produced.createRequestBoxHelpToolInputs(scopedTurn, {}).dependencies;
      direct.endTurn();
      assert.equal(f.calls.length, 0, 'endTurn only marks endRequested, without cancelling or pausing');
      await f.request('B', 'Ordering check', { fallback });
      const first = f.calls.filter(c => c.stage);
      assert.deepEqual(first.map(c => c.stage), ['start', 'started', 'emit', 'persisted', 'pause']);
      const emitted = first.find(c => c.stage === 'emit');
      assert.equal(emitted.update.ackToken, 'ack-B');
      assert.equal(emitted.update.boxHandoff.requestId, f.service.get('B').requestId);
      assert.equal(emitted.update.boxHandoff.instruction, 'Ordering check');
      assert.equal(emitted.via, fallback ? 'transport' : 'turn');
      assert.equal(first.at(-1).via, fallback ? 'runner' : 'turn');
      const offset = f.calls.length;
      await f.request('B', 'Duplicate must not replace instruction', { fallback });
      const repeated = f.calls.slice(offset).filter(c => c.stage);
      assert.deepEqual(repeated.map(c => c.stage), ['start', 'already-pending', 'pause']);
      assert.equal(f.sessions.get('B').db.getTranscriptEntries().length, 1);
      capture('registration-before-pause-' + (fallback ? 'fallback' : 'turn'), { first, repeated, emptyEndTurnSideEffects: true, durableRows: 1, isolatedDbDir: f.dir });
    } finally { f.close(); }
  }
  acceptance.registrationBeforePause = true;
});

test('legacy and conflicting inputs persist compatible states and emit canonical resume triggers', async () => {
  const cases = [
    ['completed-button', { resolution: 'completed', trigger: 'button' }, 'handed_back', 'button'],
    ['cancelled-dismissed', { resolution: 'cancelled', trigger: 'dismissed' }, 'dismissed', 'dismissed'],
    ['string-cancel', 'cancel', 'dismissed', 'dismissed'],
    ['string-cancelled', 'cancelled', 'dismissed', 'dismissed'],
    ['cancelled-no-trigger', { resolution: 'cancelled' }, 'dismissed', 'dismissed'],
    ['cancelled-button', { resolution: 'cancelled', trigger: 'button' }, 'dismissed', 'dismissed'],
    ['completed-cancel', { resolution: 'completed', trigger: 'cancel' }, 'handed_back', 'button'],
    ['handed-back-dismissed', { resolution: 'handed_back', trigger: 'dismissed' }, 'handed_back', 'button'],
    ['viewer-closed', 'viewer-closed', 'handed_back', 'viewer-closed'],
  ];
  for (const [name, input, expectedResolution, expectedTrigger] of cases) {
    const f = fixture();
    try {
      await f.request('B', 'Legacy resolution ' + name);
      const requestId = f.service.get('B').requestId;
      await f.handBackViaGateway('B', input);
      const row = f.sessions.get('B').db.getTranscriptEntries()[0];
      assert.equal(row.boxRequestId, requestId, name);
      assert.equal(row.boxResolution, expectedResolution, name);
      assert.equal(f.ends.length, 1, name);
      assert.deepEqual(f.ends[0], { agentId: 'B', requestId, resolution: expectedResolution, trigger: expectedTrigger }, name);
      const dispatch = f.calls.filter(c => c.stage === 'resume');
      assert.deepEqual(dispatch, [{ stage: 'resume', agentId: 'B', trigger: expectedTrigger }], name);
      assert.equal(f.resumed.at(-1).agentId, 'B', name);
      assert.match(f.resumed.at(-1).prompt, expectedTrigger === 'dismissed' ? /dismissed your box help request/ : expectedTrigger === 'viewer-closed' ? /closed the box desktop viewer/ : /handed the box back/);
      capture('legacy-canonical-' + name, { input, expectedResolution, expectedTrigger, persistedEntry: row, endedEvent: f.ends[0], resumeDispatch: dispatch[0], resumed: f.resumed.at(-1), isolatedDbDir: f.dir });
    } finally { f.close(); }
  }
  acceptance.legacyInputsCompatible = true;
});
