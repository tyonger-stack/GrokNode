## detail-hero-and-account-row-fix.md（用户报告的两处视觉差异，已修并复验）

用户看截图说「随便打开就不一样」——**hero logo 撑成 401×401**、**账户名被截成 \`d...\`**。
量出来：详情区 1023 vs 官方 677，hero 421 vs 官方 88，账户行 57 vs 官方 42。
修复后在已部署产物（asar \`59621dddae44709a\`）逐项回到官方值，**唯一残留是账户名内层盒子 18 vs 15 的 3px，
归因不了，未改**。守卫 3 条，5 个变异全红。

## marketplace-page2-structure-fix.md + \`marketplace-page2-css-cascade-deployed.json\`（页 2 与详情页的四处几何缺陷）

同一句「随便打开就不一样」的第二轮，**四处**，且**页 2 和整个详情页整体低 55px、窄 64px**：

- **A** 私有技能网格把两列类 `sand-nby9oq` 和单列类 `sand-1mkdm3x` **叠在同一个元素上**。
  两条规则特异度完全相同（3 id + 1 class），胜负由样式表顺序决定，而两列那条在后 → 永远两列，
  339px 挤在 363px 列里。官方单列列表里根本没有 `sand-nby9oq`。
- **B** 分组的 `min-height:0;overflow:hidden` 包裹层多套在了最外层。官方只在 overflow holder
  和「显示全部」行**内部**用它。
- **C** 顶部 48px 条是**共享插槽**：页 1 空置（置顶搜索的挂载点）、详情页放详情条、页 2 放详情条
  （后两者用 17/10 类，页 2 用 5/5 类）。本地把详情条渲染在滚动容器内部，于是带子空着、
  详情条重复渲染在下面。**详情页犯的是同一个错**——上一轮只比对了 hero 区块自身尺寸、没比绝对 y，漏掉了。
- **D** 组标题缺 0.66 的 16 个 `ui-*` 排版类（15.21px 粗体 vs 官方 12px/16px 常规），
  h1 缺 17px/24px 配方（26px vs 17px），标题行多一个官方没有的 `sand-euugli`（30 vs 65）。

**16 个 \`ui-*\` 类 0.18 全部原生存在、声明逐字节相同，一个 CSS 都没 lift**；只有挂上。
\`--cursor-font-weight-normal\` 在 0.18 未定义，但官方声明自带 \`,400\` 兜底，正好解析成 400。

**运行时证据**（\`npm run marketplace:css\`，headless Chrome 读**已部署 asar** 的样式表，不需要 app）：
10 条页 2 断言全过。关键一条不是「单列是一列」，而是**两份列表在同一宽度下解析出不同结果**
（\`734px\` vs \`363px 363px\`）——有人再把两个类叠回去，这条立刻变红。
已部署 chunk \`index-UbX-y3il.js\` 过 \`node --check\`，全 chunk 内 \`sand-nby9oq\` 只剩 1 次。

**⚠️ 实机（CDP 9232）几何复验尚未做**：验证时 Mac 锁屏（\`CGSSessionScreenIsLocked = true\`），
钥匙串弹窗挡住启动。源码 + 已部署产物两侧证据齐备，缺这条运行时确认，**不要当已复验**。


# 实机证据存档（原始输出）

这些文件是**探针的原始输出**，不是转述。放在仓库里是因为要求 C / 要求 A 的验证都需要改动外部状态
（移走 daemon 连接文件、`docker stop` 容器、逐条点 40 个技能行），评审者不方便重复，于是「只有源码断言、
没有运行证据」。

每份 JSON 都带 `href`，值为当时那个 app 的 `file://…/Contents/Resources/app.asar/dist/renderer/index.html`。
**先看 href 再看结论**：本项目栽过一次——标着「官方」的取证脚本其实是本地脚本的逐字节副本，端口和 URL
都没改，静默取到了本地数据还不报错、不为空。

## catalog-gap-11-entries.json + `catalog-name-diff.json`（catalog 差的真实成因）

两个 app **同时**在跑，用**各自同一个 bridge 入口** `window.desktop.mcp.catalog()` 实测（各自先打印 asar href 做身份断言）：

