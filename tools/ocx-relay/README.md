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

## forwarder：行为契约与新增

**不变的部分**：env 契约（`RELAY_BIND/RELAY_PORT/UPSTREAM_HOST/UPSTREAM_PORT/RELAY_TOKEN`）、Host 重写、hop-by-hop 剥离、403 令牌门禁、完成日志格式 `-> <code> <ms>ms`。非 chat 请求（如 `/v1/models` 探活轮询）完全走原直通路径，永不排队。

**chat completions POST 的新路径**：

1. 请求体缓冲（上限 `BODY_BUFFER_LIMIT`，默认 64MiB）后进入槽位/队列。
2. 并发闸 `MAX_CONCURRENCY`（默认 2）：在途 chat 请求超过即 FIFO 排队，队列上限 `MAX_QUEUE`（默认 8）。
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

排障口诀不变：`-> 429` 突发 = 上游限流（或队列满/超时，看 reason）；`-> 200` 但 100s+ = 重思考模型正常耗时。

## watchdog：检测与告警

每 `WATCH_INTERVAL_MS`（默认 2 分钟）一轮，三个独立检查：

| 检查 | 信号 | 阈值 |
| --- | --- | --- |
| 挂起的推理 | forwarder.log `started id=X` 无配对 `-> ... id=X` | `INFLIGHT_STALL_MS` 默认 10 分钟 |
| 卡死的 bot 回合 | host log 出现 `spawned worker for agent <id>` 后该 agent transcript **零写入**（容错 `SPAWN_READ_LAG_MS` 默认 3 分钟轮询延迟；一旦 transcript 有写入即视为健康，停止追踪） | `TRANSCRIPT_STALL_MS` 默认 10 分钟，**从 spawn 起算**（窗口 `SPAWN_WINDOW_MS` 30 分钟） |
| 中继死亡 | 探活 `127.0.0.1:11010/v1/models`（带 token） | 非 200 / 超时即告警 |

告警去向：`watchdog-alerts.log`（永远）→ macOS 通知（`MACOS_NOTIFY=1` 默认开）→ `ALERT_COMMAND`（默认空；配置后以 `/bin/zsh -c` 执行，占位符 `{message}` `{agent}` `{name}` 会替换为带引号的 JSON 字符串，可接 `lark-cli` 发飞书）。同一 key 冷却 30 分钟。

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
