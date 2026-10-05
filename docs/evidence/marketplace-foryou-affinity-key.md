# 「为你推荐」affinity 键 —— **已部署产物同样有缺陷**（2026-10-05 17:0x 二次纠正）

> ## ⚠️ 本文档 §一、§三、§六、§八 全部作废，以本文档正文为准
>
> 16:25 那次「纠正」说「0.18 部署产物的 affinity 键是 `entry.category` 标签，与官方同源，
> 部署侧不需要补丁」。**这个结论是错的，已撤回。**
>
> 错因：它按函数**名**反查，认为 `selectForYou` 压缩名是 `gs`、键函数是 `ge`。
> 实测部署 chunk 里 `affinityStrength` 的 4 次命中**全部落在 `ms` 内**，
> 而 `ge` 的真身是 `function ge(n){let e=n.marketplace; …}` —— marketplace/teamName 探针，
> 与 affinity 无关（`function ge(` 在 chunk 里有 **4 个同名定义**，按名字反查必然读错）。
>
> 撤回依据与正确机制见下文 §八。

## 结论（现行）

**两侧的 affinity 键语义不同，且部署侧会把条目吞掉。**

| | 官方 0.66 | 0.18 部署版 |
| --- | --- | --- |
| `selectForYou` | `te` @ `chunk-marketplace-browse-model-DoOY91TS.js` (12,928 B) | `ms` @ `index-UbX-y3il.js` (5,957,907 B) |
| 键函数 | `v(e,t){return j(e.category.trim(),t)}` | `vn(n)` → **标签数组** |
| 是否查表 | **否**，直接用标签 | **是**：`ts[pluginName]` 或 `as[cs({category})]` |
| 官方实机 403 条里键为空的 | **0** | **169**（`MCP` 151 / `Agent Orchestration` 17 / `Featured` 1） |

`as` 表只有 14 个键（`PRODUCTIVITY`、`DESIGN`、`SCHEDULING`…），**没有 `MCP`、
没有 `AGENT_ORCHESTRATION`、没有 `FEATURED`**。`cs()` 把 category 归一化成大写下划线形式
（`"MCP"` → `"MCP"`、`"Agent Orchestration"` → `"AGENT_ORCHESTRATION"`），这三类查表得
`undefined` → `vn` 返回空数组 → 该条目 `affinityStrength` 恒为 0 → 在
`filter(affinityStrength>0)` 那一关被筛掉，**结构性进不了 affinity 那两个名额**。

「为你推荐」与官方的差异是**两层叠加**：① 已安装集合不同（机器状态）；② 部署侧这个算法缺陷。

## 一、两段历史结论的处置

| 版本 | 结论 | 处置 |
| --- | --- | --- |
| 初版 | 部署侧按**首页分区桶**算 affinity，151 条结构性失格 | **数字对、机制错**。`151` 正是 `MCP` 类条目数；但部署侧走的不是分区桶表 `Le`，而是 category→标签映射表 `as`。两者都缺 `MCP`，所以后果相同 |
| 16:25「纠正」 | 部署侧与官方同源，不需要补丁 | **整体作废**，见 §八 |

## 二、实测的两侧字节（逐字读出，非转述）

官方 `chunk-marketplace-browse-model-DoOY91TS.js`：

```js
function v(e,t){return j(e.category.trim(),t)}
function J(e,t,n){const i=new Map;for(const o of e){if(!t(o))continue;const s=v(o,n);s.length!==0&&i.set(s,(i.get(s)??0)+1)}return i}
function ee(e,t,n,i){const o=v(e,i);return{entry:e,teammateCount:t.teamInstallCounts[e.id]??0,affinityStrength:o.length===0?0:n.get(o)??0}}
function te(e,t){const n=g(),i=new Intl.Collator(n),o=(r,c)=>i.compare(r.entry.displayName,c.entry.displayName),s=J(e.catalog,e.isInstalled,n),…}
```

**键是单个字符串**（标签本身），`J`（建表）与 `ee`（取值）用同一个 `v`，所以已装与候选被同一把
尺子量。`o.length===0` 只会因空标签触发 —— 实测 403 条**没有空标签**。

0.18 部署版 `index-UbX-y3il.js`：

