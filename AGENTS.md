# AGENTS.md — Grok Bot 0.18 重建版

给 AI 协作者的项目速查。改动前先读，避免重复踩坑。

## 一句话定位

**非官方源码级重建**：把公开发布的 Grok Bot 0.18.0 macOS 应用（Anysphere，bundle ID `com.anysphere.sand`）逆向重建为可读 TypeScript，并外挂了几项实验特性（推理路由、本地 Docker 沙箱、用量统计）。

**不是** Anysphere 官方源码，不做官方发布。上游应用是 **checksum 固定的构建输入**，不入库（`src/app/dist` 被 gitignore），bootstrap 时下载/挂载并校验。

## 硬约束（先记住这三条）

1. **证据优先（evidence-only）**：重建代码只能表达"至少有一个可检视产物锚点"支撑的行为（产物字符串/CSS、IPC/RPC 契约、DOM 签名、可复现的运行时观测）。**UI 层尤其严格**：不许为了填补证据空白而发明界面、路由、控件、标签、状态。证据不全就记为 uncertainty 或 evidence-only。**臆造行为 = 发布阻断缺陷。**
2. **不弱化校验**：不得为了通过构建而放宽 checksum、bundle identity、签名、clean-export 检查。
3. **合规边界**：仓库无许可证，版权归 Anysphere，仅研究用途。**拒绝**任何绕过登录/伪造 token 的请求。

## 本机环境（M4 Max / arm64 / macOS 26）

| 项 | 值 |
| --- | --- |
| Node | **必须 26.5.x**（engines `>=26.5.0 <27`）。本机专用副本：`.tools/node-26/bin/node`（v26.5.1），不要用它之外的 node 跑构建 |
| Git LFS | 已装；原始 DMG/exe 走 LFS |
| 容器引擎 | OrbStack（docker 在 `/usr/local/bin`、`~/.orbstack/bin`） |
| 产物 app | `/Applications/Grok Node.app`（BundleID `…reconstructed`，ad-hoc 签名） |
| 配置存储 | `~/.grokbot/settings.json`，数据根 `.grokbot-data-root-v1` |

## 目录地图

| 路径 | 职责 |
| --- | --- |
| `source/electron-main/` | 桌面生命周期、设置、鉴权、box 连接器、coordinator 归属、RPC handler |
| `source/electron-preload/` | 暴露给 UI 的窄可信桥（preload / RPC edge runtime / VNC） |
| `source/host/` | 推理、工具、MCP、设置、turn 执行；`extensions/inference/` 是 provider 会话核心 |
| `source/node-agent-coordinator/` | transcript 路由、流式活动、reactions、`inference-router.ts`、`routed-mcp-bridge.ts` |
| `source/shared/` | 共享契约、settings、协议、provider 辅助 |
| `source/packages/` | 33 个内聚包：agent-*、chat-inference(-proto)、hooks-*、mcp-*、cursor-config/plugins、proto 等 |
| `source/box-exec-daemon/`、`local-exec-daemon/` | 沙箱内执行守护 / 本地执行守护 |
| `frontend/` | 可读 React 重建与设计工作区。**渲染器基线仍是上游产物**，`frontend/` 不是像素级替代 |
| `scripts/` | bootstrap、编译、renderer 补丁、打包、签名、校验 |
| `tests/` | 发布与 router 回归（8 个 `.test.mjs`） |

**打包策略（hybrid by design）**：运行时由 `source/` 编译；渲染器沿用 checksum 固定的上游 chunk；`router-renderer-patch.mjs` 做**最小化、可审计**的 Router 设置面板注入，patched 哈希记入 `renderer-router-extension.json`。

## 常用命令

```sh
export PATH="$(git rev-parse --show-toplevel)/../.tools/node-26/bin:$PATH"   # 前置条件：Node 26.5.x（本机副本在工作区根）

npm ci                  # 322 包，postinstall 自动打第三方补丁
npm run bootstrap       # 挂 LFS DMG → hydrate src/app/dist（校验 DMG + app.asar SHA-256）
npm run check           # typecheck + source:typecheck + test（当前 18/18）
npm run package         # 编译 → renderer 补丁 → 打包 → ad-hoc 签名 → 校验
npm run verify          # 校验已有 app（注意：见下方陷阱）
npm run smoke           # 原生冒烟（注意：见下方陷阱）
npm run publication:check  # 证明 fresh-history 导出无损
npm run frontend:build  # 构建可读 renderer 重建
```

