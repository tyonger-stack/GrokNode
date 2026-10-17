/**
 * P2-3: browser_save_pdf — official 0.71.2 saves page.pdf() under /workspace/browser-pdfs.
 * This driver exposes a dedicated `pdf` op (no Playwright run-code surface on 0.18).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}-browser-save-pdf.cjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
    external: ["electron", "playwright-core"],
  });
  return createRequire(import.meta.url)(outfile);
}

const driver = await load("source/host/runner/tools/sand-browser-driver-source.ts", "driver");

test("driver version bumps when the pdf op lands", () => {
  assert.equal(driver.SAND_BROWSER_DRIVER_VERSION, 3);
  assert.match(driver.SAND_BROWSER_DRIVER_BOX_PATH, /driver-v3\.mjs$/);
});

test("browser_save_pdf tool is registered with pdf op and skips screenshots", async () => {
  const toolsSource = await readFile(path.join(root, "source/host/runner/tools/sand-browser-tools.ts"), "utf8");
  assert.match(toolsSource, /name:\s*"browser_save_pdf"/);
  assert.match(toolsSource, /op:\s*"pdf"/);
  assert.match(toolsSource, /skipScreenshot:\s*true/);
  assert.match(toolsSource, /\/workspace\/browser-pdfs/);
});

test("driver source wires pdf → page.pdf under /workspace/browser-pdfs", async () => {
  const source = await readFile(path.join(root, "source/host/runner/tools/sand-browser-driver-source.ts"), "utf8");
  assert.match(source, /\bpdf:\s*async\s*\(/);
  assert.match(source, /page\.pdf\s*\(/);
  assert.match(source, /["']\/workspace\/browser-pdfs["']/);
  assert.match(source, /printBackground/);
  const pageCountLine = source.split("\n").find((line) => line.includes("pageCount = Math.max"));
  assert.ok(pageCountLine, "pageCount line present");
  // Must evaluate: double-escaped \/Type junk throws "Invalid regular expression flags".
  const fn = new Function(
    "asText",
    pageCountLine.trim().replace(/^const pageCount = /, "return ").replace(/;$/, ""),
  );
  assert.equal(fn("/Type /Page\n/Type/Page"), 2);
  assert.equal(fn("no pages here"), 1);
});
