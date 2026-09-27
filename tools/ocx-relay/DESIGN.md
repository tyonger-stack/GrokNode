# 舰队抗上游限流设计 — 让 429 只能"变慢+可见"，不能"无声卡死"

> **状态（2026-09-26）**：L1 已实现为本目录 [mac-forwarder.mjs](mac-forwarder.mjs)（10/10 集成测试，见 `tests/ocx-relay-forwarder.test.mjs`）；L2 已实现为 [turn-watchdog.mjs](turn-watchdog.mjs)（v1 只通知）；L3（host 源码）未动；L4 属舰队纪律，落在 bot prompt / 例程里。部署与回滚见 [README](README.md)。

2026-09-26 起草。起因：指挥官 (a1b0e9c4) 回合被 16:11–16:14 的上游 429 波打死，16:11:37 后 transcript/blobs 冻结，无任何用户可见痕迹。

## 已实证的现状（设计的三个锚点）

1. **mac-forwarder.mjs（Mac 11010）是 45 行纯管道**：token 门禁 + header 清洗 + `pipe`，无并发控制、无重试、无超时。它是容器 bot 到 opencodex 的**唯一**推理通道，forwarder.log 每行 `POST /v1/chat/completions -> <code> <耗时>` 即一次 bot 推理。
2. **host 侧无自定义重试**：`provider-session.ts:445` 的 `streamText` 未配 `maxRetries`，吃 ai-sdk 默认 2 次；重试耗尽后抛错、turn 结束，但 **transcript 不写 error entry、UI 无提示**——"无声卡死"的根源（指挥官实证）。
3. **上游 429 是慢返回**（2.6–48s 才吐 429），叠加重思考模型单请求 100–164s，多 bot 同时巡检时并发窗口很大，极易撞限。429 按账号还是按模型计 **未测定**（可用 forwarder 日志时间戳对照当时在跑的 bot 验证）。

## L1 削峰：forwarder 加"限流队列"（治本，~60 行，改自己的脚本）

- **全局并发闸** `UPSTREAM_MAX_CONCURRENCY`（默认 2）：在途 `POST /v1/chat/completions` 超闸进 FIFO 队列。需要缓冲请求体（大上下文可达数 MB，内存可承受）以识别端点；`/v1/models` 轮询不占闸。
- **队列有界**：`UPSTREAM_MAX_QUEUE`（默认 8）；队满或等待超 `UPSTREAM_QUEUE_TIMEOUT`（默认 120s）→ 合成 `429 + Retry-After` 退回，交给 host 既有重试。**把"无限排队"变成"有上界的延迟"**——排队只是变慢，永远不会变成新的卡死点。
- **429 重试规则**：仅允许在首字节发给下游之前重试（上游 429 到达时流必然未开始，天然安全；SSE 一旦开始绝不重放），最多 2 次、`min(Retry-After,30s)+抖动`。
- **为什么放 Mac 侧不放容器侧**：容器内容寻址重建，容器内改动会在 VM 重建时丢；mac-forwarder 是独立常驻脚本，kill + 重启即生效，不碰 app 打包、不动容器。
- **可观测**：日志行加 `queued=<ms> try=<k>`，限流从"日志考古"变"一眼可见"。

## L2 兜底：Mac 侧僵尸回合 watchdog（治"无声"，~40 行，先做）

- 每 2 分钟扫 `agent-transcripts/<id>/<id>.jsonl` mtime，结合 host log 的 worker 记录：**worker 活跃但 transcript >20 分钟未写入 = 僵尸嫌疑**（阈值依据：重思考模型单请求最长实测 164s，正常长推理不会静默 20 分钟）。
- **v1 只通知不动手**：`lark-cli` 直接给用户飞书 DM「bot X 疑似卡死，最后活动 HH:MM，当前上游=429/正常」（lark-cli REST 在 Mac 是通的，桥坏的只是 websocket 跳）。
- **v2 自动踢**：给长活 bot 统一建 `watch-resume` webhook 例行任务（bot 用 `update_state` 自建即可），watchdog `POST 127.0.0.1:17901/webhook/<agent>/watch-resume` 注入"读上次 checkpoint，续跑或向用户报告"。
  - ⚠️ 指挥官目前**没有** webhook routine（automations 里只有 0800 / t1-12h / t2-03-0930 三个 cron），外部叫不醒它——这是本次的实测缺口，v2 建好后即闭环。
- launchd 注册需用户本机执行（AI 沙箱 `launchctl bootstrap` 恒报 5，bridge 时代已知限制）；plist 模式照抄 `com.groknode.feishu-bridge-watch.plist`。

## L3 host 源码：让失败"死得明白"（根治，需重打包，Phase 2）

- turn 层捕获推理最终失败：往 transcript 写一条 error entry + 给用户发系统消息（"上游限流，回合中止；回复'继续'从 checkpoint 重跑"）。
- 顺手显式 `maxRetries`（建议 4 次、指数+抖动）——L1 生效后基本用不到，但双保险。
- 改动小但要走 `npm run package` 全流程（含已知的 CODEBUDDY 守卫绕行），故放最后。

## L4 舰队纪律（零代码，prompt / routine 层，立刻可做）

- **例行任务错峰**：全舰队 cron 分钟位岔开；routine-healthcheck 增加"同分钟唤醒风暴"检查项。
- **checkpoint 纪律**：长任务 bot 的 prompt 统一加两句——"动手前先 `update_state` 写进度"；"被中断后醒来先读 last checkpoint，续跑不重头"。被 429 打断的重跑成本从"整回合"降到"剩余步骤"。
- **重轻分型**：大上下文重 bot 与高频轻 bot 分模型或分时段。按账号计则无效，按模型计则有效——先测定再定。
- **effort 已降**（xhigh→medium，2026-09-26 16:41 生效）：思考期缩短，上游并发槽占用窗口变小。

## 落地顺序与效果

L2（先能看见，1 小时内见效）→ L1（削峰，上游少炸）→ L4（纪律固化）→ L3（重打包，最后）。

四层独立有效，叠加后的终态：**429 从"bot 集体无声"变成"本地排队几分钟后照常干活"；万一真被打断，20 分钟内必有飞书提醒，且可自动踢醒续跑。**
