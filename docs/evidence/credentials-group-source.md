## 「登录与凭据管理」的数据源追查结论

**用户要求继续追查。以下是查到的边界：它不来自 marketplace catalog。**

### 决定性测量（两个 app 同时在跑）

在官方界面上按文档顺序数出**每一个**渲染出来的 `.sand-plugins-row__open`（不带可见性过滤），
再和 `desktop.mcp.catalog()` 的返回做集合差：

| | UI 渲染行数 | UI 去重 | bridge 返回 | **UI 有而 bridge 没有的** |
| --- | --- | --- | --- | --- |
| 官方 0.66.0 | 45 | 45 | 404 | **恰好 1 条：`1Password`** |
| 本地 | 43 | 39 | 393 | **空集** |

也就是说：**官方的 marketplace 界面被喂的数据，严格多于它的 `mcp.catalog()` bridge，多出来的正好是 1Password；
而本地界面就是 bridge catalog 的忠实投影。** 这一组在本地缺失，根因就在这里。

### 已排除的假设

1. **不是 category 映射表的问题。** 本地 `CATALOG_CATEGORY_TO_BUCKET` 14 条与官方 `Le` **逐条同序同值**。
2. **不是 catalog 里缺一个 credentials 类目。** 两个 app 的 `categoryKey` **都只有 16 个不同值**，
   且**都不含** `LOGIN_AND_CREDENTIAL_MANAGEMENT`；也没有任何条目的文本含「凭据」或「1Pass」。
3. **不是 vendor override 能救。** 官方 `Te`（16 条硬编码覆盖表）里没有 credentials 项。
4. **不是被 `marketplace` 字段过滤掉的。** `ve()` 只收 `marketplace === undefined` 的条目；
   官方整个 catalog 里只有 **1** 条带 `marketplace` 键。
5. **不是 `credentials.state()` 的当前载荷。** 官方 `desktop.credentials.state()` 返回
   `{"status":{"connected":false,"accounts":[]},"directory":null}` —— **未连接**，里面也没有 1Password。

### 官方有、本地完全没有的 bridge 命名空间

从官方 `dist/electron-preload/preload.cjs`（117,942 字节）里读出的暴露面：

```
credentials : state() -> getCredentialsState / sync() -> syncCredentialProvider / onChanged
              以及账号侧的 approveCredentialRequest / denyCredentialRequest / detectCredentialMint
passkey     : list() / revoke() / beginPasskeyRegistration
cursorAccount
```

**本地的 `window.desktop` 只有 `account` 和 `cursorAccount`，没有 `credentials`、没有 `passkey`。**
（本地 `mcp` 命名空间另有 `financeOverview` / `deleteFinanceConnection` / `startFinanceLink` 缺失，
与 11 条账号门后的 catalog 条目同属一片账号能力。）

### 那行文案本身指向凭据提供方，而不是插件

官方该行的 `aria-label` 是 `打开 1Password`，正文是
「通过服务账户与 Grok Bot 共享一个专用的 1Password 凭据」——
**这是凭据提供方的说明文案，不是插件介绍**。而官方当前 `connected:false`、`directory:null`，
说明这一行**不是**由实时凭据状态渲染的。

### 结论（区分已证与未证）

- **已证**：该条目的数据**不来自** `mcp.catalog()`；本地的 marketplace 视图是 bridge catalog 的忠实投影，
  因此在 bridge 补上这个来源之前，这一组在本地必然缺失。
- **推断（未证）**：最可能的来源是官方 `credentials` 子系统的**目录（directory）** 概念——
  即「有哪些凭据提供方可供」这份目录，与 catalog 里的插件条目是两套东西。本地完全没有这个命名空间，
  所以缺的不是一条数据、是一整片能力。
- **未证**：具体是哪个 fetch/renderer 产出这一行。没有继续往 React 组件层挖，那是很长的尾巴；
  按「证据不足就记为 uncertainty」的约束，这里停。

### 为什么本地不去补

本地没有 Cursor 账号（合规边界：不登录、不伪造 token），而 `credentials` / `cursorAccount` 这套能力
在官方是**登录后才可用**的账号面。硬造一个 1Password 行就是臆造官方行为，本项目明令禁止。
