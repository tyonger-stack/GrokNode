# 正式版上下文与记忆 harness 本地移植

日期：2026-10-19。范围是正式版共享 host/harness 逻辑及 Grok Node 本地适配，不是独立云端后端的复制部署。

## 正式版依据

| 产物 | 身份与用途 |
| --- | --- |
| `grok-bot-local-vm-before-0712-20261016` 的 host | 镜像标签 `e4c9fc7`，容器内版本文件 `2e0e295`；host SHA-256 `e6d3de1d82c6aaf263efab7e7f50292c2b99be42ffb56743b2b4bb1bc0272cf7`。用于读取工具契约、记忆 scope、相关会话快照。 |
| `fcbae14` host 快照 | SHA-256 `d9dcf2550d6e033fc752852dffc044d34622edfbe9a7421476199761c0ce0946`。用于最新转录格式、虚拟路径、around、搜索权限边界。 |

REA 保留的切片证据：旧容器 `ev_ed284c8cbfb01b7276a661f05289b2961fe78771f583b8ff71eff624329eef3d`，`fcbae14` 切片 `ev_1a18b08c2c108bc3753af4ffeaa4cdd9ee0821991e779733314e5bb8d98efd32`。这些是静态证据，不代表所有云端分支已执行。

正式版行锚：

- 旧 host `716628–716685`：相关会话最多八条、排序、压缩代际快照、新链接更新及已失效链接过滤。
- 旧 host `729950–730105`：RecallMemory 的 agent/user/all，以及有实际私有记忆存储时的 user_bot scope。
- 旧 host `733936–734022`：ReadTranscript 的 self/session/agent/subagent 目标分流与 messages-only 来源。
- 同段工具契约允许可选目标 id 为空字符串；`presentId` 将空值视为未指定。`around` 存在时优先于 `before`。
- `fcbae14` host `765611` 起：transcript-trace，将 reasoning、tool-call、tool-result 转为 thinking、tool_use、tool_result，省略 system、summary 和上下文块。
- `fcbae14` host `766078` 起：`/transcripts/self`、`/transcripts/sessions/`、`/transcripts/agents/`、`/transcripts/subagents/` 虚拟路径和 spoken around 读取。

## 移植与接线

- `source/host/runner/transcript-trace.ts`：正式版结构化转录格式。图片和文件输出占位信息；工具参数、结果单独限长。
- `source/host/runner/transcript-blobs.ts`：摘要归档消息在前、当前 root prompt 消息在后；自读按页加载，最多八个 blob 并发，不再为一次 ReadTranscript 水合全部历史。
- `source/host/runner/sessions/transcript-reader.ts`：统一读取来源和访问检查。session 和 agent 为不同目标；其他会话仅公开消息，子代理须属于当前父会话。
- `source/host/runner/sessions/related-conversations-prompt.ts`：移植正式版相关会话快照算法。
- `source/host/runner/sessions/related-conversations-section.ts`：持久化快照及 `<instructions_update>` 更新，维持代际内已有前缀，新会话链接通过历史更新消息宣布一次。
- `source/host/extensions/session/agent-db.ts`：存储 prompt-section 快照，清空或复制无历史会话时一并清除。
- `source/host/runner/tools/context-tools.ts`：RecallMemory scope、真实存储可用时的 user_bot、四类记忆类型及兼容参数。
- `source/host/host-runner-composition.ts`：真实生产组装，包括 TranscriptReader、自己的 blob 来源、参与的本地群聊会话、其他自有 Bot、快照及历史更新回调。

Node 现有的本地会话来源是 Bot 私聊和本地群聊。参与的群聊使用 `session_id`，其他自有 Bot 使用 `agent_id`；没有把所有 Bot 目录伪装成同一 Bot 的兄弟会话。当前 API 没有新增任意创建同一 Bot 独立会话的界面。

旧记录若没有 prompt blob 引用，则保留已有转录记录的读取能力，不伪造缺失的 reasoning 或工具结果。

## 部署位置

| 层 | 位置 |
| --- | --- |
| Mac 安装包 | `/Applications/Grok Node.app` |
| 打包 host | `Contents/Resources/app.asar` 内的 `dist/host/host-main.cjs` |
| Mac 运行时缓存 | `~/.groknode/local-docker-runtime/<host-sha256>-<daemon-sha256>/host-main.cjs` |
| OrbStack 运行容器 | `grok-node-local-vm` |
| 容器实际执行路径 | `/home/box/sand-host/host-main.cjs`，只读 bind mount |
| 记忆、会话及快照 | `/home/box/sand-data` 持久卷，沿用现有 agent 数据与 SQLite 存储 |
| 工作文件 | `/workspace` 持久卷 |

