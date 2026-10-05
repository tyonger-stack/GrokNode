# D11「登录与凭据管理」区块 —— 成因已定位（原生集成，非 catalog 条目）

## 结论

先前 D11 记的是「1Password 在两边 `mcp.catalog()` 里都不存在，来源尚未定位，不猜」。
**来源已定位**：它既不是 catalog 条目，也不是网络返回，而是**官方渲染器里写死的一个常量**
经一个投影函数产出的**原生集成（native integration）**。本地没有 native plugin host，
所以整块缺失。

用户 2026-10-05 决定：**只做取证归档，本轮不改代码。**

## 证据

### 1. 写死的常量（官方产物字节）

`/Applications/Grok Bot.app/Contents/Resources/app.asar` → `dist/renderer/assets/index.eager-app-Cj5f8Gby.js`

```js
const JTe = "service-account-token", eIe = "Shared with Grok Bot", s_ = "1Password",
  xF = {
    onepassword: {
      displayName: s_,
      description: { id: "4CnYjv" },
      brokeredDescription: { id: "hYe7bF" },
      category: { id: "3Ia71M" },
      categoryKey: "LOGIN_AND_CREDENTIAL_MANAGEMENT",
      websiteUrl: "https://1password.com",
      publisher: { name: "1password", displayName: "1Password", isUserOwned: !1 },
    },
    email: {
      displayName: { id: "O3oNi5" }, description: { id: "uNYe1e" }, category: { id: "IzFMeN" },
      categoryKey: "INBOX_AND_COLLABORATION",
      publisher: { name: "grok-bot", displayName: "Grok Bot", isUserOwned: !1 },
    },
  };
```

`LOGIN_AND_CREDENTIAL_MANAGEMENT` 全仓只出现在两处：这里的常量，以及
`chunk-marketplace-browse-model-DoOY91TS.js` 里的桶顺序/桶映射表（即我们已转写的 `Ce` / `Le`）。
**它从未作为一个 categoryKey 出现在任何 catalog 行上** —— 这解释了为什么两边
`mcp.catalog()` 都查不到它。

### 2. 投影函数：产出的是「原生」行，不是插件行

紧邻常量的 `FF`（本地 `e` = i18n 解析，`t` = 集成键）：

```js
function FF(e, t, n = {}) {
  const s = xF[t],
    r = n.onePasswordBrokered === true && s.brokeredDescription !== void 0
          ? s.brokeredDescription : s.description;
  return {
    id: IF(t), name: TF[t],
    displayName: LF(e, s.displayName),
    description: e(r),          // ← 走 brokeredDescription 时就是那句「共享一个专用的 1Password 保管库」
    category: e(s.category),
    categoryKey: s.categoryKey,
    categoryKeys: [s.categoryKey],
    ...(s.websiteUrl == null ? {} : { websiteUrl: s.websiteUrl }),
    publisher: s.publisher,
    native: t,                  // ← 关键标记：onepassword / email
  };
}
```

行上带 `native: "onepassword"`，这是它与普通插件行最本质的区别。常量里还有第二个键
`email`（`categoryKey: INBOX_AND_COLLABORATION`）—— 属于原生集成但落在「通信」桶；
实测官方首页的「通信」区块与本地逐行一致，说明它当前未被纳入市场首页视图。

### 3. 实机 DOM（官方 9224，只读不点）

「登录与凭据管理」是真实可点行，不是静态文案：

```
BUTTON  cls="sand-plugins-row__open sand-9f619 …"
        text="1Password\n通过服务账户与 Grok Bot 共享一个专用的 1Password 保管库，让它可以在自己的电脑上…"
        aria="打开 1Password"
```

描述正是 `brokeredDescription`（`hYe7bF`）那一句，证实 `onePasswordBrokered` 标志在该路径上为真。

**点下去走的是凭据开通流程，不是 MCP 安装** —— 所以即使把这一行按常量原样渲染出来，
本地也没有可对接的动作。这与 `oh-my-claudecode` 的性质不同：后者是一个真插件、只是缺
公开 MCP 配置；前者根本不是插件。

