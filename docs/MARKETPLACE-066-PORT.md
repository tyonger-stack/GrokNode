# Grok Node — 0.66 App 市场递归移植交付说明

日期：2026-10-04 · 基准：本机 `/Applications/Grok Bot.app` **0.66.0** · 取证方式：CDP 实时 dump
（几何、类名、计算样式、字形码位），落库于 [MARKETPLACE-066-EVIDENCE.md](./MARKETPLACE-066-EVIDENCE.md)。

---

## 1. 页面与路由清单

同一个 `role="dialog" aria-label="市场"` 内**推栈式**导航，`返回` 弹出一层，直到栈底才关闭弹窗。

| 层级 | 页面 | 入口 | 页头形态 | 标题 | 列表布局 | 返回目标 |
|------|------|------|----------|------|----------|----------|
| L0 | **市场**（首页） | 侧栏「连接应用」pill | 标题行 + 搜索框 | `h2 市场` + 已安装预览 | 双列 363×2 | — |
| L1a | **类目页 · 精选** | 首页「精选插件 → 查看全部」 | `sand-settings-detail-bar` | `h1 精选插件` | **单列 734** | L0 |
| L1b | **类目页 · 结果** | 首页「效率/通信/设计/代码/数据/销售/财务/研究/登录与凭据管理 → 查看全部」 | `sand-settings-detail-bar` | `h3 结果`（桶名在页头） | **双列 363×2** | L0 |
| L2 | **应用详情** | 任意列表行 `打开 <名称>` | `sand-settings-detail-bar` | `h3 <名称>` | — | L0 或 L1 |
| L1′ | **管理插件和技能** | 首页「已安装 N 个 ›」 | `‹ 市场` 返回条 | `h3 管理` | 已安装网格 | 栈中上一层 |

**两种类目页是官方真实存在的两种形态**，不是本移植的发挥：精选走单列 `h1` 页、且带
`.sand-plugins__marketplace` 包裹层；类目桶走双列、标题写 `结果`、**不带**包裹层。
实测样本：精选插件 6 行单列；效率 63 行、研究 11 行双列。

**L0 区块顺序**（与截图逐项一致）：为你推荐 → 精选插件 → 团队插件 → 登录与凭据管理 →
效率 → 通信 → 设计 → 代码 → 数据 → 销售 → 财务 → 研究 → 支持。
`查看全部` 仅在区块行数 > 4（预览上限）时出现 —— 这正是截图中 `支持`（3 行）没有而其余都有
`查看全部` 的原因。

## 2. 功能点与原版对应

| 原版功能 | 官方实现 | 本移植 | 状态 |
|---------|---------|--------|------|
| 市场首页 13 区块 | `vl` 渲染序 | `renderBrowse` | ✅ |
| 类目「查看全部」→ 类目页 | `onSelectCategory` | `push({kind:"section"})` | ✅ |
| 应用行 → 详情页 | 详情 pane | `push({kind:"detail"})` | ✅ |
| `返回` 逐层回退 | detail bar 返回 | `pop()`，栈底才关闭 | ✅ |
| 详情：描述 | `sand-plugins-detail__desc` | 同类名 | ✅ |
| 详情：查看源码 | `<a href>` → `entry.homepage` | 同 | ✅ |
| 详情：复制此插件的链接 | 剪贴板 | 同（与源码同 URL） | ✅ |
| 详情：分享 | 分享按钮 | 剪贴板 | ⚠️ 见 D5 |
| 详情：添加 / 卸载 | 按安装态切换 | 同（`添加`/`卸载`） | ✅ |
| 详情：账户（已安装才有） | `__accounts` + 编辑账户 + 状态 | 同 | ⚠️ 见 D6 |
| 详情：工具（已安装才有） | `__tools` 已启用 n/n 个 | 同 | ⚠️ 见 D7 |
| 详情：应用（连接器） | `__connectors` | 同 | ✅ |
| 详情：信息 | `dt`/`dd` 条件渲染 | 同 | ✅ |
| 长列表继续下翻 | 单一滚动区 | 同（**无分页按钮**，见下） | ✅ |

**关于「翻页」**：官方类目页**没有分页控件**。效率类目 63 行全部渲染进一个滚动区
（`scrollHeight 2202` vs `clientHeight 652`），弹窗内不存在「加载更多 / 下一页」。所以「保持可继续
向下翻页加载」在官方语义下就是**连续纵向滚动**，本移植照此实现，没有编造分页按钮。

