# 市场页条目级对拍（2026-10-04，两个 app 同时跑）

> **最终结论（修复部署后重测）**：12 个共有区块里 **9 个逐行完全一致**，
> 剩下 3 处差异**全部是 catalog 缺条目**（`google-slides` / `oh-my-claudecode` /
> `Agent Compatibility`），**已无算法差异**。其中「通信」这一处原本是最难的谜团
> （官方显示 `Bird` 而非 `Adapter`），补上 `categoryKeys` 后**自动解开**。


> 这是一次**独立于** `MARKETPLACE-066-PORT.md` 的实测记录。PORT §7 写的「条目级仅 6/14 完全一致」
> 是在 Cursor agent 的 D13 厂商 override 修复**之前**测的；那份产物已于 05:05 部署上线
> （asar `a4943be0c1ab8b02` → `51814aacbc1ca3ea`）。

## ⚠️ 更正（05:5x，重要）

本文早期版本写过一句「`canva:["design"]` override 被本次对拍**证实正确**」。**这个说法在方法上
是错的**，本节把它推翻。

扒官方 0.66 的归桶真源
（`/Applications/Grok Bot.app` → `dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js`，
**整个文件只有 12,928 字节**，必须全文读而不是看命中点前后 2KB），实测：

```
'AGENT_ORCHESTRATION'  在整个文件出现 1 次 —— 且在 E={FEATURED:{id:"FkMol5"},…} 这张
                        「类目 → 本地化文案 id」表里，不是归桶表
'canva' / 'mailerlite' / 'bird' / 'adapter' / 'Mobbin'  出现 0 次
```

即：**上游的归桶表里没有 `AGENT_ORCHESTRATION` 这条映射（正确行为是映射为空、该类目不落任何桶），
也根本没有任何厂商 override 表含 canva / mailerlite。**
用实验拟合出来的「`AGENT_ORCHESTRATION:"communication"`」和「`canva:["design"]`」是**不存在的规则**；
8/12 的一致率里有两处是靠它们凑出来的。

## 真正的根因：一个字段，`categoryKeys`

官方 catalog 的每一条都带 `categoryKey`（单数）和 **`categoryKeys`（数组）**；我们本地 catalog 的每一条
**只有人类可读的 `category` 字符串**，两个 key 字段都没有。实测（同一份抓取脚本跑两个 app）：

| 条目 | 官方 `categoryKeys` | 由此产生的官方行为 |
| --- | --- | --- |
| `canva` | `["PRODUCTIVITY","DESIGN"]` | 同时落 效率 / **设计** |
| `figma` | `["PRODUCTIVITY","DESIGN"]` | 同上 |
| `bird` | `["AGENT_ORCHESTRATION","INBOX_AND_COLLABORATION"]` | AO 不在归桶表被丢弃，靠 ICC 落 **通信** |
| `adapter` | `["AGENT_ORCHESTRATION"]` | **整个条目任何桶都进不去** |
| `slack` | `["FEATURED","PRODUCTIVITY"]` | 两处 |
| `notion-workspace` | `["FEATURED","PRODUCTIVITY","DOCUMENTS_AND_FILES"]` | 三处 |
| `mobbin` | `["DESIGN"]` | 只落 设计 |
| `google-slides` | `["DESIGN"]` | 只落 设计（**本地 catalog 缺这一条**） |

上游的 `Re()` 就是 `Te[vendor] ?? union(Le[normalize(k)] for k in categoryKeys)`，数组求并集、
**表里没有的 key 直接丢弃**。所以：

- 官方「设计」= Canva / Docs Canvas / Figma / **Google Slides**（字母序前 4）。
  我们第 4 位是 Mobbin，**唯一原因是本地 catalog 里没有 Google Slides** —— 纯数据缺口，
  与任何规则无关。
- 官方「通信」里没有 Adapter，是因为 `Adapter.categoryKeys = ["AGENT_ORCHESTRATION"]`，
  而 `AGENT_ORCHESTRATION` 不在归桶表里 → **条目被整个丢弃**。这恰好解释了那个
  「官方跳过 Adapter」的谜团，不需要任何额外规则。

## 数据其实在我们手里，只是被投影丢掉了

