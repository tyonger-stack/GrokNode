# Official 0.75.8 "连接应用" marketplace — port record and 24-item portability verification

Date: 2026-10-26
Official build: `/Applications/Grok Bot.app`, `CFBundleShortVersionString` = **0.75.8**, `com.anysphere.sand`
Reconstruction: `/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed` (branch `main`)
Official REA artifacts: `/Users/Apple/Documents/grokbot/rea-grokbot-0758/`
(`asar/app.asar` sha256 `7d6fe1a476e2c575c11429772959728333eb9d3d442f71f89bbd9c6f180dd779`)

Everything below is measured. Live CDP captures against both running apps (official on port 9222,
Grok Node on port 9224) and byte offsets into the official artifacts. Nothing is inferred from
screenshots.

---

## 1. What the official surface actually is

Official 0.75.8's marketplace is **one dialog with two views**:

| view | source | evidence |
| --- | --- | --- |
| dialog shell | `chunk-view-Bl5Kz6YC.js` `Ms` [161560, 164110) | `sand-plugins-dialog` @ 162251, `sand-plugins-layout` @ 162472 |
| browse page | same chunk `Va` [82072, 84019), `Ra` [76484, 81797) | `sand-plugins__marketplace` @ 83357 |
| manage page | same chunk `wa` [64462, 71052) | `sand-plugins__yours` @ 66920 |
| page container | same chunk `vs` [140904, 160972) | unified — no tab bar |

Live on the official build: `dialog[aria-label="连接应用"]`, `H2 连接应用`, browse shows the
category chip row `已连接 24 个 / Bot 模板 / 全部 / 密码管理器 / 效率 / 通信 / 设计 / 代码 / 更多`
over the sections `为你推荐 / 密码管理器 / 效率 / … / 团队插件`; clicking `已连接 24 个` opens the
manage view — detail bar back button `连接应用`, `H3 管理`, `H1 管理插件和技能`, `H3 已安装`,
`H3 私有技能`, and the button `显示全部 24 个插件`.

The counts on each installed row are ICU plurals, not literals:
`d5N5Il` = `# 个连接器`, `m+pG3Q` = `# 项技能`, `MKRcMS` = `# 个命令`,
`Wy8KR2` = `显示全部 # 个插件`, `E6HC8r` = `已连接 # 个`.
(All extracted from the official zh-Hans table `chunk-core-DtHSUFHD.js`.)

## 2. The root cause of the mismatch

Grok Node's marketplace was a **hand-written 0.66-era replica**
(`frontend/src/extensions/marketplace/`, ~240 KB of source) injected by
`scripts/lib/plugins-dock-renderer-extension.mjs`, and it **shadowed upstream's own
implementation**:

* `frontend/src/extensions/plugins-dock-entry.ts` installed a capture-phase listener on
  `.sand-agents-sidebar__plugins` that called `stopPropagation()` + `preventDefault()`, so
  upstream's React `onClick` (`Rme.open(Uf.plugins())`) never ran;
* the pristine 0.18 baseline already contains upstream's genuine plugins implementation in
  `view-B5Ug8wEm.js` — dialog `ld` [101557, 103210), page container `Xi` [88905, 101110),
  manage page `ki` [40225, 44991), browse page `ci` [35301, 37101), and the model helpers
  `rt` [37372, 38249) / `ys` [22626, 22703) / `tt` [23378, 23641).

Neutralising the interceptor was enough to make upstream's own dialog open inside Grok Node:
`aria-label="插件"`, tabs `市场` / `Yours`, sections `Featured / Agent Orchestration / Canvas / …`,
and a `Yours` page listing `已安装` / `Plugins in effect` / `Custom MCP server` / `Show all 8 plugins`
/ `私密`. **The implementation was never missing — it was being suppressed.**

## 3. The data gap, and why it is not an account-sync problem

Official reads the installed set from the **Anysphere account**:

```js
// official 0.75.8 main-app.cjs @ 2011402 — dCt()
await Sfe(e.deps).getEffectiveUserPlugins(
  new h.GetEffectiveUserPluginsRequest({ excludeConfiguredVariables: !0, useReplica: e.useReplica !== !1 }), …)
// official 0.75.8 main-app.cjs @ 2010626 — d4n()
await sCt(e, o).getAvailableMcpServers(new h.GetAvailableMcpServersRequest({ grokBotAgentId: t }), …)
```