**部署**：`npm run package` 产物在 `dist/`，完整可用 app 需 `ditto` 到 `/Applications`。部署前**必须停掉旧进程**，否则 ditto 失败。沙箱内 `cp -R` 会被拦，用 `/usr/bin/ditto`。

## 已知陷阱（已实证，别再踩）

| 现象 | 结论 | 处理 |
| --- | --- | --- |
| `npm run verify` FAIL | `checksum-pinned-artifact-runtime` 模式下 verify.mjs **不消费** `renderer-router-extension.json` 的 patched 哈希 → 必然不匹配。是上游脚本缺口 | 以 package 内嵌的 `verifyReconstructedMacPackage` 为准（已通过） |
| `npm run smoke` PREREQUISITE | smoke 只认 clean-source renderer 模式，与默认打包模式不符 | 运行时进程产物检查均 PASS，可忽略该门禁 |
| `dist/` 残留残壳 app | package 末尾 `rm` + `ditto`，中途被打断会只剩 `Contents/Resources` | 重跑 package，勿用残壳 |
| GUI app 找不到 `docker` | Finder 启动继承 launchd 最小 PATH，OrbStack/Docker Desktop 不在其中 → `spawn docker ENOENT` → `boxRuntime` 自动回滚 remote。**已修复**：`resolveDockerBinary()` 探测 `/usr/local/bin`、`/opt/homebrew/bin`、Docker.app，返回**绝对路径**并把目录 prepend 到子进程 `PATH` | 教训：PATH 前缀只能进 `env.PATH`，**不能拼进可执行文件名字** |
| `launchctl setenv PATH` / `/etc/paths.d` / 软链到 `/usr/bin` | 全部无效（无权限 / GUI 不读 / SIP 保护） | 走源码内探测方案 |
| Homebrew cask 沙箱 | `cask_sandbox` 无条件启用，`--adopt` 会先删已有 app 再失败 | 从 `~/Library/Caches/Homebrew/downloads/` 取 dmg，`hdiutil attach` + 手动复制 |
| box-doctor `egress FAIL` | 只在容器启动时跑一次，`docker logs` 看到的是历史记录不刷新；宿主代理（Fake-IP `198.18.0.120` + `HTTP_PROXY=127.0.0.1:58037`）不会自动进容器 | 复测可 PASS；如需容器稳定联网，显式把代理 `-e` 传进容器 |

## 登录与 Router 现状

- **登录是硬前置**：`source/electron-main/account/cursor-auth.ts:26` → `Sign in to Cursor to run Grok Bot.`；后端 `api2.cursor.sh`，OAuth PKCE，机器级账号绑定。**账号权限不足时表现为 "Start a Grok Bot trial"**，不是技术故障，本地无法也不应伪造。
- **Router 四档**：Cursor（默认）/ Claude Code / Codex / OpenRouter。
- **Provider 判定函数**：`source/shared/node/inference-router-local.ts` 的 `getLocalInferenceCliStatus()`。
  - **Codex**：看 `~/.codex/auth.json`，`hasUsableCodexLogin()` 要求 `auth_mode=chatgpt` + access/refresh/id/account_id 四字段非空 + 权限不含 group/other 位 → **本机 TRUE**（零额外 key）。
  - **Claude Code**：`installed` = PATH 有 `claude`；`authenticated` = `~/.claude/.credentials.json` 存在 **或** `ANTHROPIC_API_KEY` 非空 → **本机 FALSE**。注意：**活跃使用 ≠ 凭据文件存在**（有 session/history 不代表 authenticated）。
  - **OpenRouter**：需 API key（Settings → Router 或 `OPENROUTER_API_KEY`）。
- **本地 Docker VM**：默认 `DEFAULT_SAND_BOX_RUNTIME="remote"`，需 UI 显式切。容器 `grok-bot-local-vm`，镜像 `public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest`，`--platform linux/amd64`，6 端口全绑 `127.0.0.1`，schema v6，host-sha256 内容寻址，`READY_TIMEOUT_MS=180000`。`~/.claude`、`~/.codex` 以**只读**挂载复用登录态。

