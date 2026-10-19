# 第一批服务端移植验收记录

日期：2026-10-19。工作分支：`codex/server-port-wave1-20261019`，基线为 `github/main` 的 `089be7bf3999d5c7300135b1a011892571add7ea`。本批六项已完成源码接入、测试与构建；尚未提交、推送或替换已安装 App/运行中的 host。

## 正式版依据

指定服务端容器：`grok-bot-local-vm-before-0712-20261016`。实际 host 版本 `2e0e295`，文件 `/opt/sand/sand-host/host-main.cjs`，SHA-256 `e6d3de1d82c6aaf263efab7e7f50292c2b99be42ffb56743b2b4bb1bc0272cf7`。本机同字节副本位于 `/private/tmp/grok-before0712-evidence-20261019/host-main.cjs`。

客户端参考为 `/Users/Apple/Documents/grokbot/grok-bot-port-0712` 的 `183294732c5ef3d1c8145bec1a3b229578d30c83`，该目录是重建移植分支，不能当作官方完整源码。此次服务端产物也不能与先前 `fcbae14` host 混用。

REA 对相关 20 个模块切片解析成功：`ev_50063bc80176bcc52c3dcafdfe4bf3731444dc7cf95cf6e728617a9434ad7a00`；冻结和循环策略的追加分析为 `ev_93c86ee1b78ffae3b26a0e6648a7aab90fcf40c0982e7730b9c502b7b7c8af98`。动态跨模块边仍有未知项，行为以代码调用点、隔离测试和下面的实际解码结果共同验证。

## 已完成的六项

| 功能 | 正式版锚点（原 host 行号） | Grok Node 落点及行为 |
| --- | --- | --- |
| 统一停止 | `sand-subagent-management-tools` 736030、736073 | `runner/tools/sand-subagent-management-tools.ts`、`subagent-runtime.ts`、`delegated-work-stop.ts`：单个 id 与 `all: true` 二选一，递归停止本地子孙任务，逐项报告成功/已结束/失败；只取消本任务所属的 peer 委派和本 runner 确认启动的 cloud agent |
| 恢复屏障 | `resume-ownership-service` 666323、生产组装 666726 | `local-resume-coordinator.ts`、`turn-execution/local-recovery-gate.ts`、`sand-host.ts`：启动/重建关闭新执行，串行接管旧任务、重挂 wake，再放行用户任务、自动化和延后工作；失败后台退避重试，旧 generation 不得放行 |
| 提示缓存 | `frozen-prompt-section` 674682、`prompt-prefix-observation` 717532 | `runner/frozen-prompt-section.ts`、`system-prompt-assembly.ts`、`prompt-prefix-observation.ts`：补时区/routine/Bot 目录/MCP 的冻结；变化只宣布一次；下一压缩代刷新；结合已有 memory/related 快照，记录 system/user_info/tools/分段哈希与用量 |
| 循环策略 | `loop-detection-policy` 710654、配置组装 753782 | `runner/loop-detection-policy.ts`：off/shadow/on，归一化易变元数据，识别交替工具循环、等待/截图进展、明确允许重试的结果与连续外发；shadow 仅观察，on 注入提醒并复用单消息循环的一次重试路径 |
| HEIC 显示 | `image-display-rendition` 576269、附件接入 576964 | `attachments/image-display-rendition.ts`、`attachments-service.ts`、`shared/media/image-dimensions.ts`：授权读取后用私有副本解码，最长边 4096，支持 tile grid 和主图旋转/镜像，32 项缓存、并发合并、失败退避；原始文件仍可下载 |
| 状态工具拆分 | `state-tools/split-tools` 735880、工具组装 737400 | `runner/tools/sand-split-state-tools.ts`、`turn-toolset.ts`：新增 UpdateRoutine/UpdateSkill/UpdateProfile/UpdateAvatar/DisconnectChannel，复用原状态写入和审查；旧 update_state 保留兼容；动态工具有简短发现提示 |

