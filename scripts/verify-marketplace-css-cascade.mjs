#!/usr/bin/env node
// Measures the marketplace detail CTAs' COMPUTED padding headlessly, with no running app.
//
// Why this exists alongside `verify-marketplace-detail-parity.mjs` (which needs a live app): the
// keychain prompt blocks app startup after every re-sign, and the padding cascade can be settled
// without one.
//
// It inlines the stylesheet out of the DEPLOYED asar, not out of `.build/`. An earlier revision read
// `.build/fidelity/app/dist/renderer/assets/` while its own header said "DEPLOYED" — those two were
// only byte-identical by coincidence (that `.build` happened not to have been rewritten), which is
// precisely the "the bytes I checked are not the bytes I shipped" trap. It also never asserted
// WHICH asar it measured. Both are now structural: the asar path is a parameter, its sha256 is
// printed, and the stylesheet is read through the asar header.
//
// The stylesheet is INLINED, not linked. A `file://` <link> silently failed to load, every class
// then reported the UA default `1px 6px`, and that looked exactly like "none of these classes
// carry any padding" — nearly a wrong conclusion about a fix that was already correct. So the
// script asserts the stylesheet actually parsed before trusting any measurement.
//
// Usage:
//   node scripts/verify-marketplace-css-cascade.mjs ["/Applications/Grok Node.app"]
//
// Height is reported but NOT asserted: the fixture has no icon font, so `ui-icon` has different
// intrinsic metrics than in the real app. Padding, text content and child count are comparable.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.argv[2] ?? "/Applications/Grok Node.app";
const ASAR = path.join(APP, "Contents/Resources/app.asar");

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

if (!existsSync(ASAR)) {
  console.error(`no deployed asar at ${ASAR} — package and deploy first, or pass an app path`);
  process.exit(2);
}
const asarBytes = readFileSync(ASAR);

// asar header: four uint32 — @0=4, @4=headerSize, @8=string-pickle size, @12=JSON byte count.
// Data section starts at 8 + headerSize; the JSON is read at offset 16. Node offsets in the JSON
// are STRINGS, so they must go through BigInt before being added to dataStart.
const dataStart = 8 + asarBytes.readUInt32LE(4);
const header = JSON.parse(asarBytes.subarray(16, 16 + asarBytes.readUInt32LE(12)).toString("utf8"));
const cssEntries = [];
(function walk(node, pathStr) {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    const next = pathStr ? `${pathStr}/${key}` : key;
    if (value.files) walk(value, next);
    else if (key.endsWith(".css")) cssEntries.push([next, value]);
  }
})(header, "");
const cssEntry = cssEntries.find(([rel]) => /\/index-[^/]*\.css$/.test(rel));
if (!cssEntry) {
  console.error(`no renderer stylesheet in ${ASAR}`);
  process.exit(2);
}
const [, cssNode] = cssEntry;
const css = asarBytes.subarray(
  Number(BigInt(dataStart) + BigInt(cssNode.offset)),
  Number(BigInt(dataStart) + BigInt(cssNode.offset)) + cssNode.size,
);

// Class lists come from the single source of truth, not from minified output — extracting an
// array out of a bundle by bracket matching silently truncates it.
const styles = readFileSync(path.join(ROOT, "frontend/src/extensions/marketplace/official-styles.ts"), "utf8");
const classes = (name) => {
  const i = styles.indexOf(`export const ${name}`);
  if (i < 0) throw new Error(`official-styles.ts has no ${name}`);
  const s = styles.indexOf("[", i);
  const e = styles.indexOf("]", s);
  return (styles.slice(s, e).match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
};
const scope = styles.match(/MARKET_SCOPE_CLASS\s*=\s*"([^"]+)"/)?.[1] ?? "sand-mkt";

