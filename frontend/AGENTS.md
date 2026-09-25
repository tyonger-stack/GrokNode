<!-- Parent: ../AGENTS.md -->

# frontend

## Purpose

可读 React 重建与设计工作区。**注意**：渲染器基线仍是 checksum 固定的上游产物（`src/app/dist`，gitignore），`frontend/` 不是像素级替代，而是用于研究、恢复 UI 结构与做最小化可审计的 renderer 补丁（Router 设置面板注入）。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `manifests/` | renderer 证据清单：组件名、对话证据、引导脚本、语义符号、UI 证据锚点 |
| `src/dev/` | 开发壳（`DevShell.tsx`、DOM 检查器） |
| `src/extensions/` | Bot 模板入口与样式 |
| `src/production/` | 生产 renderer 重建（`ProductionRenderer.tsx`、coordinator 客户端、反应根、侧边栏模型等） |
| `src/recovered/` | 恢复的契约（`contracts/`）、运行时（`runtime/`）、UI 组件（`ui/`）与目录（`catalog.ts`） |

## Key Files

| File | Description |
|------|-------------|
| `src/main.tsx` | renderer 入口 |
| `src/upstream.ts` | 上游产物引用 |
| `src/production/ProductionRenderer.tsx` | 生产渲染器主组件 |
| `src/recovered/features/settings/overlay/router.ts` | Router 设置面板（含 OpenRouter 模型选择、API 地址输入） |
| `vite.config.ts` | Vite 构建配置 |
| `tsconfig.json` | 前端 TypeScript 配置 |
| `index.html` | HTML 入口 |
| `README.md` | 前端说明 |

## For AI Agents

### Working In This Directory

- **证据优先**：UI 重建不许为填补证据空白而发明界面/路由/控件/标签/状态。
- `npm run frontend:build`（`vite build`）构建可读 renderer。
- Router 面板的 UI 改动需同步 `../tests/router-settings.test.mjs`。
- 对 checksum 固定的打包渲染器做最小补丁走 `../scripts/router-renderer-patch.mjs`，patched 哈希记入 `renderer-router-extension.json`。

### Testing Requirements

- `npm run typecheck`（`tsc --project frontend/tsconfig.json`）做类型检查。
- Router 相关断言在 `../tests/router-settings.test.mjs`。

### Common Patterns

- recovered 契约分 `contracts/`（RPC 类型）、`runtime/`（运行时辅助）、`ui/`（组件）。
- production renderer 通过 `coordinator-client.ts` 与 host 通信。

## Dependencies

### Internal

- `../source/electron-preload/` — preload 桥接契约
- `../source/node-agent-coordinator/` — coordinator 协议

### External

- React 19、@vitejs/plugin-react、vite 8、@tiptap/* 富文本编辑、katex、pdfjs-dist 等（见 `../package.json`）
