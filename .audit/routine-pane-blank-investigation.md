# Bug 调查：会话中创建例行任务后右栏详情空白（2026-10-26 深夜）

## 症状与定性

用户：例行任务在会话中建好后，右边栏详情页看不到。

结论（全部实测）：
- **数据链路正常**。聊天创建 → agent state 工具（writeAutomation → createAgentAutomation）→ roster `automations` push → 列表自动刷新，多轮复现（回合完成后 rows 即时出现，无需导航）。
- **真 bug 是 pane「半关闭空壳」竞争态**：回合结束与 pane 状态变化并发时，ASIDE 仍占 grid 第三列（88px 424px 352px）而 inner 已进入关闭表示（hidden+inert+children=0），grid 不收列。用户看到空白详情栏。触发窗口窄（整晚两次），无法按需稳定复现。
- **手动开关 pane 立即恢复，数据齐全**（点「查看对话详情」）。
- 同晚发现 Base UI modal 的 inert 清理泄漏（模态关闭后 pane/按钮残留 inert）。

## 修复尝试与撤回

给 info-pane-tabs entry 加卡死守卫（检测条件：ASIDE 占位 + inner hidden+inert+空，四条件同真）：
- 自动恢复版（重放关闭→重开）：渲染器启动即 100% CPU 自旋，永久无响应。
- 降级纯检测+log 版：同样自旋。
- 真 A/B（mv 走三个文件、恢复 HEAD 的 entry、重建部署）：无守卫构建秒响应（kids=3），两种守卫版全死。sample 栈 = `timers_callback_function` + V8 JIT 重编译链。
- **守卫彻底撤下**，遗档 /tmp/guard-ab（会话级）。结论写进 AGENTS.md：别往 tabs entry 挂 pane 状态检查/属性观察。

## 给用户的恢复操作

详情栏空白时：点一下中栏工具栏的「查看对话详情」开关即可恢复，数据都在。

## 根治方向（未做）

上游 0.18 pane 状态机：关闭流程的内外两层状态脱节（React 提交中断或 Base UI inert 泄漏）。需锚定 pristine chunk 的 pane isOpen 状态源与关闭渲染分支，属独立一轮工作。

## 附带事实

- tests/info-pane-tabs-extension / info-pane-native-integration 的 ~86-110s 文件级退出挂起：预存（stash 后同样挂），子用例全过。
- marketplace-browse-chrome-0758.test.mjs 一处失败：并行会话在途工作流（untracked 测试对着当时的 .build 跑），与本调查无关。
- 测试排查环境坑：孤儿 `node --test` 子进程会占共享 inspect 端口 9229；kill 后的全量测试残留进程持续抢 CPU 会放大一切。
- 测试例行任务（测试-列表刷新/面板关闭态/连续采样）已全部经 UI 删除，空态回到官方文案。
