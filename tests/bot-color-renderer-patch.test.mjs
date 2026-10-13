import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import {
  BOT_COLOR_HUE_SOURCE,
  buildBotColorTintTable,
  findBotColorMessageClasses,
  normalizeBotColorHue,
  botColorRuntime,
} from "../scripts/lib/bot-color-renderer-components.mjs";
import { patchBotColorRenderer, applyBotColorRendererPatch } from "../scripts/lib/bot-color-renderer-patch.mjs";
import { insertBotColorGate } from "../scripts/lib/bot-color-gate-patch.mjs";
import { patchBotColorSettings, applyBotColorSettingsPatch } from "../scripts/lib/bot-color-settings-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(out, entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

// ---------------------------------------------------------------------------
// Hue normalization — the official cg() rule, verbatim semantics.
// ---------------------------------------------------------------------------
test("normalizeBotColorHue mirrors official cg(): black/gray untintable, violet→purple", () => {
  assert.equal(normalizeBotColorHue("black"), null);
  assert.equal(normalizeBotColorHue("gray"), null);
  assert.equal(normalizeBotColorHue("violet"), "purple");
  assert.equal(normalizeBotColorHue("red"), "red");
  assert.equal(normalizeBotColorHue("magenta"), "magenta");
  assert.equal(normalizeBotColorHue("not-a-color"), "not-a-color"); // palette admission happens in Cee, not here
  assert.equal(normalizeBotColorHue(undefined), null);
  assert.equal(normalizeBotColorHue(42), null);
});

// ---------------------------------------------------------------------------
// Tint table generation — only tokens the stylesheet actually defines.
// ---------------------------------------------------------------------------
const FIXTURE_CSS = [
  ":root{",
  "--sand-fill-danger:#ff263c;--sand-fill-danger-hover:#c21d2e;--sand-fill-danger-subtle:#ff263c17;",
  "--sand-text-danger:#c21d2e;",
  "--sand-fill-supplementary4:#9159fe;--sand-fill-supplementary4-hover:#6e44c1;",
  "--sand-fill-accent:#1084fe;--sand-fill-accent-hover:#0c64c1;--sand-text-accent:#0c64c1;",
  "--sand-fill-bubble-user:#070707;--sand-text-on-primary:#fcfcfc;}",
  ".sand-12qmj0a:not(#\\#):not(#\\#){background-color:var(--sand-fill-bubble-user)}",
].join("\n");

test("buildBotColorTintTable emits only defined tokens per family", () => {
  const table = buildBotColorTintTable(FIXTURE_CSS);
  // red → danger: fill base/hover/subtle + bubble + text; no border (fixture has none).
  assert.deepEqual(table.red, {
    "--sand-fill-bubble-user": "var(--sand-fill-danger)",
    "--sand-fill-accent": "var(--sand-fill-danger)",
    "--sand-fill-accent-hover": "var(--sand-fill-danger-hover)",
    "--sand-fill-accent-subtle": "var(--sand-fill-danger-subtle)",
    "--sand-text-accent": "var(--sand-text-danger)",
  });
  // violet → supplementary4 (keyed as purple, the normalized hue): no subtle, no text family in the fixture.
  assert.deepEqual(table.purple, {
    "--sand-fill-bubble-user": "var(--sand-fill-supplementary4)",
    "--sand-fill-accent": "var(--sand-fill-supplementary4)",
    "--sand-fill-accent-hover": "var(--sand-fill-supplementary4-hover)",
  });
  assert.equal(table.violet, undefined, "palette id violet is normalized away");
  // blue → accent itself: only the bubble override survives; identity entries dropped.
  assert.deepEqual(table.blue, { "--sand-fill-bubble-user": "var(--sand-fill-accent)" });
  // Hues whose source family is entirely absent are dropped, not half-emitted.
  assert.equal(table.orange, undefined);
  assert.equal(table.yellow, undefined);
});

test("buildBotColorTintTable covers every hue source family it declares", () => {
  const table = buildBotColorTintTable(FIXTURE_CSS);
  for (const hue of Object.keys(BOT_COLOR_HUE_SOURCE)) {
    if (table[hue] === undefined) continue;
    for (const value of Object.values(table[hue])) assert.match(value, /^var\(--sand-[a-z0-9-]+\)$/);
  }
});

test("findBotColorMessageClasses returns both bubble rules it scopes by", () => {
  assert.deepEqual(findBotColorMessageClasses(FIXTURE_CSS), { user: "sand-12qmj0a", agent: null });
  assert.throws(() => findBotColorMessageClasses(":root{--sand-fill-bubble-user:#070707}"), /--sand-fill-bubble-user/);
});

