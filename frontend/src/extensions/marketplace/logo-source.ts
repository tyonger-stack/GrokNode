// 目录图标的来源解析：先照旧用远端 URL，再在桥回来后替换成官方那种「显示尺寸」data URI。
//
// 独立成零依赖模块有两个理由：
//   ① 可直接被测试 `import`（`view.ts` 内部用 `./xxx.js` 后缀，Node 直读会解析不到 .ts 文件；
//      `model.ts` 之所以能被 `tests/plugins-marketplace-model.test.mjs` 直读，正是因为它零 import）。
//   ② 它是一条**契约**：失败必须等于没做。
//
// 背景（D18）。官方 0.66 的目录图标走宿主 `displaySizedLogo`：`nativeImage` 把图缩到
// **最长边 112**（保持长宽比）后内联成 data URI。CDN 对 catalog 里那条 `iconUrl`
// 返回的是 **400×400**（实测 5 个 URL 全部 400×400，8–11 KB）。差的就是这一步 ——
// **不是** CDN 尺寸参数，**不是**服务端预生成字段（catalog 两侧同形且无任何尺寸字段）。
// 官方那条命令形如 `getMcpPluginLogo({url}) → displaySizedLogo(url, resolvePluginLogo)`。
//
// 为什么**先赋远端 URL 再异步替换**而不是等桥：渲染盒是固定尺寸，换不换字节都不回流；
// 先赋值保证 ① 桥不可用/失败时行为与改动前逐像素一致（纯 no-op）② 不引入空帧闪烁。
// 官方也是先渲染行、再把 data URI 填进去。
const DATA_IMAGE_PREFIX = "data:image/";

type LogoBridge = (url: string) => Promise<unknown>;

function logoBridge(): LogoBridge | null {
  const mcp = window.desktop?.mcp;
  const candidate = mcp?.pluginLogo;
  if (mcp == null || typeof candidate !== "function") return null;
  return mcp.pluginLogo.bind(mcp) as LogoBridge;
}

export function attachLogoSource(image: HTMLImageElement, iconUrl: string): void {
  image.src = iconUrl;
  const bridge = logoBridge();
  if (bridge == null) return;
  void Promise.resolve(bridge(iconUrl))
    .then((dataUrl) => {
      // 只接受 data URI：桥若返回 null / 空串 / 非 data（异常）就保持远端 URL 不动
      if (typeof dataUrl !== "string" || !dataUrl.startsWith(DATA_IMAGE_PREFIX)) return;
      // 刻意**不**加「元素已脱离 DOM 就别改」这类守卫：`isConnected` 在本调用点必然还是
      // false（attachLogoSource 早于 append，且整个行树同步挂载），拿它当判据会误伤
      // 合法更新，变成「静默不换图标」这种比不换更难查的故障；而对已脱离的节点改 src
      // 是无害的（没人读它，它会随节点一起回收）。
      image.src = dataUrl;
    })
    .catch(() => {
      /* 桥失败：保持远端 URL —— 与改动前一致 */
    });
}
