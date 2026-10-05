# 「添加其他账户」的官方绑定 —— 取自 0.66.0 产物字节

> 日期：2026-10-05
> 目的：给 D19（「添加其他账户」是死按钮）定性 —— 它到底是**缺宿主能力**（要设计契约），
> 还是**纯渲染层接线**（能直接移植）。结论是后者，本文件是可复核的取证链。
> 相关：`docs/MARKETPLACE-066-PORT.md` D19 行。

## 结论（一句话）

官方「添加其他账户 → 填标签 → 授权」**复用的就是「连接/授权」那一个函数**，
第二个实参从 `accountKey` 换成 `label`。本项目的 `preload.mcp.authenticate(serverId, accountKey?)`
已经是同一个形状，**不需要新桥契约、不需要新 IPC 通道、不需要设计判断**。

## 取证环境

- 应用：`/Applications/Grok Bot.app`，`CFBundleShortVersionString = 0.66.0`（已实读）
- 产物：`Contents/Resources/app.asar`，611 个条目，`dist/renderer/assets/` 下 482 个 `.js`
- asar 头解析：`dataStart = BigInt(8) + BigInt(readUInt32LE(4))`，JSON 从 offset 16 读
  `readUInt32LE(12)` 字节；**文件表的 `offset` 是字符串，必须 `BigInt()` 后相加**
- 抽取脚本：`/tmp/asar-find2.mjs`（全包搜串）、`/tmp/asar-win.mjs`（按路径切出单文件）

### 定位链（不含任何压缩名锚点）

`sand-plugins-detail__add-account` 这个语义类名在**整个 asar 里只出现 1 次**：
`dist/renderer/assets/chunk-plugin-detail-view-tZskkHRA.js`（53,070 B）@ 偏移 11253。
据此确定账户表单组件 `ve` 与它的父级调用点分别在哪个 chunk：

| 事实 | 值 |
| --- | --- |
| 账户表单组件 `ve` | `chunk-plugin-detail-view-tZskkHRA.js` @ ~3850（`ve.d=1178`） |
| 父级绑定 `onAddAccount` | `chunk-view-BudImuR0.js` @ 112076（`onAddAccount` 全文仅 1 次） |

## 事实 1：`ve()` 的 props 与「不常驻」

`chunk-plugin-detail-view-tZskkHRA.js` 逐字：

```js
function ve(l){ve.d=1178;const s=B.c(88),
  {slots:e,isBusy:a,onAuthenticate:t,onAddAccount:i,onRenameAccount:d,onRemoveAccount:r}=l,
  {i18n:m,_:c}=ts(),
  x=Ue("mcp_multi_account"),
  ...
  [h,y]=W.useState(null),
  ...
  o=e[0];
  if(o==null) return null;
  const k = x && o.url!=null && o.servedBy!=="grok" && o.cursorScmProvider==null;
  ...
  $ = k
    ? jsxs(Fragment,{children:[
        jsx("div",{className:g("sand-9f619 sand-28ko6u sand-1diwwjn sand-bmvrgn sand-1m4ooaa")}),
        h==null
          ? jsxs("button",{className:g("sand-plugins-detail__add-account …"),
                           disabled:a, onClick:()=>y(""), type:"button", …})
          : …表单…
      ]})
    : …;
```

要点：

- `h == null` 时渲染「添加其他账户」按钮，`onClick:()=>y("")` 把 `h` 从 `null` 置为 `""`
  ⇒ **表单是三元另一支，不常驻**。与本仓库实机读数（点前 0 个可见输入框 / 点后 1 个）逐项吻合。
- `k` 是可见性门：**特性开关 `mcp_multi_account` 开着**，且该连接器
  `url != null`（真 OAuth 连接器）、`servedBy !== "grok"`、`cursorScmProvider == null`。
- `o = e[0]`（首个 slot）；`o == null` 直接 `return null` —— 账户区整体依赖至少有一个 slot。

### 特性开关默认值

`dist/electron-main/main-app.cjs` @1133537 逐字：

```js
mcp_multi_account:{client:!0,default:!0}
```

**`default:!0`** ⇒ 默认路径就是开启，本项目无条件渲染与官方默认行为一致。
（残留差异：若远端 kill-switch 把它翻成 false，官方整块隐藏而本项目仍显示。
本项目未接 Statsig 消费，此项与其它特性开关同属已知边界，不单列为缺陷。）

## 事实 2：`onAddAccount` 复用「授权」那一个函数 ★

`chunk-view-BudImuR0.js` @112076 逐字：

