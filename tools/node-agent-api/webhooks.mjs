import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory } from './runtime/common.mjs';
import { ApiError, badRequest, identifier } from './errors.mjs';
import { acquireStateLock, atomicJson, readPrivateJson } from './persistence.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const natural = value => Number.isSafeInteger(value) && value >= 0;
const newKey = () => ({ id: 'whkey_' + randomUUID(), secret: randomBytes(32).toString('base64url') });
const validKey = key => key && /^whkey_[a-f0-9-]{36}$/.test(key.id) && /^[A-Za-z0-9_-]{43}$/.test(key.secret);

/** Numeric canonical loopback only: no DNS, userinfo, query secrets, fragments or URL normalization tricks. */
export function validateWebhookDestination(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\/(127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?(?:\/[^\s?#\\]*)?$/.test(value)) throw badRequest('Webhook destination must be a literal loopback HTTP URL');
  let url;
  try { url = new URL(value); } catch { throw badRequest('Invalid webhook destination'); }
  if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.port === '0') throw badRequest('Invalid webhook destination');
  return url.href;
}

/** Wire signature v1 = HMAC-SHA256(secret, timestamp + '.' + deliveryId + '.' + exact UTF-8 body).
 * Receivers must ALSO durably deduplicate delivery IDs after verifying the signature and timestamp.
 */
export function signWebhook({ key, timestamp, deliveryId, body }) {
  if (!validKey(key) || !natural(timestamp) || typeof body !== 'string') throw badRequest('Invalid webhook signing input');
  identifier(deliveryId);
  return 'v1=' + createHmac('sha256', Buffer.from(key.secret, 'base64url')).update(`${timestamp}.${deliveryId}.${body}`).digest('hex');
}

export function verifyWebhookSignature({ keys, keyId, timestamp, deliveryId, body, signature, now = Date.now(), toleranceMs = 300000 }) {
  if (!Array.isArray(keys) || !natural(now) || !natural(toleranceMs) || !natural(timestamp) || Math.abs(now - timestamp * 1000) > toleranceMs || !/^v1=[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const key = keys.find(k => k?.id === keyId);
  try { return timingSafeEqual(Buffer.from(signWebhook({ key, timestamp, deliveryId, body })), Buffer.from(signature)); }
  catch { return false; }
}

/** No fetch/global proxy settings, DNS or redirect following. Timeout covers response-body draining too. */
export function loopbackWebhookTransport({ url, headers, body, signal }) {
  const destination = new URL(validateWebhookDestination(url));
  return new Promise((resolve, reject) => {
    const request = (destination.protocol === 'https:' ? httpsRequest : httpRequest)(destination, { method: 'POST', headers, signal, agent: false }, response => {
      response.on('error', reject);
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/** Standalone trusted-host API; no timers start automatically. configure() explicitly enables each
 * instance; reopening is disabled even with saved configuration. Call dispatchDue() from a scheduler.
 * Delivery is at-least-once: a crash after HTTP success can replay the SAME delivery ID.
 * Rotation affects the next attempt, including queued retries. Provision returned keys out of band;
 * receivers retain the previous key during overlap. Injected transports must obey AbortSignal and
 * the no-redirect/no-proxy contract; an arbitrary transport cannot be forcibly cancelled by JS.
 */
export async function createWebhookOutbox(directory, options = {}) {
  const clock = options.clock ?? Date.now, transport = options.transport ?? loopbackWebhookTransport;
  const policy = { timeoutMs: 5000, baseDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 5, maxEntries: 10000, maxBodyBytes: 65536, ...options.policy };
  if (typeof transport !== 'function' || Object.values(policy).some(v => !natural(v) || v < 1) || policy.timeoutMs > 2147483647 || policy.maxDelayMs < policy.baseDelayMs || policy.maxAttempts > 100) throw badRequest('Invalid webhook policy');
  const root = await privateDirectory(join(directory, 'webhooks'));
  const unlock = await acquireStateLock(root), file = join(root, 'outbox.json');
  let state;
  try {
    state = await readPrivateJson(file, { version: 1, destination: null, key: null, deliveries: [] });
    if (state.version !== 1 || !Array.isArray(state.deliveries) || (state.key !== null && !validKey(state.key)) || (state.destination !== null && validateWebhookDestination(state.destination) !== state.destination)) throw new Error('Invalid webhook state');
    const ids = new Set(), dedup = new Set();
    for (const d of state.deliveries) {
      identifier(d.id);
      if (ids.has(d.id) || dedup.has(d.dedup) || !/^[a-f0-9]{64}$/.test(d.dedup) || !/^[a-f0-9]{64}$/.test(d.principal) || !['pending', 'delivering', 'retry', 'delivered', 'failed'].includes(d.status) || typeof d.body !== 'string' || Buffer.byteLength(d.body) > policy.maxBodyBytes || !natural(d.attempts) || !natural(d.nextAttemptAt) || !natural(d.createdAt) || !['none', 'interrupted', 'timeout', 'transport', 'http_status'].includes(d.lastError) || !(d.lastStatus === null || (Number.isInteger(d.lastStatus) && d.lastStatus >= 100 && d.lastStatus <= 599))) throw new Error('Invalid webhook delivery');
      validateWebhookDestination(d.destination);
      const envelope = JSON.parse(d.body);
      if (envelope.delivery_id !== d.id) throw new Error('Invalid webhook envelope');
      ids.add(d.id); dedup.add(d.dedup);
      if (d.status === 'delivering') {
        d.status = d.attempts >= policy.maxAttempts ? 'failed' : 'retry';
        d.nextAttemptAt = clock(); d.lastError = 'interrupted';
      }
    }
    if (state.deliveries.length && (!state.key || !state.destination)) throw new Error('Missing webhook configuration');
    await atomicJson(file, state);
    await chmod(file, 0o600);
  } catch (error) { await unlock(); throw error; }
  let tail = Promise.resolve(), enabled = false, closed = false, worker, closeTask, fault, configurationEpoch = 0;
  function check() {
    if (closed || fault) throw fault ?? new ApiError(503, 'webhooks_closed', 'Webhooks are closed');
  }
  function transact(operation) {
    const task = tail.then(async () => {
      if (fault) throw fault;
      const next = structuredClone(state), result = operation(next);
      try { await atomicJson(file, next); }
      catch { fault = new ApiError(503, 'webhook_persistence_failed', 'Reopen webhooks after checking state'); throw fault; }
      state = next;
      return result;
    });
    tail = task.catch(() => {});
    return task;
  }
  function ready() {
    check();
    if (!enabled) throw new ApiError(503, 'webhooks_disabled', 'Explicit webhook configuration required');
  }
  function summary(d) {
    return { id: d.id, status: d.status, attempts: d.attempts, nextAttemptAt: d.nextAttemptAt, createdAt: d.createdAt, lastError: d.lastError, lastStatus: d.lastStatus };
  }
  async function attempt(id) {
    const claim = await transact(next => {
      const d = next.deliveries.find(d => d.id === id);
      if (closed || !enabled || !['pending', 'retry'].includes(d.status) || d.nextAttemptAt > clock()) return null;
      if (d.attempts >= policy.maxAttempts) { d.status = 'failed'; return null; }
      d.status = 'delivering'; d.attempts++;
      return { delivery: structuredClone(d), key: { ...next.key } };
    });
    if (!claim) return;
    const { delivery: d, key } = claim, timestamp = Math.floor(clock() / 1000);
    const headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(d.body)), 'x-node-webhook-id': d.id, 'x-node-webhook-timestamp': String(timestamp), 'x-node-webhook-key-id': key.id, 'x-node-webhook-signature': signWebhook({ key, timestamp, deliveryId: d.id, body: d.body }) };
    const controller = new AbortController();
    let timer, lastError = 'none', status = null;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { lastError = 'timeout'; controller.abort(); reject(new Error('Webhook timeout')); }, policy.timeoutMs); });
      const result = await Promise.race([Promise.resolve().then(() => transport({ url: validateWebhookDestination(d.destination), headers, body: d.body, signal: controller.signal })), timeout]);
      if (!Number.isInteger(result?.status) || result.status < 100 || result.status > 599) throw new Error('Invalid transport response');
      status = result.status;
      if (status < 200 || status >= 300) lastError = 'http_status';
    } catch { if (lastError !== 'timeout') lastError = 'transport'; }
    finally { clearTimeout(timer); }
    return transact(next => {
      const current = next.deliveries.find(value => value.id === id);
      const success = status !== null && status >= 200 && status < 300;
      const retryable = status === null || status === 408 || status === 429 || status >= 500;
      current.status = success ? 'delivered' : retryable && current.attempts < policy.maxAttempts ? 'retry' : 'failed';
      current.lastError = lastError; current.lastStatus = status;
      current.nextAttemptAt = current.status === 'retry' ? clock() + Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (current.attempts - 1)) : 0;
      return summary(current);
    });
  }
  return {
    stateFile: file,
    async configure({ destination }) {
      check(); const url = validateWebhookDestination(destination);
      const epoch = ++configurationEpoch;
      const configuration = await transact(next => {
        next.destination = url; next.key ??= newKey();
        return { destination: url, signingKey: { ...next.key } };
      });
      if (!closed && epoch === configurationEpoch) enabled = true;
      return configuration;
    },
    disable() { check(); configurationEpoch++; enabled = false; },
    rotateKey() {
      ready();
      return transact(next => { next.key = newKey(); return { ...next.key }; });
    },
    enqueue(principal, { idempotencyKey, event }) {
      ready();
      const owner = digest(identifier(principal?.id)), key = identifier(idempotencyKey);
      let eventBody;
      try { eventBody = JSON.stringify(event); } catch { throw badRequest('Webhook event must be JSON'); }
      if (!event || typeof event !== 'object' || Array.isArray(event) || !eventBody || Buffer.byteLength(eventBody) > policy.maxBodyBytes) throw badRequest('Invalid webhook event');
      const snapshot = JSON.parse(eventBody), dedup = digest(owner + '.' + key);
      return transact(next => {
        const existing = next.deliveries.find(d => d.dedup === dedup);
        if (existing) {
          if (JSON.stringify(JSON.parse(existing.body).event) !== eventBody) throw new ApiError(409, 'webhook_idempotency_conflict', 'Webhook key already used for a different event');
          return summary(existing);
        }
        if (next.deliveries.length >= policy.maxEntries) throw new ApiError(429, 'webhook_capacity', 'Webhook outbox capacity reached');
        const id = 'whd_' + randomUUID(), createdAt = clock(), body = JSON.stringify({ delivery_id: id, event: snapshot });
        if (Buffer.byteLength(body) > policy.maxBodyBytes) throw badRequest('Webhook event too large');
        const d = { id, principal: owner, dedup, body, destination: next.destination, createdAt, nextAttemptAt: createdAt, attempts: 0, status: 'pending', lastError: 'none', lastStatus: null };
        next.deliveries.push(d); return summary(d);
      });
    },
    async status(principal, id) {
      check(); identifier(id); const owner = digest(identifier(principal?.id)); await tail;
      if (fault) throw fault;
      const d = state.deliveries.find(d => d.id === id && d.principal === owner);
      if (!d) throw new ApiError(404, 'not_found', 'Webhook delivery not found');
      return summary(d);
    },
    dispatchDue() {
      ready();
      if (!worker) {
        worker = (async () => {
          await tail;
          const due = state.deliveries.filter(d => ['pending', 'retry'].includes(d.status) && d.nextAttemptAt <= clock()).map(d => d.id);
          const results = [];
          for (const id of due) { if (closed || !enabled) break; const result = await attempt(id); if (result) results.push(result); }
          return results;
        })().finally(() => { worker = undefined; });
      }
      return worker;
    },
    async flush() { await worker; await tail; if (fault) throw fault; },
    close() {
      closed = true; enabled = false;
      closeTask ??= (async () => { try { await worker; } finally { await tail; await unlock(); } })();
      return closeTask;
    },
  };
}
