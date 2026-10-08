import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { privateDirectory } from './runtime/common.mjs';
import { ApiError, badRequest, identifier } from './errors.mjs';
import { atomicJson, readPrivateJson } from './persistence.mjs';

export async function createStore(directory) {
  await privateDirectory(directory);
  const file = join(directory, 'sessions.json'), emitter = new EventEmitter();
  const data = await readPrivateJson(file, []);
  if (!Array.isArray(data) || data.some(s => !s || typeof s.id !== 'string' || typeof s.agent_id !== 'string' || !Array.isArray(s.events))) throw new Error('Invalid session store');
  const sessions = new Map(data.map(s => [s.id, s]));
  let recovered = false;
  for (const session of sessions.values()) {
    session.metadata ??= {};
    session.requests ??= {};
    const pending = Object.entries(session.requests).filter(([, request]) => request.status === 'pending');
    for (const [requestId, request] of pending) {
      request.status = 'unknown';
      session.events.push({ id: 'nevt_' + randomUUID(), type: 'node.session.input.unknown', session_id: session.id, created_at: Math.floor(Date.now() / 1000), data: { request_id: requestId, reason: 'service_restart', replayed: false } });
      recovered = true;
    }
    if (session.status === 'pending') { session.status = 'unknown'; recovered = true; }
  }
  let saving = Promise.resolve(), fault;
  let writeGuard = async () => {};
  function transaction(action) {
    const task = saving.then(async () => { if (fault) throw fault; return action(); });
    saving = task.catch(() => {}); return task;
  }
  async function persist(values) {
    const snapshot = JSON.parse(JSON.stringify(values));
    await writeGuard(snapshot);
    try { await atomicJson(file, snapshot); } catch (error) { fault = error; throw error; }
  }
  function get(id) { const value = sessions.get(id); if (!value) throw new ApiError(404, 'not_found', 'Session not found'); return value; }
  async function commitBatch(operations) {
    if (!Array.isArray(operations)) throw badRequest('Commit operations must be an array');
    const copy = structuredClone(operations);
    for (const operation of copy) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw badRequest('Invalid commit operation');
      identifier(operation.id);
      const { changes = {}, events = [] } = operation;
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.hasOwn(changes, 'id') || Object.hasOwn(changes, 'events')) throw badRequest('Invalid session changes');
      if (!Array.isArray(events)) throw badRequest('Commit events must be an array');
      for (const event of events) {
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || !event.type) throw badRequest('Invalid commit event');
      }
    }
    return transaction(async () => {
      if (!copy.length) return [];
      const candidates = new Map(), committed = [];
      for (const { id, changes = {}, events = [] } of copy) {
        const value = candidates.get(id) ?? get(id);
        if (value.events.length + events.length > 10000) throw new ApiError(409, 'event_limit', 'Session event limit reached');
        const added = events.map(({ type, data }) => ({ id: 'nevt_' + randomUUID(), type, session_id: id, created_at: Math.floor(Date.now() / 1000), data }));
        candidates.set(id, { ...value, ...changes, events: [...value.events, ...added] });
        committed.push(...added);
      }
      await persist([...sessions.values()].map(row => candidates.get(row.id) ?? row));
      for (const [id, next] of candidates) Object.assign(get(id), next);
      for (const event of committed) { emitter.emit(event.session_id, event); emitter.emit('*', event); }
      return committed;
    });
  }
  async function commit(id, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('Invalid session commit');
    return commitBatch([{ id, changes: patch.changes, events: patch.events }]);
  }
  async function append(id, type, payload) { return (await commit(id, { events: [{ type, data: payload }] }))[0]; }
  if (recovered) await persist([...sessions.values()]);
  const refreshes = new Map();
  return {
    get, list: () => [...sessions.values()], append, commit, commitBatch,
    async create(agentId, metadata = {}, options = {}) {
      return transaction(async () => {
      // GrokNode has one transcript per bot. API sessions are explicit attachments.
      const existing = [...sessions.values()].find(s => s.agent_id === agentId && s.status !== 'closed' && (options.backend === undefined || (s.backend ?? (s.context === 'codex_harness' ? 'codex' : 'grok')) === options.backend));
      if (existing && options.reuse !== false) return { session: existing, created: false };
      const session = { object: 'node.agent.session', id: 'nsess_' + randomUUID(), agent_id: agentId, status: 'idle', created_at: Math.floor(Date.now() / 1000), context: 'grok_node_bot_transcript', quota_user_id: options.quota_user_id ?? 'owner', metadata, events: [], requests: {} };
      if (options.backend) Object.assign(session, { backend: options.backend, context: options.context });
      if (options.model) Object.assign(session, { model: options.model, model_source: options.model_source });
      if (options.endpoint_revision) Object.assign(session, { endpoint_revision: options.endpoint_revision, reasoning_effort: options.reasoning_effort ?? null });
      const event = { id: 'nevt_' + randomUUID(), type: 'node.session.created', session_id: session.id, created_at: session.created_at, data: { agent_id: agentId, ...(session.model ? { model: session.model, model_source: session.model_source } : {}) } };
      session.events.push(event); await persist([...sessions.values(), session]); sessions.set(session.id, session); emitter.emit('*', event); return { session, created: true };
      });
    },
    async refreshItems(id, load) {
      if (refreshes.has(id)) return refreshes.get(id);
      const task = (async () => {
        const items = await load(), session = get(id);
        const fingerprint = createHash('sha256').update(JSON.stringify(items)).digest('hex');
        if (session.items_fingerprint !== fingerprint) {
          await append(id, 'node.session.items.changed', { fingerprint, item_count: items.length, persisted_by: 'grok_node' });
          await this.update(id, { items_fingerprint: fingerprint });
        }
        return items;
      })();
      refreshes.set(id, task);
      try { return await task; } finally { refreshes.delete(id); }
    },
    subscribe(id, listener) { get(id); emitter.on(id, listener); return () => emitter.off(id, listener); },
    subscribeAll(listener) { emitter.on('*', listener); return () => emitter.off('*', listener); },
    async update(id, changes) { await commit(id, { changes }); return get(id); },
    async flush() { await Promise.allSettled([...refreshes.values()]); await saving; if (fault) throw fault; },
    snapshot() { return JSON.stringify([...sessions.values()]); },
    setWriteGuard(guard) { writeGuard = guard; },
  };
}
