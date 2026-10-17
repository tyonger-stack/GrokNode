import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import {
  applyHardwareAccelerationSettingsPatch,
  patchHardwareAccelerationSettings,
} from "../scripts/lib/hardware-acceleration-settings-patch.mjs";

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
      },
    }],
  });
  return import(pathToFileURL(outfile).href);
}

function mockApp() {
  const switches = [];
  let disabled = false;
  let ready = false;
  return {
    switches,
    get disabled() { return disabled; },
    setReady(value) { ready = value; },
    isReady: () => ready,
    disableHardwareAcceleration() { disabled = true; },
    commandLine: { appendSwitch(name) { switches.push(name); } },
  };
}

test("platform default: darwin/win32 enabled, others disabled (0.71.2 TF)", async () => {
  const { resolveHardwareAccelerationEnabled } = await load(
    "hw-accel-policy.test.js",
    "source/shared/node/hardware-acceleration.ts",
  );
  assert.equal(resolveHardwareAccelerationEnabled(undefined, "darwin"), true);
  assert.equal(resolveHardwareAccelerationEnabled(undefined, "win32"), true);
  assert.equal(resolveHardwareAccelerationEnabled(undefined, "linux"), false);
  assert.equal(resolveHardwareAccelerationEnabled(false, "darwin"), false);
  assert.equal(resolveHardwareAccelerationEnabled(true, "linux"), true);
});

test("AF policy only disables (+ disable-gpu) when preference resolves false", async () => {
  const {
    applyHardwareAccelerationPolicy,
    resetHardwareAccelerationEnabledAtLaunchForTests,
    getHardwareAccelerationEnabledAtLaunch,
  } = await load("hw-accel-af.test.js", "source/shared/node/hardware-acceleration.ts");

  resetHardwareAccelerationEnabledAtLaunchForTests();
  const enabledApp = mockApp();
  assert.equal(applyHardwareAccelerationPolicy({
    app: enabledApp,
    storedPreference: undefined,
    platform: "darwin",
  }), true);
  assert.equal(enabledApp.disabled, false);
  assert.deepEqual(enabledApp.switches, []);
  assert.equal(getHardwareAccelerationEnabledAtLaunch(), true);

  resetHardwareAccelerationEnabledAtLaunchForTests();
  const disabledApp = mockApp();
  assert.equal(applyHardwareAccelerationPolicy({
    app: disabledApp,
    storedPreference: false,
    platform: "darwin",
  }), false);
  assert.equal(disabledApp.disabled, true);
  assert.deepEqual(disabledApp.switches, ["disable-gpu"]);
  assert.equal(getHardwareAccelerationEnabledAtLaunch(), false);
});

test("AF policy refuses to run after app ready", async () => {
  const { applyHardwareAccelerationPolicy, resetHardwareAccelerationEnabledAtLaunchForTests } = await load(
    "hw-accel-ready.test.js",
    "source/shared/node/hardware-acceleration.ts",
  );
  resetHardwareAccelerationEnabledAtLaunchForTests();
  const app = mockApp();
  app.setReady(true);
  assert.throws(
    () => applyHardwareAccelerationPolicy({ app, storedPreference: true, platform: "darwin" }),
    /after app ready/,
  );
});

