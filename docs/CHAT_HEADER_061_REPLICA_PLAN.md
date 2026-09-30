# 聊天区顶部身份条复刻方案（Grok Bot 0.61.0 → Grok Node）

日期：2026-09-29｜状态：**补丁已实现并通过全部门禁，尚未打包 / 部署**（`scripts/lib/chat-header-identity-renderer-patch.mjs` + `tests/chat-header-identity-renderer-patch.test.mjs`）
基线：本地 `main` == `github/main` == `f3c201e2ff0aaa6ee4142a6d7518e6552e8d0a45`（0 领先 0 落后，开工前已核验）
参照：官方 `/Applications/Grok Bot.app` = **Grok Bot 0.61.0**（`com.anysphere.sand`，asar SHA-256 `d8aef6f866542bdd75771477a2517991069f159a423431d367ee61bf52db8218`）
目标：本地 `/Applications/Grok Node.app` = 0.18.0-reconstructed（固定渲染器 `index-UbX-y3il.js` + 固定样式 `index-lCyB53CO.css`）

---

## 一、范围

只做一处：0.18 聊天区顶部那个身份控件，对齐 0.61.0 —— 居中、改成打开详情面板、换成 0.61 的胶囊外观。

不做：右侧详情面板本身（tab 条 / 身份区 / 媒体 tab / 例行任务 / 「添加标签」）、侧栏常驻「新建 Bot」磁贴、创建模板全部功能、Meetings、Files/Links 分区。

---

## 二、附图对照（用户提供的实机前后）

| | 附图1 = **Grok Node 0.18**（现状） | 附图2 = **Grok Bot 0.61.0**（目标） |
| --- | --- | --- |
| 聊天区顶部 | 一条空带 | 居中胶囊：圆形头像 + 「工作管家」 |
| 侧栏选中项 | 工作管家 | 工作管家 |
| 右侧面板标题 | 工作管家 的屏幕 | 工作管家 |
| 输入条占位符 | 发消息给 **工作管家** | 给 **工作管家** 发消息 |

四处独立位置同时写着「工作管家」→ 顶部那个控件显示的是**当前 agent 的身份**。

---

## 三、关键纠正：0.18 并不是「没有这个控件」

我最初读成「0.18 顶部是空带，需要注入一个新元素」。**这是错的。** 取两套 app 的实测 AX 树（窗口均 1728×1024）：

| | 0.18 Grok Node | 0.61 Grok Bot |
| --- | --- | --- |
| 节点 | `AXButton (查看智能体设置) @347,8 88×28` | `AXButton (查看对话详情) @804,10 110×40` |
| 行为 | 开 agent 设置 | 开详情面板 |
| 位置 | 左对齐 | 居中 |

0.18 **已经渲染** `sand-chat-header`，组件是 `aSn`（`index-UbX-y3il.js@4886695`），而且功能完整：

- `sand-chat-header__identity` —— 身份按钮
- `sand-chat-header__avatar` —— `ml({agent, fillPx:Tve, isStatic:!0, size:"xs"})` 头像（AX 不暴露装饰性 SVG，所以树里只看到静态文本）
- `sand-chat-header__title` / `__name` —— 名称，外加 `Sct` 在线点
- `sand-chat-header__computer` —— 电脑胶囊
- `sand-chat-header__crumb` —— 会话面包屑

所以真实差异是**三处字段级改动**，不是新增元素。这也解释了为什么附图1 看着「空」：控件在，但左对齐、88×28、无边框无底色无投影、且点开的是设置。

**顺带发现 0.18 上游自身的一处不一致**（`@4895183`）：

```js
A=p.jsxs("button",{"aria-controls":upe,"aria-expanded":o,      // o = isInfoOpen
                   "aria-label":"View agent settings",
                   className:Z,onClick:u,                      // u = onToggleSettings
                   style:X,type:"button",children:[xe,Ne]})
```

`aria-expanded` / `aria-controls` 已经绑在详情面板上，**点击却开设置**。0.61.0 把它统一到详情面板，本补丁跟随 0.61.0。改完三者自洽。

