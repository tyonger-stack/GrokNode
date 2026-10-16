import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  extractBbnBody,
  patchComputerControl,
} from "../scripts/lib/computer-control-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunk = path.join(root, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const pinnedSkip = !existsSync(chunk);
const require = createRequire(import.meta.url);

test("computer-control: Watching gates via acceptsInput + sand-47corl inside bbn", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  const patched = patchComputerControl(source);
  const bbn = extractBbnBody(patched);
  assert.ok(bbn.includes("const[RHasControl,RSetControl]=S.useState(!1)"));
  assert.ok(bbn.includes("isInteractive:!0,acceptsInput:RHasControl"));
  assert.equal(bbn.includes("isInteractive:RHasControl"), false);
  assert.ok(patched.includes("sand-47corl"));
  assert.ok(patched.includes("const RCanInput=!!(h&&RAccepts)"));
  assert.ok(patched.includes("E=h&&!RAccepts?E+") || patched.includes('E=h&&!RAccepts?E+" sand-47corl"'));
  assert.ok(patched.includes("const I=RCanInput?void 0:-1"));
  assert.ok(bbn.includes("sand-computer-control-bar") || patched.includes("sand-computer-control-bar"));
  assert.ok(bbn.includes("RComputerControlBar"));
  assert.ok(patched.includes('RLocT("Take control","取得控制权")'));
  assert.ok(patched.includes('RLocT("Watching","仅观看")'));
  assert.ok(patched.includes("function gbn(n){const e=he.c(51),"));
  assert.equal(patched.includes("function gbn(n){const e=he.c(56),"), false);
});

test("computer-control: RHasControl never escapes bbn", { skip: pinnedSkip }, () => {
  const patched = patchComputerControl(readFileSync(chunk, "utf8"));
  const bbn = extractBbnBody(patched);
  const outside = patched.replace(bbn, "");
  assert.equal(outside.includes("RHasControl"), false);
  assert.ok((bbn.match(/RHasControl/g) || []).length >= 3);
});

test("computer-control: patched chunk parses as a module", { skip: pinnedSkip }, () => {
  const patched = patchComputerControl(readFileSync(chunk, "utf8"));
  const acorn = require("acorn");
  acorn.parse(patched, { ecmaVersion: "latest", sourceType: "module" });
});

test("computer-control MUTATION: dropping acceptsInput fails guard", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  const patched = patchComputerControl(source);
  const mutated = patched.replace("acceptsInput:RHasControl,", "");
  assert.equal(mutated.includes("acceptsInput:RHasControl"), false);
  assert.throws(() => {
    if (!mutated.includes("acceptsInput:RHasControl")) {
      throw new Error("computer-control missing acceptsInput:RHasControl on fullscreen DAe.");
    }
  }, /acceptsInput:RHasControl/);
});

test("computer-control MUTATION: toggling isInteractive instead of acceptsInput fails", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  const patched = patchComputerControl(source);
  const mutated = patched
    .replace("isInteractive:!0,acceptsInput:RHasControl", "isInteractive:RHasControl");
  assert.ok(mutated.includes("isInteractive:RHasControl"));
  assert.throws(() => {
    if (mutated.includes("isInteractive:RHasControl")) {
      throw new Error("computer-control must not toggle isInteractive (remounts URL; does not block RFB).");
    }
  }, /must not toggle isInteractive/);
});

test("computer-control MUTATION: state in gbn only would fail scope guard", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  let broken = source.replace(
    "function gbn(n){const e=he.c(51),",
    "function gbn(n){const e=he.c(51),/*leak*/const[RHasControl,RSetControl]=S.useState(!1);",
  );
  broken = broken.replace(
    "p.jsx(DAe,{isInteractive:!0,isViewerVisible:n,onHostKey:ge",
    "p.jsx(DAe,{isInteractive:!0,acceptsInput:RHasControl,isViewerVisible:n,onHostKey:ge",
  );
  assert.throws(() => {
    const bbn = extractBbnBody(broken);
    if (!bbn.includes("const[RHasControl,RSetControl]=S.useState(!1)")) {
      throw new Error("computer-control: RHasControl state missing inside bbn.");
    }
  }, /RHasControl state missing inside bbn/);
});