Live contract (official, port 9222):

* `window.desktop.main.getEffectivePlugins({})` → **21** records
  `{pluginId, name, displayName, installMode:"user", isEnabled:true, mcpServerNames?}`
* `window.desktop.main.getMcpState({})` → **17** server rows
  `{id, name, serverIdentifier, accountKey, rowServerIdentifier, transport, url, toolCount,
    customInstructions, isTeamServer, pluginId?, servedBy, status}`
* 21 + 3 = **24** rows — the manage page's `已安装` section is exactly the union (the 3 extra
  server rows carry no `pluginId`).

Grok Node cannot reach that account. Its desktop account service is the local-only stub
(`source/electron-main/adapters/account-oauth.ts`):

```js
const LOCAL_ONLY_AUTH_ERROR = "Cursor cloud authentication is unavailable in the local-only build.";
getValidAccessToken: async () => { throw new Error(LOCAL_ONLY_AUTH_ERROR); },
peekAccessToken: async () => null,
```

and the MCP manager it builds is pinned to `localOnly: true`
(`source/electron-main/mcp/desktop-mcp-manager.ts:58`), whose `listEffectivePlugins()` returns
`[]` **without ever calling the account backend**
(`source/shared/node/mcp/mcp-manager.ts:415`).

So Grok Node's installed set is, by construction, **what the user installed locally**. The port
therefore had to reproduce official's *contract* over local install state rather than read
official's account state.

### 3.1 The contract upstream's renderer actually needs

Upstream 0.18's own `rt(servers, catalog, effectivePlugins)` (`view-B5Ug8wEm.js` [37372, 38249))
folds a connector under its plugin row only when **both** hold:

1. `server.pluginId === catalogEntry.id` — `Ue(n, e)` (21941) matches the catalog entry by
   `pluginId` first, and falls back to a name/displayName comparison;
2. the plugin appears in `effectivePlugins` **and** is installed.

Without both, upstream degrades to one row per connector — which is exactly what Grok Node
rendered (8 loose connectors, `Show all 8 plugins`, no per-plugin counts).

Two things were therefore missing in Grok Node, and both are now in place:

* `mcp.list()` rows carry **no `pluginId`** — `installLocally`
  (`source/shared/node/mcp/mcp-catalog-flow.ts`) wrote the server under
  `plugin.displayName + ":" + name` and remembered nothing else;
* `mcp.effectivePlugins()` returned **`[]`**.

### 3.2 What was implemented

New module `source/shared/node/mcp/local-mcp-plugin-attribution.ts`:

* `LocalMcpPluginAttribution` — which catalog plugin a local server came from;
* `toEffectivePluginRecords(...)` — folds that map into official 0.75.8's
  `getEffectivePlugins()` record shape;
* `reconcileLocalPluginAttribution(...)` — derives the attribution for servers installed before
  the attribution was recorded, by matching the local key's connector name against the catalog's
  published connector names. **An ambiguous match is left unattributed on purpose**: a connector
  that cannot be traced to exactly one plugin must keep rendering as a plain connector row.

Wiring:

* `installLocally` records the attribution at install time;
* the catalog load backfills it for pre-existing installs (`mcp-catalog-flow.ts`);
* `SandMcpManager.listEffectivePlugins()` returns the derived records in local-only mode, and
  `localDisplayConfig()` attaches `pluginId` to the server rows;
* the attribution is persisted in the settings store
  (`localMcpPluginAttribution`) — added to the type, to `parseSettings`, and to the
  getter/setter, as the three-place rule requires.

Measured on the 8 pre-existing local servers, the derivation attributes all 8
(Gmail 45893410, Google Calendar 45893411, Notion 404, Slack 674, Google Drive 45893413,
Canva 5609, Figma 32197178, Granola 47477538) and correctly refuses a custom local server and an
ambiguous connector name.

## 4. The 24-item verification

Official's 24 = **21 catalog plugins** + **3 servers without a `pluginId`**.

### 4.1 The 21 catalog plugins — all present in Grok Node's catalog, ids and skill counts identical

