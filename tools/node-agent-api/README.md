# Node Agent API 0.3.0

Node Agent API 是独立的本机服务。原始 GrokNode 管理 bot 和桌面，所有 bot 共用它已经运行的容器与数据。Codex Harness、模型调用和对话保存在 Mac；shell、改文件和测试通过 Docker stdio 执行端进入 Linux。API 不修改或替换 GrokNode 源码、App、host、daemon、登录和启动流程，也不自动启动、重启或新建盒子。

这是借鉴 agents / sessions / events 概念的外部适配服务，不是 OpenAI SDK 兼容实现。当前需求见 [requirements.md](./requirements.md)，机器可读接口见 [openapi.json](./openapi.json)。

## 启动和网页

依赖 Node 26.5.x、Mac 与 Linux 两端 Codex 0.160.0、项目现有依赖和已经运行的 GrokNode 盒子。Linux Codex 使用先前安装的持久目录 /home/box/sand-data/codex-vm；版本不符时明确拒绝，不自动升级。

新盒子可单独安装执行包，不更改 GrokNode 的启动脚本或程序：

```sh
docker exec --user box grok-node-local-vm npm install -g @openai/codex@0.160.0 --prefix /home/box/sand-data/codex-vm
```

容器内不需要复制 Mac 登录文件或模型 API key；exec-server 由连接按需附加，断线后由用户恢复会话。

在仓库根目录运行，先安装锁定依赖：

```sh
npm ci
npm run node-agent-api -- --backend codex --port 18770 --recover true
```

打开 http://127.0.0.1:18770/ui/ 。必须通过 HTTP 服务打开；直接打开 web/index.html 不提供 API。启动输出给出 owner_key_file 路径，不打印密钥。默认是 .lab/node-agent-shared/owner.key，0600；用户手动填入网页。网页只在内存保留密钥，刷新后重新输入。

常用选项：--state、--runtime-state、--container、--workspace、--model、--base-url、--port。默认容器 grok-node-local-vm，共享项目 /workspace/codex-projects/node-agent-api，Mac 会话目录 .lab/shared-runtime。--workspace 可选择 /workspace 下的现有项目；对应 CLI 应使用同一设置。

codex 是共享盒子后端。grok 是显式 legacy gateway 后端，默认只读、共享原始 bot transcript。仓库发布版本不包含旧的每 bot 容器管理或实验 host。

此版本默认使用已有 opencodex 代理 http://127.0.0.1:10100/v1 和 Mac 的 ~/.codex/opencodex-catalog.json；Mac 需要已有 Codex 登录。可用 --base-url 和 --model 指定对应代理端点与模型。API 不替用户安装或修改代理、登录及原 GrokNode 软件。Node 版本遵循仓库 .node-version（26.5.x）。

Ctrl+C 只关闭 API 与它自己的连接、执行端和 VNC 辅助进程，不关闭 GrokNode 或共享容器。Linux 中用户启动的应用按正常应用管理。

## 日常流程

1. 选择原 GrokNode 中的 bot，打开或新建 Mac Codex 会话。
2. 导入项目或使用配置的共享项目；发送任务，观察原生工具记录和回合结果。
3. 查看差异、审批待处理动作、取消当前回合、导出项目。
4. 点击观看或接管。刷新应用列表可选择实际窗口，分别打开终端、浏览器的观看或接管窗口。打开应用须先持有该 bot 的控制租约。
5. 剪贴板仅通过文本框和按钮手动传递。没有自动同步 Mac 系统剪贴板。
6. 用备份按钮保存项目与会话。恢复前会自动备份当前项目；进程内存不恢复。

网页、CLI 与 GrokNode 读取同一份实际 bot/桌面映射。桌面编号可能变化，不使用固定 token=3 或自建编号。单应用 id 是当前 X11 窗口 id，不是授权凭据。

## CLI

```sh
node tools/node-agent-api/client-cli.mjs status BOT_ID
node tools/node-agent-api/client-cli.mjs codex BOT_ID
node tools/node-agent-api/client-cli.mjs resume BOT_ID --thread THREAD_ID
node tools/node-agent-api/client-cli.mjs resume BOT_ID --thread THREAD_ID --prompt "运行测试"
node tools/node-agent-api/client-cli.mjs desktop BOT_ID --session API_SESSION_ID
node tools/node-agent-api/client-cli.mjs desktop BOT_ID --session API_SESSION_ID --application 0xWINDOW --mode view
```

desktop 返回短期授权链接；默认观看。--mode control 明确申请接管。CLI 的 Mac profile 与 API 使用相同目录；网页转 CLI 前先 POST session/handoff，CLI 结束后 POST session/resume 读取同一 thread 的更新。API 不自动重发旧任务。

## 认证与桌面授权

除 /health、/ui/ 静态页面及已签发的 viewer 路径外，REST 使用 Authorization: Bearer。精确校验 Host 和 Origin，无跨域 CORS。派生 key 限定 scopes、bot_ids 与有效期；子 key 不超过父权限，撤销父 key 使后代失效。

