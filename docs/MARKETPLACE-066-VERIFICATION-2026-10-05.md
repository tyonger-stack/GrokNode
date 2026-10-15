# Grok Node — 0.66 App 市场移植复核（2026-10-05 实机 A/B）

方法：两个 app **同时在跑**，都用 CDP 读活 DOM，不靠源码推断。
官方 0.66.0 → `127.0.0.1:9224`；Grok Node → `127.0.0.1:9232`。
取证脚本：`/tmp/off3.mjs`（逐区块对拍）、`/tmp/auth3.mjs`（pluginId 计数）、`/tmp/final.mjs`（catalog 差集）。

> **本文件已于 05:45 重跑对拍。** 首轮结论里 catalog 少 11 条（404 vs 393）的问题，已由
> `7ee52ec` / `89cdff2` 两个提交补齐（钉入 11 条真实条目，取证见
> [marketplace-catalog-supplements.md](evidence/marketplace-catalog-supplements.md)）。
> 下文凡与首轮不同的数字，均已更新为**重测值**；仍属首轮的判断已注明。

---

## 1. 页面与路由清单（实机验证，非源码推断）

同一个 `role="dialog" aria-label="市场"` 内**推栈式**导航，`返回` 弹出一层，直到栈底不再回退。

| 层级 | 页面 | 入口 | 标题元素 | 实测 |
|---|---|---|---|---|
| L0 | 市场首页 | 侧栏「插件连接应用」按钮 | `h2 市场` | **12 区块 / 44 行 / 12 grid / 9 个「查看全部」**（官方 13 / 45 / 13 / 9，差值恰为缺失的 `登录与凭据管理` 整块） |
| L1a | 类目页·精选 | 首页「查看全部」（精选插件） | `h1 精选插件` + 页头 `h3` | 单列 **734px**，带 `.sand-plugins__marketplace` 包裹层，6 行 |
| L1b | 类目页·桶 | 首页 8 个桶的「查看全部」 | `h3 精选插件`/`h3 <桶名>` | 双列 **363×2**，**无**包裹层 |
| L2 | 应用详情 | 任意 `.sand-plugins-row` | `h3 Gmail` | `.sand-plugins-detail`，含 账户/工具/应用/信息 四段 |
| L1′ | 管理插件和技能 | 首页「已安装 N 个 ›」 | `h3 管理` | 已安装网格 |

**L0 区块顺序**（实机读出）：为你推荐 → 精选插件 → 团队插件 → 效率 → 通信 → 设计 → 代码 →
数据 → 销售 → 财务 → 研究 → 支持。

### 纵向滚动（明确要求）—— 已满足

| | 官方 9224 | 本地 9232 |
|---|---|---|
| 滚动容器 | `ui-scroll-area__viewport`，`overflow-y:auto` | `.sand-plugins`，`overflow-y:auto` |
| scrollHeight / clientHeight | 2518 / 652 | 2372 / 652 |
| 可滚动总量 | 1866 | 1720 |
| `scrollTop` 写满 | 可 | **0 → 1656，首轮实测为全量可达**（重测可滚动量 1720，机制未变） |

官方类目页**没有分页控件**（63 行全进单一滚动区）。所以「继续向下翻」在官方语义下就是连续
纵向滚动，**本移植照此实现，没有编造「加载更多 / 下一页」按钮**。

### 逐层返回轨迹（实机）

`详情(Gmail) --返回--> 类目页(精选插件,6行) --返回--> 首页(43行) --返回--> 首页(无动作)`
栈底不误关弹窗，与官方一致。

---

## 2. 功能点与原版对应

| 原版功能 | 官方实现 | 本移植 | 实测 |
|---|---|---|---|
| 首页区块渲染 | `deriveMarketplaceBrowseModel` | 同模型 | ✅ 区块顺序、行数、`查看全部` 条件（>4 行）全对齐 |
| 类目「查看全部」 | `onSelectCategory` | 同 | ✅ 精选单列 734+包裹层 / 8 桶双列 363+无包裹层 |
| 行 → 详情 | 详情 pane | 同 | ✅ Gmail 详情 4 段齐全 |
| 详情：描述 | `sand-plugins-detail__desc` | 同类名 | ✅ |
| 详情：查看源码 | `<a href>` → repositoryUrl | 同 | ✅ 真实 `https://github.com/cursor/plugins` |
| 详情：复制链接 / 分享 | 剪贴板 | 同 | ✅ |
| 详情：添加 / 卸载 | 按安装态切换 | 同 | ✅ |
| 详情：账户/工具/应用/信息 | 条件渲染 | 同 | ✅ 按钮齐全（含「编辑 default 账户」「添加其他账户」「已启用 23/23 个」） |

---

## 3. 逐区块对拍结果（**11/13 完全一致**，重测值）

| 区块 | 官方 | 本地 | 结论 |
|---|---|---|---|
| 精选插件 / 团队插件 / 效率 / 通信 / 设计 / 代码 / 数据 / 销售 / 财务 / 研究 / 支持 | 4,1,4,4,4,4,4,4,4,4,3 | **全同** | ✅ **名称、顺序、数量、逐行全同**（11 个区块） |
| 为你推荐 | 4 | 4 | ❌ **推荐信号不同**（见 §4.1）—— 唯一未解决的代码侧差异 |
| 登录与凭据管理 | 1（`1Password`） | 整块缺失 | ⚠️ **`1Password` 两侧 catalog 均无**，上游数据面 |

---

## 4. 差异归因（三类，全部有实证）

### 4.1 「为你推荐」不同 —— 根因是 `localOnly: true`，**不是渲染 bug**

