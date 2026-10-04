# 实机证据存档（原始输出）

这些文件是**探针的原始输出**，不是转述。放在仓库里是因为要求 C / 要求 A 的验证都需要改动外部状态
（移走 daemon 连接文件、`docker stop` 容器、逐条点 40 个技能行），评审者不方便重复，于是「只有源码断言、
没有运行证据」。

每份 JSON 都带 `href`，值为当时那个 app 的 `file://…/Contents/Resources/app.asar/dist/renderer/index.html`。
**先看 href 再看结论**：本项目栽过一次——标着「官方」的取证脚本其实是本地脚本的逐字节副本，端口和 URL
都没改，静默取到了本地数据还不报错、不为空。

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
`workflowExamples` / `managedExamples` 为空。也就是说这份走查**没有**独立证明
`workflows/`（用户自建）与 `managed-skills/`（托管）两路都进来了——它只证明了 40 条详情页都点得开、
按钮集正确、正文不横向溢出。要求 B 的双源证据在别处（`MARKETPLACE-066-PARITY` 里 40 条标签全为
「本地创建」、0 条「已发布」），但那是**标签层面**的证据，不是逐行点击的证据。
补齐它需要重跑一次逐条点行（应用能启动的前提下）。

同文件里 `page2.ok = false`（`why: "not on manage"`）——同一份探针的页面切换断言没跑通，
所以「页面 2 能从页面 1 切过去」在这份存档里是缺的，不要引用 `page2` 字段下结论。
`page1.pin` 反而是好的：`scrollTop 0 → 300` 且 `searchInputs` 始终为 1，即注意 2 的置顶搜索栏。
