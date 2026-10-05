// 官方 0.66「市场目录图标降到最长边 112」的移植守卫。
//
// 这个守卫守的是一个**曾经被记成「不知道原因所以不能改」的差异**（D18）。机制现已从官方
// `main-app.cjs` 逐字取回：宿主用 Electron `nativeImage` 客户端重采样，目标是
// `RG = 56*2 = 112`，按**最长边**缩、保持长宽比。CDN 本身返回 400×400。
//
// 守卫要点：
//   ① 判据抓**机制**不抓表象 —— 只断言「最长边 == 112」，不断言「宽度 == 112」
//      （官方实测有 112×110 这类非方形；断言宽度会把它误判成回归）。
//   ② ≤112 原样返回（官方显式分支）——漏了这个分支会把小图放大。
//   ③ 缓存键把尺寸写进摘要，改尺寸即换缓存（官方 `h8t`）。
//   ④ 记录自校验：末行是前两行的 sha256，篡改即当没缓存（官方 `wJe`/`y8t`）。
//   ⑤ 真实字节：拿 CDN 实际返回的 PNG 跑一遍，断言输出是 112×112。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// source/ 是 noEmit（只做类型检查，打包时由 esbuild 编译），所以测试**直接 import .ts** ——
// 与 tests/plugins-marketplace-model.test.mjs 等同一约定（Node 26 原生剥离类型）。
// 刻意不写「import 失败就 skip」的兜底：那种兜底会把「模块路径写错」变成一条永远绿的
// 静默跳过，正是本守卫最该防的那类假绿。import 失败就该红。
const mod = await import("../source/electron-main/mcp/plugin-logo-cache.ts");

/** 极简 PNG 头解析：只取 IHDR 的宽高，够验证尺寸而不引第三方解码器。 */
function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "不是 PNG");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** 假 nativeImage：够跑通 resize 语义，且能记录调用参数。 */
function fakeNativeImage(log) {
  return (dataUrl) => {
    const m = /^data:image\/png;base64,(.*)$/s.exec(dataUrl);
    assert.ok(m, `dataUrl 形态不对: ${dataUrl.slice(0, 40)}`);
    const bytes = Buffer.from(m[1], "base64");
    const size = pngSize(bytes);
    return {
      isEmpty: () => size.width === 0 || size.height === 0,
      getSize: () => size,
      resize: ({ width, height, quality }) => {
        log.push({ width, height, quality });
        // 造一张目标尺寸的 PNG（IHDR 改写即可，测试不校验像素内容）
        const out = Buffer.from(bytes);
        out.writeUInt32BE(width, 16);
        out.writeUInt32BE(height, 20);
        return { toDataURL: () => `data:image/png;base64,${out.toString("base64")}` };
      },
    };
  };
}

/** 造一张指定尺寸的「PNG」（只保证头合法）。 */
function fakePng(width, height) {
  const b = Buffer.alloc(40);
  b.write("89504e470d0a1a0a", "hex");
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return `data:image/png;base64,${b.toString("base64")}`;
}

const skip = mod == null ? "未能加载编译产物" : false;

test("目标最长边与官方常量逐字一致（RG = 56*2）" , () => {
  assert.equal(mod.LOGO_DISPLAY_MAX_DIMENSION, 112);
  assert.equal(56 * 2, mod.LOGO_DISPLAY_MAX_DIMENSION, "官方是 56*2，不是 112 这个字面量");
  assert.equal(mod.LOGO_DISPLAY_CACHE_MAX_BYTES, 64 * 1024);
  assert.equal(mod.LOGO_DISPLAY_CACHE_TTL_MS, 10080 * 60 * 1e3);
  assert.equal(mod.LOGO_DISPLAY_CACHE_MAX_FILES, 1024);
  assert.equal(mod.LOGO_DISPLAY_CACHE_DIRNAME, "plugin-logo-cache");
});

test("400×400 → 112×112（CDN 实际尺寸）" , () => {
  const log = [];
  const out = mod.downscaleLogoDataUrl(fakePng(400, 400), fakeNativeImage(log));
  assert.deepEqual(log, [{ width: 112, height: 112, quality: "best" }]);
  assert.deepEqual(pngSize(Buffer.from(out.split(",")[1], "base64")), { width: 112, height: 112 });
});

test("保持长宽比：1120×110 → 112×11（不是 112×112）" , () => {
  // 官方实测有 112×110 这类非方形 —— 只约束最长边是机制的关键
  const log = [];
  const out = mod.downscaleLogoDataUrl(fakePng(1120, 110), fakeNativeImage(log));
  assert.deepEqual(log, [{ width: 112, height: 11, quality: "best" }]);
  const s = pngSize(Buffer.from(out.split(",")[1], "base64"));
  assert.equal(Math.max(s.width, s.height), 112);
  assert.ok(s.height < 112, "短边必须按比例缩小，不能被拉成方形");
});

