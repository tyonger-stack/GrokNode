# 02 消息与取消

需求对应：条目 4（模型调用在 Mac，执行端不可用则失败不回落）、条目 5（真实项目对话）、取消走 Harness 机制。

## 实测

- submit 形状：{type:message,text} 与 agent.session.input.message + input_text 均为合法（OpenAPI 与 input.mjs 一致）。探针误用的 agent.session.input.text 得 400，属探针错误，接口行为正确。
- submit 需顶层 events 数组（单条）+ 可选 idempotency_key；header 与 body key 不一致：400。
- 真实回合（3 字符 trivial 回复）：202 accepted 带 turn_id；约 6 秒后 completed；agent 原样回复 ok1；traces 记录 native 用量（input 9282 / output 6，cost 恒 null，与文档“未知成本为 null”一致）。
- 取消路径：提交 sleep 45 长任务，running 确认后 POST cancel 事件：202 accepted；8 秒后 turns 显示 cancelled；盒内复查无 sleep 45 残留（仅 GrokNode 自有 ticker）。actions 为空（该回合无审批门）。
- capabilities.events.cancellation 为 true，与 adapter.cancel 存在一致；取消只停当回合、不停共享盒子（进程检查佐证）。

## verdict

一致。对话→回合→用量→取消全链路真实走通；fail-closed 与中断语义符合需求 4、8。单次 submit accept 耗时 10~37s（harness 来回成本），见 07 M5。