已安装 ASAR SHA-256：`0f4d34ffab4d787a056cf49759100c75413a7b190df8026e813eb500da2d53a9`。

包内、已安装及运行容器 host SHA-256：`55ba3845bf1a3d533c2f11021af72a929f803742727b6f33c40025c3bf02402c`。

部署前确认没有运行中的回合。旧 App 完整备份于 `backups/Grok Node-before-context-harness-20261019T063651Z.app`，旧 ASAR SHA-256 `57747ac1b2c538cce48edaa37cd3bdbec2e76638e7755a33b0deb64e05b548a4`。部署后容器健康检查正常，新 host 的实际挂载哈希已核对。

修正版部署前的上一候选备份于 `backups/Grok Node-before-context-harness-20261019T065531Z.app`。修正版容器健康检查 `ok: true`、`isBusy: false`，host PID 367；实际挂载源为上述 host 哈希加 daemon 哈希 `f02590ca6f98b46b8a2cceb919aa127a5f3825c2df3952b486bb8b9adca6b1b4` 所组成的缓存目录。

## 验证与限制

- 源码类型检查、前端类型检查和前端构建通过。
- 安装候选及已安装 App 的 strict/deep 签名校验通过；101 个 renderer 脚本语法检查通过。
- 上下文与记忆定向回归 56 项通过。新增正式版契约测试覆盖格式转换、按页 blob 加载、目标分流、虚拟路径、快照更新、快照清除、记忆 scope，以及空目标字段和 around 优先级。
- 完整回归：1976 项，1956 通过，19 跳过，1 失败。失败为 `tests/library-merge.test.mjs:49`；此前已有的未提交 `transcript-media.ts` 时间继承改动使 today/older 计数从 5/2 变成 6/1。本次没有修改该资料库路径；HEAD 源码对照符合原 golden，仅换入该现有改动即可复现。
- 本地 StartFresh 维持正式版 host 的明确拒绝行为。真正的云端 StartFresh、任意多会话控制、团队 SortMemories 等仍依赖未包含在这些 host 包中的服务端流程。
- 未开启正式版默认四类之外的可选 notes/library 存储；没有凭名称或枚举把服务端能力标记为可用。

安装产物隔离验收：直接从 `/Applications/Grok Node.app` 的 ASAR 提取并核验 host 哈希，在内存中移除启动入口、导出实际打包的工具函数；没有改写已安装文件。以合成摘要归档、合成当前消息和临时 FileMemoryStore 调用真实工具执行入口，ReadTranscript、SearchTranscripts、ReadTranscriptFile、RecallMemory 四项均成功并返回预期内容。进程使用空环境、临时数据根和 Node permission，未授予网络权限；tree-sitter 初始化使用本仓库已有的本机 native 依赖。此证据覆盖实际包内工具执行，不覆盖模型选用工具、真实生产组装和模型参数生成。

先前候选的真实模型探测曾观察到四个工具调用，但 ReadTranscript、SearchTranscripts 返回错误。该次证据不计为通过，临时 Bot 已删除。修正版的真实模型复测被自动审批拒绝，理由是模型请求可能携带持久记忆或系统提示，未获向该模型目的地发送具体敏感数据的明确授权；没有绕过拒绝。因此真实模型端到端验收仍未完成。

部署与 QA 记录保存在 `/private/tmp/grok-context-official-port-20261019/`，包括 `deployment.json`、`package-fixture-qa.mjs` 和 `package-fixture-qa.json`。全量测试日志为 `/private/tmp/grok-context-official-port-full-fixed-20261019.log`。

## 提交前复核（2026-10-19）

用户随后要求将全部未提交改动按功能分组提交。复核发现资料库补时间逻辑的注释和测试都限定旧用户附件，实际代码却让所有无时间戳的 Bot 产物继承上一条时间。已将继承范围限定为 `user-attachment`，保留旧用户附件的补时间能力，并增加 Bot 产物不继承的回归；未修改原 golden。前端与源码类型检查通过，完整测试 1977 项，1958 通过，19 跳过，0 失败。日志为 `/private/tmp/groknode-submit-full-tests-20261019.log`。这是源码提交前验证，未重新部署此资料库修复。