// ---------------------------------------------------------------------------
// Runtime emission.
// ---------------------------------------------------------------------------
test("botColorRuntime embeds the table, the bubble scope, and the idempotence guard", () => {
  const runtime = botColorRuntime({ red: { "--sand-fill-accent": "var(--sand-fill-danger)" } }, { user: "sand-12qmj0a", agent: "sand-1g0q52m" });
  assert.ok(runtime.includes("window.__rbotTint"));
  assert.ok(runtime.includes("'.sand-12qmj0a,.sand-1g0q52m'"));
  assert.ok(runtime.includes('"--sand-fill-accent":"var(--sand-fill-danger)"'));
  assert.ok(runtime.includes("bridge.getBotColorInChat"));
  assert.ok(runtime.includes("agent.isGroup===true"));
  assert.ok(runtime.includes("'violet'?'purple'"));
  // new Function is a cheap syntax gate on the emitted runtime before acorn runs in patch.
  new Function(runtime.replace(/^[\s\S]*?\n/, "")); // eslint-disable-line no-new-func
});

test("botColorRuntime rejects an empty bubble class", () => {
  assert.throws(() => botColorRuntime({}, ""), /bubble class is required/);
});

// ---------------------------------------------------------------------------
// Patch pass — idempotence and the double-apply guard.
// ---------------------------------------------------------------------------
test("patchBotColorRenderer appends once and refuses a second application", () => {
  const runtime = botColorRuntime({ red: {} }, { user: "sand-x", agent: null });
  const patched = patchBotColorRenderer("var x=1;\n", runtime);
  assert.ok(patched.includes("/* grok-node bot-color tint"));
  assert.throws(() => patchBotColorRenderer(patched, runtime), /already applied/);
});

test("applyBotColorRendererPatch works end-to-end on a fixture stage", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "botcolor-stage-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  // A minimal entry chunk: container markers + the two palette helpers the runtime calls.
  writeFileSync(path.join(assets, "index-fixture.js"), 'function Cee(n){return n}function QCe(n){return !1}var a="ui-scroll-area",b="sand-prompt-form",c="sand-info-pane";\n');
  writeFileSync(path.join(assets, "index-fixture.css"), FIXTURE_CSS);
  const provenance = await applyBotColorRendererPatch({ stageRoot: stage });
  assert.equal(provenance.entry, "assets/index-fixture.js");
  assert.ok(provenance.hues.includes("red"));
  assert.deepEqual(provenance.messageClasses, { user: "sand-12qmj0a", agent: null });
  const patched = readFileSync(path.join(assets, "index-fixture.js"), "utf8");
  assert.ok(patched.includes("/* grok-node bot-color tint"));
  assert.ok(existsSync(path.join(stage, "dist", "renderer-bot-color-extension.json")));
  await assert.rejects(() => applyBotColorRendererPatch({ stageRoot: stage }), /already applied/);
});

test("applyBotColorRendererPatch fails closed when the palette helpers drift", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "botcolor-nodrift-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  writeFileSync(path.join(assets, "index-fixture.js"), 'var a="ui-scroll-area",b="sand-prompt-form",c="sand-info-pane";\n'); // helpers renamed away
  writeFileSync(path.join(assets, "index-fixture.css"), FIXTURE_CSS);
  await assert.rejects(() => applyBotColorRendererPatch({ stageRoot: stage }), /palette helper/);
});

// ---------------------------------------------------------------------------
// Gate FLAGS patch — same fixture discipline as the main-agent gate test.
// ---------------------------------------------------------------------------
test("insertBotColorGate inserts exactly once and reports already-present", () => {
  const table = "const FLAGS = {\n" + insertBotColorGate("  sand_usage_page: {\n    client: true,\n    default: false\n  },\n}").text + "};";
  assert.ok(table.includes("grok_bot_all_bots_color_theming: {"));
  assert.ok(table.includes("default: true"));
  const again = insertBotColorGate(table);
  assert.equal(again.applied, false);
  assert.equal(again.reason, "already-present");
  assert.equal(insertBotColorGate("const FLAGS = {};").reason, "anchor-missing");
});

// ---------------------------------------------------------------------------
// Host contract — the official three-state rule, bundled from source.
// ---------------------------------------------------------------------------
test("resolveBotColorInChatEnabled follows the official preference ?? gate rule", async () => {
  const { resolveBotColorInChatEnabled } = await load("bot-color-contract.test.js", "source/shared/node/grok-bot-bot-color.ts");
  assert.equal(resolveBotColorInChatEnabled(undefined, true), true, "unset preference follows the gate default (on)");
  assert.equal(resolveBotColorInChatEnabled(undefined, false), false, "gate off forces off");
  assert.equal(resolveBotColorInChatEnabled(true, true), true);
  assert.equal(resolveBotColorInChatEnabled(false, true), false, "explicit opt-out beats the gate default");
  assert.equal(resolveBotColorInChatEnabled(true, false), false, "gate off beats an explicit opt-in");
});

