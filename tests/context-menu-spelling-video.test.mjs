import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadAvatarImages() {
  const dir = await mkdtemp(path.join(tmpdir(), "context-menu-spelling-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/media/avatar-images.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    external: ["electron"],
    logLevel: "silent",
  });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

function openMenu(mod, params, { downloadAttachment, preference = "en" } = {}) {
  const calls = { replaced: [], added: [], downloads: [] };
  let menuListener;
  let popped;
  class Menu {
    items = [];
    append(item) { this.items.push(item); }
    popup() { popped = this; }
  }
  class MenuItem { constructor(options) { Object.assign(this, options); } }
  const contents = {
    getType: () => "window",
    on: (event, listener) => { if (event === "context-menu") menuListener = listener; },
    copyImageAt() {}, undo() {}, redo() {}, cut() {}, copy() {}, paste() {}, selectAll() {},
    replaceMisspelling: (word) => calls.replaced.push(word),
    session: {
      fetch: async () => ({ ok: false }),
      addWordToSpellCheckerDictionary: (word) => { calls.added.push(word); return true; },
    },
  };
  mod.registerImageContextMenu({
    app: { on: (_event, listener) => listener({}, contents) },
    BrowserWindow: { fromWebContents: () => undefined },
    clipboard: { writeImage() {}, readImage: () => ({ isEmpty: () => true }), writeText() {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    Menu,
    MenuItem,
    nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) },
    writeFile: async () => {},
    openExternalUrl: async () => {},
    onEdgeFailure: () => {},
    language: { getPreference: () => preference, systemTags: [] },
    ...(downloadAttachment === undefined
      ? { downloadAttachment: async (p, name) => { calls.downloads.push([p, name]); return true; } }
      : downloadAttachment === null ? {} : { downloadAttachment }),
  });
  menuListener({}, {
    srcURL: "", linkURL: "", mediaType: "none", selectionText: "", isEditable: false,
    editFlags: {}, x: 0, y: 0, ...params,
  });
  const labels = (popped?.items ?? []).map((item) => item.type === "separator" ? "---" : item.label);
  const click = (label) => popped.items.find((item) => item.label === label).click();
  return { labels, click, calls };
}

test("a misspelled word in an editable field offers suggestions and Add to Dictionary before the edit block", async () => {
  const mod = await loadAvatarImages();
  const { labels, click, calls } = openMenu(mod, {
    isEditable: true,
    misspelledWord: "helo",
    dictionarySuggestions: ["hello", "help"],
    editFlags: { canUndo: true },
  });
  assert.deepEqual(labels.slice(0, 4), ["hello", "help", "Add to Dictionary", "---"]);
  assert.equal(labels[4], "Undo");
  click("help");
  click("Add to Dictionary");
  assert.deepEqual(calls.replaced, ["help"]);
  assert.deepEqual(calls.added, ["helo"]);
});

test("no spelling section without a misspelled word or outside editable fields", async () => {
  const mod = await loadAvatarImages();
  assert.ok(!openMenu(mod, { isEditable: true, misspelledWord: "", dictionarySuggestions: ["x"] }).labels.includes("Add to Dictionary"));
  assert.ok(!openMenu(mod, { isEditable: false, selectionText: "helo", misspelledWord: "helo" }).labels.includes("Add to Dictionary"));
});

test("right-clicking an attachment video offers Save video… that downloads the box path", async () => {
  const mod = await loadAvatarImages();
  const boxPath = "/home/box/sand-data/media/clip one.mp4";
  const src = "sand-media://attachment/" + encodeURIComponent(boxPath);
  const { labels, click, calls } = openMenu(mod, { mediaType: "video", srcURL: src });
  assert.deepEqual(labels, ["Save video…"]);
  click("Save video…");
  assert.deepEqual(calls.downloads, [[boxPath, "clip one.mp4"]]);
  assert.deepEqual(openMenu(mod, { mediaType: "video", srcURL: "https://example.com/a.mp4" }).labels, []);
  assert.deepEqual(openMenu(mod, { mediaType: "video", srcURL: src }, { downloadAttachment: null }).labels, []);
});

test("new menu labels use the 0.71.2 Chinese copy", async () => {
  const mod = await loadAvatarImages();
  const spelling = openMenu(mod, { isEditable: true, misspelledWord: "helo", dictionarySuggestions: [] }, { preference: "zh-CN" });
  assert.equal(spelling.labels[0], "添加到词典");
  const video = openMenu(mod, { mediaType: "video", srcURL: "sand-media://attachment/%2Fa.mp4" }, { preference: "zh-CN" });
  assert.deepEqual(video.labels, ["保存视频…"]);
});