```js
Pe = async ($, U) => {
  const ee = U === void 0 ? ps : U;              // 第二实参：accountKey（缺省 ps）
  const se = r.get($) ?? [];                     // 该 serverId 的 slots
  const pe = se[0] ?? d.find(ze => ze.id === $);
  Jt({serverName:pe?.name, serverId:$});
  pe != null && ( o(null), await Ye(async () => { o(It(await le(pe, se, ee))) }, o) );
};
const de = Pe;

be = $ => { de($.serverId, $.accountKey) };      // → onAuthenticate
Me = $ => { de($.serverId, $.label)      };      // → onAddAccount     ★
Ae = $ => { ke($) };                              // → onRenameAccount
xe = $ => { fe($) };                              // → onRemoveAccount

Te = { onAuthenticate: be, onAddAccount: Me, onRenameAccount: Ae, onRemoveAccount: xe };
```

**这就是全部答案**：`onAddAccount` 传给 `de` 的是 `$.label`，而 `de` 的第二形参一路
（`ee`）传到 `le(pe, se, ee)` 的第三位。标签**就是 accountKey**，
与「连接/授权」用的是**同一个函数**，没有第二个提交路径。

> 注意：`onAddAccount` 收到的是一个**对象** `$.label`，而 `onAuthenticate` 收到的是
> `$.accountKey`。两者字段名不同但落到 `de` 的同一位置 —— 移植时不要把
> `onAddAccount` 的入参当成裸字符串。

## 事实 3：本项目侧：能力已在，只是没接线

| 层 | 位置 | 事实 |
| --- | --- | --- |
| preload | `source/electron-preload/preload.ts:175` | `authenticate: (serverId, accountKey?, trigger?) => ipc.invoke("sand:mcp-auth", …)` |
| IPC | `source/electron-main/mcp/mcp-desktop.ts:11` | `authenticateServer(request.serverId, request.accountKey ?? DEFAULT_MCP_ACCOUNT_KEY, …)` —— **accountKey 由渲染器自由传入，只缺省成 `default`** |
| 生命周期 | `source/shared/node/mcp/mcp-auth-watch-lifecycle.ts:103` | `authenticateServer` 解析 serverId → `checkAuthStatus({serverId, accountKey, oauthRedirectUri, forceReauth})`。**没有「槽位必须预先存在」的前置检查** |
| 渲染 | `frontend/src/extensions/marketplace/detail-cta.ts:56` | `createAddAccountCta(doc)` 只建按钮，**无 handler** |

⇒ 桥的这一侧**不需要任何新增**。缺的只有渲染层：表单 + 把标签当 accountKey 调
`mcp.authenticate(serverId, label)`。

## 事实 4：旁证 —— 状态词逐字同源

`chunk-view-BudImuR0.js` 里结果→文案的映射：

```js
function xo(n,e){ return n.status==="started" || n.status==="already-authenticated" ? null
                   : n.status==="not-configured" ? e : yt(n) }
```

与本项目 `sand:mcp-auth` 处理器的判词 `result.status === "already-authenticated"` /
`result.status === "started"` 逐字一致。

**取证边界（不夸大）**：本文件**没有**把官方那个 `le` 一路解到 IPC 边界 ——
`le` 是外层作用域的闭包，定义不在本 chunk 内。状态词同源是**旁证**，不是同一条链的直接证明。
已直接证明的是：`onAddAccount` 的第二个实参（标签）到达了认证函数的 accountKey 位置。
本项目 `authenticate` 的 `(serverId, accountKey)` 形状与之相符，且其 accountKey
不做存在性校验、不要求槽位预先存在。

## 推翻了什么

`docs/MARKETPLACE-066-PORT.md` D19 行原文写着：

> 需新桥契约 + 表单 + 提交流程，其中「选哪个宿主调用 / 参数形状 / OAuth 回跳 UX」
> 三处有设计判断，无实机参照时盲写即臆造

**这句已被本文件证伪。** 官方绑定在字节里是唯一的、没有任何歧义空间，
「选哪个宿主调用 / 参数形状」两问都有确定答案；「OAuth 回跳 UX」不由渲染层决定
（回跳由宿主 `catchLoopbackAuthorization` + `onAuthCompleted` 订阅处理，与本项目现有链路一致）。
D19 因此从「需设计的架构决策」降级为「纯渲染层移植」。

## 守卫冲突

`tests/plugins-marketplace-renderer-patch.test.mjs:766-769` 有一条守卫在**强制**当前的错行为：

```js
assert.ok(!/addEventListener/.test(addAccount), "添加其他账户 has no destination in 0.66");
```

它断言的理由「0.66 里它没有目的地」正好是本文件证伪的那条。
注意同一个文件 `:771-775` 已经就**兄弟按钮**（`编辑 <account> 账户`）记过一次同款更正 ——
那条守卫当初也是建立在「点了没反应」上，而那次取证用的是**未安装条目**，账户区压根没渲染。
**同一个按钮家族，同一种错误，连着错两次。**