---

## 四、0.61.0 的实现证据

`M` = `index-DIQ9cJ4R.js`（1,852,818 B）；`E` = `index.eager-app-C8vlFwEg.js`；CSS = `index-C0oVmYFl.css`。偏移为字节偏移。

**居中机制**（M @1128900–1132400）：header 根类
`"sand-6s0dn4 sand-1qughib sand-167g77z sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-rvj5dj sand-37c5m6 sand-889kno sand-1a8lsjc"`，其中
`sand-rvj5dj` = `display:grid`、`sand-37c5m6` = `grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)`；
身份块带 `sand-1npkx4u` = `grid-column:2`。两侧 `1fr` 夹一个 `auto` 中列，才是居中的真正原因——不是 `justify-content`。

**胶囊外观**（0.61 身份类在 0.61 样式表里逐类解析）：`padding 7.5px 7.5px 13.5px 7.5px`、`border .5px solid var(--sand-border-weak)`、`border-radius:9999px`、`background-color:var(--sand-bg-elevated)`、`box-shadow:var(--sand-shadow-inline)`、`text-align:start`。0.18 同位置是 `radius:6px`、无边框、无底色、无投影。

**投影的真实来源**：`--sand-shadow-inline` **在 0.61 也不是 CSS token**，它是 JS 拼接常量（E @999540）：

```js
Co.inline = "0 4px 12px -1px var(--sand-shadow-inline-ambient), 0 2px 4px -2px var(--sand-shadow-inline-key), 0 0 0 1px var(--sand-shadow-ring)"
```

三个分量 token 在 0.18 固定 CSS 中**全部存在且取值逐字节相同**（`#00000014` / `#0000000f` / `#e4e4e40a`）→ 原串复制，零近似。

**文案**：`+fxiY8` = "View conversation details"，官方 zh-CN 目录给出「查看对话详情」。

**未移植**：0.61 的 `sand-chat-header__controls`（发布/分享菜单）与 `bo()` 驱动的副标题。前者属创建模板范围；后者跨 chunk 导入、定义读不到，按 evidence-only 记为 uncertainty，不发明。

---

## 五、0.18 侧的注入点（全部实测唯一）

四个锚点都在 `index-UbX-y3il.js`，逐个核过出现次数均为 1：

| 锚点 | 字节 | 作用 |
| --- | --- | --- |
| `function aSn(n){const e=he.c(109),` | 4886695 | 插入常量块 |
| `q={className:"sand-78zum5 … sand-euugli"};` | 4887352 | 根类加 `sand-rvj5dj` + 三列 grid 模板 |
| `"aria-label":"View agent settings",className:Z,onClick:u,style:X,type:"button"` | 4895183 | 标签 / 处理器 / 胶囊外观 |
| `j=p.jsxs("div",{className:ee,style:Y.style,children:[te,ne]})` | 4890339 | 控制区固定到第 3 列 |

注入块：

```js
function RChLoc(en,zh){return typeof RLocT==="function"?RLocT(en,zh):en}
const RChHeaderGrid={gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)"};
const RChControls={gridColumn:"3"};
const RChIdentity={gridColumn:"2",paddingTop:"7.5px",paddingInlineEnd:"13.5px",paddingBottom:"7.5px",
  paddingInlineStart:"7.5px",borderWidth:".5px",borderStyle:"solid",borderColor:"var(--sand-border-weak)",
  borderRadius:"9999px",backgroundColor:"var(--sand-bg-elevated)",
  boxShadow:"0 4px 12px -1px var(--sand-shadow-inline-ambient), 0 2px 4px -2px var(--sand-shadow-inline-key), 0 0 0 1px var(--sand-shadow-ring)",
  textAlign:"start"}
```