```
官方 0.66.0   404 条
Grok Node     393 条
仅官方有 11 条，仅本地有 0 条   ← 本地是严格子集，没有自己编的条目
```

那 11 条：`Finance`、`Google Docs`、`Google Sheets`、`Google Slides`、`OneDrive`、`Outlook`、
`Outlook Calendar`、`SharePoint`、`Teams`、`X Money`、`oh-my-claudecode`。

**成因（有代码路径支撑，不是「等上游」这种含糊说法）**：
`fetchMarketplaceMcpPlugins` 只调一次 `listMarketplacePlugins({ excludeCloudAgentPlugins: true })`
—— **没有分页**，所以不是页边界 bug。它只在 `includesPrivateMarketplaces` 为真时才并入私有/团队市场，
而该标志就是 `(await bestEffortToken(getAccessToken)) != null`。官方已登录、本地按合规边界不登录，
那 11 条住在私有/团队市场里，所以永远并不进来。**要补齐就得持有 Cursor 账号 token，而本仓库拒绝伪造或绕过。**
佐证：官方 bridge 还多出 `financeOverview` / `deleteFinanceConnection` / `startFinanceLink` /
`refreshCatalog` / `grokBotAgentServers` / `reconcileUnpublishedPlugin`——正是同一道账号门后面的东西。

### ⚠️ 更正：「为你推荐 差一条是因为拿不到团队热度数据」这个说法是错的

`window.desktop.mcp.teamPopularity()` 在**两个 app 上都返回空对象**——**包括已登录的官方**。
所以缺失的热度数据解释不了那一行，先前的归因不成立。至于「为你推荐」到底按什么排序，
这次测量没有回答，**仍然开着**，不当作已定论。

## marketplace-detail-cta-render.test.mjs（`npm test` 里真正渲染的那一层）

`tests/marketplace-detail-cta-render.test.mjs` 用一个几十行的 element shim **执行 `view.ts` 实际调用的**
`createAddAccountCta` / `createToolsRowCta`，断言**渲染后**的 `textContent`、`aria-label`、子节点顺序与数量，
以及配方里每个类是否真的落到节点上（含承载 14px 内缩的 `sand-1pic42t` / `sand-1onr9mi`）。
第三个断言检查 `view.ts` 仍在调用它们——否则守卫会变成「保护一段渲染路径已经不再使用的代码」。

4 个变异全红，其中两个就是**已经发货过的缺陷**：退回 aria-label-only、去掉 padding 类。
`plugins-marketplace-renderer-patch.test.mjs` 里原有的「不得长出事件处理器」「必须是文本节点」两条守卫
保留原意，但改为切**真正创建节点的那个函数**，且每条都先断言「切到了东西」，改个名字不会让它变成
对空字符串的守卫。

## marketplace-detail-parity-live.json（真机几何：7/7，官方基线逐项相同）

`npm run marketplace:parity -- 9232`，**已部署产物**，asar `c0d6c4e4de32`。这份补上了下面 headless 那份
补不了的洞——**真实渲染几何**：

```
              官方基线                        本地实测
addAccount   height 43   padding 12px 14px   height 43   padding 12px 14px   ✅
toolsRow     height 42   padding 12px 14px   height 42   padding 12px 14px   ✅
addAccount   textContent 添加其他账户         同左                              ✅
             ariaLabel  null                null                              ✅
             childCount 1                   1                                 ✅
```

**基线不是手打的**——同一个脚本此前对官方 0.66.0（CDP 9224）跑过、7/7 通过，这份 JSON 里的
`officialBaselines` 就是官方自己的读数。7 项全过。

⚠️ `addAccount.ariaLabel = null` **是匹配、不是缺口**：官方 0.66 这个 CTA 用文本节点渲染、本身就没有
aria-label；本地早期版本反而有，那正是被修掉的缺陷之一。

**它不能证明的**：① 只覆盖 Gmail 详情页那两个全宽 CTA，不代表市场页每一行都对；
② 比的是若干 computed 属性，**不是像素级截图 diff**；③ **不能证明钥匙串弹窗已消失**——这次运行发生在
锁屏状态且没有 SecurityAgent 进程，只能说明「这次启动没被堵住」；DR 那条修复的依据是 codesign 的输出，
不是这份记录。

