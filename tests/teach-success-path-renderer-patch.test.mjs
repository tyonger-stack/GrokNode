// Regression cover for the "learn from demonstration" success-path patch.
//
// The failure modes worth guarding here are all invisible to `typecheck`, `npm test`
// on the TypeScript sources, and `node --check`:
//
//   * a gate POLARITY mistake (`??!1` vs `??!0`) — compiles fine, passes every string
//     check, and just leaves the publish button hidden. The patched reader is
//     therefore evaluated for real, not compared as text.
//   * the classifier predicate being widened by accident ("clientNonce starts with
//     teach-recording:" is not enough on its own; 0.62.0 also requires the exact
//     content string) — that would relabel unrelated user messages.
//   * the memo-cache size being left too small after adding `e[N]` slots — React
//     indexes the array directly, so a stale `c(22)` silently reads `undefined` and
//     re-creates DOM nodes on every render instead of failing loudly.
//   * the transcript line rendering AFTER the rich text, or not at all, when the
//     entry is not a teach-recording message.
//   * the chip localization leaking onto skills other than the managed
//     `learn-from-demonstration` one.
//
// Everything is asserted against the real pristine bundle, the patched output goes
// through the real parser, and the injected helpers are evaluated for real.

import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  applyOriginalRendererTeachSuccessPath,
  assertTeachSuccessPathClassesResolve,
  patchOriginalTeachSuccessPath,
  TEACH_SUCCESS_PATH_CLASS_NAMES,
} from "../scripts/lib/teach-success-path-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const PINNED_CSS = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-lCyB53CO.css");
const run = promisify(execFile);

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");
const readPinnedCss = () => readFile(PINNED_CSS, "utf8");

const GATE_BEFORE = "function pWn(){return es(Qe().experiments.snapshots)?.featureGates?.publish_user_skills??!1}";
const GATE_AFTER = "function pWn(){return es(Qe().experiments.snapshots)?.featureGates?.publish_user_skills??!0}";
const TEACH_GATE = "featureGates?.sand_teach_by_demonstration??!1";

const patchedChunk = async () => patchOriginalTeachSuccessPath(await readPinnedChunk());

/** Parse the patched file with the real JS engine — the only gate that catches a
 *  malformed injection (an unbalanced brace, a stray quote) that text checks miss. */
async function assertParses(source, label) {
  const dir = await mkdtemp(path.join(tmpdir(), "teach-success-path-"));
  const file = path.join(dir, "chunk.js");
  await writeFile(file, source, "utf8");
  await run(process.execPath, ["--check", file]);
  void label;
  return dir;
}

/** Extract the injected helper block (everything the patch splices in before `BPn`). */
function extractHelpers(source) {
  const start = source.indexOf("const RTeachRecordingNoncePrefix=");
  assert.ok(start >= 0, "the classifier helpers were not injected");
  const end = source.indexOf("function BPn(", start);
  assert.ok(end > start, "the classifier helpers are not immediately followed by BPn");
  return source.slice(start, end);
}

/** Evaluate the injected helpers with a stub RLocT so their behaviour is real. */
async function evaluateHelpers(source, locale = "zh-CN") {
  const helpers = extractHelpers(source);
  // eslint-disable-next-line no-new-func -- deliberate: the helpers are the artefact under test
  const factory = new Function(
    "RLocT",
    `${helpers}\nreturn { RTeachIsRecording, RTeachRecordingText, RTeachSkillLabel };`,
  );
  return factory((en, zh) => (locale === "zh-CN" ? zh : en));
}

/**
 * Lift the patched `pWn` gate reader out of the chunk and evaluate it against a
 * supplied experiments snapshot. A polarity mistake (`??!1` vs `??!0`) compiles fine
 * and passes every string check, so the only way to catch it is to run the reader.
 */