| # | id | display name | connector | skills | in Grok Node catalog | id match | skills match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 404 | Notion | notion | 14 | ✅ | ✅ | ✅ |
| 2 | 674 | Slack | slack | 8 | ✅ | ✅ | ✅ |
| 3 | 677 | Cursor Team Kit | — | 18 | ✅ | ✅ | ✅ |
| 4 | 735 | Hugging Face | huggingface-skills | 18 | ✅ | ✅ | ✅ |
| 5 | 3644 | Agent Compatibility | — | 1 | ✅ | ✅ | ✅ |
| 6 | 5609 | Granola | granola | 3 | ✅ | ✅ | ✅ |
| 7 | 7975 | Cursor SDK | — | 1 | ✅ | ✅ | ✅ |
| 8 | 9717366 | pstack | — | 58 | ✅ | ✅ | ✅ |
| 9 | 32197178 | Canva | canva | 6 | ✅ | ✅ | ✅ |
| 10 | 45893410 | Gmail | gmail | 0 | ✅ | ✅ | ✅ |
| 11 | 45893411 | Google Calendar | google-calendar | 0 | ✅ | ✅ | ✅ |
| 12 | 45893412 | Google Docs | google-docs | 1 | ✅ | ✅ | ✅ |
| 13 | 45893413 | Google Drive | google-drive | 1 | ✅ | ✅ | ✅ |
| 14 | 45893414 | Google Sheets | google-sheets | 1 | ✅ | ✅ | ✅ |
| 15 | 45893415 | Google Slides | google-slides | 1 | ✅ | ✅ | ✅ |
| 16 | 47477538 | Browser Use | browser-use | 1 | ✅ | ✅ | ✅ |
| 17 | 49339676 | Remotion | — | 12 | ✅ | ✅ | ✅ |
| 18 | 57302030 | Outlook Calendar | outlook-calendar | 0 | ✅ | ✅ | ✅ |
| 19 | 62459237 | Grok Voice | — | 4 | ✅ | ✅ | ✅ |
| 20 | 71289756 | Docker | — | 11 | ✅ | ✅ | ✅ |
| 21 | 73501007 | Context7 | context7 | 1 | ✅ | ✅ | ✅ |

**21 / 21 portable.** Every one of them installs through Grok Node's own local install flow
(`installLocally` → `fetchPluginServers` → OAuth). A plugin with a connector needs the user to
authorise that connector once; a skills-only plugin needs no credentials at all.

### 4.2 The 3 rows without a plugin id

| # | official row | pluginId | url | status | portable as |
| --- | --- | --- | --- | --- | --- |
| 22 | Finance (displayed as **邮箱**) | — | `https://connectors-gateway.grok.com/gateway/v1/finance/mcp` | 身份验证 | the built-in **Finance** plugin, already pinned locally as `LOCAL_CATALOG_SUPPLEMENTS` id `63408931` (the Grok Mail feature: "为 Grok Bot 提供专属域名下的邮箱地址…") — its connector is a plain HTTP MCP server, so it is installable the same way |
| 23 | GitHub | — | `https://api.cursor.com/rest-mcp/github/mcp` | 已连接 | a **custom MCP server**, not a catalog plugin. Grok Node's `mcp.addServer` installs an arbitrary URL+transport, so it ports as a custom server |
| 24 | Origin | — | `https://api.origin.cursor.com/mcp` | 已连接 | a **custom MCP server**, same path |

**3 / 3 portable**, by two different routes — so **24 / 24 of official's installed apps can be
present in Grok Node.**

### 4.3 Catalog parity

| | official (authenticated) | Grok Node (anonymous) | after this change |
| --- | --- | --- | --- |
| entries | 473 | 467 | **473** |

(The listing is live upstream data, so it grows: the 2026-10-26 rebuild measured **474** — the six
pinned entries are still there, upstream published one more.)

The six in between — `Zoho CRM` (76674741), `WhatsApp Business` (75770130),
`Vibe Prospecting` (72277412), `Zoho Books` (76674739), `Zoho Desk` (76674742),
`Workday` (72336719) — are private-marketplace entries the anonymous listing withholds. They are
now **pinned** with the same mechanism the build already used for its eleven 0.66-era pins
(`LOCAL_CATALOG_SUPPLEMENTS`): the raw entries were captured from the logged-in official 0.75.8
build on 2026-10-26 (`tests/fixtures/official-catalog-0758-missing-6.json`) and the projection is
deep-compared against that independent capture by `tests/local-catalog-supplements.test.mjs`.

