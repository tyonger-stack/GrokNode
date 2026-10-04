# Official 0.66 App-marketplace evidence (CDP capture, 2026-10-04)

Source of truth: the locally installed `/Applications/Grok Bot.app`, `CFBundleShortVersionString`
= **0.66.0**, `com.anysphere.sand`. Captured live over CDP (`--remote-debugging-port=9224`) with the
官方 app running its own account (已安装 16 个). Every number below is a `getBoundingClientRect()`
measurement or an observed DOM class string — nothing here is inferred.

> **Debug-port note.** The official app does *not* always expose CDP. Scan wider than 9222-9225: the
> instance used for this capture was already running **without** a port, and `open -a` produced a
> silent no-op because a second launch is ejected by Chromium's `SingletonLock`
> (`~/Library/Application Support/Grok Bot/SingletonLock`). A relaunch with the port is required,
> and a relaunch that prints `DevTools listening …` and *then exits with status 0* is the singleton
> ejection, not a crash. Note also that our own `Grok Node.app` has a binary named `Grok Bot`, so
> `ps | grep "Grok Bot"` matches both apps — match on the `.app` path, not the binary name.

## 1. Page ladder

```
browse  市场                     dialog[role=dialog][aria-label=市场]  800×702 @ (32,160)
  ├─ 查看全部 (featured)      → section page  (单列, H1 = 分类名)
  ├─ 查看全部 (类目桶)        → results page (双列, H3 结果)
  ├─ click row               → detail page   (插件详情)
  └─ 已安装 N 个             → manage page   (管理插件和技能)
detail / section  → 返回 → previous page
```

The `dialog` keeps `aria-label="市场"` at every level — only the header swaps. The 48px band
(`[33,161,798,48]`) is present on every page and holds the detail bar once you leave `browse`.

## 2. browse (市场)

Scroll content `[33,209,798,2518]`, content column `[65,213,734,2486]` (32px left + 32px right gutter).

```
DIV.sand-settings-pane
  DIV                                       [65,213,734,2486]
    DIV                                     [65,213,734,24]   title row
      H2 · 市场                              [65,213,734,24]
      DIV                                   [629,211,170,28]
        BUTTON.sand-plugins__installed-preview  aria-label="你的插件"
          4 × SPAN.sand-tool-icon 18×18      [635,217] [649,217] [663,217] [677,217]
          SPAN · 已安装 16 个
          I (chevron 12×12)                  [779,219,12,12]
    I (search icon 14×14)                   [78,264,14,14]
    INPUT placeholder=搜索插件                [98,261,693,20]
    DIV                                     [65,307,734,2392] sections
      SECTION ×13
```

Section rhythm — title row 34px, grid 130px (2 rows of 64px + 2px gap), section box 172px,
stride 196px. `为你推荐`/`团队插件`/`登录与凭据管理` box 106px (1 row); stride 130px.

| # | 标题 | 行数 | 查看全部 | y | 首项 |
|---|------|------|---------|---|------|
| 0 | 为你推荐 | 4 | – | 307 | Agent Compatibility |
| 1 | 精选插件 | 4 | ✔ | 503 | Gmail |
| 2 | 团队插件 | 1 | – | 699 | oh-my-claudecode |
| 3 | 登录与凭据管理 | 1 | – | 829 | 1Password |
| 4 | 效率 | 4 | ✔ | 959 | Adobe Developer App Builder |
| 5 | 通信 | 4 | ✔ | 1155 | ActiveCampaign |
| 6 | 设计 | 4 | ✔ | 1351 | Canva |
| 7 | 代码 | 4 | ✔ | 1547 | Amazon Location Service |
| 8 | 数据 | 4 | ✔ | 1743 | Amplitude |
| 9 | 销售 | 4 | ✔ | 1939 | Adspirer |
| 10 | 财务 | 4 | ✔ | 2135 | 1inch |
| 11 | 研究 | 4 | ✔ | 2331 | Ahrefs |
| 12 | 支持 | 3 | – | 2527 | Intercom |

Bucket order matches the ported `CATEGORY_BUCKET_ORDER` exactly
(credentials → productivity → communication → design → code → data → sales → finance → research →
support), with 登录与凭据管理 hoisted to slot 3 (right after 团队插件) and rendered as its own
titled section. **查看全部 appears only when the group has more than the 4-row preview.**

Row anatomy (grid column, 2-column layout — `363 + 8 + 363 = 734`):

```
LI.sand-plugins-row                                    [65,349,363,64]
  BUTTON.sand-plugins-row__open  aria-label="打开 X"     [77,361,281,40]
    SPAN.sand-tool-icon.sand-tool-icon--logo 40×40       [77,361,40,40]
      IMG 39×39
    SPAN.sand-plugins-row__main                          [127,363,231,37]
      SPAN.sand-plugins-row__name   18px line
      SPAN.sand-plugins-row__subtitle 18px line
  SPAN.sand-plugins-row__trailing                        [370,366,46,26]
    BUTTON.sand-button · 添加                              46×26
    — or — SPAN.sand-plugins__added · 已添加              67×20
```

Group action: `BUTTON.sand-plugins__group-action` at `[723, y+7, 64, 20]` — right-aligned to the
grid's right edge (723 + 64 = 787 ≈ 65+734−12). Absent for 支持 (3 rows ≤ 4).

## 3. section pages — two distinct shapes

Both replace the header with `sand-settings-detail-bar` and put the section title in its H3.

### 3a. featured → single column (`精选插件`, 6 items)

```
DIV.sand-settings-pane            [33,209,798,496]
  DIV.sand-plugins__marketplace   [65,231,734,446]
    SECTION                        [65,231,734,446]
      DIV                          [65,231,734,44]
        H1 · 精选插件               [65,231,107,44]      ← h1, 44px
      UL.sand-plugins__grid        [65,283,734,394]
        LI.sand-plugins-row        [65,283,734,64]      ← FULL WIDTH 734
          BUTTON.sand-plugins-row__open  [77,295,631,40]
          SPAN.sand-plugins-row__trailing [720,305,67,20]
            SPAN.sand-plugins__added      67×20 · 已添加
```

### 3b. 类目桶 → two columns, titled 结果 (`效率` 63 items, `研究` 11 items)

```
SECTION                                     [65,231,734,2152]   ← no .sand-plugins__marketplace wrapper
  DIV                                       [65,231,734,34]
    H3 · 结果                                [65,231,48,34]      ← h3, 34px
  UL.sand-plugins__grid                     [65,273,734,2110]
    LI.sand-plugins-row                     [65,273,363,64]
    LI.sand-plugins-row                     [436,273,363,64]
```

**No pagination.** 效率 renders all 63 rows into one scroll area (`scrollHeight 2202` vs
`clientHeight 652`); there is no 加载更多 / 下一页 affordance anywhere in the dialog. "翻页" is
continuous vertical scroll.

