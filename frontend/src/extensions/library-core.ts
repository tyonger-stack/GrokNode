// 「文档库」数据层 —— 官方 0.68.1 Library 语义的 DOM 适配实现。
//
// 语义来源（2026-10-11 用 Wakaru 1.14.0 从官方 bundle 还原，锚点已逐字节复核，
// 还原记录全文见 docs/evidence/library-v2-reconstruction-20261011.md）：
//   asar/0.68.1/dist/renderer/assets/index-ByKx0M82.js，特性开关 grok_bot_library_v2
//     · RRe @1579209  分组键与展示顺序 = ["today","week","older"]（是 older 不是 earlier）
//     · ERe @1579238  「本周」窗口 = 7 天
//     · PS  @1579315  日历午夜边界：PS(now, daysBack) = 本地时区往前 daysBack 天的 0 点
//     · MRe @1579345  bucketFor：null→older；≥PS(now,0)→today；≥PS(now,6)→week；否则 older
//                      —— 是日历午夜 6 天前，不是滚动 168h，也不是 ISO 自然周
//     · TS  @1579197  v1 媒体揭示每批 5 条（oG y+TS）；OS @1594610 v1 页面每批 5 条；
//       c7（E mUe=5 经 w6 as c7）v2 每批 5 条；$S=24 @1582225 是缩略图尺寸 px
//      （height:$S,width:$S），不是揭示条数
//     · FRe @1581347  transcript→items 投影：三类抽取（视觉/文件/链接）、
//                      kind 前缀去重 Set 跨全量共享、首次出现胜出、结果 toReversed()（新→旧）
//
// 与还原版的边界差异（刻意记录）：
//   1. 数据源：官方从 transcript store（kk(agentId)）拿结构化 entries；0.18 基线没有
//      该 store 的桥面，本实现从会话 DOM 采集（形状均为 0.18 chunk 实测）：
//        文件芯片  [role="button"][aria-label^="Open "]
//        媒体芯片  [aria-label="Media preview"]（img/video 缩略）
//        链接卡片  a[href^="http"]
//        日分隔符  [class*="sand-transcript-time-separator"]（datetime 优先）
//      —— 只覆盖已加载 DOM；接 host 侧 listAgentDocuments 时换数据源即可。
//   2. 归属三分法的 DOM 近似：官方是 bot/user-upload/returned-artifact 三路 + 逐 source
//      防洗白（RS）；DOM 侧以 data-role="user" 判 user-upload，returned-artifact 探测
//      （sae）在提取区间之外、无 DOM 等价物，归并为 bot。
//   3. 视觉条目（image/video）的时间粒度同样来自日分隔符（官方为逐 entry timestampMs）。

export type LibraryBucket = "today" | "week" | "older";

export interface LibraryItemBase {
  /** `${序号}:${kind}:${source}` —— 一条消息可产出多个条目。 */
  readonly id: string;
  readonly timestampMs: number | null;
}

export interface LibraryMediaItem extends LibraryItemBase {
  readonly kind: "image" | "video" | "file";
  readonly source: string;
  readonly name: string;
}

export interface LibraryLinkItem extends LibraryItemBase {
  readonly kind: "link";
  readonly url: string;
}

export type LibraryItem = LibraryMediaItem | LibraryLinkItem;

export const LIBRARY_GROUP_ORDER: readonly LibraryBucket[] = ["today", "week", "older"] as const;
/** `ERe` @1579238 — 「本周」窗口 7 天（配合 PS 得到 6–7 天的日历跨度）。 */
export const LIBRARY_WEEK_DAYS = 7;
/** `TS`/`OS`/`c7` = 5 — v1 媒体 / v1 页面 / v2 揭示每批条数。 */
export const LIBRARY_REVEAL_PAGE_SIZE = 5;
export const BUCKET_LABELS: Readonly<Record<LibraryBucket, string>> = { today: "今天", week: "本周", older: "更早" };

/** `PS` @1579315 — nowMs 往前 daysBack 天的本地午夜。 */
export function startOfDayBefore(nowMs: number, daysBack: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - daysBack);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** `MRe` @1579345 —— 日历午夜边界，null 一律 older（无时间条目不被提升）。 */
export function bucketForTimestamp(timestampMs: number | null, nowMs: number): LibraryBucket {
  if (timestampMs == null) return "older";
  if (timestampMs >= startOfDayBefore(nowMs, 0)) return "today";
  if (timestampMs >= startOfDayBefore(nowMs, LIBRARY_WEEK_DAYS - 1)) return "week";
  return "older";
}

export interface LibraryGroups {
  readonly today: LibraryItem[];
  readonly week: LibraryItem[];
  readonly older: LibraryItem[];
}

export function groupLibraryItems(items: readonly LibraryItem[], nowMs: number): LibraryGroups {
  const groups: LibraryGroups = { today: [], week: [], older: [] };
  for (const item of items) groups[bucketForTimestamp(item.timestampMs, nowMs)].push(item);
  return groups;
}

