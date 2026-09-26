// Integration tests for tools/ocx-relay/mac-forwarder.mjs.
// Spins a scriptable mock upstream plus the real forwarder on loopback
// ephemeral ports and exercises the queue / retry / streaming contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { startForwarder, retryDelayMs } from "../tools/ocx-relay/mac-forwarder.mjs";

const TOKEN = "test-token";
const CHAT_BODY = JSON.stringify({ model: "test/chat", messages: [] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startMockUpstream(handler) {
  const state = { requests: 0, active: 0, maxActive: 0, aborted: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    const release = () => { state.active -= 1; };
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", () => { state.aborted += 1; release(); });
    res.on("close", () => {
      if (res.writableEnded) return;
      state.aborted += 1;
      release();
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      Promise.resolve(handler(req, res, body)).catch(() => {}).finally(release);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, state }));
  });
}

// Resolves after `ms`, or early when the client socket dies, so a holding
// handler never keeps timers (or writes to a dead socket) pending.
function holdOrAbort(ms, res) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      res.off("close", finish);
      resolve();
    }
    res.once("close", finish);
  });
}

async function startRelay(upstreamPort, overrides = {}) {
  const logs = [];
  const { server, pool } = startForwarder({
    bind: "127.0.0.1",
    port: 0,
    upstreamHost: "127.0.0.1",
    upstreamPort,
    token: TOKEN,
    maxConcurrency: 2,
    maxQueue: 8,
    queueTimeoutMs: 120000,
    retry429: 2,
    retryMaxDelayMs: 20,
    idleTimeoutMs: 0,
    bodyBufferLimit: 1024 * 1024,
    log: (line) => logs.push(line),
    ...overrides,
  });
  if (!server.listening) await once(server, "listening");
  return { server, pool, logs, port: server.address().port };
}

function relayRequest(port, { method = "GET", path = "/", body = null, headers = {}, token = TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { ...(token ? { "x-relay-token": token } : {}), ...headers } },
      (res) => {
        const chunks = [];
        let firstChunkAt = 0;
        const startedAt = Date.now();
        res.on("data", (chunk) => {
          if (chunks.length === 0) firstChunkAt = Date.now();
          chunks.push(chunk);
        });
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          firstChunkDelay: firstChunkAt - startedAt,
          firstChunks: chunks.length,
        }));
      },
    );
    req.on("error", reject);
    if (body !== null) req.end(body);
    else req.end();
  });
}

test("retryDelayMs honors Retry-After, caps at maxDelay, and adds small jitter", () => {
  const capped = retryDelayMs(undefined, 1, 20);
  assert.ok(capped > 0 && capped <= 20 + 5, `expected <= 25, got ${capped}`);
  const fromHeader = retryDelayMs("2", 1, 30000);
  assert.ok(fromHeader >= 2000 && fromHeader <= 2500, `expected ~2000-2500, got ${fromHeader}`);
  const atCap = retryDelayMs("3600", 1, 30000);
  assert.ok(atCap >= 30000 && atCap <= 30500, `expected ~30000-30500, got ${atCap}`);
});