## 4. detail page (插件详情)

```
DIV.sand-plugins-detail                      [65,231,734,458 … 677]
  DIV                                        [65,231,734,88]
    HEADER.sand-plugins-detail__header       [65,231,734,56]
      SPAN.sand-tool-icon 56×56              [65,231,56,56]
        IMG 55×55
      DIV                                    [133,237,504,44]
        DIV                                  [133,237,504,24]
          H3 · Ahrefs                          [133,237,50,24]
          BUTTON[aria-label=复制此插件的链接]   [187,239,20,20]
        SPAN                                 [133,263,504,18]
          A[href=…] · 查看源码 + external icon
      DIV                                    [649,241,150,36]
        BUTTON.sand-kit-button · 分享          [649,241,82,36]
        BUTTON.sand-kit-button · 添加 / 卸载    [739,241,60,36]
  P.sand-plugins-detail__desc                 [65,299,734,20]
  DIV.sand-ou54vl                             [65,343,734,346 … 565]
    … 账户 / 工具 / 应用 / 信息 …
```

Observed label set: `复制此插件的链接`, `查看源码` (link, `https://github.com/cursor/plugins`),
`分享`, `添加` (not installed) / `卸载` (installed), `账户`, `工具`, `应用`, `信息`.

Sections, in order, and which ones are conditional:

| 分区 | present when | measured |
|------|--------------|----------|
| 账户 `sand-plugins-detail__accounts` | installed | `[65,373,734,85]`; `default` row 42px + `编辑 default 账户` (10×10) + `sand-plugins__status` 已连接; divider `[77,415,710,1]`; `sand-plugins-detail__add-account` 43px |
| 工具 `sand-plugins-detail__tools` | installed | `[65,504,734,42]`; `已启用 23/23 个` + chevron |
| 应用 `sand-plugins-detail__connectors` | always | header row 30px (`应用` + count), list 58px (`ahrefs` / `连接器`) |
| 信息 `dl` | always | rows 42px, divider 1px between; see below |

信息 rows — **only the fields the entry actually carries are rendered**:

| 字段 | value | seen on |
|------|-------|---------|
| 功能 | `1 个应用` | both |
| 开发者 | `Cursor` | both |
| 类别 | `研究` / `精选` | both |
| 网站 | `cursor.com` | **both** ← 2026-10-04 更正，原写「Ahrefs only」 |
| 可用性 | `公开` | **both** ← 同上 |

**2026-10-04 值级更正（13:0x）**：上表原本把 `网站`/`可用性` 标成「Ahrefs only」。重新在官方实机上读
Gmail（已安装 + `已连接`）的 `dl`，**五行全在**：

```
功能   1 个应用
开发者 Cursor
类别   精选          ← categoryKey = FEATURED
网站   cursor.com    ← 取自 websiteUrl
可用性 公开
查看源码 href = https://github.com/cursor/plugins   ← 取自 repositoryUrl
```

所以「只有部分字段出现」这个结论是错的：这条目五项俱全，且 `网站` 与 `查看源码` 来自**两个不同字段**。
另有 1inch（PAYMENTS）读到 `类别 支付 / 网站 business.1inch.com`，1inch 的 `查看源码` 另指仓库。

### 类别标签不是桶标题

`PAYMENTS` 归入桶 `finance`（桶标题 `财务`），但详情页 `类别` 读 **`支付`**。两套标签互相独立，
不要拿 `CATEGORY_BUCKET_LABELS` 顶替。

### 官方自己的类别标签表（16 条，勿猜）

表在 asar 的 `const E={FEATURED:{id:"FkMol5"},…}`（与浏览页分区 key 同一个函数），
每条 `id` 再去 zh-CN 消息表取值：

| categoryKey | messageId | zh-CN |
| --- | --- | --- |
| FEATURED | FkMol5 | 精选 |
| INFRASTRUCTURE | Mo77P4 | 基础设施 |
| DATA_ANALYTICS | svH45G | 数据与分析 |
| PRODUCTIVITY | N42ane | 效率 |
| PAYMENTS | H0ShEF | 支付 |
| AGENT_ORCHESTRATION | byAjqm | 智能体编排 |
| CANVAS | Zty/IJ | 画布 |
| INBOX_AND_COLLABORATION | IzFMeN | 收件箱与协作 |
| SCHEDULING | DbZMYM | 日程安排 |
| DOCUMENTS_AND_FILES | gDShYL | 文档与文件 |
| SALES | mUv9U4 | 销售 |
| CUSTOMER_SUPPORT | n+xLOH | 客户支持 |
| FINANCE_AND_LEGAL | hxm6On | 财务与法务 |
| RESEARCH | bdztP2 | 研究 |
| DESIGN | f8fH8W | 设计 |
| LOGIN_AND_CREDENTIAL_MANAGEMENT | 3Ia71M | 登录与凭据管理 |

相关 id：`FGnQEW` = **添加其他账户**（详情页账户区那个加号行）、`HMUxPu` = 查看源码。

⚠️ **asar 里内联了约 31 种语言**，同一个 id 出现 31 次。按「第一次匹配」取值会拿到**土耳其语**
（`FkMol5` → `Öne çıkanlar`）；按固定窗口内的第一次匹配会拿到**意大利语**
（`svH45G` → `Dati & analisi`，它在 @14608247，而意大利语那份在 @14559543）。
正确做法是**取离 zh 锚点（`FkMol5` = 精选）最近的那次定义**。

Captured pairs: Gmail (installed, 账户+工具 present, 信息 = 功能/开发者/类别) and Ahrefs
(not installed, no 账户/工具, 信息 = 功能/开发者/类别/网站/可用性). Every non-installed app in
效率 showed the `添加` trailing button (60 of 63).

## 5. Reproduce

```sh
"/Applications/Grok Bot.app/Contents/MacOS/Grok Bot" --remote-debugging-port=9224 &
curl -s http://127.0.0.1:9224/json/list   # pick the page whose url contains "Grok%20Bot.app"
```

## 6. Negative findings — surfaces that do NOT open a page (2026-10-04)

Checked by pressing every remaining actionable element on the detail and manage pages. Each was
pressed 3× and, where the event type mattered, dispatched as a real pointer sequence
(`pointerdown → mousedown → pointerup → mouseup → click`) at the element's centre. Whole-dialog
`innerText` length and a `TreeWalker` text-node search over the entire dialog were used as the
oracle, because a single `innerText` on a subtree can read a mid-transition remnant.

| element | observation |
|---------|-------------|
| `工具` row (button + chevron) | box stays 42px with exactly 1 child; no tool name ever appears. **Does not expand.** |
| `添加其他账户` | dialog text unchanged, no new dialog. **Does not navigate.** |
| `编辑 default 账户` | same. **Does not navigate.** |
| `分享` | writes the clipboard; same URL as `复制此插件的链接`. |

