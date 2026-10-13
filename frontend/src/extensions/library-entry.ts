// 「资料库」DOM 外壳：把 library-core 投影出的条目渲染进 bot 资料面板（info-pane）。
//
// 挂载位置：例行任务分区（Routines）正下方 —— 锚点是例行列本身的稳定标记
// （ul.sand-routine__list / div.sand-routine__empty 的父容器 = 分区容器），标题文案
// 与 aria-label 均随 locale 变化、不可作锚点；例行任务不渲染的表面回退 pane 末尾。
// 生命周期与 channel-status / webhook-credential 同款：追加到 pinned renderer chunk
// 的 IIFE，自管容器 + MutationObserver —— React 重渲染冲掉节点时下一轮巡检原位
// 重建；面板关闭时节点随面板消失，不留孤儿。
//
// 视图语义对齐官方 0.68.1（见 library-core.ts 头注锚点）：分组 今天/本周/更早、
// 新→旧排序、每组渐进揭示 24 条（$S @1581400）、四类条目（image/video/file/link）。
// 样式沿用 0.18 的 sand-* 色板，不自造新色。

import {
  BUCKET_LABELS,
  LIBRARY_GROUP_ORDER,
  LIBRARY_REVEAL_PAGE_SIZE,
  collectLibraryItems,
  formatWhen,
  groupLibraryItems,
  itemLabel,
  type LibraryBucket,
  type LibraryItem
} from "./library-core.js";

const SECTION_CLASS = "sand-agent-library";
const PANE_SELECTOR = '[class*="sand-info-pane__inner"]';
// ⚠️ 必须精确 token 匹配虚拟化容器 `.sand-virtual-transcript__inner`，不能用
// `[class*="sand-transcript"]` 子串 —— 生产 DOM 里每个虚拟行（sand-transcript-row）
// 都含该子串，querySelector 会把第一行当根，资料库永远只扫到一行（2026-10-13 活体
// 实测踩中）。`.sand-transcript` 精确 token 兜底给测试夹具用的旧容器形状。
// 注意：虚拟化只挂载可视窗口附近的行，资料库聚合的是「已挂载」的消息 —— 更早的
// 附件滚动加载后才进组（DOM 聚合的固有限制，见证据文档 §9 接缝声明）。
const TRANSCRIPT_SELECTOR = ".sand-virtual-transcript__inner, .sand-transcript";
// 例行任务列表根（K2n 输出）：非空 = ul.sand-routine__list，空态 = p.sand-routine__empty；
// 其父容器即「例行任务」分区容器（标题行 + 列表），类名是 styled-div 无稳定标记，故从子锚点回溯。
const ROUTINE_LIST_SELECTOR = "ul.sand-routine__list, .sand-routine__empty";

const KIND_GLYPH: Readonly<Record<LibraryItem["kind"], string>> = { image: "▧", video: "▶", file: "▤", link: "⛓" };

interface DesktopBridge {
  openExternal?(url: string): Promise<void>;
}

function transcriptRoot(): ParentNode {
  return document.querySelector(TRANSCRIPT_SELECTOR) ?? document.body;
}

function styleOf(styles: Partial<CSSStyleDeclaration>): Partial<CSSStyleDeclaration> {
  return styles;
}

function itemRow(item: LibraryItem, nowMs: number, onOpen: (item: LibraryItem) => void): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `${SECTION_CLASS}__row`;
  row.setAttribute("data-library-item", item.id);
  row.setAttribute("data-library-kind", item.kind);
  row.setAttribute("aria-label", `打开 ${itemLabel(item)}`);
  Object.assign(row.style, styleOf({
    alignItems: "center",
    background: "transparent",
    border: "none",
    borderRadius: "8px",
    color: "#d9ded4",
    cursor: "pointer",
    display: "flex",
    gap: "8px",
    padding: "5px 6px",
    textAlign: "left",
    width: "100%",
  }));
  const glyph = document.createElement("span");
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = KIND_GLYPH[item.kind];
  Object.assign(glyph.style, styleOf({ flex: "0 0 16px", opacity: "0.8", textAlign: "center" }));
  const text = document.createElement("span");
  Object.assign(text.style, styleOf({ display: "flex", flex: "1 1 auto", flexDirection: "column", minWidth: "0" }));
  const name = document.createElement("span");
  name.textContent = itemLabel(item);
  Object.assign(name.style, styleOf({ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }));
  const meta = document.createElement("span");
  meta.textContent = formatWhen(item.timestampMs, nowMs);
  Object.assign(meta.style, styleOf({ color: "#858d80", fontSize: "10px" }));
  text.append(name, meta);
  row.append(glyph, text);
  row.title = itemLabel(item);
  row.addEventListener("click", () => onOpen(item));
  return row;
}

function groupSection(bucket: LibraryBucket, items: readonly LibraryItem[], nowMs: number, onOpen: (item: LibraryItem) => void): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("aria-label", BUCKET_LABELS[bucket]);
  const header = document.createElement("div");
  Object.assign(header.style, styleOf({ alignItems: "baseline", color: "#858d80", display: "flex", fontSize: "10px", fontWeight: "600", gap: "6px", letterSpacing: "0.04em", margin: "10px 0 4px", textTransform: "uppercase" }));
  const label = document.createElement("span");
  label.textContent = BUCKET_LABELS[bucket];
  const count = document.createElement("span");
  count.textContent = `· ${items.length}`;
  header.append(label, count);
  section.append(header);

  // `f_`/`m_`（提取区间外）的揭示分页语义：每批 LIBRARY_REVEAL_PAGE_SIZE 条。
  const list = document.createElement("div");
  let revealed = Math.min(LIBRARY_REVEAL_PAGE_SIZE, items.length);
  const more = document.createElement("button");
  more.type = "button";
  Object.assign(more.style, styleOf({ background: "transparent", border: "none", color: "#a9c85d", cursor: "pointer", fontSize: "11px", padding: "4px 6px", textAlign: "left", width: "100%" }));
  more.addEventListener("click", () => {
    revealed = Math.min(revealed + LIBRARY_REVEAL_PAGE_SIZE, items.length);
    paint();
  });
  const paint = (): void => {
    list.replaceChildren();
    for (const item of items.slice(0, revealed)) list.append(itemRow(item, nowMs, onOpen));
    more.hidden = revealed >= items.length;
    if (!more.hidden) more.textContent = `显示更多（${items.length - revealed}）`;
  };
  section.append(list, more);
  paint();
  return section;
}

