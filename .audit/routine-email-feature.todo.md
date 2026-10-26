# 例行任务邮件功能移植（official 0.75.8 → Grok Node）

需求：用户截图（官方 app）例行任务列表出现「新邮件提醒 guaer@」行，描述「当 guaer@mail.grokbot.com 收到邮件时」。
复刻到 Grok Node。poteto-mode Feature 流程。

## 1. how — 官方证据（全部一手字节）

### 官方架构（三层）
1. **云端收件箱**：用户账户拥有 `@mail.grokbot.com` 地址。
   - 渲染 store `grokBotEmailInbox`（eager-app:7142-7171）：snapshots/retry/create/noteTurnedOn/watchFresh；
     `Rve`: claimed < (multipleInboxesEnabled ? 10 : 1)；每地址状态 assigned/on/gone/unknown（`Lve`）。
   - host 桥（main-app.cjs）：`listGrokBotEmailInboxes` / `createGrokBotEmailInbox`（ jat，`aiserver.v1.GrokBotService` Connect RPC）。
2. **邮件触发例行任务**：trigger `{type:"email", inbox, from?: string[], requireAuthPass?: boolean}`
   （coordinator zod `z6`，与 cron/slack/github/msteams/linear/sentry/pagerduty/webhook 同 union，group=多触发）。
   - **官方在云端运行（temporal harness）**，本地 main-app 无 email 触发运行时逻辑（全文仅桥+schema+渲染）。
   - 官方文案（渲染 `xQe`，eager-app:20345）：
     - EN `GBt5+H`: "When email arrives at {0}"（requireAuthPass !== false，即默认只认已验证发件人）
     - EN `VPsWKN`: "When email arrives at {0}, including unauthenticated senders"（requireAuthPass === false）
     - zh: 「当 {0} 收到邮件时」 / 「当 {0} 收到邮件时（包括未经验证的发件人）」
   - 创建入口=聊天（zh `XPE6v4`：「…请在聊天中让它设置一个监控此收件箱的例行任务…」）。
3. **本地 app**：渲染行/详情描述 + 收件箱设置面 + `email_inbox_claim` 用户批准卡（不在本次范围）。

### Grok Node 现状
- trigger union（shared/automations.ts + sand-state-tool.ts zod）：cron/webhook/slack/github/msteams/linear/sentry/pagerduty + group。**无 email**。
- 自动化全本地运行；webhook=本地 HTTP+key；slack/github=官方后端 `/sand` relay 轮询（backend-relay-source.ts，含 idle/connecting/listening/error 状态惯例）。
- host proto `source/packages/proto/generated/aiserver/v1/grok_bot_connect.ts`（aiserver.v1.GrokBotService，0.18 期 30 个沙箱方法）；客户端惯用法 `createSandCursorBackendClient(GrokBotService, deps)`（box-host-connector.ts:78）。
- 渲染例行任务面=注入扩展 routine-surfaces-renderer-patch.mjs：行 RRtOfficialRow（RRtSummary←RRtTriggerLines 按 " or " 拆 triggerDescription、webhook 正则→globe、其余→clock）；详情 RRoutineDetail（指令/何时运行/Webhook 卡 RRtWebhookCard←RRtCopyField，桥 window.desktop.agent.getAutomationWebhookCredential）。
- describeTrigger（shared/automation-schedule.ts:19）产 triggerDescription；describeListener（shared/automations.ts:10）。
- 0.18 pinned 渲染器图标集含 `"mail"`（registry chunk 实测）。

### 移植后需要的官方 wire 描述符（node-agent-coordinator/main.cjs 提取，字段号+类型码）
- GrokBotEmailInbox|1 email 9|2 domain 9|3 created_at_ms 3|4 assigned 8
- CreateGrokBotEmailInboxRequest|1 username 9|2 display_name 9；Response|1 inbox #0
- ListGrokBotEmailInboxesRequest|1 shows_assigned 8；Response|1 inboxes #0*
- DeleteGrokBotEmailInboxRequest|1 email 9
- CheckGrokBotEmailAddressAvailabilityRequest|1 usernames 9*；Response|1 results #0*；Result|1 username 9|2 email 9|3 availability #0|4 message 9
- SearchGrokBotEmailThreadsRequest|1 query 9|2 inbox_email 9?|3 from_address 9?|4 after_ms 3?|5 before_ms 3?|6 limit 5|7 mode #0
- SearchGrokBotEmailThreadsResponse|1 threads #0*
- GrokBotEmailThreadSummary|1 thread_id 9|2 subject 9|3 message_count 5|4 last_message_at_ms 3|5 participants #0*|6 matching_messages #1*|7 unread_count 5
- GrokBotEmailMatchingMessage|1 message_id 9|2 from #0|3 occurred_at_ms 3|4 direction #1|5 snippet 9?|6 unread 8
- GrokBotEmailAddress|1 name 9|2 email 9
- 枚举：Direction UNSPECIFIED/INBOUND/OUTBOUND；SearchMode UNSPECIFIED/HYBRID/KEYWORD/SEMANTIC；
  Availability UNSPECIFIED/AVAILABLE/YOURS/TAKEN/INVALID/RESERVED/NOT_CONFIGURED；BodyStatus UNSPECIFIED/AVAILABLE/NOT_INDEXED/…

## 2. architect — skip（理由）
官方字节 + 重建版既有惯例唯一决定形态：trigger 形状/文案照抄官方；收件箱经真 GrokBotService RPC；
本地唤醒只能用官方只读 RPC 轮询（官方本地无实现可抄，采用 backend-relay-source 轮询惯例 + listener 状态惯例）。
无开放设计选择。

## 3. Throughput checkpoint
1) 可交接：brief 含全部文件路径/官方串/描述符/惯用法/锚纪律/命令。2) 依赖序：host 类型→proto→模块→poller→渲染→测试。
3) 资产齐：上述档案。4) 我的份：review、打包部署、CDP/实机验证、有序提交。

## 4. 范围决定
- 做：email trigger 全链（类型/zod/描述文案照抄、writeAutomation 接受+inbox 校验、proto 扩展、
  收件箱 list 客户端、本地轮询唤醒（searchGrokBotEmailThreads、按 messageId 去重、from 允许名单本地过滤、
  listener 式状态）、渲染行/详情（mail 图标+官方双语文案+邮箱地址卡）。
- 不做（另行务）：收件箱设置面（agent settings 邮箱地址区）、email_inbox_claim 批准卡、
  agent 读信/回信工具、requireAuthPass 本地过滤（wire 摘要无 auth 字段——存储+展示照官方，不发明过滤）。
- 降级诚实性：后端 RPC 不可达→照存（同 webhook 离线惯例），poller 报 error 状态；inbox 不在账户列表→工具报错列出可用地址。

## 5. 执行记录
- [x] 取证（上文）
- [ ] delegate 实现（分支 feat/routine-email-trigger）
- [ ] review + 测试
- [ ] 打包部署 + 实机验证
- [ ] 提交推送
