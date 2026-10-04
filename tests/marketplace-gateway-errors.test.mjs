import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Requirement C — 「host gateway 不可达时显式报错」 — had NO guard at all. The greps that look
 * like coverage are other subsystems: `attachment-media-store-read.test.mjs` and the
 * `"unreachable"` probe value in `box-startup-cancellation.test.mjs`. Nothing exercised this
 * page's own failure paths, so a change that replaced `catalogError` with a silent empty catalog
 * would have shipped green — and the symptom is the worst kind: a marketplace that looks like a
 * correct answer.
 *
 * This drives the REAL `createMarketplaceController` against a bridge whose every call rejects,
 * and asserts the rendered tree. The distinction that matters throughout: an unreachable host must
 * read differently from a successful read that returned nothing. Only the second one is entitled
 * to render an empty state.
 */

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function loadEntry(entry, outName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
  });
  return import(pathToFileURL(outfile).href);
}

const CTRL = await loadEntry(
  "frontend/src/extensions/marketplace/index.ts",
  "tests-mkt-gateway-errors.mjs",
);

const SWAPPED = [
  "window", "document", "navigator", "HTMLElement", "Node", "Event", "CustomEvent",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
];

/** Open the marketplace for real, with `desktop` stubbed onto the window. Returns the live dialog
 *  root so the assertions read the DOM the user would see, not a state object. */
