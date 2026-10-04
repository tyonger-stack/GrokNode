## 为你推荐 (FORYOU) 的真实规则 —— 来自官方产物真源

**这不是观察拟合。** 下面是官方 0.66.0 产物里那个 12,928 字节的 chunk 全文读出来的实现，
路径 `dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js`（导出符号 `te`，在 view chunk 里被
`g as rd` 引入，调用处紧跟着 `y({id:"GcibpE"})` 即「为你推荐」标题）。

### 实测对拍（两个 app 同时在跑，各自 bridge 入口）

| 分组 | 官方 0.66.0 | 本地 |
| --- | --- | --- |
| **为你推荐** | Agent Compatibility / Aikido / Aleph / Algolia | ActiveCampaign / Adobe Developer App Builder / AgentMail / Airtable |
| 精选插件 | Gmail / Google Calendar / Google Drive / Granola | **逐条一致** |
| 团队插件 | Ooh-my-claudecode | 空（你批准留空） |
| 登录与凭据管理 | 1Password | **整组缺失** |
| 效率 通信 设计 代码 数据 销售 财务 研究 支持（9 组） | — | **逐条一致** |

9 个分类组和精选插件都对得上。**只有「为你推荐」的成员完全不同，且零交集。**

### 官方规则（逐字转写，含排序细节）

```js
const R = { team: 0, affinity: 1 }, Q = .5;      // 信号优先级：team 排在 affinity 前
const q = 4;                                       // FOR_YOU_ROW_LIMIT

function te({ catalog, isInstalled, teamInstallCounts }, limit) {
  const collator = new Intl.Collator(locale);
  const byName = (a, b) => collator.compare(a.entry.displayName, b.entry.displayName);

  // affinity 表：按 category 统计【已安装】条目的数量
  const affinityByCategory = J(catalog, isInstalled, locale);   // J 里是 if(!isInstalled(o)) continue

  const pool = catalog.filter((r) => !isInstalled(r)).map((r) => ({
    entry: r,
    teammateCount: teamInstallCounts[r.id] ?? 0,
    affinityStrength: r.category.trim().length === 0 ? 0 : (affinityByCategory.get(collated(r.category)) ?? 0),
  }));

  const team      = pool.filter((r) => r.teammateCount > 0)
    .sort((a, b) => b.teammateCount - a.teammateCount || byName(a, b));
  const affinity  = pool.filter((r) => r.affinityStrength > 0)
    .sort((a, b) => b.affinityStrength - a.affinityStrength || b.teammateCount - a.teammateCount || byName(a, b));

  const seen = new Set(), out = [];
  const take = (r, signal) => { if (!seen.has(r.entry.id) && out.length < limit) { seen.add(r.entry.id); out.push({ entry: r.entry, signal }); } };

  const teamQuota = Math.max(1, Math.floor(limit * Q));   // 4 * 0.5 = 2
  for (const r of team.slice(0, teamQuota)) take(r, { kind: "team", teammateCount: r.teammateCount });
  for (const r of affinity)                                 take(r, { kind: "affinity" });
  for (const r of team)                                     take(r, { kind: "team", teammateCount: r.teammateCount });

  return out.sort((a, b) => R[a.signal.kind] - R[b.signal.kind]);
}
```

要点：

1. **它是个性化的，不是固定榜。** affinity = 「你已安装的插件里有多少个属于同一 category」。
   所以两个账号装的东西不同，这一行本来就不同——**这部分差异不是 bug**。
2. **team 席位** = `floor(4 × 0.5) = 2`，按团队安装人数取前 2；取不满就用 affinity 补。
3. 同分时一律按 `Intl.Collator(locale)` 比 `displayName`，这就是两边看起来都「字母序」的原因。
4. 最终 `sort` 只按 signal 种类，**team(0) 一定排在 affinity(1) 前面**；同种类内保持上面的插入顺序。

### ⚠️ 这与先前批准的规则冲突

先前你批准的本地规则是「`category=Featured` 未安装前 4 条」。官方**不是** Featured：
它取的是 team 安装数 + affinity（已安装同类目的数量），完全不看 `FEATURED`。
官方 `E` 表里 `FEATURED` 确实存在（`FkMol5`），但那是**「精选插件」那一组**用的
（`k = "category:featured"`，对应 `homepagePluginItems`），与「为你推荐」是两条独立路径。

我没有擅自改这条已批准的规则——它需要你定夺。

### 另一个未解项：登录与凭据管理

官方有这一组（1Password），本地整组缺失。本地 `CATALOG_CATEGORY_TO_BUCKET` 的 14 条与官方 `Le`
**逐条同序同值**，所以不是映射表的问题。实测两个 app 的 `catalog()` 返回里
**都没有任何 `categoryKey === "LOGIN_AND_CREDENTIAL_MANAGEMENT"` 的条目，也都没有 1Password**。
官方另有 `financeOverview` / `deleteFinanceConnection` / `startFinanceLink` 等本地没有的 bridge 方法。
结论：这一组的条目**不来自 `desktop.mcp.catalog()`**，来源尚未定位，**不猜**。

### 仍存疑 / 未取证

- `te` 依赖的 `isInstalled` 在官方侧是复合函数
  （`const G = p(F); if (G != null) return G; const W = Ls(F, r, l, c); return k ? mi(W) : W.isInstalled`），
  本地等价实现是否逐分支一致，**没有**逐条取证。
- `teamInstallCounts` 的来源在官方 bridge 上叫 `teamPopularity`，但两边都返回**空对象**，
  所以当前这次 team 席位实际是空的，走的是 affinity 分支。
- 「登录与凭据管理」的真正数据源（见上）。
