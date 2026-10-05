// 目录图标「先赋远端 URL、桥回来再替换」契约的守卫（D18）。
//
// 这条守卫守的是**「失败必须等于没做」**这个性质。`attachLogoSource` 替换的是首页/详情页
// 行图标这条当前已实测对齐的渲染路径，所以任何「桥不可用 / 抛错 / 返回怪东西」的情况都
// 必须退化成改动前的行为，而不是把图标弄没。
//
// 为什么用「真跑」而不是文本断言：只查 `image.src = iconUrl` 这个串存在，把它挪进
// `if (false)` 块里断言照样匹配；同理「只在 data:image 时替换」写成注释也匹配。
// 这里直接构造假 img + 假桥，断言**实际发生的赋值序列**。
import { test } from "node:test";
import assert from "node:assert/strict";

const { attachLogoSource } = await import("../frontend/src/extensions/marketplace/logo-source.ts");

/** 记录 src 每次被赋的值序列。 */
function fakeImage() {
  const seq = [];
  return { seq, isConnected: true, ownerDocument: {}, set src(v) { seq.push(v); }, get src() { return seq[seq.length - 1]; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const URL_ = "https://cursor-cdn.com/plugin-logos/production/b7f4cf5c6c9f4a26.png";

function withBridge(impl) {
  const prev = globalThis.window;
  globalThis.window = { desktop: { mcp: impl === undefined ? {} : { pluginLogo: impl } } };
  return () => { globalThis.window = prev; };
}

test("同步就赋远端 URL（不等桥）", async () => {
  const restore = withBridge(async () => "data:image/png;base64,AAAA");
  try {
    const img = fakeImage();
    attachLogoSource(img, URL_);
    assert.deepEqual(img.seq, [URL_], "首个赋值必须同步发生，否则会出现空帧/回流");
    await tick();
    assert.deepEqual(img.seq, [URL_, "data:image/png;base64,AAAA"]);
  } finally { restore(); }
});

test("桥不存在（mcp 缺失或无 pluginLogo）⇒ 只赋远端 URL", async () => {
  for (const impl of [undefined]) {
    const restore = withBridge(impl);
    try {
      const img = fakeImage();
      attachLogoSource(img, URL_);
      await tick();
      assert.deepEqual(img.seq, [URL_], "桥缺失必须退化成改动前行为");
    } finally { restore(); }
  }
});

test("桥返回 null / 空串 / 非 data URI ⇒ 保持远端 URL", async () => {
  for (const bad of [null, "", "https://evil.test/x.png", 123, undefined]) {
    const restore = withBridge(async () => bad);
    try {
      const img = fakeImage();
      attachLogoSource(img, URL_);
      await tick();
      assert.deepEqual(img.seq, [URL_], `桥返回 ${JSON.stringify(bad)} 时不应替换 src`);
    } finally { restore(); }
  }
});

test("桥抛错 ⇒ 保持远端 URL 且不产生未处理拒绝", async () => {
  const restore = withBridge(async () => { throw new Error("boom"); });
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const img = fakeImage();
    attachLogoSource(img, URL_);
    await tick();
    await tick();
    assert.deepEqual(img.seq, [URL_]);
    assert.equal(unhandled.length, 0, "必须 .catch 住，否则会污染全局");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

test("已脱离文档的元素仍会被更新（刻意：isConnected 在本调用点必然为 false）", async () => {
  const restore = withBridge(async () => "data:image/png;base64,AAAA");
  try {
    const img = fakeImage();
    img.isConnected = false;
    attachLogoSource(img, URL_);
    await tick();
    assert.deepEqual(
      img.seq,
      [URL_, "data:image/png;base64,AAAA"],
      "不能靠 isConnected 判「已脱离」：attachLogoSource 早于 append，那时必然是 false，会误伤合法更新",
    );
  } finally { restore(); }
});