### 4. 本地侧的现状

本地**已有** 1Password 子系统（`source/electron-main/onepassword/`）：

| 文件 | 作用 |
| --- | --- |
| `onepassword-cli-runtime.ts` | `op` CLI 调用运行时 |
| `onepassword-cli-dev-controls.ts` | 开发者控制 |
| `onepassword-op-executor.ts` | 命令执行器 |
| `onepassword-provisioning-bridge.ts` | 开通桥：`inspectReadiness` / `listAccounts` / `listVaults` / `findVault` / `createVault` / `mintAndDeliver` |
| `onepassword-provisioning-contract.ts` | 契约与 sink 定义 |

但两处关键事实决定了它接不进市场：

1. **无人调用。** 在 `onepassword/` 目录之外 grep `OnePasswordProvisioning` 无任何命中 ——
   整条链路没有接进任何 UI 或 RPC。
2. **默认恒不可用。** `createVault` 与 `mintAndDeliver` 都先 `assertSinkAvailable()`，
   而默认 sink 是 `unavailableOnePasswordProvisioningSink`，它抛
   `OnePasswordProvisioningError("sink-unavailable", "1Password provisioning is unavailable
   until a credential consumer is configured.")`。

本地渲染层也已经记录了这件事 —— `frontend/src/extensions/marketplace/view.ts:510`：

> Table order follows upstream `Ws` exactly. Branches 1–2 are the `nativeInstalled` path,
> which this build has no equivalent for (no native plugin host), so the table starts at branch 3.

即：行尾动作表的第 1、2 分支是 `nativeInstalled` 路径，本构建从第 3 分支起。

## 为什么本轮不改

要补上这一块，需要先回答一个**架构问题而不是 UI 问题**：本地的「凭据消费方」是什么。

- `mintAndDeliver` 的产物是一枚 `service-account-token`（官方常量里的 `JTe`），
  要交给某个消费者保管和使用。没有消费者时桥会显式拒绝 —— 这个设计是对的，
  不该被绕过。
- 凭据消费方涉及凭据的存放与使用方式，属于用户已明确划线的「涉及 local 改造要先给方案确认」。

**不画一个死行。** 若只按常量渲染外观而点击无动作，就制造出「看着能点、其实不 work」的行 ——
与本项目已定的处理原则相反（`oh-my-claudecode` 是**渲染出来 + 点击显式抛上游自己的错误**，
不是渲染出来 + 静默无反应；而 1Password 连「抛上游错误」都没有对应物）。

## 若将来要接，需要先定的三件事

1. **凭据消费方**：token 交给谁保管？（settings / 钥匙串 / 沙箱内某个服务）
2. **`native` 行与插件行共存**：行尾动作表的第 1、2 分支（`nativeInstalled`）要按官方
   `Ws` 原样恢复，且 `email` 集成是否进市场首页要有定论。
3. **`onePasswordBrokered` 标志**：官方按它切换 `brokeredDescription`/`description`，
   本地必须知道它在什么条件下为真，否则文案会与官方不同。

三项都取证清楚之前动手，产出的就是臆造行为。

## 复现

```sh
export PATH=/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH
SP="/private/tmp/claude-501/-Users-wwzz-Downloads-proxyclawd/88833871-9d1c-410a-8425-a5a54e5377ef/scratchpad"

# 常量与投影函数（读字节）
node "$SP/asar-needle.mjs" "/Applications/Grok Bot.app/Contents/Resources/app.asar" \
  "dist/renderer/assets/index.eager-app" "LOGIN_AND_CREDENTIAL_MANAGEMENT" "brokeredDescription"

# 实机 DOM（官方 9224，需带 CDP 启动；只读不点）
node "$SP/cdp.mjs" 9224 "$SP/probe-credentials-block.mjs"

# 整站 parity 会把这一块标为 ❌ 并归因
node scripts/verify-marketplace-parity.mjs
```