A local bridge method `window.desktop.mcp.listServerTools(serverId)` exists and returns 23
`{name, description, isDisabled}` records for Gmail — but since 0.66 renders no tool list,
there is no surface to put it on. A bridge method is not a licence to invent UI.

**False positive to avoid repeating**: an early probe reported the 工具 row expanding to 23 tool
names (Create draft / List drafts / Get thread / …) and `querySelectorAll("div,li")` returning 47.
Re-checking, the whole dialog's `innerText` was 163 characters and a tree walk for those exact
tool names matched nothing. The early reading was wrong. Gate "did this interaction open
something?" on a full-document search plus repeated presses, not one subtree snapshot.

## 7. Manage page → detail recursion (verified both sides)

Official and the local build produce the *same* measurements:

| | official 0.66 | local |
|---|---|---|
| manage `h1` | 管理插件和技能 | 管理插件和技能 |
| installed rows | 48 | 48 |
| row order | 打开 Canva / 打开 Figma / 打开 Gmail | identical |
| row click | pushes `.sand-plugins-detail`, bar title `Canva` | identical |
| 返回 | back to 管理插件和技能, 48 rows | identical |

Canva's detail page reads identically on both, including the two details that are easy to get
wrong: `工具 已启用 0/0 个` (official renders `0/0` for a `needsAuth` connector too) and
`功能 1 个应用6 项技能` (connector and skill counts concatenated with no separator).

## 8. 添加 / 安装流程 — one-shot, no form (2026-10-04)

The brief asked for "添加到指定位置/分组". Checked whether 0.66's primary action opens anything.

| probe | result |
|-------|--------|
| `添加` on **Ahrefs** (0 credential fields) | dialog count unchanged, input count unchanged, detail text unchanged |
| `添加` on **Capital.com** (8 fields: `CAP_ENV`, `CAP_API_KEY`, `CAP_DRY_RUN`, `CAP_IDENTIFIER`, `CAP_WS_ENABLED`, `CAP_API_PASSWORD`, `CAP_ALLOWED_EPICS`, `CAP_ALLOW_TRADING`) | identical — **no credential form appears** |

The local catalog has 26 entries carrying `fields[]`; none of them is a surface 0.66 renders from
the detail page. So the primary action is a one-shot install with no intervening page, and the
"指定位置/分组" affordance does not exist on this surface in 0.66.

Side-effect check after pressing `添加` on the official build: still `已安装 8 个`, 48 manage rows,
neither Capital.com nor Ahrefs present — the press was a no-op on the official account.

`卸载` was deliberately **not** pressed on the official build: it would mutate the user's real
account. The local build implements it as a direct `mcp.remove`, which is the same one-shot shape
`添加` demonstrably has.

## 9. 双 app 同时在跑时的逐条对拍（2026-10-04 04:2x）

之前所有"与官方一致"的结论都来自**单侧观察**。这一节把两个 app 同时拉起、用**同一份 dumper**
读同一个弹窗，做逐条对拍——这是第一次拿到真正的 requirement 1 证据。

| | 官方 0.66.0 | 本地 |
|---|---|---|
| CDP | `:9224` | `:9232` |
| 启动 | `"/Applications/Grok Bot.app/…/Grok Bot" --remote-debugging-port=9224` | `open -a "/Applications/Grok Node.app" --args --remote-debugging-port=9232` |

### 9.1 首页区块逐条比对

| 区块 | 官方 | 本地 | 查看全部 官/本 | 结果 |
|------|------|------|--------------|------|
| 市场 | (容器) | (容器) | – | ✅ |
| 为你推荐 | 4 | 4 | 0/0 | ⚠️ 条目不同 |
| 精选插件 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 团队插件 | 1 | 0 | 0/0 | ⚠️ 本地为空 |
| 登录与凭据管理 | 1 | — | — | ❌ 本地缺此区块 |
| 效率 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 通信 | 4 | 4 | 1/1 | ⚠️ 条目不同 |
| 设计 | 4 | 4 | 1/1 | ⚠️ 条目不同 |
| 代码 | 4 | 4 | 1/1 | ⚠️ 条目不同（**本轮已修，见 §10**） |
| 数据 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 销售 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 财务 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 研究 | 4 | 4 | 1/1 | ✅ 完全一致 |
| 支持 | 3 | 2 | 0/0 | ⚠️ 条目不同 |

**行数与「查看全部」的位置全部对齐**（4 行区块一律带查看全部；`支持` 3 行不带）。差异全部落在
**选中了哪几条**，不在**渲染规则**。

### 9.2 数据面差异

| | 官方 | 本地 |
|---|---|---|
| `mcp.catalog()` 条数 | **404** | **393** |
| 带 `categoryKey` 的条目 | **253 / 404** | **0 / 393** |
| `isPublicListed` | 字段存在，403 条全为 `true` | 字段不存在 |
| 独有字段 | `pluginName` `repositoryUrl` `websiteUrl` `categoryKeys` `isPublicListed` | — |
| `mcp.teamPopularity()` | **0 条** | **0 条** |
| `mcp.list()` | 0 条 | 0 条 |
| 管理页已装行数 | 27 | 48 |

本地 catalog 是官方 catalog 的**严格子集**，只少 11 条、本地无任何多余条目：
`Google Docs` `Google Sheets` `Google Slides` `OneDrive` `Outlook` `Outlook Calendar`
`SharePoint` `Teams` `Finance` `X Money` `oh-my-claudecode`。

**更正一条先前的说法**：`isPublicListed` 不是筛选器（403/403 全 true），`teamPopularity()`
在官方侧**也是 0 条**——所以「为你推荐」缺团队信号是**双方一致的行为**，不是本地独有的降级。

### 9.3 `MCP` 类目在官方侧也没有归桶信号

官方 15 个类目枚举里有 `LOGIN_AND_CREDENTIAL_MANAGEMENT`，`MCP` **不在其中**；且官方自己
151 条 `MCP` 条目的 `categoryKey` **全为 null**。本地的 146 条同理。**两边都归不进任何桶**，
这是与官方一致的行为，不是缺陷。

## 10. 已修正的一处真实归桶错误：`AGENT_ORCHESTRATION`

把**官方自己的 404 条 catalog + 官方已装集合**喂进本地 `buildMarketplaceModel`，结果算出的
是**本地的答案**而不是官方的答案 —— 证明差异在**归桶规则**，不在数据。

反向验证假设（`AGENT_ORCHESTRATION` 归桶从 `code` 改为 `communication`）：

| 区块 | 官方实渲染 | 本地模型（改前） | 本地模型（改后） |
|------|-----------|----------------|----------------|
| 代码 | Amazon Location Service / Appwrite / AWS Amplify / AWS Core | Adapter / Amazon / Appwrite / Arize ❌ | **完全一致 ✅** |
| 通信 | ActiveCampaign / AgentMail / Ando / Bird | ActiveCampaign / AgentMail / Ando / Brevo ❌ | ActiveCampaign / Adapter / AgentMail / Ando ❌ |

