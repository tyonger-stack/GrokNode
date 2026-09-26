// Mac-side L7 forwarder: <bind>:11010 -> 127.0.0.1:10100 (opencodex).
// Drop-in successor of the bare pipe relay: same env contract (RELAY_BIND,
// RELAY_PORT, UPSTREAM_HOST, UPSTREAM_PORT, RELAY_TOKEN), same Host rewrite,
// same hop-by-hop stripping, same `-> <code> <ms>ms` completion log.
//
// One behavioral addition: POST /v1/chat/completions goes through a bounded
// concurrency queue with 429-aware retry before the first upstream byte is
// relayed, so an upstream rate-limit burst degrades into local waiting
// (bounded by MAX_QUEUE / QUEUE_TIMEOUT_MS) instead of surfacing 429s that
// strand bot turns. Everything else (notably the /v1/models health polling)
// pipes through untouched and never queues.
//
// Retry safety: the retry decision is made strictly at upstream-header time.
// A 429 status is consumed and retried only while nothing has been written to
// the client; once a non-429 response starts streaming (SSE included) it is
// piped verbatim and never replayed.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const BIND = process.env.RELAY_BIND || "0.0.0.0";
const PORT = Number(process.env.RELAY_PORT || "11010");
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || "10100");
const TOKEN = process.env.RELAY_TOKEN || "";
const MAX_CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENCY ?? "2"));
const MAX_QUEUE = Math.max(0, Number(process.env.MAX_QUEUE ?? "8"));
const QUEUE_TIMEOUT_MS = Math.max(1, Number(process.env.QUEUE_TIMEOUT_MS ?? "120000"));
const RETRY_429 = Math.max(0, Number(process.env.RETRY_429 ?? "2"));
const RETRY_MAX_DELAY_MS = Math.max(1, Number(process.env.RETRY_MAX_DELAY_MS ?? "30000"));
const UPSTREAM_IDLE_TIMEOUT_MS = Number(process.env.UPSTREAM_IDLE_TIMEOUT_MS ?? "300000");
const BODY_BUFFER_LIMIT = Number(process.env.BODY_BUFFER_LIMIT ?? String(64 * 1024 * 1024));