借用的 0.18 类（全部已存在）：`sand-rvj5dj`(display:grid) · `sand-1npkx4u`(grid-column:2) · `sand-3nfvp2` · `sand-6s0dn4` · `sand-1ypdohk` · `sand-1c4vz4f` · `sand-s83m0k` · `sand-dl72j9` · `sand-euugli` · `sand-lvsv26`。
`sand-37c5m6`（三列模板）0.18 没有 → 内联。

---

## 六、踩到的坑（已修，写进注释防复发）

**`COMPONENT_SOURCE` 以 `const` 结尾时必须留尾换行。** 注入块被直接拼到以 `function` 开头的锚点前，若拼出 `const X={…}function aSn(…){…}` 同一行，就是 `SyntaxError: Unexpected token 'function'` —— ASI 只在行终止符处触发，实测确认 `const A={x:1}function f(){}` 报错、而两个相邻函数声明合法。`routine-surfaces-renderer-patch.mjs` 的注入块同样以 `\n` 结尾；`sidebar-search-renderer-patch.mjs` 以函数声明结尾所以侥幸没事。本补丁已按前者处理，并在源码里写明原因。

**这类错误 `typecheck` 与全量 `npm test` 都测不出来**，只有把产物喂 `node --check` 才现形 —— 与 AGENTS.md 记录的 i18n JSX 引号事故同一类。因此新测试里专门有一条把补丁后的 chunk 交给真实解析器。

---

## 七、门禁与验证状态

补丁内置门禁（全部 fail-closed，共 16 个锚点）：

- 10 个锚点 `replaceExactlyOnce`：缺失或出现多次即构建失败（`e[7]!==u` 在 chunk 里有 11 处、`e[92]!==u` 只有 1 处，故前者用加长到整条依赖链的形式）
- **类名 + 自定义属性双重断言**：`assertChatHeaderIdentityStylesResolve` 在打包时逐个核对 10 个类与 5 个 CSS 变量（`--sand-border-weak` / `--sand-bg-elevated` / `--sand-shadow-inline-ambient` / `--sand-shadow-inline-key` / `--sand-shadow-ring`）在固定样式表里真的存在。样式表变动会炸构建，而不是发一个没样式的控件出去
- **overview 落点三跳穿线逐跳断言**：任一跳断了仍然能构建成功、看起来也正常，但会悄悄落到 settings 分区 —— 所以 app 根 prop、header 接线、`aSn` 解构、`openOverview("overview")` 每一跳都单独断言
- **注入 handler 真实行为断言**：从产物 chunk 里把 `RChOpenInfo` 抠出来用 `new Function` 跑 —— 覆盖「关→开且请求 overview」「开→只收起不重复请求」「回调缺失不抛」「回调抛错不影响已发生的 toggle」
- **memo 槽位断言**：断言 `aSn` 体内不再有 `e[7]!==u` / `e[92]!==u`（否则会留下永久陈旧闭包）。断言限定在 `aSn` 函数范围内，因为 chunk 里有十几个组件都有 `e[7]!==u`
- 暂存目录必须只有 1 个命中 chunk，出现第 2 个即失败
- provenance 落 `dist/renderer-chat-header-identity-extension.json`，含 original/patched 双 sha256

已跑通：

| 项 | 结果 |
| --- | --- |
| 新增 `tests/chat-header-identity-renderer-patch.test.mjs` | **18/18** |
| `npm test` | **427/427**（0 失败） |
| `source:typecheck` | ✅ |
| `typecheck` | ✅ |
| 干跑：补丁应用 + `node --check` | ✅ 语法有效（+954 字节） |
| 重复应用 | ✅ fail-closed |

**已部署并真机验收**（见第九、十、十一节）。新增测试 18/18 · `npm test` 427/427。

---

## 八、Overview 落点：为什么必须多穿一根线

### 0.18 旧按钮的真实行为

`toggleAgentSettings`（@5464958）不是「开设置界面」，而是**开同一个右栏、切到 settings 分区**：

```js
q=()=>{ if(o||l==null)return;
  const V=b.current, W=V?.agentId===l?V.view:"overview";
  if(hin({isOpen:y,view:W})==="close"){B();return}   // hin = Bfe：已在 settings 就收起
  P("settings") }                                     // P = openSection
```

