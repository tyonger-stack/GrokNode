# 页 2「管理插件和技能」与详情页的四处几何缺陷

**日期**：2026-10-04
**起因**：用户实机反馈「我随便打开看就不一样」。
**已部署产物**：`/Applications/Grok Node.app`，asar `c20a7cf6741959b3`（68,603,324 字节），
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

官方在两个页面上渲染**同一个**带子元素，只有类列表和唯一的子节点不同：

| 页面 | 带子类数 | 带子 > 行 | 行 > 槽 |
|---|---|---|---|
| 页 1 市场 | 17 | 10 | 9（空，置顶搜索的挂载点） |
| 详情页 | 17 | 10 | `sand-settings-detail-bar` |
| 页 2 管理 | 5 | 5 | `sand-settings-detail-bar` |

本地把详情条渲染在**滚动容器的 header 里**，于是带子空着、详情条又在下面重复渲染一次：

```
官方:  sand-plugins > strip[798×48 @y161] > row > sand-settings-detail-bar[798×48]
       └ scroller 从 y209 开始
本地:  sand-settings-pane > BACK_BAR[734×1820] > ... > sand-settings-detail-bar[734×48 @y216]
       strip 798×48 @y164 空着
```

**修**：新增 `MANAGE_BAND_CLASSES`（5 类）/ `MANAGE_BAND_ROW_CLASSES`（5 类），`setBandPage()` 用
`setClasses()` **整体替换**带子的类列表（`applyClasses` 只能 add，浏览→管理切换会残留 17 类），
`mountBar()` 把详情条放进带子。页 2 与三个 pushed 页面都改。**没有 lifted CSS** —— 这些类 0.18 原生就有。

> 关键：详情页（插件详情）犯的是**同一个错**。上一轮修 hero 时只比对了 hero 区块自身的尺寸，
> 没有比绝对 y 坐标，所以漏掉了。

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

从**已部署 asar** 里读样式表，headless Chrome 真实解析，10 条页 2 断言全过：

```
PASS  私有技能 grid 是单列                       cols=1 gtc=734px
PASS  已安装 grid 是两列                        cols=2 gtc=363px 363px
PASS  两个网格在同一宽度下解析不同（特异度没有互相吞掉）   734px vs 363px 363px
PASS  私有技能 grid 占满 734                    w=734
PASS  组标题 12px / 16px 行高 / 常规字重          12px / 16px / 400
PASS  页 2 h1 17px / 24px 行高                   17px / 24px
PASS  分组标题行 30px（跟着 30px 的 h3 收）        30px
```

第 3 条是关键：不是断言「单列是一列」，而是断言**两份列表在同一宽度下解析出不同结果** ——
如果有人又把两个类叠回去，这条会立刻变红。

### 2. 产物字节

- 已部署 chunk `index-UbX-y3il.js`（5,957,426 字节）经 `node --check` 解析通过
- 新 marker `sand-mkt-manage-band-row` 存在于产物中
- 两个网格字面量如上（`W` / `Xn` / `nt=Xn`）

### 3. 官方对照测量（CDP 9224，修复前采集）

```
官方 页2 私有技能: UL 734×724 gtc=734px        → LI 734×64 → BUTTON 698×40
官方 页2 已安装:   UL 734×196 gtc=363px 363px  → LI 363×64 → BUTTON 288×40
官方 页2 detail bar: 798×48 @y161，包裹链 sand-plugins > strip > row > bar
官方 详情页 bar:    798×48 @y161，strip[17] > row[10] > bar
```

---

## 未完成

**实机（CDP 9232）几何复验未做**：验证时 Mac 处于锁屏状态
（`ioreg -n Root -d1 -a` 中 `CGSSessionScreenIsLocked = true`），钥匙串弹窗挡住启动，
AX 树退化、`screencapture -R` 直接报 `could not create image from rect`。
解锁并点一次「始终允许」后即可跑
`node $SP/cdp.mjs 9232 probe-page2-snapshot.mjs`（探针已写好，官方/local 各跑一次即可 diff）。

源码与已部署产物两侧的证据都已齐备，缺的是这一条运行时确认，**不宣称已完成**。

---

## 守卫

`tests/marketplace-page2-structure.test.mjs`（5 条），8 个变异全部变红：

```
RED ✔ 私有技能网格重新带上两列类 sand-nby9oq
RED ✔ GRID_FULLWIDTH 又变回 GRID_CLASSES 叠加
RED ✔ 分组 section 退回单 body，网格重新包一层 0fr wrapper
RED ✔ detail bar 退回塞进 scroller 的 header
RED ✔ 组标题去掉 16 个 ui-* 排版类
RED ✔ h1 去掉 sand-19d36u7 / sand-1o2sk6j / sand-1deyeav
RED ✔ section 标题行多塞回 sand-euugli
RED ✔ 带子只 add 类不换类（页2 残留页1 的 17 类）
基线(未变异): GREEN ✔
```

守卫是**源码断言**，文件头已写明它不是运行时证明；运行时由上面的 CSS 级联脚本 + 部署产物探针负责。
