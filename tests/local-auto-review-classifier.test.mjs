import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local auto-review classifier produces a local confirmation decision without Cursor", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "local-auto-review-classifier.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({ entryPoints: [path.join(repoRoot, "source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error", plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(repoRoot + "/source") && existsSync(candidate) ? { path: candidate } : null; }); } }] });
  const module = await import(pathToFileURL(outfile).href + "?" + Date.now());
  const result = await module.createLocalSmartModeClassifierExecutor().execute({}, {});
  assert.equal(result.result.case, "success");
  assert.equal(result.result.value.decision, 2);
  assert.match(result.result.value.blockReason, /Local Auto-review/);
});

test("background Shell exposes the retry parameters required by local Auto-review", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "background-shell-approval.cjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({ entryPoints: [path.join(repoRoot, "source/packages/agent/tools/core/shell/create-shell-tool.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", outfile, logLevel: "error" });
  const module = createRequire(import.meta.url)(outfile);
  const tool = module.createShellTool({ get: () => ({}) }, { agentType: "background", smartModeClassifierMode: true, smartModeApprovalProvider: { requestApproval: async () => ({ approved: true }) } });
  const properties = tool.parameters.jsonSchema.properties;
  assert.ok(properties.request_smart_mode_approval);
  assert.ok(properties.smart_mode_block_reason);
});
