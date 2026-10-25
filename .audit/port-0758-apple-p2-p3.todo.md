# 0.75.8 P1/P2/P3 移植（Feature playbook）

## Playbook: Feature（poteto-mode）

- [x] 1. `how` over the affected subsystem. (inline: host runner tools / local-exec bridge 帧模型 / daemon 执行器注册 / port-0750 host 挂载 / coordinator transport-up —— 本会话内已完成，锚点见 rea-grokbot-0758/apple/evidence.json)
- [x] 2. `architect` for parallel design exploration. (skip: poteto-agent/子代理在本运行时不可用；数据形状由上游证据唯一决定——域表/权限键/op 表/错误族逐字锚定 evidence.json，无设计自由度可言，单方案直接实施。项目先例 .audit/p1-p3-0750.todo.md 同样回退 lead 直做)
- [x] 3. Throughput checkpoint（四项，见下）
- [x] 4. Delegate code-writing to a subagent. (skip: 本运行时无 pstack:poteto-agent；按项目先例 lead 直做，保持审查分离——每片独立测试+变异验证)
- [ ] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits.
- [ ] 7. If the design is contested, `interrogate` before shipping. (skip: 设计由上游字节锚定，无竞争方案)
- [ ] 8. Run Opening a PR. (skip: 用户未要求开 PR；按仓库惯例提交到本地 main)

## Throughput checkpoint

- **Blocking first steps.** 共享契约模块（apple-apps-tools 域表/权限键/op 表）先行——daemon 侧与 host 侧两片都消费它。
- **Independent workstreams.** P1（apple-apps）、P2（网络诊断）、P3（主 Bot 预热）文件集不相交，可并行；实际按 P3a → P1-foundation → P1-daemon → P1-host → P2 串行（单 owner）。
- **Shared mutable state.** `source/shared/node/port-0721-features.ts` 的 LOCAL_FEATURES（P1 加 grok_bot_apple_apps）是唯一共享写点，单独一刀。
- **Smallest safe decomposition.** 单 owner（code-coupled 单特性迁移）；子代理不可用，lead 直做。

## 实施单元

- [x] S0 本 todo + 决策痕（本文件）
- [x] S1 P1 契约模块 `source/shared/node/apple-apps-tools.ts` + 测试（对照 evidence.json 逐项断言）
- [ ] S2 P1 sidecar 传输 + daemon 执行器（apple-tool 帧 → est 分发 → Unix socket JSON）
- [ ] S3 P1 host 工具暴露 + grok_bot_apple_apps 门控
- [ ] S4 P2 网络诊断：bridge 检查面 + 前端 host 面板
- [ ] S5 P3 主 Bot 启动预热
- [ ] S6 验证：typecheck + 聚焦测试 + 变异；按 AGENTS 惯例提交

## 边界（证据诚实性）

- Sidecar 二进制本身复用 0721 线已 stage 的官方签名的 `Grok Bot Computer Use.app`（computer-use-sidecar-0721.mjs）。
- Messages consent 流（S2/S3 范围外）：decideLocalUse 判决链 + 渲染器审批 UI 需要渲染层补丁线，记为后续工作，不在本轮伪装完成。
- P2 UI 结构锚点：上游 chunk-network-debugger-dialog 的 data-network-check / remediation / tested-endpoint 属性。