而 `toggleInfoPane` = 控制器的 `R` = `o||(c?B():A())` —— 纯开关，**不碰分区**。

### 分区会「粘住」

右栏在 app 根里**无条件常挂**（`p.jsx(JDn,{…pane:hr,…})`），分区是组件内 `useState("overview")`，关闭再打开不重置。而旧按钮每次都强制 settings —— 所以**只要点过一次，之后每次从顶部按钮打开右栏都会停在 settings**，不是用户截图那一页。

0.61 没这问题：它的按钮从来不设 settings 分区（那正是 0.18 的 bug）。所以这是 0.18 特有的迁移副作用，且命中率不低。

### 补救：三跳穿线（已实施）

app 根的 props 对象（字面量起点 @5557303）里同时有 `currentAgentId` / `isInfoPaneOpen` / `infoPane:hr` / `toggleInfoPane:Qt` —— 已核验确实是 header 调用点读的那一份，所以能直接加一根线：

```
① app 根 props      + openInfoOverview:hr.openSection
② header 调用点     + onOpenInfoOverview:n.openInfoOverview
③ aSn 签名          + onOpenInfoOverview:RChOpenOv
④ 身份按钮          onClick:()=>RChOpenInfo(c,o,RChOpenOv)
```

```js
function RChOpenInfo(toggle,isOpen,openOverview){
  if(typeof toggle!=="function")return;
  toggle();
  if(isOpen||typeof openOverview!=="function")return;
  try{openOverview("overview")}catch(_e){}
}
```

语义：**开着就只收起；关着就打开并同时点名 overview 分区。** 回调缺失或抛错都不会让点击变成报错（测试覆盖）。

### memo 槽位的坑

`aSn` 的 memo 分配是 `he.c(109)`，**槽位已满、没有新下标可用**。而按钮的 memo 依赖 `e[92]!==u` 里 `u`（`onToggleSettings`）在改完后已无人读取，于是**复用该槽位**改为跟踪新 prop：

- 外层 `e[7]!==u` / `e[7]=u` → `RChOpenOv`
- 内层 `e[92]!==u` / `e[92]=u` → `RChOpenOv`

不改这里会留下**永久陈旧的闭包**：切 agent 时 `hr.openSection` 换了新引用，但 memo 不会重算。

（`e[7]!==u` 在整个 chunk 里有 11 处、`,e[7]=u,` 有 14 处，所以这两个锚点用了加长到整条依赖链的形式才唯一。）

---

1. 顶部胶囊**水平居中**于聊天列（AX 里 x 应接近 (聊天列左右边界之和)/2）
2. 尺寸应从 88×28 变为接近 110×40
3. 点击后右侧出现「会话详情」面板（`sand-info-pane` 的 `data-open` 为真），再点可收起
4. 切换 agent 后头像与名称跟着变
5. 中文界面 tooltip / `aria-label` 显示「查看对话详情」
6. 侧栏折叠（≤130px）与全屏态下不溢出、不遮挡输入条
7. 打包后对 `dist/renderer/assets/*.js` 逐个 `node --check`，并断言 `"(RLocT("` 计数为 0
8. **overview 落点回归**：先手动进一次右栏 **settings** 分区 → 关掉 → 再点顶部「工作管家」→ 必须回到 **overview**（屏幕 + 例行任务），不能停在 settings。这是本次穿线专门解决的问题，必须单独验一次

---

## 九、真机验收（2026-09-29 已部署实测）

已装 asar SHA-256 `f8ac3563ce9d88bedd37f9ed9359099d239720ca8529b0293a5061aa52626b61`；
旧版备份 `~/Documents/grokbot/backups/Grok Node-before-chat-header-0.61-20260929-172321.app`（asar 校验一致）。