```js
function ms(n,e,a){if(a<=0)return[];let t=n.filter(S=>S.isInstalled),s=new Map;
  for(let S of t)for(let y of vn(S.entry))s.set(y,(s.get(y)??0)+1);        // ← 键 = vn(entry)
  let o=[];for(let S of n){if(S.isInstalled)continue;let y=0;
  for(let w of vn(S.entry))y=Math.max(y,s.get(w)??0);                      // ← 跨标签取 max
  o.push({row:S,teammateCount:e[S.id]??0,affinityStrength:y})} …}

function vn(n){let e=!ds(n);
  for(let t of ps(n)){let s=ts[t];if(s!=null&&!(ss.has(t)&&!e))return s}    // 厂商覆盖表
  let a=[];for(let t of us(n)){let s=as[cs({category:t})];s!=null&&!a.includes(s)&&a.push(s)}  // 枚举表
  return a}

as={LOGIN_AND_CREDENTIAL_MANAGEMENT:"credentials",PRODUCTIVITY:"productivity",
    INBOX_AND_COLLABORATION:"communication",SCHEDULING:"communication",SALES:"sales",
    CUSTOMER_SUPPORT:"support",PAYMENTS:"finance",FINANCE_AND_LEGAL:"finance",
    DATA_ANALYTICS:"data",DESIGN:"design",CANVAS:"design",
    DOCUMENTS_AND_FILES:"productivity",INFRASTRUCTURE:"code",RESEARCH:"research"}

cs(n)=L(n.categoryKey||n.category).trim().toUpperCase().replace(/&/gu," AND ").replace(/[^A-Z0-9]+/gu,"_").replace(/^_+|_+$/gu,"")
ts={slack:["communication"],notion:["productivity"],"notion-workspace":["productivity"],
    linear:["productivity"],figma:["design"],tldraw:["design"],github:["code"],…}
ss=new Set(["canva","mailerlite"])
```

`vn` 返回的是**规范后的 category 标签数组**，不是首页分区桶 —— 这一点纠正了初版的措辞。
但它**经 `as` 查表**，而 `as` 缺三项，于是这 169 条拿不到任何键。

## 三、影响面量化（官方实机 403 条）

用上面逐字读出的 `as` / `ts` / `cs` / `us` / `ps` 重放 `vn`，数据取
`tests/fixtures/official-foryou-attribution.json` 的 403 条 catalog：

```
部署侧 affinity 键为空 : 169 / 403
  "MCP"                 : 151
  "Agent Orchestration" : 17
  "Featured"            : 1
靠厂商覆盖表 ts 拿到标签 : 14
靠 as 映射表拿到标签     : 220
官方侧键为空            :   0 / 403
```

可复现：`npm run marketplace:affinity:audit`（第二阶段还把本地 4 行重放出来对拍）

## 四、实机读数与因果链闭合

```
官方 9224  为你推荐: Agent Compatibility / Aikido / Aleph / Algolia Productivity
本地 9232  为你推荐: ActiveCampaign / Adobe Developer App Builder / AgentMail / Airtable
```

（各连跑两遍，逐字节一致。）

**这 4 行不是「退化为字母序」。** 16:25 那次这么解释过，但 `ms` 在 team 池与 affinity 池皆空时
返回空数组，产不出字母序回退 —— 那是从「读数看起来像字母序」倒推出来的，不是测出来的。

用产物里逐字读出的算法**离线重放**，精确复现（`npm run marketplace:affinity:audit` 第二阶段）：

```
本地判为已装 8 条: Canva, Figma, Gmail, Google Calendar, Google Drive, Granola, Notion, Slack
亲和表: productivity→3, design→2, communication→3, sales→1
team 池为空: true
affinity 池非空 105 / 395；前 4 行均并列在 strength=3，靠 localeCompare(name) 决胜
离线重放: ActiveCampaign / Adobe Developer App Builder / AgentMail / Airtable   ← 与界面逐项一致
```

三点此前被写错的地方，一并纠正：

1. **`effectivePlugins() = []` 是红鲱鱼。** 渲染器的 `isInstalled`（函数 `be`）是
   `s = e.find(o=>L(o.name).split(":")[0]===t) ?? e.find(o=>K(ke(L(o.name)))===K(t))`，
   `t = L(n.displayName)||L(n.name)` —— 拿 **server 列表**匹配，与 `effectivePlugins` 无关。
   本地 8 条 server 照样把 8 个条目判为已装。
2. **「字母序」是决胜结果，不是回退。** 前 4 行 `affinityStrength` 全是 3（并列），
   才落到 `localeCompare(name)`。看起来像字母序是巧合的表象。
3. **两层叠加现在都有机制了。** 官方那 4 个赢家的 `category` 全是 `MCP`（实测四取四），
   而部署侧 `MCP` 类共 151 条键为空 → **结构性不可选**；于是本地改从
   `communication` / `productivity` 里挑并列第一的 4 条。

## 五、为什么这么久没被发现

- 官方与本地渲染出的 4 行**看起来都像字母序**，很容易被读成巧合。
- 整站 parity 逐区块比对是绿的，`为你推荐` 区块一直被记为「数据面差异」。
- 关键的赢家全是 `MCP` 类，又恰好都没装，在任何「已装清单」视图里都不显眼。
- 16:25 的「纠正」又给了一层虚假安心：它给出了一个**具体符号名**（`gs`/`ge`）和
  一张「两侧输出逐字相同」的表，而那两张表都不是从产物读出来的。

