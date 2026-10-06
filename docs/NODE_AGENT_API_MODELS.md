# Node Agent API 模型选择

更新：2026-10-07。本页与本分支的模型选择实现、回归用例和 OpenAPI 同步，完整接口见 [Node Agent API 0.3.0](NODE_AGENT_API_0_3.md)。

现在提供[API 地址、密钥、拉取模型和实际测试](NODE_AGENT_API_TOKENHUB.md)。管理员连接测试成功后可授权其他模型；连接测试与工具链验收分开显示。`verified_models` 是工具链证据登记机制，不是唯一授权前置条件。

模型调用使用 API 服务所在 Mac 配置的上游账户：默认沿用 opencodex，使用自定义 TokenHub 端点时使用该端点保存的模型 API 密钥。模型下拉框不会把计费切换到调用者账户；Node Agent API 访问密钥只用于本机服务授权。GrokNode 的 bot、盒子、桌面及原配置保持原有管理方式。

## 使用

连接网页后选择 bot，在“新会话模型”选择获准模型或继承默认，再创建会话。当前会话的模型显示在消息区。owner 可展开“管理员模型设置”，修改服务默认、当前 bot 默认、获准清单和工具链验收记录。普通用户看不到管理区，服务端同样拒绝其管理请求，包括持有 keys.manage 的委派密钥。

模型解析优先级：请求 model → API 保存的 bot 默认 → API 服务默认。创建时持久保存 model 与 model_source。之后修改默认和获准列表影响新会话；已有会话不自动换模型。新会话中途换模型需要重新创建会话。

服务默认初始为空（API 返回 null）。管理员可选择“未设置默认模型”，或 PATCH {"default_model":null}（也接受空字符串并规范化为 null）。服务和该 bot 默认都为空时，页面要求先选择模型；REST 未指定 model 返回 400 model_required，不创建会话、不回落 gpt-6.1-sol。清空默认不撤销模型授权，也不修改既有会话。

未配置自定义端点时目录来源为 Mac 的 ~/.codex/opencodex-catalog.json；自定义 TokenHub 目录从该 API 的 /models 拉取。目录条目、连接测试与工具链验收分开显示。初始只授权已完成 0.3.0 原生工具链验收的 gpt-6.1-sol；其他模型可在 TokenHub 设置里实际测试，成功后授权使用。管理员还可在真实改文件、测试、审批、取消验收后登记 evidence；evidence 是管理员的验收声明，服务不会自动证明某个模型的完整工具能力。

## REST

| 方法与路径 | 权限 | 请求/响应要点 |
| --- | --- | --- |
| GET /v1/models?agent_id=BOT | agents.read 与对应 bot grant | data: id/name/approved/verified/verification_level/verification_evidence/reasoning_efforts；default_model 是该 bot 的有效默认，endpoint_revision 标识当前端点 |
| GET /v1/settings/models | owner | default_model/bot_defaults/allowed_models/verified_models |
| PATCH /v1/settings/models | owner | 可修改 default_model、allowed_models、verified_models；默认可为空，有值时必须获准，授权需存在目录且通过当前端点连接测试或工具链验收 |
| GET /v1/agents/BOT/model | owner | default_model 可为 null，effective_model 为最终默认 |
| PATCH /v1/agents/BOT/model | owner | {"default_model":"gpt-6.1-sol"}；null 清除 bot 覆盖 |
| POST /v1/agents/sessions | sessions.write 与对应 bot grant | 可选 model、reasoning_effort；响应固定 model、model_source、endpoint_revision 与 reasoning_effort |

```json
{"agent_id":"BOT","model":"gpt-6.1-sol","metadata":{"title":"代码审查"}}
```

```json
{"allowed_models":["gpt-6.1-sol","VERIFIED_MODEL"],"verified_models":[{"id":"gpt-6.1-sol","evidence":"既有 0.3.0 原生工具验收"},{"id":"VERIFIED_MODEL","evidence":"实际工具链验收报告的编号或路径"}]}
```

设置保存于 API state/models.json，原子写入、权限 600；不写 GrokNode 的模型设置。启动参数 --model 仅在首次初始化作为服务默认，不传即为空；已有保存的设置优先，包括已保存的 null。指定非基线模型需先登记并授权，再通过管理接口设置默认。

400 表示非法、未获准或不在目录的模型；403 表示非 owner 修改设置；503 model_catalog_unavailable 表示无法读取目录，此时新建模型会话失败且不会启动模型任务。已有会话保留保存的模型。Harness 返回不同模型时 502 model_mismatch，拒绝继续，未设置备用模型。

## Harness 与旧会话

Mac Harness 的 app-server 按 bot 复用；模型通过 thread/start、thread/resume、turn/start 的原生参数发送，两个 thread 无需争抢 config.toml。模型也记录在回合上。旧会话没有 model 时，以原生续接响应实际返回的模型固定下来；从未产生 rollout 的空会话沿用既有空 thread 重建机制。

现有本机 client-cli codex/resume 的 --model 是直接启动本机 Codex 的参数，不受 API key 权限清单管理。API 用户应通过上述 REST 新建会话。该客户端 desktop 创建会话会使用 API 默认；它与模型管理端点共用原有 bot 映射。

完整请求与响应 schema 见 [OpenAPI](../tools/node-agent-api/openapi.json)。回归见 tests/node-agent-models.test.mjs，真实验收记录见 [模型验收](node-agent-api-0-3-verify/08-model-selection.md)。
