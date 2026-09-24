import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "source", "shared", "openrouter-channel-status.ts");
const source = await readFile(sourcePath, "utf8");
const { code } = await transform(source, {
  format: "esm",
  loader: "ts",
  target: "es2022",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const {
  classifyOpenRouterError,
  mergeOpenRouterChannelStatus,
  normalizeOpenRouterChannelStatus,
} = mod;

function status(overrides = {}) {
  return normalizeOpenRouterChannelStatus({
    state: "ok",
    httpStatus: 200,
    latencyMs: 12,
    code: null,
    message: null,
    resetAt: null,
    retryAfterMs: null,
    observedAt: new Date().toISOString(),
    source: "model_list",
    ...overrides,
  });
}

test("classifies exhausted quota responses", () => {
  const quota429 = classifyOpenRouterError({ statusCode: 429, message: "quota exhausted" }, "chat");
  assert.equal(quota429.state, "out_of_quota");
  assert.equal(quota429.httpStatus, 429);
  assert.equal(quota429.source, "chat");

  assert.equal(classifyOpenRouterError({ statusCode: 402 }, "chat").state, "out_of_quota");
  assert.equal(classifyOpenRouterError({ statusCode: 403, message: "额度不足" }, "chat").state, "out_of_quota");
});

test("classifies ordinary rate limits and retry timing", () => {
  const rateLimited = classifyOpenRouterError({
    statusCode: 429,
    message: "slow down",
    responseHeaders: { "Retry-After": "60" },
  }, "chat");
  assert.equal(rateLimited.state, "rate_limited");
  assert.equal(rateLimited.retryAfterMs >= 59_000 && rateLimited.retryAfterMs <= 61_000, true);
  assert.equal(new Date(rateLimited.resetAt).getTime() - Date.now() > 55_000, true);
});

test("classifies upstream, network, and timeout failures", () => {
  assert.equal(classifyOpenRouterError({ statusCode: 403, message: "forbidden" }, "chat").state, "upstream_403");
  assert.equal(classifyOpenRouterError({ name: "ECONNREFUSED", message: "connect refused" }, "chat").state, "connection_failed");
  assert.equal(classifyOpenRouterError({ name: "ENOTFOUND", message: "dns lookup failed" }, "chat").state, "connection_failed");
  assert.equal(classifyOpenRouterError({ name: "TimeoutError", message: "timeout" }, "chat").state, "response_timeout");
  assert.equal(classifyOpenRouterError({ code: "ETIMEDOUT" }, "chat").state, "response_timeout");
  assert.equal(classifyOpenRouterError({ statusCode: 408 }, "chat").state, "response_timeout");
  assert.equal(classifyOpenRouterError({ statusCode: 504 }, "chat").state, "response_timeout");
  assert.equal(classifyOpenRouterError({ statusCode: 524 }, "chat").state, "response_timeout");
});

test("classifies model list abnormalities", () => {
  assert.equal(classifyOpenRouterError(new SyntaxError("Unexpected token"), "model_list").state, "model_list_abnormal");
  assert.equal(classifyOpenRouterError({ statusCode: 500, message: "failure" }, "model_list").state, "model_list_abnormal");
  assert.equal(classifyOpenRouterError({ name: "OddFailure", message: "unexpected" }, "model_list").state, "model_list_abnormal");
});

test("normalizes persisted channel status", () => {
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), state: "unknown" }), null);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), source: "gateway" }), null);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), observedAt: "not-a-date" }), null);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), httpStatus: "NaN" }), null);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), latencyMs: -1 }), null);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), retryAfterMs: 1.5 }).retryAfterMs, 2);
  assert.equal(normalizeOpenRouterChannelStatus({ ...status(), resetAt: "not-a-date" }), null);

  const normalized = status({ state: "rate_limited", retryAfterMs: 1000 });
  assert.equal(normalized.retryAfterMs, 1000);
});

test("merges fresh chat success over model list abnormalities", () => {
  const now = new Date();
  const freshChat = status({ state: "ok", source: "chat", observedAt: new Date(now.getTime() - 1_000).toISOString() });
  const abnormalList = status({ state: "model_list_abnormal", observedAt: now.toISOString() });
  assert.equal(mergeOpenRouterChannelStatus(freshChat, abnormalList, now).state, "ok");

  const staleChat = status({ state: "ok", source: "chat", observedAt: new Date(now.getTime() - 121_000).toISOString() });
  assert.equal(mergeOpenRouterChannelStatus(staleChat, abnormalList, now).state, "model_list_abnormal");
});

test("keeps explicit model list quota, rate limit, and permission failures visible", () => {
  const now = new Date();
  const freshChat = status({ state: "ok", source: "chat", observedAt: new Date(now.getTime() - 1_000).toISOString() });
  for (const state of ["out_of_quota", "rate_limited", "upstream_403"]) {
    const modelList = status({ state, source: "model_list", observedAt: now.toISOString() });
    assert.equal(mergeOpenRouterChannelStatus(freshChat, modelList, now).state, state);
  }
});

test("prefers active chat failures and drops expired transient statuses", () => {
  const now = new Date();
  const quotaChat = status({
    state: "out_of_quota",
    source: "chat",
    observedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
  });
  const okList = status({ observedAt: now.toISOString() });
  assert.equal(mergeOpenRouterChannelStatus(quotaChat, okList, now).state, "out_of_quota");

  const expiredConnection = status({
    state: "connection_failed",
    observedAt: new Date(now.getTime() - 11 * 60_000).toISOString(),
  });
  assert.equal(mergeOpenRouterChannelStatus(expiredConnection, okList, now).state, "ok");

  const expiredRateLimit = status({
    state: "rate_limited",
    observedAt: new Date(now.getTime() - 61 * 60_000).toISOString(),
  });
  assert.equal(mergeOpenRouterChannelStatus(expiredRateLimit, okList, now).state, "ok");
});
