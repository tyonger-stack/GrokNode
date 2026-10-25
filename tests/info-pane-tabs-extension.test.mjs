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
    '<div data-r-info-pane-hero=""><div data-r-hero-text=""><input aria-label="Agent name" value="Bot 名"></div></div>',
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
function detailLayoutDocument() {
  const window = new Window();
  window.document.documentElement.setAttribute("data-theme", "cursor-dark");
  window.document.body.innerHTML = [
    '<div class="sand-info-pane"><div class="sand-info-pane__inner">',
    '<div class="ui-scroll-area__content"><div class="detail-content">',
    '<div data-r-info-pane-hero=""><div data-r-hero-text=""><input aria-label="Agent name" value="Bot 名"><input aria-label="Agent title" value="添加标签"></div></div>',
    '<ul class="sand-routine__list"><li>每日速览</li></ul>',
    '</div></div></div></div>',
  ].join("");
  return { window, document: window.document };
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
    assert.equal(vis(document, ".sand-agent-settings"), false);
    assert.equal(vis(document, "[data-r-info-pane-hero]"), true);
    assert.equal(vis(document, ".sand-agent-identity"), false);
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
    assert.equal(vis(document, "[data-r-info-pane-hero]"), true);
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
    assert.equal(vis(document, "[data-r-info-pane-hero]"), true);
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
    assert.equal(vis(document, ".sand-agent-settings"), true);
    assert.equal(vis(document, "[data-r-info-pane-hero]"), true);
    assert.ok(document.querySelector('.sand-agent-settings [aria-label="Agent name"]').closest("[hidden]") != null);
    assert.equal(vis(document, ".sand-agent-identity"), true);
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
    assert.equal(document.querySelector("#sand-info-pane-tabs").previousElementSibling?.getAttribute("data-r-info-pane-hero"), "");
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
test("应用卡片在右栏挂载前请求电脑页，挂载后保留目标标签", async () => {
  const bundle = await buildInfoPaneTabsRendererExtension();
  const { window, document } = fixtureDocument();
  const pane = paneOf(document);
  pane.parentElement.remove();
  try {
    window.eval(bundle);
    window.dispatchEvent(new window.CustomEvent('grok-node-info-pane-tab', { detail: 'computer' }));
    document.body.append(pane);
    window.__sandInfoPaneTabsSync();
    assert.equal(pane.getAttribute('data-r-tabs-tab'), 'computer');
    assert.equal(vis(document, '.comp-wrap'), true);
    assert.equal(vis(document, '.routine-wrap'), false);
  } finally {
    window.__sandInfoPaneTabsStop?.();
    window.close();
  }
});

test("切 Bot 的 DOM 提交在下一帧前完成分区，不暴露旧右栏", async () => {
  const bundle = await buildInfoPaneTabsRendererExtension();
  const { window, document } = fixtureDocument();
  const pane = paneOf(document);
  try {
    window.eval(bundle);
    await Promise.resolve();
    document.querySelector('#sand-info-pane-tabs [data-r-tab="other"]').click();

    const replacement = pane.cloneNode(true);
    replacement.querySelector('#sand-info-pane-tabs').remove();
    replacement.querySelectorAll('[hidden]').forEach((element) => {
      element.hidden = false;
      element.removeAttribute('data-r-tabs-hidden');
    });
    replacement.querySelector('[aria-label="Agent name"]').value = '另一个 Bot';
    pane.replaceWith(replacement);

    await Promise.resolve();
    assert.ok(replacement.querySelector('#sand-info-pane-tabs'));
    assert.equal(replacement.getAttribute('data-r-tabs-tab'), 'other');
    assert.equal(vis(document, '.description-heading'), true);
    assert.equal(vis(document, '.routine-wrap'), false);
  } finally {
    window.__sandInfoPaneTabsStop?.();
    window.close();
  }
});

test("构建产物包含标签标识", async () => {
  const text = await buildInfoPaneTabsRendererExtension();
  assert.ok(text.includes("sand-info-pane-tabs"));
  assert.ok(text.includes("资料库") || text.toLowerCase().includes("8d44"));
  assert.ok(text.includes("data-r-tabs-tab"));
});
test("身份区标签：空 title 仍渲染 Add a label / 添加标签（对齐官方 Pq+d85lwh）", async () => {
  const source = await readFile(path.join(REPO, "scripts/lib/info-pane-tabs-renderer-extension.mjs"), "utf8");
  assert.ok(source.includes('YCe(t)?p.jsx(Uwe,{ariaLabel:"Agent title"'), "hero must gate on YCe like official o6");
  assert.ok(source.includes('RLocT("Add a label","添加标签")'), "hero placeholder must be official d85lwh");
  assert.equal(source.includes("t.title&&t.title.trim().length>0?p.jsx(Uwe,{ariaLabel:\"Agent title\""), false, "must not hide empty titles");
  const entry = await readFile(path.join(REPO, ENTRY), "utf8");
  assert.ok(entry.includes("[aria-label=\"Agent title\"]::placeholder"), "empty-label tertiary placeholder style");
  assert.ok(source.includes('className:"sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-h8yej3",style:{gap:"16px",padding:"0 0 12px"'),
    "hero must retain the shipped single-layer vertical rhythm");
  assert.ok(entry.includes('margin:0 -16px 10px;padding:4px 16px 10px'),
    "tab strip must keep the 0.75.8 tabpanel's 10px below-bar chrome (sand-889kno)");
  assert.ok(entry.includes('--cursor-bg-editor:#121212'),
    "details pane must resolve its recovered background token to the shipped chrome color");
});
test("详情栏顶部：宽度控件与 0.75.5 正式版计算样式一致", async () => {
  const bundle = await buildInfoPaneTabsRendererExtension();
  const { window, document } = detailLayoutDocument();
  try {
    window.eval(bundle);
    await window.happyDOM.waitUntilComplete();
    const pane = paneOf(document);
    const content = document.querySelector(".detail-content");
    const hero = document.querySelector("[data-r-info-pane-hero]");
    const name = document.querySelector('[aria-label="Agent name"]');
    const title = document.querySelector('[aria-label="Agent title"]');
    const styleOf = (element) => window.getComputedStyle(element);
    assert.equal(styleOf(content).paddingTop, "0px");
    assert.equal(styleOf(content).gap, "0");
    assert.equal(styleOf(hero).marginTop, "0px");
    assert.equal(styleOf(hero).paddingTop, "8px");
    assert.equal(styleOf(name).height, "29px");
    assert.equal(styleOf(name).fontSize, "17px");
    assert.equal(styleOf(name).lineHeight, "24px");
    assert.equal(styleOf(title).height, "18px");
    assert.equal(styleOf(title).fontSize, "11px");
    assert.equal(styleOf(title).lineHeight, "16px");
    assert.equal(styleOf(title).padding, "0px 4px");
    assert.equal(styleOf(pane).getPropertyValue("--cursor-bg-editor"), "#121212");
  } finally {
    window.__sandInfoPaneTabsStop?.();
    window.close();
  }
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
    assert.equal(window.getComputedStyle(bar).position, 'sticky');
    assert.equal(window.getComputedStyle(bar).justifyContent, 'center');
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
test('群聊显示正式的详情、资料库、成员标签，成员页只露出成员列表，私聊选择独立保留', async () => {
  await withEntry(async ({ window, document, pane }) => {
    document.querySelector('[data-r-tab="other"]').click();
    const overview = document.createElement('div');
    overview.setAttribute('data-r-info-pane-overview', 'project-group');
    overview.setAttribute('data-r-info-pane-group', '1');
    for (const child of [...pane.children]) if (child.id !== 'sand-info-pane-tabs') overview.append(child);
    const members = document.createElement('div');
    members.className = 'sand-group-members-section';
    members.innerHTML = '<ul class="sand-group-members-list"><li><button>红色 Bot</button></li><li><button>青色 Bot</button></li></ul>';
    overview.append(members);
    pane.append(overview);
    await window.happyDOM.waitUntilComplete();
    const tabIds = () => [...document.querySelectorAll('#sand-info-pane-tabs [role=tab]')].map((button) => button.dataset.rTab);
    assert.deepEqual(tabIds(), ['details', 'library', 'members']);
    selected(document, 'details');
    assert.equal(vis(document, '.sand-group-members-list'), false);
    document.querySelector('[data-r-tab="members"]').click();
    selected(document, 'members');
    assert.equal(vis(document, '.sand-group-members-list'), true);
    assert.equal(vis(document, '.routine-wrap'), false);
    assert.equal(vis(document, '.comp-wrap'), false);
    assert.equal(vis(document, '.sand-agent-settings'), false);
    assert.equal(window.localStorage.getItem('sand.groupInfoPaneTab'), 'members');
    assert.equal(window.localStorage.getItem('sand.infoPaneTab'), 'other');
    overview.setAttribute('data-r-info-pane-group', '0');
    members.remove();
    window.__sandInfoPaneTabsSync();
    assert.deepEqual(tabIds(), ['details', 'library', 'computer', 'other']);
    selected(document, 'other');
  });
});
