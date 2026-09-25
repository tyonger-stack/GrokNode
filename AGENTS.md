<!-- Parent: ../AGENTS.md -->

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

- **登录不再是硬前置**：本地构建的 preload 固定返回 `kind: "logged-in"`（`source/electron-preload/preload.ts:167`），Cursor 云登录入口已移除（`login` 返回 `Cursor cloud login is unavailable in the local-only build.`）。推理凭据全部走 Router 两档 provider。
- **Router 两档**：Codex / OpenRouter（默认 openrouter；UI 标签 TokenHub）。判定函数只暴露 `getLocalInferenceCliStatus().codex`，Claude Code 路径已移除。
- **Provider 判定函数**：`source/shared/node/inference-router-local.ts` 的 `getLocalInferenceCliStatus()`。
  - **Codex**：看 `~/.codex/auth.json`，`hasUsableCodexLogin()` 要求 `auth_mode=chatgpt` + access/refresh/id/account_id 四字段非空 + 权限不含 group/other 位 → **本机 TRUE**（零额外 key）。
  - **OpenRouter**：需 API key（Settings → Router 或 `OPENROUTER_API_KEY`）。
- **本地 Docker VM**：默认 `DEFAULT_SAND_BOX_RUNTIME="remote"`，需 UI 显式切。容器 `grok-bot-local-vm`，镜像 `public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest`，`--platform linux/amd64`，6 端口全绑 `127.0.0.1`，schema v6，host-sha256 内容寻址，`READY_TIMEOUT_MS=180000`。`~/.codex` 以**只读**挂载复用登录态（`localAuthMountArguments()`，目前仅此一项）。

## 本地未提交改动（工作区脏，接手先确认）

`git status` 有 7 个文件改动，分**三条独立线**（别混为一谈）：

1. **Docker PATH 修复** — `source/electron-main/box/local-docker-host-connector.ts`（`resolveDockerBinary()`）。**已打包进 app**（asar 内可检索到）。
2. **OpenRouter 走本地代理 + UI 模型选择** — 解析逻辑已抽到共享模块 `source/shared/node/openrouter-proxy.ts`（base URL / 代理判定 / `listOpenRouterProxyModels()`：拉 `${base}/models`，失败回退 `~/.codex/opencodex-catalog.json` 的 `slug`）：
   - `resolveOpenRouterBaseUrl()`：`OPENROUTER_BASE_URL` → `~/.codex/config.toml` 的 `openai_base_url` → 官方云；
   - `isOpenRouterProxyMode()`：base ≠ 官方云即代理模式，无 API key 放行（占位 `local-proxy`）；
   - `resolveOpenRouterModel()`：`SAND_OPENROUTER_MODEL` → **UI 持久化选择（settings.json `openRouterModel`）** → config.toml `openrouter_model` → `openai/gpt-5.2`；
   - **UI 模型下拉**（2026-09-21 新增）：Router 面板 OpenRouter 档出现 Model 卡片，走新桥 `getOpenRouterModelOptions` / `setOpenRouterModel`（main-edge → rpc/main.ts → preload），选中写 settings.json；首次打开自动持久化列表首项。
   - **UI API 地址输入**（2026-09-23 新增）：Router 面板 TokenHub 档在 API key 之前多出 `API address` 卡片（`RRouterEndpointCard`），走新桥 `getOpenRouterBaseUrl` / `setOpenRouterBaseUrl`，写入 settings.json 的 `openRouterBaseUrl`（存前规范化：trim + 去尾部斜杠；留空即删除该键回退到解析链）。保存后自动重新拉取模型列表。
     - `resolveOpenRouterBaseUrl(persistedOverride?)` 优先级改为：**settings.json `openRouterBaseUrl`** → `OPENROUTER_BASE_URL` → `~/.codex/config.toml` 的 `openai_base_url` → 官方云。host 侧 `provider-session.ts` 的 `readPersistedOpenRouterBaseUrl()` 与 `extension.ts` 的 `persistedOpenRouterBaseUrl()` 各自读 sand root 下的 settings.json 后传入，所以 UI 改地址对 runtime 立即生效，无需重启。
   - **已打包并部署**到 `/Applications`。
   - **local-docker 关键约束**：host 在容器 `grok-bot-local-vm` 内跑 bundled 代码，Mac 侧源码改动不会热生效。
   - **10100 中继已换代（2026-09-24 实测，旧手册作废）**：手动 node TCP relay（转 `host.docker.internal:10100`）已不再需要，不要再跑。现为平台自带 Python L7 中继 `/tmp/ocx-relay.py`（容器 `127.0.0.1:10100` → Mac `11010` 的 `mac-forwarder.mjs`，带 token 鉴权、SSE 安全），随容器创建自动拉起（PPID 0 守护，实测存活 77 分钟+）。排障只查三处：容器 running → `/proc/net/tcp` 有 `0100007F:2774` 且为 LISTEN → 容器内 `curl http://127.0.0.1:10100/v1/models` 返回 200 且 <5s（Mac 侧 11010 要求 `x-relay-token` 头，裸 curl 一律 403；`npm run diagnose` 已把这四项合成一条命令）。
   - **派长任务前先过健康门（2026-09-24 血案）**：容器重建曾导致 00:16 派出的任务静默 14 分钟零推理（transcript 零增长、计数器冻结），00:30 容器就绪后才开跑。长 skill 开工前必须四项全绿：容器 running、中继 LISTEN、代理 200、渲染进程稳定 >5 分钟。检查脚本 `~/.grokbot/health-check.py`（`python3 ~/.grokbot/health-check.py [--repair]`，exit 0=OK / 1=DEGRADED / 2=DOWN）。
   - **模型选择硬约束**：Grok Bot 框架要求模型通过 `send_message` 工具投递文字。不支持 tool_calls 的模型（如 `volcengine-agent-plan/ark-code-latest`）会无限循环重发 prompt。已验证可用：`qianwen/qwen3.8-max`（流式 tool_calls + 参数完整）；`glm-5.3-flash` 调工具但 input 为空。OpenAI 系模型（gpt-6-astra 等）受 Codex 账号 quota cooldown 限制。