## marketplace-css-cascade-deployed.json（无需运行中 app 的 padding 级联验证）

`npm run marketplace:css` → `scripts/verify-marketplace-css-cascade.mjs`。把**已部署 asar** 里的样式表
连同 45 条 lifted 规则一起内联进 headless Chrome，量详情页两个全宽行的 computed padding：

```
asar c0d6c4e4de32c9ab (68602052 B) | 样式表 ca9b4475e5898b17 (545624 B) | 7153 条规则已解析
lifts 45 rules read from official-styles.ts
PASS  add    padding 12px 14px   textContent 添加其他账户   childCount 1
PASS  tools  padding 12px 14px   textContent 已启用 23/23 个  childCount 2
```

**为什么要有它**：`verify-marketplace-detail-parity.mjs` 需要活着的 app，而每次重签名都会弹钥匙串、
把启动堵死。padding 级联这件事本身不需要窗口。

**读这份记录时请注意三件事**：

1. **它不能证明真机几何。** 高度只报告不断言（fixture 没有 icon font，`ui-icon` 的固有尺寸和真机不同，
   本地量到 42/46、官方是 43/42，**不可比**）。真机高度仍**未确认**——`npm run marketplace:parity -- 9232`
   还卡在钥匙串弹窗上。
2. **期望值是转录的，不是本次量出来的。** 它证明的是「已部署产物 + 当前源码 → 算出 `12px 14px`」，
   不证明官方此刻也算出同一个值。
3. **只断言了 2 条规则。** 另外 43 条确实被解析并注入了 fixture（含 3 条带伪选择器的），但没有断言。

**这个脚本自己也被变异测试过**（记录在 JSON 的 `mutationTesting`）：

| 变异 | 结果 |
| --- | --- |
| 删掉 `padding-inline-start` 那条 lift | exit 2，必需规则守卫 |
| 把 `sand-1onr9mi` 改名成 `sand-1onr9mi-TYPO` | exit 2，必需规则守卫 |
| 把一条 lift 改成解析器读不懂的 4 元组 | exit 2，`parser read 44 of 45 entries` |
| 规则留着、值从 14px 改成 0px | exit 1，2 条 padding 断言 FAIL |
| **对调两条 inline 声明** | **exit 0 —— 这不是缺陷**：四个行列表都同时带这两个类，左右对称，视觉等价 |

**这版脚本自己修掉的三个真问题**（都在 JSON 的 `defectsFoundInAnEarlierRevisionOfThisScript`）：

1. 它原来读 `.build/fidelity/…`，而自己的注释写的是 `DEPLOYED`。两者当时**恰好**字节相同
   （`ca9b4475e5898b17`），只因为 `.build` 没被重写——这正是「我验的字节不是我发布的字节」。现在直读 asar 并打印其 sha256。
2. 它原来把两条 lift **硬编码**在脚本里，于是源码侧回归时它照样全绿。现在从 `LIFTED_OFFICIAL_RULES` 解析。
3. 它的第一版解析器只认二元组，**45 条里只读到 42 条**，三条 `:focus-visible` / `::after` 规则无声消失。
   现在独立统计条目起始数，对不上就拒绝出测量结果。

## deployed-detail-values-final.json（最终态：五项全过）

asar `b93b1ebeece3`，CDP 9232，Gmail（已安装 + `已连接`）：

```
功能 1 个应用 | 开发者 Cursor | 类别 精选 | 网站 cursor.com | 可用性 公开
查看源码 href = https://github.com/cursor/plugins
账户区加号 aria-label = 添加其他账户
```

**五项检查全过。** `网站` 之所以第一轮没过，是我读错了字段（见下面的更正），
改读 `publisher.websiteUrl` 后即恢复为官方的 `cursor.com`；`查看源码` 仍指向仓库，两者是不同字段。

## deployed-detail-values-2026-10-04.json + `deployed-gmail-detail-2026-10-04.png`（第一轮，含被推翻的结论）

