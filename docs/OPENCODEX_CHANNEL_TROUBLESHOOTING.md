# OpenCodex 通道故障排查

这份指南用于处理 Grok Node 中所有 bot 都不回复、回复中断或界面状态灯提醒。诊断只报告状态，不会切换模型、熔断或自动降级。

## 一键诊断

```sh
npm run diagnose
npm run diagnose -- --json
```

结论分三档：

| 结论 | Exit code | 含义 |
| --- | --- | --- |
| OK | 0 | 容器、中继、模型列表、renderer 和两侧设置均通过 |
| DEGRADED | 1 | 请求路径存在，但有配额、限流、渲染进程不稳定或设置不一致 |
| DOWN | 2 | 容器、中继、模型列表响应或渲染进程存在硬故障 |

## UI 状态灯

状态灯出现在左下角 `Local` 后面。正常状态不显示。

| 状态 | 触发条件 | 处理动作 |
| --- | --- | --- |
| 无额度 | HTTP 402，或 403/429 响应体包含 quota、balance、insufficient、payment、exhausted、额度、余额、余量等词 | 检查 OpenCodex 服务订阅、余额和用量详情；等待充值或额度恢复 |
| 限流中 | 普通 HTTP 429；优先读取 `Retry-After` 计算恢复时间 | 按提示等待，不切换模型，不使用其他账号自动绕过 |
| 上游 403 | HTTP 403 且不是明确的额度耗尽文案 | 检查当前 API 地址、凭据权限、服务授权和上游公告 |
| 连接失败 | ECONNREFUSED、ECONNRESET、ENOTFOUND、EAI_AGAIN、EPIPE、EHOSTUNREACH、ENETUNREACH 等 | 依次检查容器、中继、DNS、OrbStack/Docker 和本机网络 |
| 响应超时 | HTTP 408、504、524，或 60 秒没有收到流式响应 | 观察上游状态和网络质量；状态灯只提示，不会中止原请求 |
| 模型列表异常 | `/models` 返回格式错误、空 `data`、模型缺少 `id`，或模型列表请求发生未预期错误 | 检查 OpenCodex 服务版本、API 地址和代理响应内容 |

## 常见故障转发表

### 429：配额耗尽

表现为 bot 不回复，状态灯显示“无额度”。响应体通常包含 `quota exhausted`、`insufficient balance`、`额度不足`、`余额不足` 或 `余量不足`。此时请求已经到达服务，问题在账户可用额度。处理方式是查看订阅和用量详情，等待额度恢复或充值。不要通过自动 fallback 改变请求路径。

### 429：普通限流

响应体没有配额或余额关键词，状态灯显示“限流中”。如果响应包含 `Retry-After`，tooltip 会显示恢复时间。没有 `Retry-After` 时，状态默认保留 60 分钟，期间新的成功响应会清除状态。

### 402 Payment Required

402 一律归类为“无额度”。这说明服务可达，但当前计划或余额不能继续支撑请求。

### 403 Forbidden

403 响应如果明确提到额度、余额或余量，归类为“无额度”；其他 403 归类为“上游 403”。先确认 API 地址是否仍指向当前 OpenCodex 通道，再检查服务授权、账号权限和上游公告。

### 网络失败

`ECONNREFUSED` 通常表示容器内中继没有监听，或 Mac 侧 forwarder 没有启动。`ENOTFOUND` 和 `EAI_AGAIN` 通常与 DNS、VPN 或换网有关。`ECONNRESET`、`EPIPE` 可能发生在代理或上游断开连接时。

排查顺序：

1. 容器正在运行：`docker inspect grok-bot-local-vm -f '{{.State.Running}}'` 输出 `true`
2. 容器内 `/proc/net/tcp` 存在 `127.0.0.1:10100`，状态为 `0A`
3. 从容器内请求中继返回 HTTP 200，耗时低于 5 秒：

   ```sh
   docker exec grok-bot-local-vm /usr/bin/curl -sS -m 5 -o /dev/null -w '%{http_code} %{time_total}\n' http://127.0.0.1:10100/v1/models
   ```

4. renderer 已连续运行超过 5 分钟

直接从 Mac 请求 `http://127.0.0.1:11010/v1/models` 一律返回 `403`，因为 forwarder 要求 `x-relay-token` 头（token 存放于 `~/.grokbot/ocx-relay/token`）。`403` 表示鉴权拦截，不代表 `11010` 不正常。

### 响应超时或流式输出中断

HTTP 408、504、524 会归类为“响应超时”。连接已经建立但 60 秒没有任何流式事件时，也会显示“响应超时”。这个观察计时器不会中止请求；如果上游随后恢复，完成时状态会更新为正常并隐藏状态灯。

半包响应丢失通常表现为 transcript 不再增长、流式计数器停住、界面等待中但没有错误。此时等待状态灯进入“响应超时”，再结合 `/models` 延迟和网络状态判断是上游中断还是本地网络问题。

### /models malformed

`/models` 返回 200 但 body 不是对象、缺少 `data` 数组、数组为空，或模型项没有非空 `id`，状态灯显示“模型列表异常”。这说明当前端点没有给出可选择的模型清单。

### invalid uint 32: NaN

这个错误表示本应写入非负整数的位置收到了 `NaN`，常见来源是上游 usage 字段异常。当前 runtime 会把 prompt、completion、total、input、output 等 usage 值通过有限数字清洗，非有限值按 0 处理，避免 `NaN` 进入 protobuf 编码。

如果错误再次出现，保留完整 transcript 和最近一次 `/models` 响应，检查是否有新的 usage 字段绕过了现有清洗路径。

### settings 不一致

Mac 侧 `~/.grokbot/settings.json` 与容器侧 `/home/box/sand-data/settings.json` 的以下字段应保持一致：

- `inferenceProvider`
- `openRouterModel`
- `openRouterBaseUrl`
- `boxRuntime`

不一致会让 UI 选择和容器内实际请求路径脱节。使用设置面板保存一次配置，或通过同步链路重新写入容器。诊断脚本不会直接修改设置。

### 中继失效

容器运行不代表中继可用。确认 `/proc/net/tcp` 中 loopback 地址和端口处于 `0A` LISTEN 状态。当前平台中继为容器 `127.0.0.1:10100` 到 Mac `11010` 的 L7 转发。旧的手动 TCP relay 不再是标准路径。

### 换网后旧 IP 或代理状态残留

切换 Wi-Fi、VPN、公司网络或 Clash/Fake-IP 后，旧连接可能保持但不再传数据。表现为 `/models` 慢、DNS 失败、stream 卡住或连接重置。先重新运行 `npm run diagnose`，再根据“连接失败”或“响应超时”处理。

### renderer 不稳定

renderer 刚启动、崩溃后重启或存在多个短命 renderer 时，界面可能无法稳定展示消息或状态灯。诊断要求至少一个 renderer 连续运行 5 分钟。这个检查只影响可靠性判断，不会重启应用。
