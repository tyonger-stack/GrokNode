// 「资料库」回归守卫（frontend/src/extensions/library-core.ts + library-entry.ts）。
//
// 断言的语义全部来自官方 0.68.1 的 Wakaru 还原（docs/evidence/
// library-v2-reconstruction-20261011.md，锚点 index-ByKx0M82.js 已逐字节复核）：
// 第三组键是 "older" 不是 "earlier"；「本周」是日历午夜 6 天前不是 ISO 周或滚动
// 168h；条目四类；去重首次胜出；列表新→旧。上游 DOM 形状一改这里必须先红。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    <div class="sand-transcript">
      <div class="sand-transcript-time-separator" datetime="${new Date(2026, 8, 20).toISOString()}">9月20日</div>
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

test("入口不再安装 DOM 观察者或第二棵 React 根", async () => {
  const source = await readFile(path.join(REPO, ENTRY), "utf8");
  assert.equal(source.includes("MutationObserver"), false);
  assert.equal(source.includes("createRoot"), false);
  assert.equal(source.includes("RLibraryHost"), true);
});
