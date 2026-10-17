import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}-0712.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs], external: ["electron"] });
  return createRequire(import.meta.url)(outfile);
}

const transient = await load("source/host/runner/transient-stream-error.ts", "transient-stream-error");
const runtime = await load("source/host/extensions/transcript/turn-runtime.ts", "turn-runtime");

function apiCallError(statusCode, { isRetryable = statusCode === 429 || statusCode >= 500, message = `HTTP ${statusCode}`, headers = {}, cause } = {}) {
  const error = new Error(message);
  error.name = "AI_APICallError";
  if (statusCode != null) error.statusCode = statusCode;
  error.isRetryable = isRetryable;
  error.responseHeaders = headers;
  if (cause != null) error.cause = cause;
  return error;
}
function refused() { return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:10100"), { code: "ECONNREFUSED", errno: -61, syscall: "connect" }); }
function unresolved() { return Object.assign(new Error("getaddrinfo ENOTFOUND openrouter.ai"), { code: "ENOTFOUND", errno: -3008, syscall: "getaddrinfo" }); }

test("ai-sdk 429/502/503/504 are retryable provider capacity, not unreachable", () => {
  for (const status of [429, 502, 503, 504]) {
    const error = apiCallError(status);
    assert.equal(transient.isRetryableProviderError(error), true, `retryable ${status}`);
    assert.equal(transient.isProviderCapacityError(error), true, `capacity ${status}`);
    assert.equal(transient.isBackendUnreachableError(error), false, `unreachable ${status}`);
    assert.equal(runtime.classifyAgentError(error).code, "SAND-E0401", `classified ${status}`);
  }
});

test("a refused or unresolved connect with no HTTP response is backend unreachable, not capacity", () => {
  for (const cause of [refused(), unresolved()]) {
    const error = apiCallError(undefined, { isRetryable: true, message: "Cannot connect to API: " + cause.message, cause });
    assert.equal(transient.isBackendUnreachableError(error), true, cause.code);
    assert.equal(transient.isProviderCapacityError(error), false, cause.code);
    const classified = runtime.classifyAgentError(error);
    assert.equal(classified.code, "SAND-E0418");
    assert.equal(classified.errno, cause.code);
  }
});

test("connect Unavailable keeps the 0.71 transport split", () => {
  const capacity = Object.assign(new Error("upstream busy"), { retryable: true, displayInfo: { connectCode: 14 } });
  const transport = Object.assign(new Error("connect ECONNREFUSED"), { retryable: true, displayInfo: { connectCode: 14 }, cause: refused() });
  assert.equal(transient.isProviderCapacityError(capacity), true);
  assert.equal(transient.isBackendUnreachableError(capacity), false);
  assert.equal(transient.isProviderCapacityError(transport), false);
  assert.equal(transient.isBackendUnreachableError(transport), true);
});

test("non-retryable ai-sdk errors stay non-retryable", () => {
  for (const status of [400, 401, 403, 404]) {
    const error = apiCallError(status, { isRetryable: false });
    assert.equal(transient.isRetryableProviderError(error), false, String(status));
    assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: false, resumeCheckpointAvailable: false }), false, String(status));
  }
});

test("overloaded provider is retried at turn level only before output", () => {
  const error = apiCallError(503);
  assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: false, resumeCheckpointAvailable: false }), true);
  assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: true, resumeCheckpointAvailable: false }), false);
});

test("quota wording still wins over capacity in classification", () => {
  const error = apiCallError(429, { message: "Throttling.AllocationQuota: Your token-plan 1-month quota has been exhausted" });
  assert.equal(runtime.classifyAgentError(error).code, "SAND-E0416");
});

test("retry-after on ai-sdk response headers paces the retry", () => {
  assert.equal(transient.serverRetryAfterMsFromError(apiCallError(429, { headers: { "retry-after": "5" } })), 5_000);
  assert.equal(transient.serverRetryAfterMsFromError(apiCallError(429, { headers: { "retry-after": "120" } })), 30_000);
  assert.equal(transient.serverRetryAfterMsFromError(apiCallError(429)), undefined);
  const classified = runtime.classifyAgentError(apiCallError(429, { headers: { "retry-after": "5" } }));
  assert.equal(classified.code, "SAND-E0408");
  assert.equal(classified.retryAfterMs, 5_000);
});

test("content-policy blocks are never retryable (official name set)", () => {
  for (const name of [
    "AnthropicContentPolicyBlockedError",
    "GrokContentPolicyBlockedError",
    "ResponsesContentPolicyBlockedError",
    "MetaSafetyIdentifierBlockedError",
    "OpenAICyberPolicyRequestBlockedError",
    "OpenAICyberPolicySafetyIdentifierBlockedError",
  ]) {
    const error = Object.assign(new Error("blocked"), { name, isRetryable: true, retryable: true });
    assert.equal(transient.isProviderContentPolicyBlock(error), true, name);
    assert.equal(transient.isRetryableProviderError(error), false, name);
    assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: false, resumeCheckpointAvailable: false }), false, name);
  }
});

test("StreamIdleError classifies as streamIdleStall and retries only with a resume checkpoint", () => {
  const error = new transient.StreamIdleError(90_000);
  assert.equal(error.message, "The model stopped responding mid-reply.");
  assert.equal(transient.isStreamIdleError(error), true);
  assert.equal(runtime.classifyAgentError(error).code, "SAND-E0417");
  assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: true, resumeCheckpointAvailable: false }), false);
  assert.equal(transient.shouldRetryTurnAttempt({ canceled: false, error, streamOutputProduced: true, resumeCheckpointAvailable: true }), true);
  assert.equal(transient.resolveStreamIdleDeadlineMs({}), 90_000);
  assert.equal(transient.resolveStreamIdleDeadlineMs({ SAND_STREAM_IDLE_DEADLINE_MS: "0" }), 0);
});
