# 「为你推荐」affinity 键错误 —— 重建与**已部署产物**都中招（2026-10-05）

## 结论

官方 0.66 的 `selectForYou`（`te`）按**条目自己的 `category` 标签**算 affinity。
0.18 —— 以及本仓库的可读重建 —— 按**解析后的分区桶**算。

桶表 `Le` 没有 `MCP` 的映射，也没有 `AGENT_ORCHESTRATION`。所以这两类条目
（实机 403 条里 **151 条**）的 `affinityStrength` 恒为 0，**结构上永远进不了「为你推荐」**。

**两条线都受影响：**

1. 可读重建 `frontend/src/extensions/marketplace/model.ts` —— **已修**（`selectForYou` 改用
   `categoryAffinityKey`），守卫 6 条 + 5/5 变异全红。
2. **已部署的 `/Applications/Grok Node.app`** —— 渲染器是 0.18 的上游 chunk，
   它自带的 `ms`（即 `selectForYou`）**带着同一个 bug**，而本轮修复不改变部署产物
   （`frontend/` 不进 asar）。要修部署侧必须给被 checksum 钉死的上游 chunk 打补丁，
   **属需要先定方案的改动，未执行**。

## 一、怎么坐实的：一个 2×2 交叉实验

先把两侧的已装信号摸清（这一步本身就纠正了一个错误前提）：

| | 本地 | 官方 |
| --- | --- | --- |
| 界面显示 | 已安装 8 个 | 已安装 16 个 |
| `mcp.list()` | 8 条 | 13 条 |
| `effectivePlugins()` | **[]（空数组）** | 13 条，带真实 `pluginId` |
| `teamPopularity()` | 0 | 0 |
| 管理页行数 | — | 28（**前 16 条 = 已装**，后 12 条是私有技能/Bot） |

用仓库里真实的 `buildMarketplaceModel` 跑交叉组合，`catalog` 与「已装集合」交叉：

```
修复前  A) 官方已装(16) + 官方 catalog → ActiveCampaign / AgentMail / Ando / Bird     ✗
        B) 官方已装(16) + 本地 catalog → 同上                                          ✗
        C) 本地已装(8)  + 本地 catalog → ActiveCampaign / Adobe… / AgentMail / Airtable ✓
        D) 本地已装(8)  + 官方 catalog → 同上                                          ✓

修复后  A) 官方已装(16) + 任一 catalog → Agent Compatibility / Aikido / Aleph / Algolia Productivity ✓
```

A≡B、C≡D 说明 **catalog 来自哪个 app 完全不影响输出**；变的只有已装集合。
而修复后 A 精确复现了官方实际渲染的那 4 行。

## 二、为什么桶版「不可能」选中官方那 4 个

逐条查它们的分区归属：

```
官方 forYou 赢家   categoryKey        我们模型下的分区
Agent Compatibility  undefined        (不在任何分区)
Aikido               undefined        (不在任何分区)
Aleph                undefined        (不在任何分区)
Algolia Productivity undefined        (不在任何分区)
```

四条全落不到任何桶 → 桶版的 `affinityStrength` 全是 0 → 在
`o.filter(S=>S.affinityStrength>0)` 那一关就被筛掉了。
**桶版不是「算错」，是根本选不到它们。** 详情页也确认它们的渲染类别就是 `MCP`。

按 category 标签算出来的 affinity 表正好对上：

```
"Featured" → 6      （Gmail / Google Calendar / Google Drive / Granola / Notion / Slack）
"MCP"      → 5      （oh-my-claudecode / Finance / Cursor Team Kit / Cursor SDK / pstack）
"Productivity" → 1  "Design" → 1  "Scheduling" → 1
```

`MCP` 权重 5，于是同为 `MCP` 的未装条目按名称取前 4 —— 就是官方那 4 个。

## 三、0.18 上游 chunk 里那段代码（已部署产物原文）

`/Applications/Grok Node.app/Contents/Resources/app.asar` →
`dist/renderer/assets/index-UbX-y3il.js`，`ms` = 该版本的 `selectForYou`：

```js
function ms(n,e,a){
  if(a<=0)return[];
  let t=n.filter(S=>S.isInstalled), s=new Map;
  for(let S of t) for(let y of vn(S.entry)) s.set(y,(s.get(y)??0)+1);   // ← affinity 表按【桶】
  let o=[];
  for(let S of n){
    if(S.isInstalled)continue;
    let y=0;
    for(let w of vn(S.entry)) y=Math.max(y,s.get(w)??0);               // ← 多桶取最大
    o.push({row:S, teammateCount:e[S.id]??0, affinityStrength:y});
  }
  let l=(S,y)=>S.row.name.localeCompare(y.row.name),
      r=o.filter(S=>S.teammateCount>0).sort((S,y)=>y.teammateCount-S.teammateCount||l(S,y)),
      u=o.filter(S=>S.affinityStrength>0).sort((S,y)=>y.affinityStrength-S.affinityStrength||y.teammateCount-S.teammateCount||l(S,y)),
      k=new Set, m=[], f=S=>{k.has(S.row.id)||m.length===a||(k.add(S.row.id),m.push(S))},
      A=Math.max(1,Math.floor(a*Zt));
  for(let S of r.slice(0,A))f(S);
  for(let S of u)f(S);
  for(let S of r)f(S);
  return m.sort((S,y)=>Ee(S)-Ee(y)).map(S=>S.row)
}
```

