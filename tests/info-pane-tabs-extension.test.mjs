import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { buildInfoPaneTabsRendererExtension } from "../scripts/lib/info-pane-tabs-renderer-extension.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CORE = "frontend/src/extensions/info-pane-tabs-core.ts";
const ENTRY = "frontend/src/extensions/info-pane-tabs-entry.ts";
async function loadCore() {
  const dir = await mkdtemp(path.join(tmpdir(), "tabs-core-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(REPO, CORE)],
    bundle: true,
    format: "esm",
    platform: "browser",
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
function fixtureDocument() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = [
    '<div class="sand-info-pane"><div class="sand-info-pane__inner">',
    '<div class="sand-agent-settings">',
    '<div class="identity-fields">',
    '<div class="sand-agent-identity"><span>Bot 名</span></div>',
    '<div class="name-heading">Name</div><input aria-label="Agent name" value="Bot 名">',
    '<div class="description-heading">Description</div>',
    '<textarea aria-label="Agent description">用途说明</textarea></div>',
    '<div class="sand-agent-settings__card"><span>通知开关</span></div>',
    '<div class="sand-agent-settings__card" data-r-agent-model="true"><span>模型选择</span></div>',
    '</div>',
    '<div class="routine-wrap"><span class="sand-info-pane__section-heading">例行任务</span>',
    '<ul class="sand-routine__list"><li>每日速览</li></ul></div>',
    '<section class="sand-agent-library" aria-label="资料库"><h3>资料库</h3></section>',
    '<div class="comp-wrap"><div class="sand-box-vnc-pool"></div></div>',
    '</div></div>',
  ].join("");
  return { window, document };
}
function paneOf(document) {
  return document.querySelector('[class*="sand-info-pane__inner"]');
}
function vis(document, selector) {
  const el = document.querySelector(selector);
  assert.ok(el != null, selector);
  return el.closest('[hidden]') == null;
}
test("四标签定义：顺序与文案", async () => {
  const core = await loadCore();
  assert.deepEqual(core.INFO_PANE_TABS.map((t) => t.id), ["details", "library", "computer", "other"]);
  assert.deepEqual(core.INFO_PANE_TABS.map((t) => t.label), ["详情", "资料库", "电脑", "其他"]);
  assert.equal(core.DEFAULT_TAB, "details");
  assert.ok(core.isTabId("other") && !core.isTabId("settings"));
});
test("详情页：藏资料库与电脑区及设置卡片，留身份与例行任务", async () => {
  const core = await loadCore();
  const { window, document } = fixtureDocument();
  try {
    const pane = paneOf(document);
    core.applyTab(pane, "details");
    assert.equal(pane.getAttribute("data-r-tabs-tab"), "details");
    assert.equal(vis(document, "section.sand-agent-library"), false);
    assert.equal(vis(document, ".comp-wrap"), false);
    assert.equal(document.querySelectorAll(".sand-agent-settings__card")[0].hidden, true);
    assert.equal(document.querySelectorAll(".sand-agent-settings__card")[1].hidden, true);
    assert.equal(vis(document, '[aria-label="Agent description"]'), false);
    assert.equal(vis(document, '.description-heading'), false);
    assert.equal(vis(document, '[aria-label="Agent name"]'), true);
    assert.equal(vis(document, ".sand-agent-identity"), true);
    assert.equal(vis(document, "ul.sand-routine__list"), true);
  } finally {
    window.close();
  }
});
test("资料库页：只留资料库分节", async () => {
  const core = await loadCore();
  const { window, document } = fixtureDocument();
  try {
    const pane = paneOf(document);
    core.applyTab(pane, "library");
    assert.equal(vis(document, "section.sand-agent-library"), true);
    assert.equal(vis(document, ".routine-wrap"), false);
    assert.equal(vis(document, ".comp-wrap"), false);
    assert.equal(vis(document, ".sand-agent-settings"), false);
  } finally {
    window.close();
  }
});
test("电脑页：只留电脑区", async () => {
  const core = await loadCore();
  const { window, document } = fixtureDocument();
  try {
    const pane = paneOf(document);
    core.applyTab(pane, "computer");
    assert.equal(vis(document, ".comp-wrap"), true);
    assert.equal(vis(document, ".routine-wrap"), false);
    assert.equal(vis(document, "section.sand-agent-library"), false);
    assert.equal(vis(document, ".sand-agent-settings"), false);
  } finally {
    window.close();
  }
});
test("其他页：留设置卡片与描述，藏身份兄弟节点", async () => {
  const core = await loadCore();
  const { window, document } = fixtureDocument();
  try {
    const pane = paneOf(document);
    core.applyTab(pane, "other");
    assert.equal(document.querySelectorAll(".sand-agent-settings__card")[0].hidden, false);
    assert.equal(document.querySelectorAll(".sand-agent-settings__card")[1].hidden, false);
    assert.equal(vis(document, '[aria-label="Agent description"]'), true);
    assert.equal(vis(document, '.description-heading'), true);
    assert.equal(vis(document, '[aria-label="Agent name"]'), false);
    assert.equal(vis(document, ".sand-agent-identity"), false);
    assert.equal(vis(document, ".routine-wrap"), false);
    assert.equal(vis(document, "section.sand-agent-library"), false);
    assert.equal(vis(document, ".comp-wrap"), false);
  } finally {
    window.close();
  }
});
test("缺资料 fail-soft：不刷白屏，保持当前页", async () => {
  const core = await loadCore();
  const { window, document } = fixtureDocument();
  try {
    const pane = paneOf(document);
    core.applyTab(pane, "details");
    document.querySelector("section.sand-agent-library")?.remove();
    core.applyTab(pane, "library");
    assert.equal(pane.getAttribute("data-r-tabs-tab"), "details");
    assert.equal(vis(document, ".routine-wrap"), true);
    assert.equal(vis(document, '.comp-wrap'), false);
    assert.equal(vis(document, '.description-heading'), false);
    document.querySelector(".sand-box-vnc-pool")?.remove();
    core.applyTab(pane, "computer");
    assert.equal(pane.getAttribute("data-r-tabs-tab"), "details");
    assert.equal(vis(document, ".routine-wrap"), true);
  } finally {
    window.close();
  }
});
test("入口行为：建栏一次、点击切换、非 Bot 面不建栏", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tabs-entry-"));
  const out = path.join(dir, "entry.iife.js");
  await build({
    entryPoints: [path.join(REPO, ENTRY)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  const bundle = await readFile(out, "utf8");
  const { window, document } = fixtureDocument();
  try {
    window.eval(bundle);
    assert.equal(typeof window.__sandInfoPaneTabsSync, "function");
    window.__sandInfoPaneTabsSync();
    window.__sandInfoPaneTabsSync();
    assert.equal(document.querySelectorAll("#sand-info-pane-tabs").length, 1);
    const labels = Array.from(document.querySelectorAll('#sand-info-pane-tabs [role="tab"]')).map((b) => b.textContent);
    assert.deepEqual(labels, ["详情", "资料库", "电脑", "其他"]);
    const compBtn = document.querySelector('#sand-info-pane-tabs [data-r-tab="computer"]');
    compBtn.click();
    assert.equal(paneOf(document).getAttribute("data-r-tabs-tab"), "computer");
    assert.equal(compBtn.getAttribute("aria-selected"), "true");
    assert.equal(vis(document, ".comp-wrap"), true);
    assert.equal(vis(document, ".routine-wrap"), false);
    document.querySelector(".sand-info-pane__inner").innerHTML = "<div>全局设置表单</div>";
    window.__sandInfoPaneTabsSync();
    assert.equal(document.querySelectorAll("#sand-info-pane-tabs").length, 0);
  } finally {
    window.__sandInfoPaneTabsStop?.();
    window.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("构建产物包含标签标识", async () => {
  const text = await buildInfoPaneTabsRendererExtension();
  assert.ok(text.includes("sand-info-pane-tabs"));
  assert.ok(text.includes("资料库") || text.toLowerCase().includes("8d44"));
  assert.ok(text.includes("data-r-tabs-tab"));
});
test("构建接线：router 补丁装配资料库同款扩展位", async () => {
  const source = await readFile(path.join(REPO, "scripts/lib/router-renderer-patch.mjs"), "utf8");
  assert.ok(source.includes("buildInfoPaneTabsRendererExtension"));
  assert.ok(source.includes("info-pane-tabs"));
});

async function withEntry(run) {
  const bundle = await buildInfoPaneTabsRendererExtension();
  const { window, document } = fixtureDocument();
  try {
    window.eval(bundle);
    await window.happyDOM.waitUntilComplete();
    await run({ window, document, pane: paneOf(document) });
  } finally {
    window.__sandInfoPaneTabsStop?.();
    window.close();
  }
}
function selected(document, expected) {
  assert.equal(paneOf(document).getAttribute('data-r-tabs-tab'), expected);
  const tabs = [...document.querySelectorAll('#sand-info-pane-tabs [role=tab]')];
  assert.deepEqual(tabs.filter(b => b.getAttribute('aria-selected') === 'true').map(b => b.dataset.rTab), [expected]);
  assert.deepEqual(tabs.filter(b => b.tabIndex === 0).map(b => b.dataset.rTab), [expected]);
}
for (const tab of ['library', 'computer', 'other']) {
  test(`真实 DOM mutation：点击 ${tab} 后 observer 不恢复旧标签`, async () => {
    await withEntry(async ({ window, document, pane }) => {
      document.querySelector(`[data-r-tab="${tab}"]`).click();
      selected(document, tab);
      pane.querySelector('.sand-agent-identity').append(document.createElement('span'));
      await window.happyDOM.waitUntilComplete();
      selected(document, tab);
      assert.equal(window.localStorage.getItem('sand.infoPaneTab'), tab);
    });
  });
}
for (const tab of ['details', 'library', 'computer', 'other']) {
  test(`真实 DOM mutation：${tab} 经休眠覆盖层、同构切 Bot 后保持选择和分区`, async () => {
    await withEntry(async ({ window, document, pane }) => {
      document.querySelector(`[data-r-tab="${tab}"]`).click();
      await window.happyDOM.waitUntilComplete();
      const pool = document.querySelector('.sand-box-vnc-pool');
      const library = document.querySelector('.sand-agent-library');
      const parents = [pool.parentNode, library.parentNode];
      const removed = [];
      const observer = new window.MutationObserver(records => removed.push(...records.flatMap(r => [...r.removedNodes])));
      observer.observe(pane, { childList: true, subtree: true });
      pool.innerHTML = '<div class="sleep-overlay">电脑正在休眠</div>';
      const fresh = document.querySelector('.identity-fields').cloneNode(true);
      fresh.querySelectorAll('[hidden]').forEach(el => { el.hidden = false; el.removeAttribute('data-r-tabs-hidden'); });
      document.querySelector('.identity-fields').replaceWith(fresh);
      await window.happyDOM.waitUntilComplete();
      selected(document, tab);
      assert.equal(vis(document, '.description-heading'), tab === 'other');
      assert.equal(vis(document, '.sleep-overlay'), tab === 'computer');
      assert.equal(pool.parentNode, parents[0]);
      assert.equal(library.parentNode, parents[1]);
      assert.equal(removed.some(n => n === pool || n === library || n.contains(pool) || n.contains(library)), false);
      observer.disconnect();
      const replacement = pane.cloneNode(true);
      replacement.querySelector('#sand-info-pane-tabs').remove();
      replacement.querySelectorAll('[hidden]').forEach(el => { el.hidden = false; el.removeAttribute('data-r-tabs-hidden'); });
      replacement.querySelector('[aria-label="Agent name"]').value = '另一个 Bot';
      pane.replaceWith(replacement);
      await window.happyDOM.waitUntilComplete();
      selected(document, tab);
      assert.equal(vis(document, '.description-heading'), tab === 'other');
      assert.equal(vis(document, '.sleep-overlay'), tab === 'computer');
      assert.equal(vis(document, '.sand-agent-library'), tab === 'library');
    });
  });
}
test('窄栏键盘：方向键环绕、Home/End、焦点与选中一致，mutation 后保持', async () => {
  await withEntry(async ({ window, document, pane }) => {
    pane.style.width = '180px';
    const bar = document.querySelector('#sand-info-pane-tabs');
    assert.equal(window.getComputedStyle(bar).overflowX, 'auto');
    for (const [from, key, expected] of [
      ['details', 'ArrowLeft', 'other'], ['other', 'ArrowRight', 'details'],
      ['details', 'End', 'other'], ['other', 'Home', 'details'],
      ['details', 'ArrowRight', 'library'],
    ]) {
      const btn = document.querySelector(`[data-r-tab="${from}"]`);
      btn.focus();
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      btn.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      selected(document, expected);
      assert.equal(document.activeElement.dataset.rTab, expected);
      document.body.append(document.createElement('div'));
      await window.happyDOM.waitUntilComplete();
      selected(document, expected);
    }
  });
});
test('缺失目标键盘导航保持当前页的焦点与隐藏状态', async () => {
  await withEntry(async ({ window, document }) => {
    document.querySelector('.sand-agent-library').remove();
    await window.happyDOM.waitUntilComplete();
    const btn = document.querySelector('[data-r-tab="details"]');
    btn.focus();
    btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    selected(document, 'details');
    assert.equal(document.activeElement, btn);
    assert.equal(vis(document, '.comp-wrap'), false);
  });
});
