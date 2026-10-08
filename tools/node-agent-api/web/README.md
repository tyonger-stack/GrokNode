# 中文薄客户端接入契约

桌面重复接管：整桌面观看/接管与独立应用接管发送 replace_own_control:true，显式替换同密钥旧控制租约；独立应用观看不替换。控制权只在新票据成功兑换后移交，另一个 credential 保持 409。旧票据遇到更新的控制权不得覆盖；无静默抢占或自动回落。

模型选择见[接口说明](../../../docs/NODE_AGENT_API_MODELS.md)。页面通过 capabilities.models.selection 查询是否支持，获准且通过当前端点连接测试或工具链验收的模型才可选。owner 通过 capabilities.models.management 展开默认值和清单管理；普通用户隐藏管理区。默认为空时需显式选择模型。模型目录失败时禁用新建模型会话，已有会话可读、可继续。TokenHub 的地址、密钥、模型刷新和测试见[专题](../../../docs/NODE_AGENT_API_TOKENHUB.md)。

入口为 `index.html`，相邻静态资源为 `app.js`、`client.js`、`style.css`。主任务需在同源服务中提供这些静态文件（无需 Bearer，页面本身不含数据）；支持根路径或带结尾斜杠的子路径。API 固定为同源 `/v1/`。建议 CSP：`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'`，桌面查看器另按既有规则提供资源。没有内联脚本、第三方资源或新增依赖。

密钥只能手动输入，存于客户端闭包内存，输入框随即清空。刷新、离开页面或“断开并清除”都会清除；不会从 URL、文件或持久存储读取。所有 API 请求用 `Authorization: Bearer …`，禁止跨来源及重定向。服务器仍须执行 scope、bot 归属和租约检查。

连接按钮下方显示验证、加载、成功和错误提示；连接期间按钮显示“连接中…”并禁用。密钥可以是文件原内容，也兼容粘贴 Bearer 前缀（客户端只发送一个前缀）；认证失败会明确提示粘贴文件内容而非路径或命令。只读 JSON 请求在 30 秒后明确超时，取消保持 AbortError；写操作和 SSE 不应用此超时策略，所有请求均不自动重试。

## 能力响应

服务的 `backends` 和 `default_backend` 驱动“新会话执行方式”选择器。创建会话传 `backend:codex|grok`，GET 会话返回固定的 backend 和 capabilities；控制按钮必须使用会话能力，而不是继续沿用服务默认的 Harness 能力。原生模式不发 API 模型覆盖，禁用模型和推理选择，使用 Bot 原生模型。原生 `message`/`send-message` 的 text 内容按用户/助手显示；其他内容保留为 JSON。SSE 轮询只刷新记录，不推断完成。

`GET /v1/capabilities` 的以下字段必须显式为 `true` 才启用；缺失、false、未知值均禁用。能力不是授权，HTTP 错误原样展示。

```json
{
  "writes_enabled": true,
  "sessions": { "independent_conversations": false },
  "events": { "sse": true, "cancellation": true, "required_actions": true },
  "desktop": { "view": true, "control": true },
  "project": { "diff": true, "import": true, "export": true },
  "clipboard": { "read": true, "write": true }
}
```

审批也接受顶层 `required_actions: true`。旧 0.2 的能力只会启用它明确声明的聊天/SSE；`security.desktop_server_enforced` 不当成桌面能力。关联既有机器人不等于创建机器人，不依赖 `writes_enabled`（它原本只约束后端输入/创建 bot）。关闭会话仍可读取记录，但禁用发送、取消、桌面授权、导入和剪贴板写入。

## 请求与响应

所有路径以 `/v1/agents/sessions/{id}` 为前缀，下表另注明绝对路径。

