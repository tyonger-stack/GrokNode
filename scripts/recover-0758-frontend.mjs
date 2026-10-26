// Reformat the official 0.75.8 renderer chunks into readable JSX-ish modules.
// Purely syntactic: esbuild parse + pretty print. No execution, no renaming.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ASSETS = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/app/dist/renderer/assets";
const OUT = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/frontend";
const MANIFEST = path.join(OUT, "manifest.json");

const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".js")).sort();
fs.mkdirSync(OUT, { recursive: true });

const entries = [];
let ok = 0;
let fail = 0;

for (const file of files) {
  const src = fs.readFileSync(path.join(ASSETS, file), "utf8");
  const outName = file.replace(/\.js$/, ".mjs");
  try {
    const res = await esbuild.transform(src, {
      loader: "js",
      format: "esm",
      target: "esnext",
      minify: false,
      jsx: "preserve",
      sourcemap: false,
      legalComments: "none",
    });
    fs.writeFileSync(path.join(OUT, outName), res.code);
    entries.push({
      source: file,
      output: outName,
      source_bytes: Buffer.byteLength(src),
      output_bytes: Buffer.byteLength(res.code),
      sha256: crypto.createHash("sha256").update(src).digest("hex"),
      status: "ok",
    });
    ok += 1;
  } catch (error) {
    entries.push({ source: file, output: null, status: "error", error: String(error?.message ?? error) });
    fail += 1;
  }
}

fs.writeFileSync(MANIFEST, JSON.stringify({ assets: ASSETS, ok, fail, entries }, null, 2));
console.log(`reformatted ${ok} chunks, ${fail} failed -> ${OUT}`);
