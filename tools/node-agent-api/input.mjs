import { randomUUID, createHash } from 'node:crypto';
import { ApiError, badRequest, identifier, object } from './errors.mjs';

export function metadata(value) {
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16 || Object.entries(value).some(([key, text]) => key.length > 64 || typeof text !== 'string' || text.length > 512)) throw badRequest('metadata must contain up to 16 string values (keys <=64, values <=512 characters)');
  return value;
}

export function message(input, headerKey) {
  object(input, ['events', 'idempotency_key']);
  if (!Array.isArray(input.events) || input.events.length !== 1) throw badRequest('Submit one event per request');
  const event = input.events[0];
  let text;
  if (event?.type === 'message') { object(event, ['type', 'text']); text = event.text; }
  else if (event?.type === 'agent.session.input.message') {
    object(event, ['type', 'input']);
    if (!Array.isArray(event.input) || event.input.length !== 1) throw badRequest('One user input item is supported');
    const item = object(event.input[0], ['role', 'content']);
    if (item.role !== 'user' || !Array.isArray(item.content) || item.content.length !== 1) throw badRequest('One user input_text content is supported');
    const content = object(item.content[0], ['type', 'text']);
    if (content.type !== 'input_text') throw badRequest('Only input_text is supported');
    text = content.text;
  } else throw badRequest('Only message input is supported; cancellation and tool results are unavailable');
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw badRequest('Message must contain 1..16000 characters');
  if (headerKey !== undefined && input.idempotency_key !== undefined && headerKey !== input.idempotency_key) throw badRequest('Header and body idempotency keys disagree');
  const key = headerKey ?? input.idempotency_key;
  const requestId = key === undefined ? 'nreq_' + randomUUID() : identifier(key);
  return { text, requestId, fingerprint: createHash('sha256').update(text).digest('hex'), legacyFingerprint: createHash('sha256').update(JSON.stringify({ type: 'message', text })).digest('hex') };
}

export function createInputHandler({ adapter, store }) {
  const queues = new Map();
  return async (session, input, headerKey) => {
    const normalized = message(input, headerKey);
    const previous = queues.get(session.id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const { text, requestId, fingerprint, legacyFingerprint } = normalized;
      if (session.status === 'closed') throw new ApiError(409, 'session_closed', 'Session attachment is closed');
      const old = Object.hasOwn(session.requests, requestId) ? session.requests[requestId] : undefined;
      if (old) {
        if (![fingerprint, legacyFingerprint].includes(old.fingerprint)) throw new ApiError(409, 'idempotency_conflict', 'Request key already used with different input');
        return { request_id: requestId, status: old.status, replayed: true, completed: false };
      }
      if (Object.keys(session.requests).length >= 1000) throw new ApiError(409, 'request_limit', 'Session request limit reached');
      // Reserve an outcome event before contacting the backend.
      if (session.events.length >= 9999) throw new ApiError(409, 'event_limit', 'Session event limit reached');
      await store.update(session.id, { status: 'pending', requests: { ...session.requests, [requestId]: { fingerprint, status: 'pending' } } });
      try {
        const accepted = adapter.inputSession ? await adapter.inputSession(session, text, requestId) : await adapter.input(session.agent_id, text, requestId);
        await store.update(session.id, { requests: { ...session.requests, [requestId]: { ...session.requests[requestId], status: 'accepted' } }, status: session.status === 'closed' ? 'closed' : 'accepted' });
        await store.append(session.id, 'node.session.input.accepted', { request_id: requestId });
        return { request_id: requestId, status: 'accepted', completed: false, ...(accepted?.turn_id ? { turn_id: accepted.turn_id } : {}) };
      } catch (error) {
        const status = ['writes_disabled', 'unsafe_backend', 'turn_active', 'session_closed', 'unsupported'].includes(error.code) ? 'rejected' : 'unknown';
        await store.update(session.id, { requests: { ...session.requests, [requestId]: { ...session.requests[requestId], status } }, status: session.status === 'closed' ? 'closed' : status });
        await store.append(session.id, 'node.session.input.' + status, { request_id: requestId, replayed: false });
        throw error;
      }
    });
    queues.set(session.id, task);
    try { return await task; } finally { if (queues.get(session.id) === task) queues.delete(session.id); }
  };
}
