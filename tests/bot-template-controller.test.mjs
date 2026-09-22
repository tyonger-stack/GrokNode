import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/bot-template-controller.mjs");
const record = { templateId: "example", sourceUrl: "https://x.ai/bot/example", name: "Example", description: "Full instructions", author: null, color: null, shape: null };
async function controller() {
  await mkdir(path.dirname(output), { recursive: true });
  await build({ entryPoints: [path.join(root, "source/electron-main/deep-link/bot-template-controller.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "error" });
  return import(pathToFileURL(output).href);
}

test("preview creates nothing and repeated confirmations create one local Bot", async () => {
  const { createBotTemplateController } = await controller();
  const calls = [];
  const service = createBotTemplateController({ fetchTemplate: async () => record, createAgent: async (input) => { calls.push(input); return { agent: { id: "local-one" } }; } });
  const preview = await service.preview("example");
  assert.equal(calls.length, 0);
  const results = await Promise.all([service.import(preview.previewId), service.import(preview.previewId)]);
  assert.deepEqual(results, [{ agentId: "local-one" }, { agentId: "local-one" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].description, record.description);
  await service.import(preview.previewId);
  assert.equal(calls.length, 1);
});

test("failed import can retry with the same nonce and invalid confirmation cannot create", async () => {
  const { createBotTemplateController } = await controller();
  const calls = [];
  const service = createBotTemplateController({ fetchTemplate: async () => record, createAgent: async (input) => { calls.push(input); if (calls.length === 1) throw new Error("offline"); return { agent: { id: "retried" } }; } });
  await assert.rejects(() => service.import("unpreviewed"), /preview/i);
  assert.equal(calls.length, 0);
  const preview = await service.preview("example");
  await assert.rejects(() => service.import(preview.previewId), /offline/);
  assert.deepEqual(await service.import(preview.previewId), { agentId: "retried" });
  assert.equal(calls[0].clientNonce, calls[1].clientNonce);
});