三个详情页取值修复在**已部署产物**上的实机读数（CDP 9232，Gmail，已安装 + `已连接`）：

```
账户 default 已连接 | 工具 已启用 23/23 个 | 应用 1 gmail连接器
信息 功能 1 个应用 | 开发者 Cursor | 类别 精选 | 网站 github.com | 可用性 公开
```

- `添加其他账户` ✅ 实机通过，旧的 `添加账户` 字面量在界面上已不存在
- `类别 精选` ✅ 实机通过，不再是英文 `Featured`
- `网站 github.com` ❌ 首轮**仍是仓库域名** —— 追下去发现**是代码问题，而且我一开始的结论是反的**

### ⚠️ 更正：`websiteUrl` 一直都在，只是我读错了地方

首轮我判定这是「数据缺口」，理由是本地 393 条的 `websiteUrl` 全为 null。**那个判断是错的。**

顺着查下来：

1. 本地 `Plugin` proto 消息有 40 个字段，含 `repositoryUrl`，**没有** `websiteUrl`。
2. 本地 `Publisher` proto 消息有 15 个字段，**含 `websiteUrl`**。
3. 官方 asar 里扒出它自己的映射函数 `B7t`，其中一行是：
   `websiteUrl: $t(n?.websiteUrl)`，而 `n = e.publisher`。
   官方把**发布者的** website 提升到 view 对象顶层——这就是为什么官方 catalog 条目顶层有
   `websiteUrl`，尽管 `Plugin` 消息本身没有这个字段。

而我们的 `toPlugin` 恰好读的是 `plugin.websiteUrl`（顶层），**恒为 undefined**；
同时我们把 publisher 投影成 `{name, displayName, isUserOwned}`，把 `websiteUrl` 丢掉了。

**我犯的错**：看到「publisher 对象只有 name/displayName/isUserOwned」，就断定**线上**的 publisher
也没有 websiteUrl。那其实是我们自己那个有损投影的形状——**拿自己的投影当成了 wire 形状**。
数据一直都在，只是取错了路径。已改为 `websiteUrl: publisher?.websiteUrl`，
并加了守卫：`toPlugin` 里禁止再出现 `plugin.websiteUrl`。

`信息 · 网站` 之所以还能「看起来接对了」，是因为我第一轮把 `websiteUrl`/`repositoryUrl` 分开透传
这一步是对的；错的只是**取值来源**。这也说明「结构断言全绿」和「值是对的」是两回事。

## requirement-a-skill-walkthrough-ratio.json（要求 A：私有技能详情页）**—— 已补齐，可证伪**

前一份存档只报了按钮**集合**（`["删除","删除|保存"]`），两种都出现过，但**分不出 9/31 和 20/20**，
所以它其实没验到要求 B 的双源结论。这一份按可证伪的方式重跑：

```
数据层  bridge 返回 41 条   managed 31 / workflow 9 / automation 1
界面层  40 行，走查 40 行
        删除     31 行   ← 预期 31
        删除|保存  9 行   ← 预期 9
        noButtons []  bodyOverflowX []  subtitleClipped []
```

**31/9 精确复现。** 判定来源不是集合，而是把 bridge 记录的 `source` 逐条对上按钮集：
`add-connector(managed)` 只有 `删除`，`Design a Grok Bot(workflow)` 才有 `删除|保存`。
`source` 直接读 bridge 记录，不再从 DOM 刮——上一轮刮出来 40 条全是 null，等于什么都没验。

两点要留意：

1. **这次 bridge 返回 41 条，不是 40**：多出来那条 `source: "automation"`。
   `privateSkillsFromRecords` 只收 `workflow/managed/plugin`，所以它被丢掉，41 → 40 行。
   这个丢弃是显式规则，不是漏网。
2. `automation` 是**第三种来源**。官方 0.66 的私有技能区是否展示 automation，**没有取证**，
   当前按「不是 workflow/managed/plugin 就不进私有技能」处理。数据面会漂移——
   早前那份数据探针（13:52）还是 40 条，两小时后变成 41 条。

## requirement-a-skill-walkthrough.json（旧的、只报集合的那份）

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