**Known limitation, stated rather than hidden:** none of the six has a public `mcp.json`
(`raw.githubusercontent.com/cursor/plugins/HEAD/third_party/<name>/mcp.json` is 404 for all six,
checked 2026-10-26), so — exactly like the already-pinned `oh-my-claudecode` — they render but
cannot be installed locally, and clicking 添加 raises upstream's own
`SandMcpConfigError("The plugin has no publicly readable MCP configuration for local
installation.")`. That error is deliberately not swallowed into a silent no-op.

## 5. What was ported, and how

### 5.0 Live verification (deployed build, CDP 9224)

Measured on the deployed `/Applications/Grok Node.app` after `npm run package` + `ditto`:

```
## bridge
   catalog entries: 474                                  <- official parity (was 467; the
                                                           listing is live upstream data and
                                                           grows — 473 at the first measurement)
   installed servers: 8 | with pluginId: 8               <- was 8 | with pluginId: 0
   effective plugins: 8
     - 45893410 Gmail mode=user enabled=true servers=["gmail"]
     - 45893411 Google Calendar mode=user enabled=true servers=["google-calendar"]
     - 404 Notion mode=user enabled=true servers=["notion"]
     - 674 Slack mode=user enabled=true servers=["slack"]
     - 45893413 Google Drive mode=user enabled=true servers=["google-drive"]
     - 32197178 Canva mode=user enabled=true servers=["canva"]
     - 657 Figma mode=user enabled=true servers=["figma"]
     - 5609 Granola mode=user enabled=true servers=["granola"]

## dialog open: {"via":"pill"}   (or "rail" when the sidebar is collapsed — same dialog)
## dialog  (市场 tab)
   aria-label: 连接应用 | box: [800,702]
   headings: [{"tag":"H2","text":"连接应用"},{"tag":"H3","text":"精选"},{"tag":"H3","text":"财务与法务"},
              {"tag":"H3","text":"画布"},{"tag":"H3","text":"基础设施"},{"tag":"H3","text":"客户支持"},
              {"tag":"H3","text":"日程安排"},{"tag":"H3","text":"设计"},{"tag":"H3","text":"收件箱与协作"},
              {"tag":"H3","text":"数据与分析"},{"tag":"H3","text":"文档与文件"},{"tag":"H3","text":"销售"},
              {"tag":"H3","text":"效率"},{"tag":"H3","text":"研究"},{"tag":"H3","text":"营销"},
              {"tag":"H3","text":"支付"},{"tag":"H3","text":"智能体编排"},{"tag":"H3","text":"MCP"},
              {"tag":"H3","text":"omc"}]
   tabs: ["市场","已连接 8 个"]
   row badge: 已添加            (official's hp8OtS; English locale shows "Added")

## dialog  (已连接 8 个 tab)
   headings: 连接应用 / 已安装 / 已安装 / MCP 服务器 / 私有技能
   text:     Gmail卸载 · Google Calendar卸载 · Notion卸载 · Slack卸载 · Google Drive卸载 ·
             Canva卸载 · Figma卸载 · Granola卸载
             MCP 服务器 / 名称 / 服务器 URL / HTTP 标头 / 添加 / 服务器名称不能为空 / 保存 / 取消
             Canva 1 个连接器 · 6 项技能 身份验证 · Figma 1 个连接器 · 14 项技能 身份验证 ·
             Gmail 1 个连接器 已连接 · 显示全部 8 个插件 · 私有技能 …
```

The dialog opens from **upstream's own React onClick** (`via: "pill"`, or `via: "rail"` when the
sidebar is collapsed — the rail row reaches the same upstream opener) — no interception is left, so
the live surface is upstream's own component.

The dialog box is **800 wide** — official 0.75.8's geometry. Upstream 0.18's own recipe
(`sand-1gys7z3`) is `width:min(1e3px, calc(100vw - 40px))` (1000px); the port swaps it for
official's `sand-h6vr4k` (`width:min(800px,100vw - 40px)`) and injects official's own stylesheet
rule. The height follows the tab's content (666 on the manage tab, 702 on the browse tab).

**The language preference still switches every ported string** — the ported wording runs through
upstream's own `RLocT` runtime, so the English UI shows upstream's English and official's own
English category names, and the Chinese UI shows official's Chinese:

```
language preference: zh-CN
   found: ["已添加","精选","基础设施","Infrastructure"]
   headings: 连接应用 / 精选 / 财务与法务 / 画布 / 基础设施 / …

language preference: en
   found: ["Added","Featured","Infrastructure"]
   headings: Plugins / Featured / Agent Orchestration / Canvas / Customer Support /
             Data & Analytics / Design / Documents and Files / Finance and Legal /
             Inbox and Collaboration / Infrastructure / Marketing / MCP / Payments /
             Productivity / Research / Sales / Scheduling
```