test("settings store round-trips hardwareAccelerationEnabled", async () => {
  const { SandSettingsStore } = await load(
    "hw-accel-store.test.js",
    "source/shared/node/settings/sand-settings-store.ts",
  );
  const dir = mkdtempSync(path.join(tmpdir(), "hw-accel-store-"));
  try {
    const file = path.join(dir, "settings.json");
    const store = new SandSettingsStore(file);
    assert.equal(store.getHardwareAccelerationEnabled(), undefined);
    store.setHardwareAccelerationEnabled(false);
    assert.equal(store.getHardwareAccelerationEnabled(), false);
    const reloaded = new SandSettingsStore(file);
    assert.equal(reloaded.getHardwareAccelerationEnabled(), false);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(raw.hardwareAccelerationEnabled, false);
    reloaded.setHardwareAccelerationEnabled(true);
    assert.equal(new SandSettingsStore(file).getHardwareAccelerationEnabled(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: forgetting parseSettings read drops hardwareAccelerationEnabled", async () => {
  const sourcePath = path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts");
  const original = readFileSync(sourcePath, "utf8");
  const needle = 'if (typeof raw.hardwareAccelerationEnabled === "boolean") result.hardwareAccelerationEnabled = raw.hardwareAccelerationEnabled;';
  assert.ok(original.includes(needle), "parseSettings must contain the hardwareAccelerationEnabled read");

  const mutated = original.replace(needle, "");
  assert.notEqual(mutated, original, "mutation must change the source");
  const dir = mkdtempSync(path.join(tmpdir(), "hw-accel-mut-"));
  try {
    const mutatedEntry = path.join(dir, "sand-settings-store.ts");
    writeFileSync(mutatedEntry, mutated);
    // Bundle the mutated file in isolation (rewrite relative imports to absolute).
    const rewritten = mutated.replace(
      /from "(\.\.\/[^"]+)"/g,
      (_m, rel) => `from ${JSON.stringify(path.resolve(path.dirname(sourcePath), rel))}`,
    );
    writeFileSync(mutatedEntry, rewritten);
    const outfile = path.join(dir, "mutated-store.mjs");
    await build({
      entryPoints: [mutatedEntry],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      logLevel: "error",
      packages: "external",
    });
    const { SandSettingsStore } = await import(pathToFileURL(outfile).href);
    const settingsFile = path.join(dir, "settings.json");
    writeFileSync(settingsFile, JSON.stringify({
      version: 1,
      mcpBoxServers: [],
      autoUpdateWhenIdleOptIn: false,
      egressTunnelEnabled: false,
      webauthnProxyEnabled: true,
      mcpCustomInstructions: {},
      mcpCustomInstructionsByServerId: {},
      mcpDisabledToolsByServerId: {},
      conciergeConsent: "unset",
      settingsMigrations: [],
      hardwareAccelerationEnabled: false,
    }, null, 2));
    const store = new SandSettingsStore(settingsFile);
    assert.equal(
      store.getHardwareAccelerationEnabled(),
      undefined,
      "without parseSettings read the field must be silently dropped",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("currentHardwareAccelerationSetting projects enabled + enabledAtLaunch + pdfRasterMode", async () => {
  const { currentHardwareAccelerationSetting } = await load(
    "hw-accel-rf.test.js",
    "source/shared/node/hardware-acceleration.ts",
  );
  assert.deepEqual(
    currentHardwareAccelerationSetting({
      storedPreference: false,
      platform: "darwin",
      enabledAtLaunch: true,
      gpuFeatureStatus: { rasterization: "enabled" },
    }),
    { enabled: false, enabledAtLaunch: true, pdfRasterMode: "gpu" },
  );
  assert.deepEqual(
    currentHardwareAccelerationSetting({
      storedPreference: undefined,
      platform: "linux",
      enabledAtLaunch: false,
      gpuFeatureStatus: { rasterization: "disabled" },
    }),
    { enabled: false, enabledAtLaunch: false, pdfRasterMode: "software" },
  );
});

test("settings UI patch injects toggle + restart after Language Sa slot", async () => {
  // Theme `ha` may already be RLocT-wrapped by settings-i18n; chunk identity is RLangSection.
  const base = [
    'const ha={system:(RLocT("Follow System","跟随系统")),light:(RLocT("Light","浅色")),dark:(RLocT("Dark","深色"))};',
    "function RLangSection(){return null}",
    'function Sa(){const r=a.jsx(RLangSection,{});return r}',
    "export{}",
  ].join("\n");
  const result = patchHardwareAccelerationSettings(base);
  assert.equal(result.applied, true);
  assert.ok(result.text.includes("function RHwAccelSection()"));
  assert.ok(result.text.includes("RHwAccelSection,{}"));
  assert.ok(result.text.includes("getHardwareAcceleration"));
  assert.ok(result.text.includes("setHardwareAccelerationEnabled"));
  assert.ok(result.text.includes("relaunchDesktop"));
  assert.ok(result.text.includes("使用硬件加速"));
  assert.ok(result.text.includes("Restart to Apply"));
  assert.ok(result.text.includes("a.jsx(Ne,"));
});

test("settings UI patch fails closed without Language Sa slot", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "hw-accel-ui-"));
  try {
    const assets = path.join(tmp, "dist/renderer/assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(
      path.join(assets, "index-fake.js"),
      'const ha={system:"Follow System",light:"Light",dark:"Dark"};export{}',
    );
    const result = await applyHardwareAccelerationSettingsPatch({ stageRoot: tmp });
    assert.equal(result.applied, false);
    assert.equal(result.reason, "anchor-missing");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("main.ts startup applies policy instead of always-disable", async () => {
  const mainPath = path.join(repoRoot, "source/electron-main/main.ts");
  const source = readFileSync(mainPath, "utf8");
  assert.ok(source.includes("applyHardwareAccelerationPolicy"), "startup must call AF() policy");
  assert.ok(source.includes("getHardwareAccelerationEnabled"), "startup must read the stored preference");
  // The unconditional always-disable pair must not remain as the default path.
  assert.equal(
    /deps\.app\.disableHardwareAcceleration\(\);\s*deps\.app\.commandLine\.appendSwitch\("no-sandbox"\);\s*deps\.app\.commandLine\.appendSwitch\("disable-gpu"\)/.test(source),
    false,
    "unconditional disableHardwareAcceleration + disable-gpu must be gone",
  );
});