// The lifted rules are read from official-styles.ts, NOT hardcoded here. An earlier revision kept a
// literal copy, which meant a source-side regression (a dropped or renamed rule) would still measure
// green because the script never saw the source. Reading the real list makes this falsifiable in the
// direction that matters: drop a rule in the source and the measurement below loses its 14px.
//
// Entry shape is `readonly [string, string] | readonly [string, string, string]`, where the optional
// third element is a pseudo-selector (`:focus-visible`, `::after`). A first pass matched only the
// two-element form and silently parsed 42 of 45 — the three focus/after rules vanished without any
// error. `expectEntries` below is an independent count of entry openings, so a shape this regex does
// not understand turns into a loud failure instead of a quietly smaller fixture.
const liftStart = styles.indexOf("export const LIFTED_OFFICIAL_RULES");
if (liftStart < 0) throw new Error("official-styles.ts has no LIFTED_OFFICIAL_RULES");
const liftOpen = styles.indexOf("[", liftStart);
const liftEnd = styles.indexOf("\n]", liftOpen);
const liftBody = styles.slice(liftOpen, liftEnd);
const lifts = (liftBody.match(/\[\s*"[^"]+"\s*,\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*)?\]/g) ?? []).map((entry) =>
  entry.match(/"([^"]+)"/g).map((x) => x.slice(1, -1)),
);
const entryOpenings = (liftBody.match(/\[\s*"/g) ?? []).length;
if (lifts.length !== entryOpenings) {
  console.error(`lift parser read ${lifts.length} of ${entryOpenings} entries — refusing to measure a truncated fixture`);
  process.exit(2);
}

// The two inline-padding lifts are the ones under test. Assert they survived parsing, so a rename or
// a malformed entry fails loudly here instead of quietly measuring a rule that is no longer shipped.
for (const required of ["sand-1pic42t", "sand-1onr9mi"]) {
  if (!lifts.some(([cls]) => cls === required)) {
    console.error(`LIFTED_OFFICIAL_RULES lost ${required} (${lifts.length} entries parsed) — refusing to measure`);
    process.exit(2);
  }
}
// Mirrors view.ts installStyles: `${scope}.${cls}${pseudo}{…}` and `${scope} .${cls}${pseudo}{…}`.
const liftCss = lifts
  .map(([cls, declarations, pseudo = ""]) => `.${scope}.${cls}${pseudo}{${declarations}} .${scope} .${cls}${pseudo}{${declarations}}`)
  .join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8">
<style id="deployed">${css}</style>
<style id="lifted">${liftCss}</style>
</head><body><div class="${scope}">
<button id="add" class="${classes("DETAIL_ADD_ACCOUNT_FULL_CLASSES").join(" ")}"><i class="ui-icon"></i>添加其他账户</button>
<button id="tools" class="${classes("DETAIL_TOOLS_ROW_CLASSES").join(" ")}"><span>已启用 23/23 个</span><i class="ui-icon"></i></button>
</div><pre id="out"></pre><script>
const m = (id) => { const n = document.getElementById(id); const cs = getComputedStyle(n);
  return { id, padding: cs.padding, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
           height: Math.round(n.getBoundingClientRect().height), textContent: n.textContent,
           childCount: n.children.length }; };
document.getElementById("out").textContent = JSON.stringify({
  sheets: document.styleSheets.length,
  rules: document.styleSheets[0] ? [...document.styleSheets[0].cssRules].length : -1,
  measured: [m("add"), m("tools")] });
</script></body></html>`;

const tmp = path.join("/tmp", `mkt-cascade-${process.pid}.html`);
writeFileSync(tmp, html);
const dom = execFileSync(
  CHROME,
  ["--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", "--dump-dom", `file://${tmp}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const json = /<pre id="out">(\{[\s\S]*?\})<\/pre>/.exec(dom)?.[1];
if (!json) { console.error("no measurement captured"); process.exit(2); }
const result = JSON.parse(json.replaceAll("&quot;", '"'));

// A zero-rule stylesheet means the inline failed; every value below would then be a UA default.
if (result.sheets < 1 || result.rules < 1000) {
  console.error(`deployed stylesheet did not parse (${result.sheets} sheets, ${result.rules} rules) — refusing to report a measurement`);
  process.exit(2);
}
console.log(`app       ${APP}`);
console.log(`asar      ${sha(asarBytes)}  (${asarBytes.length} bytes)`);
console.log(`stylesheet ${cssEntry[0]}  ${cssNode.size} bytes  ${sha(css)}  ${result.rules} rules parsed`);
console.log(`lifts     ${lifts.length} rules read from official-styles.ts`);
console.log("");

const EXPECT = {
  add: { padding: "12px 14px", textContent: "添加其他账户", childCount: 1 },
  tools: { padding: "12px 14px", textContent: "已启用 23/23 个", childCount: 2 },
};
let failed = 0;
for (const row of result.measured) {
  const want = EXPECT[row.id];
  for (const field of Object.keys(want)) {
    const good = row[field] === want[field];
    if (!good) failed += 1;
    console.log(`${good ? "PASS" : "FAIL"}  ${row.id.padEnd(6)} ${field.padEnd(11)} got=${JSON.stringify(row[field])} want=${JSON.stringify(want[field])}`);
  }
  console.log(`info  ${row.id.padEnd(6)} height       ${row.height}px (not asserted: no icon font in this fixture)`);
}
console.log(`\n${failed === 0 ? "ALL ASSERTED CHECKS PASS" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
