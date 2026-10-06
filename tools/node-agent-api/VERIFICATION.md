# Node Agent API 0.3.0 整合验证

2026-10-06，基于远端 main 的 6bce415 构建干净整合分支。

| 检查 | 结果 |
| --- | --- |
| npm ci --ignore-scripts | 锁定依赖安装成功；没有运行 App 打包或部署 |
| npm run test:node-agent-api | 86 通过，0 失败 |
| npm run test:offline | 950 通过，0 失败，129 按既有构建产物条件跳过 |
| npm run typecheck / source:typecheck | 通过 |
| npm run frontend:build | 通过，保留既有动态导入/体积提示 |
| 新目录真实 Harness 连接 | 原共享盒子 /workspace/codex-projects/node-agent-api，Docker stdio 连接成功，无模型任务 |
| 提交边界 | source/、frontend/、原 App 打包及登录逻辑没有改动 |

此前 0.3.0 真实验收覆盖共享容器与不同 bot 桌面、原生修复/远端删除/npm 测试/导出恢复、网页与 CLI 同一 thread、原生审批拒绝、后台进程定向取消、缺失执行端关闭本机回落、独立终端/浏览器窗口、手动剪贴板和交还控制。另有 41 项运行服务/独立配额 fixture 检查通过。

私有密钥、会话、机器日志、截图与真实 bot 标识未纳入仓库。在线原盒子生命周期和用户任务没有被重启或替换；旧实验改动留在原工作副本中。

## 0.3.0 文档补充验证

- API 回归 87 通过、0 失败；新增契约用例先复现错误审批 schema，再验证正确的审批、取消、用户密钥与单应用 viewer 请求/响应形状。
- 详细子页面与 OpenAPI 的 55 个方法/路径逐项对应，无漏项或重复。
- 首页、运行说明与详细子页面的相对链接和目录锚点通过；API 文档的 26 个 shell 示例完成语法检查，4 个 JSON 示例完成解析检查。
- 修正 OpenAPI 的旧实验环境说明、请求关联头名称和单应用 viewer 路径；原 GrokNode 和 API 执行代码没有修改。