两个独立观测支撑该修正：官方「代码」区**只有 Infrastructure**，无一条 Agent Orchestration；
`Bird` 在 catalog 里是 `Agent Orchestration`，却渲染在「通信」。

**仍未解释的**：`Bird` vs `Adapter`（同为 Agent Orchestration，官方收 Bird 舍 Adapter）、
`Canva`（官方放在「设计」，catalog 里是 Productivity）、`MailerLite`（官方放在「支持」，
catalog 里是 Inbox And Collaboration）。三者形态一致，指向官方还有一层**厂商级 override 表**
（模型里记作 `Te`）未被完整转写。bundle 里搜不到小写字面量 `"agent orchestration"`，
该表可能由后端 `categoryKeys` 推导或已移入 view chunk——**当前记为 open，未猜。**

## 11. 本轮踩到的取证工具坑

- **`/tmp/ladder-official.mjs` 是 `ladder-node.mjs` 的逐字节副本**——端口写的仍是 `9232`、
  匹配串仍是 `Grok%20Node.app`。用它取证官方会**静默拿到本地 app 的数据**（不报错、URL 一看
  就露馅）。两个 app 同名二进制 + 同形 dumper 时，**harness 必须核对端口与 URL 两处**。
- **asar 内 `.js` 总数 209 ≠ renderer chunk 数 101**。209 含 108 个 `node_modules` 与主进程
  bundle；真正的 renderer 资源是 `dist/renderer/assets/` 下的 **101** 个。此前汇报把两个口径
  混为一谈，**语法验证的实际对象是 101 个**（101/101 通过 `node --check`，从已部署 asar 抽出）。
- esbuild 产物把非 ASCII 转义成 `\uXXXX`：在产物 chunk 里 grep 中文**必然 0 命中**，
  必须先 `replace(/\\u([0-9A-Fa-f]{4})/g, ...)` 还原再搜。官方类名是 `sand-plugins__marketplace`
  （双下划线），写成单下划线也会 0 命中。

## 12. 厂商级 override：`canva` / `mailerlite`（2026-10-04 第二轮）

§10 修正 `AGENT_ORCHESTRATION` 后，残余三处里又确认了两处。两处都是**单条直接观测**，且各自
**独立**地让对应区块复现官方：

| 观测（官方实渲染） | catalog 类目 | 加 override 前 | 加 override 后 |
|---|---|---|---|
| `Canva` 出现在**设计** | `PRODUCTIVITY` | 设计 = Docs Canvas / Figma / Mobbin / PR Review Canvas ❌ | **完全一致 ✅** |
| `MailerLite` 出现在**支持** | `INBOX_AND_COLLABORATION` | 支持 = Intercom / Plain ❌ | **完全一致 ✅** |

实验方式：把**官方自己的 404 条 catalog + 官方已装集合**喂进本 `buildMarketplaceModel`，逐个
候选 override 组合跑一遍，看哪个组合让哪个区块命中：

```
(基线，无 override)                       commu:X  desig:X  suppo:X  -> 0/3
canva: ["design"]                         commu:X  desig:OK suppo:X  -> 1/3
mailerlite: ["support"]                   commu:X  desig:X  suppo:OK -> 1/3
canva + mailerlite                        commu:X  desig:OK suppo:OK -> 2/3
canva + mailerlite + adapter→{任意桶}      commu:X  desig:OK suppo:OK -> 2/3   ← adapter 换哪个桶都不解决通信
```

修完后的整体命中（同一实验，8 个桶）：

```
X  communication   ActiveCampaign / Adapter / AgentMail / Ando
                   官方: ActiveCampaign / AgentMail / Ando / Bird
OK design          Canva / Docs Canvas / Figma / Google Slides
OK support         Intercom / MailerLite / Plain
OK code            Amazon Location Service / Appwrite / AWS Amplify / AWS Core
OK data / sales / finance / research   全部逐条一致
=> 命中 7/8
```

### 仍未解释的一处：`Bird` vs `Adapter`

两者 catalog 里的 `categoryKey` 都是 `AGENT_ORCHESTRATION`，**目录下标也完全相同**
（Adapter=3、Bird=49，两个 catalog 一致），且官方渲染 `Bird` 舍 `Adapter`。逐字段比对：

| 字段 | Adapter | Bird | 能否区分 |
|---|---|---|---|
| `isPublicListed` | true | true | 否 |
| `fields` | 0 | 0 | 否 |
| `connectors` | 1 | 1 | 否 |
| `skills` | 1 | 2 | 否（无阈值规则可解释） |
| `categoryKey` / `categoryKeys` | 相同 | 相同 | 否 |
| `repositoryUrl` / `websiteUrl` | 均存在 | 均存在 | 否 |

**没有任何可读字段能区分这两条**。且全 asar 搜小写字面量 `"agent orchestration"` **零命中**，
说明官方那张 override 表不是以明文字面量存在于 bundle（可能由后端 `categoryKeys` 推导，
或已移入 view chunk）。**按 evidence-only，此处保持 open，不拟合。**

## 13. 部署后实机复验（新包）

打包 → `ditto` 覆盖 → 重新拉起，在**新部署版**上重跑 §9 的同一 dumper：

| | 修正前 | 修正后 |
|---|---|---|
| 条目级完全一致 | 6/14 | **8/14** |
| 代码 | ⚠️ | **✅** Amazon Location Service / Appwrite / AWS Amplify / AWS Core |

（设计 / 支持 两区的提升要在本轮第二个包部署后才会在实机上体现，见 §14。）

## 14. 取证工具的第二个坑：弹窗状态会被前面的探测带跑

连续用多个脚本探同一个 app 时，**弹窗会停在上一个脚本留下的页面**。实测两次踩到：

- 官方 app 停在**管理页**（`管理 / 管理插件和技能 / 已安装 / 私有技能`），于是「点行进详情」
  找不到行，误判成"官方没有详情页"
- 本地 app 停在**某个私有技能的详情页**（`add-connector`，页头 `信息 / 技能内容`），同理

**判据**：取证脚本开头必须先断言"当前处于我要测的那一层"（读 heading 集合），不符就先
`button[aria-label="关闭"]` 关掉重开。**跨脚本复用弹窗状态 = 跨脚本继承上一个结论的错误前提。**
另：管理页的返回不是 `aria-label="返回"`（那是详情页的），只有正文里的 `‹ 市场` 条。

## 15. 第二个包部署后的最终实机对拍

三处修正（`AGENT_ORCHESTRATION→通信`、`canva→设计`、`mailerlite→支持`）全部进入部署版并
在实机上生效。**条目级完全一致 6/14 → 9/14**。

按差异根因归类（14 个区块，逐条判）：

