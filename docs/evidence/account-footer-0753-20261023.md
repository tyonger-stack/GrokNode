# 0.75.3 账户与连接应用底栏移植验收

2026-10-23，账户与连接应用使用官方展开、让位和折叠配方，同时保留原生账户菜单、连接应用入口和已有连接数据。

## 来源与实现

官方 ASAR SHA-256 为 `15c94ce3e0c80653ad923c498d012b13c4b00cf27f44fffe07de7bc570ddac04`。主 renderer `index.eager-app-DjFE9lSq.js` 的 SHA-256 为 `952696656fa99b6631d0d0d4acdb7372fbb62b3a28f0e20c89f2baa340a250bb`。

`frontend/src/extensions/account-footer-0753/upstream/` 保存原始片段、CSS、哈希和 UTF-16 源范围。`official.js` 保留官方状态与样式配方，`connected-apps.js` 保留连接数量计算和默认阈值 4。计数使用连接快照、有效插件和官方去重规则；缺少数据时显示带文字的入口。

`adapter.ts` 操作现有账户和应用节点。指针、焦点和菜单状态按官方优先级决定展开目标。刷新采用单个在途任务和修订号，避免旧结果覆盖新状态。连接完成、窗口重新可见和轮询均触发刷新。折叠侧栏时恢复原生账户呈现，并维护唯一的应用 rail 入口。

旧测试对 `insertBefore(wrapper, footer)` 源码写法的断言由真实 DOM 测试替代。新测试验证 rail 位于共享 footer 之前、重复同步不增加入口、展开后删除 rail。

## 已执行验证

- 底栏、相邻插件入口与 Router 聚焦测试 94 项通过。
- Chromium 夹具 12 个场景通过，包含默认状态、悬停、菜单优先级、键盘、连接阈值、折叠与窄侧栏。
- 最终安装版实测账户悬停后宽度为 242.5px，应用收为 68px logos。指针转向应用后，账户收为 36px，应用恢复为 274.5px。
- 前端构建、类型检查、打包和签名检查通过。原始签名 Computer Use sidecar 保持不变。

最终成品还包含[详情栏按钮移植](info-pane-buttons-0753-20261023.md)。全量测试为 2312 项，2290 通过、21 跳过、1 项既有 D17 失败。D17 脚本的双引号锚点不匹配官方新版反引号，未修改或削弱该测试。独立执行原打包脚本后，完整性与签名门禁通过。

聚焦测试使用 `node --test tests/account-footer-0753.test.mjs tests/plugins-dock-connect-apps-pill.test.mjs`。Chromium 夹具入口为 `node scripts/verify-account-footer-0753.mjs`，需要已 hydrate 的 0.18 renderer；可用 `GROK_NODE_018_RENDERER_ASSETS` 指定资源目录。
