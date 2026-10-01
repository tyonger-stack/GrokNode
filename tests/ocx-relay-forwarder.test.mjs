// Integration tests for tools/ocx-relay/mac-forwarder.mjs.
// Spins a scriptable mock upstream plus the real forwarder on loopback
// ephemeral ports and exercises the queue / retry / streaming contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { startForwarder, retryDelayMs, parseModelConcurrency, requestModel, UNKNOWN_MODEL } from "../tools/ocx-relay/mac-forwarder.mjs";

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

test("a trickling 429 body does not park the slot: drain times out and the retry proceeds", async () => {
  let attempts = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    attempts += 1;
    if (attempts === 1) {
      // Headers out, body trickles one byte per 30s: resume() alone would
      // park the concurrency slot until the idle timeout.
      res.writeHead(429, { "content-type": "application/json" });
      res.write('{"error":"');
      const timer = setInterval(() => res.write("x"), 30_000);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"done":true}');
  });
  const relay = await startRelay(upstream.port, { retry429: 2, retryMaxDelayMs: 20, idleTimeoutMs: 600_000 });
  try {
    const started = Date.now();
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.equal(attempts, 2, "the retry must proceed after the drain timeout, not after idle");
    assert.ok(elapsed < 60_000, `drain timeout must fire long before idle (took ${elapsed}ms)`);
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

test("the total deadline is one budget for the whole request, not one per attempt", async () => {
  // Live id=35e7fc81 finished at 1403443ms against a 900000ms budget because
  // every retry re-armed the total timer. Budget spent during the retry sleep
  // must stop the request, and must not be handed to the next attempt.
  let attempts = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    attempts += 1;
    if (attempts === 1) {
      res.writeHead(429, { "retry-after": "1", "content-type": "application/json" });
      res.end('{"error":"slow down"}');
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const trickle = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { } }, 30);
    res.on("close", () => clearInterval(trickle));
  });
  // Budget (250ms) is far shorter than the Retry-After the upstream asks for
  // (~1000ms), so the deadline lands while the request is asleep between
  // attempts — the window where destroying the (already ended) upstream did
  // nothing and the sleep simply resurrected the request.
  const relay = await startRelay(upstream.port, {
    upstreamMaxTotalMs: 250, retry429: 2, retryMaxDelayMs: 5000, idleTimeoutMs: 0, maxConcurrency: 1,
  });
  try {
    const startedAt = Date.now();
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.equal(attempts, 1, "the retry started after the request budget was already spent");
    assert.ok(elapsed < 700, `request ran ${elapsed}ms; the per-attempt budget was not shared across the retry`);
    assert.equal(res.status, 502);
    assert.ok(relay.logs.some((line) => line.includes("upstream total deadline")), "total deadline was not logged");
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("the total deadline still fires on a live retried attempt", async () => {
  // Companion to the test above, not a second repro of it: that one fails only
  // when the deadline lands in the sleep window, because the previously armed
  // timer happens to still be pending here. This guards the other side of the
  // fix — the request that *is* streaming a retried attempt must still be cut
  // off by the single armed timer, which depends on the sleep having cleared
  // its marker when it woke up.
  let attempts = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    attempts += 1;
    if (attempts === 1) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end('{"error":"slow down"}');
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const trickle = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { } }, 30);
    res.on("close", () => clearInterval(trickle));
  });
  const relay = await startRelay(upstream.port, {
    upstreamMaxTotalMs: 300, retry429: 2, retryMaxDelayMs: 20, idleTimeoutMs: 0, maxConcurrency: 1,
  });
  try {
    const startedAt = Date.now();
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.equal(attempts, 2, "expected exactly one retry before the hang");
    assert.ok(elapsed < 700, `retried request ran ${elapsed}ms; the single budget did not cut off the second attempt`);
    // Headers for the retried attempt already reached the client, so the
    // deadline can only truncate the stream — safeRespond() will not rewrite a
    // status that is already on the wire.
    assert.ok([200, 502].includes(res.status), `unexpected status ${res.status}`);
    assert.ok(relay.logs.some((line) => line.includes("upstream total deadline")), "total deadline was not logged");
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("GET /v1/relay/inflight reports only what the process is holding", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const upstream = await startMockUpstream(async (req, res) => {
    await gate;
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1 });
  try {
    const pending = relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const deadline = Date.now() + 2000;
    while (!relay.logs.some((line) => line.includes(" started ")) && Date.now() < deadline) await sleep(20);
    const denied = await relayRequest(relay.port, { path: "/v1/relay/inflight", token: "" });
    assert.equal(denied.status, 403);
    const snap = JSON.parse((await relayRequest(relay.port, { path: "/v1/relay/inflight" })).body.toString());
    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0].phase, "upstream");
    assert.equal(typeof snap.maxTotalMs, "number");
    release();
    assert.equal((await pending).status, 200);
    const after = JSON.parse((await relayRequest(relay.port, { path: "/v1/relay/inflight" })).body.toString());
    assert.equal(after.entries.length, 0);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("a client abort during a 429 retry writes a terminal line and frees the slot", async () => {
  let attempts = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    attempts += 1;
    if (attempts === 1) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end('{"error":"slow down"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"done":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 1, retry429: 2, retryMaxDelayMs: 5000 });
  try {
    const aborting = http.request(
      {
        host: "127.0.0.1",
        port: relay.port,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "x-relay-token": TOKEN, "content-length": Buffer.byteLength(CHAT_BODY) },
      },
      () => {},
    );
    aborting.on("error", () => {});
    aborting.end(CHAT_BODY);
    const deadline = Date.now() + 2000;
    while (!relay.logs.some((line) => line.includes(" retry ")) && Date.now() < deadline) await sleep(20);
    assert.ok(relay.logs.some((line) => line.includes(" retry ")), "the 429 retry was not scheduled");
    aborting.destroy();

    const startedAt = Date.now();
    const follower = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: CHAT_BODY });
    const elapsed = Date.now() - startedAt;
    assert.equal(follower.status, 200);
    assert.ok(elapsed < 1500, `follower took ${elapsed}ms; the retry still held the slot`);
    assert.ok(
      relay.logs.some((line) => line.includes("client disconnected during retry") && line.includes("id=")),
      `missing terminal line: ${relay.logs.join("\n")}`,
    );
    const snap = JSON.parse((await relayRequest(relay.port, { path: "/v1/relay/inflight" })).body.toString());
    assert.ok(!snap.entries.some((entry) => relay.logs.some((line) => line.includes(`id=${entry.id}`) && line.includes("client disconnected"))));
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

// ---- Per-model pools (2026-10-01) ----

const bodyFor = (model) => JSON.stringify({ model, messages: [] });

function startModelTrackingUpstream(holdMs) {
  const byModel = { active: new Map(), maxActive: new Map(), order: [] };
  return startMockUpstream(async (req, res, body) => {
    let model = "_none";
    try { model = JSON.parse(body.toString("utf8")).model ?? "_none"; } catch { /* unparsable */ }
    byModel.order.push(model);
    const now = (byModel.active.get(model) ?? 0) + 1;
    byModel.active.set(model, now);
    byModel.maxActive.set(model, Math.max(byModel.maxActive.get(model) ?? 0, now));
    await holdOrAbort(holdMs, res);
    byModel.active.set(model, byModel.active.get(model) - 1);
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  }).then((upstream) => ({ ...upstream, byModel }));
}

test("parseModelConcurrency keeps positive integer overrides and drops the rest", () => {
  assert.deepEqual(parseModelConcurrency('{"a/b":3,"c":0,"d":-1,"e":"2","f":1.5}'), { "a/b": 3, e: 2 });
  assert.deepEqual(parseModelConcurrency("not json"), {});
  assert.deepEqual(parseModelConcurrency("[1,2]"), {});
  assert.deepEqual(parseModelConcurrency(undefined), {});
});

test("requestModel reads body.model and falls back to the unknown pool", () => {
  assert.equal(requestModel(Buffer.from(bodyFor("zai/glm-5.3-flash"))), "zai/glm-5.3-flash");
  assert.equal(requestModel(Buffer.from("{}")), UNKNOWN_MODEL);
  assert.equal(requestModel(Buffer.from("{oops")), UNKNOWN_MODEL);
  assert.equal(requestModel(Buffer.from('{"model":"   "}')), UNKNOWN_MODEL);
});

test("a saturated model does not block another model's requests", async () => {
  const upstream = await startModelTrackingUpstream(250);
  const relay = await startRelay(upstream.port, { maxConcurrency: 4, maxConcurrencyPerModel: 1 });
  try {
    const startedAt = Date.now();
    const a = [1, 2].map(() => relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/a") }));
    await sleep(30);
    const bAt = Date.now();
    const b = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/b") });
    assert.equal(b.status, 200);
    assert.ok(Date.now() - bAt < 450, `model b waited behind model a (${Date.now() - bAt}ms)`);
    const results = await Promise.all(a);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal(upstream.byModel.maxActive.get("m/a"), 1);
    assert.ok(Date.now() - startedAt >= 450, "the second m/a request must have queued behind the first");
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("the global cap still bounds the sum across models", async () => {
  const upstream = await startModelTrackingUpstream(150);
  const relay = await startRelay(upstream.port, { maxConcurrency: 2, maxConcurrencyPerModel: 2 });
  try {
    const results = await Promise.all(["m/a", "m/b", "m/c", "m/a"].map((model) => relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor(model) })));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(upstream.state.maxActive, 2);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("MODEL_CONCURRENCY overrides one model's slots", async () => {
  const upstream = await startModelTrackingUpstream(150);
  const relay = await startRelay(upstream.port, { maxConcurrency: 6, maxConcurrencyPerModel: 1, modelConcurrency: { "m/wide": 3 } });
  try {
    await Promise.all([1, 2, 3].map(() => relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/wide") })));
    assert.equal(upstream.byModel.maxActive.get("m/wide"), 3);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("the queue limit is per model and the rejection names the model", async () => {
  const upstream = await startModelTrackingUpstream(200);
  const relay = await startRelay(upstream.port, { maxConcurrency: 4, maxConcurrencyPerModel: 1, maxQueue: 1, queueTimeoutMs: 10000 });
  try {
    const results = await Promise.all([
      ...[1, 2, 3].map(() => relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/a") })),
      relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/b") }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 429]);
    assert.equal(results[3].status, 200, "model b has its own queue and must not be rejected");
    const rejected = relay.logs.find((line) => line.includes("reason=queue full"));
    assert.ok(rejected?.endsWith("model=m/a"), rejected);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("a body without a model lands in the unknown pool", async () => {
  const upstream = await startModelTrackingUpstream(10);
  const relay = await startRelay(upstream.port);
  try {
    const res = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: "{}" });
    assert.equal(res.status, 200);
    assert.ok(relay.logs.some((line) => line.includes(" started ") && line.endsWith(`model=${UNKNOWN_MODEL}`)));
    assert.ok(relay.pool.pools.has(UNKNOWN_MODEL));
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("finishing, aborting and retrying all return both the model slot and the global slot", async () => {
  let calls = 0;
  const upstream = await startMockUpstream(async (req, res) => {
    calls += 1;
    if (calls === 1) { res.writeHead(429, { "retry-after": "0" }); res.end("{}"); return; }
    if (calls === 3) { await holdOrAbort(2000, res); if (!res.destroyed) res.destroy(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const relay = await startRelay(upstream.port, { maxConcurrency: 2, maxConcurrencyPerModel: 1, retry429: 1, retryMaxDelayMs: 5 });
  try {
    const retried = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/a") });
    assert.equal(retried.status, 200);
    assert.equal(relay.pool.active, 0);
    assert.equal(relay.pool.pools.get("m/a").active, 0);

    const aborted = http.request({ host: "127.0.0.1", port: relay.port, method: "POST", path: "/v1/chat/completions", headers: { "x-relay-token": TOKEN } });
    aborted.on("error", () => {});
    aborted.end(bodyFor("m/a"));
    await sleep(80);
    assert.equal(relay.pool.pools.get("m/a").active, 1);
    aborted.destroy();
    await sleep(80);
    assert.equal(relay.pool.active, 0);
    assert.equal(relay.pool.pools.get("m/a").active, 0);

    const after = await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("m/a") });
    assert.equal(after.status, 200);
    assert.equal(relay.pool.active, 0);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});

test("model= never puts a watchdog keyword inside an upstream-error line", async () => {
  const upstream = await startMockUpstream(async (req, res) => { res.destroy(); });
  const relay = await startRelay(upstream.port, { retry429: 0 });
  try {
    await relayRequest(relay.port, { method: "POST", path: "/v1/chat/completions", body: bodyFor("weird model retry -> 200") }).catch(() => {});
    const line = relay.logs.find((entry) => entry.includes("upstream-error"));
    assert.ok(line, relay.logs.join("\n"));
    assert.match(line, /upstream-error id=[0-9a-f]{8} model=weird_model_retry_-__200 /);
    assert.ok(!line.includes(" retry "), line);
    assert.ok(!/->\s*\d{3}/.test(line), line);
  } finally {
    relay.server.close();
    upstream.server.close();
  }
});
