# tools/ocx-relay — 推理中继的抗限流改造与僵尸回合看门

背景：2026-09-26 实证，opencodex 上游 429 限流爆发时（`~/.grokbot/ocx-relay/forwarder.log` 按小时统计 12 次 429），bot 回合被无声打死（指挥官 transcript 冻结 40+ 分钟，无任何用户可见痕迹）。方案全文见 [DESIGN.md](DESIGN.md)。本目录落地其中两层：

- **L1 `mac-forwarder.mjs`** — Mac 侧 L7 中继（容器内 10100 → Mac 11010 → opencodex 10100），在原纯管道版基础上加"有界并发队列 + 429 首字节前重试 + 上游空闲超时"。对 bot 而言，上游限流从"回合被打死"降级为"本地排队几分钟"。
- **L2 `turn-watchdog.mjs`** — Mac 侧常驻看门，检测僵尸回合/挂起请求/中继死亡并告警。v1 只通知不动手。

## 部署形态

运行时目录是 `~/.grokbot/ocx-relay/`（本目录是源头，`deploy.sh` 复制过去并备份旧版）：

```
~/.grokbot/ocx-relay/
  token                  # 中继鉴权（0600）
  relay-run.sh           # forwarder 启动脚本（TOKEN/BIND/PORT）
  mac-forwarder.mjs      # 本目录 L1 的部署副本
  turn-watchdog.mjs      # 本目录 L2 的部署副本
  container-relay.py     # 容器侧中继的源头副本（480s 空闲超时）
  forwarder.log          # 推理流量真相源：每行 = 一次 bot 推理
  watchdog-*.log/json    # 看门的输出与状态
```

容器侧副本在 `/tmp/ocx-relay.py`（容器 10100 → Mac 11010），**容器重建会被还原**成 120s 空闲超时的旧版——那会把在 forwarder 队列里排了 ~100s 的请求整 120s 掐断（forwarder.log 里表现为精确 +120s 的 `client disconnected`，2026-09-26 晚实证 28 例）。重建后跑一次 `container-relay-push.sh` 即可回推 480s 版并重启、探活。

**`relay-run.sh` 本身不在版本控制内**（只存在于运行时目录），所以在用参数必须在这里留档，否则某次重建后无从追溯。2026-09-28 实测在用：

```sh
MAX_CONCURRENCY=4        # 原 2
MAX_QUEUE=12             # 原 4
QUEUE_TIMEOUT_MS=75000   # 不变，队列仍有上界
RETRY_429=2
UPSTREAM_IDLE_TIMEOUT_MS=480000
UPSTREAM_MAX_TOTAL_MS=900000
```

**为什么从 2/4 提到 4/12**：`slots=2` 在 4+ 个 bot 下不够，2026-09-27 18–19Z 一小时内出现 15 次 `reason=queue full`——请求在**进上游之前**就被拒了。同期真上游 429（带 `try=` 的那种）为 **0**，说明瓶颈在我们自己而不在 opencodex，继续压在 2 槽是限自己。队列从 4 提到 12 是为了吸收突发：实测响应耗时中位数约 30s，75s 队列超时足够覆盖两个波峰。

**可逆且可观测**：若上游真开始限流，forwarder.log 里会出现带 `try=` 的 429（与 `reason=queue full` 明确可分，见下节），届时把 `MAX_CONCURRENCY` 调回 3 即可，不需要改代码。

**2026-10-01 起按模型分池**（配合 bot 属性页的「模型」覆盖）：单一全局池改为「每模型一个 FIFO 池 + 全局上限」。原先所有 bot 共用 `MAX_CONCURRENCY` 个槽位，给 bot 换模型也照样排在同一条队里。现在：

```sh
MAX_CONCURRENCY=6               # 全局上限（所有模型合计在途数）
MAX_CONCURRENCY_PER_MODEL=2     # 每个模型的默认槽位
MODEL_CONCURRENCY='{"minimax-cn/MiniMax-M3.1-Flash-Preview":3}'   # 可选：单模型覆盖（JSON）
MAX_QUEUE=12                    # 现在是「每个模型」的队列上限
QUEUE_TIMEOUT_MS=75000          # 每个请求的排队上限，不变
```

- 池键取请求体的 `model` 字段；缺失或解析失败归入 `_unknown` 池。
- 派发时在「还有空槽的模型」中挑排队最久的那个——某个模型满了，不会挡住别的模型的队列。
- 日志每行末尾多一个 `model=<id>`（`upstream-error` 行放在消息之前，避免消息里的 `retry` 被 watchdog 误读为重试行）；`/v1/relay/inflight` 每条多一个 `model` 字段。
- 不在 env 里写 `MAX_CONCURRENCY_PER_MODEL` 时，代码默认 2。

## forwarder：行为契约与新增

