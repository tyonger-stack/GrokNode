import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { COMPUTER_SLEEP_CSS_TOKENS, COMPUTER_SLEEP_LABELS, computerSleepOverlayRuntime, loadOfficialAsleepArtifacts, loadOfficialOpenPill, loadOfficialShapeSvgs } from "../scripts/lib/computer-sleep-renderer-components.mjs";
import { patchComputerSleepRenderer, applyComputerSleepRendererPatch, nativeSleepIconGlyph } from "../scripts/lib/computer-sleep-renderer-patch.mjs";
import { PREVIEW_POOL_FIXTURE } from "./fixtures/computer-preview-pool.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeIcons = 'var icons={"arrows-expand-simple":"\\uf2cf","moon-z":"\\uf46f"};';

test("native sleep icon requires an unambiguous shipped icon registry", () => {
  assert.equal(nativeSleepIconGlyph(nativeIcons), "\uf46f");
  assert.throws(() => nativeSleepIconGlyph('var unrelated={"moon-z":"x"};'), /missing or ambiguous/);
  assert.throws(() => nativeSleepIconGlyph(nativeIcons + 'var bold={"arrows-expand-simple":"a","moon-z":"z"};'), /missing or ambiguous/);
});

// ---------------------------------------------------------------------------
// Runtime emission.
// ---------------------------------------------------------------------------
test("official asleep artifacts carry the exported stage byte-for-byte", async () => {
  const { html, css } = await loadOfficialAsleepArtifacts();
  assert.ok(html.includes('data-stage="asleep"'));
  assert.ok(html.includes('data-grok-state="sleeping"'));
  assert.ok(html.includes("sand-grok-bot-mark"));
  assert.ok(html.includes("viewBox=\"0 0 49.07 49.07\""), "official mascot SVG");
  assert.ok(html.includes("{{TITLE}}") && html.includes("{{WAKE}}"));
  // z 动画的三个定位类（W.z1/z2/z3）
  for (const z of ["sand-1o0tod", "sand-1vd6cy8", "sand-3mz3hd"]) assert.ok(html.includes(z), z);
  // 官方规则原文特征（:not(#\#) 优先级链）
  assert.ok(css.includes(".sand-10l6tqk:not(#\\#)"));
  assert.ok(css.includes("top:calc(50% + 22px)"), "官方文本行定位");
  assert.ok(css.includes("border-radius:9999px"), "官方胶囊按钮");
});

test("computerSleepOverlayRuntime embeds the official DOM, labels and both levers", async () => {
  const [{ html }, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const runtime = computerSleepOverlayRuntime(html, shapes, nativeSleepIconGlyph(nativeIcons));
  assert.ok(runtime.includes("window.__rCompSleep"));
  assert.ok(runtime.includes(".sand-box-vnc-pool"));
  assert.ok(runtime.includes("getSleepState"));
  assert.ok(runtime.includes("b.wake()"));
  assert.ok(runtime.includes("b.sleep()"));
  const embedded = JSON.parse(runtime.match(/var STAGE_HTML=("[^]*?");\n/)[1]);
  assert.ok(embedded.includes('data-stage="asleep"'), "official stage markup embedded");
  assert.ok(embedded.includes('data-grok-state="sleeping"'));
  assert.ok(runtime.includes(JSON.stringify(COMPUTER_SLEEP_LABELS.zh)));
  assert.ok(runtime.includes("insertAdjacentHTML"));
  new Function(runtime.replace(/^[\s\S]*?\n/, "")); // eslint-disable-line no-new-func
});

test("COMPUTER_SLEEP_CSS_TOKENS lists the grok-node additions only (official rules carry their own)", () => {
  assert.deepEqual(COMPUTER_SLEEP_CSS_TOKENS, [
    "--sand-bg-elevated", "--sand-border-default", "--sand-fill-ghost-hover", "--sand-text-secondary",
  ]);
});

// ---------------------------------------------------------------------------
// Patch pass — idempotence and the double-apply guard.
// ---------------------------------------------------------------------------
test("patchComputerSleepRenderer appends once and refuses a second application", async () => {
  const { html } = await loadOfficialAsleepArtifacts();
  const runtime = computerSleepOverlayRuntime(html, {}, nativeSleepIconGlyph(nativeIcons));
  const patched = patchComputerSleepRenderer(PREVIEW_POOL_FIXTURE, runtime);
  assert.ok(patched.includes("/* grok-node computer sleep overlay"));
  assert.throws(() => patchComputerSleepRenderer(patched, runtime), /already applied/);
});

async function fixtureCss() {
  const [{ css }, { css: pillCss }] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialOpenPill()]);
  const tokens = [...new Set([
    ...[...css.matchAll(/var\((--sand-[a-z0-9-]+)\)/g)].map(match => match[1]),
    ...[...pillCss.matchAll(/var\((--sand-[a-z0-9-]+)\)/g)].map(match => match[1]),
    ...COMPUTER_SLEEP_CSS_TOKENS,
  ])];
  return ":root{" + tokens.map(token => `${token}:#aaa;`).join("") + "}";
}
const FIXTURE_CSS = await fixtureCss();;

