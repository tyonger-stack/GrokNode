// Regression cover for the teach-gate restore patch.
//
// The failure modes worth guarding: an anchor that drifts, a polarity mistake (!1 vs !0
// compiles fine and just keeps the feature off — string equality cannot catch it), a
// flip that spills onto a neighbouring gate's bundled default, and the host's extension
// read being clobbered by the table flip. Everything is asserted against the real
// pristine bundles, and the patched outputs go through the real parser and real
// evaluation, not just string matching.

import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdtemp, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  applyTeachGateRestorePatch,
  patchTeachGateRestore,
} from "../scripts/lib/teach-gate-restore-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const PINNED_HOST = path.join(REPO_ROOT, "src/app/dist/host/host-main.cjs");

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
// 2026-10-05 补：本文件此前硬读该产物，而 CI 从不执行 `npm run bootstrap`（bootstrap 用的是
// macOS 专有的 hdiutil），于是 13 个依赖产物的文件里有 7 个在 CI 上 ENOENT —— main 的 CI
// 已因此连续红 10 次。写法照抄仓库另外 6 个已守卫的文件，不新造模式。守卫对象取「声明的用例名
// ∩ 实测失败名」，不是靠猜哪个用例读了产物。
const pinnedChunk = await readPinnedChunk().catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const readPinnedHost = () => readFile(PINNED_HOST, "utf8");
const run = promisify(execFile);

const RENDERER_BEFORE = "featureGates?.sand_teach_by_demonstration??!1";
const RENDERER_AFTER = "featureGates?.sand_teach_by_demonstration??!0";
const HOST_EXTENSION_READ = 'checkFeatureGate("sand_teach_by_demonstration")';

/** Pull a balanced {...} object starting at `start` (which must sit just before "{"). */
function extractBracedObject(source, start) {
  const bodyStart = source.indexOf("{", start);
  assert.ok(bodyStart >= 0, "no object follows the anchor");
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > bodyStart, "object did not brace-balance");
  return source.slice(bodyStart, end);
}

test("anchors resolve exactly once in the pristine bundles", { skip: pinnedSkip }, async () => {
  const chunk = await readPinnedChunk();
  assert.equal(chunk.split("sand_teach_by_demonstration").length - 1, 1,
    "the gate name should occur exactly once in the renderer chunk");
  assert.equal(chunk.split(RENDERER_BEFORE).length - 1, 1, "renderer anchor is not unique");
  const host = await readPinnedHost();
  assert.equal(host.split(HOST_EXTENSION_READ).length - 1, 1,
    "host extension read is not unique");
});

test("the flip changes the renderer fallback and nothing else in the chunk", { skip: pinnedSkip }, async () => {
  const { patchedRenderer } = patchTeachGateRestore({
    rendererSource: await readPinnedChunk(),
    hostSource: await readPinnedHost(),
  });
  assert.ok(patchedRenderer.includes(RENDERER_AFTER), "renderer fallback was not flipped");
  assert.ok(!patchedRenderer.includes(RENDERER_BEFORE), "pre-patch renderer anchor survived");
  // The gate flip is a single byte at the anchor site…
  const original = await readPinnedChunk();
  const anchorAt = original.indexOf(RENDERER_BEFORE);
  assert.equal(patchedRenderer.slice(anchorAt, anchorAt + RENDERER_AFTER.length), RENDERER_AFTER,
    "the bytes around the anchor are not a pure fallback flip");
  // …and the only other change is the visible-label wrap.
  assert.ok(patchedRenderer.includes(',(RLocT("Teach a task","教它做一项任务"))]'),
    "the visible teach label was not wrapped with RLocT");
  assert.ok(!patchedRenderer.includes(',"Teach a task"]'), "the bare visible label survived");
  // No teach string was lost or duplicated: 4 occurrences before (3 RLocT pairs + the
  // bare label), 4 after.
  assert.equal(patchedRenderer.split("Teach a task").length - 1,
    original.split("Teach a task").length - 1,
    "the teach label literal count changed");
});

