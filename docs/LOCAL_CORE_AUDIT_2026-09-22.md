# Local Grok Bot 本地核心能力检查与待确认计划

检查日期：2026-09-22。本文是检查结果与建议计划，不是实施批准，也不表示迁移已完成。

## 1. 范围与结论

- 运行时代码：f70e0da154b0877c7fa9df63229e830fcc7b0707。
- 对比基线：916560b，即默认 OpenRouter、本地 Docker 和移除 Cursor 路线之前。
- 差异范围：66 个文件，489 行增加、2103 行删除。
- 已安装应用：/Applications/Local Grok Bot.app。
- 安装包 host 与容器标签的 host SHA-256 一致：cdce46cdf7e8b1b8a5ebb9cf8b372d6cc88d0a6239ec604c2c688033de672d98。
- 本轮只做源码、历史、隔离诊断、现有测试和只读运行检查；没有修改运行时代码，没有导入模板或向现有 Bot 发消息。

**Local Docker VM 可以承载本地 Bot 通讯、Agent Loop、状态、工具和定时任务。删除 Cursor 计算/推理入口本身不要求删除这些能力。但当前迁移确实存在生产回合阻断和未替换的云依赖，不能宣称本地核心能力已经完整保留。**

Bot 名单、SendToAgent、群聊分发和本地唤醒并未被本次改动删除。最先需要修复的是所有 Bot 回合共同经过的摘要会话绑定。

用户给出的链接已经核实为名叫 dr eggbot 的分享模板，简介说明它通过 CreateAgent 创建 Bot。当前版本不能直接解析该链接，公开分享页也没有提供完整运行配置。

## 2. 原理与方法