| 判定 | 数量 | 区块 |
|---|---|---|
| ✅ 逐条一致 | **9** | 市场 / 精选插件 / 效率 / 代码 / 数据 / 销售 / 财务 / 研究 / 支持 |
| ⚪ 仅差 catalog 缺条目（代码无责） | 2 | 团队插件（`oh-my-claudecode` 不在本地 catalog）、设计（`Google Slides` 不在本地 catalog，其余 4 条已一致） |
| ⚪ 两侧同为未登录态（**与官方一致**） | 1 | 为你推荐（`teamPopularity()` 官方侧也是 0 条；截图的 4 条来自官方登录账号） |
| ⚪ 整块缺失，因条目不在**任何一侧** catalog | 1 | 登录与凭据管理（`1Password`，官方 404 条与本地 393 条均无） |
| ❗ 真正的代码问题 | **1** | 通信（`Bird` vs `Adapter`，见 §12） |

**结论：14 个区块里只有 1 个是真正的代码问题**，其余 4 个差异全部落在 catalog 数据面
（本地是官方 catalog 的严格子集，少 11 条），或本就是与官方一致的行为。

## 16. `分享` 不是降级实现：官方 0.66 自己就写剪贴板（2026-10-04）

先在官方 app 上挂钩 `navigator.share` 与 `navigator.clipboard.writeText`，再按「分享」：

| 观测项 | 结果 |
|---|---|
| `navigator.share` | **从未被调用** |
| `clipboard.writeText` | 调用 2 次，值都是 `https://x.ai/bot/plugin/45893410` |
| 新对话框 | 1 → 1（无） |
| 菜单/浮层 `[role=menu]/[role=listbox]` | 0 → 0（无） |
| iframe | 0 → 0（无） |
| 详情页文本长度 | 159 → 161（差 2 字符，是复制成功的微文案，不是面板） |

按「复制此插件的链接」得到**同一个 URL**。**结论：官方 0.66 的「分享」就是写剪贴板，写的是插件自身 URL。**
本地 `sharePlugin` 与之**完全一致**——原 D5「降级实现」判定**不成立，撤销**。

「添加到指定位置/分组」的缺失仍按 §8 的实机证据保持：官方 0.66 **没有**这个界面
（对 0 字段的 Ahrefs 与 8 字段的 Capital.com 点「添加」，弹窗数/输入框数/详情文本均不变），
所以本地不实现它**不是遗漏**。

## 17. `通信` 残差的穷尽假设测试（全部否掉）

| 假设 | 命中 | 失败的桶 |
|---|---|---|
| 现状：`AGENT_ORCHESTRATION→communication` | **8/8** | communication |
| `AGENT_ORCHESTRATION→productivity` | 7/8 | productivity, communication |
| `AGENT_ORCHESTRATION→productivity` + `bird→communication` | 8/8 | productivity |
| `AGENT_ORCHESTRATION→data` + `bird→communication` | 8/8 | data |
| `AGENT_ORCHESTRATION→research` + `bird→communication` | 8/8 | research |

事实链：目录下标 `ActiveCampaign=2 / Adapter=3 / AgentMail=7 / Ando=19 / Bird=49`（两个 catalog
完全一致）；官方渲染 `2,7,19,49` —— 即**跳过 3、25、26、30、37 全部 Agent Orchestration，却又收下 49**。
已逐字段排除：`isPublicListed`(全 true)、`fields`(0/0)、`connectors`(1/1)、`skills`(1/2)、
`categoryKey`/`categoryKeys`(相同)、同名去重(Adapter/Bird 各仅 1 条)。

**任何"把 Agent Orchestration 整体挪走"的方案都会立刻破坏它落进去的那个桶**，因此残余**不是一条
简单映射错**，要复原必须知道上游 `groupCatalog` 的真实实现——而该实现不以可读字面量存在于
bundle（搜 `"agent orchestration"` 零命中）。**按 evidence-only 保持 open，不拟合。**

## 18. 找到上游真源：browse-model chunk 只有 12,928 字节（2026-10-04 05:2x）

前面 §10/§12/§17 一直在反推归桶规则，方向部分错了。**那个 chunk 从头到尾只有 12,928 字节**，
之前只看了 `AGENT_ORCHESTRATION` 附近 2.6KB 就下了结论。完整读出后拿到上游三张表与判定函数。

真源：`/Applications/Grok Bot.app` → `dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js`

```js
const Ce = ["credentials","productivity","communication","design","code","data","sales","finance","research","support"];
const Le = { LOGIN_AND_CREDENTIAL_MANAGEMENT:"credentials", PRODUCTIVITY:"productivity",
             INBOX_AND_COLLABORATION:"communication", SCHEDULING:"communication", SALES:"sales",
             CUSTOMER_SUPPORT:"support", PAYMENTS:"finance", FINANCE_AND_LEGAL:"finance",
             DATA_ANALYTICS:"data", DESIGN:"design", CANVAS:"design",
             DOCUMENTS_AND_FILES:"productivity", INFRASTRUCTURE:"code", RESEARCH:"research" };
const Ne = { marketing:"sales", sales:"sales", design:"design", engineering:"code", product:"productivity",
             operations:"productivity", "recruiting & people":"productivity", productivity:"productivity",
             research:"research" };
const Te = { slack:["communication"], notion:["productivity"], "notion-workspace":["productivity"],
             linear:["productivity"], figma:["design"], tldraw:["design"], github:["code"],
             "github-plugin":["code"], runlayer:["code"], langfuse:["data"], parallel:["research","data"],
             superpowers:["code"], "compound-engineering":["code"], "create-plugin":["code"],
             "context7-plugin":["research"], context7:["research"] };

ke = e => e.trim().toUpperCase().replace(/&/gu," AND ").replace(/[^A-Z0-9]+/gu,"_").replace(/^_+|_+$/gu,"")
Y  = e => e.toLocaleLowerCase("en-US")

Oe = e => { const i = e.categories.length>0 ? e.categories : [e.category]; … 去重 }
Ue = e => { for (const t of [e.pluginName, e.name]) { const n = Te[Y(t.trim())]; if (n!==undefined) return n } }
Re = e => { const t = Ue(e); if (t!==void 0) return t;
            const n = e.categoryKeys ?? (e.categoryKey===void 0 ? [e.category] : [e.categoryKey]);
            return x(n.flatMap(i => { const o = Le[ke(i)]; return o===void 0 ? [] : [o] })) }   // ← 数组求并集，缺失的 key 丢弃
Me = e => x(Oe(e).flatMap(t => { const n = Ne[Y(t.trim())]; return n===void 0 ? [] : [n] }))   // ← 只用于 bots

ve = (e,t) => { … for (const o of e) if (o.marketplace===void 0) for (const s of Re(o)) … 
                return Ce.flatMap(o => n.has(o)||i.has(o) ? [{id:o, filterKey:B(o), plugins:…, bots:…}] : []) }
```

