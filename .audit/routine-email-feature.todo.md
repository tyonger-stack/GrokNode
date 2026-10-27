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
- [x] delegate 实现（分支 feat/routine-email-trigger，4 提交：0c06e39 契约+文案 / 66a6f60 proto+轮询 / 8094fcb 渲染 / 3883bd1 测试）
- [x] review + 测试（逐 diff 审过；自跑 email 10/10、renderer 6/6、webhook+parity 26/26、listener mapping 绿、tsc 双绿；
      delegate 报告全量 npm test 2585 pass / 0 fail / 29 skip；字节锚零改动已 diff 复核）
- [x] 打包部署 + 实机验证（2026-10-27，见 §6）
- [x] 提交推送

## 6. 实机验证实录（2026-10-27）
- 打包：package-macos.mjs 三守卫关闭 + sidecar env；产物 asar 内 102 个 renderer chunk 逐个 node --check 全过；
  RRtEmailLine/RRtEmailCard/官方 zh 文案/mail 图标均在产物 chunk 内。部署 ditto → /Applications，9224 启动。
- 聊天创建（computer-use + CDP）：对主 bot 发「创建例行任务…email 触发…guaer@mail.grokbot.com」→
  agent 调 writeAutomation → 存量 automation.json trigger 逐字节 `{"type":"email","inbox":"guaer@mail.grokbot.com"}`；
  保存时校验走了**降级警告路径**（当时 host 推理凭据续期中），警告文案被 agent 原样转述——设计行为验证通过。
- 行渲染：详情面板例行任务列表出现第三行「新邮件提醒 — 当 guaer@mail.grokbot.com 收到邮件时」，
  与用户官方 0.75.8 截图逐字一致（GBt5+H zh）。
- 详情渲染：指令 / 何时运行（「当 guaer@mail.grokbot.com 收到邮件时」）/ Email 卡（Address 字段
  值 guaer@mail.grokbot.com + 「当有邮件到达此地址时，此 Bot 会被唤醒。」）/ 暂停·测试·编辑·删除。
- 轮询源：容器 /tmp/sand-host.log 实测 60s 一拍在跑；当前因环境级后端不可达
  （privacy-mode lookup ConnectError → api2.cursor.sh，代理环境；同门禁也卡既有 Slack/GitHub relay）
  处于设计内 error+backoff 态；连通恢复后自动转 listening 并在新邮件时触发（messageId 去重、仅 INBOUND、
  from 名单过滤均有单测覆盖）。
- 遗留观察（非本功能缺陷）：杀 app 后 host 推理凭据需「box 重新配发」才能续上；电脑（沙箱）闲置会休眠，
  休眠期间发出的聊天消息不派发 turn，唤醒后需重发。