function gateReader(source) {
  const reader = /function pWn\(\)\{return [^}]*\}/.exec(source);
  assert.ok(reader, "could not lift the patched pWn reader out of the chunk");
  // The reader is `es(Qe().experiments.snapshots)?.featureGates?.<gate>?? <default>`:
  // `Qe()` is the store, `es` the selector (identity here).
  // eslint-disable-next-line no-new-func -- deliberate: the reader is the artefact under test
  const fn = new Function("es", "Qe", `${reader[0]}; return pWn();`);
  return snapshot => fn(x => x, () => ({ experiments: { snapshots: snapshot } }));
}

test("every anchor resolves exactly once in the pristine bundle", async () => {
  const chunk = await readPinnedChunk();
  assert.equal(chunk.split("publish_user_skills").length - 1, 1,
    "publish_user_skills should occur exactly once in the renderer chunk");
  assert.equal(chunk.split(GATE_BEFORE).length - 1, 1, "the publish gate anchor is not unique");
  assert.equal(chunk.split("learn-from-demonstration").length - 1, 0,
    "0.18 must not already ship the managed-skill id, or this port has no evidence to match");
  assert.equal(chunk.split("Learn from demonstration").length - 1, 0,
    "0.18 must not already ship the managed-skill label");
  assert.equal(chunk.split("function BPn(n){const e=he.c(22),").length - 1, 1, "BPn signature is not unique");
  assert.equal(chunk.split("function KWn(n){const e=he.c(44);").length - 1, 1, "KWn signature is not unique");
  assert.equal(chunk.split("{id:t,label:s,iconId:r,iconUrl:i}=n,o=ict();").length - 1, 1,
    "the skill chip destructure is not unique");
});

test("the patch flips only the publish gate and leaves every other gate alone", async () => {
  const pristine = await readPinnedChunk();
  const patched = await patchedChunk();
  assert.ok(!patched.includes(GATE_BEFORE), "the publish gate fallback was left unflipped");
  assert.ok(patched.includes(GATE_AFTER), "the flipped publish gate is missing");
  assert.ok(patched.includes(TEACH_GATE), "the sand_teach_by_demonstration gate read was clobbered");
  for (const gate of ["sand_pr_menu", "mcp_multi_account", "sand_box_egress_tunnel", "sand_client_pause"]) {
    assert.ok(patched.includes(`featureGates?.${gate}??!1`),
      `neighbouring gate ${gate} must keep its bundled default`);
  }
  void pristine;
});

test("the flipped gate reader really returns true — polarity is evaluated, not compared", async () => {
  const evaluate = gateReader(await patchedChunk());
  assert.equal(evaluate({ featureGates: { publish_user_skills: true } }), true, "a served true must stay true");
  assert.equal(evaluate({ featureGates: {} }), true, "an absent gate must fall back to the flipped default");
  assert.equal(evaluate({ featureGates: { publish_user_skills: false } }), false,
    "an explicitly served false must still win over the bundled default");
  assert.equal(evaluate(undefined), true, "an absent snapshot must fall back to the flipped default");
});

test("the transcript line renders the 0.62.0 zh-Hans string and only for teach-recording entries", async () => {
  const helpers = await evaluateHelpers(await patchedChunk(), "zh-CN");
  const teachEntry = { clientNonce: "teach-recording:abc123:teach-2026-09-30-010101.json", content: "The recording is finished. Learn the task from it." };
  assert.equal(helpers.RTeachIsRecording(teachEntry), true, "the real host payload must classify as teach-recording");
  assert.equal(helpers.RTeachRecordingText(), "录制已完成。请从中学习这项任务。",
    "the zh-Hans value must be byte-identical to 0.62.0's /WKm9a");

  // 0.62.0's predicate is a conjunction. Each half alone must NOT classify.
  assert.equal(helpers.RTeachIsRecording({ content: teachEntry.content }), false,
    "the content alone must not classify — 0.62.0 also requires the nonce prefix");
  assert.equal(helpers.RTeachIsRecording({ clientNonce: teachEntry.clientNonce, content: "hello" }), false,
    "the nonce alone must not classify — 0.62.0 also requires the exact content");
  assert.equal(helpers.RTeachIsRecording({ clientNonce: "other:abc", content: teachEntry.content }), false,
    "a different nonce namespace must not classify");
  assert.equal(helpers.RTeachIsRecording({ content: "The recording is finished. Learn the task from it. " }), false,
    "the content match must be exact, not trimmed or prefix-matched");
  assert.equal(helpers.RTeachIsRecording({ content: undefined }), false, "a contentless entry must not classify");
});