`source/shared/node/mcp/mcp-marketplace.ts:132` 现在是：

```js
const categoryKey = plugin.curatedCategoryKeys.find((value) => value.length > 0);
```

`plugin.curatedCategoryKeys` 是 `string[]`（proto 明确声明：`source/packages/proto/generated/
aiserver/v1/dashboard_pb.ts:54616` `declare curatedCategoryKeys: string[]`），
box 侧的 `host-main.cjs` 里也在用同一个字段。**但这里只取了第一个，转成人类可读的
`category` 标签就扔了 —— 其余值和 key 形态全部丢失。**

**修复只有两行**（把 key 形态和整个数组一起透传）：

```js
categoryKey: categoryKey ?? undefined,
categoryKeys: plugin.curatedCategoryKeys.filter((v) => v.length > 0),
```

### 为什么本次没有直接改

`model.ts` 里的 `canva:["design"]` / `mailerlite:["support"]` 已被标注为
**DATA-GAP COMPENSATIONS**（补偿缺失字段），而 `Re()` 的判定顺序是
`Te[vendor] ?? union(Le[...])` —— **override 优先级高于 `categoryKeys`**。
所以只改数据侧、不同时删掉这两条补偿，新字段会**静默失效**，两人都不会察觉。
两侧必须一起改；`model.ts` 当时正由另一个 agent 在改，因此本次只记录不动手。

### 当前工作区的状态（05:5x 复核）

`model.ts` 已经是**正确**的形态，可以对照：

- `CATALOG_CATEGORY_TO_BUCKET` = 上游那 14 条，**`AGENT_ORCHESTRATION` 已移除** ✅
- `Re()` 忠实支持 `categoryKeys` 数组，缺失的 key 按上游语义丢弃 ✅
- 两条 vendor 条目保留但**已降级标注为数据缺口补偿**，不再冒充上游规则 ✅

也就是说，并发 agent 已经独立走到了同一个结论。本文早期那句「override 被证实正确」作废。

---

<details>
<summary>以下为更正前的原始对拍记录（方法与区块级结论仍然有效）</summary>

## 方法

两个 app 同时运行，各带独立 CDP 端口：

| app | 版本 | 端口 |
| --- | --- | --- |
| `/Applications/Grok Bot.app` | 0.66.0（官方） | 9224 |
| `/Applications/Grok Node.app` | 0.18.0-reconstructed | 9232 |

**同一份抽取脚本跑两边**（`dump-shared.mjs`）—— 因为官方 0.66 的 DOM 里行元素就是
`li.sand-plugins-row > button.sand-plugins-row__open[aria-label="打开 <名称>"]`，
与我们自己的类名**完全一致**，所以不存在「两边口径不同」的干扰。行标题统一取
`aria-label` 去掉「打开 」前缀，取不到才回退到首个文本节点。

⚠️ 脚本启动时先断言 `location.href` 含预期的 bundle 名，**不符就抛错**。上一轮曾出现过
「官方取证脚本其实是本地脚本的逐字节副本」而静默取到本地数据，所以这条断言是硬性的。

抓取前先把滚动容器整段滚一遍（强制懒加载行进 DOM），再回到顶部按 `h3` 的几何位置归属行。

## 结果：12 个共有区块里 8 个逐行完全一致

| 区块 | 官方 | 本地 | |
| --- | --- | --- | --- |
| 为你推荐 | Agent Compatibility / Aikido / Aleph / Algolia Productivity | Adobe Developer App Builder / Airtable / Asana / Atlassian | ❌ |
| 精选插件 | Gmail / Google Calendar / Google Drive / Granola | 同左 | ✅ |
| 团队插件 | oh-my-claudecode | （空） | ❌ |
| 效率 / 代码 / 数据 / 销售 / 财务 / 研究 | 各 4 行 | **逐行相同** | ✅ ×6 |
| 通信 | ActiveCampaign / AgentMail / Ando / **Bird** | ActiveCampaign / **Adapter** / AgentMail / Ando | ❌ |
| 设计 | Canva / Docs Canvas / Figma / **Google Slides** | Canva / Docs Canvas / Figma / **Mobbin** | ❌ |
| 支持 | 3 行 | **逐行相同** | ✅ |

