/**
 * Locate the official 0.75.8 renderer chunks that implement the Connect Apps surface
 * and report their import graph, so a transplant can be scoped from evidence rather
 * than from a screenshot.
 *
 * Read-only over the extracted asar.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
const needles = process.argv.slice(3);

const files = (await readdir(assetsDir)).filter((name) => name.endsWith(".js"));

/** Matches the import specifier list of an ES module chunk. */
function importsOf(source) {
  const specifiers = new Set();
  const re = /(?:^|[;\s}])(?:import|export)\s*(?:[\w${}*,\s]*?\sfrom\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (match[1].startsWith(".")) specifiers.add(match[1]);
  }
  return specifiers;
}

const hits = new Map();
for (const name of files) {
  const source = await readFile(path.join(assetsDir, name), "utf8");
  const found = needles.filter((needle) => source.includes(needle));
  if (found.length > 0) hits.set(name, { found, bytes: source.length });
}

console.log("## chunk hits");
for (const [name, info] of [...hits.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`   ${String(info.bytes).padStart(9)}  ${name}   <- ${info.found.join(", ")}`);
}

// Closure: every chunk reachable from the hits through local imports.
const sources = new Map();
for (const name of files) sources.set(name, await readFile(path.join(assetsDir, name), "utf8"));

const seen = new Set();
const queue = [...hits.keys()];
while (queue.length > 0) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  const source = sources.get(name);
  if (source == null) continue;
  for (const specifier of importsOf(source)) {
    const target = specifier.replace(/^\.\//, "");
    if (!seen.has(target) && sources.has(target)) queue.push(target);
  }
}

console.log(`\n## reachable closure from hits: ${seen.size} chunks`);
const allHits = [...hits.keys()];
const external = new Set();
for (const name of allHits) {
  for (const specifier of importsOf(sources.get(name))) {
    const target = specifier.replace(/^\.\//, "");
    if (!sources.has(target)) external.add(target);
  }
}
console.log("## external (non-asset) imports from hits:", [...external].sort().join(", ") || "(none)");