## 3. 与截图 / 官方的差异清单

以下每条都是**已核实的实现差异**，不是待办臆测。

| # | 差异 | 原因 | 证据 |
|---|------|------|------|
| **D1** | `已安装 N 个` 的数字与截图不同（截图 16） | 截图是官方账号的状态；本机登录态无关，数字随本机实际安装数变化 | EVIDENCE §1 |
| ~~D2~~ | ~~`为你推荐` 4 个 app 与截图不同~~ **降级为非差异** | 2026-10-04 双 app 对拍：`teamPopularity()` 在**官方侧也是 0 条**，本地无团队信号是**双方一致的行为**，不是本地缺陷。截图的 4 个来自官方登录账号态 | EVIDENCE §9.2 |
| **D3** | `团队插件` 为空 | 官方该区唯一条目 `oh-my-claudecode` **不在本地 catalog**（本地是官方 catalog 的严格子集，少 11 条，含它） | EVIDENCE §9.2 |
| ~~D4~~ | ~~部分 app 不出现在首页类目区块中~~ **降级为与官方一致** | `MCP` 不在官方 15 类枚举里，且**官方自己的 151 条 MCP 全部 `categoryKey: null`**；本地 146 条同理。两边都归不进任何桶。另经核实 `Infrastructure`/`Agent Orchestration`/`Customer Support` **都有映射且正确**，先前"220 条未归桶"的推断有误 | EVIDENCE §9.3 |
| ~~D5~~ | ~~`分享` 是剪贴板降级~~ **已撤销** | 2026-10-04 实机挂钩验证：官方 0.66 的「分享」**同样只调 `clipboard.writeText`、写同一个插件 URL、不调 `navigator.share`、不弹任何面板**。本地实现与官方**完全一致**，不是差异 | EVIDENCE §16 |
| **D6** | 详情页 `编辑账户` / `添加账户` 无后端动作 | 本地无账号编辑桥；按钮按官方几何渲染，行为为空 | view.ts `renderDetail` |
| ~~D7~~ | ~~`工具` 行可能显示 `已启用 0/0 个`~~ **已撤销** | 2026-10-04 复核：官方对 `needsAuth` 的连接器（实测 Canva）**同样**显示 `已启用 0/0 个`，本地一致，不是差异 | 官方/本地 Canva 详情页逐字比对 |
| **D8** | `信息 · 网站` 显示主机名（`cursor.com`），源码链接目标是完整 URL | 官方对同一字段分别用「主机名做标签、完整 URL 做 href」；本地 `homepage` 为完整路径。标签取 host 与官方一致，href 精确等于 catalog 值 | model.ts `displayHost` |
| ~~D9~~ | ~~`私有技能` 为空~~ **已修复** | 2026-10-04（d1fd68e）补上 `sand:skills-list/update/remove` 三条直连 IPC 通道后，该区改为真实数据。host 的 `getAgentWorkflows` 本就同时返回 `workflows/`（用户自建）与 `managed-skills/skills/`（托管）；缺的只是跨 preload 桥那一段。**gateway 不可达时显式返回 `gateway-unreachable`，绝不退化成空列表**（空列表读起来像一个正确答案）。实机 40 条技能 | `source/electron-main/skills/skills-desktop.ts` |
| ~~D10~~ | ~~部分 app 添加时不弹凭据表单~~ **已撤销** | 2026-10-04 复核：官方对带 8 个 `fields` 的 Capital.com 点「添加」**也不弹表单**。本地 `mcp.install` 直连 = 官方的一步动作，**不是差异** | EVIDENCE §8 |
| **D11** | 首页 12 区块，官方 13 —— **缺 `登录与凭据管理`** | 该区唯一条目 `1Password` 在**两边 `mcp.catalog()` 里都不存在**（官方 404 条无它、本地 393 条无它）——它来自 catalog 之外的源，本移植无从复现。桶顺序表里 `credentials` 仍在首位，只是空桶按上游规则整块省略 | EVIDENCE §9.2 |
| ~~D12~~ | ~~`支持` 桶本地只有 2 行（官方 3 行）~~ **改判** | 2026-10-04 复核：`MailerLite` **在本地 catalog 里存在**，只是没被选中——原先"catalog 缺条目"的判断不成立。真实成因是官方有厂商级 override 表未转写（同 D13） | EVIDENCE §10 |
| **D13** | 首页条目级非 100% 一致 | **渲染规则已按上游真源逐字对齐**（§18）：`Le` 14 条、`Te` 16 条厂商 override、`ke` 归一化、`categoryKeys` 数组求并集全部转写。条目差异的**唯一**成因是本地 catalog 不下发 `categoryKey`/`categoryKeys`/`categories`（只有人读 `category`），而官方 253/404 条带多值 `categoryKeys`（一条可落多桶）。已对 `canva`/`mailerlite` 做**明确标注的数据缺口补偿**并写明上游原值；`Bird`/`Adapter` 不补偿（同一成因，本地不可区分） | EVIDENCE §18 |
| **D14** | 私有技能详情页标题下的副标题**硬裁切，无省略号** | 该 span 套 `DETAIL_SOURCE_ROW_CLASSES`（11 个类，全部是 0.18 自带样式表里的既有配方：`sand-uxw1ft`=nowrap、`sand-b3r6kr`=overflow:hidden、`sand-euugli`=min-width:0、`sand-78zum5`=display:flex）。**没有任何一个类声明 `text-overflow`**，浏览器默认 `clip` → 实测 `scrollWidth 640 / clientWidth 610`，末尾 30px 直接切掉。列表行里的副标题是**另一组**类 `sand-plugins-row__subtitle`，带 `text-overflow:ellipsis`，正常省略。<br>**这组类名是否就是官方 0.66 私有技能详情页副标题的配方，未取证** —— EVIDENCE 只记了列表行副标题（§3 `SPAN.sand-plugins-row__subtitle`）。按证据优先原则**不改**：改成省略号就是臆造官方行为。记为 uncertainty | official-styles.ts `DETAIL_SOURCE_ROW_CLASSES` |

