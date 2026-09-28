# 飞书私聊 webhook 复刻方案（Grok Bot 0.59 → Grok Node）

日期：2026-09-26｜状态：Wave 1/2/3/5/6 已实施并部署（2026-09-28，最终构建 37815be4 = main@1183d14 = release v0.18.0-reconstructed.2，含 webhook 与全部 i18n），Wave 4 自动化项全绿，真实飞书与暂停恢复待用户配合
参考：官方 `/Applications/Grok Bot.app` = Grok Bot 0.59.1（asar sha256 `3d7eb92e018966c8fec65067ae264a2f3135c65eedefd869688bce7d8184e562`；契约与行内 toggle 在 0.59.0 / 0.59.1 间未变，0.59.0 的证据取自自更新前的 asar `b6b95953…`）
目标：本地 `/Applications/Grok Node.app` = 0.18.0-reconstructed（asar sha256 `a5067582d112ac4cf73652375f88c93fbae4c4777d135da9774e876f7f03670b`）

## 一、结论

Node 侧已经有 webhook routine 的完整骨架（trigger 类型、per-routine key、17901 监听、host 唤醒、agent 侧 key 生命周期、云同步排除），现有 9 项 webhook 回归测试全绿。反复出 bug 的原因不是缺功能，而是**接收语义与官方不一致**，外加一个 Mac 桥的自愈缺口。我在隔离 fixture 上实测复现了 5 个真实缺陷，其中 3 个直接导致「暂停后消息丢失」和「多 bot 同名例程串凭据」。

另外必须说清一条边界：官方 0.59 的 webhook 是**云端接收**（`https://<backend>/automations/webhook/<serverAutomationId>`，key 由 x.ai 后端签发、本地仅用 safeStorage 缓存），需要登录态与后端，无法在本地复刻。Node 做的是**本地等价语义**：URL 保持 `/webhook/<agentId>/<automationId>`、key 本地签发，但接受/暂停/删除/幂等的行为必须与官方一致。UI 目标对齐 0.59（列表行 toggle + 详情页凭据 + 编辑预填）。

## 二、官方 0.59 的 webhook 契约（从安装包提取）

证据：`/Applications/Grok Bot.app/Contents/Resources/app.asar`，`dist/electron-main/main-app.cjs`、`dist/renderer/assets/chunk-automation-detail-panel-CKsK3h84.js`、`dist/renderer/assets/index-drwq4Lxo.js`。

1. Trigger 词汇：`{type:"webhook"}` 是触发器联合类型的一等成员（`main-app.cjs` 内 `ZM = z.object({type:z.literal("webhook")})`）。
2. 列表行开关：`index-drwq4Lxo.js:7955-7963`（0.59.1 为 `index-mPcyq2XX.js` 同位置，行内 toggle 已复核仍在）—— 每行右侧渲染 `Gj` toggle（`isChecked=m, label=*, onToggle`），点击调 `d.setEnabled(agentId, automationId, next)`，失败调 `ra(...)` 埋点并回退 `f(null)`。0.59 新增的就是这个行内 toggle（用户截图的红框）。
3. 详情面板四个动作：`chunk-automation-detail-panel-CKsK3h84.js:295-307`（0.59.1 为 `chunk-automation-detail-panel-CKsK3h84` 同名同构）—— 暂停/恢复（`setEnabled`）、立即运行（`runNow`，仅本地例程有）、编辑、删除（`remove` + 确认弹窗）。
4. 编辑不是表单：`chunk-automation-detail-panel-CKsK3h84.js:299` —— 点「编辑」执行 `d(i18n('hsz5he', {0: name}))`，把 `编辑你的例行任务：{name}` 种进聊天输入框，由 agent 自己用 `update_state` 改例程。
5. 凭据获取：renderer 调 `getAutomationWebhookCredential({id: agentId, automationId})`，host 侧先 `listGrokBotAgentAutomations` 定位例程、校验 `hasTriggerOfType(g.trigger,'webhook')`，再 `createAutomationWebhookApiKey({automationId: serverAutomationId})` 换 key，最后返回 `{url: backendUrl + '/automations/webhook/' + serverAutomationId, key}`。
6. key 存储：`main-app.cjs` 内 `dNe(...)` —— 目录 `userData/automation-webhook-keys`，文件名 `sha256(JSON.stringify([backendUrl, accountScope, agentId, automationId])).hex + '.bin'`，内容 safeStorage 加密的 `{version:1, createdAt, key}`，`createdAt` 与例程不一致时重新签发；例程删除时 `remove(...)` 连带删文件。
7. 0.59 官方**没有**本地 HTTP 监听器：asar 里 `17901`、`webhookListenerPort`、`createServer` 均无命中，`/webhook/` 只出现在 URL 拼装处。

