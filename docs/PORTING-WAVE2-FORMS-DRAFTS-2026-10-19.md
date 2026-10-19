# 第二批移植：用户表单与外发草稿

日期：2026-10-20。状态：源码链路已接通。卡片采用 host 回执中的真实 state；请求结束后，转录退回的 editable 会盖过残留的本地 sending。本轮行为测试和两端类型检查已通过。真实浏览器填表、真实连接器发送和部署都未完成，源码通过不等于已安装或已部署。

## 2026-10-20 回执收口

- 显示优先级在 `frontend/src/recovered/features/conversation/cards/transcript-card/views/draft-actions.ts`：持久的 sent、discarded、unconfirmed、draft-created 最高；请求进行中立即显示 Sending；结束后采用非 sending 的本地结果；持久 editable 盖过残留的本地 sending。
- `tests/server-port-drafts.test.mjs`：26 项通过。缺工具失败回到 editable，丢弃回执的 state 为 discarded。
- `tests/server-port-cards.test.mjs`：30 项通过。host 的 editable、sent、unconfirmed、draft-created、discarded 会替换乐观的 Sending；转录随后退回 editable 时恢复 Ready to send 和发送按钮。
- `npm run typecheck` 与 `npm run source:typecheck` 通过。命令使用仓库要求的 Node 26。
- 未验收：真实 Chromium、真实 Gmail、Outlook、Slack 账号，以及已安装 App 和运行容器。

## 对照范围

服务端为用户指定容器 `grok-bot-local-vm-before-0712-20261016` 中的 `/opt/sand/sand-host/host-main.cjs`，版本 `2e0e295`，SHA-256 `e6d3de1d82c6aaf263efab7e7f50292c2b99be42ffb56743b2b4bb1bc0272cf7`。原始行号按本机已校验副本 `/private/tmp/grok-before0712-evidence-20261019/host-main.cjs` 计算。

客户端参考目录 `/Users/Apple/Documents/grokbot/grok-bot-port-0712`，HEAD `183294732c5ef3d1c8145bec1a3b229578d30c83`，属于重建移植分支，其 checksum-pinned 构建输入仍为 0.18.0 DMG。因此客户端现有代码用来定位接入面，较新的行为契约以指定服务端产物为依据。

REA 对 20 个模块切片解析成功；证据 `ev_50063bc80176bcc52c3dcafdfe4bf3731444dc7cf95cf6e728617a9434ad7a00`。静态跨模块追踪存在动态调用未知项；以下结论同时核对了原 host 的 gateway 路由和 transcript 调用点，不将静态分析等同于真实账号验收。

## 第一条交付线：草稿创建到用户发送

### 已有能力与缺口

- 客户端已有 `email-draft`、`slack-draft` 卡片和本地编辑状态。两张卡片现在经 `useDraftActions` 提交最终编辑值；`preventDefault()` 只阻止表单默认提交。
- `protocol.ts` 的类型与投影只允许 `editable`、`sending`、`sent`，需要一起扩展，不能只让 host 写入新状态。
- 正式版 `DraftExternalMessage` 工具在原 host 717120 附近；`DraftSends` 在 704909，gateway 的 `sendDraft`、`discardDraft` 在 450128、450135。服务端先核对路由与发送身份，再持久化领取发送权，随后重验账号身份并执行。

### 实施顺序

| 步骤 | 交付内容 | 主要接入位置 |
| --- | --- | --- |
| D1 协议与存储 | 统一草稿、路由、核验快照、状态、回执；同一条记录包含作者初稿与用户最终稿；旧记录可读但缺少已验证路由时拒绝发送 | `source/shared/`、transcript 存储与客户端 `protocol.ts` |
| D2 生成工具 | 移植 `DraftExternalMessage` 的 schema、路由解析、账号/目的地事实核对；复用已有 connector 执行与授权流程；生成可操作卡片 | `source/host/runner/tools/`、`turn-toolset.ts`、host 生产组装 |
| D3 用户操作贯通 | 接通 `sendDraft`、`discardDraft` 的 host gateway、coordinator RPC、preload、卡片事件；按钮提交最终编辑值，禁止用模型工具自动代点 | `source/host/host-gateway-api.ts`、`source/shared/rpc/coordinator.ts`、`source/electron-main/coordinator/`、`source/electron-preload/`、两张现有卡片 |
| D4 一次发送与收敛 | 原子领取 `sending`，按 agent/entry 去重；连接身份变更时回滚或拒绝；完成时保存真实结果；启动扫描遗留 `sending` 并收敛到未确认 | 新 transcript `draft-sends` 服务与第一批恢复协调器 |
| D5 双端验收 | 两种卡片的真实编辑/丢弃/错误投影；模拟 connector 全链验证后，以用户指定的测试目的地验证真实发送 | 客户端交互测试、隔离 host fixture、指定连接器 |