**三处关键**：

1. **`Le` 里没有 `AGENT_ORCHESTRATION`，也没有 `MCP`** → 这些条目**归不到任何桶**，这是上游行为。
   我 §10 加的 `AGENT_ORCHESTRATION: "communication"` 是**错的**，已回退。
2. **`Re` 对 `categoryKeys` 数组求并集**，且 `Le` 未命中的 key **被丢弃而非兜底**。
3. **`Me`/`Ne` 服务于 bots（Agent），不是插件**；主页分区只用 `Re`。

### 18.1 唯一真机制：多值 `categoryKeys`

在官方 app 内直接读 `mcp.catalog()`（404 条，**253 条带 `categoryKeys` 数组**）：

| 条目 | `categoryKeys` | 推导 | 官方实渲染 |
|---|---|---|---|
| `Bird` | `["AGENT_ORCHESTRATION","INBOX_AND_COLLABORATION"]` | 前者丢弃 → **communication** | 通信 ✅ |
| `Adapter` | `["AGENT_ORCHESTRATION"]` | **无桶** | 不出现 ✅ |
| `Arize` | `["AGENT_ORCHESTRATION"]` | **无桶** | 不出现 ✅ |
| `Canva` | `["PRODUCTIVITY","DESIGN"]` | **两桶** | 同时出现在 效率 与 设计 ✅ |
| `MailerLite` | `["INBOX_AND_COLLABORATION","CUSTOMER_SUPPORT"]` | **两桶** | 同时出现在 通信 与 支持 ✅ |
| `Figma` | `["PRODUCTIVITY","DESIGN"]` | `Te[figma]` 先命中 → `["design"]` | 设计 ✅ |
| `Mobbin` | `["DESIGN"]` | design | 设计 ✅ |
| `Brevo` | `["INBOX_AND_COLLABORATION"]` | communication | 通信 ✅ |

**§10/§12/§17 追了半天的 `Bird` vs `Adapter`、`Canva`、`MailerLite`，答案是同一个**：
`categoryKeys` 是多值数组，一条条目可以合法地落进多个桶。没有任何 mystery。

### 18.2 本地 catalog 缺这个字段 → 两条补偿

本地 `mcp.catalog()`（393 条）的字段只有
`id, name, displayName, description, category, homepage, iconUrl, connectors, skills, fields, publisher`
—— **没有 `categoryKey`、没有 `categoryKeys`、没有 `categories`**，只有人读标签 `category`。
因此 `Re` 的数组分支永远退化成 `[category]`，`PRODUCTIVITY|DESIGN` 这类信息在本机**不可得**。

于是保留两条**明确标注为数据缺口补偿、非上游规则**的 slug 级 override，并各自写明对应的上游原值：

| slug | 补偿 | 上游真实成因 |
|---|---|---|
| `canva` | `["design"]` | `categoryKeys = ["PRODUCTIVITY","DESIGN"]` |
| `mailerlite` | `["support"]` | `categoryKeys = ["INBOX_AND_COLLABORATION","CUSTOMER_SUPPORT"]` |

**后端一旦下发 `categoryKeys`，这两条即可删除。** 代码里以 `DATA-GAP COMPENSATIONS` 单独成块标注。

`Bird`/`Adapter` **不做补偿**：上游成因同样是数组字段，本地无法区分，按 evidence-only 记为数据面限制。

## 19. 部署版完整阶梯走查 + 9 个类目页全量普查（2026-10-04 05:4x）

在**当前部署版**（含 §18 真源转写）上，用同一份脚本同时读两个 app。

### 19.1 层级阶梯逐层可通

| 层 | 观测 |
|---|---|
| L0 市场首页 | 13 个标题、43 行、**9 个「查看全部」** |
| L1 精选插件类目页 | 页头 `精选插件`、**单列 734px**、`.sand-plugins__marketplace` 包裹层**在**、`H1 精选插件 22px`、6 行 |
| L2 应用详情页 | 页头 `Gmail`、四个分区 `账户 / 工具 / 应用 / 信息`、动作 `复制此插件的链接 · 分享 · 卸载 · 编辑 default 账户 · 添加其他账户 · 已启用 23/23 个`、源码 `https://github.com/cursor/plugins` |
| 逐层返回 | `Gmail 详情` → `精选插件/精选插件` → `市场/为你推荐/…/支持`；**回到 L0 后不再有返回键**（栈底） |

弹窗几何 800×702，与取证时一致。

### 19.2 9 个类目页全量普查（两侧同脚本）

| 类目页 | 官方行数 | 本地行数 | 官方行宽 | 本地行宽 | 包裹层 官/本 | 分页控件 |
|---|---:|---:|---:|---:|---|---|
| 精选插件 | 6 | **6** | 734 | **734** | True / **True** | 两侧均无 |
| 效率 | 63 | 55 | 363 | **363** | False / **False** | 两侧均无 |
| 通信 | 29 | 17 | 363 | **363** | False / **False** | 两侧均无 |
| 设计 | 12 | 10 | 363 | **363** | False / **False** | 两侧均无 |
| 代码 | 53 | 51 | 363 | **363** | False / **False** | 两侧均无 |
| 数据 | 39 | **39** | 363 | **363** | False / **False** | 两侧均无 |
| 销售 | 16 | 14 | 363 | **363** | False / **False** | 两侧均无 |
| 财务 | 25 | **25** | 363 | **363** | False / **False** | 两侧均无 |
| 研究 | 11 | 10 | 363 | **363** | False / **False** | 两侧均无 |
| **合计** | 248 | 227 | | | | |

**形态三项（行宽 / 包裹层 / 有无分页控件）9 个页面全部两侧一致**，首页「查看全部」同为 9 个。
行数差 21 的来源可分解：本地 catalog 比官方少 11 条（§9.2 的严格子集），其余来自 `categoryKeys`
不可得导致的额外归桶（§18.2）。`数据`、`财务`、`精选插件` 三页行数**完全相同**。

### 19.3 取证工具的第三个坑：导航后旧的元素引用已失效

普查脚本第一次跑，9 个页面量出来的**全是同一个页面**。原因：我在导航**之前**把 9 个「查看全部」
按钮存进数组，返回首页后再 `btns[k].click()` —— 那些节点早就随页面切换被卸载了，
`click()` 静默无反应。

**判据**：任何"逐个点 N 个同层按钮"的脚本，**每次迭代都必须重新查询**，
不能在循环外缓存 `querySelectorAll` 的结果。症状是"所有测得值都相同"或"第一项对、其余全错"。

## 20. 核验脚本的实测输出（2026-10-04 06:57，HEAD a62e693）

本节是 `node scripts/verify-marketplace-parity.mjs` 的**原样输出**，不是转述。数字以本节为准。