## 三、Node 侧现状（已核实）

代码：

- `source/electron-main/webhook-automation-listener.ts` —— `POST /webhook/<agentId>/<automationId>`，Bearer 鉴权，64 KiB 上限，JSON 对象原样 spread，任意 body 变 `{text}`，返回 `deps.forwarder.runAgentWebhookAutomation()` 的状态码。
- `source/host/extensions/transcript/automation-runtime.ts:479-523` —— `runAgentWebhookAutomation`（校验例程/webhook trigger/key，然后 `void this.runAutomationForEvent(...)` 后立刻回 202）与 `getAutomationWebhookCredential(automationId)`（active session first，miss 后 fallback `listAllAutomations().find(...)`，返回 `{agentId, automationId, url, key}`）。
- `source/host/automations/webhook-credentials.ts` —— 32 字节随机 hex key，`webhook.json` 存在例程目录，`timingSafeEqual` 比对。
- `source/host/extensions/memory/agent-state.ts:46-63` —— agent 侧 create 时签发 key、update 离开 webhook 时删 key、delete 时删 key。
- `source/host/extensions/transcript/automation-event-fires.ts` —— 750ms debounce 批量合并事件，队列只在内存 `pendingEventFireBatches`。
- `source/host/extensions/transcript/automation-run-path.ts:109-364` —— `fireAutomation`；`isEnabled` 的唯一检查在 `spendGuard.apply()`（第 142-155 行，丢弃原因记 `user_away_paused`）。
- `source/host/automations/automation-trigger.ts:18-19` —— `describeTriggerEvent` / `buildTriggerEventContextBlock` 只对 `source==='webhook'` 走 webhook 分支与 `<webhook_event>` 块。
- `source/electron-main/main-edge.ts:224` + `source/electron-preload/preload.ts:342` —— `getAutomationWebhookCredential` RPC 只透传 `automationId`，**丢掉 agentId**。
- `frontend/src/extensions/webhook-credential-entry.ts` —— 把凭据卡注入 0.18 固定渲染器的表单编辑器，锚点 `.sand-automation-detail input[aria-label="Name"]`；缓存 key 仅为 `automationId`。
- `tests/local-webhook-automations.test.mjs` —— 9 个用例，本轮实测 9/9 通过。

运行时：

- 17901 被 Grok Node 主进程持有（PID 77949，`/Applications/Grok Node.app`，其 network/node helper 的 ppid 均为 77949）。官方 0.59 自己不监听该端口，所以**双开不抢端口**（这条怀疑已排除）。官方在核查期间自更新到 0.59.1，契约与 toggle 未变。
- Mac 桥 `~/.groknode/feishu-inbox/`：`bridge.py`（lark-cli `event consume im.message.receive_v1 --as bot`，jq 粗滤 p2p+chat_id+sender_type=user，python 精校 chat_id，按 `message_id` 去重，POST `127.0.0.1:17901`，timeout 60s）、`run.sh`（崩溃自愈循环）、`bridge-watch.sh`（60s 看门狗）、`spawn.py`（`os.setsid()` 脱离会话）、`webhook.key`（0600）、`state.json`（seen/replied，TTL 7 天）。
- 容器 `grok-node-local-vm`（up 2h）内 `lark-cli` 供 bot 回复用，Mac 长连接侧凭据在钥匙串（已 keychain-downgrade 到 `~/Library/Application Support/lark-cli/master.key.file`）。
- 桥的 launchd 自启 plist 已在 `~/Library/LaunchAgents/com.groknode.feishu-bridge-watch.plist`，但**未注册**（我的沙箱 `launchctl bootstrap gui/501` 恒报 `5: Input/output error`），需用户在自己终端注册。

