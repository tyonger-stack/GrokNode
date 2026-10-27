# 例行任务行右键菜单移植（official 0.75.8 → Grok Node）

需求：用户截图（官方 app）——例行任务行上右键弹出菜单：暂停 / 编辑 / Webhook / —分隔— / 删除（红）。
poteto-mode Feature 流程。

## 1. how — 官方证据（eager-app-BPR02W4s.mjs，一手字节）

### 行与菜单结构（lM d=128 @21190，M$e d=125 @21162）
- 行内容：`div[data-automation-row=id][role=group][tabIndex=w10?0:-1]`（name+schedule 两行）。
- 菜单包住整行：`xT > xT.Trigger{row} + xT.Content{"aria-label":_(zDSFmP「例行任务操作」), children: M$e(...)}`；
  行点击开详情的行为在外层 wrapper（0.18 同构：H2n onClick）。
- xT = Object.assign(yT, nn, {Content:hT,…})（官方菜单家族）。
- onOpenWebhook（F$e Provider @21185，值 @23653）：`(id)=>fe2({id, focus: a$e("webhook-url")})`
  = 打开该例行任务详情并聚焦 webhook URL 元素。Webhook 项仅当 `canOpen && io(trigger,"webhook")`（trigger 含 webhook 成员）。

### 菜单项（M$e，顺序与条件）
Section A（任一项存在才渲染）：
1. 暂停/恢复（canToggle）：icon `pause`/`play`；label `IgrLD/`「暂停」/`v39wLo`「恢复」（=isEnabled 取反）；
   onSelect=onSetEnabled(!isEnabled)（乐观态，失败回滚+行下内联通知 JKdhhI/v+fmj9——我们沿用开关同款乐观逻辑，失败回滚，不加行内通知槽）。
2. 测试（!isServerOwned && canEdit；Grok Node 全本地恒真）：icon `flask`；disabled=正在运行
   （runNow pending || runs[0].status==="running"）；label `NnH3pK`「测试」，disabled 态 `lziBgy`「运行中…」；
   onSelect=runNow（错误 toast：`EuB6Ib`「无法开始测试运行」+`7E5yw8`/`EkYKom`+`zga9sT`——与详情页 Test 现有行为一致）。
3. 编辑（canEdit，组件 w$e @21120）：icon `pencil`；label `ePK91l`「编辑」；
   onSelect=onSeedPrompt(_({id:`hsz5he`}) = EN "Edit your routine: {0}" / zh「编辑你的例行任务：{0}」)。
4. Webhook（见上）：icon `globe`；label `TRDppN`「Webhook」（裸词不译）。
Section B（独立 Section ⇒ 渲染出分隔线）：
5. 删除（canDelete）：icon `trash` + `color:"red"`；label `cnGeoo`「删除」danger 样式
   （children 包 span{dangerLabel}）；onSelect=确认弹窗 C$e：
   title `TNRo9Q`「删除“{name}」」/ desc `VAgxC4`「这将删除例行任务并停止其后续运行。此操作无法撤销。」/
   confirm `cnGeoo`「删除」/ pending `EF2EU9`「正在删除…」/ cancel `dEgA5A`「取消」/ 失败 `GX6bhk`
   ——与重建版详情页 remove() 现有文案逐字相同（已核对）。

### 0.18 移植原语（pinned registry chunk index-UbX-y3il.js，全模块作用域可引用）
- 菜单 root：`no = Object.assign(Tin, lNe, {Content: vin, SubMenuContent: Clt})`；侧栏先例：
  `p.jsx(no,{children:[p.jsx(no.Trigger,{children:<row>}), p.jsx(no.Content,{"aria-label":"Agent actions",minWidth:200,returnFocus:!1,size:"md",children:…})]})`
  （右键触发；Trigger 不劫持左键 click）。
- 项/节：`It.Item {leading:<Icon/>, onSelect, children}` / `It.Section`（侧栏 rename 端口同款）。
- 图标：bt/Dr 目录 794 枚，`pause`/`play`/`flask`/`pencil`/`globe`/`trash` 全部存在；
  danger 先例：`bt{color:"red",name:"trash"}`（侧栏删除项）。
- 官方 Content 只传 aria-label；0.18 侧栏传 minWidth:200/size:"md"/returnFocus:!1——先照官方裸 aria-label，
  实测渲染不佳再按 0.18 惯例补（记录进验证）。