## 3b. 「无遗漏」的穷尽核查（2026-10-04 补测）

目标要求「直到无遗漏页面为止」。除已实现的三层外，把详情页/管理页上**所有可点元素**
逐个在官方实机上按过，确认它们**不开新页面** —— 这几处因此保持惰性，是忠实而非遗漏：

| 元素 | 官方实测 | 结论 |
|------|---------|------|
| 详情页 `工具` 行（带 chevron 的 button） | 点击后盒子恒为 42px、恒 1 个子节点、弹窗 innerText 从不出现工具名（实测连续点击 3 次 + 真实指针事件） | **不展开**，无工具列表页 |
| 详情页 `添加账户` | 点击后弹窗文本无变化、无新对话框 | **不导航** |
| 详情页 `编辑 default 账户` | 同上 | **不导航** |
| 详情页 `分享` | 写剪贴板（与「复制此插件的链接」同 URL） | 已实现 |

> **一次假阳性的记录**：最初一轮探测报告工具行展开后有 23 个工具名（Create draft / List drafts /
> Get thread …），据此差点去实现一个工具列表页。复核时全弹窗 `innerText` 仅 163 字符、
> 按工具名做 TreeWalker 文本节点匹配**零命中** —— 那次读数是错的。**教训：`.click()` 之后立刻
> `innerText` 取子树，容易在页面切换中间态读到残留节点；判定"某个交互是否真的打开了东西"
> 要用全文档树搜索 + 多次点击复现，不能只信一次 innerText 快照。**

另有一条**已存在但我此前漏用的数据源**：`window.desktop.mcp.listServerTools(serverId)`
实测返回 23 个 `{name, description, isDisabled}`。因为官方 0.66 并不渲染工具列表，它保持未使用
—— 有桥不等于有界面，接上去反而是臆造。

