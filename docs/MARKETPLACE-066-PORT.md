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

**关于「添加到指定位置 / 分组」**：目标要求 2 列了这一项，实机核查后确认**官方 0.66 的市场
详情页没有这个控件**。把官方详情页上的全部动作控件逐个列出，只有 6 个：

```
关闭 | 返回 | 复制此插件的链接 | 查看源码 | 分享 | 添加
```

无 `aria-haspopup`、无 `role=menuitem`、无任何下拉。唯一的「分组」文本命中来自主界面侧栏的
「未分组」，与市场无关。**本地逐条一致，同样是这 6 个**（已部署 app，CDP 9232 实测）。

官方在这一层提供的「放到某个位置」语义是 `添加` → 进入「已安装 N 个」，而不是详情页里的分组
选择器。所以要求 2 该项在官方侧即为空，**不构成本移植的差异，也不编造一个出来**。

**关于「翻页」**：官方类目页**没有分页控件**。效率类目 63 行全部渲染进一个滚动区
（`scrollHeight 2202` vs `clientHeight 652`），弹窗内不存在「加载更多 / 下一页」。所以「保持可继续
向下翻页加载」在官方语义下就是**连续纵向滚动**，本移植照此实现，没有编造分页按钮。

## 3. 与截图 / 官方的差异清单

以下每条都是**已核实的实现差异**，不是待办臆测。