test("the patched gate reader really evaluates true when no snapshot carries the gate", { skip: pinnedSkip }, async () => {
  const { patchedRenderer } = patchTeachGateRestore({
    rendererSource: await readPinnedChunk(),
    hostSource: await readPinnedHost(),
  });
  const start = patchedRenderer.indexOf("function ENe(){");
  assert.ok(start >= 0, "ENe not found in the patched chunk");
  const body = extractBracedObject(patchedRenderer, start).slice(1, -1); // strip braces → the statements
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const evaluate = new Function("es", "Qe", body);
  const es = (value) => value;
  // The desktop stub feeds an empty snapshot: the fallback is the only value there is.
  assert.equal(evaluate(es, () => ({ experiments: { snapshots: {} } })), true,
    "empty snapshot must fall back to true");
  // A store whose experiments object carries no snapshots at all must also fall back.
  assert.equal(evaluate(es, () => ({ experiments: {} })), true);
  // A snapshot that EXPLICITLY carries the gate as false wins — `??` only substitutes
  // for nullish. The flip widens the offline fallback; it is not a hard override.
  assert.equal(
    evaluate(es, () => ({ experiments: { snapshots: { featureGates: { sand_teach_by_demonstration: false } } } })),
    false,
    "an explicit false snapshot must not be overridden",
  );
  // The original form must evaluate false on the same inputs — guards the polarity.
  const original = await readPinnedChunk();
  const originalStart = original.indexOf("function ENe(){");
  const originalBody = extractBracedObject(original, originalStart).slice(1, -1);
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  const evaluateOriginal = new Function("es", "Qe", originalBody);
  assert.equal(evaluateOriginal(es, () => ({ experiments: { snapshots: {} } })), false,
    "polarity guard: original must be false");
});

test("the host FLAGS default flips and the extension read survives untouched", { skip: pinnedSkip }, async () => {
  const { patchedHost } = patchTeachGateRestore({
    rendererSource: await readPinnedChunk(),
    hostSource: await readPinnedHost(),
  });
  const entryStart = patchedHost.indexOf("sand_teach_by_demonstration: {");
  assert.ok(entryStart >= 0, "patched FLAGS entry not found");
  const entry = extractBracedObject(patchedHost, entryStart);
  // eslint-disable-next-line no-new-func -- the bundle is the artefact under test.
  const parsed = new Function(`return (${entry})`)();
  assert.equal(parsed.default, true, "bundled FLAGS default did not flip to true");
  assert.equal(parsed.client, true, "client exposure must be preserved");
  assert.equal(patchedHost.split(HOST_EXTENSION_READ).length - 1, 1,
    "the teach-recording extension's own gate read must survive exactly once");
  // Exactly one gate's default changed: one fewer `default: false`, one more `default: true`.
  const original = await readPinnedHost();
  const count = (source, needle) => source.split(needle).length - 1;
  assert.equal(count(patchedHost, "default: false"), count(original, "default: false") - 1,
    "more than one gate default changed");
  assert.equal(count(patchedHost, "default: true"), count(original, "default: true") + 1,
    "more than one gate default changed");
  // A neighbouring gate keeps its bundled default byte-for-byte. sand_multitask is
  // NOT a control here — its bundled default is true (its OFF-ness comes from env
  // resolution at runtime) — sand_client_pause is the stable false-default neighbour.
  const neighbourStart = patchedHost.indexOf("sand_client_pause: {");
  assert.ok(neighbourStart >= 0, "sand_client_pause entry not found");
  assert.ok(patchedHost.slice(neighbourStart, neighbourStart + 120).includes("default: false"),
    "sand_client_pause default must stay false");
});

test("re-applying onto patched sources fails closed", { skip: pinnedSkip }, async () => {
  const { patchedRenderer, patchedHost } = patchTeachGateRestore({
    rendererSource: await readPinnedChunk(),
    hostSource: await readPinnedHost(),
  });
  assert.throws(
    () => patchTeachGateRestore({ rendererSource: patchedRenderer, hostSource: patchedHost }),
    /anchor is missing or ambiguous/,
  );
});