## 六、部署侧：**需要补丁**（结论已改回）

要给 checksum 钉死的上游 chunk 打 affinity 补丁。改的是 `ms` 里 `vn` 的取值路径：
让它在没有 `as` 映射时回落到 `category` 归一后的标签本身，与官方 `v` 同形。

**本轮未执行** —— 改 checksum 钉死的产物要单独一轮完整回归，且属产品行为变更，需用户拍板。

可读重建侧（`frontend/`）的修复 `667018c` **保留且仍然必要**，但要改一处措辞：
它修的是 `bucketsOf()`（首页分区桶表 `Le` 同样缺 `MCP`），机制与部署侧的 `as` 缺项**不同源**，
不能写成「部署侧带同一个 bug」。

## 七、守卫

`tests/marketplace-foryou-affinity.test.mjs`（6 条）+ 夹具
`tests/fixtures/official-foryou-attribution.json`：

1. 用官方 catalog + 官方已装名单 → 必须复现官方那 4 行
2. 那 4 个赢家必须落不到任何桶
3. 最小判别：同 category 标签、都落不到桶的两条，必须互相给 affinity
4. 反向判别：同桶但不同 category 标签的两条，**不应**互相给 affinity
5. `selectForYou` 函数体内不得再出现 `bucketsOf`
6. 上限仍是 4

`scripts/verify-marketplace-parity.mjs` 里另有一个**部署侧**检测：按 `affinityStrength`
定位 `selectForYou`，再按调用点偏移定位键函数（并强制唯一性校验），判定
**键是否经映射表间接**。⚠️ 判据不是「有没有 `for..of`」—— `vn` 体内那两个 `for..of`
遍历的是 plugin 名 token 与 category token，都不是桶，拿「有没有遍历」当判据会对
正确实现也误判。

## 八、2026-10-05 二次纠正：16:25 那次错在哪

### 错因：按函数名反查 minified 符号

16:25 的复核称「`function ms(n,e,a){` 在 5.9 MB 的 chunk 里**一次都没有**」，
「`affinityStrength` 只出现 4 次，全部落在 `gs` 内」，「键函数是 `ge(entry)` → `A(n.category).trim()`」。

实测（`node scripts/audit-deployed-affinity-key.mjs` 可复现）：

| 断言 | 实测 |
| --- | --- |
| `function ms(n,e,a){` 不存在 | **存在，恰好 1 次，809 字节** |
| 4 次 `affinityStrength` 全在 `gs` 内 | 4 次偏移 5854338 / 5854511 / 5854545 / 5854564，**最近具名函数全是 `ms`** |
| 键函数是 `ge` | `ge` 定义 **4 次**；按名字反查读到的是 `function ge(n){let e=n.marketplace; …}` —— teamName 探针 |
| chunk 大小 5,939,561 B | 当前 5,957,907 B；重打包前留存的副本 5,939,528 B（`ms` 区域偏移与当前**完全相同**） |

最后一行顺带排除了一个可疑解释：**不是我的重打包换了压缩名**。重打包前后该区域字节一致。

### 方法上缺的那一环

正确做法是**按产物里必然存在的稳定串定位**（`affinityStrength` 是 esbuild 保留的对象属性名），
再**按调用点在函数体内的偏移**定位被调用的键函数。16:25 跳过了第二步，直接按名字找 ——
而 minified 短名重名是常态（`ge` 4 个、`A` 15 个、`ds` 2 个）。

配套的教训已扩写进抽取器：切片边界必须落在**函数自己的** `{` 上。
本轮第一次抽取官方 `te` 时，从 `affinityStrength` 字面量处开始深度扫描，读出的是
`ee` 的尾巴 + 整个 `te`（官方 799 字节被读成 938），部署侧同样被截断（658 vs 809）。
修法是先在合成夹具上自检抽取器（7/7 通过，含「不得吞掉相邻函数」用例），再用它读产物。

### 教训

- **minified 产物里不能用函数名当锚点**，也不能用「我记得它长什么样」当锚点。
  定位链必须是：稳定串 → 所在的函数 → 该函数体内的**调用点偏移** → 被调函数的声明（且唯一）。
- **否定结论（「搜不到」）比肯定结论更危险**：搜不到时该做的是换定位方式，不是据此否定存在性。
  16:25 用「搜不到 `ms`」推翻了三条真实观察。
- **一份「纠正」文档必须能被新一轮复核推翻**。本节就是为此保留的：下次若再有人给出
  「部署侧无缺陷」的结论，请从这里开始，而不是从结论开始。