test("applyComputerSleepRendererPatch works end-to-end on a fixture stage", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "compsleep-stage-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  writeFileSync(path.join(assets, "index-fixture.js"), PREVIEW_POOL_FIXTURE + nativeIcons);
  writeFileSync(path.join(assets, "index-fixture.css"), FIXTURE_CSS);
  const provenance = await applyComputerSleepRendererPatch({ stageRoot: stage });
  assert.equal(provenance.entry, "assets/index-fixture.js");
  assert.equal(provenance.containerClass, "sand-box-vnc-pool");
  assert.deepEqual(provenance.sleepIcon, { name: "moon-z", glyph: "\uf46f" });
  const patched = readFileSync(path.join(assets, "index-fixture.js"), "utf8");
  assert.ok(patched.includes("window.__rCompSleep"));
  const css = readFileSync(path.join(assets, "index-fixture.css"), "utf8");
  assert.ok(css.includes("#rcompsleep-pill"));
  assert.match(css, /top:\s*calc\(50% \+ 22px\)/, "官方定位规则在样式序列化后仍保留");
  assert.ok(existsSync(path.join(stage, "dist", "renderer-computer-sleep-extension.json")));
  await assert.rejects(() => applyComputerSleepRendererPatch({ stageRoot: stage }), /already/);
});

test("applyComputerSleepRendererPatch fails closed when the computer view class drifts", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "compsleep-drift-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  writeFileSync(path.join(assets, "index-fixture.js"), "var other=1;\n");
  writeFileSync(path.join(assets, "index-fixture.css"), FIXTURE_CSS);
  await assert.rejects(() => applyComputerSleepRendererPatch({ stageRoot: stage }), /sand-box-vnc-pool/);
});

test("applyComputerSleepRendererPatch fails closed when a design token is missing", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "compsleep-token-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  writeFileSync(path.join(assets, "index-fixture.js"), 'var pool="sand-box-vnc-pool";\n');
  writeFileSync(path.join(assets, "index-fixture.css"), ":root{--sand-bg-base:#0a0a0a}"); // 其余 token 缺失
  await assert.rejects(() => applyComputerSleepRendererPatch({ stageRoot: stage }), /missing design token/);
});

// ---------------------------------------------------------------------------
// Real-bundle dry run — gated on the hydrated 0.18 dist.
// ---------------------------------------------------------------------------
const hydratedSkip = existsSync(path.join(repoRoot, "src/app/dist/renderer/index.html"))
  ? false
  : "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.";
test("hydrated 0.18 renderer satisfies every computer-sleep anchor", { skip: hydratedSkip }, async () => {
  const rendererRoot = path.join(repoRoot, "src/app/dist/renderer");
  const html = readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const entryScripts = [...html.matchAll(/src="\.\/(assets\/index-[^"]+\.js)"/g)].map(match => match[1]);
  assert.equal(entryScripts.length, 1);
  const entry = readFileSync(path.join(rendererRoot, entryScripts[0]), "utf8");
  assert.ok(entry.includes("sand-box-vnc-pool"), "computer view root class present");
  const cssFiles = readdirSync(path.join(rendererRoot, "assets")).filter(file => /^index-.*\.css$/.test(file));
  assert.equal(cssFiles.length, 1);
  const css = readFileSync(path.join(rendererRoot, "assets", cssFiles[0]), "utf8");
  for (const token of COMPUTER_SLEEP_CSS_TOKENS) assert.ok(css.includes(token), token);
  const glyph = nativeSleepIconGlyph(entry);
  assert.equal(glyph, "\uf46f", "hydrated native regular and bold tables agree on moon-z");
  patchComputerSleepRenderer(entry, computerSleepOverlayRuntime((await loadOfficialAsleepArtifacts()).html, {}, glyph));
});

// ---------------------------------------------------------------------------
// Mac executor — bundled from source, driven against a fake docker.
// ---------------------------------------------------------------------------
async function loadExecutor() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "computer-sleep-executor.test.js");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/computer-sleep.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
  });
  return import(pathToFileURL(outfile).href);
}

test("computer preview state is local, isolated and idempotent", async () => {
  const { createComputerPreviewController } = await loadExecutor();
  const preview = createComputerPreviewController();
  const other = createComputerPreviewController();
  assert.equal(preview.getState(), "awake");
  assert.equal(preview.sleep(), "asleep");
  assert.equal(preview.sleep(), "asleep");
  assert.equal(preview.getState(), "asleep");
  assert.equal(other.getState(), "awake");
  assert.equal(preview.wake(), "awake");
  assert.equal(preview.wake(), "awake");
});

// ---------------------------------------------------------------------------
// Channel parity — every method the preload calls is published by the table, and the
// main-edge implements it (same guard as main-edge-method-table-parity, scoped here).
// ---------------------------------------------------------------------------
test("computer channel: preload calls, method table and main-edge handlers stay in parity", async () => {
  const { readFile } = await import("node:fs/promises");
  const preload = await readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
  const table = await readFile(path.join(repoRoot, "source/shared/rpc/main.ts"), "utf8");
  const edge = await readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8");
  const called = [...preload.matchAll(/edge\("(getComputerSleepState|sleepComputer|wakeComputer)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(called)].sort(), ["getComputerSleepState", "sleepComputer", "wakeComputer"]);
  for (const method of called) {
    assert.ok(new RegExp(`^  ${method}: \\{ args: "none" \\},$`, "m").test(table), `table missing ${method}`);
    assert.ok(new RegExp(`^    ${method}: async`, "m").test(edge) || new RegExp(`^    ${method}:`, "m").test(edge), `main-edge missing ${method}`);
  }
});