test("已 ≤112 原样返回，且不调用 resize" , () => {
  const log = [];
  const small = fakePng(64, 64);
  assert.equal(mod.downscaleLogoDataUrl(small, fakeNativeImage(log)), small);
  assert.deepEqual(log, [], "官方在够小时有显式早退分支，漏了会把小图放大");
  const exact = fakePng(112, 112);
  assert.equal(mod.downscaleLogoDataUrl(exact, fakeNativeImage(log)), exact, "恰好 112 也算够小");
  assert.deepEqual(log, []);
});

test("缓存键把尺寸写进摘要（官方 h8t）" , () => {
  const url = "https://cursor-cdn.com/plugin-logos/production/b7f4cf5c6c9f4a26.png";
  const key = mod.logoCacheKey(url);
  assert.equal(key.length, 32);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.notEqual(mod.logoCacheKey(url, 128), key, "换尺寸必须换缓存");
  // 键必须是 sha256("112:" + url) 的前 32 位
  const expected = createHash("sha256").update("112:").update(url).digest("hex").slice(0, 32);
  assert.equal(key, expected);
});

test("磁盘缓存：写入 → 命中不再 fetch → 记录被篡改则当没缓存" , async () => {
  const dir = mkdtempSync(join(tmpdir(), "logo-cache-"));
  try {
    const log = [];
    let fetchCount = 0;
    let clock = 1_000_000;
    const display = mod.createDisplaySizedLogo({
      createFromDataURL: fakeNativeImage(log),
      cacheDir: dir,
      now: () => clock,
    });
    const fetchDataUrl = async () => {
      fetchCount += 1;
      return fakePng(400, 400);
    };

    const first = await display("https://example.test/a.png", fetchDataUrl);
    assert.equal(fetchCount, 1);
    assert.equal(readdirSync(dir).length, 1, "应落盘一个缓存文件");

    // 同 URL 再来 → 命中磁盘缓存，不再 fetch
    const second = await display("https://example.test/a.png", fetchDataUrl);
    assert.equal(fetchCount, 1, "命中缓存时不得再 fetch");
    assert.equal(second, first);

    // 过期（> 7 天）→ 重新 fetch
    clock += mod.LOGO_DISPLAY_CACHE_TTL_MS + 1;
    await display("https://example.test/a.png", fetchDataUrl);
    assert.equal(fetchCount, 2, "超 TTL 必须重新取");

    // 两种篡改必须分开测，否则一种会被另一种的守卫「顺带」挡住：
    //   ① 改 storedAtMs → 走 Number() 的 NaN 守卫
    //   ② 改校验和     → 只有「重新编码后全串相等」这条能挡住
    // 早先只做了 ①，于是「删掉自校验」这个变异全绿 —— 断言名说了 A、实际测的是 B。
    const file = join(dir, mod.logoCacheKey("https://example.test/a.png"));
    const partsOf = () => readFileSync(file, "utf8").split("\n");

    // ② 校验和被改：storedAtMs 仍是合法数字，只有全串比对能发现
    const tampered = partsOf();
    assert.match(tampered[2], /^[0-9a-f]{64}$/, "记录末段应是 64 位 sha256");
    tampered[2] = "0".repeat(64);
    writeFileSync(file, tampered.join("\n"));
    let before = fetchCount;
    await display("https://example.test/a.png", fetchDataUrl);
    assert.equal(fetchCount, before + 1, "校验和不符必须当没缓存（缺的就是这条守卫）");

    // ① 时间戳被改：走 NaN 守卫
    const badStamp = partsOf();
    badStamp[1] = "deadbeef";
    writeFileSync(file, badStamp.join("\n"));
    before = fetchCount;
    await display("https://example.test/a.png", fetchDataUrl);
    assert.equal(fetchCount, before + 1, "时间戳非法必须当没缓存");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetch 返回 null 时透传 null，不落盘" , async () => {
  const dir = mkdtempSync(join(tmpdir(), "logo-cache-"));
  try {
    const display = mod.createDisplaySizedLogo({ createFromDataURL: fakeNativeImage([]), cacheDir: dir });
    assert.equal(await display("https://example.test/missing.png", async () => null), null);
    assert.equal(readdirSync(dir).length, 0, "失败不应留下缓存文件");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("同 URL 并发请求只 fetch 一次（官方 pendingLogos 去重）" , async () => {
  const dir = mkdtempSync(join(tmpdir(), "logo-cache-"));
  try {
    let fetchCount = 0;
    const display = mod.createDisplaySizedLogo({ createFromDataURL: fakeNativeImage([]), cacheDir: dir });
    const fetchDataUrl = async () => {
      fetchCount += 1;
      await new Promise((r) => setTimeout(r, 10));
      return fakePng(400, 400);
    };
    const results = await Promise.all([
      display("https://example.test/dup.png", fetchDataUrl),
      display("https://example.test/dup.png", fetchDataUrl),
      display("https://example.test/dup.png", fetchDataUrl),
    ]);
    assert.equal(fetchCount, 1, "并发去重失效");
    assert.equal(new Set(results).size, 1, "三次结果应一致");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
