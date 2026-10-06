# Node Agent API 0.3.0 逐接口验证记录

验证时间：2026-10-06 晚间（Asia/Shanghai）。分支 codex/node-agent-api-0-3，本分支代码服务于 http://127.0.0.1:18771，backend codex，writes enabled。测试 bot A 与 GrokNode 共享盒子 grok-node-local-vm：同容器同数据，桌面 display 6。

## 覆盖

- 回归测试 8 文件：87 通过、0 失败（M1-M3 修复后重跑仍全绿）。
- 真实服务实测：81 次全端点扫描 + 对话 / import / 票据 / 恢复取消 / M1-M3 复验专项，约 110 次请求。
- CLI 7 命令：status、ensure、desktop、backup 实测成功；resume 缺参、未知命令、未知 bot 的错误路径实测；recreate 只到代码级（见 06）；codex/resume 交互只验参数校验。
- OpenAPI 55 个操作全部覆盖，其中 createAgent 正向、launchApplication 正向因会产生真实副作用而有意跳过（见 07 清单）。

## 原始证据

实测原始 JSON 在 /private/tmp/naapi-probe.json、/private/tmp/naapi-probe2.json（本机临时文件，不入库，含一次性票据与会话标识）。本文只记录状态码、形状与结论，不含密钥。

## 分篇

- 01 agents 与会话
- 02 消息与取消
- 03 项目与环境
- 04 桌面与剪贴板
- 05 治理：密钥用户 webhook
- 06 CLI
- 07 需求偏差清单

## 总 verdict

需求 9 条目标行为全部成立；M1-M3 三处状态码偏差已修复并逐条 live 复验（07 已关闭）；5 项有意未覆盖均有理由与替代证据。详见 07。
