import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTsModule(relativePath) {
  const dir = await mkdtemp(path.join(tmpdir(), "i18n-test-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

test("application menu template emits English labels by default", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const template = menu.buildApplicationMenuTemplate(
    {
      applyWindowShortcut: () => undefined,
      canUseDevTools: () => false,
      emitOpenAbout: () => undefined,
      emitOpenFeedback: () => undefined,
      platform: "darwin",
    },
    { appName: "Grok Node", openExternal: async () => undefined },
  );
  const fileMenu = template.find((entry) => entry.label === "File");
  assert.ok(fileMenu, "expected a File menu with English label");
  const viewMenu = template.find((entry) => entry.role === "viewMenu");
  assert.ok(viewMenu, "expected a View menu via the macOS viewMenu system role");
  const reload = viewMenu.submenu.find((entry) => entry.label === "Reload");
  assert.ok(reload, "expected a Reload item under View");
  const help = template.find((entry) => entry.role === "help");
  assert.ok(help, "expected a help role entry");
  const helpCenter = help.submenu.find((entry) => entry.label === "Help Center");
  assert.ok(helpCenter, "expected a Help Center item under Help");
});

test("application menu template switches to zh-CN labels when locale resolves", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const template = menu.buildApplicationMenuTemplate(
    {
      applyWindowShortcut: () => undefined,
      canUseDevTools: () => false,
      emitOpenAbout: () => undefined,
      emitOpenFeedback: () => undefined,
      locale: "zh-CN",
      platform: "darwin",
    },
    { appName: "Grok Node", openExternal: async () => undefined },
  );
  const fileMenu = template.find((entry) => entry.label === "文件");
  assert.ok(fileMenu, "expected File menu translated to 文件");
  const viewMenu = template.find((entry) => entry.role === "viewMenu");
  assert.ok(viewMenu, "expected View menu to use macOS system role so Edit items are not double-injected");
  const reload = viewMenu.submenu.find((entry) => entry.label === "重新加载");
  assert.ok(reload, "expected Reload translated to 重新加载");
  const help = template.find((entry) => entry.role === "help");
  const helpCenter = help.submenu.find((entry) => entry.label === "帮助中心");
  assert.ok(helpCenter, "expected Help Center translated to 帮助中心");
  const about = template[0]?.submenu.find((entry) => typeof entry.label === "string" && entry.label.startsWith("关于 "));
  assert.ok(about, "expected About entry to use zh-CN 关于 prefix");
});

test("SandLanguageController subscribe receives every setPreference change", async () => {
  const controllerMod = await loadTsModule("source/electron-main/prefs/language-controller.ts");
  let stored = "follow-system";
  const controller = new controllerMod.SandLanguageController(
    {
      getLanguagePreference: () => stored,
      setLanguagePreference: (value) => { stored = value; },
    },
    () => undefined,
  );
  const seen = [];
  const unsubscribe = controller.subscribe((state) => seen.push(state.preference));
  controller.setPreference("en");
  controller.setPreference("zh-CN");
  assert.deepEqual(seen, ["en", "zh-CN"]);
  unsubscribe();
  controller.setPreference("follow-system");
  assert.deepEqual(seen, ["en", "zh-CN"], "unsubscribe should stop delivery");
  controller.dispose();
});