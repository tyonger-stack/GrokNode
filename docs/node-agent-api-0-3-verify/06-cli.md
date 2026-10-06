# 06 CLI（client-cli.mjs 7 命令）

需求对应：条目 5（网页与 CLI 同一 bot 同一桌面同一 thread）。

## 实测（bot A，--api-origin 指向 18771）

- status：0，running true，容器 grok-node-local-vm，display 6，workspaceRoot /workspace/codex-projects/node-agent-api，transport stdio。
- ensure：0，同上（幂等就绪）。
- desktop --mode view：0，签发 session + ticket + desktopUrl，可在浏览器打开（票据链路见 04）。
- backup：0，落盘 .lab/shared-runtime/.../backups/，consistency 注明不暂停 GrokNode 进程。
- resume 缺 --thread：报错退出；未知命令：打印 Usage；status 未知 bot：Bot not found。
- recreate：未执行。自动审批以“共享盒子重建影响全部 bot”为由拒绝了即使是验证拒绝行为的试运行；替代证据：shared-runtime.mjs:132 直接抛 409 managed_by_grok_node（不碰盒子）+ API recreate 实测 409 两次。
- codex / resume 交互：未进真机（需人工终端 + 模型成本）；参数校验路径已覆盖。

## verdict

一致。CLI 与 API 共用同一映射（bot A → display 6 → 同一共享项目），未另建编号规则。
