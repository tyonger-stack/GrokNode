// 市场目录图标的**显示尺寸化**与磁盘缓存 —— 官方 0.66 `main-app.cjs` 里 `displaySizedLogo`
// （内部 `RJe` / `b8t` / `EJe` / `S8t` / `A8t` / `TJe` / `_8t`）的移植。
//
// 为什么需要它：`resolvePluginLogo`（`mcp-marketplace-logo.ts`）只负责 fetch，**不缩放**。
// CDN 对 `cursor-cdn.com/plugin-logos/...` 返回的是 **400×400**（实测 8,091 B 等 5 个 URL
// 全部 400×400），而官方界面上的 `<img>` 固有尺寸是 **112×112**（少数 112×110 等非方形）。
// 差值来自宿主用 Electron `nativeImage` 做的客户端重采样，**不是** CDN 尺寸参数、
// **不是**服务端预生成字段（catalog 的 `iconUrl` 两侧同形且无任何尺寸字段）。
//
// 官方原样（`main-app.cjs` 逐字要点）：
//   s8t=56, c8t=2, RG=s8t*c8t            → 目标最长边 112
//   A8t: r=createFromDataURL(u); if empty→u;
//        {width:n,height:o}=r.getSize();
//        if(n<=RG && o<=RG) return u;                       // 够小就原样
//        i=RG/Math.max(n,o);                                  // ← 保持长宽比，只约束最长边
//        return r.resize({width:max(1,round(n*i)), height:max(1,round(o*i)), quality:"best"}).toDataURL();
//   l8t=64*1024   仅结果 ≤64KB 才落盘
//   d8t=10080*60*1e3  TTL 7 天
//   SJe=1024      保留最新 1024 个
//   h8t(u)=sha256(`${RG}:`+u).slice(0,32)   缓存键把尺寸算进去（尺寸变了键就变）
//   记录格式 `${displaySized}\n${storedAtMs}\n${sha256(displaySized\nstoredAtMs)}`（自校验）
//   非 https / fetch 失败 → null；重复失败翻 isOffForTheSession 整轮关停
//
// 本移植与官方的差异（仅此一处，且是刻意的）：官方用 `lastTurn` 串行队列 + `pendingWrites`
// 保证落盘顺序；这里保留 `lastTurn` 串行队列，但**不做** sentry 降级开关 —— 我们的宿主没有
// 对应的遥测通道，凭空造一个会是臆造。失败只影响这一次请求（返回 null），与官方
// 「单次失败即返回 null」的行为一致。
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

/** 目标最长边。与官方 `RG = 56 * 2` 逐字一致。 */
export const LOGO_DISPLAY_MAX_DIMENSION = 112;
/** 仅当结果不超过这个字节数才落盘（官方 `l8t`）。 */
export const LOGO_DISPLAY_CACHE_MAX_BYTES = 64 * 1024;
/** 缓存有效期 7 天（官方 `d8t`）。 */
export const LOGO_DISPLAY_CACHE_TTL_MS = 10080 * 60 * 1e3;
/** 缓存目录最多保留的文件数（官方 `SJe`）。 */
export const LOGO_DISPLAY_CACHE_MAX_FILES = 1024;
/** 缓存目录名（官方 `u8t`）。 */
export const LOGO_DISPLAY_CACHE_DIRNAME = "plugin-logo-cache";
/** 缓存文件名格式（官方 `p8t`）。 */
const CACHE_FILE_NAME = /^[0-9a-f]{32}$/;
const RECORD_SEPARATOR = "\n";

/**
 * `nativeImage` 的最小形状。官方直接用 `electron.nativeImage`；本移植按仓库既有的
 * ports/adapters 约定注入，`source/` 整棵树不 import electron。
 */
export interface LogoNativeImage {
  createFromDataURL(dataUrl: string): {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
    resize(options: { width: number; height: number; quality: string }): {
      toDataURL(): string;
    };
  };
}

export interface DisplaySizedLogoPorts {
  /** 与官方同形的解码入口：`(dataUrl) => nativeImage`。 */
  createFromDataURL: (dataUrl: string) => ReturnType<LogoNativeImage["createFromDataURL"]>;
  /** 缓存根目录（官方是 `app.getPath("userData")`）。 */
  cacheDir: string;
  now?: () => number;
  /** 原子写；缺省直接覆盖写。 */
  writeFileAtomic?: (path: string, contents: string) => Promise<void>;
}

interface CacheState {
  readonly pending: Map<string, Promise<string | null>>;
  lastTurn: Promise<unknown>;
  isOffForTheSession: boolean;
}
const states = new Map<string, CacheState>();

function stateFor(dir: string): CacheState {
  const found = states.get(dir);
  if (found != null) return found;
  const created: CacheState = { pending: new Map(), lastTurn: Promise.resolve(), isOffForTheSession: false };
  states.set(dir, created);
  return created;
}