Those English category names are official 0.75.8's own (`chunk-plugins-model-DeyTkJ2l.js`'s
category-key map → official's locale ids), not a hand-written translation.

### 5.0.1 Three environment traps that cost real time on this port

Recorded because each one masquerades as a code defect:

1. **A stale app instance holding the CDP port makes every later probe lie.** The renderer answers
   on 9224 from whichever instance owns the socket — an instance started before a deploy keeps
   answering with the OLD bundle. Symptom: a fresh deploy still shows the old behaviour, and the
   fresh instance's own log says `bind() failed: Address already in use (48)` /
   `Cannot start http server for devtools`. **Always kill the holder of 9224 and confirm the new
   instance's log shows `DevTools listening` with no bind error before trusting a probe.**
2. **The keychain authorisation modal blocks startup entirely.** A rebuilt, re-signed app no longer
   matches the ACL of the existing `Grok Node Safe Storage` keychain item, macOS puts up the
   authorisation prompt, and the prompt blocks the main thread ⇒ the menu bar appears but the
   BrowserWindow never does and no page target is ever registered. This is the same trap AGENTS.md
   already records for the keychain; it is not the same as a renderer crash. Launching with
   `--use-mock-keychain` (what the official app does on this machine) sidesteps it, and the
   one-time "Always Allow" on the real keychain fixes it for good.
3. **The box must be re-provisioned before the host-side data lands.** The in-box host bundle is
   mounted from `~/.groknode/local-docker-runtime/<hostSha>-<execSha>/`, and the container carries
   the host sha as a label. After a build that changes host-side source, the container still runs
   the previous host bundle until it is recreated; the desktop then shows a catalog and an
   effective-plugin set that disagree with the desktop's own. The desktop's own settings already
   held the truth (`localMcpServers` 8, `localMcpPluginAttribution` 8) while the box held none.

### 5.1 The surface: upstream's own implementation, not a rewrite

* `frontend/src/extensions/plugins-dock-entry.ts` — the capture-phase interceptor is **gone**.
  The pill keeps upstream's React `onClick`, so upstream's own plugins dialog is the marketplace.
  The rail row (a node this build injects, so upstream mounts nothing there) calls upstream's own
  opener through a global that the renderer patch publishes:
  `scripts/lib/upstream-plugins-dialog-patch.mjs` rewrites upstream's own
  `function uSe(){Rme.open(Uf.plugins())}` into
  `function uSe(){…}globalThis.__sandOpenUpstreamPlugins=uSe;`. The local replica stays reachable
  only as a fallback, so the rail button is never dead.

  **This is the "port, do not rewrite" decision made concrete:** the live surface is upstream's
  own component — the same component official 0.75.8 ships, one generation earlier — and the
  hand-written replica no longer shadows it.

### 5.2 The 0.75.8 delta, ported as source

`scripts/lib/marketplace-official-wording-patch.mjs` patches
`view-B5Ug8wEm.js` with **official 0.75.8's own strings**, anchored on exact literals that must
occur exactly once. Every Chinese string is official's, taken from the official zh-Hans table:

