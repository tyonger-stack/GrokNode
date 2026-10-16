import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import * as acorn from "acorn";

import {
  CONFIGURE_AFTER,
  CONFIGURE_BEFORE,
  INJECT_AFTER,
  patchPromptAutoLists,
  PROMPT_LIST_CSS_DECISION,
} from "../scripts/lib/prompt-auto-lists-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const run = promisify(execFile);
const pinned = await readFile(PINNED, "utf8").catch(() => null);
const skip = pinned == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;

async function assertParses(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "pal-"));
  const file = path.join(dir, "c.mjs");
  await writeFile(file, source, "utf8");
  await run(process.execPath, ["--check", file]);
  acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
}

function hftConfigureSlice(source) {
  const start = source.indexOf("function hft(n){");
  assert.ok(start >= 0, "hft present");
  const end = source.indexOf("function", start + "function hft(n){".length);
  assert.ok(end > start, "hft body bounded");
  return source.slice(start, end);
}

function contractFailures(source) {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    const hft = hftConfigureSlice(source);
    check(hft.includes("RPromptStarterKit.configure"), "hft uses RPromptStarterKit");
    check(!hft.includes("grn.configure"), "hft no longer calls grn.configure");
    check(!/bulletList:!1,code:!1/.test(hft), "hft configure must not hard-disable bulletList");
    check(!/,orderedList:!1,paragraph:/.test(hft), "hft configure must not hard-disable orderedList");
    check(hft.includes("RPromptListOpts(n.surface===\"prompt\")"), "surface-gated opts");
    check(source.includes("bulletList:!0,orderedList:!0,trailingNode:!1"), "prompt enables lists + trailingNode:!1");
    check(source.includes('new Set(["bulletList","orderedList","listItem"])'), "Kl-equivalent name set");
    check(source.includes("addKeyboardShortcuts:()=>({})"), "Enter-to-send: list shortcuts stripped");
    check(PROMPT_LIST_CSS_DECISION.promptListClassInPinnedCss === false, "css decision recorded");
    check(source.includes(CONFIGURE_AFTER) || hft.includes("RPromptListOpts"), "configure after shape");
  } catch (error) {
    failures.push(`threw: ${error.message}`);
  }
  return failures;
}

test("patched hft enables prompt bulletList/orderedList like 0.71.2 Vl", { skip }, async () => {
  assert.ok(pinned.includes(CONFIGURE_BEFORE), "pristine anchor present");
  const patched = patchPromptAutoLists(pinned);
  await assertParses(patched);
  assert.deepEqual(contractFailures(patched), []);
  assert.throws(() => patchPromptAutoLists(patched), /missing or ambiguous/);
});

test("mutations: re-disabling lists or dropping Enter strip fails the contract", { skip }, () => {
  const patched = patchPromptAutoLists(pinned);
  const mutations = [
    [
      "lists hard-disabled again",
      patched.replace(CONFIGURE_AFTER, CONFIGURE_BEFORE),
    ],
    [
      "Enter strip removed",
      patched.replace(
        "t.extend({addKeyboardShortcuts:()=>({})})",
        "t",
      ),
    ],
    [
      "trailingNode omitted",
      patched.replace(
        "{bulletList:!0,orderedList:!0,trailingNode:!1}",
        "{bulletList:!0,orderedList:!0}",
      ),
    ],
  ];
  for (const [label, mutant] of mutations) {
    assert.notEqual(mutant, patched, `${label}: no-op`);
    assert.ok(contractFailures(mutant).length > 0, `${label}: still green`);
  }
});

test("inject helpers are module-level and INJECT_AFTER is self-contained", { skip }, () => {
  const patched = patchPromptAutoLists(pinned);
  assert.ok(patched.includes(INJECT_AFTER.slice(0, 40)));
  const start = patched.indexOf("const RPromptListNames=");
  const hft = patched.indexOf("function hft(n){", start);
  assert.ok(start >= 0 && hft > start);
  // Helpers sit immediately before hft (0.71 ql/Vl sit before ai).
  assert.ok(hft - start < 800, "helpers adjacent to hft");
});