| 项 | 0.18 原版 | **实测（现在）** | 0.61 目标 | 判读 |
| --- | --- | --- | --- | --- |
| 节点 | `AXButton (查看智能体设置) @347,8 88×28` | `AXButton (查看对话详情) @935,4 98×36` | `AXButton (查看对话详情) @804,10 110×40` | ✅ |
| 横向位置 | 左对齐 | 按钮中心 984，聊天列中心 985.5，**误差 1.5px** | 居中 | ✅ |
| 点击行为 | 开右栏 **settings 分区** | 开右栏 **overview** | 开右栏 | ✅ |
| 中文文案 | — | 「查看对话详情」 | 同 | ✅ |
| 胶囊外观 | 无边框/无底色/无投影 | 圆角 + 底色 + 边框 + `Co.inline` 三层投影 | 同 | ✅ |

**overview 落点回归**（本次穿线专门解决的问题），CDP 真实鼠标事件逐步验证：

```
0 初始           open=true  | 打开 工作管家 的屏幕 例行任务 每日09:00日报 …
→ 点「智能体设置」
1 进 settings 后  open=true  | 设置 名称 Title 描述 通知 …
→ 点「关闭详情」
2 收起后         open=null
→ 再点「查看对话详情」
3 重开           open=true  | 打开 工作管家 的屏幕 例行任务 每日09:00日报 …   ← 回 overview，不是 settings
（全程无运行时错误）
```

### 尺寸仍差 12px×4px：98×36 vs 110×40

来自内容宽度不同——0.18 用 `ml({size:"xs"})` 自适应，0.61 用固定 `fillPx`（见第十节第 2/3 条）。形态与观感已与 0.61 同族；要像素级对齐需按实测微调 `RChIdentity` 内边距。

> 附：kimi-cu 的 AXPress / `press_key` 只让按钮获得焦点、**不会触发 React 的 click**。验收必须用 CDP `Input.dispatchMouseEvent` 发真实鼠标事件，否则会误判成「点击无效」。

---

## 十、顶栏透明 + 去掉电脑按钮（第二轮，已部署实测）

用户实机对照 0.61 后报了两点。已装 asar `571cb7315372c2fe5cf8dcf66abbd5d111b7fe8fddcaef7531fff739605bcc12`。

### 1. 顶栏不透明，遮住后面的转录文字

**不是胶囊画的底色，是外层顶栏。** 逐类解析两版 `sand-toolbar` 的类集：

| | 解析出的 background 声明 |
| --- | --- |
| 0.18 | `sand-1ua6jya` → **`background-color:var(--cursor-bg-editor)`** |
| 0.61 | **无任何 background 声明** |

0.61 的胶囊**同样**有 `background-color:var(--sand-bg-elevated)`，和我注入的 `RChIdentity` 一样；差别只在它背后的那条带子。0.61 顶栏透明，所以转录文字从胶囊两侧透出来。

**修法**：`qLn`（@5362352 附近）`sand-toolbar` 的两个变体都含 `sand-1ua6jya`，从两处各去掉一个类（该类在这两个变体里只承担背景，删掉不影响定位/尺寸/drag-region 规则）。锚点靠上下文收窄——`sand-1ua6jya` 全 chunk 出现 33 次。

产物侧校验：`33 → 31`（两个变体各减一），变体 0/1 都不再含该类。

### 2. 顶栏多出的电脑图标

**0.61 的 chat header 根本不渲染电脑按钮。** `kC="sand-chat-header__computer"` 在 0.61 只剩两处**非渲染**用途：

- `Y("sand-chat-header__identity", kC, B.className)` —— 当作 container-name 传给身份块
- `p1e`（`.` + kC）—— 关闭右栏时把焦点还给电脑按钮的兜底选择器

0.18 会真的渲染，条件是 `!o||m`（`o`=右栏开着、`m`=电脑正忙），所以**右栏一关它就冒出来**。

**修法**：把该条件改成恒假（`!o||m?` → `!1?`），分支永不可达。**类名本身保留**——0.18 用它做焦点兜底，删掉会静默破坏右栏关闭时的焦点归还（测试对此有断言）。右侧「电脑」tab 走的是另一条路径，不受影响。