| 场景 | 请求 | 响应要求 |
| --- | --- | --- |
| 机器人 | `GET /v1/agents` | `{data:[{id,name}],has_more,last_id}` |
| 会话列表 | `GET /v1/agents/sessions?agent_id=…` | 同上列表，行包含 `id,agent_id,status,metadata` |
| 关联/复用 | `POST /v1/agents/sessions {agent_id}` | `{id,agent_id,status}`；随后 GET 会话恢复 |
| 恢复会话 | `GET /v1/agents/sessions/{id}` | `{id,agent_id,status,active_turn_id?}`；状态仅代表输入接收，不判定成功 |
| 记录 | `GET …/items` | 标准列表，保留原始字段；text 可直接显示，其余安全显示 JSON |
| 消息 | `POST …/events {events:[{type:"message",text}],idempotency_key}` | 现有 `202 {request_id,status:"accepted",completed:false}`；无自动重试 |
| 取消 | `POST …/events {events:[{type:"agent.session.input.cancel",turn_id}]}` | JSON 响应，只显示请求结果；等权威终态事件 |
| 审批 | `GET …/actions` | 标准列表，仅返回待审批事项；每项必须有 `id`，其余字段完整显示 |
| 审批决策 | `POST …/actions/{id} {decision:"accept"或"decline"}` | JSON 或 204；重新 GET actions 验证待办列表 |
| 差异 | `GET …/project/diff` | `{diff:string}`；只有空字符串才显示空差异 |
| 导入 | `POST …/project/import {files:[{path,content}]}` | JSON 结果原样显示；服务端负责路径/覆盖/权限策略 |
| 导出 | `POST …/project/export {}` | `{files:[{path,content}],…}`，下载完整 JSON |
| 桌面 | `POST …/desktop {mode:"view"或"control"}` | `{url,pauses_agent?}`，URL 必须同源 `/desktop/…`，装入 iframe |
| 交还 | `POST …/handback {}`，成功后 `POST …/desktop {mode:"view",replace_own_control:true}` | 自动切回只读观看，保留桌面画面；观看重连失败明确提示，不能恢复控制 |
| 手动剪贴板 | `GET …/clipboard` / `POST …/clipboard {text}` | 读取 `{text:string}`；写入 JSON 或 204。仅按钮触发，无系统剪贴板 API |

列表消费 `limit=100` 和 `after=last_id` 直到 `has_more=false`，不会静默截断。JSON 错误格式沿用 `{error:{type,message}}`。

## SSE 与工具事件

通过 fetch GET `…/events`，带 Bearer 和 `Accept: text/event-stream`。按 SSE `id` 缓存最近游标于内存；点击恢复发送 `Last-Event-ID`，重读 items 与 actions。断流不会重发任务。无游标的上游错误不会覆盖最近游标。无效游标保留显式错误，用户可断开重连以重新读取历史。

既有 envelope `{id,type,session_id,data}` 继续支持：`node.session.items.changed` 重读记录；`node.session.input.accepted/rejected/unknown` 只更新接收状态；`node.upstream.unavailable` 明示未知。新增 Harness envelope 的 `data` 可为 `{method,params}`：

- `turn/started`：`params.turn.id`；`turn/completed`：`params.turn.{id,status}`，状态不省略、不推断成功。
- `item/agentMessage/delta` / `item/commandExecution/outputDelta` 等：`params.{itemId,turnId,delta}`，按 item 累积字符串，原始工具事件保留在日志。
- `turn/diff/updated`：`params.diff`；含 action/approval 的事件触发重新读取待审批。
- 同时接受类型以 `turn.started/running/completed/failed/cancelled/interrupted/unknown` 结尾的事件，数据中的 `turn_id` 或 `turn.id` 关联回合。

未知事件保留原始 JSON，不伪造完成状态。日志显示区保留最近约 90–100k 字符；持久历史仍属于 API。UI 不实现 Harness、运行时、审批执行或桌面协议。

## 验证

```sh
node --test tests/node-agent-api-web-ui-codex-contract.test.mjs
```

同一测试的真实 Chromium 场景可通过 `NODE_AGENT_UI_BROWSER=1` 开启，并提供 `NODE_AGENT_UI_BROWSER_LOADER`（现有 omo browser skill 的 `scripts/omowright.mjs`）、`NODE_AGENT_UI_EVIDENCE`（证据目录）、可选 `NODE_AGENT_UI_CHROME`。该场景运行独立回环测试服务及临时浏览器 profile，记录实际请求与截图；不调用真实 bot，不证明后端 Harness/桌面/RFB 运行成功。页面中的所有演示数据仅来自测试服务，产品代码没有测试数据或回退数据。