3. **Router provider 后端同步**（与代理无关）— `frontend/src/recovered/features/settings/overlay/router.ts`、`contracts/desktop-bridge.ts`、`tests/router-settings.test.mjs`：新增 `get/setInferenceRouter` 桥接，让 UI 选的 provider 落到后端确认。
4. **Grok Node 独立身份（一期，已打包部署）** — 与官方版双开：`source/shared/node/grok-node-identity.ts`（唯一决策点，可执行路径含 `Grok Node.app` 才生效；dev/fidelity/容器内/测试 runner 保持老身份）；`startup/desktop-user-data-bootstrap.ts`（默认 userData `~/Library/Application Support/Grok Node` + `SAND_DATA_ROOT=~/.groknode`，跑在单实例锁之前）；`host/host-paths.ts`（`getSandRootDir` 默认 `~/.groknode`）；`box/local-docker-host-connector.ts`（容器/volume 改名 `grok-node-local-vm*`，端口不动）；`scripts/diagnose-channel.mjs`（探测两个容器名）；`tests/grok-node-identity.test.mjs`（2 用例）。**刻意没碰**：宿主端口（二期才评估）。URL Scheme 已独立：打包版只注册 `groknode`（官方保留 `sand`/`grokbot`，`package-macos.mjs` + `verify.mjs` + `verifyReconstructedUrlSchemeIsolation` 三重把关，解析层仍兼容 `sand:`/`grokbot:`）；Helper Bundle ID 天然不撞（官方是 `.electron-helper` 系）。
5. **指纹隔离二期（URL scheme + 诊断数据根 + 命名 + bot 模板双协议）** — `deep-link.ts` 接受 `groknode:` 协议（canonical 仍输出 `sand://` 保持生态兼容）；**bot 模板链接双协议**（2026-09-25 补丁）：`parseBotTemplateLink` 同时接受 `grokbot://app/v1/bot-template?id=` 与 `groknode://...` 两种协议（canonical 统一 `grokbot://`，跨 scheme 去重）；**打包注册条件化**：`officialGrokBotAppInstalled()` 检测 `/Applications` 与 `~/Applications` 下 bundle id 为 `com.anysphere.sand` 的官方 app——官方在机 → 只注册 `groknode`（不抢官方路由），官方不在机 → 额外注册 `grokbot`（x.ai 分享按钮直达 Grok Node）；门禁规则同步：`groknode` 永远必需、`sand` 永禁、`grokbot` 仅官方在机时禁（`verify.mjs` 与 `verifyReconstructedUrlSchemeIsolation` 共用一套逻辑）。`diagnose-channel.mjs` 的 `resolveMacSettingsPath()` 按容器名/`SAND_DATA_ROOT` 选 `~/.groknode` 或 `~/.grokbot`（原来硬编码 `~/.grokbot`，会对 Grok Node 张冠李戴）；`stepfun-transcribe.ts` 去掉跨 app 的 `~/.grokbot/box-secrets.json` 回退；`main.ts` 打包版 `app.setName("Grok Node")`（菜单/About/Force Quit 分离，CFBundleName 不动）；`coordinator-launcher.ts` 的 `resolveCoordinatorServiceName()` 给 Grok Node 独立 utility 进程名（仅 metrics 用途，非 Mach 服务名）；link-preview UA 身份化。**端口结论（2026-09-25 实证修正）**：官方 Grok Bot **没有本地沙箱功能**——0.18/0.58 官方 asar 均无 `local-docker`/`local-vm`/`docker run` 痕迹（唯一 `docker inspect` 命中是帮助文本），`loopback`(70 处) 是**容器内**机制（host 进程跑在云端 box 容器里、连自己容器的 1337，`box-factory.ts` 摘要："backend: loopback (in-box); image: host's own container"），`sand-box:local` 是容器内镜像变体标记。官方 app 不在 Mac 上绑定 1337/1339/1340/6080/6081/8790/8791（lsof 实证零监听；local-exec-daemon 走 discovery 文件+pid，无 TCP 端口）。因此**官方版与 Grok Node 不存在沙箱端口冲突**；真实冲突面只剩两个重建实例同时跑 local-docker（旧版容器 `grok-bot-local-vm` 即旧重建版所建），11010/10100 归平台中继组件。宿主端口身份偏移据此降级为可选优化。

**验证状态（2026-09-21 实测）**：`source:typecheck` ✅ · `typecheck` ✅ · `npm test` **19/19** ✅（比基线 18 多 1 条新用例）。**未重新 `npm run package`** → 已安装的 `/Applications` app 不包含第 2、3 条线。

## 提交规范

- 小步聚焦提交，说明改动落在哪层：**已审运行时源码 / 可编辑前端 / checksum 固定的打包渲染器 / 仅打包**。
- 不得提交生成产物（`dist`、`.build`、`.cache`、`src/app/dist`、recovery 工作区、本地凭据）。
- 提交前跑：`npm run check` + `npm run frontend:build`；改打包相关再加 `npm run package`。

## 参考文档

`README.md`（总览与快速开始）· `PROVENANCE.md`（产物身份与证据规则）· `NOTICE.md`（权利声明）· `CONTRIBUTING.md`（贡献门禁）· `docs/ARCHITECTURE.md`（两个源根与打包流）· `docs/PUBLISHING.md`（干净历史导出）