## 四、实测复现的缺陷（隔离 fixture，未触碰真实数据）

复现方式：用 esbuild 把 `automation-runtime.ts` 打成 CJS，在 `node_modules/.cache` 下建临时 sandRoot 与例程目录（`webhook.json` 用固定测试 key），注入假 tm/session/runner，然后调 `runAgentWebhookAutomation` / `fireAutomation`。

### A1（致命）暂停期间到达的消息被永久吞掉

`isEnabled=false` 的 webhook 例程：`runAgentWebhookAutomation` 返回 `{ok:true,status:202}`，事件照样入队；750ms 后 `flushEventBatch` 调 `fireAutomation`，`spendGuard.apply()` 发现 `isEnabled!==true` 才丢弃（`reportAutomationFireDropped` 记 `user_away_paused`）。而飞书桥在收到 202 的那一刻（早于 flush）已经把 `state.seen[mid]=now` 并落盘。

结果：暂停期间的消息在桥侧被 ACK，在 host 侧被丢弃，两边都不会重投。恢复后这条消息永远不回来。实测输出：`{"probe":"paused webhook","http":202,"dispatchedBatches":1,"enabledAtDispatch":false}`。

### A2 入队后暂停或删除，已入队事件仍会执行

先入队（debounce 750ms），在 `runLifecycle.enqueueExclusiveRun` 回调里把例程置 disabled 或删掉：`fireAutomation` 仍 `runner.run()` 成功。实测四种场景：

```
enabled            runnerCalls=1 outcome=ok
disabled-before    runnerCalls=0 outcome=null drops=[user_away_paused]
disabled-in-queue  runnerCalls=1 outcome=ok     ← 缺陷
deleted-in-queue   runnerCalls=1 outcome=ok     ← 缺陷
```

原因：`isEnabled` 与例程存在性只由入队时传入的 `automation` 快照决定，执行前无二次校验；入队用的快照在 `enqueueEventAutomationFire` 里被 `batch.automation = args.automation` 固定。

### A3 凭据按 automationId 全局 first-match，多 bot 同名例程串

bot-a 与 bot-b 都有 `same-routine` 时，`getAutomationWebhookCredential('same-routine')` 无条件返回 bot-a 的 `url`+`key`（实测 `resolvedAgentId=bot-a`）。而 0.59 官方签名是 `{id: agentId, automationId}`。Node 的 RPC 层丢 agentId、host 层 fallback 全局 `find`，导致打开 bot-b 的例程可能显示 bot-a 的凭据，桥拿错 key（401/404 或唤醒错 bot）。这解释了「多 bot / 同名例程时 webhook 时好时坏」。

### A4 载荷 source 被外部字段抢占，正文读不到

`runAgentWebhookAutomation` 用 `{source:"webhook", ...payload}` 展开，桥发 `{"source":"feishu-p2p", ...event}` → 最终 `source="feishu-p2p"`，不是 `webhook`。`describeTriggerEvent` 只认 `source==='webhook'`，feishu-p2p 落到 fallback 分支（取 `event.event`/`event.title`，都是 undefined）→ runs.json 事件摘要为空，`<webhook_event>` 块名退化为 `trigger_event`，且 `describeTriggerEvent` 取 `event.text`，而桥的正文在 `content`/`message` 字段 → bot 的 wake 里读不到消息正文。

