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

const sharedOut = path.join(cacheDir, "auto-review-expiry-cause-shared.cjs");
await build({ entryPoints: [path.join(root, "source/shared/transcript.ts")], bundle: true, platform: "node", format: "cjs", outfile: sharedOut, logLevel: "error" });
const shared = createRequire(import.meta.url)(sharedOut);

test("expiry notes name the cause and point at a fresh card", () => {
  const redirect = shared.formatAutoReviewExpiryNote("user_redirect");
  assert.match(redirect, /new message/);
  assert.match(redirect, /fresh approval card/);
  assert.match(shared.formatAutoReviewExpiryNote("session_end"), /session ended/);
  assert.match(shared.formatAutoReviewExpiryNote("quiesce"), /not a denial/);
  for (const cause of ["ttl", "cancelled", "settings_change", "user_redirect", "session_end", "quiesce", "something-new"]) {
    assert.equal(typeof shared.formatAutoReviewExpiryNote(cause), "string");
    assert.ok(shared.formatAutoReviewExpiryNote(cause).length > 0);
  }
  assert.notEqual(shared.formatAutoReviewExpiryNote("user_redirect"), shared.formatAutoReviewExpiryNote("session_end"));
});

test("expiry note appends once and preserves the original reason", () => {
  const note = shared.formatAutoReviewExpiryNote("user_redirect");
  assert.equal(shared.withAutoReviewExpiryNote(undefined, "user_redirect"), note);
  assert.equal(shared.withAutoReviewExpiryNote("", "user_redirect"), note);
  const merged = shared.withAutoReviewExpiryNote("Classifier reason.", "user_redirect");
  assert.ok(merged.startsWith("Classifier reason."));
  assert.ok(merged.includes(note));
  assert.equal(shared.withAutoReviewExpiryNote(merged, "user_redirect"), merged);
});

const serviceOut = path.join(cacheDir, "auto-review-expiry-cause-service.cjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/auto-review/auto-review-service.ts")], bundle: true, platform: "node", format: "cjs", outfile: serviceOut, logLevel: "error", plugins: [jsToTs] });
const api = createRequire(import.meta.url)(serviceOut);

test("parked computer approval retired by a new message reports user_redirect", async () => {
  const updates = [];
  const service = new api.AutoReviewService({
    auth: {}, experiments: { checkFeatureGate: () => true },
    settings: { getAutoReviewInstructions: () => ({ isEnabled: true, allowInstructions: [], blockInstructions: [] }) },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} },
    transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test-generation",
    createClassifierExecutor: () => ({}),
  });
  const binding = service.bindRunner({ agentId: "expiry-cause-test", onUpdate: (value) => updates.push(value) });
  try {
    const pending = binding.autoReviewController.requestApproval({
      agentId: "expiry-cause-test", surface: "computer", fingerprint: "fp", reason: "Risky click.", summary: "Click at (1, 2)", expiryPolicy: "park",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(updates.some((u) => u.type === "send-message" && u.message?.approval?.status === "pending"));
    binding.autoReviewController.beginUserMessageEpoch();
    const decision = await pending;
    assert.equal(decision.approved, false);
    const status = updates.find((u) => u.type === "auto-review-status");
    assert.ok(status, "expected an auto-review-status update");
    assert.equal(status.status, "expired");
    assert.equal(status.cause, "user_redirect");
  } finally { service.stop(); }
});
