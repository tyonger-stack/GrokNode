# 交接：Codex 会话 01a15c55 → Cursor（2026-10-22）

## 总目标
Grok Bot 0.72.1 的新功能移植进 Grok Node，能从 Grok Bot 移植就不重写。分析产物在 /Users/Apple/Documents/grokbot/rea-grokbot-0721，可继续用 rea MCP。
勇哥追加的硬性要求：本地 Computer Use（sand_enable_local_cua）必须实现；点击/几何执行复用官方签名的 sidecar（Grok Bot Computer Use.app），不自研输入注入，也不降低签名/manifest 校验。

## 现状（Codex 最后一次自述）
- 0.72.1 主体功能和候选安装包已完成（主工作树 port-0721，见 .audit/port-0721.todo.md 和各 *.log）。
- 没做完的是本地 Computer Use，清单见 .audit/local-cua.todo.md（U1、U2…）。
  - U1（sidecar 供应 + 打包签名信任边界）：方案已定为「只接受 GROK_BOT_SIDECAR_APP 显式来源 → 完整验签 → ditto 原样复制并生成 sidecar-manifest.json；打包时先把官方 helper 移出，ad-hoc 签外壳，恢复后只刷新外层 seal，再分别验签」，没有来源就让构建失败。实现在进行中，未确认完成。
  - 已知：本机 /Applications 里的 helper 的 entitlement 已损坏，只能用来验证构建会失败，不能打进包。需要一个干净的官方 helper（官方 DMG）。
  - U2（daemon 层）：在 local-exec-daemon 里作为第二类工具 provider，经 bridge 新增独立的帧类型，不能伪装成 shell exec。参考材料在 ../grok-node-port-0721-cua-daemon/.audit/。
- 主工作树有 123 个未提交改动，里面还有其他 0.72.1 的改动，不要回滚。

## 相关目录
- 主工作树：/Users/Apple/Documents/grokbot/grok-node-port-0721（分支 port-0721，HEAD c747d89）
- 子工作树：-cua-daemon、-cua-worker（detached），-desktop-ui、-extractor、-native、-network、-vault、-visual-host、-visual-ui
- Codex 会话全文：.audit/codex-session-01a15c55-transcript.txt

## 规矩
改完先给勇哥看 diff，同意后再提交；不推送。
