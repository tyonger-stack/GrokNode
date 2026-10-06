# 01 agents 与会话

需求对应：条目 1（bot 身份与桌面由 GrokNode 管理）、条目 5（各自会话身份、thread 不混）。

## 实测

- GET /health：200，service/version/backend/compatible_with_openai_sdk=false。
- GET /v1/capabilities：200，writes_enabled true，会话上下文 codex_harness，取消能力随 adapter.cancel 如实广告。
- GET /v1/usage：200，requests/streams/storageBytes/limits 四组配额。
- GET /v1/agents：200，16 个 bot，含验证 A/B；bot 条目带 backend codex_harness。
- 无凭据与假凭据：401；未知路径：404；limit=abc：400。
- GET /v1/agents/{id}：验证 A 200；全零 UUID：404。
- POST /v1/agents 空名/缺名/超长名：均为 400。正向创建有意跳过（会在 GrokNode 建真 bot），替代证据：测试 bot A/B 由原接口创建记录 + 400 校验路径。
- POST /v1/agents/sessions（验证 A）：201，status idle，含独立 thread_id；两次创建耗时 33s / 12s（harness attach 成本，见 07 M5）。缺 agent_id：400；未知 bot：404。
- GET /v1/agents/sessions + agent_id 过滤：200，数量与 bot 归属一致。
- GET / PATCH session：200；PATCH 空体：400；metadata 写入后读回一致。
- items/turns/traces/actions（新会话）：200 空列表；真实回合后 items 出现 userMessage/agentMessage，traces 带 native token 用量（见 02）。
- events GET：200 列表；after 取到最后 id：200 空页；after 胡诌：400 invalid_cursor。
- POST /close：200 closed；关闭后 GET 确认；关闭后 submit：409 session_closed（形状正确时；错误形状先报 400，符合先校验后状态的顺序）。

## verdict

一致。会话相互独立，thread_id 随会话建，不存在跨 bot 混 thread。
