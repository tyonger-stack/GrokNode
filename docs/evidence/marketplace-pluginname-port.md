# `pluginName` 移植 —— 官方 view 有、我们投影器丢掉的字段（2026-10-05）

## 结论

官方 0.66 的 catalog view 带一条我们**完全没有**的字段：`pluginName`（插件自己的 name）。
渲染层的 vendor 覆盖探针是**先读 `pluginName`、再读 `name`**，所以这不是装饰性字段 ——
它是 `Re()` = `Te[vendor] ?? …` 里 `Te` 的查表键。之前它被列进测试的 `BRIDGE_ONLY`
豁免名单，于是「投影器不产出它」这件事被一条绿测试盖住了。

已移植，并从两个方向独立验证。

## 一、字段存在的证据

### 1. 官方运行时（已登录官方 app，CDP 9224，两跑逐字节相同）

| 读数 | 值 |
| --- | --- |
| catalog 总数 | 403 |
| 带非空 `pluginName` 的行 | **403 / 403** |
| `pluginName !== name` 的行 | **85** |

`pluginName` 与 `name` 不同的样本（两字段都不是对方的副本）：

```
aave            → aave-mcp
adapter         → adapter-mind
aikido          → aikido-cursor-plugin
airwallex-dev   → airwallex-agentos
algolia         → algolia-productivity
aws-mcp         → amazon-location-service
aws-mcp         → aws-amplify
aws-mcp         → aws-core
aws-mcp         → sagemaker-ai
```

AWS 那一族是关键证人：**四条行的 `name` 全是 `"aws-mcp"`**（它们共用同一个 MCP server 句柄），
而 `pluginName` 四条各不相同。所以 `pluginName` 不可能派生自 `mcpServers[0].name`。

### 2. 官方产物（读字节，不读散文）

`/Applications/Grok Bot.app/Contents/Resources/app.asar` → `dist/electron-main/main-app.cjs`

产生端（`toPlugin` 等价物）：

```js
// r = e.mcpServers[0]?.name ?? e.name
return{pluginId:e.id.toString(), name:r, pluginName:e.name, displayName:…}
```

传递端（`marketplacePluginToView`，导出符号 `T7t`）：

```js
function T7t(e){return{id:e.pluginId, name:e.name, pluginName:e.pluginName, displayName:e.displayName, …}}
```

**所以 `pluginName` 取的是 `Plugin.name` 本身，不是推导值。** 这一条是移植的唯一依据 ——
不需要从数据分布反推规则。

## 二、影响面：为什么之前看不出来

把「补上 `pluginName` 会不会改变分区归属」算了一遍（拿官方 403 行的真实 token 序列，
喂本地那张 18 键的 `VENDOR_BUCKET_OVERRIDES` 表）：

```
会改变命中键的行数 = 2
  id=406   name=context7  pluginName=context7-plugin   本地命中 context7
  id=404   name=notion    pluginName=notion-workspace  本地命中 notion
```

**两条命中的键不同，但分到同一个桶**（`context7` 与 `context7-plugin` 都是 `["research"]`；
`notion` 与 `notion-workspace` 都是 `["productivity"]`）。本地表里这两个别名成对存在，
所以差异在渲染上完全不可见 —— 这正是为什么整站 parity 一直是绿的，而字段其实丢了。

**这是一个潜伏缺口，不是无影响：** 表里那两个别名是巧合般地齐全。一旦官方 `Te` 表新增一个
只以真实 `pluginName` 为键的条目，本地就会静默失配，而没有任何测试会响。

## 三、改动

| 位置 | 改动 |
| --- | --- |
| `SandMarketplacePlugin` | 新增必填 `pluginName: string` |
| `toPlugin` | `pluginName: plugin.name`（**不是** `mcpServers[0]?.name ?? plugin.name`） |
| `marketplacePluginToView` | 带出 `pluginName: plugin.pluginName` |
| `local-catalog-supplements.ts` | 11 条钉入条目按官方 capture 逐条补该字段 |
| `tests/local-catalog-supplements.test.mjs` | `pluginName` 从 `BRIDGE_ONLY` 豁免名单里**拿掉** |

### 顺带删掉一个陷阱

