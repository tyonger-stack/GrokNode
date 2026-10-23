import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { parse } from "acorn";
import { officialBotColor0753 } from "../scripts/lib/bot-color-0753-official.mjs";

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
  const outfile = path.join(repoRoot, ".omo", "evidence", "bot-color-switch", "cache", out);
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
  "--sand-fill-accent-subtle:#1084fe17;",
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

test("projection never creates self cycles or overrides unsupported native targets", () => {
  const css = ":root{--sand-fill-danger:red;--sand-fill-danger-hover:maroon;--sand-fill-accent:blue;--sand-fill-bubble-user:black}";
  const table = buildBotColorTintTable(css);
  assert.equal(table.red["--sand-fill-accent-hover"], undefined);
  for (const vars of Object.values(table)) for (const [key, value] of Object.entries(vars)) {
    assert.notEqual(value, `var(${key})`);
    assert.ok(css.includes(key + ":"));
    assert.ok(css.includes(value.slice(4, -1) + ":"));
  }
});

test("official 0.75.3 functions retain exact upstream function hashes", () => {
  const expected = {
    pf: "b4c3e74eaf9bb313eb058eb359f38aa19478ab34f1039b61cccac68e6be1fb7c",
    mde: "4eb28348606bbf555a711456ce44e01f9050b5fd355b24f23e85b406c0138883",
    cw: "d36355f9e181bebf7aa8c1c3f000106da1583820506dd93c13c97a2dae04cfe3",
    OO: "03d0c8b0ca77274e6760ebd8aeed5613cbc24a75d0a4302d17d72171ef4591b8",
    kO: "3c4adf2ba9b874fbe8b13abd39821e9c8c4fa4ec54a2924e1fab27cbc223e6ba",
    NO: "2db7076ccb4bd7a193db3c28108705b79fc8da46be1bf0607323be68c7c7dd70",
    fQ: "708f4772509b7b9694bfa5a3fb5d3822a1334d68d5a56a7553a479bebdad7c65",
    pQ: "f53254164e58db26280899914ca16f4f727d5050e797b050a1db9503ea3240c4",
    mQ: "f22adfcb454487e0841a4e593a29c3544430c72e604cbc004f45fced9d67886b",
    ion: "f10317b3baa0830f3c11a1e82436da11ef736ded19aa6eaf64525fd3483dff6d",
    qn: "0d2e79818fb9a9724de335585aeeb08d9e4d9c8a4f383981a3f85becf085f426",
  };
  const observed = {};
  for (const node of parse(officialBotColor0753, { ecmaVersion: "latest" }).body) {
    if (node.type !== "FunctionDeclaration") continue;
    observed[node.id.name] = createHash("sha256").update(officialBotColor0753.slice(node.start, node.end)).digest("hex");
  }
  assert.deepEqual(observed, expected);
});

test("official snapshot only notifies on effective changes and unsubscribes", () => {
  const qn = new Function(officialBotColor0753 + ";return qn")();
  const snapshots = qn(false);
  const changes = [];
  const unsubscribe = snapshots.subscribe(() => changes.push(snapshots.get()));
  snapshots.set(false);
  snapshots.set(true);
  snapshots.set(true);
  snapshots.update(value => value);
  snapshots.set(false);
  unsubscribe();
  snapshots.set(true);
  assert.deepEqual(changes, [true, false]);
});

test("findBotColorMessageClasses returns both bubble rules it scopes by", () => {
  assert.deepEqual(findBotColorMessageClasses(FIXTURE_CSS), { user: "sand-12qmj0a", agent: null });
  assert.throws(() => findBotColorMessageClasses(":root{--sand-fill-bubble-user:#070707}"), /--sand-fill-bubble-user/);
});