### A5 重启丢事件

事件只在内存 `pendingEventFireBatches`，750ms 窗口内进程退出即丢；桥已收 202 认为成功。官方云端有持久事件流 + `runUuid` 幂等。

### A6 Mac 桥自身

任何 2xx 都记 seen（与 A1 联动吞消息）；不在 launchd 里，重启/登出后要手动跑 `bridge-watch.sh`；`webhook.key` 是启动时读一次的静态副本，例程轮换 key 后桥不会热更新（下次重启才生效，期间全 401）。

### A7 UI 与 0.59 的差距（非 bug，属复刻范围）

0.59 = 列表行 toggle + 详情面板（凭据/暂停/立即运行/编辑/删除）+ 编辑种 prompt。Node 跑的 0.18 固定渲染器没有列表行 toggle、没有详情面板结构，现有凭据卡是注入旧表单编辑器。0.18 fidelity 包混 0.59 chunk 会破坏 checksum 基线，所以只能按 0.18 DOM 复刻外观，不能搬 0.59 chunk。

## 五、实施方案

### Wave 1 — host 端语义修正（最高价值，独立可测，先做）

1. `automation-runtime.ts` `runAgentWebhookAutomation`：
   - 保留例程存在 / webhook trigger / key 校验。
   - 新增 `isEnabled` 前置检查：未启用返回 `{ok:false,status:409,message:"routine is paused"}`，不入队（A1）。
   - 载荷归一：`source` 固定 `"webhook"`；body 原始字段收进 `data` 子对象；`text` 从 `text`/`content`/`message` 取第一个非空字符串；`idempotencyKey` 从 `message_id`/`id` 取（A4）。事件形状固定为 `{source:'webhook', text, data:{...raw}, idempotencyKey}`，不再 spread 覆盖保留键。
2. `automation-event-fires.ts` / `automation-run-path.ts` 执行时二次校验：flush 真正执行前用 `session.automations.get(automationId)` 重新取；取不到 → 丢弃记 `automation_deleted_before_run`；`isEnabled!==true` → 丢弃记 `routine_paused_before_run`（A2）。入队只 pin `automationId`，不 pin 快照。
3. webhook 幂等：`AutomationEventFires` 增内存 LRU（TTL 7 天，key=`idempotencyKey`）；命中已完成 key 直接回 202 跳过。跨重启由桥的 seen 兜底（A5 的一部分）。
4. 凭据按 `{agentId, automationId}` 解析（A3）：
   - RPC 签名改为 `getAutomationWebhookCredential({id, automationId})`（preload 传 agentId）。
   - host 端改为 `(agentId, automationId)`，先 `active.id===agentId` 查 active session，再 `sessionStore.listAgentAutomations(agentId)`，**去掉全局 find fallback**。
   - `webhook-credential-entry.ts`：从行 dataset 取 agentId，缓存 key 用 `agentId::automationId`。
5. 落测试（红→绿），在 `tests/local-webhook-automations.test.mjs` 扩 5 条：暂停返回 409 不入队；入队后删/暂停不执行；source 归一为 webhook 且 text 从 content 兜底；跨 bot 同名例程凭据不串；webhook 幂等 key 命中跳过。

### Wave 2 — Mac 桥加固（已实现并部署，2026-09-26）

版本化源码：`scripts/feishu-inbox/{bridge.py,delivery.py,run.sh,test_bridge.py,plist}`，部署到 `~/.groknode/feishu-inbox/`（旧版备份 `backup-20260926-232352/`）。