### 实测（CDP 真实鼠标事件）

```
① 顶栏背景         background-color: rgba(0, 0, 0, 0)        ← 透明 ✅
② chat header 按钮  [{"label":"查看对话详情","box":"98x36"}]   ← 只剩 1 个 ✅
   电脑类元素数      0                                          ✅
③ 胶囊居中        按钮中心=751  聊天列中心=753  误差 2.0px      ✅
④ 顶栏命中测试     顶栏左侧 15% 处命中 DIV.sand-chat-header    ← 元素在顶层，无实色遮挡 ✅
⑤ 点击开右栏       open=true | 打开 工作管家 的屏幕 例行任务 …
   右栏电脑预览     ✅ sand-computer-preview 仍在
   右栏例行任务     ✅ 在
（全程无运行时错误）
```

> 验收脚本踩的坑：连点两次「查看对话详情」会 开→关，第二次读到 `open=null` 看起来像「点了没反应」。逐项验收要一次只点一下并重读状态。

## 十一、第三轮：顶栏分隔线 + 图标尺寸（已部署实测）

已装 asar `79de45ddc45dd20ca3eb91a5bc82f5af538b641dcbcc6139c2f58d1d2799e478`。

### 1. 顶栏那条横线

上一轮把顶栏改成透明后，底下浮出一条 1px 亮线。定位到的元素：

| | 0.18 | 0.61.0 |
| --- | --- | --- |
| `sand-toolbar-divider` | **有** | **完全没有这个元素** |
| 声明 | `bottom:-.5px; height:.5px; background:var(--sand-border-weak)` | — |
| 驱动方式 | `opacity:0` + `animation-timeline:--sand-transcript-scroll`、`animation-range:0 16px` | — |

它是**动态元素**：不透明度由滚动时间线驱动，随转录滚动淡入。所以不能靠删类（动画照样会画），必须让渲染条件不可达。

**这里踩了自己一个逻辑错误，值得记**：`cond ? A : B` 里我把条件写成 `!1`（= `false`），结果**取的是 else 分支**——也就是照旧渲染。字符串断言 `includes("…?null:…")` 完全通过、构建绿、测试绿，装机后线还在。正确写法是 `!0`（= `true`）才取 `null` 分支。

对照：电脑按钮那处 `!1?p.jsx(…)` 是对的，因为 `jsx` 在 **true** 分支。两处极性相反，混用必然出错。

**已加一条真实求值的测试**：把补丁产物里的三元表达式抠出来、用 `new Function` 配合一个会抛错的 `MARKER` 工厂求值，断言结果是 `null` 且从未取到元素分支。只做字符串匹配抓不住这类错误。

### 2. 居中胶囊的图标偏小

| | 0.18 | 0.61.0 |
| --- | --- | --- |
| 渲染 | `ml({agent,fillPx:Tve,size:"xs"})` | `Sa({agent,fillPx:t2,size:"sm"})` |
| fill | `Tve = 20` | `t2 = 24` |

`fillPx` 在 `ml` 里优先于 `size`（`const E=r??Jj[l]`），所以真正决定字形大小的是 fill。0.18 自己的档位表是 `Jj={xs:16,sm:22,md:28,lg:36,xl:72}`——注意它的 `sm` 是 22 而非 24。

**修法**：身份块那一处改成 `fillPx:24, size:"sm"`。`fillPx:Tve` 在 chunk 里有 3 处、`p.jsx(ml,{agent:t,fillPx:Tve,…})` 有 2 处（另一处是面包屑 crumb），所以锚点用 `e[72]!==t?(Q=p.jsx(ml,…` 这个 memo 槽形式收窄到唯一——**面包屑必须保持 0.18 自己的尺寸**，测试对此有断言。

### 3. 实测