// ---------------------------------------------------------------------------
// Runtime emission.
// ---------------------------------------------------------------------------
test("botColorRuntime embeds literal official helpers and reads only the effective preference", () => {
  const runtime = botColorRuntime({ red: { "--sand-fill-accent": "var(--sand-fill-danger)" } }, { user: "sand-12qmj0a", agent: "sand-1g0q52m" });
  assert.ok(runtime.includes("S.useSyncExternalStore"));
  assert.doesNotMatch(runtime, /querySelector|reactFiber|MutationObserver|setProperty|removeProperty/);
  assert.ok(runtime.includes('"--sand-fill-accent":"var(--sand-fill-danger)"'));
  assert.ok(runtime.includes("bridge.getBotColorInChat"));
  assert.ok(runtime.includes("function mde(e){return!e.isGroup}"));
  assert.ok(runtime.includes("case`violet`:return`purple`"));
  // new Function is a cheap syntax gate on the emitted runtime before acorn runs in patch.
  new Function(runtime.replace(/^[\s\S]*?\n/, "")); // eslint-disable-line no-new-func
});

test("botColorRuntime rejects an empty bubble class", () => {
  assert.throws(() => botColorRuntime({}, ""), /bubble class is required/);
});

// ---------------------------------------------------------------------------
// Patch pass — idempotence and the double-apply guard.
// ---------------------------------------------------------------------------
const NATIVE_FIXTURE = `
function Cee(n){return n.avatarColor}function QCe(n){return false}
var a="ui-scroll-area",b="sand-prompt-form",c="sand-info-pane";
const c_n=S.memo(i_n);
function hve(n){return p.jsx(S9n,{...n,isSendingPaused:i})}
function yOn(n){return {transcript:p.jsx(c_n,{agentActivity:n.activity}),composer:p.jsx(hve,{onSubmit:n.onSubmit}),newChatComposer:p.jsx(hve,{}),heroComposer:p.jsx(hve,{})}}
function i_n(n){const e=he.c(150);let Sr;return e[148]!==Es?(Sr=p.jsx(p.Fragment,{children:p.jsx(Ar,{ref:ge,children:Es})}),e[149]=Sr):Sr=e[149],Sr}
function S9n(n){const e=he.c(215);let $a;return e[213]!==za?($a=p.jsx("form",{className:ts,onSubmit:ks,children:za}),e[214]=$a):$a=e[214],$a}
function E3n(n){const e=he.c(58);let Q;return e[50]!==Y?(Q=p.jsxs("aside",{id:G,style:Y,children:[U,se,le]}),e[57]=Q):Q=e[57],Q}
`;

test("patchBotColorRenderer patches native React roots once and refuses a second application", () => {
  const runtime = botColorRuntime({ red: {} }, { user: "sand-x", agent: null });
  const patched = patchBotColorRenderer(NATIVE_FIXTURE, runtime);
  assert.ok(patched.includes("/* grok-node bot-color tint"));
  assert.throws(() => patchBotColorRenderer(patched, runtime), /already applied/);
  for (const [before, after] of [["function yOn", "function renamed"], ["he.c(150)", "he.c(151)"], ["onSubmit:ks", "onSubmit:other"], ["style:Y", "style:other"], ["p.jsx(Ar,", "p.jsx(Other,"], ["c_n=S.memo(i_n)", "c_n=S.memo(other)"], ["...n,isSendingPaused:i", "isSendingPaused:i"]]) {
    assert.throws(() => patchBotColorRenderer(NATIVE_FIXTURE.replace(before, after), runtime), /Bot-color patch:/);
  }
  assert.throws(() => patchBotColorRenderer(NATIVE_FIXTURE + NATIVE_FIXTURE, runtime), SyntaxError);
  assert.throws(() => patchBotColorRenderer(NATIVE_FIXTURE.replace("composer:p.jsx(hve,", "composer:p.jsx(hve,{}),composer:p.jsx(hve,"), runtime), /ambiguous chat property/);
  assert.throws(() => patchBotColorRenderer("var x=1;", runtime), /memo binding drifted/);
});

test("applyBotColorRendererPatch works end-to-end on a fixture stage", async () => {
  const stage = mkdtempSync(path.join(tmpdir(), "botcolor-stage-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(stage, "dist", "renderer", "index.html"), '<script src="./assets/index-fixture.js"></script>');
  // A minimal entry chunk: container markers + the two palette helpers the runtime calls.
  writeFileSync(path.join(assets, "index-fixture.js"), NATIVE_FIXTURE);
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
  const outfile = path.join(repoRoot, ".omo", "evidence", "bot-color-switch", "cache", "bot-color-service.test.js");
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
