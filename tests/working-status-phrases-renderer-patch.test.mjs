import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  patchWorkingStatusPhrases,
  WORKING_PHRASES,
} from "../scripts/lib/working-status-phrases-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const run = promisify(execFile);
const pinned = await readFile(PINNED, "utf8").catch(() => null);
const skip = pinned == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;

async function assertParses(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "wsp-"));
  await writeFile(path.join(dir, "c.mjs"), source, "utf8");
  await run(process.execPath, ["--check", path.join(dir, "c.mjs")]);
}

function loadGjn(source, locale) {
  const start = source.indexOf("const RWorkingPhrases=");
  const end = source.indexOf("function yJn(", start);
  assert.ok(start >= 0 && end > start);
  const RLocT = (en, zh) => (locale === "zh" ? zh : en);
  return new Function("RLocT", source.slice(start, end) + "; return gJn;")(RLocT);
}

function contractFailures(source) {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    const en = loadGjn(source, "en");
    const zh = loadGjn(source, "zh");
    check(en("working", "Grok Node", 0) === WORKING_PHRASES[0][0], "draw 0 → first CP phrase");
    check(zh("working", "Grok Node", 0) === WORKING_PHRASES[0][1], "zh first phrase");
    check(en("working", "Grok Node", 0.999) === WORKING_PHRASES[WORKING_PHRASES.length - 1][0], "draw 1 → last phrase");
    check(!String(en("working", "Grok Node", 0.5)).includes("Grok Node"), "no bot-name prefix");
    check(en("typing") === "Typing…", "typing en");
    check(zh("typing") === "正在输入…", "typing zh");
    check(source.includes("Math.min(.999,(y??0)/18e4)"), "SJn must pass elapsed-derived draw");
    check(!source.includes("${t} is working"), "old name-prefixed label must be gone");
    for (const [enPhrase] of WORKING_PHRASES) check(source.includes(JSON.stringify(enPhrase)), enPhrase);
  } catch (error) {
    failures.push(`threw: ${error.message}`);
  }
  return failures;
}

test("patched gJn uses 0.71.2 CP phrases without a bot-name prefix", { skip }, async () => {
  const patched = patchWorkingStatusPhrases(pinned);
  await assertParses(patched);
  assert.deepEqual(contractFailures(patched), []);
  assert.throws(() => patchWorkingStatusPhrases(patched), /missing or ambiguous/);
});

test("mutations: restoring the name-prefixed label fails the contract", { skip }, () => {
  const patched = patchWorkingStatusPhrases(pinned);
  const mutations = [
    ["name prefix restored", patched.replace(
      'function gJn(n,e,draw){if(n==="working")return RWorkingPhrase(draw);',
      'function gJn(n,e,draw){if(n==="working"){const t=e?.trim();return t!=null&&t.length>0?`${t} is working`:null};',
    )],
    ["draw always 0", patched.replace("Math.min(.999,(y??0)/18e4)", "0")],
    ["CP table emptied", patched.replace(/const RWorkingPhrases=\[[\s\S]*?\];/, "const RWorkingPhrases=[];")],
  ];
  for (const [label, mutant] of mutations) {
    assert.notEqual(mutant, patched, `${label}: no-op`);
    assert.ok(contractFailures(mutant).length > 0, `${label}: still green`);
  }
});
