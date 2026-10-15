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
  const outfile = path.join(cacheDir, `${name}-run-error-title.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs], external: ["electron"] });
  return createRequire(import.meta.url)(outfile);
}

const fallbacks = await load("source/shared/trays/tray-title-fallbacks.ts", "tray-title-fallbacks");
const runError = await load("source/host/extensions/transcript/agent-run-error.ts", "agent-run-error");
const lifecycle = await load("source/host/extensions/transcript/run-lifecycle.ts", "run-lifecycle");
const trays = await load("source/host/extensions/trays/trays-service.ts", "trays-service");
const transient = await load("source/host/runner/transient-stream-error.ts", "transient");

const overloaded = Object.assign(new Error("HTTP 503"), { name: "AI_APICallError", statusCode: 503, isRetryable: true, responseHeaders: {} });

test("hostTrayTitle falls back to the 0.71.2 TITLE_BY_KIND copy and records the title kind", () => {
  assert.deepEqual(fallbacks.hostTrayTitle({ kind: "model_provider_overloaded" }), { title: "Model provider is overloaded", titleKind: "model_provider_overloaded" });
  assert.deepEqual(fallbacks.hostTrayTitle({ kind: "bot_failed_to_respond", description: {} }), { title: "Bot failed to respond", titleKind: "bot_failed_to_respond" });
});

test("a backend-supplied title overrides the fallback and drops the title kind, as in 0.71.2", () => {
  assert.deepEqual(fallbacks.hostTrayTitle({ kind: "bot_failed_to_respond", description: { title: "Usage limit reached" } }), { title: "Usage limit reached" });
});

test("a first-token stall wrapped in a retry error is still classified as first_token_stall", () => {
  const stall = new transient.FirstTokenStallError(150_000);
  const wrapped = Object.assign(new Error("Failed after 3 attempts."), { name: "AI_RetryError", errors: [stall, stall], lastError: stall });
  assert.equal(runError.agentRunErrorKindOf(wrapped), "first_token_stall");
  assert.equal(runError.agentRunErrorKindOf(new Error("outer", { cause: stall })), "first_token_stall");
});

test("the tray keeps titleKind and errorParams, and an update without a titleKind clears it", () => {
  let n = 0;
  const manager = new trays.TrayManager(() => `tray-${++n}`, () => 1);
  const first = manager.pushError({ agentId: "a", title: "Bot failed to respond", titleKind: "bot_failed_to_respond", detail: "HTTP 400", errorKind: "unknown_failure", errorParams: { technicalDetail: "HTTP 400" }, dedupeKey: "k" });
  assert.equal(first.titleKind, "bot_failed_to_respond");
  assert.deepEqual(first.errorParams, { technicalDetail: "HTTP 400" });
  const updated = manager.pushError({ agentId: "a", title: "Custom", detail: "d", dedupeKey: "k" });
  assert.equal(updated.titleKind, undefined);
  assert.equal(updated.errorParams, undefined);
});

function noticeFor(error, source = "automation") {
  const appended = [];
  const tm = { sessions: { activeSession: { id: "agent-1" } }, appendEntry: (entry) => appended.push(entry) };
  new lifecycle.RunLifecycle(tm).appendTurnFailureNotice("agent-1", source, error);
  return appended;
}

test("the transcript failure notice leads with the kind-specific title on both run paths", () => {
  for (const source of ["automation", "manual"]) {
    const [notice, mirror] = noticeFor(overloaded, source);
    assert.ok(notice.text.startsWith("Model provider is overloaded: This turn ended without a reply"), notice.text);
    assert.equal(notice.failure.titleKind, "model_provider_overloaded");
    assert.equal(mirror.content, "⚠️ " + notice.text);
  }
  const [stall] = noticeFor(new Error("outer", { cause: new transient.FirstTokenStallError(150_000) }));
  assert.ok(stall.text.startsWith("Bot failed to respond: "), stall.text);
  assert.equal(stall.failure.errorKind, "first_token_stall");
  assert.equal(stall.failure.detail.id, "Ly7/5m");
});