1. **状态分流**（`delivery.py`）：2xx → seen；409/5xx/网络错 → pending + 指数退避（5/10/30/60s 封顶 60s，TTL 7 天）；401 → 先热刷新 key 再重试一次，刷新成功且重试 202 → seen，刷新无变化或重试仍 401 → dead；404/其他 4xx → dead。
2. **key 热更新**：canonical = 容器内 `webhook.json`（`docker exec cat`，60s 周期比对 sha256），fallback = 本地 `webhook.key`；启动时 canonical 优先，轮换后仅换内存值，日志只记 source 不记 key。
3. **状态持久化**：`state.json` v2（seen/pending/dead），旧 `replied` 字段自动迁移进 seen；tmp + `os.replace` 原子写，0600 权限。
4. **单实例**：`fcntl.flock` 文件锁（句柄保活在模块级全局），第二个实例立即退出 rc=0，杜绝 launchd + 手工双消费者。
5. **launchd 已注册成功**（此前 error 5 是旧注册残留，bootout → bootstrap 解决）：Label `com.groknode.feishu-bridge-watch`，直接跑 `run.sh`（exec bridge.py），KeepAlive 即看门狗；launchd 最小 PATH 缺 `/usr/local/bin`（docker/node）已在 bridge 启动时补齐。
6. **测试**：`scripts/feishu-inbox/test_bridge.py` 12 条（状态分流全表、退避表、409 恢复、401 轮换恢复/不轮换 dead/轮换后仍 401 dead、404 dead、网络错 pending、旧格式迁移、原子写权限、日志无 key 无正文），经 `tests/local-feishu-bridge.test.mjs` 并入 `npm test`（全量 221/221）。

### Wave 3 — UI 对齐 0.59（可选，低优先）

1. 列表行 toggle：在 0.18 的 `button.sand-routine__row[data-routine-row]` 右侧注入 toggle，点击调 `setAgentAutomationEnabled`，与详情/pending 状态共用；外观按 0.59 截图复刻（不引入 0.59 chunk）。
2. 详情凭据卡：0.18 无详情面板结构，保留现有注入位置，视觉对齐 0.59（URL/Key/Header 三行 + 提示语），并明示「本地 URL，不要打到官方端点」。
3. 「编辑」预填：0.59 点编辑种 `编辑你的例行任务：{name}` 进聊天框。0.18 无此 seam，**不造假按钮**；编辑走 agent 侧 `update_state`（已支持，见 `preserveWebhookTrigger`）。此条标为 evidence-only 差异。

### Wave 4 — 端到端验收

1. 自动化（我能跑）：`npm test`（含新增 5 条）+ `npm run source:typecheck` + 隔离 fixture probe 全绿。
2. 合成 POST（我能跑，只打本地 17901、用本地测试 key）：启用 → 202；暂停 → 409；删除 → 404；错 key → 401；同 idempotencyKey 二次 → 202 且不新增 run。
3. 真实飞书私聊（需用户发一条消息，我不能代发）：bridge.log 出现 `wake <mid> -> 202`；容器 `runs.json` 新增 `event/status:ok` 且 event 摘要是 `a webhook call: "<正文>"`；bot 在私聊回一句。
4. 暂停/恢复端到端：暂停 → 用户发消息 → bridge 落 pending → 恢复 → 自动补投 → bot 收到。删除 → 用户发消息 → bridge 记 dead 一次不再重试。

### Wave 5 — 按 OpenMausBot 接收器语义补齐通用 webhook 能力（2026-09-27 已实施）

对标分析：`/Users/Apple/Documents/grokbot/OpenMausBot` 的 `server/webhooks.ts`（状态层）+ `server/webhook-ingress.ts`（HTTP 层）。其设计分层清晰：ingress 只做鉴权/解析/头提取，WebhookManager 管幂等回执/限流/事件过滤/投递模式。Grok Node 已有 Wave 1 的接收语义修正，本轮吸收其**通用发送方**能力，不改飞书链路的外部行为。

已采纳（六项）：