`vn(entry)` 与构建 `categoryGroups` 用的是**同一个桶解析函数**，所以 affinity 与首页分区
被绑死在同一套映射上 —— 这正是错的地方。

**除 affinity 键之外，其余与官方 `te` 逐项一致**：team 配额
`max(1, floor(limit*0.5))`、先 team 后 affinity 再补 team、末尾按 signal 种类排序、
同分一律 `localeCompare(displayName)`。所以这不是移植走样，是**上游 0.18 本身就与 0.66 有分歧**。

## 四、为什么这么久没被发现

- 官方与本地渲染出的 4 行**都看起来像字母序**，很容易被读成「个性化推荐」或巧合。
- 整站 parity 逐区块比对是绿的：12/13 个共有区块逐行一致。首页那个 `为你推荐` 区块一直被
  记为「数据面差异（已装集合不同）」，**归因是对的但不完整** —— 它同时还叠了一个算法错误。
- 关键的 4 个赢家全是 `MCP` 类，恰好又都是**没装**的，所以在任何「已装清单」视图里都不显眼。

## 五、守卫

`tests/marketplace-foryou-affinity.test.mjs`（6 条）+ 夹具
`tests/fixtures/official-foryou-attribution.json`（官方实机全量 403 条 catalog +
官方自己的 16 条已装名单 + 官方渲染的那 4 行）：

1. 用官方 catalog + 官方已装名单 → 必须复现官方那 4 行
2. 那 4 个赢家必须落不到任何桶（否则「桶版也算得对」无法被排除）
3. 最小判别：同 category 标签、都落不到桶的两条，必须互相给 affinity
4. 反向判别：同桶但不同 category 标签的两条，**不应**互相给 affinity
5. `selectForYou` 函数体内不得再出现 `bucketsOf`（切片起止锚点都断言在正确位置）
6. 上限仍是 4

变异 5/5 全红（桶版 / `categoryKey` 版 / `categoryKeys` 版 / 只认 MCP / 去掉 `trim`），
脚本先注入必然失败断言确认退出码真的是 1。

## 六、还没做的：部署侧

重建修好了，但**已部署的 app 仍然是 0.18 的 `ms`**。要修必须给被 checksum 钉死的上游
renderer chunk 打补丁。项目里有先例（`router-renderer-patch.mjs` 做最小化、可审计注入），
但那会改变钉死产物的行为，属需要先定方案的改动，**本轮未执行**。

在打补丁之前，本地「为你推荐」那一行与官方的差异是**两层原因叠加**：

1. 已装集合不同（机器状态，不可消除）
2. affinity 键错误（算法，可修，但本轮只在重建侧修了）

## 七、复现

```sh
export PATH=/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH
REPO=/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed
cd "$REPO"

# 守卫
node --test tests/marketplace-foryou-affinity.test.mjs

# 从已部署 asar 里读出 0.18 的 ms
node -e '
const {readFileSync}=require("fs");
const A="/Applications/Grok Node.app/Contents/Resources/app.asar";
const b=readFileSync(A), ds=8+b.readUInt32LE(4), jl=b.readUInt32LE(12);
const h=JSON.parse(b.subarray(16,16+jl).toString("utf8"));
(function w(n,p){for(const [k,c] of Object.entries(n.files??{})){const q=p?p+"/"+k:k;
 if(c.files)w(c,q); else if(q==="dist/renderer/assets/index-UbX-y3il.js"){
   const o=Number(BigInt(ds)+BigInt(c.offset));
   const s=b.subarray(o,o+c.size).toString("utf8");
   const i=s.indexOf("function ms(n,e,a){"); let d=0,j=s.indexOf("{",i),k=j;
   for(;k<s.length;k++){ if(s[k]==="{")d++; else if(s[k]==="}"){d--; if(!d)break;} }
   console.log(s.slice(i,k+1));
 }}})("",0);'
```

注意：产物里的中文是 `\uXXXX` 转义，直接 grep「为你推荐」是 0 命中 —— 必须先转义再匹配
（`为你推荐` → `\u4E3A\u4F60\u63A8\u8350`）。