官方 13 个区块，本地 12 个：**缺 `登录与凭据管理`**（D11）。区块**顺序完全一致**。

**条目级一致率：6/14 → 8/12 → 9/12**（分母只算两边都有的区块）。

> 中间那个 8/12 的**成因**已被「更正」一节推翻：当时有两处是靠上游不存在的 override 凑出来的。
> 补上 `categoryKeys`、让拟合补偿自动让位后重测：**通信 逐行一致**，8/12 变成真实的 9/12。
> 剩下的 3 处全部指向我们 catalog 里缺的那几个条目，不再有任何规则层面的差异。

## 剩余 4 处差异的性质分类（决定性实验）

用本地运行时 `window.desktop.mcp.catalog()` 查了本地 catalog（**393 条**），
逐个查这 4 处的分歧条目在不在：

| 差异 | 分歧条目 | 在本地 catalog？ | 性质 |
| --- | --- | --- | --- |
| 为你推荐 | Agent Compatibility | **不在** | **数据**（叠加：官方是登录账号、有团队热度数据；本地 `teamPopularity()` 无） |
| 团队插件 | oh-my-claudecode | **不在** | **数据**（D3 早已记录） |
| 设计 | Google Slides | **不在**（Mobbin 在，`category: "Design"`） | **数据**（catalog 缺条目） |
| 通信 | Bird vs Adapter | **两个都在**，且 `category` 都是 `"Agent Orchestration"` | **算法** ← 唯一一处真差异 |

**结论：4 处差异里 3 处是数据缺口，只有「通信」一处是真正的算法差异。**

### 「通信」这一处为什么是真差异

官方选 `Bird`、跳过 `Adapter`；我们选的第 4 条不来自同一个类目池。

把两边的 `category` 也拉出来看，结构就清楚了：

| 位置 | 官方 | 本地 |
| --- | --- | --- |
| 1–3 | `Inbox And Collaboration` ×3 | `Inbox And Collaboration` ×3 |
| 4 | **`Agent Orchestration`（Bird）** | `Inbox And Collaboration` |

也就是说 **官方的一个区块会混排多个 catalog 类目**（`通信` = ICC + AGENT_ORCHESTRATION 合并后取前 4，
且 ICC 在前），而我们的 `CATALOG_CATEGORY_TO_BUCKET` 是**一对一**映射，第 4 位从同桶里取。

⚠️ 我们的第 4 条在两次实测里分别是 `Adapter`、再是 `Brevo` —— 期间
`model.ts` 被改过并重新部署，所以**这个槽位目前不稳定**，不能拿它当定论。
官方 bundle 里也搜不到对应的字面量 override 表，**按证据优先原则不猜**。

### 已排除的假设：`publisher.isUserOwned`

`Bird` 是 `isUserOwned: false`、`Adapter` 是 `true`，看起来很像「浏览页排除自有条目」。
**这个假设被证伪了**，而且是决定性的：

- 三个**当前与官方逐行一致**的区块里都含有 `isUserOwned === true` 的条目 ——
  `代码` 的 **Appwrite**、`销售` 的 **Adspirer**、`研究` 的 **Crustdata**。
  若规则成立，这三个区块会立刻变得不一致。
- 我们 `通信` 区当前选中的 4 条**全部**是 `false`，过滤它们不会有任何变化，
  但官方选的那条我们仍然没选上。
- 两个 app 读到的 catalog **逐条相同**（`bird`/`adapter` 的 `category`、`isUserOwned`、
  `skills` 数全一致），所以这**不是**数据差异。

**否定结论本身是有价值的**：它把「按自有标记过滤」这条最顺手的猜测关掉了，
下一个人不必再走一遍。

### 顺带查到的 catalog 规模差

官方 catalog **404** 条，本地 **393** 条。本地缺的关键条目：

| 条目 | 影响的区块 | 证据 |
| --- | --- | --- |
| `Google Slides` | 设计 | 官方有、本地无（本地该桶 5 条 vs 官方 6 条） |
| `oh-my-claudecode` | 团队插件 | 官方有、本地无（D3） |
| `1Password` | 登录与凭据管理 | 两边都无（D11） |
| `Agent Compatibility` | 为你推荐 | 官方有、本地无 |