1. **`GET /health`**（`webhook-automation-listener.ts`）：无鉴权存活探针，返回 `{ok:true,service:"grok-node-webhook-automation"}`，带 `cache-control:no-store` + `nosniff`。供 `~/.grokbot/health-check.py` 与看门狗探测。
2. **能力 URL 兜底**：`POST /webhook/<agentId>/<routine>[/<key>]` 第三段作为 key，给无法设置 Authorization 头的平台（GitHub 等）；Bearer 头仍优先，密钥尽量不进 URL/日志。
3. **Content-Type 感知解析**：JSON 系 content-type 解析失败回 400（不再静默降级成 `{text}`）；`application/x-www-form-urlencoded` 解析成对象；无标签发送方保留宽松旧路径（JSON 对象照 spread，否则 `{text}`）。
4. **头提取元数据**：deliveryId 取 `idempotency-key`/`x-webhook-id`/`x-github-delivery`/`webhook-id`，eventName 取 `x-github-event`/`x-webhook-event`/`x-event-type`/`ce-type`；连同 content-type、user-agent 一路透传（gateway 白名单已放开），进事件 `meta` 子对象渲染进 `<webhook_event>` 块；**头部 delivery id 优先于 body 的 message_id 作幂等键**。
5. **每端点限流**：滑动窗口 30 次/60 秒（`WEBHOOK_RATE_LIMIT`），超出回 429 + `Retry-After`；限流在鉴权后、读 body 前判定。桥同步把 429 归类为可重试（原表会误判 dead），已部署重启。
6. **幂等回执持久化 + 提示词截断**：`webhook-receipts.json` 存例程目录（上限 1000 条、TTL 7 天、原子写），跨 host 重启仍能去重（补 A5 对通用发送方的缺口）；`buildTriggerEventContextBlock` 序列化超 48K 字符截断并加 `[Payload truncated by Grok Node]` 标记。

刻意不采纳（OpenMausBot 有、Node 不做，含理由）：密钥哈希存储+一次性展示（Node 靠 webhook.json 明文重展示，本地单用户设计，凭据卡需要回显）；secret 轮换 UI（无 0.18 DOM 锚点，Wave 3 之外另议）；eventTypes 过滤（trigger schema `{type:"webhook"}` 无配置位，例程即单一用途）；`delivery:"post"` 直投聊天、验证捕获流、256KB body 上限（Node 保持 64KB）、attempts 审计日志（runs.json + 桥日志已覆盖主要排查路径，先观察再说）。

验证：`tests/local-webhook-automations.test.mjs` 20/20（新增 6 条：health/能力URL/表单/坏JSON/头透传、限流、元数据入提示词、截断标记、回执跨重启）；`tests/local-feishu-bridge.test.mjs` 1/1；`source:typecheck` + `typecheck` 双绿；esbuild 编译真实监听器后 curl 实测八种请求全符合预期（health 200、bearer/path-key 202、GitHub 头透传、form 解析、坏 JSON 400、无 key 401、第 31 次请求 429+retry-after=60）。

## 六、边界（Must NOT）

- 不碰官方版（`com.anysphere.sand`）的 URL scheme、userData、沙箱、端口。
- 不把 0.59 renderer chunk 混进 0.18 fidelity 包（破坏 checksum/校验基线）；UI 只做注入。
- 不在 UI、日志、bot 回复里打印 webhook key（`agent-state.ts` 已保证 key 不进 reply，保持）。
- 不改 local-docker 端口/容器名。
- Node 的 webhook URL 形状是 `/webhook/<agentId>/<automationId>`（本地），与官方 `/automations/webhook/<serverAutomationId>`（云端）不同；UI 上要说明，别拿 Node 的 URL 打官方端点。

## 六·二、Wave 6 — 飞书事件订阅 webhook 推送入口（Tailscale Funnel 公网）（2026-09-27 已实施）