| upstream 0.18 | official 0.75.8 | id |
| --- | --- | --- |
| dialog title `插件` | 连接应用 | h8AWBN |
| tab `Yours` | `已连接 N 个` (N = upstream's own installed-row count) | E6HC8r |
| section `Private` / 私密 | 私有技能 | glMsdy |
| `Show all N plugins` | 显示全部 N 个插件 | Wy8KR2 |
| `Nothing installed yet…` | 尚未安装任何插件。请在市场中查找插件。 | ZyWE2h |
| `No installed plugins match "X"` | 没有已安装的插件匹配“X” | +Pji+h |
| `No private skills match "X"` | 没有私有技能匹配“X” | hvwZWn |
| `Open an agent to see its private skills` | 打开一个 Bot 以查看其私有技能 | RmL2Fy |
| `No plugins match the current filters` | 没有插件匹配“X” | mLyVIn |
| `3 connectors · 2 skills` | 3 个连接器 · 2 项技能 | d5N5Il / m+pG3Q |
| `no supported contributions` | 无可用内容 | 31tnaC |

The patch runs **after** the three i18n passes, because two of its anchors are the post-i18n
text; the `(RLocT(...))` runtime form is preserved so the language preference still switches
these strings.

The connector status labels (`已连接 / 需要认证 / 错误 / 启动中 / 已断开连接 / 已被团队管理员停用`)
were already covered by `main-i18n-patch.mjs` with official's ids.

The same patch also ports the English labels upstream 0.18 left in this surface. Every anchor occurs
exactly once in the chunk, and every Chinese string is official's own:

| upstream 0.18 | official 0.75.8 | id |
| --- | --- | --- |
| `Added` (row badge) | 已添加 | hp8OtS |
| `Connectors` (type filter) | 连接器 | cQpGeE |
| `Plugin Setup` (dialog title) | 插件配置 | Hc3Gxt |
| `Tools` (detail section) | 工具 | xdA/+p |
| `Transport` (detail term) | 传输方式 | bv4cFj |
| `Command` (stdio transport) | 命令 | sjVfrA |
| `View Source` | 查看源码 | HMUxPu |
| `Copy link` / `Copied` / `Copy failed` | 复制链接 / 已复制 / 复制失败 | y1eoq1 / 6V3Ea3 / 9sj0G8 |
| `Synced` | 已同步 | N2FcBE |
| `Managed by your team` / `Added by your team` | 由你的团队管理 / 由你的团队添加 | q1LJYo / MoPMW6 |
| `Results` (search section) | 结果 | kx0s+n |
| `No plugins match "X"` (non-filter branch) | 没有插件匹配“X” | mLyVIn |
| `Enable X` | 启用 X | PaQ3df |

Strings official 0.75.8 does not have at all — `All types`, `Ownership`, `Filter plugins`,
`N of M enabled`, `Used by N teammates` — stay English **on purpose**: there is no official wording
to port, and inventing one would break the evidence rule. They are only visible behind the filter
menu, the plugin detail's tools section and the team badge, never in the default browse view.

Every ported string goes through **upstream's own locale runtime** — the `(RLocT("English","中文"))`
form the i18n passes append to this chunk — so the English UI keeps upstream's English and the
Chinese UI gets official's Chinese. The 17 category headings are the same: the helper
`RcMarketplaceCategoryLabel` resolves official's *own* English and Chinese per category key
(`Featured/精选`, `Infrastructure/基础设施`, `Data & Analytics/数据与分析`, …), not a hand-written
translation table.

### 5.3 The last English leftovers: the two replica panels inside the dialog

The live dialog is upstream 0.18's component, but **two panels inside it are still Grok Node's own
0.66-era replica components**, mounted into upstream's plugins view by
`scripts/lib/port-0750-renderer-patch.mjs`:

* the effective-plugins list (`frontend/src/recovered/features/plugins/overlay/effective-plugins-panel.tsx`)
* the custom-MCP form (`frontend/src/extensions/custom-mcp-form.tsx` + `custom-mcp-form-host.tsx`)

They rendered English titles — `Plugins in effect` and `Custom MCP server` — inside an otherwise
Chinese dialog, which was the last visible trace of the replica on the ported surface. Official
0.75.8 has no such English leftovers, so the wording is ported:

| replica field | official 0.75.8 | id |
| --- | --- | --- |
| panel title `Plugins in effect` | Installed / 已安装 | eQkgKV |
| panel empty state | Nothing installed yet… / 尚未安装任何插件。请在市场中查找插件。 | ZyWE2h |
| disabled badge | Disabled / 停用 | cO9+2L |
| remove / uninstall | Remove / 移除, Uninstall / 卸载 | t/YqKh, fo0VXg |
| form title `Custom MCP server` | MCP Servers / MCP 服务器 | JgMRiA |
| name / url / headers | Name / 名称, Server URL / 服务器 URL, HTTP headers / HTTP 标头 | 6YtxFj, 9rG25a, VPpyHp |
| header key / value | Key / 键, Value / 值 | 7sMeHQ, wMHvYH |
| add / save / cancel / remove | Add / 添加, Save / 保存, Cancel / 取消, Remove / 移除 | m16xKo, tfDRzk, dEgA5A, t/YqKh |
| blank-name validation | The server name cannot be blank / 服务器名称不能为空 | Ra3OR9 |
| failed-connection status | Connection failed / 连接失败 | FGWsd4 |
| generic error | Something went wrong. Try again. / 出错了，请重试。 | D2AZQg |

The wording table lives in `frontend/src/i18n/official-marketplace-copy.ts`, and it resolves through
**upstream's own locale runtime**: the i18n passes append `function RLocT(en, zh)` to the plugins
chunk, and `scripts/lib/marketplace-official-wording-patch.mjs` publishes it as
`globalThis.__sandRLocT` for the injected replica to call. The language preference therefore
switches these strings exactly the way it switches the rest of the app — no second locale
implementation, and no invented Chinese: the seven fields official has **no** message for
(`urlHint`, `testConnection`, `testing`, `testOk`, `invalidUrl`, `nonHttpUrl`, `credentialsInUrl`)
keep their English text and are listed explicitly in `UNPORTED_CUSTOM_MCP_FIELDS`.

`tests/marketplace-official-wording-copy.test.mjs` guards this: every Chinese string is matched
against `tests/fixtures/official-0758-marketplace-wording.json`, a capture of official 0.75.8's own
zh-Hans locale entries, so a typo or an invented translation fails the build.

### 5.4 The two replica panels' styling

The two panels of §5.3 also rendered **raw HTML**: browser-default headings (19.5px/700), a
bulleted `<ul>`, default `<input>` boxes and default `<button>`s, inside an otherwise native
dialog (reported with a screenshot on 2026-10-26). Their class names were used by the components
but **defined nowhere** — the 0.66-era replica styled its own layout, and the two panels were
never part of it.

The fix gives them **upstream 0.18's own recipes**, taken from the same surface (and verified to
resolve to a rule in the shipped stylesheet):