### 对 PORT §7 的更正

PORT §7 写「条目级仅 6/14 完全一致」，该数字已过期（D13 修复前）。修复后为 **8/12**。
PORT §3 的 D2 把 `为你推荐` 判为「降级为非差异」，本次对拍**不支持这个结论** ——
官方确实渲染出 4 个不同条目，其中 `Agent Compatibility` 本地 catalog 根本没有。

## 复现

```sh
cd "<scratchpad>"
EXPECT_BUNDLE="Grok%20Bot.app"   OUT_NAME=official node cdp.mjs 9224 dump-shared.mjs
EXPECT_BUNDLE="Grok%20Node.app"  OUT_NAME=local    node cdp.mjs 9232 dump-shared.mjs
python3 - <<'PY'
import json
o={s['section']:s['rows'] for s in json.load(open('official-dump.json'))['sections']}
l={s['section']:s['rows'] for s in json.load(open('local-dump.json'))['sections']}
for k in o:
    if k in l: print(('✅' if o[k]==l[k] else '❌'), k, o[k], l[k])
PY
```

---

## 修复部署后的重测（`d2e793d` + 重新打包部署）

asar `80ad3559`，重测结果：

```
official: 为你推荐(4) 精选插件(4) 团队插件(1) 登录与凭据管理(1) 效率(4) 通信(4)
          设计(4) 代码(4) 数据(4) 销售(4) 财务(4) 研究(4) 支持(3)          total=45
local:    为你推荐(4) 精选插件(4) 团队插件(0)               效率(4) 通信(4)
          设计(4) 代码(4) 数据(4) 销售(4) 财务(4) 研究(4) 支持(3)          total=43

一致 9/12   差异: ['为你推荐', '团队插件', '设计']
```

**通信 逐行一致了** —— 之前判为「无法解释」的那一处，正是被 `categoryKeys` 解开的：

- `Bird.categoryKeys = ["AGENT_ORCHESTRATION","INBOX_AND_COLLABORATION"]`
  → 第一个 key 不在 `Le` 表里被丢弃，第二个 key 把它送进 通信；
- `Adapter.categoryKeys = ["AGENT_ORCHESTRATION"]` → 整个条目**任何桶都进不去**，
  所以官方的 通信 里没有它。

运行时抽样核对，本地透传出来的数组与官方**逐条相同**：

| 条目 | 官方 | 本地（修复后） |
| --- | --- | --- |
| canva | `PRODUCTIVITY, DESIGN` | `PRODUCTIVITY, DESIGN` |
| bird | `AGENT_ORCHESTRATION, INBOX_AND_COLLABORATION` | 同左 |
| adapter | `AGENT_ORCHESTRATION` | 同左 |
| figma | `PRODUCTIVITY, DESIGN` | 同左 |
| slack | `FEATURED, PRODUCTIVITY` | 同左 |
| notion-workspace | `FEATURED, PRODUCTIVITY, DOCUMENTS_AND_FILES` | 同左 |

### 剩余 3 处：全部是 catalog 缺条目，无一是规则差异

| 差异 | 分歧条目 | 本地 catalog |
| --- | --- | --- |
| 设计 | `Google Slides` vs `Mobbin` | **缺** `google-slides`（该桶本地 5 条 / 官方 6 条） |
| 团队插件 | `oh-my-claudecode` | **缺** |
| 为你推荐 | `Agent Compatibility` | **缺**（叠加：官方是登录账号、有团队热度数据） |

按上游规则重算，设计桶的字母序前 4 是 Canva / Docs Canvas / Figma / **Google Slides**；
我们第 4 位是 Mobbin，**唯一原因就是少了那一条**。等 catalog 补齐这 11 条，三处会同时归位。

### 踩到并修掉的第二个投影

`categoryKeys` 在 `toPlugin`（第一次投影）里补上后，运行时**仍然看不到**。原因是
`marketplacePluginToView()` 还有第二次投影，把字段又丢了一次
（`source/shared/node/mcp/mcp-marketplace.ts:42`）。两次投影都要透传，缺一不可。
教训：改了「数据形状」类修复，**必须去运行时验一次字段真的到位**，源码里看到字段不等于渲染器收到了。