参考文章：[How Grok Bot 0.18.0 Works](https://shadown.github.io/blog/posts/2026-09-03_grok_bot_how-it-works/)。这是对发布产物的逆向分析，本文用它提供的分层作为检查线索，具体结论以当前仓库和运行观测为准，不把“模块存在”等同于“生产链路正确”。

本仓库实际结构：

~~~text
Electron UI / preload
  └─ 本地 coordinator → Docker 内 host gateway
       ├─ session / transcript / roster / inbox / run scheduler
       ├─ Agent Loop → TokenHub(OpenRouter-compatible) / Codex 模型调用
       ├─ toolset → Box daemon → Shell / 文件 / Browser / Computer
       ├─ SendToAgent / 群聊 → 本地队列 → 目标 Bot 的下一回合
       ├─ memory / workflows / routines / MCP
       └─ reverse local-exec gateway → Mac daemon → 经授权访问宿主机
~~~

本地化的是执行环境、调度和状态归属，模型请求仍访问配置的 provider。SendMessage 向用户投递回复；SendToAgent 向同实例其他 Bot 发消息；Task 创建子代理；CloudAgent 是另外的 Cursor 云任务；跨用户共享也是独立一层。

检查追踪入口、注册、生产依赖、执行、存储和唤醒，并区分本次直接回归、移除云身份后暴露的残留依赖、原有重建缺口、有意取消的云功能，以及待实测项目。下面源码路径相对仓库根目录，行号对应上述运行时提交。

## 3. 核心能力矩阵

“链路保留”只表示追踪到生产代码连接，不表示通过带真实模型的完整场景。

| 能力 | 当前证据与判断 | 影响 / 后续动作 |
|---|---|---|
| 启动与本地身份 | 实际应用可打开；Router 显示 TokenHub、Local Docker VM ready | 展示本地工作区不再要求 Cursor 登录 |
| Docker 环境 | 容器运行；Chrome 二进制、host bundle、workspace、data root 存在，host hash 对齐 | ready 不能证明每个工具都可执行 |
| New Bot / 主回合 | F01：摘要 session 没交给生产 owner | P0，阻止真正开始推理/执行 |
| Bot 列表 | 当前 GUI 可见 12 个会话条目；roster 来自本地目录/数据库 | 未发现因移除 Cursor 而整体失去枚举能力 |
| Bot 私信 | SendToAgent 注册、目录注入、入队和目标唤醒均保留 | 不依赖 Cursor 消息后端；完整回复仍受 F01 阻断 |
| 本地群聊 | 成员检查、写消息、runGroupTurn 保留 | 不应随 CrossUserSharing 一起删除 |
| Task / 多任务 | 主工具集合、computerUse/browserUse factory 测试通过，生产 Task 配置仍在 | 还须实测完成回传、继续与取消 |
| Shell / 文件 / 后台终端 | Box accessor、daemon 和工具工厂保留 | 修复主回合后验证真实读写、超时和后台任务 |
| Browser / Computer / 截图 / VNC | 工具工厂和端口存在；能力清单与实验 gate 来源不统一 | 工具名称存在不等于桌面可操作；Codex 图片编码见 F05 |
| Mac 宿主工具 | reverse local-exec 使用本地 gateway descriptor，Mac daemon 实际运行 | 云 credential issuer 删除不等于正常本地通道删除；重连待验收 |
| 宿主权限 | host gate、Mac daemon 审批均保留，默认 ask | 必须保留，不能以全部放行替代本地化 |
| RPC / renderer 信任边界 | secrets/coordinator IPC 的可信 sender 检查仍在 | 保留主窗口与 VNC 子页面权限边界，新增导入也应走窄 RPC |
| 剪贴板 / VNC frame | vnc-trust 的隔离与可信 frame 判定、preload 可见性 gate 仍在 | 实际双向剪贴板未测试，不能删除为普通云功能 |
| Secrets / 1Password | safeStorage、secrets IPC、向 Box 推送链路保留；1Password 模块存在 | 账号作用域迁移与 1Password 完整装配未验收，不读取真实凭据 |
| 智能审批 | F07：classifier 仍走 Cursor Dashboard | shadow/enforce 分开处理；enforce 失败不能静默允许 |
| 对话 / 搜索 / 附件 | Session、Transcript、ContentSearch、附件服务和持久路径保留 | 重启恢复、附件往返仍需真实场景 |
| 显式/项目记忆 | FileMemoryStore、update_state、项目分片保留 | 没有证据支持“所有记忆都被删除” |
| 自动记忆整理 | F04：dreaming 等待 authenticated bootstrap | 新合成与旧抽取分别验收 |
| cron Routine | F02：cron 不获准本地调度，生产触发仍来自云端 | 保存成功不代表到点执行，需要本地调度器 |
| 第三方事件 Routine | Slack/GitHub relay 仍请求云端 | 与本地计时分开迁移 |
| MCP / 插件 | F03：生产配置、变更和部分执行仍接 Cursor account/Dashboard | 有本地执行器不等于有独立本地配置链路 |
| workflows / skills | 文件存储、Markdown/URL 工作流导入存在；云技能同步不启动 | 工作流导入不等于完整 Bot 模板导入 |
| Codex 支持 | F05/F06：非文本消息被文本化；刷新与只读挂载冲突 | 普通文本测试不能证明图片、工具续轮和刷新可用 |
| WebSearch / WebFetch | 本地替代实现及相关现有测试通过 | 依赖本地 CLI/配置端点/公网可达性 |
| WebAuthn / 人工接管 | host bridge、coordinator provider、consent/PIN 路径保留 | 未操作真实登录/PIN，未判定能力已丢失 |
| 语音 / 图片生成 | 语音有 StepFun 替代；图片生成模块仍引用 Cursor，factory 绑定需确认 | 语音需独立凭据；不能宣称图片生成已迁移 |
| 数据 / 浏览器状态 / VM 重建 | 只有 workspace/data 两个持久卷；host 更新会重建容器 | 不能由用户文件保留推导浏览器登录态也保留 |
| 手机推送 / 跨用户共享 / CloudAgent | 独立云服务代码仍注册 | 可选云能力需明确禁用/替代，不连带删除本地 Bot 通讯 |
| 官方自动更新 / 遥测 | 重建版构建 guard 禁用官方 updater/Sentry/telemetry，现有测试覆盖 guard | 属于已有重建策略，不是本地 Agent 核心能力丢失 |
| Bot 模板导入 | F09：两个示例链接均被 parser 拒绝 | 可新增，不是已证明的本次删除回归 |

### Bot 通讯证据

- source/host/extensions/session/session-roster.ts:7：本地目录/数据库生成名单。
- source/host/extensions/transcript/roster-projection.ts:96、132：异步名单与同步缓存。
- source/host/host-runner-composition.ts:1485：sendToAgent、agentDirectory、agentGroups 注入 runner；名单排除自己和远端房间。
- source/host/runner/tools/turn-toolset.ts:1373：注册 SendMessage、SendToAgent、CreateAgent、UpdateAgent。
- source/host/extensions/transcript/transcript-manager.ts:556 → background-wakes.ts:81 → agent-to-agent-messaging.ts:52。
- agent-to-agent-messaging.ts:66 查名单，111 入队，119 唤醒，169 开始目标回合。
- source/host/extensions/transcript/shared-rooms.ts:51：本地群成员检查、写入、群回合调度，不能凭文件名判断为纯云模块。

因此“删 Cursor 必然让 Bot 不能互通”不成立，“当前互通已经全部通过验收”也没有证据。

其他边界锚点：source/electron-main/secrets/secrets-ipc.ts:85、124（sender guards），source/electron-main/vnc/vnc-trust.ts:17（frame）、18（隔离）、75（clipboard bridge），source/electron-preload/preload-vnc.ts:155（可见性），source/electron-main/main-production-services.ts:599、610（secrets store / push），tests/reconstructed-updater-guard.test.mjs（打包 guard）。

## 4. 具体发现

### F01 / P0：生产摘要会话绑定被删

**已确认，本次直接回归。** 860bfd6 简化 provider 分支时删除了返回对象的 summarizationSession。source/host/runner/turn-run-shell.ts:187 创建摘要 session，271 只把它放在 sessions.summarization。

source/host/runner/production-turn-agent-owner.ts:218 只查 input.summarizationSession 或 runContext.summarizationSession，221 抛出 “production Agent summarization session is not bound”。

本轮调用真实 createTurnAgentRunContext 的隔离结果：OpenRouter、Codex 均 nestedSummaryCreated=true、ownerSummaryBound=false。没有调用真实模型。错误发生在构建生产 Agent 之前，不只是长对话摘要时才出错。

### F02 / P1：cron 仍由云端掌握触发权

**已确认，移除云凭据后未补本地替代。** source/host/extensions/automations/extension.ts:56 创建云同步客户端，73 创建云 fire consumer，76 的 hub 来源是事件 relay。

sand-automation-cloud-sync.ts:370 的 shouldScheduleLocally 对仅 cron 的任务返回 false；425 无凭据便退出同步。隔离实测 cronAllowedLocally=false，reconcile 未调用 backend。

删除云调度代码前，应先建立本地持久调度、错过触发策略和去重。手工运行 Routine 不能验证 cron。

### F03 / P1：MCP、插件和云技能同步未本地化

**生产依赖已确认。** source/host/extensions/mcp/mcp-service.ts:182—210 仍把 account server provider、writer、effective plugins 和 backend executor 接到 Cursor Dashboard。source/shared/node/mcp/mcp-manager.ts:69 用账号配置源构造工具定义。

source/host/extensions/mcp/extension.ts:5 的技能同步须 peekAccessToken 非空才启动；隔离结果 pluginStarts=0。已有本地工作流文件可读，不证明插件目录、安装、认证可用；旧缓存不能替代全新配置验收。

### F04 / P1：本地能力仍受云实验初始化控制

source/host/extensions/memory/extension.ts:11 将合成绑定至 pinGateOnAuthenticatedBootstrap；source/shared/node/experiments/cursor-experiments.ts:38 没有 authenticated bootstrap 就不执行 pin 回调。

无云身份、无缓存的隔离结果：multitask=true，browserUse gate=false，agentNetwork=false，memoryDreaming=false，memoryPinInvoked=false。browserUse 工厂又在 source/host/runner/tools/sand-computer-use-subagent.ts:34 随可用 Box 提供，需要统一能力决策来源。

不能扩大为“记忆全失效”：memory-service.ts:65 在合成未启用时不暴露 recordMemoryEvidence，source/host/runner/turn-memory.ts:50—59 仍转入旧抽取路径。显式记忆、旧抽取、新合成分别验收。

### F05 / P1：Codex 多模态与工具消息适配不足

**代码级确定的原有本地 provider 缺口，不是本次删除新增。** source/host/extensions/inference/provider-session.ts:211 把非字符串 content 整体 JSON.stringify，角色只保留 assistant，其余统一 user。图片不作为图片块发送，tool 消息不保留原生角色语义。

同文件 272 忽略 _ctx；OpenRouter 请求和 CodexDirectOptions 未接该 context 的取消信号。已有 transport 测试覆盖自己执行工具的分支，不能替代生产 host 执行后续轮场景。补齐图片、tool-call/result 关联、system 指令、取消与上下文续接。

### F06 / P1：Codex 刷新试图写只读登录目录

**配置冲突已确认，属于原有本地模式缺口。** source/electron-main/box/local-docker-host-connector.ts:172 将 .codex 只读挂载到 /root/.codex，容器 inspect 也证实 rw=false。

provider-session.ts:94—118 在 401 后刷新凭据，在 auth.json 同目录写临时文件并 rename。一旦进入刷新就与只读目录冲突。本轮未使用或刷新真实凭据。建议宿主管理刷新，通过受限通道供容器使用，不能把整个宿主登录目录随意改成可写。

### F07 / P1：智能审批分类器仍请求 Cursor

source/host/extensions/auto-review/extension.ts:9 和 sand-backend-smart-mode-classifier-exec.ts:40 接入 Dashboard classifySandAutoReview。source/shared/sand-auto-review-instructions.ts:4 默认开启；source/host/runner/sand-auto-review.ts:65 按 gate 区分 shadow/enforce。

缺少 classifier 不等于所有工具必然被拒绝：默认 gate=false 是 shadow。需要本地明确的分类/人工确认策略，尤其覆盖 enforce 失败。保留本地权限检查，不以“全部关闭审批”作为修复。

### F08 / P2：残留云入口与持久化边界

host-production-extensions.ts:95、118、125 仍注册 CrossUserSharing、CloudAgents、NotifyBus。turn-toolset.ts:1425 暴露 CloudAgent 的条件没有要求可用云身份。应明确禁用/剥离纯云功能，避免 Agent 选择不可执行工具。

local-docker-host-connector.ts:190 在 host 更新时替换容器；209 只指定 workspace/data 卷。浏览器会话 staging 默认路径见 extensions/box-store-sync/chrome-session-stage.ts:10。本轮未发现运行中的 Chrome profile 参数，浏览器登录态跨重建属于未验证风险，不能宣布已经丢失。

8790 是 egress tunnel 端口（source/shared/node/egress-tunnel/box-connection.ts:1），本轮未监听；它不是 VNC 端口，不能据此认定 VNC 失败。是否需要经 Mac 网络访问须单独验收。

### F09 / P2：示例 Bot 模板不能直接导入

用户输入：

~~~text
grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE
https://x.ai/bot/_jOdbfkB16zxu7MRcmReE
~~~

真实 parseSandDeepLink 调用中两者均返回 null，控制样本 sand://app/v1/open 成功。

- source/shared/deep-link.ts:3 只接受 sand scheme / cursor.com 指定路径；第 5 行只有 info、plugin-add、open 三种 route。
- scripts/package-macos.mjs:50—54 只注册 sand scheme。
- 这两处在 916560b..f70e0da 间没有改动，不能说是此次删 Cursor 才删掉模板导入。
- source/shared/agents/agents.ts:11 的内部 templateId 不接受该类大小写和下划线 ID。分享 ID 应单独建模，不能直接放宽文件路径 ID 的安全约束。
- source/host/extensions/transcript/agent-lifecycle.ts:41 有本地 createAgent；agent-session.ts:224 有工作流 Markdown 导入。可复用，但不是完整模板导入器。
- 后续普通 HTTP 读取已成功（HTTP 200）。分享页名为 dr eggbot，简介说它询问偏好后使用 CreateAgent 创建 Bot；公开页面提供 id、botName、description、addHref、color、shape 等预览字段。
- 页面预览没有完整 system prompt、工具/插件清单、技能或 routine 定义，不能仅把 description 写入新 Bot 就宣称完整导入。未猜测下载 API、伪造模板或绕过登录。

可新增“解析链接 → 正常读取公开模板/接收用户导出配置 → 预览 → 创建本地 Bot”。模板下载来源和后续执行环境可分离，不必恢复 Cursor 云执行。

## 5. 验证记录与限制

- 独立 detached worktree 上 npm run check：两套 TypeScript 检查、74/74 测试通过。
- npm run frontend:build 通过。
- 真实模块隔离调用复现 F01/F02/F04 和 F03 的认证启动门槛；诊断结果保存在本地 .cache/local-core-audit-evidence/probes.json。
- 实际 UI：Local Grok Bot；TokenHub；Local Docker VM ready；本地列表可见 12 个会话条目。
- 容器两个持久 volume、host/daemon/Codex 只读挂载。1337/1339/1340/6080/6081/10100 接受 TCP，8790 未监听。仅端口检查不证明工具端到端成功。
- 已安装 host 的内容 hash 与运行容器标签一致。

~~~json
{
  "openrouter": {"nestedSummaryCreated": true, "ownerSummaryBound": false},
  "codex": {"nestedSummaryCreated": true, "ownerSummaryBound": false},
  "cronAllowedLocally": false,
  "backendCallsDuringUnauthenticatedReconcile": 0,
  "multitask": true,
  "memoryPinInvoked": false,
  "pluginStarts": 0
}
~~~

未验证：真实模型完整回合、A↔B 双向对话、群聊轮转、子代理回传、桌面操作与截图理解、cron 到点执行、MCP 真实认证/调用、凭据刷新、WebAuthn、浏览器状态跨 VM 重建。这些均进入下方验收计划，没有被标成通过。

main-agent-tool-parity 测试使用 stub factories，部分 production-provider 测试检查源码字符串，因此 74/74 不能消除上述生产缺口。独立子审查工具因模型路由不可用未运行，本报告不声称通过五路独立审核。

## 6. 待确认实施计划

全部待用户确认。每个行为阶段单独 commit，通过验收后打 tag；保留 local-grok-bot-name-20260922 作为实施前代码基线。不按 cursor 文件名批量删除。

| 顺序 | 交付物 | 验收标准 |
|---|---|---|
| 1 / P0 | 恢复摘要绑定，收紧生产必需依赖，补生产构造测试 | TokenHub、Codex 新 Bot 正常回复，长对话摘要后可继续 |
| 2 / P1 | 本地能力配置，拆除核心功能对云实验初始化的依赖 | 无 Cursor token/Statsig 缓存时名单、通讯、子代理、记忆按明确配置工作 |
| 3 / P1 | 本地 cron 调度、持久运行账本 | 到点、重启、时区、错过触发、重复启动去重、禁用/删除均正确 |
| 4 / P1 | 本地 MCP 配置、stdio/HTTP、认证及 skills/workflows | 新增测试 MCP 后调用、重启仍可用；不请求 Cursor Dashboard |
| 5 / P1 | 两 provider 的多模态/工具/取消协议；宿主 Codex 刷新 | 图片是图片块，连续工具调用正确关联结果，取消终止请求，刷新不写只读卷 |
| 6 / P1 | 本地审批策略、Mac reverse-exec 恢复 | ask/allow/deny、取消、过期审批正确；分类失败走明确人工流程 |
| 7 / P1 | 重启/VM 重建的数据与浏览器状态边界 | 会话、记忆、文件不丢；声明保留的浏览器状态可恢复 |
| 8 / P2 | 新增 Bot 模板导入 | 两种示例链接或配置导入；取不到模板明确失败；预览后创建新本地 ID |
| 9 / P2 | 删除/禁用仅云注册、工具、页面和轮询，更新过时文档 | 不暴露不可用 CloudAgent/共享入口，保留 SendToAgent、群聊、权限、存储 |

步骤 8 设计：

1. 分享模板 ID 与本地 Bot ID 分离，支持 scheme/HTTPS，验证来源。
2. 先核实可合法访问的模板数据协议；没有公开读取能力则支持用户导出的 JSON/Markdown，并列明未覆盖字段。
3. 预览名称、描述、系统指令、头像、技能、工具依赖、routine 定义和不可迁移项。
4. 复用本地 createAgent/profile/workflow/routine store，分配新 ID；失败可回滚本次新建产物。
5. 模板内容作为待导入数据，不在导入时执行指令/脚本/定时任务。凭据和权限由本地用户配置，不继承分享者账号。
6. 检查缺失工具后再启用 Bot；后续执行仍走本地 Docker 与用户所选 provider。

### 必须通过的场景

- 隔离测试 Bot A、B：互相找到、双向异步投递、休眠唤醒、重命名/删除不串号。
- 本地群：成员权限、消息归属、线程和轮转正确，不依赖跨用户云房间。
- 两个并行 Task 完成回传，继续/取消正确，浏览器/桌面子代理得到对应真实工具。
- VM 创建并读回文件；独立测试页面 Browser 点击、Computer 截图，模型能理解截图。
- Mac ask 模式允许才访问测试目录，拒绝不执行，重连不复用过期授权。
- 显式记忆、旧抽取、新后台合成分别验证，再重启读取。
- cron 到点、暂停、重启补偿和幂等；明确 Mac/Docker 停止时的行为，不承诺停机执行。
- MCP、模板导入在全新本地配置下成立，不依赖旧缓存或 Cursor token。

**建议先实施 1—7，建立可工作的本地基础，再接模板导入与云代码清理。若模板导入优先，先做 1，再做仅导入配置、默认不启用的 8。**