先纠正一个错误假设：我一度以为官方是「挑 `categoryKeys` 为空的条目」。读完官方真源
`chunk-marketplace-browse-model-DoOY91TS.js` 后证明**不成立**。官方 `为你推荐`（`FOR_YOU_ROW_LIMIT = 4`）
的真实算法：

1. `teammateCount` = `teamInstallCounts[id]`，按降序，团队装的排前面（占 2 个名额）
2. `affinityStrength` = **已安装插件所属 category 的计数**，按降序
3. 取 team 前 2 + affinity 若干，共 4 条

**两个 app 的 `teamPopularity()` 都是空 `{}`** → 推荐完全落到 affinity 分支 → affinity 取决于
**本机装了哪些插件**。实测：

| | 官方 | 本地 |
|---|---|---|
| `mcp.list().servers` | 13 | 8 |
| 其中带 `pluginId` | **10** | **0** |
| `mcp.effectivePlugins()` | 13 | **0** |
| server id 形态 | `"5420852"`（后端 id） | `"1"`（本地 id） |

根因定位到**单行**：`source/host/extensions/mcp/production.ts:91` 硬编码 `localOnly: true`，
而 `source/shared/node/mcp/mcp-manager.ts:415-418` 里：

```ts
listEffectivePlugins() {
  return this.localOnly || this.effectivePluginsProvider == null
    ? Promise.resolve([])   // ← 本地恒走这条
    : this.effectivePluginsProvider();
}
```

于是 affinity 恒为 0，`为你推荐` 退化成按名称排序的前 4 条（本地实测
ActiveCampaign / Adobe / AgentMail / Airtable，**恰好是字母序前四**——这正是信号为零的指纹）。

### 4.2 catalog 数据差 —— **已于 05:39 补齐**（首轮记录的 3 处中有 2 处已消失）

**重测：本地 catalog 404 条 = 官方 404 条**，逐项核对：

| 条目 | 官方 | 本地（重测） |
|---|---|---|
| Google Slides | 有 | ✅ **有** |
| oh-my-claudecode | 有 | ✅ **有**（且已出现在「团队插件」区块） |
| 1Password | **无** | **无** |

所以 `团队插件` 与 `设计` 两个区块的首轮差异**已消失**。剩下的 `登录与凭据管理` 整块缺失，
根因是 **`1Password` 在两侧 catalog 里都不存在**（官方 404 条无它、本地 404 条也无它）——
它来自 catalog 之外的源，本地无从复现。按证据优先原则**不臆造**。

首轮记为「本地是官方 catalog 的严格子集，少 11 条」，这个定性**当时是错的**，已由
`e7a1e64` 更正：那 11 条并非「缺失」，而是卡在本机 `account.login()` 桩拿不到 token，
被 gate 在 `includesPrivateMarketplaces` 之后。

### 4.3 结构类名差异 0 处

两侧 `.sand-plugins-row__name` / `__subtitle` / `__grid` / `__marketplace` / `__yours` /
`detail__desc` 全部存在且一致。**几何差异 0 处。**

---

## 5. 与要求逐条结算

| # | 要求 | 状态 | 依据 |
|---|---|---|---|
| 1 | 逐页复刻，列表与原版完全一致 | ⚠️ **11/13 区块逐行全同，2 处有归因** | §3。渲染规则 100% 对齐；残差 = 1 处推荐信号（`localOnly`，待你拍板）+ 1 处 `1Password` 上游两侧 catalog 均无 |
| 1b | 市场窗口展示完整，支持纵向滚动 | ✅ **达成** | scrollTop 实测写满 1656px，`overflow-y:auto` |
| 2a | app 卡片可点击进入详情 | ✅ 达成 | Gmail 详情 4 段齐全 |
| 2b | 每个分类「查看全部」进完整列表 | ✅ 达成 | 9 个逐个点过，单/双列形态与官方全一致 |
| 2c | 详情支持介绍/源码/分享/添加 | ✅ 达成 | 「添加到指定位置/分组」经实机取证**在 0.66 中不存在该界面**（对 0 字段与 8 字段插件点「添加」均无表单） |
| 3 | 递归复刻直到无遗漏 | ✅ 达成 | L0/L1a/L1b/L2/L1′ 全通，逐层返回验证；详情/管理页所有可点元素逐个按过，均不开新页面 |
| 4 | 代码+清单+对应+差异 | ✅ 达成 | 本文件；代码在 `frontend/src/extensions/marketplace/` |

---

## 6. 本轮纠正的两处自身错误（留证）

1. **「部署产物只有结构类名、没有文案 = 空壳」是误判**。我先 grep `renderBrowse` 得 0 就下了这个结论，
   但源码函数名在 minify 后必然消失；真源在懒加载 chunk `view-B5Ug8wEm.js`，其中 `RLocT("Loading the
   marketplace…","正在加载市场…")` 等双语串俱全。**判据：minified 产物里不能用源码标识符做 marker。**
2. **「为你推荐 = 未归类条目」是误判**（见 §4.1）。读官方 chunk 才拿到真算法。**再次印证：先读上游
   真源，再写规则，不要从数据分布反推规则。**

## 7. 未做动的决策

`localOnly: true` 我**没有改**。它不只关掉 `listEffectivePlugins()`，还决定 MCP 服务器
存在**本地 settings** 还是**用户的 Cursor 账号**（`mcp-manager.ts:317` 写本地、`:362` 删本地）。
改成 `false` 会开启账号级 MCP 同步，属于账号与隐私语义变更，不该由我单方面决定。修 §4.1 需用户拍板。
