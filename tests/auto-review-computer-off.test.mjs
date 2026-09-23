import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "node_modules", ".cache"), { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const outfile = path.join(root, "node_modules", ".cache", "auto-review-computer-off.cjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/auto-review/auto-review-service.ts")], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs] });
const api = createRequire(import.meta.url)(outfile);

function serviceWith({ gate = true, instructions = { isEnabled: true, allowInstructions: [], blockInstructions: [] } } = {}) {
  return new api.AutoReviewService({
    auth: {}, experiments: { checkFeatureGate: () => gate },
    settings: { getAutoReviewInstructions: () => instructions },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} },
    transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test-generation",
    createClassifierExecutor: () => ({}),
  });
}

test("computer surface stays off while shell keeps the resolved mode", () => {
  const service = serviceWith();
  const binding = service.bindRunner({ agentId: "computer-off-test", onUpdate: () => {} });
  try {
    assert.equal(binding.autoReviewModes.computer, "off");
    assert.equal(binding.autoReviewModes.hostShell, "enforce");
    assert.equal(binding.autoReviewModes.mcp, "enforce");
  } finally { service.stop(); }
});

test("disabling auto-review keeps every surface off", () => {
  const service = serviceWith({ instructions: { isEnabled: false, allowInstructions: [], blockInstructions: [] } });
  const binding = service.bindRunner({ agentId: "computer-off-test", onUpdate: () => {} });
  try {
    for (const mode of Object.values(binding.autoReviewModes)) assert.equal(mode, "off");
  } finally { service.stop(); }
});
