# Node Agent API 0.3.0 差距与验收

更新：2026-10-06。当前需求为原始 GrokNode 的“不同 bot 桌面、共享容器与数据”，Node Agent API 不修改原程序。早期双容器隔离目标已经取消，旧报告只作历史原型证据。

## 当前实现

| 能力 | 当前行为 | 证据/边界 |
| --- | --- | --- |
| Mac Harness + Linux 执行 | 原生 Codex app-server 在 Mac，Docker stdio 执行端附加到现有 grok-node-local-vm | shared-harness-verification.json；UID 1000、无能力边界、no-new-privileges；不复制 Mac auth |
| 共享运行时 | 原接口管理 bot 和桌面，A/B 共用容器/项目、桌面不同 | shared-project-verification.json；编号动态查询，不硬编码 |
| 独立对话 | Mac 端独立 thread、原生 turn/items/events | 共享数据不表示共用一个对话 thread |
| 项目链路 | 对话→改代码/删除→安装依赖→测试→diff→导出 | shared-project-verification.json，真实原生工具与测试结果 |
| CLI 续接 | 网页→CLI→网页使用同一 thread | shared-cli-verification.json；不重放前一任务 |
| 审批与取消 | 原生待审批持久保留；拒绝不执行；取消定向停止当前回合记录的进程 | shared-lifecycle-verification.json；不停止共享盒子或其他 thread |
| fail-closed | 原生环境管理器拒绝缺失执行端，include_local=false | shared-lifecycle-verification.json；没有 Mac 工具回落 |
| 项目与会话恢复 | 外部项目/Git/profile/session 备份，恢复前保全当前项目 | shared-project-verification.json；覆盖归档条目，不删除额外新文件，不恢复进程内存 |
| 整桌面/单应用 | 短期 ticket、独立 cookie、服务端观看过滤、单 bot 控制租约 | 实际 GUI 验收以 shared-desktop-verification.json 为准；缺失文件即尚未完成 |
| 多用户与运维 | scoped keys、轮换/撤销、配额、审计、持久签名 webhook | service-load-verification.json；41 项实际服务/独立配额 fixture 检查 |
| 契约 | README 与 OpenAPI 描述实际端点、后端和限制 | tests/node-agent-api.test.mjs 逐路由校验响应；最终计数以最新测试报告为准 |

## 保留的限制

- 原始 GrokNode 的 VNC 端口保留原访问策略；API 只保护自身 REST/viewer 入口。
- 所有 bot 共用 Linux 数据。API bot grants 控制接口，不是文件系统安全隔离。
- 不提供 OpenAI SDK 互换、canonical OpenAI items、OTLP 导出或泛用工具结果协议；trace 为本地 JSON，未知成本为 null。
- 原 GrokNode root 进程、既有挂载、登录和软件保持原样。新 Codex 执行进程的权限边界不能解释为已改造原程序的整体安全模型。
- 项目备份不暂停原 GrokNode 任务；共享项目的并发写入由用户协调。盒子生命周期仍交给 GrokNode，API recreate 在共享后端明确拒绝。
- 旧实验副本源码、未提交修改、对话和备份不删除、不部署到原程序。当前服务不依赖旧的每 bot 容器或实验 host 注册表。

本项目参考 agents/sessions/events 的公开概念，验收按上述本地功能与约束，不把相似路径描述为 OpenAI Agents API 等价替代。