/** 分隔符 → 时间戳（ms）：datetime 属性优先，兜底解析「10月8日」「10/8」可见文本。 */
export function parseSeparatorMs(element: Element): number | null {
  const attr = element.getAttribute("datetime") ?? element.getAttribute("dateTime");
  if (attr != null && attr.length > 0) {
    const parsed = Date.parse(attr);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const text = (element.textContent ?? "").trim();
  const zh = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/.exec(text) ?? /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (zh != null) {
    const year = zh[1] != null ? Number(zh[1]) : new Date().getFullYear();
    const parsed = new Date(year, Number(zh[zh.length - 2]) - 1, Number(zh[zh.length - 1])).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function basenameFrom(source: string): string {
  const clean = source.split(/[?#]/, 1)[0];
  const index = clean.lastIndexOf("/");
  const base = index < 0 ? clean : clean.slice(index + 1);
  try { return decodeURIComponent(base); } catch { return base; }
}

function isVideoSource(source: string): boolean {
  return /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(source);
}

function isUserSide(element: Element, root: ParentNode): boolean {
  for (let node: Element | null = element; node != null && node !== root; node = node.parentElement) {
    if (node.getAttribute("data-role") === "user") return true;
  }
  return false;
}

interface RawDomItem {
  readonly kind: "image" | "video" | "file" | "link";
  readonly source: string;
  readonly name: string | null;
  readonly timestampMs: number | null;
  readonly seq: number;
}

function collectRawItems(root: ParentNode): RawDomItem[] {
  const raw: RawDomItem[] = [];
  let currentMs: number | null = null;
  let seq = 0;
  const candidates = root.querySelectorAll(
    '[class*="sand-transcript-time-separator"], [role="button"][aria-label^="Open "], [aria-label="Media preview"], a[href^="http"]',
  );
  for (const element of candidates) {
    if (element.closest('[class*="sand-agent-library"]') != null) continue;
    if (typeof element.className === "string" && element.className.includes("sand-transcript-time-separator")) {
      currentMs = parseSeparatorMs(element);
      continue;
    }
    if (isUserSide(element, root)) continue;
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel === "Media preview") {
      const src = element.querySelector("img")?.getAttribute("src") ?? element.querySelector("video")?.getAttribute("src") ?? null;
      if (src != null && src.length > 0) raw.push({ kind: isVideoSource(src) ? "video" : "image", source: src, name: null, timestampMs: currentMs, seq: seq++ });
      continue;
    }
    if (ariaLabel != null && ariaLabel.startsWith("Open ")) {
      const name = ariaLabel.slice("Open ".length).trim();
      if (name.length > 0) raw.push({ kind: "file", source: name, name, timestampMs: currentMs, seq: seq++ });
      continue;
    }
    const href = element.getAttribute("href") ?? "";
    if (href.length > 0 && !href.startsWith("javascript:")) {
      const title = (element.closest('[class*="sand-link"]')?.textContent ?? element.textContent ?? "").trim();
      raw.push({ kind: "link", source: href, name: title.length > 0 ? title.slice(0, 80) : null, timestampMs: currentMs, seq: seq++ });
    }
  }
  return raw;
}

/**
 * `FRe` @1581347 的 DOM 投影：kind 前缀去重 Set 全量共享、首次出现胜出、
 * files 跳过已被视觉占用的 source、结果 toReversed()（DOM 序旧→新 → 列表新→旧）。
 */
export function collectLibraryItems(root: ParentNode, options: { now?: () => number } = {}): LibraryItem[] {
  void options;
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  const visualSources = new Set<string>();
  const raw = collectRawItems(root);
  for (const item of raw) if (item.kind === "image" || item.kind === "video") visualSources.add(item.source);
  for (const item of raw) {
    const key = `${item.kind}:${item.source}`;
    if (seen.has(key)) continue;
    if (item.kind === "file" && visualSources.has(item.source)) continue;
    seen.add(key);
    const id = `${item.seq}:${key}`;
    if (item.kind === "link") items.push({ kind: "link", id, timestampMs: item.timestampMs, url: item.source });
    else items.push({ kind: item.kind, id, timestampMs: item.timestampMs, source: item.source, name: item.name ?? basenameFrom(item.source) });
  }
  return items.toReversed();
}

export function itemLabel(item: LibraryItem): string {
  return item.kind === "link" ? item.url : item.name;
}

/** 相对时间（沿用官方视图的量级口径）。 */
export function formatWhen(ms: number | null, nowMs: number): string {
  if (ms == null) return "";
  const age = nowMs - ms;
  if (age < 0) return "";
  if (age < 60_000) return "刚刚";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  const days = Math.floor(age / 86_400_000);
  if (days < 7) return `${days} 天前`;
  return new Date(ms).toISOString().slice(0, 10);
}