test("settings service refuses bot-color writes while the gate reader is unregistered", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "bot-color-service.test.js");
  mkdirSync(path.dirname(outfile), { recursive: true });
  // One bundle so the service and the gate registry share module state — the pin must be
  // visible to the service, exactly like the main-agent variant it is modelled on.
  await build({
    stdin: {
      contents: [
        "import { writeFileSync, mkdtempSync } from \"node:fs\";",
        "import { tmpdir } from \"node:os\";",
        "import path from \"node:path\";",
        `import { SettingsService } from ${JSON.stringify(path.join(repoRoot, "source/host/extensions/settings/settings-service.ts"))};`,
        `import { pinGrokBotBotColorGateReader } from ${JSON.stringify(path.join(repoRoot, "source/host/extensions/settings/bot-color-gate.ts"))};`,
        `import { GrokBotBotColorRefusedError } from ${JSON.stringify(path.join(repoRoot, "source/shared/node/grok-bot-bot-color.ts"))};`,
        "const dir = mkdtempSync(path.join(tmpdir(), \"botcolor-settings-\"));",
        "const service = new SettingsService(path.join(dir, \"settings.json\"));",
        "export function state() { return service.getHostSettings().botColorInChatEnabled; }",
        "export function refused() { try { service.setHostSettings({ botColorInChatEnabled: true }); return false; } catch (error) { return error instanceof GrokBotBotColorRefusedError; } }",
        "export function enableGate() { pinGrokBotBotColorGateReader(() => true); }",
        "export function stored() { return JSON.parse(readFileSyncUnc(path.join(dir, \"settings.json\"), \"utf8\")); }",
        "function readFileSyncUnc(p) { return require(\"node:fs\").readFileSync(p, \"utf8\"); }",
      ].join("\n"),
      resolveDir: repoRoot,
      sourcefile: "bot-color-service-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
  });
  const service = await import(pathToFileURL(outfile).href);
  assert.equal(service.state(), false, "unregistered gate reader reads as NOT enabled");
  assert.equal(service.refused(), true, "write refused with GrokBotBotColorRefusedError while unregistered");
  service.enableGate();
  assert.equal(service.refused(), false, "write accepted once the experiments extension pins the reader");
  assert.equal(service.state(), true, "effective value now true (stored true, gate on)");
  assert.equal(service.stored().botColorInChatEnabled, true, "preference persisted to settings.json");
});

// ---------------------------------------------------------------------------
// Real-bundle dry run — gated on the hydrated 0.18 dist, like the main-agent tests.
// ---------------------------------------------------------------------------
const hydratedSkip = existsSync(path.join(repoRoot, "src/app/dist/renderer/index.html"))
  ? false
  : "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.";
test("hydrated 0.18 renderer satisfies every bot-color anchor", { skip: hydratedSkip }, async () => {
  const rendererRoot = path.join(repoRoot, "src/app/dist/renderer");
  const html = readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map(match => match[1]);
  const entryScripts = scripts.filter(name => /\/index-[^/]+\.js$/.test(name));
  assert.equal(entryScripts.length, 1);
  const entry = readFileSync(path.join(rendererRoot, entryScripts[0]), "utf8");
  for (const marker of ["ui-scroll-area", "sand-jp7ctv", "sand-info-pane"]) assert.ok(entry.includes(marker), marker);
  assert.equal(entry.split("function Cee(").length - 1, 1);
  assert.equal(entry.split("function QCe(").length - 1, 1);
  const cssFiles = readdirSync(path.join(rendererRoot, "assets")).filter(file => /^index-.*\.css$/.test(file));
  assert.equal(cssFiles.length, 1);
  const css = readFileSync(path.join(rendererRoot, "assets", cssFiles[0]), "utf8");
  const bubble = findBotColorMessageClasses(css);
  assert.deepEqual(bubble, { user: "sand-mvmkjj", agent: "sand-1g0q52m" });
  const table = buildBotColorTintTable(css);
  // Every tintable palette hue resolves, keyed by the NORMALIZED hue (violet→purple).
  assert.deepEqual(Object.keys(table).sort(), ["blue", "brown", "cyan", "green", "magenta", "orange", "purple", "red", "yellow"].sort());
  assert.equal(table.violet, undefined);
  for (const vars of Object.values(table)) for (const value of Object.values(vars)) assert.ok(css.includes(value.slice(4, -1)));
  // The full patched entry chunk still parses.
  patchBotColorRenderer(entry, botColorRuntime(table, bubble));
});

