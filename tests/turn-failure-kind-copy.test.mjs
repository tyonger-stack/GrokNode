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
  const outfile = path.join(cacheDir, `${name}-kind-copy.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs], external: ["electron"] });
  return createRequire(import.meta.url)(outfile);
}

const copy = await load("source/shared/trays/agent-run-error-title-copy.ts", "title-copy");
const runError = await load("source/host/extensions/transcript/agent-run-error.ts", "agent-run-error");
const lifecycle = await load("source/host/extensions/transcript/run-lifecycle.ts", "run-lifecycle");
const transient = await load("source/host/runner/transient-stream-error.ts", "transient-kind");

function apiCallError(statusCode, extra = {}) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { name: "AI_APICallError", statusCode, isRetryable: statusCode === 429 || statusCode >= 500, responseHeaders: {} }, extra);
}
const refused = Object.assign(new Error("Cannot connect to API: connect ECONNREFUSED"), { isRetryable: true, cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });

test("official title copy matches the 0.71.2 catalogs", () => {
  assert.deepEqual(copy.TITLE_BY_KIND.model_provider_overloaded, { id: "Rdu4z7", message: "Model provider is overloaded", zh: "模型提供方已过载" });
  assert.deepEqual(copy.TITLE_BY_KIND.bot_failed_to_respond, { id: "Uq1VXs", message: "Bot failed to respond", zh: "Bot 未能回复" });
  assert.equal(copy.DETAIL_BY_ERROR_KIND.first_token_stall.id, "Ly7/5m");
  assert.equal(copy.DETAIL_BY_ERROR_KIND.provider_overloaded.zh, "模型服务商目前负载过高。这通常是暂时的，请稍后重试。");
  assert.equal(copy.DETAIL_BY_ERROR_KIND.backend_unreachable, undefined);
});

test("error kinds follow the 0.71.2 describeAgentRunError order", () => {
  assert.equal(runError.agentRunErrorKindOf(refused), "backend_unreachable");
  assert.equal(runError.agentRunErrorKindOf(apiCallError(503)), "provider_overloaded");
  assert.equal(runError.agentRunErrorKindOf(apiCallError(429)), "provider_overloaded");
  assert.equal(runError.agentRunErrorKindOf(new transient.FirstTokenStallError(150_000)), "first_token_stall");
  assert.equal(runError.agentRunErrorKindOf(Object.assign(new Error("too big"), { isConversationTooLarge: true })), "conversation_too_large");
  assert.equal(runError.agentRunErrorKindOf(new Error("socket hang up")), "opaque_wire_failure");
  assert.equal(runError.agentRunErrorKindOf(apiCallError(400)), "unknown_failure");
  const described = runError.describeAgentRunError(apiCallError(400));
  assert.equal(described.errorKind, "unknown_failure");
  assert.equal(described.errorParams.technicalDetail, "HTTP 400");
  assert.equal(described.detail, "HTTP 400");
});

test("title kind maps overloaded to its own title and everything else to Bot failed to respond", () => {
  assert.equal(copy.turnTrayTitleKind("provider_overloaded"), "model_provider_overloaded");
  for (const kind of ["backend_unreachable", "first_token_stall", "conversation_too_large", "opaque_wire_failure", "unknown_failure", undefined]) {
    assert.equal(copy.turnTrayTitleKind(kind), "bot_failed_to_respond", String(kind));
  }
});

function noticeFor(error) {
  const appended = [];
  const tm = { sessions: { activeSession: { id: "agent-1" } }, appendEntry: (entry) => appended.push(entry) };
  new lifecycle.RunLifecycle(tm).appendTurnFailureNotice("agent-1", "automation", error);
  return appended;
}

test("turn failure notice carries the classified kind and bilingual copy", () => {
  const [notice, mirror] = noticeFor(apiCallError(503));
  assert.equal(notice.kind, "notice");
  assert.deepEqual(notice.failure, {
    errorKind: "provider_overloaded",
    titleKind: "model_provider_overloaded",
    title: copy.TITLE_BY_KIND.model_provider_overloaded,
    detail: copy.DETAIL_BY_ERROR_KIND.provider_overloaded,
  });
  assert.match(notice.text, /source: automation/);
  assert.equal(mirror.kind, "message");

  const [stall] = noticeFor(new transient.FirstTokenStallError(150_000));
  assert.equal(stall.failure.errorKind, "first_token_stall");
  assert.equal(stall.failure.title.id, "Uq1VXs");
  assert.equal(stall.failure.detail.id, "Ly7/5m");
});

test("interrupted turns still produce no notice", () => {
  assert.deepEqual(noticeFor(Object.assign(new Error("aborted"), { name: "AbortError" })), []);
});