```
① 分隔线        .sand-toolbar-divider 元素数: 0
                header 子节点: DIV.sand-chat-header            ← 只剩一个
② 图标尺寸      胶囊 98x36 → 102x40
                头像容器 20 → 24x24（= 0.61 的 t2=24）
③ 回归          顶栏背景 rgba(0,0,0,0) 透明
                header 按钮: 查看对话详情（仍只有 1 个）
                居中误差 2.0px
（无运行时错误）
```

> 部署后若改动没生效，先清 `~/Library/Application Support/Grok Node/{Cache,Code Cache,GPUCache}` 再重启。排查这一轮时曾在「已装 asar 确认为新代码、但运行时行为是旧的」上绕了一圈，最后靠 React fiber 溯源（`div ← header ← qLn`）才定位到真正原因是那个 `!1`/`!0` 的极性写反，而不是缓存或部署问题。

## 十二、两个只有真机能发现的 bug（都已修 + 已加门禁）

两个都是**编译期完全看不出来**的：`typecheck` 绿、`npm test` 绿、101 个 chunk 全部 `node --check` 过、构建成功。第一个甚至通过了全部产物闸门，装机后才炸。

### 1. 原生元素 `style` 传数组 → 整个聊天视图炸掉

第一版写 `style:[X,RChIdentity]`。`X` 是 `D.style`，而 `D` 只有 `className`，所以 `X` 恒为 `undefined` —— 但**数组还是传给了原生 `<button>` 的 `style`**。React 用 `for…in` 遍历数组去设 `style["0"]` / `style["1"]`：

```
TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration'
    at yi / ki / di / Qo / xgt
```

被视图错误边界接住，界面表现就是 AGENTS.md 记过的 **`This view failed to load.` + 重试按钮**，聊天区整块消失。

定位手段：`open -a … --args --remote-debugging-port=9224` + CDP `Runtime.enable`/`Log.enable` 抓 `Runtime.exceptionThrown`。产物侧 101 chunk 语法全过、35 个动态 import 目标全部存在，所以只可能是**模块求值期的运行时异常**。

已修（`style:RChIdentity`），加三道门禁：构建期拒绝 `IDENTITY_AFTER`/`ROOT_AFTER`/`CONTROLS_AFTER` 出现 `style:[`；测试断言身份按钮 style 是对象且无数组；注释写明 `sidebar-search-renderer-patch.mjs` 的 `style:[a,b]` 为何合法（那是 `fr` 自定义组件的 prop，stylex 内部合并，不落 DOM）。

### 2. `gridColumn` 加在内层按钮上，wrapper 才是 grid 子项 → 不居中

第一版给身份按钮加 `gridColumn:"2"`，胶囊仍左对齐（@251，聊天列中心 749）。原因：身份按钮外面**还包了一层 `__identity-row` 的 div**（`B=p.jsxs("div",{className:N,style:E,children:[A,I]})`），真正参与 grid 排布的是这个 wrapper，它被自动放进第 1 列。

已修：新增 `RChIdentityRow={gridColumn:"2"}` 挂到 wrapper，按钮上的 `gridColumn` 移除。测试同时断言 wrapper 落点存在、且 `RChIdentity` 不以 `gridColumn` 开头——两条缺一都判红。

（顺带排除了一个疑似项：0.18 固定 CSS 里 `sand-rvj5dj`(`display:grid`) @422386 确实排在 `sand-78zum5`(`display:flex`) @422333 之后，grid 本来就能赢，不是类名顺序问题。）

---

## 十三、仍为 uncertainty（不猜）