| scope | 用途 |
| --- | --- |
| agents.read / agents.write | bot 查询 / 通过原有接口创建 bot |
| sessions.read / sessions.write | 会话与记录查询 / 消息、取消和项目操作 |
| desktop.view | 应用枚举和观看 |
| desktop.control | 接管、交还、手动写剪贴板和打开应用 |
| keys.manage | 管理授权范围内的派生 key |

桌面 ticket 默认 60 秒、最多 300 秒，单次兑换为 HttpOnly、SameSite=Strict cookie，viewer 有效期 15 分钟。应用窗口各自使用 cookie 路径，可以同时观看多个应用；每 bot 只有一个控制租约。观看输入在服务端过滤，交还、会话关闭或撤销 key 断开对应授权。

API 的授权保护 API 入口。原 GrokNode 的 6080/6081 VNC 端口保持原有访问策略，API 没有关闭或改写它们。API bot grants 也不构成共享 Linux 文件系统的 bot 间隔离。

新的 Codex 执行进程为 UID 1000、能力边界为空、no-new-privileges，环境只包含 Linux 必需变量。Mac 模型凭据不复制进 Linux；已验证该执行用户不能读取原容器的 /root/.codex/auth.json。原 GrokNode 的 root 进程和既有挂载保持原样。

## 接口分组

所有 session 路径前缀为 /v1/agents/sessions/{session_id}。

| 接口 | 行为 |
| --- | --- |
| GET /v1/capabilities、/health | 当前后端能力与版本 |
| GET/POST /v1/agents | 原 bot 查询、原接口创建 |
| GET/POST /v1/agents/sessions | 查询、新建独立 Codex thread |
| GET/PATCH session、POST close | 会话资料、metadata、保全式关闭 |
| GET items、turns、traces | 原生记录、权威回合状态、工具及 token 用量；未知成本为 null |
| GET/POST events | 持久游标 SSE、消息和取消 |
| GET actions、POST actions/{id} | 持久审批与 accept/decline |
| POST resume、handoff | 恢复 thread、转交 CLI |
| POST desktop、handback | 授权观看/接管、交还 |
| GET/POST applications | 当前实际窗口、明确打开 terminal/browser |
| GET/POST clipboard | 手动读取/传递文本 |
| GET project/diff、POST project/import/export | 差异、无覆盖导入、带认证的归档导出 |
| GET artifacts/{id}/content | 认证下载 tgz，返回大小与 SHA-256 |
| POST environment/backup、restore | 项目、会话与日志保全/恢复 |
| POST environment/recreate | 共享后端返回 409 managed_by_grok_node；盒子生命周期由 GrokNode 管理 |
| /v1/users、/v1/keys | owner 用户管理、派生授权、轮换与级联撤销 |
| /v1/usage、/v1/webhooks | 配额、持久签名投递 |

消息接受旧的 message/text，以及 agent.session.input.message 的单 input_text 子集。Idempotency-Key 或 idempotency_key 防止同一会话重复提交。202 只表示接受；任务结果看 turns，不能把 idle 当成功。崩溃中的请求记 unknown，不自动重放。

取消使用原生 turn/interrupt，并对该回合记录的 processId 调用该 thread 的 backgroundTerminals/terminate；不会停止共享容器或其他 thread。

## 备份与恢复

Mac 私有备份中保存共享项目归档、完整 Git 目录、未提交修改、选定 Codex profile/会话与 session.json。恢复先检查来源、项目路径和 SHA-256，再保存当前项目。当前恢复是覆盖归档已有条目的方式，不删除归档之外的新文件；不等于整个共享盒子的镜像快照。

项目快照不暂停原 GrokNode 的任务。API 内运行的共享项目任务会阻止恢复，但原程序中的并发写入仍需由用户协调。GrokNode 自行修复或重启盒子后，API 按当前容器/桌面映射重新连接，并从 Mac 读取原 thread。

## 多用户、配额与 webhook

默认每用户 120 请求/分钟、4 条并发流、64 MiB API 会话与 artifact 预留存储。SSE 与 viewer 共用流配额。审计只保存限定元数据，不拷贝请求正文、密钥或对话内容。配额拒绝不会修改已保存会话；磁盘持久化失败会关闭相关操作。

webhook 默认关闭，仅支持数值 loopback HTTP(S) 地址，无 DNS 和重定向跟随。POST /v1/webhooks 配置 destination 并取得签名 key；HMAC-SHA256 的输入是 timestamp.deliveryId.exactBody，签名为 v1=hex。接收端验证 key id、数值 epoch timestamp、签名，并持久去重 delivery id。投递为至少一次，重试保留同一 id；载荷只有事件元数据。支持 key 轮换、持久 outbox、退避、状态查询。traces 是本 API 的 JSON 记录，未声称 OTLP 或 OpenAI SDK 等价。

## 验证与原型

当前共享路径的证据保存在 .lab/shared-harness-verification.json、shared-project-verification.json、shared-cli-verification.json、shared-lifecycle-verification.json 及 service-load-verification.json。未完成的验证不得由旧双容器报告替代。

历史 .lab/api-p0p2、.lab/node-runtime、source/ 下旧实验改动保留为历史，不部署到原程序，也不以删除它们完成迁移。需求与真实证据优先于旧文档。