上述路径均相对 `source/host/`，`shared/media/image-dimensions.ts` 相对 `source/`。

恢复适配使用本地存储和现有执行器，没有新增云身份或迁移后端。磁盘恢复标记不再批量提前删除：任务开始后仅在当前 host 内标记“已接管”，成功结束后只清理仍匹配的旧标记；会话暂不可用、执行出错和更新后的新标记会保留。恢复旁路的异步作用域在接管完成后撤销，旧任务不能借此前的恢复作用域穿过下一轮屏障。

停止边界经过专门测试：撤回排队消息不会取消目标 Bot 的其他子任务；用户正在目标 Bot 上执行的新任务不会被父 Bot 停止；仅 watch 到的云任务不能作为所有权依据，不可达项明确回报。独立后台 Shell 进程仍按其 PID 管理。

循环模式来自 `SAND_LOOP_DETECTION_MODE` 或 `grok_bot_loop_detection.mode`，缺失/非法值为 off。未擅自启用 on。跨消息比较限制在最近 256 条候选 assistant 消息内，防止超长转录造成无界比较。新循环事件只含种类、次数与指纹。

SDK 的 `providerMetadata.openai.cachedPromptTokens` 已接入真实 provider executor 的 cache read 用量，依据本仓库安装的 `@ai-sdk/openai` 源码。上游未提供的 cache write 仍沿用 0；本次未测量真实账号缓存命中率、费用或延迟改善，也未新增团队 TTL 设置。

## 验证结果

- `npm test`：2010 项，1991 通过，19 跳过，0 失败。日志：`/private/tmp/groknode-wave1-full-tests.log`。
- `node --test tests/server-port-*.test.mjs`：新增 30 项通过，0 失败。覆盖真实工具执行、父子孙停止、真实 inbound wake 所有权记录、SQLite 快照、恢复失败/重复/新标记、wake 重挂、模式和豁免、provider 请求与缓存用量、HEIC 主图属性与并发缓存。
- 生产 `SandHost.start()` 与 `getApi().resumeBoxAfterRecreate()` 的组合测试通过：新请求阻塞；恢复作用域能接管；wake 重挂后才恢复自动化。外部服务以隔离适配器替代，未发送真实模型请求或消息。
- `npm run typecheck`、`npm run source:typecheck`、`npm run frontend:build` 均通过。前端存在原有的同时静态/动态导入提示，构建成功。
- `buildProductionHostIfSupplied` 返回 `validated-clean-source`、`clean: true`，产物为 `/private/tmp/groknode-wave1-production-host/dist/host/host-main.cjs`，SHA-256 `3a5154280d68017d33eaa9db49adffc6aa271774d864c7471405627d807f9753`。
- `git diff --check` 通过。

### 容器中的真实图片读取

使用 macOS sips 从合成 PNG 生成 64×32 HEIC，仅放在本机与 `grok-node-local-vm` 的独立 `/tmp` 数据根。容器已有 ffmpeg/ffprobe `7.1.5-0+deb13u1`，实际执行新转换器和生产 `readHostAttachmentImage`，结果：

```json
{"jpeg":true,"bytes":4741,"attachment":{"width":64,"height":32,"mime":"data:image/jpeg;base64,","outsideOwnerRejected":true},"probe":{"streams":[{"width":64,"height":32}]}}
```

样本放入该合成 agent 的 attachments bucket 后，生产读取返回可显示 JPEG data URL 和正确尺寸；bucket 外样本被拒绝。未读取真实照片或用户转录。真实解码只覆盖这张合成 HEIC；tile grid、大图、旋转/镜像和错误输入由定向测试覆盖，未宣称已覆盖所有相机文件格式。

## 第二批准备

实施拆分、协议落点、顺序和验收条件已记录在 [第二批表单与草稿移植准备](PORTING-WAVE2-FORMS-DRAFTS-2026-10-19.md)。草稿需要接通现有卡片与真实发送服务；表单需要新增只写字段、目的域名核验和一次重映射服务。第二批尚未开始编码。