| # | 差异 | 原因 | 证据 |
|---|------|------|------|
| **D1** | `已安装 N 个` 的数字与截图不同（截图 16） | 截图是官方账号的状态；本机登录态无关，数字随本机实际安装数变化 | EVIDENCE §1 |
| ~~D2~~ | ~~`为你推荐` 4 个 app 与截图不同~~ **2026-10-05 20:2x 重新定性：代码侧已对齐，残留差异唯一归因为「已装集合不同」** | 先前几轮结论反复，本行是最终态。<br>**代码侧（20:12 那次重打包已部署）**：已部署产物的 affinity 键函数现在是 `function ye(n){return L(n.category).trim()}` —— 直接取条目自己的 `category` 标签，不经映射表；`selectForYou`（现名 `Ls`）是 `let E=ye(p.entry); E.length!==0 && a.set(E,…)` 的单值判空形态，与官方 `v(e,t){return j(e.category.trim(),t)}` **同源**。实测键为空 **0/403**。（修复前是 `vn(n)` 经 `as` 表间接、`as` 缺 MCP/AGENT_ORCHESTRATION/FEATURED → 169/403 条失格。）<br>**残留唯一差异 = 已装集合不同（机器状态，不可消除）**：官方那 4 个赢家的 category 实测**四取四全是 MCP**，而本地已装的 8 条里没有 MCP 类，亲和表只有 `{Featured:6, Productivity:2}`，代码侧已无法更接近。界面现在显示 `Adobe Developer App Builder / Airtable / Asana / Atlassian`（连跑两遍稳定），与 `npm run marketplace:affinity:audit` 的离线重放**逐字一致**。<br>审计脚本的定位链**不含任何压缩名**（压缩名每次重打包就变：`ms`→`Ls`、`vn`→`ye`，且 `ye` 有 3 个前置声明），只用三个位置事实：`affinityStrength` 偏移必须**落在同一函数体内**、键函数是体内 `NAME(...entry)` 的被调者、生效声明是**调用点之前最近**的那个。 | [foryou-affinity-key](evidence/marketplace-foryou-affinity-key.md) 现行状态段；`npm run marketplace:affinity:audit` |
| **D3** | `团队插件` 为空 | 官方该区唯一条目 `oh-my-claudecode` **不在本地 catalog**（本地是官方 catalog 的严格子集，少 11 条，含它） | EVIDENCE §9.2 |
| ~~D4~~ | ~~部分 app 不出现在首页类目区块中~~ **降级为与官方一致** | `MCP` 不在官方 15 类枚举里，且**官方自己的 151 条 MCP 全部 `categoryKey: null`**；本地 146 条同理。两边都归不进任何桶。另经核实 `Infrastructure`/`Agent Orchestration`/`Customer Support` **都有映射且正确**，先前"220 条未归桶"的推断有误 | EVIDENCE §9.3 |
| ~~D5~~ | ~~`分享` 是剪贴板降级~~ **已撤销** | 2026-10-04 实机挂钩验证：官方 0.66 的「分享」**同样只调 `clipboard.writeText`、写同一个插件 URL、不调 `navigator.share`、不弹任何面板**。本地实现与官方**完全一致**，不是差异 | EVIDENCE §16 |
| **D6** | 详情页 `编辑账户` / `添加其他账户` 无后端动作 | 本地无账号编辑桥；按钮按官方几何渲染，行为为空 | view.ts `renderDetail` |
| ~~D7~~ | ~~`工具` 行可能显示 `已启用 0/0 个`~~ **已撤销** | 2026-10-04 复核：官方对 `needsAuth` 的连接器（实测 Canva）**同样**显示 `已启用 0/0 个`，本地一致，不是差异 | 官方/本地 Canva 详情页逐字比对 |
| **D8** | ~~`信息 · 网站` 显示主机名（`cursor.com`），源码链接目标是完整 URL~~ **2026-10-04 复核：本地此前是错的** | 上游是**两个不同字段**：`websiteUrl`（`https://cursor.com/`）喂 `信息 · 网站` 的标签，`repositoryUrl`（`https://github.com/cursor/plugins`）喂 `查看源码` 的 href。本地原把两者并成一个 `homepage` 且优先取 repository，于是 `网站` 行渲染成 `github.com`。已改为两字段各自透传（`toPlugin` + `marketplacePluginToView` **两层都要**，第二层曾吞掉 `categoryKeys`）。标签取 `websiteUrl` 的 host，href 仍取 `repositoryUrl` | model.ts `buildPluginDetail`；mcp-marketplace.ts `toPlugin`/`marketplacePluginToView` |
| ~~D9~~ | ~~`私有技能` 为空~~ **已修复** | 2026-10-04（d1fd68e）补上 `sand:skills-list/update/remove` 三条直连 IPC 通道后，该区改为真实数据。host 的 `getAgentWorkflows` 本就同时返回 `workflows/`（用户自建）与 `managed-skills/skills/`（托管）；缺的只是跨 preload 桥那一段。**gateway 不可达时显式返回 `gateway-unreachable`，绝不退化成空列表**（空列表读起来像一个正确答案）。实机 40 条技能。**要求 C 的实机 box-down 观测也已完成**（2026-10-04 06:3x，已部署产物）：`docker stop`、移走连接文件、把 `baseUrl` 指向关闭端口三种做法下该区都渲染显式错误且行数为 0，`已安装` 段不受影响，box 恢复后自动回到 40 行 | `source/electron-main/skills/skills-desktop.ts`；证据见 [PARITY §要求 C](MARKETPLACE-066-PARITY-2026-10-04.md#要求-chost-gateway-不可达--显式报错实机-box-down-观测-063x) |
| ~~D10~~ | ~~部分 app 添加时不弹凭据表单~~ **已撤销** | 2026-10-04 复核：官方对带 8 个 `fields` 的 Capital.com 点「添加」**也不弹表单**。本地 `mcp.install` 直连 = 官方的一步动作，**不是差异** | EVIDENCE §8 |
| **D11** | 首页 12 区块，官方 13 —— **缺 `登录与凭据管理`** | 该区唯一条目 `1Password` 在**两边 `mcp.catalog()` 里都不存在**。**2026-10-05 已定位成因**：它既不是 catalog 条目也不是网络返回，而是官方渲染器 `index.eager-app-Cj5f8Gby.js` 里**写死的常量** `xF` 经投影函数 `FF` 产出的**原生集成行**（行上带 `native:"onepassword"`），点下去走凭据开通流程而非 MCP 安装。本地无 native plugin host（`view.ts:510` 已记录该事实），且本地 1Password 桥虽 API 完整却**无人调用**、默认 sink 恒抛 `sink-unavailable`。用户 2026-10-05 决定：**只做取证归档，本轮不改代码** —— 接进市场要先回答「凭据消费方是什么」，属架构决策而非 UI 问题 | [credentials-native-integration](evidence/marketplace-credentials-native-integration.md) |
| ~~D12~~ | ~~`支持` 桶本地只有 2 行（官方 3 行）~~ **改判** | 2026-10-04 复核：`MailerLite` **在本地 catalog 里存在**，只是没被选中——原先"catalog 缺条目"的判断不成立。真实成因是官方有厂商级 override 表未转写（同 D13） | EVIDENCE §10 |
| **D13** | 首页条目级非 100% 一致 | **代码已按上游真源逐字对齐**（§18）：`Le` 14 条、`Te` 16 条厂商 override、`ke` 归一化、`categoryKeys` 数组求并集全部转写。**数据缺口已于 2026-10-04 06:26 补上**——宿主侧把 `categoryKeys` 贯通两��投影后，运行时 247/393 条带该数组，两条拟合补偿自动让位。修复后重测：**9/12 共有区块逐行一致**（我另一次独立实测 10/14，差的一个是 `市场` 容器——两边行名均为空，属退化相等）。余下 3 处全为 catalog 数据面：本地比官方少 11 条（`Google Slides` / `oh-my-claudecode` 等），`1Password` 两侧 catalog 均无；`为你推荐` 见 D2（**唯一原因是部署侧 affinity 键经缺项映射表间接**：169/403 条键为空；重建侧已修、部署侧待拍板） | EVIDENCE §18 / PARITY 文档 |
| **D14** | 私有技能详情页标题下多出一个副标题，且**硬裁切无省略号** | **2026-10-05 已取证，原先的猜测被推翻。** 原文写的是「这组类名是否就是官方配方，未取证，按证据优先原则不改」—— 现在两侧都量了：<br>· 官方 0.66（技能 `画图`）：详情条 `sand-settings-detail-bar` 的文本**只有标题**；条内有一个 `w=0` 的**空** flex 槽位（`display:flex`、无文本）；`DETAIL_SOURCE_ROW_CLASSES` 那 11 个类在该页面上 **0 命中**。**官方这一处根本不渲染副标题。**<br>· 本地（技能 `routines`）：详情条文本同样只有标题（结构一致），但条下方 `top=259 w=610` 处有 **1 命中**，即我们渲染的副标题；`textOverflow=clip`、`whiteSpace=nowrap`、`scrollWidth 1213 / clientWidth 610` → 硬裁切掉 603px。<br>**所以这不是「我们 clip、官方 ellipsis」的样式错配，而是「官方不渲染、我们多渲染了一个元素」。** 加省略号仍然是臆造官方行为（官方没有这个元素可省略）；要真正对齐官方应当**不渲染**。<br>**2026-10-05 17:5x 已按「不渲染」实现**（用户拍板）：`renderSkillDetail` 里那个 span 保留但**不带文本**。保留节点是因为官方那个位置确实有一个 `w=0` 的空 flex 槽位，删掉节点也对齐不上；宽度为 0 时两者视觉无差，属 DOM 层面的保真取舍。只影响可读重建（`frontend/` 不进包）。守卫 `tests/plugins-marketplace-renderer-patch.test.mjs` 的 D14 用例（切片自带「不得吞掉相邻函数」断言），3/3 变异全红：加回副标题 / 整个删掉节点 / 误删管理页列表行的副标题 | view.ts `renderSkillDetail`；official-styles.ts `DETAIL_SOURCE_ROW_CLASSES` |
| ~~**D15**~~ | ~~列表行尾 `添加`/`连接`、详情页 `返回`、`查看源码` 图标、`分享` 图标盒四处几何与官方不符~~ **已修（2026-10-04）** | 实测值分别为 32×24 / 36×28 / 图标缺失 / 78×36，官方为 **46×26 / 28×28 / 69×18 / 82×36**。根因是类名配方用错（猜的 `sand-kit-button`）、详情返回与管理页返回**共用**一套配方、`查看源码` 的图标被 append 到外层容器而非 `<a>`、`分享` 缺官方那个 18×18 图标盒 span。已按官方实机 DOM 逐项改正并落 5 条守卫；未打包前先用注入验证确认四项几何全中 | EVIDENCE §21 |
| **D17** | 详情页缺「编辑 default 账户」内联表单（重命名 / 账户标签 / 保存 / 移除） | **2026-10-05 19:1x 实机取证补入。** 官方点「编辑 default 账户」后**内联展开**（`role=dialog` 数恒为 0，不是弹层）：可见输入框 1→2，新增 `重命名 default 账户`（value=`default`），`新账户标签` 本就常驻；按钮换成「保存 default 账户」+「移除 default 账户」。全程 `chip=0`、`select=0` ⇒ **官方没有任何「位置/分组选择器」**，分组语义只由账户标签的自由文本表达（placeholder 示例正是「工作」「个人」）。<br>本地现状：只有 `createAddAccountCta`（添加其他账户），**没有编辑表单**，且 `model.ts` 的 `accounts` 只有 `{key, status}`、**无 label 字段**。<br>**可实现性（2026-10-05 19:2x 更正）**：**桥已经完整存在，D17 是纯 renderer 侧缺口，不需要改宿主契约。** 实机读数 `window.desktop.mcp` 的方法表里 `renameAccount` 与 `removeAccount` **都在**。链路：`preload.ts:180-181` 暴露 → `mcp-desktop.ts:11` 注册 `sand:mcp-rename-account`/`sand:mcp-remove-account` → `mcp-manager.ts:505-509` → `mcp-account-slot-lifecycle.ts` → `backend-mcp-exec.ts:73` `client.renameMcpOAuthAccount`。另 `sand-mcp-management-tools.ts:77,434` 有同名工具供 agent 用。<br>仍需做：① `model.ts` 的 `accounts` 投影补 `label` 字段（现只有 `{key,status}`）；② 详情页渲染内联编辑表单（重命名框 + 标签框 + 保存/移除按钮）。**本轮未做** —— 属新增功能而非对齐缺口 | EVIDENCE §26 追加段 |
| **D17 类名对拍更正** | 上述实现里我**主动删过 3 个类**，理由（「0.18 缺」）建立在校验错产物上 | **2026-10-05 19:3x 查实为我的错，已修。** 判据一：在 **JS chunk** 里找 `sand-15kz4h8` 得 0 命中就当「0.18 没有」—— 改查 **CSS**：0.18 有 `min-width:16px`，与官方**逐字相同**。判据二：在 **CSS** 里找 `sand-1pic42t`/`sand-1onr9mi` 得 0 规则就当「不可用」—— 漏了它们经 `LIFTED_OFFICIAL_RULES` 以 `padding-inline-start/end:14px` 注入，方向与官方**逐字一致**。**两个方向各错一次，两次都指向「删掉」**；而旧守卫用「我方 ⊆ 官方」这个方向性判据，把**少抄**判成通过，所以没被任何测试报出来。<br>已补齐：输入框 13→14 类、表单槽位 7→9 类，四组配方现在与官方**集合完全相等**。官方侧取值改为**语义绑定**（JSX 树里「重命名 input 的直接父 span」「最近的 div 变体祖先」），此前按窗口/最近邻取会**三组全挑错**（把非编辑态的 span 当成输入框）。另查明官方**同一个 button 兼作编辑与保存两态**。<br>门禁：`scripts/verify-d17-classnames.mjs`（`npm run marketplace:classnames`）自检 **20/20**、变异 **4/4 全红**（拼错字母 / 少抄 / 抄成 connected 态），`tests/marketplace-d17-classnames.test.mjs` 2 用例。该脚本有**两层**：源码层 + **部署字节层**（从 `/Applications` 已部署的 asar 切出注入 IIFE，顺 `B(el, LIST)` 的常量绑定解出类名数组逐字比对）—— 因为源码对了不等于部署包里有（esbuild 后类名成了短名常量，注入代码里连 `className:` 字面量都没有）。<br>**顺带修掉**：展开槽位由 `span` 改 `div`（官方该角色是 `div`；此前是 `div` 嵌 `span` 的非法内容模型）。**仍未对齐**：官方槽位 div 是**包住** nameRow 与编辑按钮的容器，我们是 `accountRow` 的兄弟节点 —— 改结构需实机量测，而通道被钥匙串弹窗堵着，故不盲改，已在 `view.ts` 就地写明 | EVIDENCE §27 |
| **D16** | 既有类名列表仍带 4 个 0.18 不定义的类 | `sand-yri2b`/`sand-1c1uobl`/`sand-1firant`/`sand-1iolv91` 出现在详情标题、关闭按钮、返回条等**既有**列表中。这些控件实测尺寸全部正确（缺失的只影响 hover/focus/transition），逐个替换牵动十来个常量，超出本轮范围 | EVIDENCE §22 |
| ~~**D17**~~ | ~~catalog view 缺 `pluginName`~~ **已修（2026-10-05，`62304af`）** | 官方 0.66 的 view 带 `pluginName`（插件自己的 name，403/403 条都有，其中 85 条与 `name` 不同），而渲染层的 vendor 覆盖探针 `Re()` 是**先读 `pluginName` 再读 `name`** —— 它是 `Te` 的查表键。此前该字段被列进测试的 `BRIDGE_ONLY` 豁免名单，把「投影器不产出它」藏在了一条绿测试下面。<br>**为何一直看不出来**：算过「补上它会不会改变分区归属」，只有 2 行命中键会变（`context7`→`context7-plugin`、`notion`→`notion-workspace`），而本地表里这两个别名成对存在、指向同一个桶，渲染上完全不可见。**是潜伏缺口而非无影响**。<br>已按官方产物逐字移植（`toPlugin: pluginName: plugin.name` + `marketplacePluginToView` 带出），并从 `BRIDGE_ONLY` 拿掉。逐条 `pluginName` 与官方零不一致，7/7 变异全红 | [pluginname-port](evidence/marketplace-pluginname-port.md) |
| **D18** | **首页行图标与官方不一致**（要求 1 明列的「图标」此前从未被测过） | 官方把目录图标以 **data URI 内联**且**统一归一化到 112×112**（少数 67×67 / 112×110）；本地**透传 catalog 里的原始远端 URL**，尺寸五花八门（400×400 / 1024×1024 / 621×621 / 512×511 / 250×250 / 200×200 / 135×133…）。**不是「同一份图不同交付方式」**：离线解字节比对，40 行里 38 行 sha256 不同、39 行里 38 行尺寸不同，官方那份系统性地小得多（Canva 16.9KB vs 145KB、Aave 7.4KB vs 80KB、Appwrite 15.5KB vs 174KB）—— 是重新下采样过的资产。两侧**渲染盒相同**（实测均 39×39），差异在资产本身，会表现为同屏图标相对大小不一致。另一层影响：本地图标依赖 `cursor-cdn.com` 与 `vercel-storage` 两个外部 CDN，官方内联则无外部依赖。<br>**2026-10-05 21:0x 已查实机制并落地。** §26 当时的疑问「是同一 CDN 的尺寸参数？还是服务端预生成字段？」**两个都不对**：catalog 的 `iconUrl` 两侧同形且无尺寸字段，直接 fetch 那条 URL 现在仍是 **400×400**。真源在宿主 `main-app.cjs` 的 **`displaySizedLogo`**：`nativeImage` 把图缩到 **`RG = 56*2 = 112`（最长边、保持长宽比）**后内联 —— 「保持比例只约束最长边」正好解释当初实测到的 112×110。<br>关键发现：**桥早就全链路移植好了、只是从未被调用**（preload:170 → desktop-bridge:284 → IPC `sand:mcp-plugin-logo` → manager → `mcp-marketplace-logo.ts` 的 fetch 半段与官方逐字一致），缺的是缩放半段 + 渲染层接线。本次补 `plugin-logo-cache.ts`（官方 `A8t`/`RJe`/`b8t` 全套移植，常量逐字）、`adapters/plugin-logos.ts`（绑 electron，ABI 不全时透传）、`logo-source.ts`（先同步赋远端 URL、桥回来才替换，**桥失败即逐像素回到改动前**）。<br>门禁 13 个用例、**变异 17/17 全红**（一条观测等价的除外）。**2026-10-05 20:2x 已实机确认**：首页 21 个图标 **21/21 全为 data URI**、尺寸分布 **112×112 × 17 / 112×110 × 2 / 67×67 × 2** —— 后两个非方形桶正是「保持长宽比、只约束最长边」的预测值，与当初记下的官方观察逐项吻合，**外部 CDN 依赖归零** | EVIDENCE §28/§29 / [icon-assets](evidence/marketplace-icon-assets.md) |
| **D19** | 详情页「添加其他账户」是**死按钮**（要求 2/3 范围内的真实功能缺口） | 官方 0.66 在 Gmail 详情页点「添加其他账户」后**内联展开新账户表单**：`新账户标签` 输入框（placeholder「为此账户添加标签，例如“工作”或“个人”」，实测 478×28）+ `授权` / `取消` 两个按钮，文本从 `账户 default 已连接 添加其他账户` 变为 `账户 default 已连接 授权 取消`。**本地点它无反应**（文本、输入框、按钮全部原样）。<br>**代码级佐证**：官方 `ve()` 接的 props 含 `onAddAccount`；那个标签 input（`aria=R2hekE`、placeholder 消息 id `mwTfIH`）位于**紧邻 `sand-plugins-detail__add-account` 按钮的三元另一支**，与编辑表单分离、也都不常驻。<br>⚠️ **有一条守卫在强制这个错行为**：`tests/plugins-marketplace-renderer-patch.test.mjs:767` 的 `assert.ok(!/addEventListener/.test(addAccount), "添加其他账户 has no destination in 0.66")` —— 它会**挡住任何正确实现**。原 PORT 文档把它记成「不导航」、验收行「所有可点元素均不开新页面」也据其立论，**前提都是错的**（取证时账户区处在折叠态，官方要点了才展开）。<br>**实施前提已探明**（不必再探）：本项目桥**只有** `renameAccount`/`removeAccount`、**无** `addAccount`；宿主有 `addServersToAccount`（private）与已桥接的 `authenticateServer`（`sand:mcp-auth`）。<br>**未实施** —— 需新桥契约 + 表单 + 提交流程，其中「选哪个宿主调用 / 参数形状 / `授权` 点下去做什么（含 OAuth 回跳 UX）」有设计判断，且要先反转那条守卫；无实机参照时盲写即臆造，待拍板 | EVIDENCE §29；实机重测：官方 9224 / 本地 9232；守卫位置见上 |
| ~~D17 验收基准~~ | ~~官方编辑表单「可见输入框 1→2（新账户标签常驻）」~~ **基准被推翻（2026-10-05 20:2x）** | 官方 `ve()` 逐字读出：账户行 children = `[展开态 ? <input BJ7R7v 重命名> : <span>文本 , button]`，`ve()` 全文**只有 1 个 `<input>`** 且仅在展开态渲染 ⇒ **未编辑时账户行一个输入框都没有**，正确基准是 **0→1**。「新账户标签」那个 input 属于**「添加其他账户」表单**（即 D19），与编辑表单无关、也不常驻。那个「1」是探针把整个文档的 input 都数了（市场弹窗底下浏览页的搜索框，本项目 L0 读数就是 `visibleInputs=1`）。<br>连带修掉两处按错基准写的东西：① 验收脚本头部基准说明；② 脚本里「详情页应有 ≥1 个可见输入框」的前置守卫 —— 按正确基准它会把**每次合法运行都判失败**，已改为检查「存在『编辑 … 账户』按钮」。<br>改后实机 **10/10 通过**。**若当初照 1→2 补一个「常驻输入框」，就是凭空造出官方不存在的界面** | EVIDENCE §29 |

## 3b. 「无遗漏」的穷尽核查（2026-10-04 补测）

目标要求「直到无遗漏页面为止」。除已实现的三层外，把详情页/管理页上**所有可点元素**
逐个在官方实机上按过，确认它们**不开新页面** —— 这几处因此保持惰性，是忠实而非遗漏：

| 元素 | 官方实测 | 结论 |
|------|---------|------|
| 详情页 `工具` 行（带 chevron 的 button） | 点击后盒子恒为 42px、恒 1 个子节点、弹窗 innerText 从不出现工具名（实测连续点击 3 次 + 真实指针事件） | **不展开**，无工具列表页 |
| 详情页 `添加其他账户` | ~~点击后弹窗文本无变化、无新对话框~~ **2026-10-05 20:4x 推翻：会展开新账户表单** | **原结论是错的**，错因同 D17 那次：取证时账户区处在**折叠态**，而官方要点了才展开。重测（折叠态自证 `编辑 default 账户` 在、输入框 0 个 → 点「添加其他账户」）：文本变为 `账户 default 已连接 授权 取消`，出现 `新账户标签` 输入（placeholder「为此账户添加标签，例如“工作”或“个人”」）与 `授权` / `取消` 两个按钮。**会展开表单** |
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
| 详情页 源码链接 | 真实 `<a href>` + `<a>` 内 13×13 外链图标（69×18） | 同结构，69×18 | ✅ D15 |
| 详情页 分享 | `[sand-kit-icon 18×18][label 28×20]` = 82×36 | 同结构，82×36 | ✅ D15 |
| 列表行尾 添加/连接 | 46×26 | 46×26（修复前 32×24） | ✅ D15 |
| 详情页 返回 | 28×28 | 28×28（修复前 36×28） | ✅ D15 |
| 详情页 信息区 | 功能/开发者/类别/网站/可用性 | 同 5 行 | ⚠️ 标签 ✅ / **值 ❌→已修** |
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
| 1 | 逐页复刻首页推荐内容，app 列表与原版完全一致 | ⚠️ **代码已完全对齐，残余为数据面 + 2 处待决策的差异** | **渲染规则逐条一致**：区块顺序、行数、`查看全部` 出现条件（>4 行）全部对齐。**条目级 9/12 共有区块逐行一致**（修复 `categoryKeys` 下发后由 6/14 → 8/12 → 9/12）。剩余 3 处：2 处仅差本地 catalog 少 11 条条目、1 处 `1Password` 不在任何一侧 catalog；另有 `为你推荐`：**唯一原因是部署侧 affinity 键经缺项映射表 `as` 间接**（`as` 缺 MCP/AGENT_ORCHESTRATION/FEATURED → 169/403 条键为空，而官方 0 条）。离线重放已闭合因果链：本地 8 条已装产生的亲和表使前 4 行并列 strength=3，**界面那 4 行是这段产物代码算出来的**。重建侧已修 `667018c`；**部署侧补丁待用户拍板**。见 D2；另有 **D18（图标未归一化，此前从未被测过）** |
| 1b | 支持继续向下翻页加载 | ✅ 达成 | 官方**无分页控件**（效率 63 行进单一滚动区 2202/652），故"继续向下翻"= 连续纵向滚动；未编造分页按钮 |
| 2a | 每个 app 卡片可点击跳转 | ✅ 达成 | 实机：类目页任一行 → 详情页 |
| 2b | 每个分类「查看全部」进入下一页列表 | ✅ 达成 | **9 个「查看全部」逐个实机点过**：精选页单列 734 + 包裹层 + `H1`；8 个桶页双列 363 + 无包裹层；**行宽/包裹层/无分页控件三项与官方 9 页全部一致**，行数 227 vs 官方 248 |
| 2c | 详情页支持详细介绍/查看源码/分享/添加 | ✅ **达成**（分享经实机验证与官方同为写剪贴板） | 描述 ✅、查看源码（真实 `<a href>`）✅、添加/卸载 ✅（一步动作，与官方同形）。**「添加到指定位置/分组」经实机取证在 0.66 中不存在该界面**——对 0 字段的 Ahrefs 与 8 字段的 Capital.com 点「添加」均无任何表单或选择器 |
| 3 | 递归复刻每层页面直到无遗漏 | ✅ 达成 | L0/L1a/L1b/L2/L1′ 全部打通并逐层返回验证；详情页/管理页**所有**可点元素逐个在官方按过（连点 3 次 + 真实指针序列），确认工具行**不开新页面**；⚠️ **「添加其他账户」这条已于 20:4x 被推翻 —— 它会展开新账户表单**（见 D19），原先据此落的 `assert.ok(!/addEventListener/)` 守卫前提是错的，待改 |
| 4 | 完整代码 + 路由清单 + 功能对应 + 差异清单 | ✅ 达成 | 本文件 + EVIDENCE；代码在 `frontend/src/extensions/marketplace/` |

### 未达成项的处理原则

条目级一致性（#1）没有 100% 达成，但**差异已全部归因，无一处靠猜**：

- 曾拟合出的两条「修正」（`AGENT_ORCHESTRATION→通信`、`canva`/`mailerlite` override）在读到
  上游真源后被证明**上游根本不存在**，已回退 / 降级为条件式补偿。
- 真正的差异成因（`categoryKeys` 多值数组未下发）已在宿主侧修复，**修复前后各测一次**，
  数字与结论都落库。
- 残余项全部是 catalog 条目数量差异，需后端补数据，代码侧已无可做。

### 验证强度（更正）

- typecheck / `source:typecheck` 干净；**884/884 测试通过**（含 5 条 2026-10-04 新增的 CTA 几何守卫；
  数字以最后一次全量 `npm test` 实测为准，早期版本记的 872/876 均已过期）
- **部署版 asar 的 101 个 renderer chunk 逐个 `node --check`，0 错误**（从 `/Applications`
  已部署字节抽出）。⚠️ asar 内 `.js` 总数是 209，但那是含 108 个 `node_modules` 与主进程
  bundle 的全量口径，**语法验证对象是 101**
- `codesign --verify --deep --strict` 通过
- glyph 渲染链在部署字节里闭环：`R("chevron-right", T.chevronDown, 10)` → `setProperty(
  "--cursor-icon-content", …)` → `.ui-1yj7g93:before{content:var(--cursor-icon-content)}`，
  且 CSS 中 `[data-icon-name…]` 规则 **0 条**，故 `content` 完全由码位决定