test("rejects requests without the relay token", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port);
  try {
    const res = await relayRequest(relay.port, { token: "" });
    assert.equal(res.status, 403);
    assert.equal(upstream.state.requests, 0);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("non-chat paths pipe through untouched", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"models":true}');
  });
  const relay = await startRelay(upstream.port);
  try {
    const res = await relayRequest(relay.port, { path: "/v1/models" });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { models: true });
    assert.ok(relay.logs.some((line) => line.includes("GET /v1/models -> 200")));
    assert.ok(!relay.logs.some((line) => line.includes("started id=")));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("retries a 429 before first byte and then relays the success", async () => {
  let attempts = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    attempts += 1;
    if (attempts <= 2) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end('{"error":"slow down"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"done":true}');
  });
  const relay = await startRelay(upstream.port, { retry429: 2, retryMaxDelayMs: 20 });
  try {
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { done: true });
    assert.equal(attempts, 3);
    assert.ok(relay.logs.some((line) => line.includes("retry id=") && line.includes("attempt=1")));
    assert.ok(relay.logs.some((line) => line.includes("-> 200") && line.includes("try=2")));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("passes the 429 through once retries are exhausted", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.writeHead(429, { "retry-after": "1", "content-type": "application/json" });
    res.end('{"error":"slow down"}');
  });
  const relay = await startRelay(upstream.port, { retry429: 1, retryMaxDelayMs: 20 });
  try {
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    assert.equal(res.status, 429);
    assert.equal(upstream.state.requests, 2);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("serializes chat requests through the concurrency queue", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"chunk":1}\n\n');
    await sleep(60);
    res.write('data: {"chunk":2}\n\n');
    res.end();
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1 });
  try {
    const results = await Promise.all([
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(upstream.state.maxActive, 1);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("streams SSE incrementally instead of buffering the whole response", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"chunk":1}\n\n');
    await sleep(200);
    res.write('data: {"chunk":2}\n\n');
    res.end();
  });
  const relay = await startRelay(upstream.port);
  try {
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    assert.equal(res.status, 200);
    assert.ok(res.firstChunkDelay < 150, `first chunk took ${res.firstChunkDelay}ms; streaming is being buffered`);
    assert.ok(res.body.toString().includes('{"chunk":2}'));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("rejects immediately when the queue is full", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    await sleep(200);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1, maxQueue: 1, queueTimeoutMs: 10000 });
  try {
    const startedAt = Date.now();
    const results = await Promise.all([
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 200, 429]);
    assert.ok(relay.logs.some((line) => line.includes("reason=queue full")));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("times out queued requests instead of waiting forever", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    await sleep(250);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1, maxQueue: 2, queueTimeoutMs: 80 });
  try {
    const results = await Promise.all([
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 429]);
    assert.ok(relay.logs.some((line) => line.includes("reason=queue timeout")));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("a client abort frees its slot for the next request", async () => {
  let seen = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    seen += 1;
    if (seen === 1) {
      await holdOrAbort(2000, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1 });
  try {
    const aborting = http.request(
      { host: "127.0.0.1", port: relay.port, method: "POST", path: "/v1/chat/completions", headers: { "x-relay-token": TOKEN, "content-length": Buffer.byteLength(CHAT_BODY) } },
      () => {},
    );
    aborting.end(CHAT_BODY);
    aborting.on("error", () => { /* expected: the aborted socket resets */ });
    await sleep(50);
    aborting.destroy();

    const startedAt = Date.now();
    const follower = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.equal(follower.status, 200);
    assert.ok(elapsed < 1500, `follower took ${elapsed}ms; aborted request did not free its slot`);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("aborts a trickle-hung stream at the total deadline and frees the slot", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    // Headers arrive at once, then keepalive bytes forever, never completing:
    // the failure mode live traffic hit as id=e18e7b72 (74+ min in flight).
    res.writeHead(200, { "content-type": "text/event-stream" });
    const trickle = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch { }
    }, 40);
    res.on("close", () => clearInterval(trickle));
  });
  const relay = await startRelay(upstream.port, { idleTimeoutMs: 0, upstreamMaxTotalMs: 250, maxConcurrency: 1 });
  try {
    const startedAt = Date.now();
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 1500, `trickle-hang terminated after ${elapsed}ms; total deadline did not fire`);
    assert.ok([200, 502].includes(res.status), `unexpected status ${res.status}`);
    assert.ok(relay.logs.some((line) => line.includes("upstream total deadline")), "total deadline was not logged");

    // the slot must be free: a follower request completes normally
    upstream.server.close();
    const follower = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    assert.equal(follower.status, 502, "follower should fail fast against the closed mock upstream instead of hanging");
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("a mid-stream client abort frees its slot for the next request", async () => {
  let seen = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    seen += 1;
    if (seen === 1) {
      // headers + keepalive bytes forever: the client must be able to leave
      res.writeHead(200, { "content-type": "text/event-stream" });
      const trickle = setInterval(() => {
        try { res.write(": keepalive\n\n"); } catch { }
      }, 30);
      res.on("close", () => clearInterval(trickle));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1, idleTimeoutMs: 0, upstreamMaxTotalMs: 30000 });
  try {
    const stream = http.request(
      { host: "127.0.0.1", port: relay.port, method: "POST", path: "/v1/chat/completions", headers: { "x-relay-token": TOKEN, "content-length": Buffer.byteLength(CHAT_BODY) } },
      () => {},
    );
    stream.end(CHAT_BODY);
    stream.on("error", () => { /* aborted socket resets */ });
    await sleep(120); // response headers are streaming by now
    stream.destroy();

    const startedAt = Date.now();
    const follower = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.equal(follower.status, 200);
    assert.ok(elapsed < 1500, `follower took ${elapsed}ms; mid-stream abort did not free its slot`);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});
