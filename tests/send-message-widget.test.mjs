import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TS_SUFFIX = ".ts";
const JS_SUFFIX = ".js";

async function loadSchema() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "send-message-widget-probe.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/tools/send-message-schema.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /./ }, (args) => {
          if (!args.path.endsWith(JS_SUFFIX)) return null;
          const candidate = path.resolve(path.dirname(args.importer), args.path.slice(0, -JS_SUFFIX.length) + TS_SUFFIX);
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

test("widget accepts a plain object with options", async () => {
  const mod = await loadSchema();
  const parsed = mod.sendMessageParameters.safeParse({
    type: "widget",
    widget: { prompt: "Deploy to production?", options: [{ label: "Deploy" }, { label: "Cancel" }] },
  });
  assert.equal(parsed.success, true);
});

test("widget accepts a JSON-encoded string of the object", async () => {
  const mod = await loadSchema();
  const widget = JSON.stringify({ prompt: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] });
  const parsed = mod.sendMessageParameters.safeParse({ type: "widget", widget });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.widget.prompt, "Proceed?");
  assert.equal(parsed.data.widget.options.length, 2);
});

test("widget options accept bare label strings", async () => {
  const mod = await loadSchema();
  const parsed = mod.sendMessageParameters.safeParse({
    type: "widget",
    widget: { prompt: "Pick one?", options: ["Alpha", "Beta"] },
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.widget.options[0].label, "Alpha");
  assert.equal(parsed.data.widget.options[1].label, "Beta");
});

test("widget still rejects a plain non-JSON string", async () => {
  const mod = await loadSchema();
  const parsed = mod.sendMessageParameters.safeParse({ type: "widget", widget: "just a prompt" });
  assert.equal(parsed.success, false);
});

test("widget wire schema still describes an object for models", async () => {
  const mod = await loadSchema();
  const { zodToJsonSchema } = await import("zod-to-json-schema");
  const converted = zodToJsonSchema(mod.sendMessageParameters, { target: "openApi3" });
  const widget = converted.properties && converted.properties.widget;
  assert.ok(widget, "widget property exists in wire schema");
  assert.equal(widget.type, "object", "model still sees widget as an object");
  assert.ok(widget.properties && widget.properties.prompt, "prompt stays visible");
  assert.ok(widget.properties && widget.properties.options, "options stay visible");
});
