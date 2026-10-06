import { createHash } from 'node:crypto';
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory } from './runtime/common.mjs';
import { ApiError, badRequest, identifier } from './errors.mjs';
import { acquireStateLock, atomicJson, readPrivateJson } from './persistence.mjs';

const hash = value => createHash('sha256').update(identifier(value)).digest('hex');
const natural = value => Number.isSafeInteger(value) && value >= 0;
const defaults = { requests: 120, windowMs: 60000, streams: 4, storageBytes: 64 * 1024 * 1024 };
const actions = ['request', 'stream', 'storage', 'authorization', 'webhook', 'key_rotation'];
const outcomes = ['allowed', 'denied', 'succeeded', 'failed'];

/** Deliberately never copies arbitrary fields, headers, error messages or request bodies. */
export function sanitizeAuditRecord(input, now = Date.now()) {
  if (!input || !actions.includes(input.action) || !outcomes.includes(input.outcome) || !natural(now)) throw badRequest('Invalid audit record');
  const record = { at: now, principal: hash(input.principal?.id), action: input.action, outcome: input.outcome };
  for (const field of ['resourceId', 'requestId']) if (input[field] !== undefined) record[field] = hash(input[field]);
  if (input.status !== undefined) {
    if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) throw badRequest('Invalid audit status');
    record.status = input.status;
  }
  return record;
}

/** One writer per directory. Call after authentication; principal.id must be the auth-issued ID.
 * Request counters and storage reservations survive restart; stream leases are process-local.
 * reserveStorage sets an absolute byte reservation BEFORE writing; release only after deletion.
 * A crash may conservatively leak a reservation: reconcile it against the owning storage layer.
 * This is logical accounting, not a filesystem scanner. The bounded journal retains newest entries.
 */
