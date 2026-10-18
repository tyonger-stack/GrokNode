import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import { patchComputerPreviewStream, portOfficialPreviewOpenWake } from "../scripts/lib/computer-preview-stream-renderer-patch.mjs";

const canonicalPath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");

test("official He() open-vs-wake is ported into the preview frame click", { skip: existsSync(canonicalPath) ? false : "Bootstrap the pinned renderer." }, () => {
  const source = readFileSync(canonicalPath, "utf8");
  assert.match(source, /onClick:\(\)=>l\(h\?\.subagentId\)/, "pristine _bn always opens");
  assert.doesNotMatch(source, /onClick:\(\)=>E\?l\(h\?\.subagentId\):e\.ensure\(\)/);

  const ported = portOfficialPreviewOpenWake(source);
  assert.match(ported, /onClick:\(\)=>E\?l\(h\?\.subagentId\):e\.ensure\(\)/, "asleep click ensure()s like 0.71.2 He/Z");
  assert.doesNotMatch(ported, /onClick:\(\)=>l\(h\?\.subagentId\)/);
  assert.match(ported, /emptyMessage:"Waking…"/, "sidebar starting copy is official pwcnuW (Waking…)");
  assert.doesNotMatch(ported, /subjectLabel:r,emptyMessage:void 0,isEmptyLoading:A/);

  // Full packaging path still parses.
  const patched = patchComputerPreviewStream(source);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  assert.match(patched, /onClick:\(\)=>E\?l\(h\?\.subagentId\):e\.ensure\(\)/);
  assert.match(patched, /RCompPreviewFrameBase/);
});

test("reverting the He() port to always-open fails the guard", { skip: existsSync(canonicalPath) ? false : "Bootstrap the pinned renderer." }, () => {
  const source = readFileSync(canonicalPath, "utf8");
  const ported = portOfficialPreviewOpenWake(source);
  const mutated = ported.replace("onClick:()=>E?l(h?.subagentId):e.ensure()", "onClick:()=>l(h?.subagentId)");
  assert.throws(() => portOfficialPreviewOpenWake(mutated), /partially present|ambiguous|missing/);
});
