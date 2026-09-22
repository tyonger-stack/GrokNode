import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadProvider() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "provider-message-adaptation.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/inference/provider-session.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
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
  return import(pathToFileURL(outfile).href + "?" + Date.now());
}

test("Codex input preserves image parts, assistant tool calls, tool results, and message roles", async () => {
  const provider = await loadProvider();
  const input = provider.toCodexInputMessages([
    { role: "system", content: "You are local." },
    { role: "user", content: [{ type: "text", text: "Inspect this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "Shell", args: { command: "pwd" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", result: { output: "/workspace" } }] },
  ]);
  assert.deepEqual(input, [
    { role: "system", content: [{ type: "input_text", text: "You are local." }] },
    { role: "user", content: [{ type: "input_text", text: "Inspect this" }, { type: "input_image", image_url: "data:image/png;base64,AAA" }] },
    { type: "function_call", call_id: "call-1", name: "Shell", arguments: "{\"command\":\"pwd\"}" },
    { type: "function_call_output", call_id: "call-1", output: "{\"output\":\"/workspace\"}" },
  ]);
});
