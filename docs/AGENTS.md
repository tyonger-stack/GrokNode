<!-- Parent: ../AGENTS.md -->

# docs

## Purpose

项目级文档：架构、发布流程、本地 HTTP MCP、源码映射、审计报告等。不包含运行时代码。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `assets/` | 文档配图（router-settings.png、local-docker-container.png 等） |

## Key Files

| File | Description |
|------|-------------|
| `ARCHITECTURE.md` | 两个源根与打包流架构说明 |
| `PUBLISHING.md` | 干净历史导出流程 |
| `LOCAL_HTTP_MCP.md` | 本地 HTTP MCP 协议说明 |
| `MACOS-RUNTIME-SOURCE-MAP.md` | macOS 运行时源码映射 |
| `GITHUB-ABOUT.md` | GitHub 仓库 About 信息 |
| `BOT_TEMPLATE_IMPORT_STATUS_2026-09-22.md` | Bot 模板导入状态审计 |
| `LOCAL_CORE_AUDIT_2026-09-22.md` | 本地核心审计 |
| `OPENCODEX_CHANNEL_TROUBLESHOOTING.md` | OpenCodex 通道排障 |
| `PUBLISH-AUDIT-2026-09-22.md` | 发布审计 |

## For AI Agents

### Working In This Directory

- 文档是研究记录与架构说明，改动需保持与源码一致。
- 审计报告（`*AUDIT*`、`*STATUS*`）按日期归档，新审计新建文件而非覆盖。

## Dependencies

### Internal

- `../source/` — 架构文档对应的运行时源码
- `../scripts/` — 打包流程文档对应的脚本
