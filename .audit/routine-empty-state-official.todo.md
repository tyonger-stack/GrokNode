# Playbook: Feature — 例行任务空态对齐官方 0.75.8 + 去掉创建按钮（聊天创建为准）

- [x] 1. `how` over the affected subsystem.（inline，证据见下）
- [x] 2. `architect` for parallel design exploration.（skip: 单表面小改，官方字节唯一决定目标形态，无设计自由度）
- [x] 3. Throughput checkpoint（四项，见下）
- [x] 4. Delegate code-writing to subagent（`codex/routine-empty-state-official` @ `0a04261`，lead 审查 diff + 独立复跑 21/21 + 字面量零残留后 ff 合入 main）
- [x] 5. Verify on the matching surface（打包部署 16:01 + computer-use 实测，见下）
- [x] 6. Rebase into small, ordered commits（单提交 0a04261 + 收尾提交：layout-qa 适配 + 本轨迹 + AGENTS.md）
- [x] 7. `interrogate` before shipping.（skip: 无争议设计）
- [x] 8. Opening a PR（按仓库惯例直推 main；推送与同步验证见提交记录）

## how 证据（2026-10-26）

- 官方 0.75.8 空态：仅本地化文案，message id `ZJmAzX`
  en "Routines are recurring tasks this Bot runs on a schedule. Ask it in chat to set one up."
  zh 「例行任务是此 Bot 按计划重复运行的任务。请在聊天中让它设置一个。」
  （rea-grokbot-0758/frontend/index.eager-app-BPR02W4s.mjs 两处：locale 表 + `jsx(ka,{id:"ZJmAzX"})`，react.memo_cache_sentinel 缓存）
- 官方例行任务 heading 无任何 action（端口注释 routine-surfaces-renderer-patch.mjs 原记录）。
- 0.18 上游（pristine index-UbX-y3il.js `K2n`）空态 = `<p>描述</p>` + `Qs` 按钮 `children:"Create Routine"`；heading 有 `+` tooltip 动作，两者同 handler `xe`（打开 `_2n` 表单编辑器）。i18n 翻译对在 scripts/lib/main-i18n-patch.mjs:714-715（本任务删除）。
- 聊天创建链路（host，与 UI 无关）：state 工具 `writeAutomation`（source/host/runner/tools/sand-state-tool.ts:266）→ `automationRuntime.createAgentAutomation`（automation-runtime.ts:430）→ store upsert；系统提示（system-prompt.ts:248/261）驱动 agent 主动提议。删 UI 按钮不影响此链路。

## Throughput checkpoint

- **Blocking first steps.** 官方文案 id + pristine 字节锚点（上节）已完成，是 delegate 的前置门。
- **Independent workstreams.** n/a: 单表面（一个 patch 文件 + i18n 表两条 + 对应测试），拆分只加协调不加并行。
- **Shared mutable state.** registry chunk 变换链与 main-i18n pair 表：改动收敛在现有函数/表内、不新增共享写点，天然串行。（共享检出里并行 marketplace 流的脏文件与范围零重叠，delegate 预检停机一次，lead 放行 scoped-add-only 后完成。）
- **Smallest safe decomposition.** 一个 delegate 全包 renderer patch + i18n pair + 测试；lead 负责审查、打包、computer-use 实测。

## 决策

- 空态文案：借 RLocT(en=官方原文, zh=官方 ZJmAzX 译文) 走端口既有 RRtLoc helper；官方同为 memo 缓存，语言切换不刷新与官方一致。
- 删除两处创建入口（空态按钮 + heading `+`）对齐官方「聊天创建」形态；`_2n` 编辑器仍可从行→详情→编辑进入（编辑路径不变）。
- i18n pair 714-715 删除（锚定字面量消失后 applyPair 零命中 fail-closed），同步更新 main-i18n-patch.test.mjs（断言缺席 + "Agent settings" 阳性对照）。
- 空态容器 min-height 72→60（纯文案两行）。
- tests/routine-surfaces-layout-qa.mjs（独立 QA 脚本，不在 npm test glob）：创建按钮交互/断言改为按钮存在才执行，after 版按钮必须为 null。

## 5. Verify 实录（2026-10-26 16:01 部署，computer-use）

部署：main @ 0a04261 整包重建 → ditto /Applications → 9224 起动，root 3 子节点无错误横幅。staged chunk 官方文案 1 处、"Create Routine" 0 处、node --check 过。

1. **空态**（电信PPT大师，即用户截图同 Bot）：AX 树 text =「例行任务是此 Bot 按计划重复运行的任务。请在聊天中让它设置一个。」；全树无「创建例行任务」按钮、无 heading `+`；截图视觉确认两行文案无按钮。
2. **聊天创建**（computer-use 全程）：点击输入框 → paste（typeText 对 ProseMirror 丢字，首次发出 "-10"，改 paste 后全文落位复核）→ Return 发送（16:08）→ agent（Router 推理）回复「建好了…每天上午 10 点会提醒你喝杯水」→ transcript 出现「Open routine 测试-喝水提醒」按钮 → 点击后详情面板显示：指令「给勇哥发一句话提醒：喝水时间到，记得喝杯水。」、何时运行「Every day at 10:00 AM」、暂停/测试/删除按钮。无审批卡阻塞（auto-review 自动放行）。
3. **清理**：删除例行任务 → 官方文案确认框（「这将删除例行任务并停止其后续运行。此操作无法撤销。」）→ 确认 → 列表回到官方空态文案。测试残留：聊天里 "-10" 与创建/删除对话记录保留（历史消息，无单条删除入口）。

结论：空态文案与无按钮形态逐字对齐官方；去掉按钮后聊天创建例行任务全链路（消息→state 工具→store→列表→详情→删除）实测可用。
