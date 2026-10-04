# 页 2「管理插件和技能」与详情页的四处几何缺陷

**日期**：2026-10-04
**起因**：用户实机反馈「我随便打开看就不一样」。
**已部署产物**：`/Applications/Grok Node.app`，asar `694f12eeb43370cb`，
签名 DR `designated => identifier "com.anysphere.sand.reconstructed"`，`codesign --verify --deep --strict` 通过。
**官方对照**：Grok Bot 0.66.0（`/Applications/Grok Bot.app`，CDP 9224）。

---

## 结论

四个缺陷，全部是「类配方看起来对、算出来不对」或「元素放错了容器」。源码断言、typecheck、
打包、签名、测试在修复前**全绿**。

| # | 缺陷 | 官方 | 修复前（本地） | 修复后 |
|---|---|---|---|---|
| A | 私有技能行宽度 | 单列 734，`button` 698 | 两列 363，`button` 339 | 单列 734，`button` 698 ✅ |
| B | 分组 section 多一层包裹 | `SECTION > UL` | `SECTION > DIV(0fr) > UL` | `SECTION > UL` ✅ |
| C | 详情条位置 | 带内 798×48 @y161 | scroller 内 734×48 @y216 | 带内 ✅ |
| C′ | 页 2 搜索框 | 0 个 `<input>` | 1 个（`display:none`） | 0 个 ✅ |
| D | 页 2 标题排版 | h1 24px / h3 30px / 标题行 30px | 37px / 35px / 65px | 24 / 30 / 30 ✅ |

C 让**整个页 2 和整个详情页**低 55px、窄 64px —— 这是用户一眼看出的那个「不一样」。

---

## A — 私有技能网格：两条 `grid-template-columns` 同特异度，两列赢了

官方单列网格的类列表里**根本没有** `sand-nby9oq`。本地写的是 `[...GRID_CLASSES, "sand-1mkdm3x"]`
—— 两列类和单列类**叠加在同一个元素上**。

```
.sand-nby9oq:not(#):not(#):not(#)  { grid-template-columns: repeat(2, minmax(0,1fr)) }
.sand-1mkdm3x:not(#):not(#):not(#) { grid-template-columns: minmax(0,1fr) }
```

两条规则特异度**完全相同**（3 个 id + 1 个 class），胜负由样式表先后决定，而两列那条在后 → 永远两列。

**修**：`GRID_FULLWIDTH_CLASSES` 改为 `GRID_SINGLE_CLASSES` 的别名，两处调用点共用一份列表，
杜绝再次漂移。**没有加任何 lifted CSS** —— 两个类 0.18 原生就有。

已部署字节（`dist/renderer/assets/index-UbX-y3il.js`）：

```js
W =["sand-plugins__grid",…,"sand-nby9oq",…,"sand-1c1uobl"]        // 已安装：两列
Xn=["sand-plugins__grid",…,"sand-1c1uobl","sand-1mkdm3x"]         // 单列：不带 sand-nby9oq
nt = Xn                                                          // 别名，不是第二份字面量
```

全 chunk 内 `sand-nby9oq` 只剩 **1 次**（修复前在两个列表里各 1 次）。

> 教训：这个缺陷在源码里**完全看不出来** —— 两个数组都存在、都有名字、都 import 了。
> 只有把类挂到真实元素上、让 CSS 引擎算一遍，才会暴露。

## B — 分组 section 的 0fr 包裹层放错了一层

官方「已安装」分组有 4 个直接子节点：标题行、`UL`、折叠 holder、显示全部行。
其中 `min-height:0;overflow:hidden`（`sand-2lwn1j sand-b3r6kr`）**只出现在 holder 内部和「显示全部」行内部**。

本地在最外层又套了一层，于是「私有技能」变成 `SECTION > DIV(734×221) > UL`，而官方是 `SECTION > UL`。

**修**：`buildGroupSection` 改成可变参，网格/holder/显示全部作为 section 的兄弟节点直接挂载。

## C — 48px 带子是**共享插槽**，不是市场页专属

这是本轮最大的结构错误，也是用户直接看到的那个。

官方在**每一个**页面上渲染同一个带子元素，**类列表也完全相同**，只有唯一的子节点不同：

| 页面 | 带子类数 | 带子 > 行 | 行 > 槽 |
|---|---|---|---|
| 页 1 市场 | 17 | 10 | 9（空，置顶搜索的挂载点） |
| 详情页 | 17 | 10 | `sand-settings-detail-bar`[10] |
| 页 2 管理 | 17 | 10 | `sand-settings-detail-bar`[10] |

