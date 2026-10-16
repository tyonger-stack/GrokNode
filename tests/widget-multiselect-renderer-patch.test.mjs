// Regression cover for the 0.71.2 widget multiSelect renderer port.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { patchWidgetMultiselect } from "../scripts/lib/widget-multiselect-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED = path.join(REPO_ROOT, "src/app/dist/renderer/assets/view-CIFdOvCz.js");
const run = promisify(execFile);

const pinned = await readFile(PINNED, "utf8").catch(() => null);
const skip = pinned == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;

async function assertParses(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "widget-ms-"));
  const file = path.join(dir, "view.mjs");
  await writeFile(file, source, "utf8");
  await run(process.execPath, ["--check", file]);
}

function extractHelpers(source) {
  const start = source.indexOf("function RMsNorm(");
  assert.ok(start >= 0, "RMsNorm helpers missing");
  const osEnd = source.indexOf("function gs(", start);
  assert.ok(osEnd > start);
  return new Function(source.slice(start, osEnd) + "; return {RMsNorm,RMsSplit,RMsJoin,RMsVal,RMsToggle,Os};")();
}

function contractFailures(source) {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    const h = extractHelpers(source);
    check(source.includes('multiSelect:us().optional().describe("When true, several options may apply.'), "schema field missing");
    check(source.includes("RMsMulti=a.multiSelect===!0"), "live card has no multiSelect branch");
    check(source.includes("RMsMulti=e.multiSelect===!0"), "resolved card has no multiSelect branch");
    check(source.includes("RMsCanSubmit?n.jsx"), "live card has no multi Submit");
    check(source.includes('title:"Selected"'), "Selected i18n anchor missing");
    check(source.includes('"Submit"'), "Submit i18n anchor missing");
    check(source.includes('"Your answer"'), "Your answer i18n anchor missing");
    check(source.includes('"Type your own answer"'), "Type your own answer i18n anchor missing");
    check(source.includes('"Dismiss question"'), "Dismiss question i18n anchor missing");
    check(h.RMsJoin(["a", "b\nc", "  "]) === "a\nb c", "join must flatten newlines inside values");
    check(h.RMsSplit("a\nb c\n\nd").join("|") === "a|b c|d", "split must drop empties");
    check(h.RMsVal({ label: "L", value: "V" }) === "V", "value preferred over label");
    check(h.RMsVal({ label: "L" }) === "L", "label fallback");
    const set = h.RMsToggle(h.RMsToggle(new Set(), "a"), "b");
    check(set.has("a") && set.has("b"), "toggle add");
    check(!h.RMsToggle(set, "a").has("a") && h.RMsToggle(set, "a").has("b"), "toggle remove");
    const widget = {
      multiSelect: true,
      options: [{ label: "One", value: "1" }, { label: "Two" }, { label: "Three", value: "3" }],
    };
    check(h.Os(widget, "1\nTwo\ncustom") === "One\nTwo\ncustom", "answer labels join with newline");
    check(h.Os({ options: widget.options }, "1") === "One", "single-select still resolves by value");
    check(source.includes("aria-pressed"), "multi options should expose pressed state");
  } catch (error) {
    failures.push(`threw: ${error.message}`);
  }
  return failures;
}

test("patched widget view parses and satisfies the multiSelect contract", { skip }, async () => {
  const patched = patchWidgetMultiselect(pinned);
  await assertParses(patched);
  assert.deepEqual(contractFailures(patched), []);
  assert.throws(() => patchWidgetMultiselect(patched), /missing or ambiguous|start is ambiguous|start missing/);
});

test("mutations: dropping multiSelect behaviour fails the contract", { skip }, () => {
  const patched = patchWidgetMultiselect(pinned);
  const mutations = [
    ["schema reverted", patched.replace(/multiSelect:us\(\)\.optional\(\)\.describe\("[^"]+"\),/, "")],
    ["live branch forced false", patched.replaceAll("a.multiSelect===!0", "!1")],
    ["resolved branch forced false", patched.replaceAll("e.multiSelect===!0", "!1")],
    ["Os multiSelect branch removed", patched.replace("if(g.multiSelect===!0)return RMsSplit(s).map(v=>(Array.isArray(g.options)?g.options:[]).find(u=>RMsVal(u)===v)?.label??v).join(\"\\n\");", "")],
    ["Submit button removed", patched.replace(/RMsCanSubmit\?n\.jsx\("div",\{[^]*?\}\):null/, "null")],
  ];
  for (const [label, mutant] of mutations) {
    assert.notEqual(mutant, patched, `${label}: no-op`);
    assert.ok(contractFailures(mutant).length > 0, `${label}: still green`);
  }
});
