<!-- Parent: ../AGENTS.md -->

# tests

## Purpose

发布与回归测试，全部用 Node 内置 `node:test` 框架（`.test.mjs`）。`npm test` 即 `node --test tests/*.test.mjs`。当前约 50 个测试文件，覆盖 router、MCP、bot 模板、auto-review、subagent、provider、打包发布等。

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `fixtures/` | 测试夹具（如 `local-http-mcp-server.mjs`） |

## Key Files（按主题分组）

| File | Description |
|------|-------------|
| `router-settings.test.mjs` | Router 面板 provider/模型/API 地址桥接 |
| `inference-router-transcript.test.mjs` | 推理路由与 transcript |
| `openrouter-proxy-models.test.mjs` | OpenRouter 代理模型列表解析 |
| `openrouter-channel-status.test.mjs` | OpenRouter 通道状态 |
| `local-mcp-config.test.mjs` / `local-http-mcp-*.test.mjs` | 本地 HTTP MCP 配置/路由/OAuth/discovery |
| `backend-mcp-exec-json.test.mjs` | MCP 后端执行 JSON |
| `bot-template-*.test.mjs` | Bot 模板导入/配方/控制器/内容 |
| `auto-review-*.test.mjs` | auto-review 分类/过期/renderer 补丁/computer-off |
| `codex-*.test.mjs` | Codex 直响/host 循环路由/工具参数 |
| `subagent-*.test.mjs` | 子 agent 浏览器工具链/computer 工厂/窗口分配 |
| `grok-node-identity.test.mjs` | Grok Node 独立身份（2 用例） |
| `publication-*.test.mjs` | 发布 bootstrap/打包校验 |
| `local-docker-*.test.mjs` | 本地 Docker 中继状态/shell 授权 |
| `send-message-widget.test.mjs` | send_message 工具投递 |

## For AI Agents

### Working In This Directory

- 测试全部 ESM，`node:test` + `node:assert/strict`，无第三方框架。
- 很多测试用 `esbuild` 按需打包 `../source/` 模块再加载。
- 新增测试命名 `*.test.mjs`，放此目录即可被 `npm test` 自动拾取。

### Testing Requirements

```sh
cd grok-bot-0.18-reconstructed
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
npm test                    # 全部
node --test tests/router-settings.test.mjs   # 单文件
```

### Common Patterns

- `esbuild.build({ stdin: { contents: 'export {...} from "..."' } })` 打包被测模块。
- 临时目录用 `os.tmpdir()`，断言 store.db / profile 写入。

## Dependencies

### Internal

- `../source/` — 被测运行时模块
- `../source/shared/` — 共享契约

### External

- `esbuild` — 打包被测模块
