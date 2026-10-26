# 0.75.8 三项功能移植（Feature playbook）

## Playbook: Feature（poteto-mode）

- [x] 1. `how` over the affected subsystem. (inline: 三个面锚点见下)
- [x] 2. `architect` for parallel design exploration. (skip: 三个面各自单刀，数据形状由上游字节唯一决定，无设计自由度)
- [x] 3. Throughput checkpoint（四项，见下）
- [ ] 4. Delegate code-writing to subagents（三个 worktree，各一个 owner）
- [ ] 5. Verify on the matching surface
- [ ] 6. Rebase into small, ordered commits
- [ ] 7. `interrogate` before shipping. (skip: 无竞争方案)
- [ ] 8. Opening a PR. (待用户决定)

## Throughput checkpoint

- **Blocking first steps.** 三条 patch 都要挂进 `scripts/clean-build.mjs`，且都必须在 i18n pass 之后（都吐 RLocT / 原文案）。clean-build 是唯一共享写点 → 串行合并，但三个 patch 文件本身互不重叠 → 并行写。
- **Independent workstreams.** A/B/C 三个 patch 文件 + 三个测试文件，文件集完全不相交，可并行。
- **Shared mutable state.** `scripts/clean-build.mjs` 的 pass 序列。单独一刀由 lead 合并，避免三份冲突。
- **Smallest safe decomposition.** 三个独立功能面，各自一个 owner + 一个 worktree。

## 单元

- [ ] A. 连接器卡片（connector cards）
      锚点：official `chunk-connector-card-view-C82KF2jU.js` / `chunk-connector-card-CZh49V48.js`
      installed 已有 `connector-card-BOH-l7tH.js`（24.5 KB，0.18 基线自带）
      → 先判定：是补 UI 还是补文案/状态
- [ ] B. 电脑更新排程
      锚点：ids `oca6v8`/`HW+8vB`/`Q15keH`/`5EQ+DK`/`rH1I8B`/`FzTsgz`/`U9/MwS`
      消费点：`chunk-view-KUSBlG8Y.js`（唯一非 locale 消费者）
- [ ] C. MCP elicitation 审批卡
      锚点：official `chunk-unrequested-meeting-approval-DJ_BNQSG.js`（24 KB）
      依赖 `chunk-auto-review-selector` + `chunk-sand-auto-review-instructions`
      installed 零命中（elicitation 一词在整个装机 asar 无出现）
