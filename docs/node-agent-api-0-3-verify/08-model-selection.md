# 模型选择验收（2026-10-06）

本轮增加服务/bot/会话三级模型选择。以当前 worktree 与本机 Codex 0.160 导出的 app-server JSON schema 为依据，原生 thread/start、thread/resume、turn/start 均支持 model。

| 项目 | 结果与证据 |
| --- | --- |
| 新接口与全部 API 回归 | 91 项通过，0 失败；新 tests/node-agent-models.test.mjs 覆盖 owner 边界、优先级、重启恢复、目录丢失及两个线程模型不串扰 |
| GET /v1/models | 真实 HTTP 200；基线获准，其他目录模型未获准 |
| 服务/bot 默认管理 | 真实浏览器 owner 保存 bot 默认成功；普通委派密钥修改两种设置均 403 |
| POST session 指定模型 | 真实 Mac Harness 返回指定 model 和独立 thread；非法/待验证模型 400，修改已有 session model 400 |
| 原生双模型 thread | 同一 bot 分别 thread/start gpt-6.1-sol 与 gpt-6-luna，返回模型与 thread ID 分别匹配；该检查仅证明参数接线，gpt-6-luna 仍未完成工具链验收、不予授权 |
| 实际推理与续接 | 基线模型简短回复回合 completed；handoff 后通过 API resume 返回原 model |
| 网页 | owner 管理区、获准模型下拉、默认保存、新建指定模型、会话显示均实际操作通过 |
| 普通用户网页 | 短期委派密钥登录后管理区隐藏，下拉仅获准模型；REST 独立验证非 owner 修改设置 403 |

浏览器截图 API 多次超时，未产生可用截图；实际 DOM 状态、点击后结果与 REST/Harness 证据已记录。LSP 未安装且诊断不可用；使用 Node 语法检查、OpenAPI schema 与回归测试验证，未声称 LSP 通过。

## 空默认模型修订

根据用户要求，服务默认改为 null，取消 prepareCodex 内的固定模型回退；gpt-6.1-sol 仍可显式选择。新增回归覆盖空默认的持久化、缺少模型时 400 model_required、显式模型创建成功、bot 覆盖与已有会话保持原模型。网页服务默认包含“未设置默认模型”，新会话未选模型且无可继承默认时禁止创建。

空默认修订回归：92 项通过，0 失败。原 18770 的管理员 PATCH default_model:null 返回 200；GET /v1/models 返回 null；未指定 model 的新建请求返回 400 model_required。浏览器确认服务默认空选项、未选择时禁止新建、显式选模型后可创建、切回空选项再禁用。该次验收时默认为 null，既有会话保留；之后管理员可自行保存默认。

模型真实请求日志与原始 JSON 存在机器本地 .lab/model-live.log、.lab/model-live-results.json，包含临时验收会话，未纳入提交。未声称目录中所有模型已验证，也未承诺 CLI 直接启动绕过 API 后仍受 API 清单约束。
