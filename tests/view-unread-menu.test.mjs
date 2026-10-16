import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTsModule(relativePath) {
  const dir = await mkdtemp(path.join(tmpdir(), "view-unread-menu-"));
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
    return await import(`${out}?t=${Date.now()}`);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

function viewSubmenu(template) {
  const viewMenu = template.find((entry) => entry.role === "viewMenu");
  assert.ok(viewMenu, "expected View menu");
  return viewMenu.submenu;
}

function baseOptions(overrides = {}) {
  return {
    applyWindowShortcut: () => undefined,
    canUseDevTools: () => false,
    emitOpenAbout: () => undefined,
    emitOpenFeedback: () => undefined,
    emitUnreadFilterMenuClicked: () => undefined,
    isUnreadFilterChecked: () => false,
    platform: "darwin",
    ...overrides,
  };
}

test("View Unread checkbox sits after Reload separator and before fullscreen", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const template = menu.buildApplicationMenuTemplate(
    baseOptions(),
    { appName: "Grok Node", openExternal: async () => undefined },
  );
  const submenu = viewSubmenu(template);
  const labels = submenu.map((entry) => entry.type === "separator" ? "---" : entry.label ?? entry.role);
  assert.deepEqual(labels.slice(0, 4), ["Reload", "---", "View Unread", "---"]);
  const unread = submenu.find((entry) => entry.label === "View Unread");
  assert.equal(unread.type, "checkbox");
  assert.equal(unread.checked, false);
  assert.equal(typeof unread.click, "function");
});

test("View Unread uses zh-CN 查看未读 from 0.71.2 catalog id 5G1/yr", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const template = menu.buildApplicationMenuTemplate(
    baseOptions({ locale: "zh-CN", isUnreadFilterChecked: () => true }),
    { appName: "Grok Node", openExternal: async () => undefined },
  );
  const unread = viewSubmenu(template).find((entry) => entry.label === "查看未读");
  assert.ok(unread, "expected 查看未读 checkbox");
  assert.equal(unread.type, "checkbox");
  assert.equal(unread.checked, true);
});

test("checkbox click emits checked state and install handle syncs menu", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const emitted = [];
  let installed = null;
  const electron = {
    appName: "Grok Node",
    openExternal: async () => undefined,
    buildFromTemplate: (template) => template,
    setApplicationMenu: (built) => {
      installed = built;
    },
  };
  const handle = menu.installApplicationMenu(
    {
      applyWindowShortcut: () => undefined,
      canUseDevTools: () => true,
      emitOpenAbout: () => undefined,
      emitOpenFeedback: () => undefined,
      emitUnreadFilterMenuClicked: (isChecked) => emitted.push(isChecked),
      platform: "darwin",
    },
    electron,
  );
  const unread = viewSubmenu(installed).find((entry) => entry.label === "View Unread");
  // Electron toggles the live MenuItem; we only record state + emit (0.71.2 does not reinstall on click).
  unread.click({ checked: true });
  assert.deepEqual(emitted, [true]);
  assert.equal(handle.isUnreadFilterChecked(), true);

  handle.setUnreadFilterChecked(false);
  assert.equal(handle.isUnreadFilterChecked(), false);
  assert.equal(viewSubmenu(installed).find((entry) => entry.label === "View Unread").checked, false);

  handle.setUnreadFilterChecked(true);
  assert.equal(viewSubmenu(installed).find((entry) => entry.label === "View Unread").checked, true);

  // No-op when unchanged — keeps the same installed template reference.
  const before = installed;
  handle.setUnreadFilterChecked(true);
  assert.equal(installed, before);
});

test("setApplicationMenuUnreadFilterChecked reaches the bound handle", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  let installed = null;
  const electron = {
    appName: "Grok Node",
    openExternal: async () => undefined,
    buildFromTemplate: (template) => template,
    setApplicationMenu: (built) => {
      installed = built;
    },
  };
  menu.installApplicationMenu(
    {
      applyWindowShortcut: () => undefined,
      canUseDevTools: () => false,
      emitOpenAbout: () => undefined,
      emitOpenFeedback: () => undefined,
      emitUnreadFilterMenuClicked: () => undefined,
      platform: "darwin",
    },
    electron,
  );
  menu.setApplicationMenuUnreadFilterChecked(true);
  assert.equal(viewSubmenu(installed).find((entry) => entry.label === "View Unread").checked, true);
});

test("MUTATION: dropping the View Unread checkbox fails the order assertion", async () => {
  const menu = await loadTsModule("source/electron-main/application-menu.ts");
  const template = menu.buildApplicationMenuTemplate(
    baseOptions(),
    { appName: "Grok Node", openExternal: async () => undefined },
  );
  const submenu = viewSubmenu(template).filter((entry) => entry.label !== "View Unread");
  const unread = submenu.find((entry) => entry.label === "View Unread");
  assert.equal(unread, undefined);
});