> **这里我先写错过一次，必须记下来。** 第一版读数说页 2 的带子是 5 类、行也是 5 类，
> 于是我造了 `MANAGE_BAND_CLASSES`(5) / `MANAGE_BAND_ROW_CLASSES`(5) 两个「页 2 变体」并接进了代码。
> 那个探针打印类列表时用了 `.slice(0, 6)` —— 17 类的带子被截成 5，看起来就像另一个变体。
> 重测时（`probe-band-full.mjs`，**先断言页面身份 `h1:管理插件和技能` 再读类名**）三页全是 17/10。
> 已在 `01f4ad4` 之后的提交里删掉那两个导出，`mountBar()` 统一用 `PIN_ROW_CLASSES`。
> **教训：`.slice(0, 6)` 这类截断会凭空造出一个「变体」，而源码断言会跟着一起点头。**

本地把详情条渲染在**滚动容器的 header 里**，于是带子空着、详情条又在下面重复渲染一次：

```
官方:  sand-plugins > strip[798×48 @y161] > row > sand-settings-detail-bar[798×48]
       └ scroller 从 y209 开始
本地:  sand-settings-pane > BACK_BAR[734×1820] > ... > sand-settings-detail-bar[734×48 @y216]
       strip 798×48 @y164 空着
```

**修**：`mountBar()` 把详情条放进带子（官方那份 10 类 `PIN_ROW_CLASSES`），`clearBand()` 每个分支先清空
带子并重置 `pinMounted`。页 2 与三个 pushed 页面都改。**没有 lifted CSS** —— 这些类 0.18 原生就有，
也不需要为「换列表」做任何事：官方本来就不换。

> 关键：详情页（插件详情）犯的是**同一个错**。上一轮修 hero 时只比对了 hero 区块自身的尺寸，
> 没有比绝对 y 坐标，所以漏掉了。

### C′ 顺带解决：页 2 的搜索框

原先页 2 是靠 `searchHolder.style.display = "none"` 隐藏搜索框的 —— 视觉上看不见，但 DOM 里**还留着
一个 `<input>`**，而官方页 2 是 **0 个 input**（连置顶那份也没有）。既然带子已经归位，置顶那份自然不再挂载；
剩下这一个改成 `unmountSearch()` 真正卸载，`syncPin` 改判 `shell.isConnected`。

不损失功能：`display:none` 的 input 本来就不可聚焦，页 2 的筛选从来就触发不了。

## D — 0.66 的 `ui-*` 排版族与缺失的类型配方

| 元素 | 官方类数 | 本地（修前） | 补上 |
|---|---|---|---|
| 组标题 `h3` | 22 | 6 | `ui-text` + 15 个 `ui-*` |
| 页 2 `h1` | 6 | 3 | `sand-19d36u7 sand-1o2sk6j sand-1deyeav`（17px / 24px / -.008em） |
| 「管理」`h3` | 23 | 20 | `sand-fc7y3v sand-1fc57z9 sand-12oo3zp` |
| 分组标题行 | 5 | 6 | **删掉**多出的 `sand-euugli` |

**16 个 `ui-*` 类 0.18 全部存在且声明逐字节相同** —— 不需要 lift，只需挂上。
其中 `ui-20ajya` = `font-weight:var(--cursor-font-weight-normal,400)` 是把组标题从粗体变回常规的关键；
`--cursor-font-weight-normal` 在 0.18 **未定义**，但官方声明自带 `,400` 兜底，因此正好解析成 400。

---

## 运行时证据

### 1. CSS 级联（headless，不需要 app）

`npm run marketplace:css` → `docs/evidence/marketplace-page2-css-cascade-deployed.json`

从**已部署 asar** 里读样式表，headless Chrome 真实解析，**13 条**断言全过：

```
PASS  私有技能 grid 是单列                       cols=1 gtc=734px
PASS  已安装 grid 是两列                        cols=2 gtc=363px 363px
PASS  两个网格在同一宽度下解析不同（特异度没有互相吞掉）   734px vs 363px 363px
PASS  私有技能 grid 占满 734                    w=734
PASS  组标题 12px / 16px 行高 / 常规字重          12px / 16px / 400
PASS  页 2 h1 17px / 24px 行高                   17px / 24px
PASS  分组标题行 30px（跟着 30px 的 h3 收）        30px
PASS  详情页标题在 798px 条里居中                w=38（Gmail）
PASS  返回按钮与官方类列表解析出同一个盒子          ours 28x28 vs official 28x28
PASS  返回按钮 inline padding 与官方一致          ours 0px/0px vs official 0px/0px
```

官方类列表作为**参照**写在这个脚本里（而不是 `official-styles.ts`）—— 放进被测模块的话，
改一下那个模块就能悄悄改掉目标本身。

