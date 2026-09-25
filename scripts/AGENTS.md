<!-- Parent: ../AGENTS.md -->

# scripts

## Purpose

构建、bootstrap、renderer 补丁、打包、签名、校验、诊断等全流程脚本。所有 `package.json` 的 npm script 都指向这里。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `lib/` | 可复用的构建库：asar 完整性、build-asar、clean-build、codesign、config、macos 打包校验、packaged-app、process、router-renderer-patch、runtime、system-tools |

## Key Files

| File | Description |
|------|-------------|
| `build.mjs` | 主构建入口（编译 source/） |
| `bootstrap-runtime.mjs` | 挂 LFS DMG → hydrate `src/app/dist`（校验 DMG + app.asar SHA-256） |
| `package-macos.mjs` | 编译 → renderer 补丁 → 打包 → ad-hoc 签名 → 校验 |
| `verify.mjs` | 校验已有 app（见 AGENTS.md 陷阱：checksum-pinned 模式下不消费 patched 哈希） |
| `smoke.mjs` | 原生冒烟（见陷阱：只认 clean-source renderer） |
| `verify-publication-tree.mjs` | 证明 fresh-history 导出无损（`npm run publication:check`） |
| `diagnose-channel.mjs` | 容器/中继/代理健康诊断（探测两个容器名 grok-bot-local-vm / grok-node-local-vm） |
| `router-renderer-patch.mjs`（在 lib/） | 最小化可审计的 Router 设置面板注入 |
| `recover-frontend.mjs` | 恢复前端代码 |
| `apply-third-party-patches.mjs` | postinstall 自动打第三方补丁（含 `@connectrpc/connect`） |

## For AI Agents

### Working In This Directory

- 所有脚本为 ESM `.mjs`，用 Node 26.5.x 运行。
- 打包脚本的校验逻辑（checksum、bundle identity、签名、clean-export）**不得为通过构建而放宽**。
- 修改打包相关脚本后必须跑 `npm run package` 全流程验证。

### Testing Requirements

- `npm run publication:check` 验证干净导出。
- `npm run package` 做端到端打包校验。

### Common Patterns

- `lib/config.mjs` 集中配置；`lib/runtime.mjs` 处理运行时路径。
- 校验失败时脚本 throw，不静默降级。

## Dependencies

### Internal

- `../source/` — 被编译的源码
- `../frontend/` — renderer 补丁目标
- `../manifests/` — 重建清单

### External

- `@electron/asar`、`esbuild`、`electron`、`tar` 等（见 `../package.json` devDependencies）