test("the classifier falls back to the English string in an English UI", async () => {
  const helpers = await evaluateHelpers(await patchedChunk(), "en-US");
  assert.equal(helpers.RTeachRecordingText(), "The recording is finished. Learn the task from it.",
    "the English value must be 0.62.0's /WKm9a source string");
  assert.equal(helpers.RTeachSkillLabel("learn-from-demonstration", "Learn from demonstration"), "Learn from demonstration");
});

test("the managed-skill chip label localizes only the learn-from-demonstration skill", async () => {
  const helpers = await evaluateHelpers(await patchedChunk(), "zh-CN");
  assert.equal(helpers.RTeachSkillLabel("learn-from-demonstration", "Learn from demonstration"), "从演示中学习",
    "the managed teach skill must read as 0.62.0's zh-Hans 3Fgqpv value");
  // A user skill that merely happens to be called the same thing must stay verbatim:
  // 0.62.0's QSe matches on the id AND the label.
  assert.equal(helpers.RTeachSkillLabel("my-own-skill", "Learn from demonstration"), "Learn from demonstration",
    "a different id must not be localized");
  assert.equal(helpers.RTeachSkillLabel("learn-from-demonstration", "My own copy"), "My own copy",
    "a different label must not be localized");
  assert.equal(helpers.RTeachSkillLabel("view-baidu-trending", "查看百度实时热搜榜"), "查看百度实时热搜榜",
    "an ordinary user skill must pass through untouched");
  assert.equal(helpers.RTeachSkillLabel("", ""), "", "an empty chip must stay empty");
});

test("the message renderer takes contentBeforeRichText and puts it BEFORE the rich text", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("contentBeforeRichText:RTeachBefore"), "BPn must destructure the new prop");
  assert.ok(patched.includes('children:[RTeachNode,l]'), "the prose container must render the line before the rich text");
  assert.ok(!patched.includes('children:l}),e[18]=i'), "the rich-text-only children list must be gone");
  assert.ok(patched.includes('gpt(b,r,"content")'),
    "the line must use 0.62.0's \"content\" React key prefix, not 0.18's \"c\"");
  assert.ok(patched.includes("RTeachBefore?.trim()"), "the line must be trimmed like 0.62.0's `v = l?.trim()`");
  assert.ok(patched.includes("b!=null&&b.length>0?"), "an empty or absent line must render nothing");
  // The no-rich-text early return must keep using 0.18's own key prefix and layout.
  assert.ok(patched.includes('gpt(x,r,"c")'), "the no-rich-text path must keep its 0.18 key prefix");
});

test("the call site classifies the entry and forwards both strings", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("content:RTeachIsRecording(r)?RTeachRecordingText():r.content"),
    "the call site must localize the content for teach-recording entries and pass the rest through");
  assert.ok(patched.includes("contentBeforeRichText:RTeachIsRecording(r)?RTeachRecordingText():void 0"),
    "contentBeforeRichText must be undefined for ordinary messages — 0.62.0's `E = kind === … ? content : void 0`");
  assert.ok(patched.includes("e[44]!==r.clientNonce"),
    "the caller's memo must depend on clientNonce or a relabelled entry would reuse the stale node");
});

