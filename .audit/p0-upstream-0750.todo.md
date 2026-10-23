# P0 移植：0.75 asar 读取器 + 清理恒开 flag —— 已完成（2026-10-22）

## Playbook: Feature（poteto-mode）

- [x] 数据形状命名：`scripts/lib/upstream-asar.mjs` 导出 `createUpstreamAsarIdentity(version, asarSha256)` / `upstreamAsarPaths(repoRoot, snapshotDir, manifestFile)` / `openUpstreamAsar(identity, opts)`
- [x] 抽取共享读取逻辑到 `scripts/lib/upstream-asar.mjs`，0721 与 0750 共用（0721 公开签名与错误消息保持不变）
- [x] 新建 `scripts/lib/upstream-0750.mjs`（`UPSTREAM_0750` + `openUpstream0750()` + `GROK_BOT_0750_ASAR` 覆盖）
- [x] 新建 `manifests/ports/grokbot-0750-unpacked.json`（4 个原生二进制，sha256 + asarDeclaredSha256；0.75 全部重新编译，字节与 0.72.1 不同）
- [x] 新建 `scripts/lib/generate-upstream-unpacked-manifest.mjs`（清单生成器，可复现）
- [x] 编写 `tests/upstream-0750.test.mjs`（5 项：读源/版本/拒绝改包/拒绝改原生/两版二进制不同）
- [x] 清理 `sand_desktop_mount_capture`：`port-0721-features.ts` 移除 + `desktop-runtime-0721.ts` 停传 + `desktop-mount/index.ts` 删 `isCaptureGateOn` 选项与 fallback；残留引用 grep 为零
- [x] `npm run source:typecheck` 通过（exit 0）
- [x] `npm run typecheck` 通过（exit 0）
- [x] 聚焦测试 46/46 通过（upstream-0721 / upstream-0750 / desktop-0721 / desktop-mount-0721 / desktop-mount-renderer-0721 / desktop-runtime-0721 / library-feature-gates / local-computer-use-gate）
- [x] 完整套件评估：265 个非 listen 文件中 8 个失败，全部位于与本次改动零引用的文件（host-rpc-publication-parity、library-file-viewer-packaged、library-production-mcp、local-feishu-bridge、local-http-mcp-oauth），且 tests/ 全树已无 `sand_desktop_mount_capture` 引用；另 21 个需 `listen(127.0.0.1)` 的文件在沙箱下以 EPERM 失败，属环境限制

## 验证

- [x] `openUpstream0750()` 读到 version 0.75.0（1033 files），zh-CN catalog 388 条含新 id `EDRdK3`
- [x] 篡改成员字节时抛错（archive / native 两层）
- [x] `local0721FeatureSnapshot()` 不再含 sand_desktop_mount_capture
- [x] 上游 0.75 用父级 `sand_desktop_mount` 门控 capture（已核对 main-app.cjs 的 checkFeatureGate 调用集合）；移植版行为与上游一致
- [x] 前瞻验证：0750 读取器可直读 `dist/electron-main/main-core.cjs`、`main-app.cjs`、preload 与 `chunk-vault-card-dialog`（98885 B），P1 可直接复用

## 上游依据

0.75 `main-app.cjs` 的 `checkFeatureGate` 调用集合已无 `sand_desktop_mount_capture`，capture gate 改为 `isGateOn:()=>checkFeatureGate("sand_desktop_mount")`。移植版改动与上游一致。

## 备注

- `sand_enable_local_cua`（0.75 新增且上游有消费点）由并发线加入 `LOCAL_FEATURES`，不在本次范围；本次清理未触碰它。
- 完整 `npm test` 在本沙箱内无法全绿（21 个文件需本地 listen，均 EPERM），属环境边界，非回归。