背景：lark-cli websocket 长连接反复断连重连，需要一条不依赖长连接的入站路径：飞书开放平台「事件订阅 → 将事件发送至开发者服务器」直接 HTTP 推送到本机。飞书要求公网可达的 HTTPS 域名，用 Tailscale Funnel 提供：`https://macbook-pro.tailef0921.ts.net`（443）→ `127.0.0.1:17902`。

新增（仓库 `scripts/feishu-inbox/`，已部署 `~/.groknode/feishu-inbox/`）：

- `feishu_webhook_ingress.py` — 公网入口：`POST /feishu` 应答 `url_verification` 挑战；加密体用 CommonCrypto AES-256-CBC 解密（key=sha256(Encrypt Key)、iv=key[:16]，`FEISHU_ENCRYPT_KEY` 可选）；验证 token 首见即固定（TOFU，`ingress-token` 0600，此后不匹配回 403）；过滤规则与 bridge.py 一致（p2p + 指定 chat_id + sender=user）；命中事件复用 delivery.py 状态机（独立 `state-webhook.json`：暂停 409 → pending 退避补投；key 每 60s 从容器 webhook.json 热更新；launchd PATH 已补齐）；`GET /health` 无鉴权探针。日志不落 key 与正文。
- `com.groknode.feishu-webhook-ingress.plist` — launchd 常驻（RunAtLoad + KeepAlive），已注册。
- `test_ingress.py`（10 条，经 `tests/local-feishu-bridge.test.mjs` 并入 npm test）。

与旧桥的关系：lark-cli 长连接桥（`com.groknode.feishu-bridge-watch`）保持原样未动；两边各自按 message_id 去重，17901 的 webhook-receipts 幂等兜底双路重复。长连接恢复后两者并存安全；webhook 模式稳定后可 bootout 旧桥。

安全面：Funnel 只暴露 ingress 的 `/feishu`、`/health`、`/` 三个路径，17901 监听器本身不经公网。url_verification 不校验 token（飞书控制台保存 URL 的第一步），真实事件强制 token 匹配。重置 TOFU：删除 `ingress-token` 文件即可（服务每请求重读，无需重启）。

验证（2026-09-27 实测）：单测 10/10；`GET /health` 经公网域名 200（外部抓取视角复验）；`POST /feishu` url_verification 经公网域名挑战回显 + TOFU 固定生效；launchd 重启后 `key-loaded source=canonical`。待用户操作：飞书开放平台把事件订阅切换为「发送至开发者服务器」并填入上述 URL；若开启了加密策略，把 Encrypt Key 配进 plist 环境变量 `FEISHU_ENCRYPT_KEY`。风险：飞书服务器到 `*.ts.net` Funnel 边缘的大陆可达性未证——控制台保存 URL 会即时发 url_verification，保存成功即证明可达；失败则需换公网中转方案。

## 七、附：本文引用的关键实测输出

```
# A1 暂停仍 202 且入队
{"probe":"paused webhook","http":202,"dispatchedBatches":1,"enabledAtDispatch":false,"payloadSource":"feishu-p2p"}
# A2 入队后禁用/删除仍执行
{"probe":"enabled","runnerCalls":1,"outcome":"ok"}
{"probe":"disabled-before","runnerCalls":0,"outcome":null,"drops":["user_away_paused"]}
{"probe":"disabled-in-queue","runnerCalls":1,"outcome":"ok"}
{"probe":"deleted-in-queue","runnerCalls":1,"outcome":"ok"}
# A3 同名例程串凭据
{"probe":"same routine across bots","requestedRoutineId":"same-routine","resolvedAgentId":"bot-a","canSpecifyAgent":false}
# 现有 9 项 webhook 测试
ℹ tests 9  ℹ pass 9  ℹ fail 0
# 端口归属
lsof -nP -iTCP:17901 -sTCP:LISTEN → Grok\x20B PID 77949（= Grok Node 主进程，ppid 77949 的 helper 均为其子进程）
```
