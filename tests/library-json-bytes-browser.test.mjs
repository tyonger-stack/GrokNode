import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function loadModule() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/shared/library/json-bytes.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

test("node round-trip still uses Buffer when present", async () => {
  const { encodeLibraryJson, decodeLibraryJson } = await loadModule();
  assert.ok(globalThis.Buffer, "node test env has Buffer");
  const bytes = new Uint8Array([1, 2, 250, 0, 255]);
  const wire = encodeLibraryJson({ assets: [{ name: "a.png", bytes }] });
  assert.deepEqual(wire, { assets: [{ name: "a.png", bytes: { $b64: Buffer.from(bytes).toString("base64") } }] });
  const back = decodeLibraryJson(wire);
  assert.ok(back.assets[0].bytes instanceof Uint8Array);
  assert.deepEqual(back.assets[0].bytes, bytes);
});

test("browser bundle decodes with no Buffer global via atob", async () => {
  const vm = await import("node:vm");
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/shared/library/json-bytes.ts")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const sandbox = { module: { exports: {} }, atob: globalThis.atob, URL: globalThis.URL };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "json-bytes.browser.cjs" });
  const decodeInBrowser = sandbox.module.exports.decodeLibraryJson;
  assert.equal(typeof sandbox.Buffer, "undefined", "context truly has no Buffer");
  const out = decodeInBrowser({ assets: [{ name: "logo.png", bytes: { $b64: PNG_B64 } }] });
  const bytes = out.assets[0].bytes;
  assert.equal(bytes?.constructor?.name, "Uint8Array");
  const expected = globalThis.Buffer.from(PNG_B64, "base64");
  assert.equal(bytes.length, expected.length);
  assert.deepEqual(Array.from(bytes), Array.from(expected));
});

test("decode passes real Uint8Array through untouched", async () => {
  const { decodeLibraryJson } = await loadModule();
  const bytes = new Uint8Array([9, 8, 7]);
  assert.equal(decodeLibraryJson(bytes), bytes);
  assert.deepEqual(decodeLibraryJson({ raw: bytes }), { raw: bytes });
});