## 2. architect — skip（理由）
单一字节级目标 + 仓库既有移植惯例（no/It 原语、routine-surfaces 注入件）唯一决定形态；无值得并行探索的设计分叉。

## 3. Throughput checkpoint
- Blocking first steps：取证（完成）与锚点核验先于一切；单文件 routine-surfaces-renderer-patch.mjs 改动先于打包验证。
- Independent workstreams：host 侧零改动（setEnabled/runNow/remove/seed 桥已有）；仅渲染补丁+测试，单流。
- Shared mutable state：routine-surfaces-renderer-patch.mjs 为唯一共享文件（并行会话不碰此文件）；单人独占分支写。
- Smallest safe decomposition：单 worker 最优——菜单是同一注入源串里的一个内聚组件，拆分只会增加锚点风险。

## 4. 范围
- 做：RRtOfficialRow 行包 no.Trigger；Content 渲染官方五项（顺序/条件/图标/文案逐字）；Webhook 项开详情并聚焦
  Webhook 卡 URL 字段（给 RRtWebhookCard 的 URL input 加稳定钩子 data-r-webhook-url）；删除走详情页同款确认；
  暂停/测试/编辑与详情页按钮共用同一逻辑与乐观态。
- 不做：行下失败内联通知槽（官方有 sM；我们开关失败回滚已是既有契约，不加）；键盘 Menu 键触发（官方 Trigger 自带，
  0.18 no.Trigger 行为为准，不额外发明）。

## 5. 执行记录
- [x] 取证（上文）
- [x] delegate 实现（feat/routine-row-context-menu：96a8302 菜单 + c948bf5 暂停态行文案 URAE3q）
- [x] review + 测试（逐 diff 审过；锚零改动；21/21 绿 + tsc 绿；产物 102 chunk node --check 全过）
- [x] 打包部署 + 实机右键验证（2026-10-27，见 §6）
- [x] 提交推送

## 6. 实机验证实录（2026-10-27）
- **菜单打开**：行上 dispatchEvent(contextmenu) → `[role=menu][aria-label=例行任务操作]` 弹出，覆盖在例行任务列表上（与官方截图同构）。
- **五项/四项**：webhook 例行（微信下旨入口）= 暂停(pause)/测试(flask)/编辑(pencil)/**Webhook(globe)**/删除(trash) 五项，与用户官方截图一致；
  cron 例行 = 四项（Webhook 按官方条件正确缺席）。两个 role=group 节，删除节红字红图标，节间分隔线渲染（截图确认）。
- **行为**：Webhook 项 → 打开详情并把焦点落在 Webhook 卡 POST 到 输入框（真实 URL 值）；
  编辑项 → 聊天框注入「编辑你的例行任务：微信下旨入口」（官方 hsz5he 逐字）；
  暂停/恢复 → 与行尾开关同乐观态翻转，暂停后行描述显示「已暂停」（官方 URAE3q，c948bf5 增量）；
  Escape 关菜单；左键行仍开详情（Trigger 不劫持 click，无回归）。验证动过的例行任务均已恢复原启用态。
- **合成事件注**：菜单项 onSelect 对 dispatchEvent(click) 不响应（Base UI 指针/键盘事件），用 focus()+Enter 键盘路径驱动——真实鼠标点击不受影响。

## 7. 顺带记录（非本任务缺陷）
- **打包偶发竞态**：同树连续第二次 package 曾报「MCP elicitation … requires the Auto-review approval pass first」——
  现场是 stage 里 view-QqBtBG74.js 缺 RArRuleNotice 而 registry chunk 已带新菜单（router pass 确已跑）。
  bisect：同代码重跑即绿（delegate 版/修改版各复验一次成功）。判为 overlay 拷贝与补丁 pass 的偶发竞态，重跑即好；
  根因在 overlayCleanDistribution 调度，未修，记录在案。
- **CDP 多页坑**：沙箱连上后 /json/list 会出现第二个 page（noVNC 预览 dc****:4），拿错 target 会查到空 root——
  认 title "Grok Bot" 的那个。
- **窗口隐藏 ⇒ pane 内容卸载**：窗口最小化/隐藏后 DOM 里例行任务行/详情按钮全消失（sM 的 isPaneHidden 逻辑），
  AX 树却还看得到残留按钮——CDP 与 AX 矛盾时先想窗口可见性。
