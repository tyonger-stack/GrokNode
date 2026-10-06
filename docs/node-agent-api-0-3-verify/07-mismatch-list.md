# 07 需求偏差清单（list）

判定口径：行为与 requirements.md / OpenAPI / 文档描述逐条比对。M1-M3 已修复并复验，保留记录备查。

## M1 import 缺 files 报 502，应 400 —— 已修

- 曾复现：POST project/import {} → 502 execution_failed。
- 根因：server.mjs 的 object() 只排斥未知键、不校验必填，files=undefined 直落 Linux 程序抛错，被包成 502。
- 修复：server.mjs 补 Array.isArray(files) 校验，缺失即 400 files array is required。复验：{} → 400（13ms，未进盒子）。

## M2 import 复写同路径报 502，建议 409 —— 已修

- 曾复现：同 path 第二次 import → 502。Linux 程序拒绝覆盖是对的，重试语义不对。
- 修复：runtime/project.mjs 改为收集 conflicts 并返回 {imported:0,conflicts}；codex.mjs 映射为 409 import_conflict。复验：复写 → 409；多文件正向 → 200 {imported:2}（含子目录）。

## M3 restore 未知 backup_id 报 500，建议 404 —— 已修

- 曾复现：POST restore {backup_id:nope} → 500 internal_error（realpath ENOENT 未捕获）。
- 修复：shared-runtime.mjs restore 对 realpath 与 manifest/archive 缺失均报 404 backup_not_found。复验：nope → 404；正常往返仍 200。

## M4 desktop 空体默认 view——已核为一致，不收录

- OpenAPI AuthorizeDesktop.mode 有 default:view，{} → view 票据符合契约。ttl 默认 60s 也解释了 CLI 旧票据 401。

## M5 会话创建与 submit accept 延迟 11~37s（性能备注，非偏差）

- createSession 12~33s，submit accept 10~37s，resume 35s，handoff 19s：均为 harness 接线成本，成功语义不受影响。网页 loading 需按此设超时。

## 有意未覆盖（理由 + 替代证据）

1. createAgent 正向：会在 GrokNode 建真 bot；400 校验已验，A/B 真 bot 创建记录在案。
2. launchApplication 正向：会在用户盒子弹 GUI；403 未持租约路径已验，窗口枚举与租约逻辑由 applications 回归测试覆盖。
3. SSE 长连接保活：列表/游标/心跳逻辑由回归测试覆盖；实测只到 GET 列表。
4. CLI recreate 试运行：自动审批拒绝（共享盒子风险）；代码级拒绝 + API 409 两次已验。
5. CLI codex/resume 交互：需人工终端；参数校验已验。

## 回归基线

- 8 文件 87/87 通过（修复后重跑）；service-load 41 项 fixture 在 VERIFICATION.md 有载。
- M1-M3 修复后已逐条 live 复验（见 03），本清单关闭。