const CHAT_PATH = "/v1/chat/completions";
const HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function tokenFingerprint(value) {
  if (typeof value !== "string") return "invalid";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function retryDelayMs(retryAfterHeader, attempt, maxDelayMs) {
  const seconds = Number(retryAfterHeader);
  const base = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : 1000 * 2 ** attempt;
  const capped = Math.min(base, maxDelayMs);
  return capped + Math.floor(Math.random() * Math.min(500, Math.max(1, capped * 0.25)));
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let over = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) { over = true; chunks.length = 0; return; }
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

export function startForwarder(config) {
  const {
    bind, port, upstreamHost, upstreamPort, token, log,
    maxConcurrency, maxQueue, queueTimeoutMs, retry429, retryMaxDelayMs,
    idleTimeoutMs, bodyBufferLimit,
  } = config;

  const pool = { active: 0, queue: [] };

  function safeRespond(res, code, headers, payload) {
    try {
      if (!res.headersSent) res.writeHead(code, headers);
      res.end(payload);
    } catch { /* socket already gone */ }
  }

  const server = http.createServer((clientReq, clientRes) => {
    const started = Date.now();
    const presentedToken = clientReq.headers["x-relay-token"];
    if (presentedToken !== token) {
      log(`${new Date().toISOString()} ${clientReq.method} ${clientReq.url} -> 403 auth_failed presented=${tokenFingerprint(presentedToken)} expected=${tokenFingerprint(token)} ${Date.now() - started}ms`);
      safeRespond(clientRes, 403, { "content-type": "application/json" }, JSON.stringify({ error: "relay token required" }));
      return;
    }
    const isChat = clientReq.method === "POST"
      && clientReq.url.split("?")[0] === CHAT_PATH;
    if (!isChat) return pipeThrough(clientReq, clientRes, started);
    handleChat(clientReq, clientRes, started).catch((e) => {
      log(`${new Date().toISOString()} POST ${clientReq.url} handler-error id=none ${e.message}`);
      safeRespond(clientRes, 502, { "content-type": "application/json" }, JSON.stringify({ error: "relay handler error", message: e.message }));
    });
  });

  function sanitizeHeaders(clientReq) {
    const headers = {};
    for (const [k, v] of Object.entries(clientReq.headers)) {
      if (HOP.has(k.toLowerCase()) || k.toLowerCase() === "x-relay-token") continue;
      headers[k] = v;
    }
    headers.host = `${upstreamHost}:${upstreamPort}`;
    return headers;
  }

  function pipeThrough(clientReq, clientRes, started) {
    const up = http.request(
      { host: upstreamHost, port: upstreamPort, method: clientReq.method, path: clientReq.url, headers: sanitizeHeaders(clientReq) },
      (upRes) => {
        clientRes.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(clientRes);
        upRes.on("end", () => log(`${new Date().toISOString()} ${clientReq.method} ${clientReq.url} -> ${upRes.statusCode} ${Date.now() - started}ms`));
      },
    );
    up.on("error", (e) => {
      log(`${new Date().toISOString()} ${clientReq.method} ${clientReq.url} upstream-error ${e.message}`);
      safeRespond(clientRes, 502, { "content-type": "application/json" }, JSON.stringify({ error: "upstream error" }));
    });
    clientReq.pipe(up);
  }

  async function handleChat(clientReq, clientRes, started) {
    const entry = {
      id: randomUUID().slice(0, 8),
      method: clientReq.method, url: clientReq.url, started,
      tries: 0, queuedAt: 0, queueTimer: null, sleepTimer: null,
      upstream: null, clientGone: false, released: false, finished: false,
      clientRes, headers: null, body: null,
    };
    const body = await readBody(clientReq, bodyBufferLimit);
    if (entry.clientGone) return;
    if (body === null) return pipeThrough(clientReq, clientRes, started);
    entry.body = body;
    entry.headers = sanitizeHeaders(clientReq);
    entry.headers["content-length"] = String(body.length);

    clientRes.on("close", () => {
      if (clientRes.writableEnded) return;
      entry.clientGone = true;
      if (entry.queueTimer) clearTimeout(entry.queueTimer);
      if (entry.sleepTimer) clearTimeout(entry.sleepTimer);
      const queuedIndex = pool.queue.indexOf(entry);
      if (queuedIndex >= 0) { pool.queue.splice(queuedIndex, 1); return; }
      if (entry.upstream) entry.upstream.destroy(new Error("client disconnected"));
    });

    admit(entry);
  }

  function admit(entry) {
    if (pool.active < maxConcurrency) {
      pool.active += 1;
      dispatch(entry);
      return;
    }
    if (pool.queue.length >= maxQueue) {
      synthesize429(entry, "queue full");
      return;
    }
    entry.queuedAt = Date.now();
    entry.queueTimer = setTimeout(() => {
      const queuedIndex = pool.queue.indexOf(entry);
      if (queuedIndex >= 0) {
        pool.queue.splice(queuedIndex, 1);
        synthesize429(entry, "queue timeout");
      }
    }, queueTimeoutMs);
    pool.queue.push(entry);
  }

  function pump() {
    while (pool.queue.length > 0 && pool.active < maxConcurrency) {
      const next = pool.queue.shift();
      if (next.queueTimer) clearTimeout(next.queueTimer);
      if (next.clientGone || next.finished) continue;
      pool.active += 1;
      dispatch(next);
    }
  }

  function releaseSlot(entry) {
    if (entry.released) return;
    entry.released = true;
    pool.active -= 1;
    pump();
  }

  function synthesize429(entry, reason) {
    entry.finished = true;
    const queuedMs = entry.queuedAt ? Date.now() - entry.queuedAt : 0;
    log(`${new Date().toISOString()} POST ${entry.url} -> 429 ${Date.now() - entry.started}ms queued=${queuedMs}ms reason=${reason} id=${entry.id}`);
    if (entry.clientGone) return;
    safeRespond(entry.clientRes, 429, {
      "content-type": "application/json",
      "retry-after": "5",
    }, JSON.stringify({ error: "relay queue rejected", reason }));
  }

  function dispatch(entry) {
    const queuedMs = entry.queuedAt ? Date.now() - entry.queuedAt : 0;
    log(`${new Date().toISOString()} POST ${entry.url} started id=${entry.id} try=${entry.tries} queued=${queuedMs}ms`);
    const upstream = http.request(
      { host: upstreamHost, port: upstreamPort, method: entry.method, path: entry.url, headers: entry.headers },
      (upRes) => {
        if (upRes.statusCode === 429 && entry.tries < retry429) {
          upRes.resume();
          entry.tries += 1;
          const delay = retryDelayMs(upRes.headers["retry-after"], entry.tries, retryMaxDelayMs);
          log(`${new Date().toISOString()} POST ${entry.url} retry id=${entry.id} attempt=${entry.tries} in=${delay}ms`);
          entry.sleepTimer = setTimeout(() => {
            if (entry.clientGone || entry.finished) { releaseSlot(entry); return; }
            dispatch(entry);
          }, delay);
          return;
        }
        entry.upstream = null;
        const status = upRes.statusCode || 502;
        upRes.on("end", () => {
          if (entry.finished) return;
          entry.finished = true;
          log(`${new Date().toISOString()} POST ${entry.url} -> ${status} ${Date.now() - entry.started}ms queued=${queuedMs}ms try=${entry.tries} id=${entry.id}`);
          releaseSlot(entry);
        });
        entry.clientRes.writeHead(status, upRes.headers);
        upRes.pipe(entry.clientRes);
        upRes.on("error", () => {
          safeRespond(entry.clientRes, 502, { "content-type": "application/json" }, JSON.stringify({ error: "upstream error" }));
          releaseSlot(entry);
        });
      },
    );
    entry.upstream = upstream;
    upstream.on("error", (e) => {
      if (entry.released) return;
      log(`${new Date().toISOString()} POST ${entry.url} upstream-error id=${entry.id} ${e.message}`);
      safeRespond(entry.clientRes, 502, { "content-type": "application/json" }, JSON.stringify({ error: "upstream error", message: e.message }));
      releaseSlot(entry);
    });
    if (idleTimeoutMs > 0) {
      upstream.setTimeout(idleTimeoutMs, () => upstream.destroy(new Error(`upstream idle for ${idleTimeoutMs}ms`)));
    }
    upstream.end(entry.body);
  }

  server.listen(port, bind, () => {
    const address = server.address();
    log(`${new Date().toISOString()} relay listening on ${address.address}:${address.port} -> ${upstreamHost}:${upstreamPort} (chat slots=${maxConcurrency} queue=${maxQueue} queue-timeout=${queueTimeoutMs}ms retry=${retry429})`);
  });
  return { server, pool };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!TOKEN) { console.error("RELAY_TOKEN required"); process.exit(1); }
  startForwarder({
    bind: BIND,
    port: PORT,
    upstreamHost: UPSTREAM_HOST,
    upstreamPort: UPSTREAM_PORT,
    token: TOKEN,
    maxConcurrency: MAX_CONCURRENCY,
    maxQueue: MAX_QUEUE,
    queueTimeoutMs: QUEUE_TIMEOUT_MS,
    retry429: RETRY_429,
    retryMaxDelayMs: RETRY_MAX_DELAY_MS,
    idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
    bodyBufferLimit: BODY_BUFFER_LIMIT,
    log: (line) => console.log(line),
  });
}