`tests/local-catalog-supplements.test.mjs` 里的 `OFFICIAL_BRIDGE_ONLY_KEYS` 常量
**声明后从未被使用**，而它的注释声称能让 shape 变化「响亮失败」。它提供不了任何保证 ——
一份看起来在防护、实际没接线的清单比没有更糟。已删除。

## 四、验证

### 4.1 守卫（`tests/local-catalog-supplements.test.mjs`，6 → 8 条）

- `view.pluginName` 必须逐条等于官方 capture，且是 string
- **`oh-my-claudecode` 作证**：它的 `name` 是字面量 `"t"`（MCP server 句柄），
  `pluginName` 是 `oh-my-claudecode` —— 两者确实不同，所以「pluginName 就是 name 的副本」
  这条偷懒实现会被抓住
- 探针顺序 `[entry.pluginName, entry.name]` 就地钉在 `model.ts` 的消费点
- `toPlugin` 字段选择的源码绊线 `pluginName: plugin.name,` +
  `doesNotMatch(/pluginName: plugin\.mcpServers/)`

**为什么这里有一处源码断言**：`toPlugin` 是模块私有、藏在网络客户端后面，注入式流程测试拿到的
已经是投影后的形状，不接真服务器就无法观测它取哪个字段。源码断言的正当性在于它两侧都有兜底 ——
落地的值有运行时断言（下面 4.2），产物有实机对拍（4.3）。

### 4.2 运行时证据（不部署，直接打真服务器）

`fetchMarketplaceMcpPlugins` 是导出的，内部就调 `toPlugin`。用 esbuild 把它构出来，
在 Node 里以 localOnly 形态（`getAccessToken` 拿不到 token）请求真实 marketplace API：

```
plugins=392 views=392
带非空 pluginName = 392/392
pluginName !== name = 84
includesPrivateMarketplaces = false
```

与官方 403 做集合差：

```
官方 = 403   本地匿名 = 392   钉入 = 11   本地合计 = 403
官方有、本地匿名没有 = 11 条   == 钉入的 11 条 ?  true
本地匿名有、官方没有 = 0 条
name 不一致 = 0
pluginName 不一致 = 0
本地缺 pluginName 的条目 = 0
```

**逐条 `pluginName` 零不一致。** 85 与 84 的差恰好是 `oh-my-claudecode`（私有市场条目，
匿名 listing 里没有，由钉入条目补上）—— 这是算出来的，不是假设的。

### 4.3 部署后对拍

见 `docs/MARKETPLACE-066-PORT.md` §3 的差异清单更新行。

## 五、变异验证

7 个生产代码变异全部被拦下，基线与复原均绿，脚本先注入一个必然失败的断言确认退出码真的是 1
（否则「全部守卫生效」和「一个都测不出来」在输出上长得一模一样）：

| 变异 | 结果 | 期望打中的守卫 |
| --- | --- | --- |
| view 投影丢掉 `pluginName` | ✓ 变红 | deepEqual + pluginName 用例 |
| `toPlugin` 改取 MCP server 句柄 | ✓ 变红 | `doesNotMatch` 守卫 |
| omc 的 `pluginName` 写成 `"t"` | ✓ 变红 | pluginName 用例 |
| omc 直接删掉 `pluginName` | ✓ 变红 | pluginName 用例 |
| google-slides 串到 google-sheets | ✓ 变红 | deepEqual + pluginName 用例 |
| 探针顺序反了 | ✓ 变红 | 探针顺序断言 |
| x-money 写成 displayName | ✓ 变红 | pluginName 用例 |

**值得单独记的一条**：把 `pluginName` 写成 `name` 的副本（变异 2 / 3）能通过全部渲染断言、
全部类型检查、全部 bundle —— 11 条里有 10 条两个字段恰好相等，只有第 11 条能分辨。

## 六、仍未处理 / 与本次无关

- `isPublicListed` 仍在 `BRIDGE_ONLY` 里。官方 403 条全为 `true`，本地不产出该键。
  渲染层目前不读它，所以是无害差异；**未取证它是否被任何判定使用**，故未移植。
- `preload.getStatus()` 仍返回假的 `logged-in` / `Local`（与主进程无 token 矛盾）。
  修它会改变大量按 `account.kind` 分支的 UI 行为，属于需要先给方案的改动。
