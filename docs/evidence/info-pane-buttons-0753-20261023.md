# 0.75.3 详情栏按钮移植验收

2026-10-23，详情栏右上角设置与关闭按钮采用官方 0.75.3 外观，保留 Grok Node 原有点击动作。

## 来源与实现

来源为官方 `index.eager-app-DjFE9lSq.js`，SHA-256 为 `952696656fa99b6631d0d0d4acdb7372fbb62b3a28f0e20c89f2baa340a250bb`。`frontend/src/extensions/info-pane-buttons-0753.js` 保留 Ew、uS、Tw、cS、sS、sLe、lS、cLe 八段官方源码，运行时依赖绑定到原生 he、p、Fe、re、Dr。

120 条 CSS 声明来自 `index-CFSAhbDS.css`，选择器限定在详情栏 header。六个按钮主题值分别从官方 common chunk 的 ug primitives、og 与 sg opacity 表提取，透明度遵循官方 Ug 取整。深色模式沿用原生 `data-theme=cursor-dark` 选择器，仅在 header 中提供配色。

`info-pane-tabs-renderer-extension.mjs` 用唯一锚点替换按钮呈现，保留设置的 `onClick:l`、关闭的 `onClick:c`、辅助功能标签和现有设置跳转桥接。锚点缺失或重复时构建失败。

## 已执行验证

| 项目 | 原版本 | 移植后实机 |
| --- | --- | --- |
| 按钮 | 28×28px | 36×36px |
| 间距 | 2px | 8px |
| 图标容器与 glyph | 18px 与 14px | 20px 与 16px |
| 边框 | 无 | 1px solid |
| 深色填充 | 旧 secondary 透明填充 | #1f1f1f |

相关测试 24 项通过，独立源码审查 APPROVE。Chromium 以官方真实明暗主题对比按钮外框，两种主题的像素差均为 0。该比较排除用户要求保留的设置图标与官方分享图标差异。

最终安装版从“详情”点击齿轮后，“其他”页选中，模型与推理强度控件仍存在。关闭按钮收起详情栏，查看对话详情可重新打开。原生截图用于呈现效果，不作为无损像素基准。

101 个 renderer chunk 语法检查通过；staging 与 ASAR 内容一致；安装副本与构建包一致；深度严格签名验证通过。main、preload 和 host 字节均未改变。最终 ASAR SHA-256 为 `9e1b57ff3430f5c7d0de7a72c065ecf8cda2c6de6a495a4d9398596ff88e8fe2`。

全量检查的既有 D17 失败和底栏验证见[底栏验收记录](account-footer-0753-20261023.md)。本次未修改该测试或任何打包完整性门禁。

相关测试入口为 `node --test tests/info-pane-buttons-0753.test.mjs tests/info-pane-native-integration.test.mjs tests/info-pane-tabs-extension.test.mjs`。依赖 pinned renderer 的测试在未 hydrate 的 checkout 中明确跳过。