**不变的部分**：env 契约（`RELAY_BIND/RELAY_PORT/UPSTREAM_HOST/UPSTREAM_PORT/RELAY_TOKEN`）、Host 重写、hop-by-hop 剥离、403 令牌门禁、完成日志格式 `-> <code> <ms>ms`。非 chat 请求（如 `/v1/models` 探活轮询）完全走原直通路径，永不排队。

**chat completions POST 的新路径**：

1. 请求体缓冲（上限 `BODY_BUFFER_LIMIT`，默认 64MiB）后进入槽位/队列。
2. 并发闸：按请求体 `model` 分池，每池上限 `MAX_CONCURRENCY_PER_MODEL`（默认 2，`MODEL_CONCURRENCY` 可逐模型覆盖），所有池合计不超过 `MAX_CONCURRENCY`（默认 2）。超出即进该模型的 FIFO 队列，每池队列上限 `MAX_QUEUE`（默认 8）。
3. 队列等待超 `QUEUE_TIMEOUT_MS`（默认 120s）或队满 → **合成 429 + `Retry-After: 5`** 立即退回。排队永远有上界，不会变成新的卡死点；host 侧 ai-sdk 自带重试（默认 2 次）会接住。
4. 上游 429 且未向客户端发出任何字节 → 消费掉，按 `min(Retry-After, RETRY_MAX_DELAY_MS=30s)+抖动` 退避后原样重发（`RETRY_429` 默认 2 次）。重试判定只发生在上游响应头时刻，SSE 一旦开始绝不重放。
5. 上游空闲超时 `UPSTREAM_IDLE_TIMEOUT_MS`（默认 300s）：上游 5 分钟不吐任何字节就断开返回 502——把"无限挂起"变成"可见的失败"。重思考模型单请求实测最长 164s，5 分钟阈值不会误伤。

**日志契约**（watchdog 和人工排障都吃这个）：

```
... POST /v1/chat/completions started id=<8hex> try=<n> queued=<ms>ms     # 每次派发
... POST /v1/chat/completions retry id=<8hex> attempt=<n> in=<ms>ms       # 429 退避
... POST /v1/chat/completions -> <code> <ms>ms queued=<ms>ms try=<n> id=<8hex>   # 终态（原格式 + 后缀）
... POST /v1/chat/completions -> 429 <ms>ms queued=<ms>ms reason=queue full|queue timeout id=...  # 队列合成 429
```

排障口诀：`-> 200` 但 100s+ = 重思考模型正常耗时；`-> 429` **必须先分类再看**，见下节。

### 429 的三类来源（不可混为一谈）

统计口径先说清：`grep '429'` 会连耗时数字一起命中（`4429ms`），做趋势统计必须用 `-> 429` 锚定。

| 类别 | 日志指纹 | 归属 | 处置 |
| --- | --- | --- | --- |
| `relay-queue-timeout` / `relay-queue-full` | 带 `reason=queue timeout\|queue full`，`queued=` ≈ `QUEUE_TIMEOUT_MS`，**且无 `try=` 字段**；`model=` 指出是哪个模型的池满了 | **我们自己的容量问题**，与上游无关 | 只集中在一个 `model=` 上 → 调该模型的 `MODEL_CONCURRENCY` 或给部分 bot 换模型；各模型都有 → 调 `MAX_CONCURRENCY` / `MAX_QUEUE`，或缩短上游耗时 |
| `upstream-rate-limit` | 带 `try=` 字段（走过重试路径），`queued=0ms` | 上游真实限流 | 交给 `RETRY_429` 退避重试；重试耗尽才透传给客户端 |
| `provider-quota-exhausted` | 429 正文是 `Throttling.AllocationQuota` 一类，**几乎立刻返回（<0.1s）** | 上游账号/套餐配额耗尽 | **重试无意义**，只能换模型或等配额重置 |

实证（2026-09-27/28）：

- 第一类占 2026-09-27 全部 20 次 429。`09:09–09:12Z` **五分钟内 5 次**，`queued=75002ms`——是 `slots=2 / queue=4` 在 4+ 个 bot 下排不下，与 opencodex 无关。
- 第二类在 2026-09-26 有 150 次（真实限流爆发）。
- 第三类：`qianwen/qwen3.8-max` 返回 `Throttling.AllocationQuota: Your token-plan 1-month quota has been exhausted`，**0.039s 返回**。同一时刻 `zai/glm-5.3-flash` 正常 200 且 `tool_calls` 参数完整。

**把三类混在一起统计，会得出"上游限流爆发"的错误结论**，从而把加固力气花在错的地方：第一类要扩容，第二类要重试，第三类只能换模型。

### 总死线是每请求预算，不是每次尝试

`UPSTREAM_MAX_TOTAL_MS`（默认 600s，部署 900s）从**取得并发槽位时**起算一次，所有重试**共享**同一份预算；预算在重试等待期间耗尽会真正终止请求。

