# 实机证据存档（原始输出）

这些文件是**探针的原始输出**，不是转述。放在仓库里是因为要求 C / 要求 A 的验证都需要改动外部状态
（移走 daemon 连接文件、`docker stop` 容器、逐条点 40 个技能行），评审者不方便重复，于是「只有源码断言、
没有运行证据」。

每份 JSON 都带 `href`，值为当时那个 app 的 `file://…/Contents/Resources/app.asar/dist/renderer/index.html`。
**先看 href 再看结论**：本项目栽过一次——标着「官方」的取证脚本其实是本地脚本的逐字节副本，端口和 URL
都没改，静默取到了本地数据还不报错、不为空。

## deployed-detail-values-2026-10-04.json + `deployed-gmail-detail-2026-10-04.png`

三个详情页取值修复在**已部署产物**上的实机读数（CDP 9232，Gmail，已安装 + `已连接`）：

```
账户 default 已连接 | 工具 已启用 23/23 个 | 应用 1 gmail连接器
信息 功能 1 个应用 | 开发者 Cursor | 类别 精选 | 网站 github.com | 可用性 公开
```

- `添加其他账户` ✅ 实机通过，旧的 `添加账户` 字面量在界面上已不存在
- `类别 精选` ✅ 实机通过，不再是英文 `Featured`
- `网站 github.com` ❌ **仍是仓库域名**——但**不是代码问题**

第三条要说清楚：把 `mcp.catalog()` 的 393 条全查了一遍，

```
entriesWithWebsiteUrl: 0
entriesWithRepositoryUrl: 393
```

**本地 catalog 根本没有 websiteUrl 这个值**（官方 0.66 的 Gmail 有 `https://cursor.com/`）。
渲染代码是对的——部署 chunk 里就是 `网站 ← websiteUrl`、`查看源码 href ← repositoryUrl`——
websiteUrl 为空时按设计回退到 homepage，于是显示仓库域名。

最可能的原因是**上游对未登录调用方不下发 websiteUrl**（本地构建按合规边界不登录），
但这一点**我们这边没有证实**——没抓到本构建实际收到的原始响应。
从插件名反推一个主机名就是编造，所以**没有伪造任何值**。
在这条数据出现之前，这一行在本地就只能显示 `github.com`。



**不经过界面**，直接 POST `http://127.0.0.1:1340/api/getAgentWorkflows` 读 box gateway 的原始返回：

```
totalRecords: 40
source:      managed 31  /  workflow 9
publishedByCurrentUser: false ×40
```

`workflows/`（用户自建）9 条 + `managed-skills/`（托管）31 条 = 40，**两路都到了**。
`pluginId` 与 `sourceRef` 全为 null，所以没有第三条来源被静默丢掉。

### 由此得到一个可被推翻的预测

`privateSkillsFromRecords`（model.ts）只在 `source === "plugin" && publishedByCurrentUser !== true` 时丢弃记录，
而这 40 条没有一条是 `plugin`，**所以 40 条全部保留**。再看 `canEditPrivateSkill`：

```ts
return skill.source === "workflow" && …
```

于是界面上必须是 **31 行只有 `删除`、9 行是 `删除|保存`**。

⚠️ 存档的 A 走查只报了按钮**集合**是 `["删除", "删除|保存"]`，两种都出现过，但**没报各有多少行**——
所以它并不能区分「9/31」和「20/20」。真正的走查必须复现 **31/9** 这个比例，只报集合等于没验。

## requirement-c-gate-*.json（要求 C：host gateway 不可达 → 显式报错）

采集于 2026-10-04 06:45–06:49，**已部署产物** `/Applications/Grok Node.app`（asar `80ad3559`），CDP 9232。
探针 `probe-skills-gate.mjs`，每个状态都先关掉对话框再从 dock 重进（`open()` 在对话框存在时提前 return，
不重进就只会读到上一次的旧 state）。

| 文件 | 做法 | 行数 | isErrorState | 错误文案 |
| --- | --- | --- | --- | --- |
| `…-baseline.json` | 正常 | 40 | false | — |
| `…-noconn.json` | 移走 `local-exec-daemon-connection.json` | 0 | **true** | `The local host gateway is not running.` |
| `…-boxdown.json` | `docker stop grok-node-local-vm` | 0 | **true** | 同上 |
| `…-deadport.json` | 只把 `baseUrl` 改到关闭端口 1399 | 0 | **true** | `…is unreachable while handling /api/getAgentWorkflows.` |
| `…-selfheal.json` | 等 box 自己回来后重读 | 40 | false | — |

**要看的不是「有没有报错」，而是 `rowCount === 0` 且 `isErrorState === true` 同时成立。** 这才是 C 的契约：
不可达 ≠ 没有技能。只满足其一时就说明退化成了空列表。每个状态里 `previewText` 都还是 `已安装 8 个`，
说明一条通道挂掉不会拖垮整页。

⚠️ `boxdown` 命中的其实是「文件没了」那一支：应用自己的 supervisor 在 12 秒内把 box 拉起来了，
连接文件已被清掉，所以读到的还是 `not running`。「文件在、daemon 死」这个组合由 `deadport` 覆盖。

## requirement-a-skill-walkthrough.json（要求 A：私有技能详情页）

40 条技能逐条走查的输出：按钮集只有 `删除` 与 `删除|保存` 两种，`noButtons: []`（每条都有按钮），
`anyBodyOverflowX: []`（SKILL.md 正文零横向溢出），`anySubtitleClipped: []`。

**这份存档有一处已知的弱点，不要当它不存在**：`bySource` 40 条全是 `null`、`byLocation` 全是 `?`，
`workflowExamples` / `managedExamples` 为空。也就是说这份走查**没有**证明
`workflows/`（用户自建）与 `managed-skills/`（托管）两路都进来了——它只证明了 40 条详情页都点得开、
按钮集正确、正文不横向溢出。数据层的双源证据已由 `requirement-b-source-merge.json` 补上
（31 managed + 9 workflow），但那份只报了按钮**集合**、没报**各多少行**，
因此仍然不能区分「9/31 正确」和「20/20 也照样通过集合断言」。
补齐要重跑逐条点行，并且必须复现 31/9 这个比例（应用能启动的前提下）。

同文件里 `page2.ok = false`（`why: "not on manage"`）——同一份探针的页面切换断言没跑通，
所以「页面 2 能从页面 1 切过去」在这份存档里是缺的，不要引用 `page2` 字段下结论。
`page1.pin` 反而是好的：`scrollTop 0 → 300` 且 `searchInputs` 始终为 1，即注意 2 的置顶搜索栏。