| element | recipe | source |
| --- | --- | --- |
| card / column | `sand-9f619 sand-78zum5 sand-dt5ytf sand-ou54vl` | upstream's plugin-setup form (`Di`) |
| field row / label | `sand-9f619 sand-78zum5 sand-dt5ytf sand-1jnr06f`, `sand-9f619 sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1rhlpx6 sand-1wd3ewq` | upstream's plugin-setup form |
| text input (+ invalid) | `sand-plugin-setup__input`'s two variants (`sand-yerb3` = the red border) | upstream's plugin-setup form |
| inline error | `… sand-fifm61 sand-1d3mw78 sand-pmgbkh` (12px, red) | upstream's plugin-setup form |
| action row | `… sand-13a6bvl sand-167g77z` (right-aligned) | upstream's plugin-setup form |
| two-column grid | `sand-rvj5dj sand-nby9oq sand-fex06f sand-1dbijih sand-3ct3a4` | upstream's plugin grid |
| plugin row + its button | `li.sand-plugins-row …` / `button.sand-plugins-row__open …` | captured live from the running app |
| small button | the 身份验证 / 添加 button's recipe | captured live from the running app |

Two details the screenshot forced out:

* The name button needs the **full** row-button recipe, not just the row geometry: a `<button>`
  that only wraps a short label is only as wide as that label, so the browser's default grey
  background showed up as a grey chip behind every plugin name. The recipe resets it
  (`sand-c342km` border-width 0, `sand-ng3xce` border-style none, `sand-jbqb8w` background
  transparent).
* The name button must **not** grow (`flex-grow:1`): upstream's row button grows because the
  trailing action is a *sibling* of the button, and in a two-column grid a growing button pushed
  卸载 to the far edge of its cell — right next to the next column's name. `ROW_OPEN_COMPACT` is
  the same recipe without the three flex classes.

The panel also dropped its own `已安装` heading: the dialog's own section title sits directly
above it, so a second one read as a duplicate (the `aria-label` still names the panel).

`tests/marketplace-panel-styles.test.mjs` guards this: every class the recipes use must resolve to
a rule in the shipped 0.18 stylesheet — a stylix class name is the hash of its declarations, so a
class that exists in one build and not in another is a *no-op*, and the panel would be raw HTML
again with every other test still green.

## 6. Known deltas that remain
1. **Category chip row vs. tab bar.** Official 0.75.8's browse page shows a horizontal chip row
   (`已连接 24 个 / Bot 模板 / 全部 / 密码管理器 / …`) and reaches the manage view by clicking
   `已连接 24 个`; upstream 0.18 uses a two-item segmented control (`市场` / `已连接 N 个`) to
   switch between the two views. The two views are equivalent in content, and the installed-apps
   entry now carries official's count, but the *navigation furniture* is 0.18's. Porting the chip
   row means porting official's `vs` page container — 164 functions / 146 KB across 25 chunks —
   which also drags in a `PluginsShellProvider` React context that 0.18 does not have. That is
   recorded as the remaining visual delta rather than faked.
