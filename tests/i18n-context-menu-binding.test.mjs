import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);

test("input context menu follows the live Chinese and English preference", async () => {
  const menus = [];
  let onWebContentsCreated;
  let onContextMenu;
  let preference = "zh-CN";
  class Menu {
    items = [];
    constructor() { menus.push(this); }
    append(item) { this.items.push(item); }
    popup() {}
  }
  class MenuItem {
    constructor(options) { Object.assign(this, options); }
  }
  const electron = {
    app: { on: (_name, listener) => { onWebContentsCreated = listener; } },
    BrowserWindow: { fromWebContents: () => undefined },
    clipboard: { writeImage() {}, readImage() {}, writeText() {} },
    dialog: { async showSaveDialog() { return { canceled: true }; } },
    Menu,
    MenuItem,
    nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) },
  };
  const result = await build({
    entryPoints: [path.join(root, "source/electron-main/adapters/avatar-images.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    packages: "external",
    external: ["electron"],
    write: false,
    logLevel: "silent",
  });
  const compiled = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module: compiled,
    exports: compiled.exports,
    require: (specifier) => specifier === "electron" ? electron : nativeRequire(specifier),
    Buffer,
    process,
    console,
  });
  compiled.exports.createElectronProductionImageContextMenuBinding().register({
    openExternalUrl: async () => {},
    onEdgeFailure: () => {},
    language: { getPreference: () => preference, systemTags: ["en-US"] },
  });
  const contents = {
    getType: () => "window",
    on: (_name, listener) => { onContextMenu = listener; },
    undo() {}, redo() {}, cut() {}, copy() {}, paste() {}, selectAll() {},
  };
  onWebContentsCreated({}, contents);
  const params = {
    srcURL: "", linkURL: "", mediaType: "none", selectionText: "", isEditable: true,
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    x: 0, y: 0,
  };
  onContextMenu({}, params);
  assert.deepEqual(menus.at(-1).items.map((item) => item.label), ["撤销", "重做", "剪切", "复制", "粘贴", "全选"]);
  preference = "en";
  onContextMenu({}, params);
  assert.deepEqual(menus.at(-1).items.map((item) => item.label), ["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]);
});