/** 缓存键。官方 `h8t` 把目标尺寸写进摘要，改尺寸即换缓存。 */
export function logoCacheKey(url: string, maxDimension = LOGO_DISPLAY_MAX_DIMENSION): string {
  return createHash("sha256").update(`${maxDimension}:`).update(url).digest("hex").slice(0, 32);
}

/** 官方 `A8t`：把 data URI 缩到最长边 ≤112，保持长宽比。 */
export function downscaleLogoDataUrl(
  dataUrl: string,
  createFromDataURL: DisplaySizedLogoPorts["createFromDataURL"],
  maxDimension = LOGO_DISPLAY_MAX_DIMENSION,
): string {
  const image = createFromDataURL(dataUrl);
  if (image.isEmpty()) return dataUrl;
  const { width, height } = image.getSize();
  if (width <= maxDimension && height <= maxDimension) return dataUrl;
  const ratio = maxDimension / Math.max(width, height);
  return image
    .resize({
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
      quality: "best",
    })
    .toDataURL();
}

/** 官方 `wJe`：记录体末行是前两行的 sha256，读时自校验。 */
function encodeRecord(record: { displaySized: string; storedAtMs: number }): string {
  const body = [record.displaySized, String(record.storedAtMs)].join(RECORD_SEPARATOR);
  return [body, createHash("sha256").update(body).digest("hex"), ""].join(RECORD_SEPARATOR);
}

/**
 * 官方 `y8t`：解出前两段后重新编码，与原文全串比对 —— 不等就当没缓存。
 * 刻意**不**加 `Number.isFinite(storedAtMs)` 守卫：那行是冗余的（时间戳非法时全串比对
 * 同样会失配），而官方也没有它。多一条测不到的分支比不写更糟。
 */
function decodeRecord(contents: string): { displaySized: string; storedAtMs: number } | null {
  const [displaySized = "", storedAt = ""] = contents.split(RECORD_SEPARATOR);
  const storedAtMs = Number(storedAt);
  if (contents !== encodeRecord({ displaySized, storedAtMs })) return null;
  return { displaySized, storedAtMs };
}

async function readCache(state: CacheState, file: string): Promise<{ displaySized: string; storedAtMs: number } | null> {
  if (state.isOffForTheSession) return null;
  const contents = await readFile(file, "utf8").catch(() => null);
  return contents == null ? null : decodeRecord(contents);
}

/** 官方 `_8t`：按 mtime 升序，删掉超出上限的旧条目。 */
async function pruneCache(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((name) => CACHE_FILE_NAME.test(name));
  if (names.length <= LOGO_DISPLAY_CACHE_MAX_FILES) return;
  const dated = await Promise.all(
    names.map(async (name) => ({ name, mtimeMs: await stat(join(dir, name)).then((s) => s.mtimeMs, () => 0) })),
  );
  dated.sort((a, b) => a.mtimeMs - b.mtimeMs);
  await Promise.all(
    dated.slice(0, dated.length - LOGO_DISPLAY_CACHE_MAX_FILES).map((entry) => rm(join(dir, entry.name), { force: true })),
  );
}

/**
 * 把 `fetchDataUrl()` 拿到的原始 data URI 变成**显示尺寸**的 data URI，并按官方规则做磁盘缓存。
 *
 * @param fetchDataUrl 产出原始 data URI 的函数（一般是 `resolvePluginLogo`）
 */
export function createDisplaySizedLogo(ports: DisplaySizedLogoPorts) {
  const now = ports.now ?? Date.now;
  const state = stateFor(ports.cacheDir);

  return async function displaySizedLogo(url: string, fetchDataUrl: () => Promise<string | null>): Promise<string | null> {
    const file = join(ports.cacheDir, logoCacheKey(url));
    const inFlight = state.pending.get(file);
    if (inFlight != null) return await inFlight;
    const work = (async () => {
      const cached = await readCache(state, file);
      if (cached != null && now() - cached.storedAtMs < LOGO_DISPLAY_CACHE_TTL_MS) return cached.displaySized;
      const raw = await fetchDataUrl();
      if (raw == null) return null;
      const displaySized = downscaleLogoDataUrl(raw, ports.createFromDataURL);
      if (displaySized.length <= LOGO_DISPLAY_CACHE_MAX_BYTES && !state.isOffForTheSession) {
        // 官方用 lastTurn 串行化写入，避免并发 read-modify-write 打架
        state.lastTurn = state.lastTurn
          .then(async () => {
            await mkdir(ports.cacheDir, { recursive: true });
            await (ports.writeFileAtomic ?? writeFile)(file, encodeRecord({ displaySized, storedAtMs: now() }));
            await pruneCache(ports.cacheDir);
          })
          .catch(() => {
            // 官方在这里翻 isOffForTheSession；我们不翻（无遥测通道），只让本次落盘失败
          });
        await state.lastTurn;
      }
      return displaySized;
    })().finally(() => {
      state.pending.delete(file);
    });
    state.pending.set(file, work);
    return await work;
  };
}