```

■ 上游真源（本机 0.66 的 browse-model chunk）
  ✅ chunk 存在且为 12,928 字节  — 实际 12928 字节
  ✅ Le 表逐条一致（14 条）
  ✅ Le 中确无 AGENT_ORCHESTRATION / MCP
  ✅ Te 表 16 个上游 slug 全部转写  — 额外 slug（须为补偿项）: canva, mailerlite
  ✅ CATEGORY_BUCKET_ORDER 等于上游 Ce

■ 部署版字节（/Applications/Grok Node.app）
  ✅ 第一层投影 toPlugin 保留 categoryKeys
  ✅ 第二层投影 marketplacePluginToView 保留 categoryKeys  — main.cjs 中共 5 处
  ✅ renderer chunk 逐个 node --check（101 个）
     通过 101/101
  ✅ 市场 UI 文案在产物中（先还原 \uXXXX 再匹配）

■ 实机逐区块对拍（需要两个 app 同时带 CDP 端口运行）
  ✅ 官方 9224 读取成功  — 14 个区块
  ✅ 部署版 9232 读取成功  — 13 个区块

     共有区块 13 个，逐行完全一致 10 个
       ✅ 市场
       ⚠️  为你推荐
            官方: Agent Compatibility / Aikido / Aleph / Algolia Productivity
            本地: ActiveCampaign / Adobe Developer App Builder / AgentMail / Airtable
       ✅ 精选插件
       ⚠️  团队插件
            官方: oh-my-claudecode
            本地: —
       ✅ 效率
       ✅ 通信
       ⚠️  设计
            官方: Canva / Docs Canvas / Figma / Google Slides
            本地: Canva / Docs Canvas / Figma / Mobbin
       ✅ 代码
       ✅ 数据
       ✅ 销售
       ✅ 财务
       ✅ 研究
       ✅ 支持
       ❌ 登录与凭据管理（本地无此区块：官方: 1Password）

     剩余差异请对照 docs/MARKETPLACE-066-EVIDENCE.md §18–§20 归因：本地 catalog 是官方
     catalog 的严格子集（少 11 条），1Password 不在任何一侧 catalog，为你推荐 因
     teamPopularity() 双方同为 0 —— 均属数据面，不是渲染行为差异。

✅ 静态核验全部通过

```

### 三处历史数字的修正记录

| 读数 | 何时 | 数字 | 之后 |
|---|---|---|---|
| 拟合 override 时代 | ~05:20 | 6/14 | 其中 2 处靠上游不存在的 override 凑出，作废 |
| categoryKeys 修复前 | ~06:0x | 8/12 | 通信 因缺数组键而差一条，作废 |
| **当前** | **06:57** | **10/13（剔除 `市场` 容器即 9/12）** | 残余 4 处全为 catalog 数据面 |

> `市场` 是弹窗容器标题，两侧 `row__name` 均为空，属**退化相等**——计入会让分母多一个没有信息量的区块。

---

## 21. CTA 几何取证与修复（2026-10-04 10:0x–13:2x）

验证器指出「Row CTA and detail CTA computed styles/geometry」缺证据。补齐后**发现四处真实缺陷**，
全部是「类名看起来合理但几何不对」——typecheck、884 条测试、打包、签名全部照常通过，肉眼可见。

### 两侧 catalog 原始 payload（补验证器的 catalog 缺口）

| | 官方 0.66 | 本地 Grok Node |
|---|---|---|
| `mcp.catalog()` 总条数 | **404** | **393** |
| 带 `categoryKey` | 253 | 247 |
| 带 `categoryKeys` 数组 | 253 | **247**（修复前为 0） |
| `publisher.isUserOwned === true` | 93 | **93** |
| distinct `categoryKeys` | 15 个，与本地**完全相同** | 同 |

> ⚠️ 更正：PARITY 文档「又证伪一个假设」一节写「本地 `isUserOwned` 是 0 条」——**这个数字是错的**，
> 本地为 93，与官方相同。该节的**结论**（`isUserOwned` 不驱动 `可用性 公开/私有`，因为官方在
> Appwrite 上也显示「公开」）不受影响，是依据官方实机观测得出的，与这个计数无关。

### 四处缺陷与官方实测值

| # | 控件 | 修复前（本地） | 官方实测 | 根因 |
|---|------|--------------|---------|------|
| 1 | 列表行尾 `添加`/`连接` | **32×24**，无底色，文字 `rgba(252,252,252,.6)` | **46×26**，`padding 0 10px`，`radius 13px`，半透明填充，`font-weight 420`，`nowrap` | 类名用了一套**猜的** `sand-kit-button` 配方 |
| 2 | 详情页 `返回` | **36×28** | **28×28** | 与管理页返回**共用**了另一套配方 |
| 3 | `查看源码` | **52×18**，**图标完全缺失** | **69×18**，`<a>` 内含 13×13 `<i class="ui-icon">` | 图标被 append 到**外层** `sourceRow`，没进 `<a>` |
| 4 | `分享` | **78×36**，文本在前、14×14 裸字形在后 | **82×36**，`[sand-kit-icon 18×18][label span 28×20]` | 缺官方那个 18×18 图标盒 span，label 也没独立成 span |

两侧 DOM **结构**在这些控件上完全一致（`BUTTON`、纯文本、0 个元素子节点），差异全在**类名与子节点挂载**。
#3 #4 更反直觉：#4 的按钮配方类名**与官方逐字相同**，仅宽度差 4px——因为差的是子节点，不是配方。

### 类名可迁移性的定量结论

官方 0.66 的 54 个配方类里，**47 个**在 0.18 样式表中逐字存在（stylix 类名由声明内容决定）。
另外 7 个全部是**逻辑属性 vs 物理属性**的差异，且都是**控制**而非尺寸：

| 官方类 | 声明 | 0.18 等价类 | 声明 |
|---|---|---|---|
| `sand-1lun4ml` | `border-inline-end-width:1px` | `sand-s1s249` | `border-right-width:1px` |
| `sand-pilrb4` | `border-inline-start-width:1px` | `sand-e0pwq` | `border-left-width:1px` |
| `sand-18b5jzi` | `border-inline-end-style:solid` | `sand-32b0ac` | `border-right-style:solid` |
| `sand-1o3jo1z` | `border-inline-end-color:transparent` | `sand-he5wa1` | `border-right-color:transparent` |
| `sand-v5lvn5` | `border-inline-start-color:transparent` | `sand-1g4hjc` | `border-left-color:transparent` |
| `sand-1kneoy4` | `transition-duration:.14s` | `sand-bb3pvg` | `transition-duration:.14s` |
| `sand-e2zdcy` | `padding-inline-start:10px` | `sand-1lqa7cf` | `padding-left:10px` |

应用只跑 LTR，逻辑/物理形式在这些值上**逐字节等价**。`sand-button` 在**两边**的样式表里都没有规则，
是纯语义标记类，带上无副作用。**所以这里的对等是按像素衡量的，不是按类名字符串。**