test("both patched outputs are still parseable JavaScript", { skip: pinnedSkip }, async (t) => {
  const { patchedRenderer, patchedHost } = patchTeachGateRestore({
    rendererSource: await readPinnedChunk(),
    hostSource: await readPinnedHost(),
  });
  t.after(() => rm(path.join(REPO_ROOT, ".tmp-teach-gate-renderer.js"), { force: true }));
  t.after(() => rm(path.join(REPO_ROOT, ".tmp-teach-gate-host.cjs"), { force: true }));
  const rendererTmp = path.join(REPO_ROOT, ".tmp-teach-gate-renderer.js");
  const hostTmp = path.join(REPO_ROOT, ".tmp-teach-gate-host.cjs");
  await writeFile(rendererTmp, patchedRenderer, "utf8");
  await writeFile(hostTmp, patchedHost, "utf8");
  await run(process.execPath, ["--check", rendererTmp]);
  await run(process.execPath, ["--check", hostTmp]);
});

test("the staged renderer and host both get patched with provenance", { skip: pinnedSkip }, async (t) => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "grok-node-teach-gate-"));
  t.after(() => rm(stageRoot, { recursive: true, force: true }));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const hostDir = path.join(stageRoot, "dist", "host");
  await mkdir(assets, { recursive: true });
  await mkdir(hostDir, { recursive: true });
  // A chunk without the gate must be left alone…
  await writeFile(path.join(assets, "decoy-without-gate.js"), "export {};\n", "utf8");
  // …and a second chunk carrying the gate must fail the build instead of guessing.
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  await cp(PINNED_CHUNK, path.join(assets, "decoy-with-gate.js"));
  await cp(PINNED_HOST, path.join(hostDir, "host-main.cjs"));
  await assert.rejects(
    applyTeachGateRestorePatch({ stageRoot }),
    /expected exactly one renderer chunk carrying the gate, found 2/,
  );
  await rm(path.join(assets, "decoy-with-gate.js"), { force: true });
  const decoyBefore = await readFile(path.join(assets, "decoy-without-gate.js"), "utf8");

  const record = await applyTeachGateRestorePatch({ stageRoot });
  assert.equal(record.files.length, 2);
  assert.deepEqual(record.features, [
    "teach-by-demonstration-entry-points",
    "teach-recording-extension-enabled",
    "teach-button-localised-label",
  ]);
  const patchedChunk = await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8");
  assert.ok(patchedChunk.includes(RENDERER_AFTER), "staged chunk was not patched");
  const patchedHost = await readFile(path.join(hostDir, "host-main.cjs"), "utf8");
  assert.ok(patchedHost.includes("default: true"), "staged host bundle was not patched");
  assert.equal(
    await readFile(path.join(assets, "decoy-without-gate.js"), "utf8"),
    decoyBefore,
    "the decoy chunk without the gate must be left untouched",
  );
  const provenance = JSON.parse(
    await readFile(path.join(stageRoot, "dist", "teach-gate-restore-extension.json"), "utf8"),
  );
  assert.equal(provenance.mode, "teach-gate-restore");
  for (const file of provenance.files) {
    assert.notEqual(file.original.sha256, file.patched.sha256);
  }
  assert.ok(record.provenanceBytes > 0);
});

test("clean-build wires the teach-gate patch after the i18n passes and before packaging", async () => {
  const source = await readFile(path.join(REPO_ROOT, "scripts/clean-build.mjs"), "utf8");
  const importIndex = source.indexOf('from "./lib/teach-gate-restore-patch.mjs"');
  assert.ok(importIndex > 0, "clean-build does not import the teach-gate patch");
  const callIndex = source.indexOf("await applyTeachGateRestorePatch({ stageRoot });");
  assert.ok(callIndex > 0, "clean-build never calls the teach-gate patch");
  const languageIndex = source.indexOf("await applyOriginalRendererLanguagePatch({ stageRoot });");
  const packIndex = source.indexOf("await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });");
  assert.ok(
    languageIndex > 0 && languageIndex < callIndex && callIndex < packIndex,
    "the teach-gate patch must run after the i18n passes and before packaging",
  );
});