第 3 条是关键：不是断言「单列是一列」，而是断言**两份列表在同一宽度下解析出不同结果** ——
如果有人又把两个类叠回去，这条会立刻变红。

### 2. 产物字节

- 已部署 chunk `index-UbX-y3il.js`（5,957,192 字节）经 `node --check` 解析通过；旧的 5 类页 2 变体 marker `sand-mkt-manage-band-row` 已确认从产物中消失
- 新 marker `sand-mkt-manage-band-row` 存在于产物中
- 两个网格字面量如上（`W` / `Xn` / `nt=Xn`）

### 3. 官方对照测量（CDP 9224，修复前采集）

```
官方 页2 私有技能: UL 734×724 gtc=734px        → LI 734×64 → BUTTON 698×40
官方 页2 已安装:   UL 734×196 gtc=363px 363px  → LI 363×64 → BUTTON 288×40
官方 页2 detail bar: 798×48 @y161，包裹链 sand-plugins > strip > row > bar
官方 详情页 bar:    798×48 @y161，strip[17] > row[10] > bar
```

### 4. 运行时 DOM（happy-dom，`npm test` 内）

`tests/marketplace-page2-runtime-dom.test.mjs` 挂载真实的 `createMarketplaceDialog`，6 条全过。
不覆盖像素（happy-dom 不做布局），只覆盖三处结构修复在真正改动的节点树上成立。

---

## 官方参照基线（供解锁后一次 diff）

`marketplace-official-reference-066.json` 是官方 0.66.0 三页的完整几何快照，2026-10-04 采于
CDP 9224，`identity` 字段为 `file:///Applications/Grok%20Bot.app/…`。关键值：

| | 页 1 市场 | 页 2 管理 | 详情页 |
|---|---|---|---|
| 带子 | 798×48 @y161（17 类） | 同 | 同 |
| 详情条 | 无 | 798×48 @y161，`inBand=true` | 798×48 @y161，`inBand=true` |
| scroller 起点 | — | y209 | — |
| 首个 section | y307 | y307 | — |
| 搜索框 | 693×20 @y261 | 1 个 | — |
| h1 | h2 734×24 | 718×24（6 类） | — |
| 返回页标题 | — | 28×20（23 类） | — |
| 已安装 grid | — | `363px 363px`，children=4 | — |
| 私有技能 grid | — | `734px`，rowW=698，children=2 | — |

解锁后本地跑同一条探针，两份 JSON 直接 diff 即可，不需要再摸索。

## 观察到但不改：详情页返回按钮的类列表与官方差 4 个（但不承重）

用户 18:57 的截图里，详情页顶部只有返回箭头、看不到居中的标题。复查结论：**当前代码是对的**，
那条截图来自更早的构建。为此做了一次完整的官方对照测量（CDP 9224，`probe-detail-title.mjs`）：

```
官方 插件详情 48px 条（798px 宽，中心 432）
  DIV  x=43  28x28  sand-1lqcxt8 sand-euugli
    BUTTON 28x28  [32 类]  ← icon-only，无文字节点
  H3   x=367 130x20 "Agent Compatibility"  [23 类]  ← 中心 367+65=432 = 条的中线
  DIV  x=821   0x0   sand-78zum5 sand-6s0dn4 sand-1qab1bc sand-euugli
```

本地实测产出：`H3` 文本 `Gmail`、23 类、w=38；返回按钮 28×28、无文字。
**与官方一致** —— 标题在，配方逐条相同（`DETAIL_TITLE_CENTERED_CLASSES` 本来就对）。

顺带查出一处类列表差异：

| | 官方 | 本地 |
|---|---|---|
| 缺 | `sand-yri2b`（padding-inline-end:0）、`sand-1c1uobl`（padding-inline-start:0）、`sand-1firant` | |
| 多 | | `sand-gdialr`（transition-duration:.12s） |

那 3 个类**在 0.18 根本不存在**（`grep` 全表 0 处），挂上去也是空操作。但真正的问题是：
那两个 padding 归零类如果承重，本地按钮会变宽。headless CSS 引擎量了**两份类列表各自解析出的盒子**：

```
PASS  返回按钮与官方类列表解析出同一个盒子    ours 28x28 vs official 28x28
PASS  返回按钮 inline padding 与官方一致       ours 0px/0px vs official 0px/0px
```

**结论：0.18 自己的 icon-button 配方已经做了 inline padding 归零（另一个 hash），所以这 3 个类
在这里不承重。** 记录不改 —— 既挂不上（0.18 没有），也确实不需要（量出来一致）。

