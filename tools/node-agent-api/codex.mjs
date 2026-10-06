import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, identifier } from './errors.mjs';
import { resourceNames } from './runtime/common.mjs';
import { normalizeApplicationId } from './runtime/applications.mjs';

const execute = promisify(execFile);
const outcomes = { inProgress: 'running', completed: 'completed', failed: 'failed', interrupted: 'interrupted' };

export function createCodexAdapter({ runtime, harness, roster, namespace, stateRoot, registryFile, artifactRoot }) {
  let store, unsubscribe, tail = Promise.resolve();
  const liveThreads = new Set();
  const busyActions = new Set();
  function requireIdleBot(session) { if (store.list().some(row => (runtime.shared || row.agent_id === session.agent_id) && row.task_status === 'running')) throw new ApiError(409, 'turn_active', 'Interrupt active work before changing the shared project or environment'); }
  function enqueue(action) { tail = tail.then(action); return tail; }
  async function syncRegistry() {
    if (!registryFile) return;
    const bots = await roster.agents(), environments = [];
    for (const bot of bots) if ((await runtime.status(bot.id)).running) environments.push(...(await runtime.descriptor(bot.id)).environments);
    await writeFile(registryFile, JSON.stringify({ version: 1, namespace, environments }), { mode: 0o600 });
  }
  const adapter = {
    backend: 'codex_harness', writesEnabled: true, independentSessions: true,
    isolation: runtime.shared ? 'shared_container_separate_display' : 'per_bot_container', rawDesktopProtected: !runtime.shared, externalAdapter: !!runtime.shared,
    diagnostic: error => harness.redact(error?.message ?? 'Unknown Harness failure'),
    agents: () => roster.agents(), requireAgent: id => roster.requireAgent(id), createAgent: input => roster.createAgent(input),
    attachStore(value) {
      store = value;
      for (const session of store.list()) if (session.task_status === 'running') {
        for (const turn of session.turns ?? []) if (turn.status === 'running') turn.status = 'unknown';
        for (const action of session.actions ?? []) if (action.status === 'pending') action.status = 'unknown';
        void enqueue(async () => { await store.update(session.id, { turns: session.turns, actions: session.actions, task_status: 'unknown', active_turn_id: null }); await store.append(session.id, 'node.session.turn.unknown', { reason: 'service_restart', replayed: false }); });
      }
      unsubscribe = harness.subscribe(event => { void enqueue(async () => {
        const message = event.message, params = message.params ?? {};
        const matching = store.list().filter(session => session.agent_id === event.botId && (session.thread_id === params.threadId || message.method === 'lab/status'));
        for (const session of matching) {
          const turns = structuredClone(session.turns ?? []), actions = structuredClone(session.actions ?? []);
          if (message.method === 'lab/status') {
            liveThreads.delete(session.thread_id);
            const wasRunning = session.task_status === 'running';
            for (const turn of turns) if (turn.status === 'running') { turn.status = 'unknown'; turn.ended_at = Date.now(); }
            for (const action of actions) if (action.status === 'pending') action.status = 'unknown';
            await store.update(session.id, { turns, actions, ...(wasRunning ? { task_status: 'unknown', active_turn_id: null } : {}) });
            await store.append(session.id, wasRunning ? 'node.session.turn.unknown' : 'node.harness.disconnected', { reason: 'harness_disconnected', replayed: false });
            continue;
          }
          if (params.turn?.id && ['turn/started', 'turn/completed'].includes(message.method)) {
            let turn = turns.find(turn => turn.id === params.turn.id);
            if (!turn) { turn = { id: params.turn.id, object: 'node.turn', started_at: Date.now(), items: [], status: 'running', usage: null }; turns.push(turn); }
            let status = outcomes[params.turn.status] ?? 'unknown';
            if (status === 'interrupted' && session.cancel_requested === turn.id) status = 'cancelled';
            turn.status = status; turn.error = params.turn.error ?? null;
            if (message.method === 'turn/completed') turn.ended_at = Date.now();
            await store.update(session.id, { turns, task_status: status, active_turn_id: status === 'running' ? turn.id : null });
          }
          if (message.method === 'thread/tokenUsage/updated') {
            const turn = turns.find(turn => turn.id === params.turnId);
            if (turn) { turn.usage = { native: params.tokenUsage, cost: null, source: 'thread/tokenUsage/updated' }; await store.update(session.id, { turns }); }
          }
          if (message.id != null && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/call'].includes(message.method)) {
            actions.push({ object: 'node.required_action', id: 'act_' + randomUUID(), request_id: message.id, thread_id: params.threadId, turn_id: params.turnId, item_id: params.itemId, type: message.method, status: 'pending', details: params, created_at: Date.now() });
            await store.update(session.id, { actions });
          }
          if (params.item?.id) {
            const turn = turns.find(turn => turn.id === params.turnId);
            if (turn) { const index = turn.items.findIndex(item => item.id === params.item.id); const item = { ...params.item, turn_id: params.turnId }; if (index < 0) turn.items.push(item); else turn.items[index] = item; await store.update(session.id, { turns }); }
          }
          await store.append(session.id, 'node.harness.event', { method: message.method, params });
        }
      }).catch(() => { /* Persistence faults keep the tail rejected: subsequent operations fail closed. */ }); });
    },
    async bindSession(session) {
      await roster.requireAgent(session.agent_id);
      await runtime.ensure(session.agent_id); await syncRegistry();
      const result = await harness.request(session.agent_id, 'thread/start', {});
      if (!result.thread?.id) throw new ApiError(502, 'harness_schema', 'Harness did not return a thread');
      await store.update(session.id, { thread_id: result.thread.id, context: 'codex_harness', task_status: 'idle', turns: [], actions: [], ...(runtime.shared ? { executor_container_id: (await runtime.status(session.agent_id)).containerId } : {}) });
      liveThreads.add(result.thread.id);
    },
    async resume(session) {
      if (!session.thread_id) throw new ApiError(409, 'thread_missing', 'Session has no Harness thread');
      if (runtime.shared) {
        await runtime.ensure(session.agent_id);
        const current = await runtime.status(session.agent_id);
        if (session.executor_container_id && session.executor_container_id !== current.containerId) { await harness.disconnect(session.agent_id); liveThreads.delete(session.thread_id); }
        await store.update(session.id, { executor_container_id: current.containerId });
      }
      if (liveThreads.has(session.thread_id)) return;
      await runtime.ensure(session.agent_id);
      try { await harness.request(session.agent_id, 'thread/resume', { threadId: session.thread_id }); }
      catch (error) {
        if (session.turns?.length || !error.message.includes('no rollout found')) throw error;
        const empty = await harness.request(session.agent_id, 'thread/start', {});
        if (!empty.thread?.id) throw new ApiError(502, 'harness_schema', 'Harness did not return an empty thread');
        await store.update(session.id, { thread_id: empty.thread.id });
        liveThreads.add(empty.thread.id);
        await store.append(session.id, 'node.thread.empty_recreated', { replayed: false }); return;
      }
      liveThreads.add(session.thread_id);
      const restored = await harness.request(session.agent_id, 'thread/read', { threadId: session.thread_id });
      if (Array.isArray(restored.thread?.turns)) {
        const turns = restored.thread.turns.map(turn => ({ object: 'node.turn', id: turn.id, status: turn.status === 'interrupted' && session.cancel_requested === turn.id ? 'cancelled' : outcomes[turn.status] ?? 'unknown', items: (turn.items ?? []).map(item => ({ ...item, turn_id: turn.id })), usage: session.turns?.find(old => old.id === turn.id)?.usage ?? null, request_id: session.turns?.find(old => old.id === turn.id)?.request_id ?? null }));
        await store.update(session.id, { turns, task_status: turns.at(-1)?.status ?? 'idle' });
      }
    },
    async inputSession(session, text, requestId) {
      await tail;
      if (session.task_status === 'running') throw new ApiError(409, 'turn_active', 'Wait for or cancel the active turn before submitting another');
      await this.resume(session);
      const result = await harness.request(session.agent_id, 'turn/start', { threadId: session.thread_id, input: [{ type: 'text', text }] });
      if (!result.turn?.id) throw new ApiError(502, 'harness_schema', 'Harness did not return a turn');
      await enqueue(async () => {
        const turns = structuredClone(session.turns);
        let turn = turns.find(turn => turn.id === result.turn.id);
        if (!turn) { turn = { object: 'node.turn', id: result.turn.id, status: outcomes[result.turn.status] ?? 'unknown', started_at: Date.now(), items: [], usage: null }; turns.push(turn); }
        turn.request_id = requestId;
        await store.update(session.id, { turns, active_turn_id: turn.status === 'running' ? turn.id : null, task_status: turn.status });
      });
      return { accepted: true, turn_id: result.turn.id };
    },
    async itemsSession(session) { await tail; return (session.turns ?? []).flatMap(turn => turn.items); },
    async cancel(session, turnId) {
      await tail; identifier(turnId);
      if (session.active_turn_id !== turnId || session.task_status !== 'running') throw new ApiError(409, 'turn_not_active', 'Turn does not belong to the active session');
      await store.update(session.id, { cancel_requested: turnId });
      const processes = [...new Set((session.turns?.find(turn => turn.id === turnId)?.items ?? []).filter(item => item.type === 'commandExecution' && item.status === 'inProgress' && /^[0-9]{1,10}$/.test(item.processId ?? '')).map(item => item.processId))];
      await harness.request(session.agent_id, 'turn/interrupt', { threadId: session.thread_id, turnId });
      const stopped = [];
      for (const processId of processes) {
        const result = await harness.request(session.agent_id, 'thread/backgroundTerminals/terminate', { threadId: session.thread_id, processId });
        stopped.push({ process_id: processId, terminated: result.terminated === true });
      }
      if (stopped.length) await store.append(session.id, 'node.turn.processes.stopped', { turn_id: turnId, processes: stopped });
      return { accepted: true, turn_id: turnId, completed: false };
    },
    async handoff(session) { requireIdleBot(session); await harness.request(session.agent_id, 'thread/unsubscribe', { threadId: session.thread_id }); if (runtime.shared) await harness.disconnect(session.agent_id); liveThreads.delete(session.thread_id); return { thread_id: session.thread_id, bot_id: session.agent_id, target: 'codex_cli', replayed: false }; },
    async actions(session) { await tail; return (session.actions ?? []).filter(action => action.status === 'pending'); },
    async answer(session, actionId, decision) {
      await tail; const actions = structuredClone(session.actions ?? []), action = actions.find(action => action.id === actionId && action.status === 'pending');
      if (!action || !['accept', 'decline'].includes(decision)) throw new ApiError(409, 'action_unavailable', 'Approval is not pending or decision is invalid');
      if (busyActions.has(actionId)) throw new ApiError(409, 'action_busy', 'Approval is already being answered');
      busyActions.add(actionId);
      try {
      action.status = 'responding'; await store.update(session.id, { actions });
      if (action.type === 'item/tool/call') {
        if (action.details.tool !== 'node_approved_shell') throw new ApiError(409, 'tool_unavailable', 'Tool is not implemented');
        let result = { denied: true, executed: false };
        if (decision === 'accept') result = await runtime.approvedShell(session.agent_id, action.details.arguments?.command);
        result = harness.redact(result);
        await harness.answer(session.agent_id, action.request_id, { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success: decision === 'accept' && result.exit_code === 0 });
      } else await harness.answer(session.agent_id, action.request_id, { decision });
      action.status = decision; await store.update(session.id, { actions });
      await store.append(session.id, 'node.action.resolved', { action_id: actionId, decision });
      return { answered: true };
      } finally { busyActions.delete(actionId); }
    },
    async applications(session) { return runtime.applications(session.agent_id); },
    async launchApplication(session, kind) { if (!runtime.launchApplication) throw new ApiError(409, 'unsupported', 'Application launch is unavailable on this backend'); return runtime.launchApplication(session.agent_id, kind); },
    async desktop(id, target, mode = 'view') {
      if (runtime.shared) return runtime.desktop(id, target, mode);
      await roster.requireAgent(id); const status = await runtime.status(id);
      if (!status.running) throw new ApiError(409, 'desktop_unavailable', 'Bot environment is not running');
      const descriptor = await runtime.descriptor(id);
      const authToken = descriptor.environments[0].authToken;
      target = target ?? { type: 'desktop' };
      if (!['view', 'control'].includes(mode)) throw new ApiError(400, 'desktop_mode_invalid', 'Invalid desktop mode');
      const port = mode === 'view' ? status.desktopReadOnlyPort : status.desktopInteractivePort;
      let path = '/desktop', applicationId = null;
      if (target.type === 'application') {
        applicationId = normalizeApplicationId(target.application_id);
        if (!applicationId) throw new ApiError(400, 'application_invalid', 'Invalid application id');
        const windows = await runtime.applications(id);
        if (!windows.some(app => app.application_id === applicationId)) throw new ApiError(404, 'application_not_found', 'Application window is no longer available');
        path = `/application/${applicationId}`;
      } else if (target.type !== 'desktop') {
        throw new ApiError(400, 'desktop_target_invalid', 'Invalid desktop target');
      }
      return { object: 'node.environment', id: 'nenv_' + id, agent_id: id, type: 'grok_node_codex', target: { type: target.type, application_id: applicationId }, isolation: 'per_bot_container', container: status.containerName, containerId: status.containerId, containerGenerationImmutableId: status.containerId, applicationId, display: 1, websocketUrl: `ws://127.0.0.1:${port}${path}`, websocketHeaders: { authorization: 'Bearer ' + authToken } };
    },
    async viewerAsset(asset, botId) {
      if (!/^(vnc\.html|package\.json|(?:app|core|vendor)\/[A-Za-z0-9_./-]+)$/.test(asset) || asset.split('/').includes('..')) throw new ApiError(404, 'not_found', 'Asset unavailable');
      const status = await runtime.status(botId);
      if (!status.running) throw new ApiError(409, 'desktop_unavailable', 'Bot environment unavailable');
      return (await execute('docker', ['exec', status.containerName, 'cat', '/usr/share/novnc/' + asset], { encoding: null, maxBuffer: 4 * 1024 * 1024 })).stdout;
    },
    async clipboard(session, text) { if (text === undefined) return { text: await runtime.clipboard.read(session.agent_id) }; await runtime.clipboard.write(session.agent_id, text); return { written: true }; },
    async project(session, action, input) { if (action === 'import') requireIdleBot(session); const result = await runtime.project(session.agent_id, action, input); if (action === 'import' && Array.isArray(result?.conflicts) && result.conflicts.length) throw new ApiError(409, 'import_conflict', 'Import refuses to overwrite: ' + result.conflicts.slice(0, 8).join(', ')); return result; },
    async exportProject(session, reserve = async () => {}) {
      requireIdleBot(session);
      await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
      const id = 'art_' + randomUUID(), file = path.join(artifactRoot, id + '.tgz');
      const inventory = await runtime.project(session.agent_id, 'inventory');
      await reserve(id, inventory.bytes + 1024 * 1024);
      const result = await runtime.exportProject(session.agent_id, file);
      await reserve(id, result.size);
      const artifact = { id, name: 'project.tgz', size: result.size, sha256: createHash('sha256').update(await readFile(file)).digest('hex'), file };
      await store.update(session.id, { artifacts: [...(session.artifacts ?? []), artifact] });
      const { file: privatePath, ...publicArtifact } = artifact;
      return { artifact: { ...publicArtifact, download_url: `/v1/agents/sessions/${session.id}/artifacts/${id}/content` } };
    },
    async recreate(session) {
      requireIdleBot(session);
      await harness.disconnect(session.agent_id); liveThreads.delete(session.thread_id);
      const result = await runtime.recreate(session.agent_id); await syncRegistry();
      await store.append(session.id, 'node.environment.recreated', { processes_restored: false });
      return { running: result.running, preserved_files: true, processes_restored: false };
    },
    async restore(session, input) {
      requireIdleBot(session);
      identifier(input.backup_id);
      const n = resourceNames(namespace, session.agent_id), backup = path.join(stateRoot, namespace, n.key, 'backups', input.backup_id);
      await harness.disconnect(session.agent_id); liveThreads.delete(session.thread_id);
      await runtime.ensure(session.agent_id); await runtime.restore(session.agent_id, backup);
      await store.append(session.id, 'node.environment.restored', { backup_id: input.backup_id, processes_restored: false });
      return { restored: true, processes_restored: false };
    },
    async artifact(session, id) { const artifact = session.artifacts?.find(a => a.id === id); if (!artifact || !path.resolve(artifact.file).startsWith(path.resolve(artifactRoot) + path.sep) || !(await lstat(artifact.file)).isFile()) throw new ApiError(404, 'not_found', 'Artifact not found'); return { bytes: await readFile(artifact.file), name: artifact.name }; },
    async backup(session) {
      requireIdleBot(session);
      const result = await runtime.backup(session.agent_id), home = await harness.home(session.agent_id);
      const archive = path.join(result.path, 'mac-session.tgz');
      await execute('tar', ['-czf', archive, '-C', home, '.'], { timeout: 60000 });
      await writeFile(path.join(result.path, 'session.json'), JSON.stringify(session), { mode: 0o600 });
      return { backup_id: path.basename(result.path), preserved: ['source', 'uncommitted_changes', 'conversation', 'logs'], processes_restored: false };
    },
    async flush() { await tail; },
    async close() { unsubscribe?.(); await harness.close(); await tail; await runtime.close?.(); },
  };
  return adapter;
}