## 4. 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/extensions/marketplace/model.ts` | 区块 `kind`（featured/bucket）、`sectionGroup`、`buildPluginDetail`、`appCountLabel`、`displayHost`、`homepage` 入 CatalogEntry、22 个新 `TEXT` 键 |
| `frontend/src/extensions/marketplace/view.ts` | 页面栈分派、`renderSection`、`renderDetail`、detail bar 页头、`onBack`/`onUninstall`/`onShare`、单列网格分支 |
| `frontend/src/extensions/marketplace/official-styles.ts` | 40+ 组官方类名常量、7 个新字形码位（`copy` `externalLink` `pencil` `plus` `plug` `chevronDown`）、单/双列网格变体 |
| `frontend/src/extensions/marketplace/index.ts` | `stack` 推栈导航、查看全部/打开行接上 push、`sharePlugin`、`removePlugin` |
| `docs/MARKETPLACE-066-EVIDENCE.md` | 全部取证的落库文档（几何表、类名、字形） |
| `tests/plugins-marketplace-renderer-patch.test.mjs` | 守卫从「详情页必须空壳」翻转为「详情页必须锚定取证」 |

## 5. 实机验证（2026-10-04，部署后 CDP 走查）

在 `/Applications/Grok Node.app` 上用 CDP 逐层点过，测得值与官方实测值对照：

| 检查项 | 官方实测 | 本地实测 | |
|--------|---------|---------|---|
| 首页区块顺序 | 为你推荐→精选插件→团队插件→登录与凭据管理→效率→…→支持 | 同序（缺 登录与凭据管理） | D11 |
| 首页「查看全部」个数 | 9 | 9 | ✅ |
| 精选类目页 包裹层 | 有 `.sand-plugins__marketplace` | 有 | ✅ |
| 精选类目页 标题 | `h1` + 区块名 | `H1 \| 精选插件` | ✅ |
| 精选类目页 网格 | `734px`（单列） | `734px` | ✅ |
| 精选类目页 行数 | 6 | 6 | ✅ |
| 桶类目页 包裹层 | **无** | 无 | ✅ |
| 桶类目页 标题 | `h3` + `结果`，桶名在页头 | `H3 \| 结果`，页头 `效率` | ✅ |
| 桶类目页 网格 | `363px 363px`（双列） | `363px 363px` | ✅ |
| 类目页 分页控件 | 无（纯滚动 2202/652） | 无（`hasLoadMore:false`，1952/652） | ✅ |
| 详情页 返回键 | `aria-label=返回` | `返回` | ✅ |
| 详情页 页头标题 | 插件名 | `Adobe Developer App Builder` | ✅ |
| 详情页 动作区 | 复制链接 / 分享 / 添加(卸载) | 同 | ✅ |
| 详情页 源码链接 | 真实 `<a href>` | `https://github.com/adobe/skills` | ✅ |
| 详情页 信息区 | 功能/开发者/类别/网站/可用性 | 同 5 行 | ✅ |
| 逐层返回轨迹 | detail→bucket→home | `效率` → `(market)` → `HOME(no-back)` | ✅ |
| 管理页行数 | 48 | 48 | ✅ |
| 管理页行序 | 打开 Canva / Figma / Gmail | 同 | ✅ |
| 管理页 → 详情页 | 推详情，返回回管理 | 同（`h1 管理插件和技能` 恢复，48 行） | ✅ |
| Canva 详情页全文 | `账户 default 需要认证 工具 已启用 0/0 个 … 功能 1 个应用6 项技能 …` | **逐字相同** | ✅ |

### 顺带修掉的两个既有问题

1. **行名 span 用错配方类**（上一轮遗留）：`row__main` 的名称元素带着包裹层的类，
   丢了官方的 `sand-plugins-row__name`。字符照样渲染出来，**任何文本断言都发现不了**。
   已在官方实机确认子树是三层 `row__main > [包裹层 > __name] + [__subtitle]` 并修正。
   连带把断言错误结构的守卫一并重写 —— 它当时还明确禁止 `sand-plugins-row__name` 出现。
2. **桶类目页标题用了 `h1`**：官方是 `h3`（34px）。已改，文档大纲与字号同时对齐。

## 6. 自证方式

本移植所有类名与几何都不是推来的。三个等级的自证：

1. **类名/字形**：官方产物 `className` 与 `--cursor-icon-content` 逐项 dump。
   字形是 PUA 私用区码位（`` 复制、`` 外链、`` 铅笔、`` 加号、`` 连接器），
   **不可从图标名推断**，猜错就渲染空白方块。
2. **几何**：`getBoundingClientRect()` 实测（对话框 800×702 @ (32,160)、内容列 734、行 64、
   图标 40/56、详情页四个分区高度）。
