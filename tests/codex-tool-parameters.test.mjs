import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry, outfileName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outfileName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

function isZodSchema(value) {
  return typeof value === "object" && value != null && ("~standard" in value || "_def" in value);
}

test("codex tool parameters become JSON Schema instead of raw Zod internals", async () => {
  const mod = await loadModule(
    "source/host/runner/tools/sand-computer-tool.ts",
    "codex-tool-parameters-probe.mjs",
  );
  const provider = await loadModule(
    "source/host/extensions/inference/provider-session.ts",
    "codex-tool-parameters-provider.mjs",
  );
  assert.equal(typeof provider.runRoutedProviderText, "function");
  const emptySchema = JSON.parse(JSON.stringify(mod.screenshotParameters));
  assert.ok("_def" in emptySchema, "raw serialization keeps Zod internals");
  assert.ok(isZodSchema(mod.screenshotParameters), "host tool parameters are Zod schemas");
  const { zodToJsonSchema } = await import("zod-to-json-schema");
  const converted = zodToJsonSchema(mod.screenshotParameters);
  assert.equal(converted.type, "object");
  assert.deepEqual(converted.properties, {});
  assert.ok(!("_def" in converted), "converted schema drops Zod internals");
  assert.ok(!("~standard" in converted), "converted schema drops the Zod standard marker");
  assert.ok(!isZodSchema(converted), "converted schema is no longer a Zod schema");
});

test("a plain JSON Schema tool definition is not mistaken for a Zod schema", async () => {
  const jsonSchemaTool = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  assert.equal(isZodSchema(jsonSchemaTool), false);
  const withTypeName = { type: "object", properties: {} };
  assert.equal(isZodSchema(withTypeName), false);
});


test("the openrouter toolset also converts Zod parameters before they reach the model", async () => {
  const mod = await loadModule(
    "source/host/runner/tools/sand-computer-tool.ts",
    "codex-tool-parameters-probe.mjs",
  );
  const provider = await loadModule(
    "source/host/extensions/inference/provider-session.ts",
    "codex-tool-parameters-provider.mjs",
  );
  assert.equal(typeof provider.createProviderPromptSession, "function");
  const session = provider.createProviderPromptSession("openrouter");
  assert.equal(typeof session.getExecutor, "function");
  const zodEmpty = JSON.parse(JSON.stringify(mod.screenshotParameters));
  assert.ok("_def" in zodEmpty, "raw serialization keeps Zod internals");
  const { zodToJsonSchema } = await import("zod-to-json-schema");
  const converted = zodToJsonSchema(mod.screenshotParameters, { target: "openApi3" });
  assert.equal(converted.type, "object");
  assert.ok(!("_def" in converted));
  assert.ok(!("~standard" in converted));
});

test("OpenRouter tool parameters keep closed object schemas required by Muse Spark", async () => {
  const { z } = await import("zod");
  const provider = await loadModule(
    "source/host/extensions/inference/provider-session.ts",
    "codex-tool-parameters-provider.mjs",
  );
  const schema = provider.toToolWireParameters(z.object({
    content: z.string(),
    nested: z.object({ value: z.string() }),
  }));
  assert.equal(schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(schema), /"\$ref"/);
  assert.equal(schema.properties.nested.additionalProperties, false);
});

test("Z.ai computer screenshots keep action-specific and follow-up fields optional", async () => {
  const [computer, provider] = await Promise.all([
    loadModule("source/host/runner/tools/sand-computer-tool.ts", "zai-computer-parameters.mjs"),
    loadModule("source/host/extensions/inference/provider-session.ts", "zai-provider-parameters.mjs"),
  ]);
  const tools = provider.toToolSet([
    { name: "computer_use", parameters: computer.computerActionParameters },
  ], undefined, "https://api.z.ai/api/coding/paas/v4");
  const schema = tools.computer_use.parameters.jsonSchema;
  assert.deepEqual(schema.required, ["action"]);
  assert.equal(schema.properties.then.minItems, 1);
  assert.equal(computer.computerActionParameters.safeParse({ action: "screenshot" }).success, true);
  assert.equal(computer.computerActionParameters.safeParse({ action: "screenshot", then: [] }).success, false);
  assert.equal(schema.additionalProperties, false);
});

test("Z.ai messages keep fields from other message types optional", async () => {
  const [message, provider] = await Promise.all([
    loadModule("source/host/runner/tools/send-message-schema.ts", "zai-message-parameters.mjs"),
    loadModule("source/host/extensions/inference/provider-session.ts", "zai-provider-parameters.mjs"),
  ]);
  const tools = provider.toToolSet([
    { name: "send_message", parameters: message.sendMessageParameters },
  ], undefined, "https://api.z.ai/api/coding/paas/v4");
  const schema = tools.send_message.parameters.jsonSchema;
  assert.deepEqual(schema.required, ["type"]);
  assert.deepEqual(schema.properties.widget.required, ["prompt", "options"]);
  assert.equal(message.sendMessageParameters.safeParse({ type: "text", content: "Opened Baidu." }).success, true);
});

test("strict tool backends still receive every declared property as required", async () => {
  const { z } = await import("zod");
  const provider = await loadModule(
    "source/host/extensions/inference/provider-session.ts", "strict-provider-parameters.mjs",
  );
  const parameters = z.object({ action: z.string(), then: z.array(z.string()).optional() });
  for (const baseUrl of [undefined, "http://127.0.0.1:10100/v1", "https://api.z.ai.example.com/v1"]) {
    const tools = provider.toToolSet([{ name: "test", parameters }], undefined, baseUrl);
    assert.deepEqual(tools.test.parameters.jsonSchema.required, ["action", "then"]);
    assert.equal(tools.test.parameters.jsonSchema.additionalProperties, false);
  }
});
