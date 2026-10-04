# 钉入 11 条 catalog 条目（2026-10-05）

用户拍板：「数据面那几项要补」。这是本项目里第一次**主动把服务端账号门后面的数据搬进本地**，
所以这份文档重点记的不只是做法，还有**我对风险的三次判断、其中两次是错的**。

## 一、这不是编数据，但一开始很像

`fetchMarketplaceMcpPlugins` 的结构（`source/shared/node/mcp/mcp-marketplace.ts:251`）：

```ts
const response = await client.listMarketplacePlugins({ excludeCloudAgentPlugins: true }, ...);
// 先无条件取公开列表
const includesPrivateMarketplaces = (await deps.bestEffortToken(getAccessToken)) != null;
if (includesPrivateMarketplaces) {
  // 只有拿到 token 才发第二次请求：listMarketplaces() -> 筛 teamId/userId 非空 -> 逐个取插件
  ...
}
```

`includesPrivateMarketplaces` **本身就是「有没有 token」**。本地版 `account.login()` 是写死的桩
（`preload.ts:215`），所以永远拿不到，那 11 条永远不来。

**两条独立的合法来源**，缺一不可：

| 用途 | 来源 | 验证方式 |
|---|---|---|
| 展示字段 | 官方 0.66.0 **已登录** app 的 catalog，CDP 实取 | 11 条的 id 与 parity 脚本独立报告的「本地缺失条目」**逐条一致** |
| 安装配置 | 公开仓库 `cursor/plugins` | `.cursor-plugin/marketplace.json` 列出其中 10 条；10 个 `third_party/<name>/mcp.json` **全部实测抓通且含合法 `mcpServers`** |

id 一致这条是关键：它把「我抓的东西」和「早就知道缺的东西」对上了，不是自说自话。

## 二、我对「能不能装上」改了两次口

**第一次（错）**：「硬编码的条目会出现在界面上，但服务端没有对应插件，点添加必然失败。」

依据：`fetchPluginServers` 先走带 token 的 `getPluginMcpConfig`，本地没 token。

**第二次（也错，偏乐观）**：「我纠正了 —— `installLocally` 走的是公开 fetch，同一个仓库已经在为本机 78 条已装插件服务，所以很可能装得上。」

依据：`installLocally` 确实用 `fetch` 而不是市场客户端，错误话术还写着
`no **publicly readable** MCP configuration`。

**第三次（对，有端到端证据）**：中间我又发现一个更硬的事实并据此**第三次**修正方向 ——
`toRawGithubUrl` 要求 `sourceUrl` 是 `github.com/.../blob/<ref>/<path>` 的 blob 形式（`parts.length >= 5`），
而这个字段**恰好是 view 投影丢掉的那一个**（`marketplacePluginToView` 不产出 `sourceUrls`）。
也就是说：从官方桥拿到的数据**根本不含安装所需的东西**。

突破口是那个仓库是公开的：`third_party/<name>/mcp.json` 的路径是**可推导且可验证**的规律。
补上 `sourceUrls` 后实测安装：

```
安装 Google Slides (id 45893415)
→ 新增 server: Google Slides:google-slides
   url: https://api.cursor.com/rest-mcp/google-slides/mcp
   status: needsAuth / Authentication required
→ 卸载（remove(serverId)，传对象是我的调用形状错，不是代码 bug）
→ 已恢复原状：8 个
```

**「会失败的假界面」这个担心被证伪。** 留档的重点是：前两次判断都不算错在观察，**错在没走到最后一步就下结论**。

## 三、守卫抓到的四个问题（其中三个是我自己犯的）

1. **函数叫 `merge…` 却只返回「待新增项」**，`views` 原样没动。断言 `views.length === 12` 当场变红。
2. **我把 `homepage` 填成了 `websiteUrl`** —— 官方 capture 里**根本没有这个键**。这会让「查看源码」指向
   错误地址。逐字段 deep-equal 抓到的。**臆造数据，而且是想当然的臆造。**
3. **`marketplace` 被我列为「官方桥专属键」豁免掉了。** 代价很直接：`toRow` 的 `isTeam` 由
   `marketplaceName(entry)` 判定，钉进去的 `oh-my-claudecode` 没有这个字段 → 不出现在「团队插件」。
   这是**最容易被看见的一种错**，却因为豁免而全绿。
4. **生成器产出字面量数组，配套的 `cursorPluginsConfig()` 从未被调用** —— 死代码，而且它看起来
   像是那些 URL 的来源，是个陷阱。已删。

**2 和 3 是同一个动作**：真实数据的问题被我当成了测试的问题来处理，先放宽断言让绿。
两次都不是观察错，是**处理顺序错**。

## 四、两个变异首轮存活，暴露了纪律的漏洞

`mutate-supp.sh` 首轮 8 个变异里 **M3 / M8 报 PASS**。当时我给脚本加了 sha256 自检，
按理说「文件没变」会被报成 SKIP 而不是 PASS —— 但它们**恰恰通过了自检**：文件确实变了，
sha256 确实不同，只是我改的那个函数是死代码，测试自然毫无反应。

**sha256 证明的是「文件变了」，不是「变异有效果」。** 补进脚本注释的第 4 条纪律：

> 报 PASS 的变异，要么是守卫漏了，要么是没打中，**都不能读作「守卫没问题」**。

改打真实字面量后 **8/8 全红**。

## 五、实机结果

```
catalog 总数        官方 404 / 本地 404
本地缺失条目        （无）
categoryKeys 覆盖   官方 253/404 / 本地 253/404   （钉入前 247/393）
isUserOwned 计数    官方 93 / 本地 93
整站 parity          全部核验通过
```

## 六、两个如实记录的遗留

- **`oh-my-claudecode` 装不上。** 它是私有市场条目：公开清单里没有、无仓库、`sourceUrls` 为空。
  界面会显示（与官方一致），点添加抛上游**自己的**明确报错
  `SandMcpConfigError("The plugin has no publicly readable MCP configuration for local installation.")`，
  **刻意不吞成静默 no-op**。要它能装仍然只有登录一条路。
- **本地 view 不含 `pluginName` 键**，官方桥有（上游 `marketplacePluginToView` 不产出它）。
  渲染层 `vendorTokens` 按 `[pluginName, name]` 取首个命中，所以对 `oh-my-claudecode`（`name` 为 `"t"`）
  本地只探到 `"t"`、官方探到 `"oh-my-claudecode"`。**这条先于本次改动就存在**，不记在这里会被当成新引入。

## 七、顺带测出的答案：重部署后钥匙串**确实会再弹**

上一轮把「重部署后钥匙串是否再弹」标为**未测**（当时没重打包）。本次重打包 + 部署后，
SecurityAgent 立刻被拉起 —— **答案是会**。同 bundle 重启不弹，重部署弹。

这把 AGENTS.md 里那条「DR 改好后重打包不再弹」彻底否掉了两次：第一次是观察到还弹，
这一次是**主动复现了触发条件**。仍未能判定 ACL 内容（本机三条路都读不到），
所以「框架 cdhash DR 是原因」依然只是假设；但**现象本身现在有明确边界**：
同 bundle 幂等，重部署不幂等。