## 要求 C：host gateway 不可达 → 显式报错（实机 box-down 观测，06:3x）

这一条之前只有 15 条单测覆盖，**没有实机观测**。本轮在**已部署产物**上做完了，
探针 `probe-skills-gate.mjs`，四个状态全部跑过。

### 关键机制：读数据前必须先关对话框

`open()` 开头是 `if (dialog != null) return;` —— 对话框还在就直接返回，`reload()` 根本不会跑。
所以「让页面重新读一次 host」不是点一下刷新，是 **关掉对话框再从 dock 入口重开**。
探针里 `CLOSE_FIRST=1` 就是干这个的；漏掉它会拿到上一次的旧 state，看起来像「改了没生效」。

### 四个状态

| 状态 | 做法 | 私有技能 渲染 | 行数 | `已安装` 段 |
| --- | --- | --- | --- | --- |
| baseline | 正常 | 40 行正常数据 | 40 | 8 个，不受影响 |
| **noconn** | 移走 `local-exec-daemon-connection.json` | `…The local host gateway is not running.` | 0 | 8 个，不受影响 |
| **boxdown** | `docker stop grok-node-local-vm` | 同上 | 0 | 8 个，不受影响 |
| **deadport** | 只把 `baseUrl` 改到关闭端口 1399 | `…is unreachable while handling /api/getAgentWorkflows.` | 0 | 8 个，不受影响 |
| **selfheal** | 等 box 自己回来后重读 | 40 行正常数据 | 40 | 8 个，不受影响 |

每个错误态都同时断言了 `rowCount === 0` **且** `isErrorState === true`——
这正是 C 要的契约：**不可达 ≠ 没有技能**。两者只要有一个成立就说明退化成空列表了。

### 意外收获：boxdown 命中的其实是「文件没了」那一支

`docker stop` 之后那次读，报的是 `not running`（连接文件缺失）而不是 `unreachable`（fetch 失败）——
因为**应用自己的 supervisor 在 12 秒内就把 box 拉起来了**（探针结束时容器已 `Up 12 seconds`），
而 daemon 还没来得及把连接文件写回去。也就是说 `boxdown` 这一格**没有**真正覆盖到
「文件在、daemon 死」这个组合，得靠 `deadport` 补上。两条错误文案都在源码里有分支
（`skills-desktop.ts` 的 `connection == null` 与 `catch`），但只有后者会带出具体 endpoint 路径。

### 没改的一处（记录，不擅自动）

错误文案是中文框架 + 英文后端细节：`无法连接本地运行环境，暂时读不到私有技能：The local host gateway is not running.`
`skillsErrorText(code, detail)` 把 detail 原样透传。翻译它属于臆造上游措辞，按证据优先原则保持原样。

### 复现

```sh
export PATH=/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH
SP="/private/tmp/claude-501/-Users-wwzz-Downloads-proxyclawd/88833871-9d1c-410a-8425-a5a54e5377ef/scratchpad"
CONN="$HOME/.groknode/local-exec-daemon-connection.json"

# baseline / deadport（只改 baseUrl，token 不动）
cp "$CONN" "$CONN.bak"; python3 -c "改 baseUrl 到 1399"
CLOSE_FIRST=1 LABEL=deadport node "$SP/cdp.mjs" 9232 "$SP/probe-skills-gate.mjs"
mv "$CONN.bak" "$CONN"

# noconn（移走文件）
mv "$CONN" "$CONN.bak2"
CLOSE_FIRST=1 LABEL=noconn node "$SP/cdp.mjs" 9232 "$SP/probe-skills-gate.mjs"
mv "$CONN.bak2" "$CONN"

# boxdown（注意 supervisor 会自动重启，别据此判断读到了哪一支）
docker stop grok-node-local-vm
CLOSE_FIRST=1 LABEL=boxdown node "$SP/cdp.mjs" 9232 "$SP/probe-skills-gate.mjs"
```

⚠️ 探针第一件事是断言 `location.href` 含 `Grok%20Node.app`，不符直接抛错。
本项目已经吃过一次亏：标着「官方」的取证脚本其实是本地脚本的逐字节副本，端口和 URL 都没改，
静默取到了本地数据还不报错、不为空。