async function openWith(desktop) {
  const win = new Window({ url: "file:///renderer/index.html" });
  const prior = SWAPPED.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const put = (key, value) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
  put("window", win);
  win.desktop = desktop;
  for (const key of SWAPPED) {
    if (key === "window") continue;
    const v = win[key];
    if (v !== undefined) put(key, v);
  }
  const controller = CTRL.createMarketplaceController();
  try {
    await controller.open();
  } catch (e) {
    restore(prior);
    throw e;
  }
  const restore = (list = prior) => {
    for (const [key, desc] of list) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  return {
    root: win.document.querySelector("body > *"),
    doc: win.document,
    controller,
    text: String(win.document.body.textContent ?? "").replace(/\s+/g, " "),
    close() { try { controller.close(); } finally { restore(); } },
  };
}

const rejecting = (reason) => ({
  catalog: () => Promise.reject(reason),
  list: () => Promise.reject(reason),
  teamPopularity: () => Promise.reject(reason),
});
const okSkills = { list: () => Promise.resolve({ ok: true, records: [] }) };
const agent = { getMainAgent: () => Promise.resolve("main-1") };

/** A catalog with one real entry, so "the page rendered fine" is a state this file can tell apart
 *  from "the page rendered an error". */
const oneEntry = [{
  id: "gmail", name: "gmail", displayName: "Gmail", description: "Gmail 简介",
  category: "productivity", iconUrl: "", connectors: [{ name: "ahrefs", description: "" }],
  skills: [], fields: [], publisher: "Cursor", publisherDomain: "cursor.com", tags: [],
}];

test("a catalog failure is stated, not rendered as an empty marketplace", async () => {
  const h = await openWith({ mcp: rejecting(new Error("gateway unreachable")), skills: okSkills, agent });
  try {
    assert.ok(h.text.includes("无法加载市场目录"), "the catalog failure is on screen");
    assert.ok(h.text.includes("gateway unreachable"), "with the underlying reason, not a bare label");
    // The specific failure this guards: an empty marketplace reads as "this account has no
    // plugins", which is a correct-looking answer to a question nobody asked.
    for (const section of ["为你推荐", "精选插件", "团队插件"]) {
      assert.equal(h.text.includes(section), false, `${section} must not be rendered over a failed read`);
    }
  } finally { h.close(); }
});

test("a healthy catalog still renders its sections — the guard above is not just always-on", async () => {
  // A test that only ever sees the error path cannot distinguish "reports failures" from
  // "reports failures and nothing else ever works".
  const h = await openWith({
    mcp: { catalog: () => Promise.resolve(oneEntry), list: () => Promise.resolve({ servers: [] }), teamPopularity: () => Promise.resolve({}) },
    skills: okSkills,
    agent,
  });
  try {
    assert.equal(h.text.includes("无法加载市场目录"), false, "a healthy read shows no error");
    assert.ok(h.text.includes("Gmail"), "and the catalog actually rendered");
  } finally { h.close(); }
});

/** Reach 页 2 the way the dock does — the 已安装 N 个 › band — because `openManage` is not on the
 *  controller's public surface. Asserts the band exists FIRST: a fixture that never reached 页 2
 *  would otherwise "pass" a check that nothing rendered at all. */
async function openManagePage(desktop) {
  const h = await openWith(desktop);
  const band = [...h.root.querySelectorAll("button")].find((b) => /已安装 \d+ 个/.test(b.textContent ?? ""));
  assert.ok(band, "the 已安装 band that opens 页 2 is present");
  band.dispatchEvent(new h.doc.defaultView.Event("click"));
  return { ...h, text: String(h.doc.body.textContent ?? "").replace(/\s+/g, " ") };
}

const healthyMcp = (servers = []) => ({
  catalog: () => Promise.resolve(oneEntry),
  list: () => Promise.resolve({ servers }),
  teamPopularity: () => Promise.resolve({}),
});

test("a missing skills bridge is reported instead of rendering 「你没有私有技能」", async () => {
  const h = await openManagePage({ mcp: healthyMcp(), agent });
  try {
    assert.ok(h.text.includes("私有技能桥接不可用"), "a missing bridge is named on screen");
    assert.equal(h.text.includes("没有私有技能"), false, "and NOT rendered as the no-skills empty state");
  } finally { h.close(); }
});

test("an unreachable gateway degrades 私有技能 ALONE — the rest of 页 2 survives", async () => {
  const h = await openManagePage({
    mcp: healthyMcp([{ id: "gmail", name: "gmail", status: "已连接", toolCount: 23, accountKey: "default" }]),
    // The bridge contract says this never rejects; a throw is treated as unreachable rather than
    // as an empty result.
    skills: { list: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:8765")) },
    agent,
  });
  try {
    assert.ok(h.text.includes("无法连接本地运行环境"), "the unreachable host is stated");
    assert.ok(h.text.includes("ECONNREFUSED"), "with the transport detail");
    // Degradation is the whole point: a stopped box must not take the page down with it.
    assert.ok(h.text.includes("Gmail"), "the 已安装 section still renders");
    assert.ok(h.text.includes("私有技能"), "and so does the section header — with the error inside it");
  } finally { h.close(); }
});

test("a contract-level gateway error is reported with the same wording as a throw", async () => {
  // `list()` returns a discriminated union and never rejects, so the honest reading of
  // `{ ok: false, error: { code } }` is the same failure the throw path models. If the two
  // drifted apart, one of them would render an empty section that looks like an answer.
  const h = await openManagePage({
    mcp: healthyMcp([{ id: "gmail", name: "gmail", status: "已连接", toolCount: 23, accountKey: "default" }]),
    skills: { list: () => Promise.resolve({ ok: false, error: { code: "gateway-unreachable", message: "host is down" } }) },
    agent,
  });
  try {
    assert.ok(h.text.includes("无法连接本地运行环境"), "the same wording as the throw path");
    assert.ok(h.text.includes("host is down"), "carrying the host's own message");
  } finally { h.close(); }
});

test("a genuinely empty read is still entitled to the empty state", async () => {
  // The mirror of the whole file. Without this, the obvious way to "fix" requirement C — always
  // render an error instead of an empty section — would pass every test above.
  const h = await openManagePage({ mcp: healthyMcp(), skills: okSkills, agent });
  try {
    assert.equal(h.text.includes("无法连接本地运行环境"), false, "a successful empty read is not an error");
    assert.equal(h.text.includes("私有技能桥接不可用"), false, "and the bridge was present");
    assert.ok(h.text.includes("私有技能"), "the section is there — with the honest empty state");
  } finally { h.close(); }
});
