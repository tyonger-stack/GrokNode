// Compare literal feature surfaces between official 0.75.8 and Grok Node's
// shipped upstream renderer + readable frontend. Evidence-only: a surface is
// "present" only when the literal appears in the artifacts.
import fs from "node:fs";
import path from "node:path";

const OFF = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/app/dist/renderer/assets";
const NODE = "/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/src/app/dist/renderer/assets";
const NODE_FE = "/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/frontend/src";

function corpus(dir, pred) {
  const out = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { for (const [k, v] of corpus(full, pred)) out.set(k, v); continue; }
    if (pred(e.name)) out.set(full, fs.readFileSync(full, "utf8"));
  }
  return out;
}

const off = corpus(OFF, (n) => n.endsWith(".js"));
const node = corpus(NODE, (n) => n.endsWith(".js"));
const nodeFe = corpus(NODE_FE, (n) => /\.(ts|tsx|js|jsx|json|css)$/.test(n));

function hits(c, needle) {
  let files = 0, n = 0;
  for (const [f, t] of c) {
    let i = t.indexOf(needle);
    if (i === -1) continue;
    files += 1;
    while (i !== -1) { n += 1; i = t.indexOf(needle, i + needle.length); }
  }
  return { files, n };
}

const probes = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rows = [];
for (const p of probes) {
  const o = hits(off, p.needle);
  const g = hits(node, p.needle);
  const f = hits(nodeFe, p.needle);
  rows.push({
    surface: p.surface,
    needle: p.needle,
    official: o.files > 0,
    official_files: o.files,
    official_hits: o.n,
    node_upstream: g.files > 0,
    node_files: g.files,
    node_hits: g.n,
    node_frontend: f.files > 0,
    fe_files: f.files,
    verdict: o.files > 0 && g.files === 0 && f.files === 0 ? "MISSING" : o.files > 0 ? "PRESENT" : "NOT-IN-OFFICIAL",
  });
}
console.table(rows.map((r) => ({
  surface: r.surface, verdict: r.verdict, off: r.official_files, gn: r.node_files, fe: r.fe_files, needle: r.needle,
})));
fs.writeFileSync(process.argv[3] ?? "/tmp/surface-diff.json", JSON.stringify(rows, null, 2));