## 复核方法

```sh
# 1. 确认版本与 chunk 存在（名字每次打包会变，别照抄本文档）
defaults read "/Applications/Grok Bot.app/Contents/Info.plist" CFBundleShortVersionString
# 2. 全包搜语义类名 → 应只命中 chunk-plugin-detail-view-tZskkHRA.js
node /tmp/asar-find2.mjs "/Applications/Grok Bot.app/Contents/Resources/app.asar" \
  "sand-plugins-detail__add-account"
# 3. 切出该 chunk，在 chunk-view-BudImuR0.js 里搜 onAddAccount → 应得唯一绑定
```

本文档所有偏移量都绑定 0.66.0 这一次产物。**换版本后偏移失效，但检索串稳定** ——
按串重新定位，不要按偏移。

---

## 追加（2026-10-05 21:5x）：实机量测补上一处字节读不出的东西

上面的结论全部来自字节。但字节里那个提示条件写的是
`S = h != null && Bs(h) === Vs` —— `Vs` 是从 `index.eager-vendor-Qbf9YA6n.js`
别名 `f6` 转进来的**压缩常量**，在同一文件里 `UL` 重名（撞上 `React.createContext`），
继续追就要开始猜了。**不猜，直接在官方界面上试。**

### 探针要过的两道关

1. **命中测试**：`innerText` 读得到 ≠ 界面上看得见（推栈 UI 下层节点仍在 DOM 且仍算可见）。
2. **自证起点**：先确认表单**确实是展开态**，否则「没变化」可能是压根没点开。

第一轮探针返回「表单未展开」，是**窗口只有 720×76 像素高**——输入框在 DOM 里（478×28），
滚动区 `clientHeight` 为 0，`elementFromPoint` 落在视口外外。命中测试正确地拒绝了读数。
用 `Emulation.setDeviceMetricsOverride` 临时撑开布局视口（读完立即 `clearDeviceMetricsOverride`）。
（`Browser.getWindowForTarget` 在 page 会话上不存在 —— `cdp.mjs` 连的是 page target。）

### 量到的表单结构（与字节逐字吻合）

| 角色 | tag | 类数 | 与本仓库常量 |
| --- | --- | --- | --- |
| 表单 | `div` | 9 | `DETAIL_ADD_ACCOUNT_FORM_CLASSES` ✅ |
| 字段外层 | `span` | 8 | `DETAIL_ADD_ACCOUNT_FIELD_CLASSES` ✅ |
| 输入框 | `input` | 17 | `DETAIL_ADD_ACCOUNT_INPUT_CLASSES` ✅ |
| 授权 | `button` | 54 | `ACTION_BUTTON_OFFICIAL_CLASSES` ✅ |
| 取消 | `button` | 55 | `CANCEL_BUTTON_OFFICIAL_CLASSES` ✅（= 授权 `slice(0,-3)` + 4 个 ghost 类） |

> 五个配方**本来就已转写好且全部闲置未用**。缺的只是 DOM 组装 —— 与本文件上半部分的
> 「桥不缺、只差渲染层接线」结论完全吻合。

### 提示条件：实测而非推断 ★

逐个标签输入，读字段 span 内的子节点：

| 输入 | 提示 |
| --- | --- |
| `Grok` | **出现** |
| `grok` | **出现** ⇒ 判定大小写不敏感 |
| `default` | 不出现 |
| `个人` | 不出现 |
| `工作` | 不出现 |

提示节点 = input 的**兄弟**（同一字段 span 内），5 类
`sand-9f619 sand-1wm8ruf sand-1d3mw78 sand-12oo3zp sand-1jh5svw`，
文案取官方默认（中文）表 `wLsCed` = 「Grok 是保留的账户标签」。
`sand-1jh5svw` 的声明是 `color: var(--cursor-text-red-primary)` —— 红色警告，语义自洽。

**跨版本可直接搬**：这 5 个类在 0.18（`index-lCyB53CO.css`）与 0.66
（`index-B9V4agTc.css`）里声明**逐字相同**，无需任何逻辑/物理属性替换
（这正是 AGENTS.md 记的那条「同一声明 ⇒ 同一类名」规律）。

### 一处我自己写错的断言（被测试当场抓住）

第一版用例把 `Grok2` 放进了「应显示」那一组。实现按官方的**精确相等**拒绝了它，
是**测试错了不是实现错了** —— `Grok2` 我从没在官方界面上试过，属于凭空推断。
判据是 `trim(h) === Vs`，不是 `startsWith`。已改正，并在用例里写下这条提醒。
