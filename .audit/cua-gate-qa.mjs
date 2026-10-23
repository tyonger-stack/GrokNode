import { build } from "esbuild";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const out = mkdtempSync(path.join(tmpdir(), "cua-qa-"));
await build({
  entryPoints: [path.join(repo, "source/electron-main/computer-use/local-computer-use-gate.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(out, "gate.mjs"),
  logLevel: "silent",
});
const gate = await import(path.join(out, "gate.mjs"));

const sandboxRoot = mkdtempSync(path.join(tmpdir(), "cua-sandbox-"));
process.env.SAND_DATA_ROOT = sandboxRoot;

const markerPath = gate.getLocalComputerUseGatePath();
const queried = [];
const failures = [];
const publisher = gate.publishLocalComputerUseGate(
  { checkFeatureGate: (name) => { queried.push(name); return true; }, subscribe: () => () => {} },
  (area, leg, error) => failures.push([area, leg, String(error)]),
);

console.log(JSON.stringify({
  markerPath,
  sandboxRoot,
  gateNameQueried: queried,
  failures,
  onDisk: JSON.parse(readFileSync(markerPath, "utf8")),
  fileMode: (statSync(markerPath).mode & 0o777).toString(8),
  readBack: gate.readLocalComputerUseGate(),
}, null, 2));

publisher.dispose();
