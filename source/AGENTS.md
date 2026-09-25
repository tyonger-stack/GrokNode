<!-- Parent: ../AGENTS.md -->

# source

## Purpose

Grok Bot 0.18 重建版的**运行时源码根**。所有可执行的 Electron main / preload / host / coordinator / 共享契约 / 内聚包都在此目录下，由 `scripts/build.mjs` 编译进产物。渲染器基线不在这里（沿用 checksum 固定的上游 chunk）。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `electron-main/` | 桌面生命周期、窗口、设置、鉴权、box 连接器、coordinator 归属、RPC handler、更新、MCP、VNC |
| `electron-preload/` | 暴露给 UI 的窄可信桥（preload / RPC edge runtime / VNC / webview） |
| `host/` | 推理、工具、MCP、设置、turn 执行；`extensions/inference/` 是 provider 会话核心 |
| `node-agent-coordinator/` | transcript 路由、流式活动、reactions、`inference-router.ts`、`routed-mcp-bridge.ts` |
| `shared/` | 共享契约、settings、协议、provider 辅助（含 `node/inference-router-local.ts`、`node/openrouter-proxy.ts`、`node/grok-node-identity.ts`） |
| `packages/` | 33 个内聚包：`agent*`、`chat-inference*`、`hooks-*`、`mcp-*`、`cursor-config`、`proto` 等 |
| `box-exec-daemon/` | 沙箱内执行守护（容器内跑） |
| `local-exec-daemon/` | 本地执行守护 |
| `internal/` | `scheduling.ts` 等内部调度工具 |

## Key Files

| File | Description |
|------|-------------|
| `tsconfig.json` | 运行时源码的 TypeScript 配置（`npm run source:typecheck` 用） |
| `mime-types.d.ts` | MIME 类型声明 |

## For AI Agents

### Working In This Directory

- **证据优先**：重建代码只能表达有产物锚点支撑的行为，UI 层尤其严格，不许臆造。
- 修改后跑 `npm run source:typecheck`（`tsc --project source/tsconfig.json`）。
- `host/` 在本地 Docker 容器内跑 bundled 代码，**Mac 侧源码改动不会热生效**——需重新 `npm run package` 部署。
- 提交前跑 `npm run check`（typecheck + source:typecheck + test）。

### Testing Requirements

- 单元/集成测试在 `../tests/`，`npm test` 跑全部 `.test.mjs`。

### Common Patterns

- Electron main 与 preload 之间走 RPC；preload 只暴露窄桥。
- Provider 判定统一走 `shared/node/inference-router-local.ts` 的 `getLocalInferenceCliStatus()`。
- 扩展点在 `host/extensions/`，按功能分目录（inference / mcp / transcript / session 等）。

## Dependencies

### Internal

- `../scripts/` — 编译与打包脚本
- `../frontend/` — 可读 renderer 重建（非运行时依赖）

### External

- Electron 42、@connectrpc、@modelcontextprotocol/sdk、undici、rxjs、zod、tree-sitter 等（见 `../package.json`）
