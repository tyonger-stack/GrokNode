# 右栏四标签（详情｜资料库｜电脑｜其他）实施记录

日期：2026-10-14。范围：Grok Node 右栏从单栏改为四标签，样式对齐正式版 0.70.2。

## 正式版依据

正式版 app.asar SHA-256：8dd7b6c4a58439d626a9a7b3766982b7c725db2bc1f6ff68a29fc1ec62ca4cf7。
本地核对副本与装机一致：rea-grokbot-0702/app/dist 与 /Applications/Grok Bot.app 内容哈希相同。
标签实现：index-CjjO5fU0.js 的 wq 组件，分支顺序 overview、media、computer、meetings、members、routines；
中文文案经 i18n 目录确认：URmyfc=详情，exYcTF=资料库（英文 Library），9lzViG=电脑。
标签样式 Wm.overviewTab：上下内边距 4px、左右 8px、圆角 9999px、透明底、次级文字、nowrap、pointer；
选中态 Wm.overviewTabActive：背景 var(--sand-bg-secondary)、主文字色。
内容区：Wm.overviewScrollFill 与 Wm.overviewScrollContent（左右留白 16px）。
资料分组 UK、行 e8、每组揭示批量 aC=5（0.68.1 TS=5 的改名，值未变）。
通知开关仍在旧设置表单（SD 经 cD、字段 notifyOnUpdatesEnabled、动作 setAgentNotifyOnUpdates），
但新版 simplified 分支不提供进入该表单的按钮，属于入口隐藏而非功能删除。
描述编辑器在新版仅对特定团队共享类型 Bot 显示，个人 Bot 不满足条件。
「其他」标签无上游对应，是 Node 自有扩展页。

## 0.18 基线锚点（各出现恰一次，补丁 fail-closed 依赖）

index-UbX-y3il.js：sand-info-pane__inner、ul.sand-routine__list、sand-box-vnc-pool、
sand-agent-settings__card、function h3n。描述编辑器 aria-label 为英文原文 Agent description，
不随 locale 变化，可做稳定选择器。--sand-bg-secondary 在 0.18 样式表不存在，
选中态回退到已存在的 --sand-fill-secondary（正式版值 #1c1c 系同级语义 token）。

## 设计决策

划分只用 hidden，不搬移官方节点。搬移会与 library-entry 的签名守卫形成循环重建并重置
揭示进度，且移动直播中的 VNC 池节点可能中断预览流。hidden 不卸载节点，两者都不受影响。
缺资料的标签 fail-soft：保持当前页，不刷白屏。标签选择记 localStorage，存储不可用回默认页。
中文标签沿用资料库扩展先例直接书写，未进官方 i18n 目录（扩展无上游 key）。

## 文件

新增：frontend/src/extensions/info-pane-tabs-core.ts（定义与划分）、
frontend/src/extensions/info-pane-tabs-entry.ts（标签栏与同步）、
scripts/lib/info-pane-tabs-renderer-extension.mjs（esbuild 构建）、
tests/info-pane-tabs-extension.test.mjs（18 项）。
改动：scripts/lib/router-renderer-patch.mjs（注册扩展位、provenance 特性与变换名）。
未动：library-entry.ts、library-core.ts、agent-model 补丁、clean-build.mjs、docs/DESIGN.md。

## 验证

初版测试 9/9 通过；合并时补充 mutation/切 Bot/键盘场景后 18/18 通过。
修复点击标签未更新内存状态、同构节点替换被签名漏过、描述兄弟标题残留和窄栏滚动。
划分仍只设置 hidden；没有移动或重建资料库/VNC 节点。缺失目标保持当前页和焦点。
整合时另以 tests/info-pane-native-integration.test.mjs 执行真实 p3n/h3n 和 React compiler 缓存，
验证导航祖先、描述兄弟标题、模型/通知挂载、computed hidden 与节点身份。旧布局的 display:flex
会覆盖 hidden，已用仅针对扩展标记的 hidden 样式修复。

2026-10-15 最终包实机通过：详情不残留描述标题、编辑器、模型或通知；其他页保留这三类控件。
资料库页显示现有列表，电脑页显示原预览。约 299 CSS px 的窄面板中四标签均可见，
Right 三次依次进入资料库/电脑/其他，Home 回详情、End 到其他、Left 回电脑。
电脑标签在切 Bot、各自休眠与恢复过程中保持选中；宽度已恢复。
ASAR SHA-256：90f5e9a4c4d42782050a8c41a0842ca154640428ed63f9e83c5b93f7f2515215。
本次实机未切换通知设置，也未修改 Bot 描述或模型。截图及键盘回执位于工作区临时 QA 目录，不入库。