> 2026-09-28 修复。此前每次 `dispatch()` 都重装满额定时器，重试等于给自己发新预算。实证 `id=35e7fc81` 在 900s 预算下跑了 **1403443ms**（`try=1`），而同一分钟 `try=0` 的 `id=e304d31c` 在 581063ms 被正确切断。

后果直接落在并发上：重试中的请求会占住 `MAX_CONCURRENCY=2` 里的一个槽最长 23 分钟，把其余 bot 挤进队列超时——也就是上表第一类自己制造自己的原因。

## watchdog：检测与告警

每 `WATCH_INTERVAL_MS`（默认 2 分钟）一轮，三个独立检查：

| 检查 | 信号 | 阈值 |
| --- | --- | --- |
| 挂起的推理 | 先问转发器 `GET /v1/relay/inflight`（带 token，只列进程内存里仍持有的请求）。问不到才退回日志，并且**超过 `total=` 硬上限（部署 15 分钟）加 2 分钟的 started 行不算在飞**，只报一次记账错误 | `INFLIGHT_STALL_MS` 默认 10 分钟 |
| 卡死的 bot 回合 | host 每 15 秒写 `/tmp/sand-host-turns.json`（在飞回合）。文件新鲜时，**只有列在里面的回合**才可能卡死，计时从 host 的 `startedAt` 起算；文件缺失或超过 45 秒没更新，才退回「spawn 之后 transcript 零写入」 | `TRANSCRIPT_STALL_MS` 默认 10 分钟 |
| 中继死亡 | 探活 `127.0.0.1:11010/v1/models`（带 token） | 非 200 / 超时即告警 |

告警去向：`watchdog-alerts.log`（永远）→ macOS 通知（`MACOS_NOTIFY=1` 默认开；通知正文自带详情文件路径——Notification Center 可看全文。已实测 macOS 26 拒绝 terminal-notifier 的通知权限，故发送走 osascript；若装了 terminal-notifier 且将来权限放开，代码会优先用它并让点击直接打开告警日志）→ `ALERT_COMMAND`（默认空；配置后以 `/bin/zsh -c` 执行，占位符 `{message}` `{agent}` `{name}` 会替换为带引号的 JSON 字符串，可接 `lark-cli` 发飞书）。持续状态（挂起、卡死、断网、中继探活失败）**出现时一条，之后按 15 分钟 / 1 小时 / 4 小时各再提醒一次就停，恢复时再一条**。慢回合和断网的提醒不会比原先的 30 分钟 / 1 小时更密。重启 host、容量豁免、恢复公告这类动作每次发生都发。Mac 睡眠（两轮之间的挂钟跳变超过 3 个巡检间隔）醒来的那一轮只把 spawn 时钟拨到现在，不告警、不重启。

**静默必须从 spawn 起算，不能从上次 transcript 写入起算**（2026-09-26 误报风暴的教训）：例行任务唤醒一个空闲 bot 时，“距上次写入”可能包含几小时的空闲时间，旧算法把它当成卡死时长，导致每个正常完成后的 bot 都被误报「卡死 67 分钟」。新语义只看“这个回合派出后有没有产出”。

**已知边界**：watchdog 只对"自己看着出生"的回合告警（首次启动时 state 从零开始，不回放历史）；给卡死 bot 自动注入恢复消息需要目标 bot 先建 `watch-resume` webhook 例行任务（v2，见 DESIGN.md），v1 一律只告警。

## 部署 / 回滚 / 验证

```sh
tools/ocx-relay/deploy.sh          # 复制 + 备份 + 打印后续命令
# 重启 forwarder（~1s 推理空窗，见 deploy.sh 输出）
RUN_ONCE=1 node ~/.grokbot/ocx-relay/turn-watchdog.mjs   # 看门自检
# launchd 常驻（AI 沙箱 bootstrap 不了 launchd，须用户本机执行）：
cp ~/.grokbot/ocx-relay/com.groknode.turn-watchdog.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.groknode.turn-watchdog.plist
# 若此前手动拉起过 watchdog，先杀掉再装 launchd，避免双实例：
pkill -f "ocx-relay/turn-watchdog.mjs"
```

容器重建后（`docker ps` 里 Up 时间归零）补一刀：

```sh
tools/ocx-relay/container-relay-push.sh   # 回推 480s 中继并重启、探活
```

回滚：`deploy.sh` 打印的 `.bak-<ts>` 覆盖回 `mac-forwarder.mjs` 后重启即可；watchdog 直接 `launchctl bootout`。

## 测试

`tests/ocx-relay-forwarder.test.mjs`（10 用例）：起可编程 mock 上游 + 真实 forwarder（环回临时端口），覆盖令牌门禁、直通、429 首字节前重试、重试耗尽透传、队列串行化、队满/超时合成 429、SSE 增量透传（防整体缓冲）、客户端中断释放槽位。全部环回端口，CI（ubuntu）安全。watchdog 是外部系统粘合（docker exec / 日志文件），暂无独立测试，靠 `RUN_ONCE` 自检。