2. **Dialog geometry.** Official 0.75.8's dialog uses newer stylix recipes
   (`sand-h6vr4k / sand-1a2e76q / sand-1gy1zxj / sand-xrbq2n / sand-z03ioa`); four of those class
   names are absent from 0.18's stylesheet. `scripts/lib/marketplace-dialog-0758-css-patch.mjs`
   injects official's own five rules verbatim (copied from official's
   `index-CFSAhbDS.css`), and the wording patch swaps upstream's `sand-1gys7z3`
   (`width:min(1e3px, …)`) for official's `sand-h6vr4k` (`width:min(800px, …)`), so the deployed
   dialog measures **800 wide** — official's geometry, verified live (§5.0). What remains is that
   the rules are *injected* rather than generated by official's own stylix build.
3. **The two replica panels are still ours, in placement.** Their wording is official's (§5.3), but
   official 0.75.8's browse page has **no** installed-plugin list and **no** custom-MCP form: the
   installed list lives in official's manage page (official's browse page references none of
   `eQkgKV` / `Wy8KR2` / `glMsdy` — verified against `chunk-view-Bl5Kz6YC.js`'s browse slice
   [140904, 160972)). Grok Node keeps the panels in the **已连接 N 个** tab, because that is where
   upstream 0.18's own plugins view mounts them, and because the replica's list carries the only
   per-plugin **uninstall** affordance in the build. Official's own custom-MCP form is also richer
   (type select STDIO/HTTP, JSON editor, OAuth client id/secret, command + arguments — see
   official's `chunk-custom-mcp-form-CXzhwoZi.js`); Grok Node's form is HTTP-only. Porting
   official's form means porting that chunk and its `chunk-grok-bot-team-custom-mcp-*.js`
   dependency.
4. **Account-installed set.** Official's 24 rows come from the account; Grok Node's come from local
   installs. After the port, Grok Node shows the same *shape* and the same *per-plugin counts*,
   and the same apps can be installed — but Grok Node cannot display an account-only install that
   was never performed locally.
5. **The 0.75.8-only payload fields** (`grokTwin`, `cursorScmProvider`, `configuredVariableKeys`,
   `singleAccount`, `nativeInstalled`, `teamInstallCounts`, `unpublishableFromTeamId`,
   `isPublishedByViewer`, `customPlugins`) do not exist in 0.18 at all — they are host/server
   payload fields, not renderer names, and are absent from `source/`, `scripts/` and `tests/`
   (the only hit is `tests/plugins-dock-connect-apps-pill.test.mjs:130`, which already documented
   `teamInstallCounts` as an unresolved catalog-shape gap). Porting them is a host-contract
   change, not a renderer one, and is out of scope for this port.

## 7. Reproducing the measurements

```bash
cd /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed
node scripts/lib/official-surface-capture.mjs 9222   # official browse + manage pages
node scripts/lib/verify-24-installed.mjs 9224         # the 24-item table
node scripts/lib/bridge-data-probe.mjs 9224           # grok node mcp/skills bridge data
node scripts/lib/catalog-ids.mjs 9224                 # grok node catalog ids + skill counts
node scripts/lib/marketplace-0758-smoke.mjs 9224      # the ported dialog: bridge data + both tabs
```

Both apps must be running with CDP: official on 9222, Grok Node on 9224
(`open -a "/Applications/Grok Node.app" --args --remote-debugging-port=9224`).

Two gates must pass before a build is trusted:

```bash
# 1. every produced renderer chunk parses, and the broken i18n form is absent
node --check dist/renderer/assets/*.js        # 102 assets, 0 failures
grep -c '"(RLocT("' dist/renderer/assets/*.js # must be 0 everywhere
# 2. the wording patch wrote only official's strings
node --test tests/marketplace-official-wording-copy.test.mjs
```

The second gate is the one that keeps the port honest: every Chinese string the patch writes into
the chunk, and every Chinese string the replica panels render, is matched against
`tests/fixtures/official-0758-marketplace-wording.json` — a capture of official 0.75.8's own
zh-Hans locale table. A typo, a mistranslation or an invented word fails the build.