// ---------------------------------------------------------------------------
// Phase 2 — the Settings → Appearance accent dropdown.
// ---------------------------------------------------------------------------
const SETTINGS_FIXTURE = [
  'const ha={system:"Follow System",light:"Light",dark:"Dark"};',
  'const ba=_s.map(s=>({value:s,label:ha[s]}));',
  'function pa(){const s=H.c(6),{preference:e}=Ss(),{setPreference:t,isPending:n}=ws();',
  'let d;s[0]!==t?(d=r=>{r!==null&&t(r)},s[0]=t,s[1]=d):d=s[1];',
  'let l;',
  // The anchor itself ends in pa's closing brace, so the fixture keeps that brace ONLY
  // inside the return line (exactly as the real chunk lays it out).
  'return s[2]!==n||s[3]!==e||s[4]!==d?(l=a.jsx(re,{title:"Appearance",children:a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})})}),s[2]=n,s[3]=e,s[4]=d,s[5]=l):l=s[5],l}',
].join("\n");

test("patchBotColorSettings splices the accent row into the Appearance section", () => {
  const result = patchBotColorSettings(SETTINGS_FIXTURE);
  assert.equal(result.applied, true);
  assert.ok(result.text.includes('title:"Appearance",children:['), "children becomes a list");
  assert.ok(result.text.includes("a.jsx(RbcAccentRow,{})"), "accent row appended after the theme row");
  assert.ok(result.text.includes('RBC_OPTIONS=[{value:"black",label:"Black"},{value:"bot-color",label:"Bot color"}]'), "official two-option enum");
  assert.ok(result.text.includes('u==="bot-color"'), "UI enum collapses to the stored boolean");
  assert.ok(result.text.includes("bridge.getBotColorInChat"), "reads through the phase-1 bridge");
  assert.ok(result.text.includes("bridge.setBotColorInChat"), "writes through the phase-1 bridge");
  const again = patchBotColorSettings(result.text);
  assert.equal(again.applied, false);
  assert.equal(again.reason, "already-present");
});

test("patchBotColorSettings fails closed on anchor drift", () => {
  assert.equal(patchBotColorSettings('const ha={};function pa(){}').reason, "anchor-missing");
  const doubled = SETTINGS_FIXTURE.replace("function pa(){", "function pa(){return s[2]!==n||s[3]!==e||s[4]!==d?(l=a.jsx(re,{title:\"Appearance\"");
  assert.match(patchBotColorSettings(SETTINGS_FIXTURE + SETTINGS_FIXTURE).reason, /anchor-ambiguous:2/);
});

test("applyBotColorSettingsPatch works end-to-end on a fixture stage", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "botcolor-settings-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(assets, "index-fixture.js"), "function other(){}\n");
  writeFileSync(path.join(assets, "chunk-settings-fixture.js"), SETTINGS_FIXTURE);
  const provenance = await applyBotColorSettingsPatch({ stageRoot: stage });
  assert.equal(provenance.file, "chunk-settings-fixture.js");
  const patched = readFileSync(path.join(assets, "chunk-settings-fixture.js"), "utf8");
  assert.ok(patched.includes("RbcAccentRow"));
  assert.ok(existsSync(path.join(stage, "dist", "renderer-bot-color-settings-extension.json")));
  const again = await applyBotColorSettingsPatch({ stageRoot: stage });
  assert.equal(again.applied, false);
  assert.equal(again.reason, "already-present");
});

test("applyBotColorSettingsPatch rejects ambiguous settings chunks", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "botcolor-settings-amb-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(assets, "a.js"), SETTINGS_FIXTURE);
  writeFileSync(path.join(assets, "b.js"), SETTINGS_FIXTURE);
  await assert.rejects(() => applyBotColorSettingsPatch({ stageRoot: stage }), /found 2/);
});

test("hydrated 0.18 settings chunk satisfies the phase-2 anchor", { skip: hydratedSkip }, async () => {
  const assets = path.join(repoRoot, "src/app/dist/renderer/assets");
  const files = readdirSync(assets).filter(file => file.endsWith(".js"));
  const carriers = [];
  for (const file of files) {
    if (readFileSync(path.join(assets, file), "utf8").includes("const ha={system:\"Follow System\",light:\"Light\",dark:\"Dark\"}")) carriers.push(file);
  }
  assert.equal(carriers.length, 1, `settings chunk carriers: ${carriers.join(", ")}`);
  const source = readFileSync(path.join(assets, carriers[0]), "utf8");
  const result = patchBotColorSettings(source);
  assert.equal(result.applied, true, result.reason);
});