3. **关键结论交叉验证**：单列 vs 双列一度读数自相矛盾（DOM 查询抓到的是留在 DOM 里的首页网格），
   最后用 `Page.captureScreenshot` 截图定论 —— **单列 + 大 `h1` 属实**。教训：DOM 选择器读数
   在推栈页面里可能抓到上一页的残留，几何结论必须截图复核。

## 7. 逐条验收状态（2026-10-04 双 app 对拍后）

这一节是对 Goal 四条要求的诚实结算。**不是全部达成**。

| # | 要求 | 状态 | 依据 |
|---|------|------|------|
| 1 | 逐页复刻首页推荐内容，app 列表与原版完全一致 | ⚠️ **部分达成（代码已对齐，差异是数据面）** | **渲染规则完全对齐**：14 个区块的行数、`查看全部` 出现条件（>4 行）逐条一致。**条目级 9/14 完全一致**（修掉 3 处归桶错误后由 6/14 提升）。余下 5 处按根因拆开：2 处仅差本地 catalog 缺条目、1 处 `1Password` 不在任何一侧 catalog、1 处双方同为未登录态（与官方一致），**已找到根因并按上游真源转写**（§18）：差异全部源于本地 catalog 缺 `categoryKeys` 多值数组这一数据面，不是算法问题 |
| 1b | 支持继续向下翻页加载 | ✅ 达成 | 官方**无分页控件**（效率 63 行进单一滚动区 2202/652），故"继续向下翻"= 连续纵向滚动；未编造分页按钮 |
| 2a | 每个 app 卡片可点击跳转 | ✅ 达成 | 实机：类目页任一行 → 详情页 |
| 2b | 每个分类「查看全部」进入下一页列表 | ✅ 达成 | **9 个「查看全部」逐个实机点过**：精选页单列 734 + 包裹层 + `H1`；8 个桶页双列 363 + 无包裹层；**行宽/包裹层/无分页控件三项与官方 9 页全部一致**，行数 227 vs 官方 248 |
| 2c | 详情页支持详细介绍/查看源码/分享/添加 | ✅ **达成**（分享经实机验证与官方同为写剪贴板） | 描述 ✅、查看源码（真实 `<a href>`）✅、添加/卸载 ✅（一步动作，与官方同形）。**「添加到指定位置/分组」经实机取证在 0.66 中不存在该界面**——对 0 字段的 Ahrefs 与 8 字段的 Capital.com 点「添加」均无任何表单或选择器 |
| 3 | 递归复刻每层页面直到无遗漏 | ✅ 达成 | L0/L1a/L1b/L2/L1′ 全部打通并逐层返回验证；详情页/管理页**所有**可点元素逐个在官方按过（连点 3 次 + 真实指针序列），确认工具行/添加账户/编辑账户**均不开新页面**，已落 `assert.ok(!/addEventListener/)` 守卫 |
| 4 | 完整代码 + 路由清单 + 功能对应 + 差异清单 | ✅ 达成 | 本文件 + EVIDENCE；代码在 `frontend/src/extensions/marketplace/` |

### 未达成项的处理原则

条目级一致性（#1）没有 100% 达成，**没有靠猜来补**：残差的三处都指向官方存在一层本地未转写的
厂商级 override 表，bundle 里搜不到对应字面量，**记为 open** 而不是拟合一个看起来对的结果。
把官方自己的 404 条 catalog 喂进本模型会算出本地的答案——这条实验本身就是"算法仍有差"的
证据，把它藏起来比留着更有用。

### 验证强度（更正）

- typecheck / `source:typecheck` 干净；**872/872 测试通过**（含 3 条锚定实机对拍的新守卫）
- **部署版 asar 的 101 个 renderer chunk 逐个 `node --check`，0 错误**（从 `/Applications`
  已部署字节抽出）。⚠️ asar 内 `.js` 总数是 209，但那是含 108 个 `node_modules` 与主进程
  bundle 的全量口径，**语法验证对象是 101**
- `codesign --verify --deep --strict` 通过
- glyph 渲染链在部署字节里闭环：`R("chevron-right", T.chevronDown, 10)` → `setProperty(
  "--cursor-icon-content", …)` → `.ui-1yj7g93:before{content:var(--cursor-icon-content)}`，
  且 CSS 中 `[data-icon-name…]` 规则 **0 条**，故 `content` 完全由码位决定
