import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NL = String.fromCharCode(10);

// Bundle instead of `transform`: `desktop-messages.ts` imports the shared locale
// resolver by relative path, and a `data:` URL cannot resolve relative specifiers
// (ESM raises ERR_UNSUPPORTED_RESOLVE_REQUEST). esbuild bundles the graph and the
// test imports a real temp file, so the module's own imports resolve as on disk.
async function loadTsModule(relativePath) {
  const dir = await mkdtemp(path.join(tmpdir(), "i18n-desktop-messages-"));
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

function leaves(value, prefix, out) {
  for (const [key, entry] of Object.entries(value)) {
    const p = prefix.length === 0 ? key : prefix + "." + key;
    if (typeof entry === "string") out.push(p);
    else leaves(entry, p, out);
  }
  return out;
}

function atPath(value, path) {
  return path.split(".").reduce((node, key) => node[key], value);
}

test("desktop messages carry en + zh-CN for every leaf with a cited 0.59.1 id", async () => {
  const mod = await loadTsModule("source/electron-main/i18n/desktop-messages.ts");
  const enLeaves = leaves(mod.desktopMessages("en"), "", []);
  const zhLeaves = leaves(mod.desktopMessages("zh-CN"), "", []);
  assert.deepEqual([...zhLeaves].sort(), [...enLeaves].sort(), "zh-CN must mirror en keys");
  const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  for (const leaf of enLeaves) {
    const en = atPath(mod.desktopMessages("en"), leaf);
    const zh = atPath(mod.desktopMessages("zh-CN"), leaf);
    assert.ok(en.length > 0, "en empty: " + leaf);
    assert.ok(zh.length > 0, "zh empty: " + leaf);
    const id = mod.DESKTOP_MESSAGE_IDS[leaf];
    assert.ok(typeof id === "string" && id.length >= 5, "missing 0.59.1 id: " + leaf);
    for (const ch of id) assert.ok(idChars.includes(ch), "bad id char: " + id);
  }
  assert.equal(Object.keys(mod.DESKTOP_MESSAGE_IDS).length, enLeaves.length, "every leaf needs an id");
});

test("desktop locale mirror stays in lock-step with the canonical source", async () => {
  const mod = await loadTsModule("source/electron-main/i18n/desktop-messages.ts");
  const canonical = await loadTsModule("source/shared/node/i18n/locale.ts");
  const tags = [["zh-CN"], ["en-US"], ["zh-Hans"], ["fr"], []];
  for (const systemTags of tags) {
    assert.equal(
      mod.resolveDesktopLocale({ getPreference: () => "follow-system", systemTags }),
      canonical.resolveLocale("follow-system", systemTags),
    );
  }
  for (const preference of ["en", "zh-CN"]) {
    assert.equal(
      mod.resolveDesktopLocale({ getPreference: () => preference, systemTags: ["fr"] }),
      canonical.resolveLocale(preference, ["fr"]),
    );
  }
});

test("desktop message zh rows match the 0.59.1 reference wording", async () => {
  const mod = await loadTsModule("source/electron-main/i18n/desktop-messages.ts");
  const zh = mod.desktopMessages("zh-CN");
  assert.equal(zh.move.title, "将 Grok Bot 移到“应用程序”文件夹");
  assert.equal(zh.move.laterButton, "暂不");
  assert.equal(zh.move.okButton, "确定");
  assert.equal(zh.avatar.openTitle, "选择头像图片");
  assert.equal(zh.avatar.filterName, "图片");
  assert.equal(zh.attachments.errorTitle, "保存文件");
  assert.equal(zh.notification.waitingInput, "正在等待你的输入。");
  assert.equal(zh.contextMenu.undo, "撤销");
  assert.equal(zh.contextMenu.paste, "粘贴");
  assert.equal(zh.contextMenu.selectAll, "全选");
});

test("resolveDesktopLocale prefers explicit choice then system tags", async () => {
  const mod = await loadTsModule("source/electron-main/i18n/desktop-messages.ts");
  assert.equal(mod.resolveDesktopLocale({ getPreference: () => "zh-CN", systemTags: ["en-US"] }), "zh-CN");
  assert.equal(mod.resolveDesktopLocale({ getPreference: () => "en", systemTags: ["zh-CN"] }), "en");
  assert.equal(mod.resolveDesktopLocale({ getPreference: () => "follow-system", systemTags: ["zh-CN"] }), "zh-CN");
  assert.equal(mod.resolveDesktopLocale({ getPreference: () => "follow-system", systemTags: ["en-US"] }), "en");
  assert.equal(mod.resolveDesktopLocale(undefined), "en");
  assert.equal(mod.resolveDesktopLocale({}), "en");
  assert.equal(mod.desktopMessages("en").move.title, "Move Grok Bot to Applications");
});