先将一条真实可用 connector 的完整链路跑通，再接第二种；连接器选型由开发时只读列出的实际工具能力决定。不能用假成功替代缺少的发送适配器。Gmail/Outlook 的“建立草稿后再发送”要保留两阶段结果；Slack 要验证工作区、频道/DM 和 thread。

### 状态和不可破坏的语义

| 状态 | 含义与允许动作 |
| --- | --- |
| editable / 未设置 | 可编辑和丢弃；只有验证过的路由才能领取发送 |
| sending | 已领取；双击、重连和第二个窗口不能再次执行 |
| sent | 已确认送达；显示最终稿与事实回执 |
| draft-created | 邮箱草稿已建立，但最后发送未完成；引导用户去邮箱完成 |
| unconfirmed | 请求可能已送达；不得自动重发，先核对目的地 |
| discarded | 用户丢弃；后续发送请求拒绝 |

正式代码保留作者初稿用于重试与对照；用户最终稿作为 `<sent_draft>` 事实记录回灌，不解释为新指令。不要把“请求失败”统一解释为“未发送”。发送授权绑定用户当次点击、卡片、账号和路由；换账号后旧卡片不得沿用核验结果。

验收至少覆盖：双击/双窗口并发；改收件人/正文；换登录账号；发送前权限失效；请求超时但远端成功；重启时 sending；丢弃与发送竞争；不同 agent 同 entryId；最终稿中的指令样文本不被执行。真实外发验收使用用户明确指定的测试收件人/频道。

## 第二条交付线：短寿命、只写的用户表单

### 正式契约

`RequestUserForm` 在原 host 685855 附近；`UserFormResponses` 的提交/丢弃在 709514、709645；gateway 在 450040、450041；`RemapUserFormTargets` 在 736733 附近。

- 最多八字段，支持 text/email/tel/password/otp/number/date/select/textarea/checkbox；select 最多二十个选项。密码和 OTP 始终视为秘密。
- 所有提交值只写，普通资料也不回传给模型。回执只包含字段 id、填入/失败/未填状态及可分类的原因。
- 任何带目标的字段、任何秘密字段都要求已验证的目的域名。裸域与 www 可等价，其余子域不能自动放宽。
- host 从当前真实页面确认目的地，提交时再次检查；禁止根据模型声称的 URL 放行。域名切换、过期 ref、隐藏或无法确认的目标都返回明确失败。
- 页面变化时，仅在原同意域名和同一回合中保留待填值，允许一次 `RemapUserFormTargets`；完成、取消、回合结束、停止与 host 关闭均清理。
- 不通过截图/OCR/页面读回检查秘密值；日志、模型消息、转录和可检索数据均不保存提交内容。

### 实施顺序

| 步骤 | 交付内容 | 验收面 |
| --- | --- | --- |
| F1 共享契约 | 请求/字段/目标/字段回执 schema，卡片状态与过期语义，域名规范化 | 畸形字段、重复 id、超过八字段、secret 无目标、非法域名均拒绝 |
| F2 host 服务 | 按 agent/request 管理 pending 表单、短寿命值和一次重映射；复用现有浏览器与 auto-review 边界 | 模拟页面导航、过期定位、隐藏字段、取消/停止/重启 |
| F3 双端操作 | `submitUserForm`/`dismissUserForm` gateway→coordinator→preload→表单卡片；输入值仅进入 host 私有填入路径 | UI 展示精确域名、密码/OTP 遮罩；模型只见状态 |
| F4 模型工具 | `RequestUserForm` 和 `RemapUserFormTargets` 进入动态工具目录，挂接同一回合生命周期清理 | 模型不能获得原值；第二次重映射拒绝 |
| F5 完整验收 | 合成凭据与本地测试页的真实填入，跨域拒绝，浏览器断连与恢复 | DOM 真实收到合成值；模型/转录/日志中检索不到值 |

表单卡片是新增客户端功能，不能用现有 `secret-request` 冒充完成。普通资料 vault、跨站持久保存、1Password broker、云迁移后端不包含在这条首轮交付线中。该产物 `sand_user_form` 与 `sand_draft_external_message` 的代码默认值为 true，`grok_bot_form_vault` 为 false；这并不证明当前账号的远端开关值，移植时仍按本地已接通能力暴露工具。

## 合并与发布条件

两条交付线各自形成可运行的纵向改动，先做共享协议，再接 host 与客户端。每条必须通过类型检查、相关行为测试、生产 host/客户端构建，以及实际卡片和隔离服务的组合验收。源码构建结果、已安装 App 和运行容器分别记录版本，不能将源码通过写成已部署。