function onOpenItem(item: LibraryItem): void {
  if (item.kind === "link") {
    const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
    if (desktop?.openExternal != null) void desktop.openExternal(item.url).catch(() => {});
    else window.open(item.url, "_blank", "noopener");
    return;
  }
  if (item.kind === "image" || item.kind === "video") {
    // 视觉条目：回放对应媒体芯片（TranscriptAttachmentGallery 灯箱）。
    const chip = item.kind === "video"
      ? transcriptRoot().querySelector(`[aria-label="Media preview"] video[src="${CSS.escape(item.source)}"]`)?.closest('button[aria-label="Media preview"]')
      : transcriptRoot().querySelector(`[aria-label="Media preview"] img[src="${CSS.escape(item.source)}"]`)?.closest('button[aria-label="Media preview"]');
    (chip as HTMLElement | null)?.click();
    return;
  }
  // 文件：回放对应芯片点击 —— 走上游既有的查看器（PDF/DOCX/文本/媒体）。
  const chip = transcriptRoot().querySelector(`[role="button"][aria-label="Open ${item.name}"]`);
  (chip as HTMLElement | null)?.click();
}

function renderSection(items: readonly LibraryItem[], nowMs: number): HTMLElement {
  const groups = groupLibraryItems(items, nowMs);
  const section = document.createElement("section");
  section.className = SECTION_CLASS;
  section.setAttribute("aria-label", "资料库");
  Object.assign(section.style, styleOf({ borderTop: "1px solid #343832", color: "#d9ded4", fontSize: "12px", marginTop: "8px", padding: "10px 2px 2px" }));

  const title = document.createElement("h3");
  title.textContent = "资料库";
  Object.assign(title.style, styleOf({ fontSize: "12px", fontWeight: "600", letterSpacing: "0.02em", margin: "0 0 2px", color: "#eef3e7" }));
  section.append(title);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "这个 Bot 还没有发过文件或链接";
    Object.assign(empty.style, styleOf({ color: "#858d80", margin: "4px 0 0" }));
    section.append(empty);
    return section;
  }

  const note = document.createElement("p");
  note.textContent = `Bot 发给你的文件与链接 · ${items.length} 项`;
  Object.assign(note.style, styleOf({ color: "#858d80", margin: "0 0 4px" }));
  section.append(note);

  for (const bucket of LIBRARY_GROUP_ORDER) {
    if (groups[bucket].length === 0) continue;
    section.append(groupSection(bucket, groups[bucket], nowMs, onOpenItem));
  }
  return section;
}

let scheduled = false;
function scheduleSync(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    try {
      sync();
    } catch {
      /* 面板瞬态不完整时下一轮巡检自愈 */
    }
  }, 300);
}

let lastSignature: string | null = null;
function sync(): void {
  const pane = document.querySelector(PANE_SELECTOR);
  const routineSection = document.querySelector(ROUTINE_LIST_SELECTOR)?.parentElement ?? null;
  // 主位：例行任务分区容器的下一个兄弟位（= 例行任务正下方）；例行任务不在时挂 pane 末尾。
  const host = routineSection?.parentElement ?? pane;
  if (host == null) return;
  const nowMs = Date.now();
  const items = collectLibraryItems(transcriptRoot());
  // 签名守卫：条目集与挂载位不变且分节仍在位时跳过重建。否则「删除+重建」会触发
  // 自身观察者，形成 300ms 自持循环，且把「显示更多」的揭示进度每 300ms 回滚一次。
  // 相对时间标签按分钟取整进签名，既止住循环又不冻结「刚刚/N 分钟前」的刷新。
  const signature = `${routineSection != null ? "r" : "p"}|${Math.floor(nowMs / 60_000)}|${items.map((item) => `${item.id}@${item.timestampMs ?? ""}`).join(",")}`;
  const existing = host.querySelector(`:scope > .${SECTION_CLASS}`);
  if (signature === lastSignature && existing != null && (routineSection == null || existing.previousElementSibling === routineSection)) return;
  lastSignature = signature;
  // 类选择器按 token 匹配，只清分节本身，不误伤 `SECTION_CLASS__row` 行。
  document.querySelectorAll(`.${SECTION_CLASS}`).forEach((node) => { node.remove(); });
  host.insertBefore(renderSection(items, nowMs), routineSection?.nextSibling ?? null);
}

const observer = new MutationObserver(scheduleSync);
observer.observe(document.body, { childList: true, subtree: true });
scheduleSync();

// 测试与诊断钩子：__sandLibrarySync 绕过防抖直接同步一轮；__sandLibraryStop 断开
// 观察者（tests/library-extension.test.mjs 在 happy-dom 里必须先停观察者再关窗，
// 否则关窗后送达的观察者回调会在死 window 上再建定时器，拽住测试进程不退出）。
const testHooks = globalThis as unknown as { __sandLibrarySync?: () => void; __sandLibraryStop?: () => void };
testHooks.__sandLibrarySync = sync;
testHooks.__sandLibraryStop = () => { observer.disconnect(); };
