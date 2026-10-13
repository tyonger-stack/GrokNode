// 「资料库」回归守卫（frontend/src/extensions/library-core.ts + library-entry.ts）。
//
// 断言的语义全部来自官方 0.68.1 的 Wakaru 还原（docs/evidence/
// library-v2-reconstruction-20261011.md，锚点 index-ByKx0M82.js 已逐字节复核）：
// 第三组键是 "older" 不是 "earlier"；「本周」是日历午夜 6 天前不是 ISO 周或滚动
// 168h；条目四类；去重首次胜出；列表新→旧。上游 DOM 形状一改这里必须先红。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CORE = "frontend/src/extensions/library-core.ts";
const ENTRY = "frontend/src/extensions/library-entry.ts";

async function loadBundled(entry) {
  const dir = await mkdtemp(path.join(tmpdir(), "library-ext-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(REPO, entry)],
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

const NOW = new Date(2026, 9, 11, 12, 0, 0); // 2026-10-11 周日 12:00
const NOW_MS = NOW.getTime();
// 午夜 6 天前 = 10-05 周一 00:00 → week 覆盖 [10-05 00:00, 10-11 00:00)
const WEEK_EDGE = new Date(2026, 9, 5, 0, 0, 0);
const WEEK_MID = new Date(2026, 9, 6);
const OLDER_EDGE = new Date(2026, 9, 4, 23, 59, 59); // 10-04 周日 23:59 → older

function fixtureDocument() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `
    <div class="sand-info-pane"><div class="sand-info-pane__inner">
      <div>Agent 概要区</div>
      <div class="sand-78zum5 sand-dt5ytf sand-2lwn1j">
        <div class="sand-mix8c7">
          <span class="sand-info-pane__section-heading" id="routines-h">例行任务</span>
          <button aria-label="Create Routine" class="sand-info-pane__section-heading-action" data-routine-row="new"></button>
        </div>
        <ul aria-labelledby="routines-h" class="sand-routine__list">
          <li><button class="sand-routine__row" data-routine-row="rt-1"><span>每日日程与待办速览</span><small>Every day at 8:00 AM</small></button></li>
        </ul>
      </div>
      <div data-sections-nav>后续分区导航（D2n 位）</div>
    </div></div>
    <!-- 生产陷阱复现：虚拟行（sand-transcript-row）含 sand-transcript 子串且排在容器前。
         入口若用子串选择器会绑到这一行，资料库永远只扫到一行 → 必红。 -->
    <div class="sand-virtual-transcript__row sand-transcript-row"><div data-role="assistant"><a href="https://example.com/trap">虚拟行里的链接（不得被采集）</a></div></div>
    <div class="sand-transcript sand-virtual-transcript__inner">
      <!-- 生产形状：日分隔条是 sand-kit-timestamp（0.68/0.70 虚拟化 transcript） -->
      <div class="sand-kit-timestamp sand-78zum5" datetime="${new Date(2026, 8, 20).toISOString()}">9月20日</div>
      <div data-role="assistant"><button role="button" aria-label="Open 旧研报.docx"><span class="sand-kit-text">2.1 MB</span></button></div>
      <div class="sand-transcript-time-separator" datetime="${OLDER_EDGE.toISOString()}">10月4日</div>
      <div data-role="assistant"><a href="https://example.com/edge-old">边界旧链接</a></div>
      <div class="sand-transcript-time-separator" datetime="${WEEK_MID.toISOString()}">10月6日</div>
      <div data-role="user"><button role="button" aria-label="Open 我发的合同.docx"><span class="sand-kit-text">88 KB</span></button></div>
      <div data-role="assistant"><a href="https://example.com/report-a">行业研报 A</a></div>
      <div data-role="assistant"><a href="https://example.com/report-a">行业研报 A（重复卡片）</a></div>
      <div class="sand-transcript-time-separator" datetime="${new Date(2026, 9, 11).toISOString()}">10月11日</div>
      <div data-role="assistant"><button role="button" aria-label="Open 今日快报.md"><span class="sand-kit-text">12 KB</span></button></div>
      <div data-role="assistant"><button aria-label="Media preview"><img src="sand-attach://chart-20261011.png"></button></div>
      <div data-role="assistant"><div class="sand-link-card"><a href="https://example.com/today">今日来源链接</a></div></div>
    </div>`;
  return { window, document };
}

test("MRe 分桶：日历午夜 6 天边界，null 一律 older", async () => {
  const core = await loadBundled(CORE);
  assert.equal(core.bucketForTimestamp(new Date(2026, 9, 11, 0, 0, 0).getTime(), NOW_MS), "today", "今天 0 点起算 today");
  assert.equal(core.bucketForTimestamp(new Date(2026, 9, 10, 23, 59, 59).getTime(), NOW_MS), "week");
  assert.equal(core.bucketForTimestamp(WEEK_EDGE.getTime(), NOW_MS), "week", "6 天前午夜恰好入 week");
  assert.equal(core.bucketForTimestamp(WEEK_EDGE.getTime() - 1, NOW_MS), "older", "6 天前午夜前一毫秒是 older");
  assert.equal(core.bucketForTimestamp(OLDER_EDGE.getTime(), NOW_MS), "older");
  assert.equal(core.bucketForTimestamp(null, NOW_MS), "older", "无时间戳不提升");
  // 夹具自检：ISO 周口径下 10-04 与 10-11 同周 —— 若实现退回 ISO 周，这条会暴露差异。
  assert.notEqual(core.bucketForTimestamp(OLDER_EDGE.getTime(), NOW_MS), "week", "10-04（同 ISO 周）必须按 6 天边界判 older");
});

test("FRe 投影：四类条目、用户侧排除、链接去重、首次胜出、新→旧", async () => {
  const core = await loadBundled(CORE);
  const { window, document } = fixtureDocument();
  try {
    const items = core.collectLibraryItems(document.querySelector(".sand-transcript"));
    assert.equal(items.length, 6, `条目数: ${items.length}（旧研报 + 边界旧链接 + 研报A×1 + 快报 + 图片 + 今日链接；用户合同排除）`);
    const kinds = items.map((item) => item.kind);
    assert.deepEqual(kinds, ["link", "image", "file", "link", "link", "file"], `新→旧顺序与四类: ${JSON.stringify(kinds)}`);
    const reportLinks = items.filter((item) => item.kind === "link" && item.url === "https://example.com/report-a");
    assert.equal(reportLinks.length, 1, "重复 href 只留一条（首次出现胜出）");
    const groups = core.groupLibraryItems(items, NOW_MS);
    assert.deepEqual(groups.today.map((item) => core.itemLabel(item)), ["https://example.com/today", "chart-20261011.png", "今日快报.md"]);
    assert.deepEqual(groups.week.map((item) => core.itemLabel(item)), ["https://example.com/report-a"]);
    assert.deepEqual(groups.older.map((item) => core.itemLabel(item)), ["https://example.com/edge-old", "旧研报.docx"]);
  } finally {
    window.close();
  }
});

test("外壳行为：挂载例行任务正下方、分组标题、点击回放芯片（IIFE + happy-dom）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "library-entry-"));
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
  const { window, document } = fixtureDocument();
  // 冻结 window 时钟到夹具设计时间：入口 sync() 内部用真实 Date.now() 分桶，不冻结的话
  // 夹具的 10-11 日期随现实日期滑出「今天」组，断言必然过期变红（跨日时间炸弹）。
  window.eval(`(() => { const RealDate = window.Date; const FIXED = ${NOW_MS};
    class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [FIXED])); } static now() { return FIXED; } }
    window.Date = FixedDate; })();`);
  let clickedLabel = null;
  document.querySelectorAll('[role="button"][aria-label^="Open "], button[aria-label="Media preview"]').forEach((chip) => {
    chip.addEventListener("click", () => { clickedLabel = chip.getAttribute("aria-label"); });
  });
  const bundle = await (await import("node:fs/promises")).readFile(out, "utf8");
  window.eval(bundle);
  try {
    assert.equal(typeof window.__sandLibrarySync, "function", "入口应暴露同步钩子");
    window.__sandLibrarySync();
    const section = document.querySelector(".sand-info-pane__inner")?.querySelector("section.sand-agent-library");
    assert.ok(section != null, "资料库分节未挂载进 info-pane");
    // 位置：例行任务分区容器（含 sand-routine__list）的正下一个兄弟，且在尾部分区导航之前。
    const routineSection = document.querySelector("ul.sand-routine__list").parentElement;
    assert.equal(section.previousElementSibling, routineSection, "资料库必须紧跟例行任务分区");
    assert.equal(section.nextElementSibling?.getAttribute("data-sections-nav"), "", "资料库插在尾部分区导航之前，不是 pane 末尾");
    assert.equal(document.querySelector(".sand-info-pane__inner").lastElementChild.getAttribute("data-sections-nav"), "", "pane 末尾仍是原尾部分区");
    // 幂等：再同步一轮不产生第二份（类选择器按 token 匹配，__row 行不计入）。
    window.__sandLibrarySync();
    assert.equal(document.querySelectorAll("section.sand-agent-library").length, 1, "重复同步不得产生重复分节");
    const rows = [...section.querySelectorAll("[data-library-item]")];
    assert.equal(rows.length, 6, `条目数不对: ${rows.length}`);
    const groupTitles = [...section.querySelectorAll("section[aria-label]")].map((el) => el.getAttribute("aria-label"));
    assert.deepEqual(groupTitles, ["今天", "本周", "更早"], `分组标题: ${JSON.stringify(groupTitles)}`);
    const mdRow = rows.find((row) => row.getAttribute("data-library-kind") === "file" && row.textContent.includes("今日快报.md"));
    assert.ok(mdRow != null);
    mdRow.click();
    assert.equal(clickedLabel, "Open 今日快报.md", "点击资料库条目应回放对应芯片点击");
    routineSection.innerHTML = '<div data-empty-routine-root><p class="sand-routine__empty">例行任务是这个智能体按计划重复执行的任务。</p><button data-routine-row="new">创建例行任务</button></div>';
    window.__sandLibrarySync();
    const emptyRoot = document.querySelector('[data-empty-routine-root]');
    const emptyLibrary = document.querySelector('section.sand-agent-library');
    assert.ok(emptyLibrary.previousElementSibling === emptyRoot, "空态资料库必须紧跟真实p节点的容器");
    assert.ok(emptyLibrary.parentElement === routineSection, "空态不能回退到pane末尾");
  } finally {
    // 先断观察者再关窗：断言中途抛错或正常结束时都不能漏 —— 关窗后送达的观察者回调
    // 会在死 window 上重建定时器，拽住 node --test 子进程不退出（表现为整文件挂起）。
    window.__sandLibraryStop?.();
    window.close();
    await rm(dir, { recursive: true, force: true });
  }
});
