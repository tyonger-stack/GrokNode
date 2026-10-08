# Node Agent API 0.3.0 整合验证

## 2026 年 10 月 8 日会话后端选择

- 新增 backend:codex|grok，会话归属固定；省略使用原服务默认。
- 完整 API 回归 244 通过、0 失败；新用例覆盖两种会话不混用、原生 gateway 提交及回读、去重、原生模型覆盖拒绝、重启恢复和 Bot 授权。
- 真实 Chromium 验证 19 通过、0 失败，包含原生选择、消息回读、切回 Harness 发送以及 375/768/1280 宽度；既有网页完整契约也通过。
- 生产服务和真实 Bot 的验证记录单独保存，不把测试用 gateway 数据视为真实原生任务结果。原程序与容器没有改动。

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

## 本机 0.3.0 扩展验证（2026-10-07）

以下记录对应本分支的扩展实现及本机部署，不改写上面的历史基线结果。

- 最近完整 Node Agent API 回归：105 通过，0 失败。模型选择、TokenHub、控制租约替换、交还后观看、资源缓存与中文标题有直接回归或真实浏览器证据。
- [模型选择与空默认](../../docs/node-agent-api-0-3-verify/08-model-selection.md)、[连接反馈](../../docs/node-agent-api-0-3-verify/09-connection-feedback.md)、[TokenHub](../../docs/node-agent-api-0-3-verify/10-tokenhub.md)、[桌面控制](../../docs/node-agent-api-0-3-verify/11-desktop-control.md)、[交还后观看](../../docs/node-agent-api-0-3-verify/12-handback-view.md)、[中文标题](../../docs/node-agent-api-0-3-verify/13-application-title-utf8.md)分别说明验收范围，不能用连接测试代替完整工具验收。
- macOS 用户 LaunchAgent 已实际启动；网页、健康接口、原密钥及已有会话检查成功。登录自动启动来自配置，尚未通过重启 Mac 验收，详见[后台运行](../../docs/NODE_AGENT_API_OPERATIONS.md)。
- 机器私有 plist、密钥、模型账户、原始会话、日志和截图不随文档发布。示例路径与参数需要按实际部署替换。
- 发布前重跑完整 API 回归，105 通过、0 失败；64 个 OpenAPI 方法/路径与详细手册逐项一致。54 个相对链接/锚点、31 个 shell 示例、7 个 JSON 示例和 1 个 Python 配置示例通过检查；OpenAPI 本地引用及 CI YAML 可解析。JS 使用 Node 语法检查，未声称缺失的 YAML LSP 诊断通过。
- CI 增加 Bun 1.4.2 和 opencodex 2.78.0 的 runner 安装步骤，为协议回归提供明确依赖，不跳过实际流式工具测试。本机已有安装版本没有改变。
