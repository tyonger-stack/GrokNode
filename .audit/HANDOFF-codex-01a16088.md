# Cursor 交接：Codex 会话 01a16088（Grok Bot 0.75 → Grok Node）

- Codex 链接：`codex://threads/01a16088-6e11-74d3-a3af-3f09c79c3aa8`
- 会话原文（可读）：`/Users/Apple/Documents/grokbot/.audit-codex-01a16088/codex-session-01a16088-transcript.txt`
- 机器原始 jsonl：`~/.codex/sessions/2026/10/22/rollout-2026-10-22T06-15-25-01a16088-6e11-74d3-a3af-3f09c79c3aa8_01a16088-90ae-7783-8884-9fe3a3b2f0c2.jsonl`
- 工作目录：`/Users/Apple/Documents/grokbot`（主工程 `grok-node-port-0721`）
- 交接时间：2026-10-23（北京时间）

## 任务是什么

把官方 Grok Bot **0.75.0** 相对 0.72.1 的增量，移植进 `grok-node-port-0721`。分析产物在 `rea-grokbot-0750/`，差分报告在 `~/Downloads/0.72.1→0.75.0差分报告.md` 与 `rea-grokbot-0750/REPORT-0721-to-0750.md`。

## 已经完成（据会话末尾与 todo）

1. **P0 完成**：`upstream-0750.mjs` + `manifests/ports/grokbot-0750-unpacked.json`；清理恒开的 `sand_desktop_mount_capture`。详见 `.audit/p0-upstream-0750.todo.md`。
2. **P1–P3 代码完成（组件/测试）**：36 个新测试全绿；聚焦回归 46/46；双 typecheck 通过。详见 `.audit/p1-p3-0750.todo.md`。
3. Vault 卡片对话框被**并发线更好的实现覆盖**；本会话未回写，而是采纳对方版本并跑通其 8 个测试。

## 明确未做 / 下一步（优先按这个顺序）

1. **记忆导入持久化**：设置面板到主机缺一条 persist 调用。
2. **UI 接线（需产品定入口）**：金库对话框、MCP 表单、插件面板、Teams 引导尚未挂到正式界面。
3. **Pele**：仅有架构切片与 fallback；引擎本体与 flag 进注册表未做。
4. **清理项 C-1 / C-2**：不在本次范围（见 PORTING-CHECKLIST）。
5. **提交**：工作区有大量未提交改动且有并发改动，**不要擅自 commit / push / reset**；改完先给 diff。

## Cursor 开场提示（复制即可）

```
这是 Codex 会话原文：/Users/Apple/Documents/grokbot/.audit-codex-01a16088/codex-session-01a16088-transcript.txt
先通读原文，再读同目录 HANDOFF-cursor.md，以及 grok-node-port-0721/.audit/p0-upstream-0750.todo.md、p1-p3-0750.todo.md 和 rea-grokbot-0750/PORTING-CHECKLIST-0750.md。
从「未做」清单继续：优先补记忆导入持久化，再按产品入口接线 UI；不要回滚并发线的 vault 实现。
改完先给我看 diff，不要提交和推送。
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| 移植工程 | `/Users/Apple/Documents/grokbot/grok-node-port-0721` |
| 0.75 REA 产物 | `/Users/Apple/Documents/grokbot/rea-grokbot-0750` |
| 0.72.1 REA 对照 | `/Users/Apple/Documents/grokbot/rea-grokbot-0721` |
| 差分报告 | `/Users/Apple/Downloads/0.72.1→0.75.0差分报告.md` |