export async function createGovernance(directory, options = {}) {
  const clock = options.clock ?? Date.now, limits = { ...defaults, ...options.limits };
  const journalLimit = options.journalLimit ?? 10000, maxPrincipals = options.maxPrincipals ?? 10000;
  const overrides = structuredClone(options.principals ?? {});
  function validateLimits(value) {
    if (Object.keys(value).some(k => !Object.hasOwn(defaults, k)) || Object.values(value).some(v => !natural(v)) || value.windowMs < 1) throw badRequest('Invalid governance limits');
    return value;
  }
  validateLimits(limits);
  for (const [id, value] of Object.entries(overrides)) { identifier(id); validateLimits({ ...limits, ...value }); }
  if (!natural(journalLimit) || journalLimit < 1 || !natural(maxPrincipals) || maxPrincipals < 1) throw badRequest('Invalid governance capacity');
  const root = await privateDirectory(join(directory, 'governance'));
  const unlock = await acquireStateLock(root), file = join(root, 'journal.json');
  let state;
  try {
    state = await readPrivateJson(file, { version: 1, principals: {}, journal: [] });
    if (state.version !== 1 || !state.principals || typeof state.principals !== 'object' || Array.isArray(state.principals) || !Array.isArray(state.journal) || Object.keys(state).some(k => !['version', 'principals', 'journal'].includes(k))) throw new Error('Invalid governance state');
    for (const [id, value] of Object.entries(state.principals)) {
      if (!/^[a-f0-9]{64}$/.test(id) || !natural(value.start) || !natural(value.requests) || !value.storage || typeof value.storage !== 'object' || Array.isArray(value.storage) || Object.keys(value).some(k => !['start', 'requests', 'storage'].includes(k)) || Object.entries(value.storage).some(([key, bytes]) => !/^[a-f0-9]{64}$/.test(key) || !natural(bytes)) || !natural(Object.values(value.storage).reduce((a, b) => a + b, 0))) throw new Error('Invalid governance state');
    }
    for (const record of state.journal) {
      if (!record || !natural(record.at) || !/^[a-f0-9]{64}$/.test(record.principal) || !actions.includes(record.action) || !outcomes.includes(record.outcome) || Object.keys(record).some(k => !['at', 'principal', 'action', 'outcome', 'resourceId', 'requestId', 'status'].includes(k)) || ['resourceId', 'requestId'].some(k => record[k] !== undefined && !/^[a-f0-9]{64}$/.test(record[k])) || (record.status !== undefined && (!Number.isInteger(record.status) || record.status < 100 || record.status > 599))) throw new Error('Invalid audit journal');
    }
    try { if (!(await lstat(file)).isFile()) throw new Error('Unsafe journal'); await chmod(file, 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } catch (error) { await unlock(); throw error; }
  const streams = new Map();
  let tail = Promise.resolve(), closed = false, closeTask, fault;
  function transact(operation) {
    if (closed) return Promise.reject(new ApiError(503, 'governance_closed', 'Governance is closed'));
    const task = tail.then(async () => {
      if (fault) throw fault;
      const next = structuredClone(state), result = operation(next);
      try { await atomicJson(file, next); }
      catch { fault = new ApiError(503, 'governance_persistence_failed', 'Reopen governance after checking state'); throw fault; }
      state = next;
      if (result instanceof ApiError) throw result;
      return result;
    });
    tail = task.catch(() => {});
    return task;
  }
  function context(principal) {
    const id = identifier(principal?.id);
    return { id: hash(id), principal: { id }, limit: { ...limits, ...overrides[id] } };
  }
  function entry(next, ctx) {
    if (!next.principals[ctx.id]) {
      if (Object.keys(next.principals).length >= maxPrincipals) throw new ApiError(503, 'principal_capacity', 'Governance principal capacity reached');
      next.principals[ctx.id] = { start: clock(), requests: 0, storage: {} };
    }
    return next.principals[ctx.id];
  }
  function audit(next, record) {
    next.journal.push(sanitizeAuditRecord(record, clock()));
    next.journal = next.journal.slice(-journalLimit);
  }
  return {
    journalFile: file,
    consumeRequest(principal) {
      const ctx = context(principal);
      return transact(next => {
        const value = entry(next, ctx), now = clock();
        if (now >= value.start + ctx.limit.windowMs) { value.start = now; value.requests = 0; }
        const allowed = value.requests < ctx.limit.requests;
        audit(next, { principal: ctx.principal, action: 'request', outcome: allowed ? 'allowed' : 'denied' });
        if (!allowed) {
          const error = new ApiError(429, 'request_rate_limit', 'Principal request rate exceeded');
          error.retryAfterMs = Math.max(1, value.start + ctx.limit.windowMs - now);
          return error;
        }
        value.requests++;
        return { remaining: ctx.limit.requests - value.requests, resetAt: value.start + ctx.limit.windowMs };
      });
    },
    async acquireStream(principal) {
      const ctx = context(principal);
      // Pending acquisitions count immediately, before the audit fsync yields.
      const count = streams.get(ctx.id) ?? 0;
      if (count >= ctx.limit.streams) {
        await transact(next => audit(next, { principal: ctx.principal, action: 'stream', outcome: 'denied' }));
        throw new ApiError(429, 'stream_limit', 'Principal stream quota exceeded');
      }
      streams.set(ctx.id, count + 1);
      let released = false;
      const release = () => { if (!released) { released = true; streams.set(ctx.id, streams.get(ctx.id) - 1); } };
      try { await transact(next => { entry(next, ctx); audit(next, { principal: ctx.principal, action: 'stream', outcome: 'allowed' }); }); }
      catch (error) { release(); throw error; }
      return release;
    },
    reserveStorage(principal, resourceId, bytes) {
      const ctx = context(principal), resource = hash(resourceId);
      if (!natural(bytes)) throw badRequest('Invalid storage byte count');
      return transact(next => {
        const value = entry(next, ctx), total = Object.values(value.storage).reduce((a, b) => a + b, 0) - (value.storage[resource] ?? 0) + bytes;
        const allowed = Number.isSafeInteger(total) && (total <= ctx.limit.storageBytes || bytes <= (value.storage[resource] ?? 0));
        audit(next, { principal: ctx.principal, action: 'storage', outcome: allowed ? 'allowed' : 'denied', resourceId });
        if (!allowed) return new ApiError(413, 'storage_quota', 'Principal storage quota exceeded');
        if (bytes === 0) delete value.storage[resource]; else value.storage[resource] = bytes;
        return { storageBytes: total, remaining: Math.max(0, ctx.limit.storageBytes - total) };
      });
    },
    recordAudit(input) {
      const record = sanitizeAuditRecord(input, clock());
      return transact(next => { next.journal.push(record); next.journal = next.journal.slice(-journalLimit); return structuredClone(record); });
    },
    async usage(principal) {
      const ctx = context(principal); await tail;
      if (closed || fault) throw fault ?? new ApiError(503, 'governance_closed', 'Governance is closed');
      const value = state.principals[ctx.id];
      return { requests: value && clock() < value.start + ctx.limit.windowMs ? value.requests : 0, streams: streams.get(ctx.id) ?? 0, storageBytes: Object.values(value?.storage ?? {}).reduce((a, b) => a + b, 0), limits: ctx.limit };
    },
    async flush() { await tail; if (fault) throw fault; },
    close() { closed = true; closeTask ??= tail.then(unlock); return closeTask; },
  };
}