test("the skill chip localizes its label at the single point 0.62.0 uses", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("label:RTeachRawLabel,iconId:r,iconUrl:i}=n,o=ict(),s=RTeachSkillLabel(t,RTeachRawLabel);"),
    "the chip must re-bind its label to the localized value");
  // Every downstream use of the label must now read the localized binding, so the
  // openReference callback, the icon, the chip text and the tooltip all agree.
  const chip = patched.slice(patched.indexOf("function Pon("), patched.indexOf("function Mon("));
  assert.ok(chip.includes("o?.(t,s)"), "the openReference callback must carry the localized label");
  assert.ok(chip.includes("label:s}"), "the chip shell must receive the localized label");
  assert.ok(chip.includes("const h=`Open ${s}`"), "the tooltip must be built from the localized label");
  // The raw binding may appear only in the destructure and in the localization call —
  // never in a render site.
  const rawUses = chip.split("RTeachRawLabel").length - 1;
  assert.equal(rawUses, 2,
    `the raw label should survive only in the destructure and the RTeachSkillLabel call, found ${rawUses} uses`);
});

/** Slice a whole minified function body, brace-balanced from its opening brace. */
function sliceFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${signature} did not brace-balance`);
}

test("memo-cache sizes are grown to cover every slot the patch adds", async () => {
  const patched = await patchedChunk();
  for (const [signature, size] of [["function BPn(n){const e=he.c(26),", 26], ["function KWn(n){const e=he.c(45);", 45]]) {
    const body = sliceFunction(patched, signature);
    const used = [...new Set([...body.matchAll(/\be\[(\d+)\]/g)].map(m => Number(m[1])))];
    const highest = Math.max(...used);
    assert.ok(highest < size, `${signature} declares c(${size}) but touches e[${highest}]`);
  }
  // 0.18 filled both arrays exactly; leaving the old size would read past the end.
  const pristine = await readPinnedChunk();
  for (const [signature, size] of [["function BPn(n){const e=he.c(22),", 22], ["function KWn(n){const e=he.c(44);", 44]]) {
    const body = sliceFunction(pristine, signature);
    const used = [...new Set([...body.matchAll(/\be\[(\d+)\]/g)].map(m => Number(m[1])))];
    assert.equal(Math.max(...used), size - 1, `${signature} was not actually full before the patch`);
  }
});

test("the ported classes all exist in the pinned stylesheet", async () => {
  const css = await readPinnedCss();
  assert.equal(assertTeachSuccessPathClassesResolve(css), TEACH_SUCCESS_PATH_CLASS_NAMES.length);
  assert.throws(() => assertTeachSuccessPathClassesResolve(".sand-10im51j{color:red}"), /missing from the pinned/,
    "a stylesheet missing a class must fail the build, not ship an unstyled line");
});

test("the patched chunk parses as real JavaScript", async () => {
  const patched = await patchedChunk();
  await assertParses(patched, "patched chunk");
});

test("applying the patch writes a provenance record and a patched chunk", async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "teach-success-stage-"));
  const assets = path.join(stageRoot, "dist/renderer/assets");
  await mkdir(assets, { recursive: true });
  await cp(PINNED_CHUNK, path.join(assets, path.basename(PINNED_CHUNK)));
  await cp(PINNED_CSS, path.join(assets, path.basename(PINNED_CSS)));

  const result = await applyOriginalRendererTeachSuccessPath({ stageRoot });
  assert.equal(result.mode, "original-renderer-teach-success-path");
  assert.equal(result.chunks.length, 1);
  assert.ok(result.provenanceBytes > 0);
  assert.equal(result.gateEvidence.publish_user_skills.value, true);
  assert.match(result.gateEvidence.behaviourChange, /feature gate/,
    "the gate flip is a behaviour change and the record must say so");

  const written = await readFile(path.join(assets, path.basename(PINNED_CHUNK)), "utf8");
  assert.equal(written, await patchedChunk(), "the staged chunk must be the patched one");
  const provenance = JSON.parse(await readFile(result.provenancePath, "utf8"));
  assert.deepEqual(provenance.transformations, result.transformations);
  assert.equal(provenance.upstream.version, "0.62.0");
});

test("a drifted anchor fails closed instead of silently no-oping", async () => {
  const chunk = (await readPinnedChunk()).replace(GATE_BEFORE, "function pWn(){return false}");
  assert.throws(() => patchOriginalTeachSuccessPath(chunk), /publish gate fallback anchor is missing or ambiguous/);
});

test("MUTATION: an unfipped gate keeps the publish button hidden", async () => {
  const chunk = await readPinnedChunk();
  const mutated = patchOriginalTeachSuccessPath(chunk).replace(
    "featureGates?.publish_user_skills??!0",
    "featureGates?.publish_user_skills??!1",
  );
  assert.ok(mutated.includes("featureGates?.publish_user_skills??!1"), "the mutation must actually undo the flip");
  // Re-running the patch over an already-patched chunk must fail closed, never
  // silently re-apply or half-apply.
  assert.throws(() => patchOriginalTeachSuccessPath(mutated), /teach-success-path .* anchor is missing or ambiguous/);
  // And the real reader, evaluated, would report the gate as off.
  assert.equal(gateReader(mutated)({ featureGates: {} }), false,
    "with the fallback back at ??!1 an empty snapshot reads the gate as off");
});

test("MUTATION: dropping the classifier makes the transcript line unreachable", async () => {
  const patched = await patchedChunk();
  const mutated = patched.replace(
    "function RTeachIsRecording(e){return e.clientNonce?.startsWith(RTeachRecordingNoncePrefix)===!0&&e.content===RTeachRecordingContent}",
    "function RTeachIsRecording(e){return false}",
  );
  assert.notEqual(mutated, patched, "sanity: the mutation applied");
  const helpers = await evaluateHelpers(mutated, "zh-CN");
  assert.equal(helpers.RTeachIsRecording({ clientNonce: "teach-recording:a:b.json", content: "The recording is finished. Learn the task from it." }), false,
    "with the classifier neutered the line can never render");
});

test("MUTATION: a widened classifier relabels ordinary user messages", async () => {
  const patched = await patchedChunk();
  // Drop the content half of 0.62.0's conjunction and keep only the nonce prefix.
  const widened = patched.replace("&&e.content===RTeachRecordingContent", "");
  assert.notEqual(widened, patched, "sanity: the mutation applied");
  const real = await evaluateHelpers(patched, "zh-CN");
  assert.equal(real.RTeachIsRecording({ content: "just a normal message" }), false,
    "the real predicate must reject this");
  // The mutation turns a prefix-matching entry into a teach-recording message, which
  // is the user-visible bug the second half of the conjunction exists to prevent.
  const helpers = await evaluateHelpers(widened, "zh-CN");
  assert.equal(
    helpers.RTeachIsRecording({ clientNonce: "teach-recording:a:b.json", content: "something the user actually typed" }),
    true,
    "a prefix-only predicate relabels an unrelated message — this is what the conjunction blocks",
  );
});

test("MUTATION: rendering the line after the rich text reverses 0.62.0's order", async () => {
  const mutated = (await patchedChunk()).replace("children:[RTeachNode,l]", "children:[l,RTeachNode]");
  assert.ok(!mutated.includes("children:[RTeachNode,l]"), "the mutation must actually reverse the order");
});

test("MUTATION: an un-grown memo cache makes the new slots read out of bounds", async () => {
  const mutated = (await patchedChunk()).replace("function BPn(n){const e=he.c(26),", "function BPn(n){const e=he.c(22),");
  const body = mutated.slice(mutated.indexOf("function BPn(n){const e=he.c(22),"));
  const used = [...new Set([...body.slice(0, 12000).matchAll(/\be\[(\d+)\]/g)].map(m => Number(m[1])))];
  assert.ok(Math.max(...used) >= 22, "with c(22) the patch would index e[22..25] past the end of the cache");
});
