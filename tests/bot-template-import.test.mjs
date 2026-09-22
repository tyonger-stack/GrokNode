import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(entry, name) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", name + ".mjs");
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile, bundle: true, platform: "node", format: "esm", logLevel: "error" });
  return import(pathToFileURL(outfile).href + "?" + Date.now());
}

test("bot template links parse for the x.ai page and grokbot protocol", async () => {
  const deepLinks = await load("source/shared/deep-link.ts", "bot-template-deep-links");
  for (const [url, source] of [["https://x.ai/bot/_jOdbfkB16zxu7MRcmReE", "https"], ["grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE", "protocol"]]) {
    const parsed = deepLinks.parseSandDeepLink(url);
    assert.equal(parsed?.link.route, "bot-template");
    assert.equal(parsed?.link.templateId, "_jOdbfkB16zxu7MRcmReE");
    assert.equal(parsed?.link.source, source);
  }
});

test("public bot template metadata becomes a local agent profile", async () => {
  const importer = await load("source/electron-main/deep-link/bot-template-import.ts", "bot-template-import");
  const record = importer.parseBotTemplateDocument('<title>dr eggbot</title><meta property="og:description" content="Designs high-quality Grok Bots.">', "_jOdbfkB16zxu7MRcmReE", "https://x.ai/bot/_jOdbfkB16zxu7MRcmReE");
  assert.deepEqual(record, { templateId: "_jOdbfkB16zxu7MRcmReE", sourceUrl: "https://x.ai/bot/_jOdbfkB16zxu7MRcmReE", name: "dr eggbot", description: "Designs high-quality Grok Bots.", author: null, color: null, shape: null });
});


test("public Flight data supplies full instructions instead of truncated metadata", async () => {
  const importer = await load("source/electron-main/deep-link/bot-template-import.ts", "bot-template-full");
  const full = 'Complete instructions: ask preferences.\nThen create the Bot. 中文 & "quotes"';
  const data = ["$", "component", null, { id: "sample", botName: "Example", description: full, sharerName: null, color: "#FF263C", shape: "teardrop" }];
  const flight = '2b:' + JSON.stringify(data) + '\n';
  const html = '<meta property="og:description" content="Complete instructions..."><script>self.__next_f.push(' + JSON.stringify([1, flight]) + ')</script>';
  const result = importer.parseBotTemplateDocument(html, "sample", "https://x.ai/bot/sample");
  assert.equal(result.description, full);
  assert.equal(result.author, null);
  assert.equal(result.shape, "teardrop");
});

test("empty, truncated, and mismatched public pages cannot mint placeholder Bots", async () => {
  const importer = await load("source/electron-main/deep-link/bot-template-import.ts", "bot-template-invalid");
  for (const html of ["<html>Not found</html>", '<title>Bot</title><meta name="description" content="Truncated...">']) {
    assert.throws(() => importer.parseBotTemplateDocument(html, "sample", "https://x.ai/bot/sample"), /complete Bot template/);
  }
  let called = false;
  await assert.rejects(() => importer.fetchBotTemplateRecord("../invalid", async () => { called = true; }), /Invalid/);
  assert.equal(called, false);
});