> 判据：类列表的**名字**对不上不等于**结果**对不上。这一条只有把两份类列表都塞进真 CSS 引擎
> 各量一次才能分辨；只比名字会得出「缺 3 个类 = 有 bug」的错误结论。

## 观察到但不改：一处零视觉差异的嵌套差

官方「已安装」的第 4 个子节点是**三层**：

```
DIV [9] sand-rvj5dj sand-1erjwpq sand-1ympp8d …     734×25
  DIV [2] sand-2lwn1j sand-b3r6kr                    734×25
    BUTTON [15] sand-plugins__show-all              124×25
```

本地是**两层**（少最外层那个 9 类 div）：

```
DIV [2] sand-2lwn1j sand-b3r6kr                     734×25
  BUTTON [15] sand-plugins__show-all                124×25
```

**几何完全相同**（两层的盒子都是 734×25，按钮都是 124×25），所以界面上看不出差别。
按项目的既定标准「0.18 缺失且无物理等价可替换时才动」和「归因不了的残留不硬凑改法」，
这一处**记录不改**：改它没有可观测收益，却要再打一次包、再触发一次钥匙串授权。

这与此前记录的「账户名内层盒子 18 vs 15 的 3px」是同一类残留 —— 有据可查、如实记录、未修。

## 未完成

**实机（CDP 9232）几何复验未做**：验证时 Mac 处于锁屏状态
（`ioreg -n Root -d1 -a` 中 `CGSSessionScreenIsLocked = true`），钥匙串弹窗挡住启动，
AX 树退化、`screencapture -R` 直接报 `could not create image from rect`。
两轮打包各确认一次：**端口正常 LISTEN 但 `/json/list` 为空** —— 主进程先开好调试端口、
再卡在钥匙串，渲染进程根本没起来，所以「端口通」不等于「能取证」。

解锁并在钥匙串点一次「始终允许」后即可跑：

```sh
SP="/private/tmp/claude-501/-Users-wwzz-Downloads-proxyclawd/88833871-9d1c-410a-8425-a5a54e5377ef/scratchpad"
node "$SP/cdp.mjs" 9224 "$SP/probe-page2-snapshot.mjs" > /tmp/off.json   # 官方
node "$SP/cdp.mjs" 9232 "$SP/probe-page2-snapshot.mjs" > /tmp/loc.json   # 本地
diff /tmp/off.json /tmp/loc.json
```

源码、已部署产物字节、headless CSS 引擎、运行时 DOM 四侧证据都已齐备，
缺的是这一条实机确认，**不宣称已完成**。

---

## 守卫

两层，互相不可替代 —— 变异验证证实了这一点。

### 1. 源码断言 `tests/marketplace-page2-structure.test.mjs`（5 条）

钉住类配方与 DOM 形状的**源码**。文件头已写明它不是运行时证明。

### 2. 运行时 DOM `tests/marketplace-page2-runtime-dom.test.mjs`（6 条）

用 happy-dom 挂载**真实的** `createMarketplaceDialog` 并断言产出的节点树。这是本项目反复吃亏之后
补的一层：类配方全都在、名字全对，页面依然低 55px —— 源码断言对此完全无感。

happy-dom 不做布局，所以它对**像素**只字不提；像素归 headless CSS 脚本，部署产物的真实测量归 CDP 探针。
它负责的是三处**结构**修复在真正改动的那个节点树上成立：

1. 详情条在 48px 带子里、不在滚动容器里（页 2 与详情页都验）
2. 分组的网格是 section 的直接子节点，中间没有包裹层
3. 单列网格列表没有同时带上两列类

### 变异验证（9 个，全红）

```
RED ✔ 私有技能网格重新带上两列类 sand-nby9oq                    ← 运行时测试抓
RED ✔ GRID_FULLWIDTH 又变回 GRID_CLASSES 叠加                    ← 运行时测试抓
RED ✔ 分组 section 退回单 body，网格重新包一层 0fr wrapper
RED ✔ detail bar 退回塞进 scroller 的 header                     ← 运行时测试抓
RED ✔ 组标题去掉 16 个 ui-* 排版类
RED ✔ h1 去掉 sand-19d36u7 / sand-1o2sk6j / sand-1deyeav
RED ✔ section 标题行多塞回 sand-euugli
RED ✔ 页 2 搜索框退回 display:none（官方页 2 是 0 个 input）        ← 只有运行时测试能抓
RED ✔ 带子只 add 类不换类（页2 残留页1 的 17 类）
基线(未变异): GREEN ✔
```

> 最后两条是分层守卫的直接证据：把它们改回去，源码断言**一条都不红**，只有运行时测试抓得住。
> 写这三处修复时如果只有源码守卫，它们会带着全绿测试进部署。