## 本地未提交改动（工作区脏，接手先确认）

`git status` 有 7 个文件改动，分**三条独立线**（别混为一谈）：

1. **Docker PATH 修复** — `source/electron-main/box/local-docker-host-connector.ts`（`resolveDockerBinary()`）。**已打包进 app**（asar 内可检索到）。
2. **OpenRouter 走本地代理 + UI 模型选择** — 解析逻辑已抽到共享模块 `source/shared/node/openrouter-proxy.ts`（base URL / 代理判定 / `listOpenRouterProxyModels()`：拉 `${base}/models`，失败回退 `~/.codex/opencodex-catalog.json` 的 `slug`）：
   - `resolveOpenRouterBaseUrl()`：`OPENROUTER_BASE_URL` → `~/.codex/config.toml` 的 `openai_base_url` → 官方云；
   - `isOpenRouterProxyMode()`：base ≠ 官方云即代理模式，无 API key 放行（占位 `local-proxy`）；
   - `resolveOpenRouterModel()`：`SAND_OPENROUTER_MODEL` → **UI 持久化选择（settings.json `openRouterModel`）** → config.toml `openrouter_model` → `openai/gpt-5.2`；
   - **UI 模型下拉**（2026-09-21 新增）：Router 面板 OpenRouter 档出现 Model 卡片，走新桥 `getOpenRouterModelOptions` / `setOpenRouterModel`（main-edge → rpc/main.ts → preload），选中写 settings.json；首次打开自动持久化列表首项。
   - **已打包并部署**到 `/Applications`。
   - **local-docker 关键约束**：host 在容器 `grok-bot-local-vm` 内跑 bundled 代码，Mac 侧源码改动不会热生效。容器内 `127.0.0.1:10100` 无 proxy，必须起 node TCP relay 转发到 `host.docker.internal:10100`（opencodex CORS 只放行 loopback Host）：
     ```sh
     docker exec grok-bot-local-vm node -e 'const net=require("net");net.createServer(c=>{const u=net.connect(10100,"host.docker.internal");c.pipe(u);u.pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy())}).listen(10100,"127.0.0.1")' &
     ```
     重启容器后需重跑。
   - **模型选择硬约束**：Grok Bot 框架要求模型通过 `send_message` 工具投递文字。不支持 tool_calls 的模型（如 `volcengine-agent-plan/ark-code-latest`）会无限循环重发 prompt。已验证可用：`qianwen/qwen3.8-max`（流式 tool_calls + 参数完整）；`glm-5.3-flash` 调工具但 input 为空。OpenAI 系模型（gpt-6-astra 等）受 Codex 账号 quota cooldown 限制。
3. **Router provider 后端同步**（与代理无关）— `frontend/src/recovered/features/settings/overlay/router.ts`、`contracts/desktop-bridge.ts`、`tests/router-settings.test.mjs`：新增 `get/setInferenceRouter` 桥接，让 UI 选的 provider 落到后端确认。

**验证状态（2026-09-21 实测）**：`source:typecheck` ✅ · `typecheck` ✅ · `npm test` **19/19** ✅（比基线 18 多 1 条新用例）。**未重新 `npm run package`** → 已安装的 `/Applications` app 不包含第 2、3 条线。

## 提交规范

- 小步聚焦提交，说明改动落在哪层：**已审运行时源码 / 可编辑前端 / checksum 固定的打包渲染器 / 仅打包**。
- 不得提交生成产物（`dist`、`.build`、`.cache`、`src/app/dist`、recovery 工作区、本地凭据）。
- 提交前跑：`npm run check` + `npm run frontend:build`；改打包相关再加 `npm run package`。

## 参考文档

`README.md`（总览与快速开始）· `PROVENANCE.md`（产物身份与证据规则）· `NOTICE.md`（权利声明）· `CONTRIBUTING.md`（贡献门禁）· `docs/ARCHITECTURE.md`（两个源根与打包流）· `docs/PUBLISHING.md`（干净历史导出）