### 未打包就验证配方：把类名注入运行中的 app

打包前先验了配方，避免「改完源码才发现不生效」：用 CDP 在**运行中的本地 app** 里按新类名造出这
四个控件，量它自己的样式表解析出的几何。四项全中，背景色与官方逐字节相同：

```
行尾 添加 : 46x26 | padding 0px 10px | radius 13px | fw 420 | nowrap
            bg color(srgb 0.220753 0.220753 0.220753 / 0.32149) | border 1px solid rgba(0,0,0,0) | fs 12px
详情 返回 : 28x28 | radius 9999px
详情 分享 : 82x36 | icon 18x18 | label 28x20
查看源码 : 69x18 | fs 13px | gap 4px
```

### 部署版验证（从 `/Applications` 的 asar 抽字节，非 `dist/`）

```
asar 内 .js 总数 436（含主进程与运行时），renderer 101，unpacked 227 —— 语法验证对象是 renderer 那 101 个
renderer chunk node --check: 101/101 通过
产物类名检查: 行尾添加 / 详情返回 / 分享图标盒 / 管理返回前缀 四项全部 ✅
codesign --verify --deep --strict: valid（asar 68,600,774 B，13:16）
npm test 884/884
```

## 22. 已知缺口：既有列表仍带 0.18 不定义的类（**未修，记录在案**）

`sand-yri2b{padding-inline-end:0}`、`sand-1c1uobl{padding-inline-start:0}`、
`sand-1firant{transition-duration:.12s}`、`sand-1iolv91{:focus-visible outline-color}` 这四个类
**在 0.18 样式表里不存在**，但仍**原样出现在若干既有列表**中（详情标题、关闭按钮、返回条等）——
它们是本轮之前就在的，不是新引入的。

- 这些控件在部署版里**实测尺寸全部正确**（关闭按钮 28×28、详情 `添加` 60×36、`分享` 本轮修好后 82×36），
  因为尺寸由显式的 `sand-gd8bvy`/`sand-1fgtraw` 之类钉住，缺失的这几个只影响 hover / focus / transition。
- 逐个替换会牵动十来个常量、远超「补四处 CTA 几何」的范围，故**本轮不做**，登记为已知缺口。
- 本轮新引入的列表已做干净：`DETAIL_BACK_BUTTON_CLASSES` 里 `sand-1firant`→`sand-gdialr`（精确等价）；
  `sand-yri2b`/`sand-1c1uobl` 直接省略并**给了证明**——裸 `<button>` 在本 app 里实测 `padding: 0px`
  （0.18 的 reset 清零），所以这两条声明可证明冗余。
- `tests/plugins-marketplace-renderer-patch.test.mjs` 的守卫目前**只覆盖本轮改动的列表**，
  并在本注释里指明其余是已知缺口，避免下一个人以为已经全局清理过。

### 取证过程中被自己推翻的三次

1. **「`sand-yri2b` 等三个类在官方也没有规则」** —— 错。正则 `\.cls[^{}]*\{` 会被伪类选择器骗过；
   官方实际有 `padding-inline-end:0` 等真实声明。改用「先 lookahead 定位类名，再截到 `}`」才读对。
   同一次误判还让 asar 内 `.js` 总数看起来是 0 命中。
2. **「官方 CSS 里没有 `sand-784prv` 规则」** —— 同一个正则错误，它实际是 `:focus-visible{outline-width:2px}`。
3. **「`sand-167g77z` 已从产物消失」** —— 这是我自己写的**错误断言**：`sand-167g77z`（`gap:8px`）除旧配方外
   还被 `DETAIL_ACTIONS_CLASSES` 等列表使用，产物里本来就该有。删掉这条断言而不是改断言去迎合结果。

> 教训与 §18 一致：**miss 一次先怀疑自己的查找串**；并且在写「某东西应该消失」这类断言前，
> 先确认它是不是被别处合法引用。

### 部署版实机复验（14:2x，钥匙串授权后）

四项修复在**真实运行的部署版**上逐项复核，与 0.66 实测值完全一致：

```
行数: 43
① 行尾 添加 : 46x26 | padding 0px 10px | radius 13px | fw 420 | nowrap | cls0=sand-button
              bg color(srgb 0.220753 0.220753 0.220753 / 0.32149)
② 详情 返回 : 28x28 | radius 9999px | cls0=sand-kit-icon-button
③ 查看源码 : 69x18 | href=https://github.com/ActiveCampaign/activecampaign-plugin
              childKinds=[text:查看源码, I.ui-icon]  iconInsideAnchor=true  iconSize=13x13
④ 分享     : 82x36 | childKinds=[SPAN.sand-kit-icon…, SPAN.sand-euugli…]
              iconSize=18x18  label=分享 28x20

✅ 行尾 添加           实测=46x26    官方=46x26
✅ 详情 返回           实测=28x28    官方=28x28
✅ 查看源码            实测=69x18    官方=69x18
✅ 查看源码 图标在 <a> 内 实测=true    官方=true
✅ 分享                实测=82x36    官方=82x36
✅ 分享 图标盒 18x18    实测=18x18    官方=18x18
全部通过: true | 返回栈正常: true
```

> ③④ 的背景色与官方逐字节相同；③ 的图标现在挂在 `<a>` 内（`childKinds` 可证），
> 这正是修复前 52px / 无图标的根因所在。

### 本轮自己踩的四个取证坑（都在 §18 那条教训的延长线上）

| 坑 | 现象 | 根因 | 修法 |
|---|---|---|---|
| **fd 提前关闭** | 从 asar 抽出来的全是垃圾，101/101 语法失败、类名一个都搜不到 | `fs.closeSync(fd)` 写在构建 bundle **之前** | 先读后关 |
| **`.js` 当 CJS 解析** | 101 个 chunk 全报 `Invalid or unexpected token` | 产物是 ESM（`import`），`node --check` 默认按 CommonJS | 临时文件用 `.mjs` |
| **伪类选择器骗过正则** | 断言「`sand-yri2b` 在官方也没有规则」——**错**，实际有 `padding-inline-end:0` | `\.cls[^{}]*\{` 在 `.cls:focus-visible{` 上仍能匹配，但把 `.cls` 之后到 `{` 之间的**另一条**规则体吃进来 | 先 lookahead 定位类名，再从该位置截到 `}` |
| **写了个错误的「应当消失」断言** | 断言产物里 `sand-167g77z` 应消失 | 该类（`gap:8px`）除旧配方外还被 `DETAIL_ACTIONS_CLASSES` 等合法引用 | 删掉断言，而不是改断言去迎合结果 |

另外一条跨探针的坑：`until()` 在不同探针里有的返回 `{ok,value}` 包装、有的直接返回值，
两次都栽在 `back.value` / `dlg` 上——**同一个 helper 在不同文件里语义不一致**。