1. ~~**`bo(agent, k)` → `{name, subtitle}` 定位不到**。0.61 的 pill 在有 agent 时是否显示第二行副标题、那行文字是什么，我没有读到。0.18 侧对应物是 `vhe.statusText` 配方（同样读不到取值来源）。→ 本次只做单行。~~
   **（2026-09-29 晚更正：这条把两件事搞混了，会误导接手的人。）** 复查后确认：
   - `vhe.statusText` 根本不用于状态行——它只喂 `sand-chat-header__shared-text`，也就是共享会话时那行 `Shared · {hostName}`。胶囊里确实只有名称，**这一半原文是对的**。
   - 但用户看到的「工作管家 is working」**不在胶囊里**。它属于转录底部的 activity mark（`SJn` 的 `sand-activity-mark` 分支），文本由 `gJn` 生成。那行过去**只有鼠标悬停才显示**，已按 0.62.0 修掉常显——见 `AGENTS.md` 第 8 条与 `scripts/lib/activity-label-visibility-renderer-patch.mjs`。
   - **教训**：附图里的元素先用 `grep` 产物定位归属组件，别顺着本文档的「未移植」清单往下推——那份清单说的是胶囊，副标题在另一个组件里。

2. **高度 40px 是推算的**：0.61 胶囊 = 7.5+7.5 纵向内边距 + 其自身内容高；0.18 的内容（`size:"xs"` 头像）是否与 0.61 的 `t2` 填充尺寸一致我没量。若装机后高度不是 40px，按实测微调内边距。（2026-09-29 第三轮已按 `fillPx:24, size:"sm"` 实测校准，胶囊 98×36 → 102×40。）
3. **头像尺寸**同理：0.18 用 `ml({size:"xs"})`，0.61 用固定 `fillPx`，两者视觉直径可能不同。

---

## 附：本轮改动清单

- 新增 `scripts/lib/chat-header-identity-renderer-patch.mjs`
- 新增 `tests/chat-header-identity-renderer-patch.test.mjs`
- 改 `scripts/clean-build.mjs`：import + 在 `applyOriginalRendererSidebarTopBarSearch` 之后、四个 i18n pass 之前调用（有测试守住这个顺序）
- 新增 `docs/CHAT_HEADER_061_REPLICA_PLAN.md`（本文档）

**i18n 处理**：标签写成原始字面量 `"aria-label":"View conversation details"`，交给 main-i18n 处理——仓库里**已经有**这条 0.61 的行（`MAIN_I18N_PAIRS`，message id `+fxiY8`，mode FULL），引擎会把它和既有的面包屑 crumb 一起本地化成「查看对话详情」。

同时**删掉了** `MAIN_I18N_LOCAL_PAIRS` 里的 `["View agent settings", …]` 行：本补丁移除了它唯一的锚点，而 `applyPair` 对零锚点是 fail-closed——**第一次打包就是被这条拦下来的**（`i18n pair has no anchor outside string spans: View agent settings`）。这是门禁在正常工作。

**不要**给注入标签加 `MAIN_I18N_061_PAIRS` 行：那条表是本地化 0.18 自身字面量的，注入串走引擎即可，重复登记只会双重包裹。

---

## 十四、参照版本已从 0.61.0 变成 0.62.0（2026-09-29 实测）

本文档前十三节全部以 **0.61.0** 为参照，当时 chunk 是 `index-DIQ9cJ4R.js`（1,852,818 B）。

**本机 `/Applications/Grok Bot.app` 现在是 0.62.0**（`CFBundleShortVersionString` 实读），
主 chunk 变成 **`index-BYEktDeR.js`**（1,901,097 B），样式表 `index-Cp99LmKM.css`。
**按老 chunk 名去 asar 里取会取不到**（我第一次就踩了，`find` 返回 undefined）。

0.62 的 chat header 仍是 `sand-chat-header__identity` / `__avatar` / `__title` / `__name` / `__computer` / `__controls`，
**没有** `__status` 之类的状态类——与第十三节更正后的结论一致：状态文字不在胶囊里。

**asar 读取姿势更正**：`AGENTS.md` 里「数据区起点 = `8 + readUInt32LE(12)`」那条捷径在新版上解析失败。
正确的头部布局是四个 uint32：`@0=4`、`@4=headerSize`、`@8=` 字符串 pickle 大小、`@12=` JSON 字节数。
所以 **数据区起点 = `8 + readUInt32LE(4)`，JSON 从 offset 16 读 `readUInt32LE(12)` 字节**，
再 `JSON.parse` 后按 `files` 树逐级走。
