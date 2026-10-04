# 要求 A / C 的守卫覆盖审计（2026-10-05）

前三轮都在改渲染、都在补像素。这份文档记的是另一件事：**用户最初的硬要求里，有两条当时
根本没有守卫**，而绿色的测试套件对此一言不发。

## 审计方法

不是「grep 一下 `onOpenSkill` 出现过没有」。对一个要求，先问**什么样的回归能让所有现有测试
继续变绿**。如果想不出这样一个回归，说明覆盖是真的；想得出来，说明那份绿色是假的。

## 结论

| 要求 | 内容 | 审计前的覆盖 | 结论 |
|---|---|---|---|
| A | 官方页 2 私有技能行可点进详情页（第三界面），支持删除/编辑 | 只有**源码断言** | ❌ 补运行时 DOM |
| B | 数据源同官网：`workflows/` + `managed-skills/` 并入 | 模型层断言完整 | ✅ 已足够（UI 半边随 A 一起补上） |
| C | host gateway 不可达时显式报错 | **零** | ❌ 完全没有 |

### A：源码断言的三处具体失效方式

`tests/plugins-marketplace-renderer-patch.test.mjs:663/664/828` grep 了
`onSaveSkill` / `onDeleteSkill` / `onOpenSkill` 三个名字。两个 runtime DOM 测试
（`marketplace-detail-sections-runtime.test.mjs:89`、
`marketplace-page2-runtime-dom.test.mjs:67`）把 handler 全部 stub 成 noop。

于是下面三件事可以让 917 条测试全绿，而功能已经没了：

1. 行的 click 监听被摘掉 —— 名字还在源码里，grep 照过。
2. 第三界面渲染了，但「删除」按钮挂的是 `onUninstall` —— 三个名字都还在，都照过。
3. 「保存」永远 disabled —— 没有任何断言碰过 disabled 状态。

`tests/skill-detail-renderer-patch.test.mjs`（246 行）读起来像覆盖，其实不是：它断言的是
**上游 0.62 bundle 里那份 detail 页的 CSS 配方**（`RSkillDetailActionBar` 的类名、删除按钮的
i18n 文案、React Compiler memo 槽位）。那是另一条代码路径。本地这份
`view.ts:renderSkillDetail` 自己一个运行时断言都没有。

### C：grep 出来的「覆盖」全是别的东西

`attachment-media-store-read.test.mjs` 里的 unreachable、
`box-startup-cancellation.test.mjs` 里那个 `"unreachable"` 探针返回值 —— 都是别的子系统。
本页面自己的失败路径一条测试都没有。

**这个缺口最危险**，因为它的症状是一个看起来完全正确的答案：gateway 挂了 →
`Promise.allSettled` 吞掉 rejection → catalog 退化成空数组 → 页面渲染成
「为你推荐 / 精选插件 / 团队插件，一个插件都没有」。用户看不出这是故障，只会以为这个账号就是
没有插件。要求 C 存在的理由正在于此：*不可达*和*读到了空*必须是两种不同的显示。

## 补的两个守卫

### `tests/marketplace-skill-detail-runtime.test.mjs`（5 条）

挂真实 `createMarketplaceDialog` 到 happy-dom，**真的点**，断言出来的树和回调载荷：

- 点行 → `onOpenSkill` 收到**同一个对象**（不是名字相同的副本；副本会丢 `filePath` /
  `pluginId`，而详情页两个都渲染）
- 第三界面 h3 挂 `id=sand-plugins-detail-heading`；「删除」回调带同一个 skill
- 信息 · 来源 / 位置 / 状态 三行在
- `managed` 技能报 `managed-skills/skills/`、`workflow` 报 `workflows/`，且**没有**任何编辑
  控件（不是 disabled，是上游根本不渲染）
- 「保存」初始 disabled → 清空名字仍 disabled → 合法且有改动才 enabled → 点击回调
  `(原 skill, 草稿)`，且草稿带上表单没 owns 的 `filePath`
- 空 SKILL.md 不渲染空 `<pre>`

### `tests/marketplace-gateway-errors.test.mjs`（6 条）

这条驱动**真实 controller**（`createMarketplaceController().open()`），bridge 的每个调用都
reject，然后读 DOM：

- catalog 失败 → 「无法加载市场目录：<原因>」在屏，且**三个首页 section 一个都不渲染**
- 健康 catalog → 无错误、条目真的渲染（否则「永远报错」也能过上面那条）
- 缺 `window.desktop.skills` → 「私有技能桥接不可用」，**不是**「没有私有技能」
- skills 读取 throw → 「无法连接本地运行环境：ECONNREFUSED…」，**且已安装区照常渲染**
  （降级是重点：停掉的 box 不该把整页带走）
- 契约级 `{ok:false, code:"gateway-unreachable"}` → 与 throw 路径**同一套措辞**
- 真的读到空 → **允许**渲染空状态（这是整个文件的镜像面；没有它，「一律报错」这个最省事的
  改法能通过上面全部五条）

## 变异验证：13/13 全红

一次通过什么都不能证明。变异脚本 `node_modules/.cache/mutate-abc.sh`：

```
baseline                        A: PASS   C: PASS
A-M1 row click 不再进 onOpenSkill                 FAIL 1
A-M2 managed 技能错误地拿到编辑表单                FAIL 1
A-M3 保存不再回调 onSaveSkill                    FAIL 1
A-M4 删除不再回调 onDeleteSkill                  FAIL 1
A-M5 空 SKILL.md 渲染空 <pre>                     FAIL 1
A-M6 保存恒 enabled（空名字可存）                  FAIL 1
A-M7 回调收到副本，丢对象身份                      FAIL 1
C-M1 catalog 失败被吞掉                          FAIL 1
C-M2 skills throw 被读成「没有技能」              FAIL 1
C-M3 缺 skills bridge 被读成「没有技能」            FAIL 1
C-M4 契约级 gateway 错误被读成「没有技能」          FAIL 1
C-M5 catalogError 不再短路整个 body               FAIL 1
C-M6 skillsError 到不了渲染的那一节                FAIL 3
```

C-M6 一次杀 3 条，因为它同时踩了 missing-bridge / throw / 契约三条路径 —— 单一变异多处命中是
好现象，不是重复计数。

脚本本身带 sha256 自检（每个变异必须真的改了文件，否则报 SKIP 而不是谎报「守卫无效」）、
每个变异从干净副本应用一次、判绿解析 `fail N` 数字而不是锚定 `ℹ fail 0` 这行字面量。运行后
`git status` 只剩两个新测试文件，源码已还原。

## 这轮量到的东西

- 全量 **928/928**（917 + 11），`typecheck` / `source:typecheck` 干净。
- B 的 UI 半边此前确实没断言：没有任何测试检查过 `managed` 记录在界面上显示成
  `managed-skills/skills/` 而不是 `workflows/`。A-M2 变异证明这条分支是承重的，现在钉住了。

## 仍然未完成

- **实机 CDP 复验**：屏幕仍锁（`screencapture -R` 报 `could not create image from rect`），
  SecurityAgent 29128 的钥匙串弹窗未应答，9232 无响应。open-latency 的实机数字仍未取到，
  详见 `marketplace-open-latency.md`。这两份新测试是 happy-dom 运行时断言，**不是**实机证据；
  它们证明的是节点树和回调载荷，不证明像素。
- **parity 脚本间歇性「行未渲染」**：仍是 unexplained，**不硬凑改法**。见下节。

## 附：那条 unexplained 的定位又收窄了一步

之前记的归因方向是错的。`行未渲染` 那条错误不在类目页 —— 它在**首页**，
`scripts/verify-marketplace-parity.mjs:568`：

```js
const rows = await until(() => { const n = visAll(".sand-plugins-row__open", d); return n.length ? n : null; }, 40000);
if (!rows) return { err: "行未渲染" };
```

### 已排除：陈旧节点（读代码可证伪，无需实机）

最自然的猜测是 `open()` 复用了一个已被 `close()` 摘掉的 `d`：先点「关闭」、`sleep(900)`、
再 `dlg()`；若 `dlg()` 返回了脱离文档的旧节点，`visAll` 的
`getBoundingClientRect().width > 0 && height > 0` 会全灭，40 秒等来一个必然的空集。

**不成立。** `createMarketplaceDialog` 里 `role="dialog"` 的 `dialog` 是 `layer` 的后代，而
`destroy()` 是 `layer.remove()` —— 同步、整棵子树一起摘。所以 `close()` 返回后文档里不可能
还留着那个节点，`dlg()` 要么拿到新弹窗、要么拿到 null。900ms 的等待绰绰有余。

### 剩下的线索：同一文件里两个探针的失败模式不对称

| | `SECTIONS_EXPR`（第 268 行附近） | 类目页探针（504–568） |
|---|---|---|
| 打开方式 | 同 | 同 |
| 等行的判据 | `querySelectorAll('[class*="row__name"]').length > 20` | `visAll(".sand-plugins-row__open", d)` |
| 可见性过滤 | **无** | 有 |
| 预算 | 20 × 700ms | 40s |
| **失败后重开重试** | **3 次** | **无** |

也就是说：能成功的那条探针在失败时会重开三次并放宽到「20 个以上任意 row__name」，
失败的那条只有一次机会。两者测的是同一个首页，判据却不同。

**这是线索，不是结论。** 要坐实它需要一个可测的量：失败那次 `visAll` 到底返回 0 个、
还是返回了 N 个但全被判为不可见。前者指向数据没到，后者指向 `checkVisibility` /
`getBoundingClientRect` 在那一轮读到了异常值。**没有这个数之前不改 harness** ——
把等待改成重试很可能只是把症状盖住，正是本项目反复吃过的那种亏。


## 附二：钥匙串反复弹的取证（2026-10-05，纯命令行，不依赖 GUI）

背景：AGENTS.md 记着「DR 改成 identifier 型之后，重打包不再弹」。**2026-10-05 观察到相反的行为**
—— 用户已经点过三次「始终允许」，仍在弹。这条记录要么前提不成立，要么修的不完整；先查。

### 已证

1. **主可执行文件的 DR 确实改对了。**
   `codesign -d -r- "/Applications/Grok Node.app"` → `designated => identifier "com.anysphere.sand.reconstructed"`。
   （`-r-` 走 **stdout**，`-d` 的 `Executable=` 头走 **stderr**，取错流拿到空串。）

2. **但 bundle 内仍有 9 个组件是 cdhash 型 DR**，包括：

   | 组件 | DR |
   |---|---|
   | `Electron Framework` | `cdhash H"d84843427fa9ef8bf4ceb62748dcbdeff4deabcd"` |
   | `Grok Bot Helper` (GPU / Plugin / Renderer / 主) | 各自的 cdhash |
   | `Mantle` / `ReactiveObjC` / `Squirrel` | 各自的 cdhash |

3. **`safeStorage` 的实现在 `Electron Framework` 这个 dylib 里**，不在主可执行文件里。
   证据：框架二进制 `strings` 命中 `safeStorage` 11 次、`OSCrypt` 11 次；主可执行文件 0 次。
   主程序通过 `@rpath/Electron Framework.framework/Electron Framework` 动态链接它。
   `app.asar` 里另有 **35 处** `safeStorage` 调用，即我们自己就在调。

   ⚠️ `nm -gU` 在这里返回 0，**那是 Electron 剥了符号，不是「不存在」**。用符号表下结论会得到
   假否定 —— 和之前「按名字 grep 撞假阳性」同一个家族。

4. **钥匙串条目自创建起从未被修改。**
   `security find-generic-password -s "Grok Node Safe Storage"`：
   `acct` = `Grok Node Key`（**同一个条目的账号，不是第二个条目** —— 按 `Grok Node Key` 查会
   `SecKeychainSearchCopyNext: item could not be found`），
   `cdat == mdat == 20260925014623Z`。
   所以反复弹窗是 **ACL 授权判定**，不是条目被重建或被清。这一整类假设可以排除。

### 未证：ACL 里现在记的是哪条 requirement

三条路都读不到，本机没有第四条：

- `security dump-keychain` **不打印 `acl:` 块**（全文 1957 行、0 个 `acl:`；AGENTS.md 记的
  「同一条路径重复堆叠几十次」那个指纹，本次没能复现 —— 可能来自另一种 dump 格式）
- PyObjC 的 `Security` 模块**未安装**（`No module named 'Security'`）
- 统一日志**默认级别不记 ACL 决策**（`com.apple.securityd` 只记错误；`com.apple.security`
  子系统里只有别的 app 的 `CSSMERR_*`，没有本 app 的条目）

### 两个竞争解释，判别式是 ACL

- **(a) 那三次「始终允许」根本没落地。** `mdat` 未变与此一致；且锁屏时 GUI 自动化静默失效
  （AGENTS.md 已记），若当时是靠脚本点的，很可能点了个寂寞。
- **(b) ACL 比对的是框架的 requirement，而它是 cdhash** → 每次重打包就变 → 「始终允许」
  写下也白写。

若坐实 (b)：给 `Electron Framework` 签**它自己的** `identifier "com.github.Electron.framework"`
DR。这与 AGENTS.md 那条「`-r` 绝不能带 `--deep`」**不矛盾** —— 那次的错是把 **app 的**
identifier 贴到框架上（指向别的 identifier 的 requirement 根本不描述那段代码，会炸
`--verify --deep --strict`）；框架用自己的 identifier 是准确的、且跨重打包稳定。

**方案未执行**：改签名需要重打包 + 实机复验才能确认，而屏幕锁着。**本机读不到 ACL，
所以「框架 DR 是原因」是假设，不是结论。**

### 顺带确认：源码没有漂移，不需要重打包

最近两个提交（`4e18aaa` / `385eae1`）只动了 `tests/`、`docs/`、`AGENTS.md`。
`frontend/` 与 `source/` 最后一次变更是 `b64dd56`，正是打进 asar `2d510279b108bfdf` 那次。
**解锁后直接重启 app 即可，不用重打包。**

## 附三：解锁后的两项实机结论（2026-10-05）

### 1. parity 那个「精选 51 vs 本地 6」是脚本的测量假象，产品无差异

`verify-marketplace-parity.mjs` 报「精选类目页 有行 — 官方 51 / 本地 6」并标 ✅（它只断言
`> 0`）。8.5 倍的差藏在「含首页残留，不比等号」的注释后面。

用一支带**页面身份硬断言**（h1 必须是 `精选插件`，不符就停止输出）的定点探针重测，两侧完全一致：

```
LOCAL    headingText=精选插件  wholeDialog=6  scopedToScroller=6  nonEmptyGridRowCounts=[6]  totalGrids=1
OFFICIAL headingText=精选插件  wholeDialog=6  scopedToScroller=6  nonEmptyGridRowCounts=[6]  totalGrids=1
```

官方那个 51 是脚本点完「查看全部」**立刻**测的（`until(back 按钮出现)` 之后没有 settle），
那一刻上一页的 45 行还在 DOM 里且仍算可见；本地那次旧节点已经换掉了，所以读到 6。
**两侧真实的精选页都是 6 行、1 个网格。** 断言比需求宽松时，差值会藏在注释里而不是报错。

**没有改脚本**：本轮目标是确认产品有没有差异，答案是没有。脚本的 settle 缺失是已知的
测量脆弱点（同族问题见 AGENTS.md「推栈 UI 里上层节点仍在 DOM 且仍算可见」），
改它需要连同它所有的断言一起重跑才算数，不该在一次取证里顺手改。

### 2. 钥匙串：当前 bundle 重启不再弹窗

杀进程重启（带 CDP），结果：

- app 起来了，9232 出现 page target，渲染进程正常启动 —— **没被钥匙串挡住**
  （被挡住时的指纹是「main 进程活着、渲染进程没起、9232 无 page target」）
- `SecurityAgent` 确实会被拉起，但**只存活 0.01s 就退出**，不是等待中的弹窗
- 钥匙串条目 `mdat` 仍是 `2026-09-25T01:46:23Z` —— **ACL 从未被写过**

补一个决定性对照实验（临时副本，已清理 411M）：在副本上用 `--force --sign -`（**不带 `-r`**）
重签主程序，DR 立刻退回 `cdhash H"fe294dba…"`。这**确认了打包器那第二次 `-r` 调用是承重的**，
去掉它就回到 AGENTS.md 记的旧病。

**仍未测**：**重部署（重新 ditto）之后会不会再弹**。本轮没有重打包，所以没测到。
「同 bundle 重启不弹」与「重打包不弹」是两件事，不应混为一谈。

## 附四：一次失败实验的记录（副本对照实验，2026-10-05 04:1x）

为了回答「钥匙串弹窗是不是对路径敏感」，做了一次同名副本对照实验：把 `/Applications/Grok Node.app`
复制到 `/tmp/mkt-kc-test/Grok Node.app`（**必须同名** —— Electron 的钥匙串 service 取自 app name
而不是路径，不同名就不是同一个实验），只换路径启动。

**实验失败，而且制造了新故障。** 三件事，按发生顺序：

1. **副本根本没被测到。** 它确实启动了，`codesign --verify --deep --strict` 对副本也是 exit 0；
   但我查进程时用了 `pgrep -f "^/Applications/…/Grok Bot"` —— **路径锚在正主身上**，
   对副本当然 0 命中，于是我判成「副本没启动」并删掉了副本目录。
2. **进程却还活着。** macOS 上运行中的进程靠 vnode 继续持有已删除的 executable。
   副本带着 7 个进程（主 + 4 个 `Grok Bot Helper` + 1 个 `Helper (Renderer)` + 1 个子进程）
   一直占着单实例锁。
3. **真 app 因此起不来。** Chromium/Electron 的单实例锁落在**共享的 user-data 目录**
   （`~/Library/Application Support/Grok Node`），副本和正主共用同一个 `SingletonLock`。
   真 app 的启动指纹是「主进程不存在 / 渲染进程 0 / CDP 无 page target」——
   **和钥匙串挡住时的指纹一模一样**，我差点又归因到钥匙串。

清理顺序（少一步都不行，已验证）：

1. 杀副本**全部**进程 —— 锚定在副本自己的路径上：`pgrep -f "^/private/tmp/mkt-kc-test/"`，
   7 个全杀。只杀主进程不够，Helper 会把它拖住。
2. 删 `SingletonLock`（`SingletonCookie` / `SingletonSocket` 是残留软链，**不影响启动**，
   真正把关的只有 Lock）。
3. `kill -9` 挂起的 `SecurityAgent` —— 普通 `kill` 对它无效；它会被 init 收养成 PPID=1 的孤儿，
   进程还在但界面上仍弹着。
4. 启动正主，主进程 + 5 个渲染进程 + CDP page target 全部恢复。

**两个假信号，记下来免得再上当：**

- `amfid` 会为一屏 ad-hoc 签名的 app 刷
  `AppleMobileFileIntegrityError Code=-423 "The file is adhoc signed or signed by an unknown certificate chain"`，
  而 `codesign --verify --deep --strict` 同时是 **exit 0**。两者不矛盾，-423 不是失败原因。
- `Failed to parse receipt at …/_MASReceipt/receipt: no such file` 同属 ad-hoc 打包的常态噪音。

**教训**：做对照实验前先问一句「**这个实验失败时，我能不能分辨是哪一步失败**」。
这次不能 —— 副本起不来、和副本占着锁导致正主起不来，在观测上同形。于是实验既没测到目标，
又制造了新的故障，还因为路径锚错多花了三轮才把锁里的 PID `21209` 对上号。

**附带修正**：本次重启后又跑了一次开放耗时探针，**冷启动第 1 轮是 3189ms**（不是上一节记的
6591ms —— 那个数包含了「app 还在被钥匙串挡着没真正启动完」的时间，不是干净的冷启动）。
热开 24/31/28/24ms，加载态 0/5。冷启动 3189ms 与官方首次 `catalog()` 的 2792ms 同量级。

## 附五：数据面差异的定性 —— 不是本地子集，是账号门（2026-10-05）

parity 一直报「catalog 官方 404 / 本地 393，本地为官方严格子集，少 11 条」，并把它归为
「数据面，不是渲染差异」。**这个描述不够准确，值得更正**：不是本地手搓的子集，是
**服务端对未登录客户端返回的内容更少**。链路上**没有任何一处本地过滤**。

### 链路逐段核对

1. **取数是网络 + access token**：
   `sand:mcp-catalog` → `manager.getCatalog(peekAccessToken)`
   → `source/shared/node/mcp/mcp-catalog-flow.ts:62` → `fetchMarketplaceMcpPlugins(token, machineId)`。

2. **取回之后只有 map + sort，没有 filter**：
   ```ts
   const views = listing.plugins
     .map((plugin) => { ...; return marketplacePluginToView(plugin); })
     .sort((a, b) => a.displayName.localeCompare(b.displayName));
   ```
   少于官方的条目**不是这里被丢掉的**。

3. **渲染层也不过滤**：`buildMarketplaceModel` 第一行就是
   `const rows = catalog.map((entry) => toRow(entry, servers));` —— 每一条都成行。
   后面那两个 `.filter`（`isTeam`、`sectionKeyOf(...) === FEATURED_SECTION_KEY`）
   是**分组**用的，注释里写明是对应上游自己的
   `catalog.filter(e => e.marketplace != null)` / `homepagePluginItems` 语义，不是删条目。

4. **本地源码里根本没有那 11 个 id 的夹具**：`grep -rl google-slides` 在
   `source/` `scripts/` `frontend/src/` 里只命中 `scripts/verify-marketplace-parity.mjs`
   —— 也就是 parity 脚本自己那份「已知缺失」清单。

### 决定性字段：`includesPrivateMarketplaces`

`mcp-catalog-flow.ts` 把服务端返回的 `listing.includesPrivateMarketplaces` 缓存下来，
并用它决定缓存是否可复用：

```ts
const authenticated = (await bestEffort(getAccessToken)) != null;
...
includesPrivateMarketplaces: listing.includesPrivateMarketplaces,
```

字段名本身就说明：那一组条目是**服务端按账号/企业版身份**决定的。

### 缺失条目的构成与这个判据一致

```
google-slides  google-docs  google-sheets        ← Google 工作套件
onedrive  outlook  outlook-calendar  sharepoint  teams  finance   ← Microsoft 工作套件
x-money  oh-my-claudecode
```

前 9 条是一整族企业办公套件，官方已登录账号能看到，未登录看不到。官方首页那个
**「登录与凭据管理」区块（本地没有，官方有 1Password）是同一道门** —— 两边都不是渲染缺失，
而是账号门。

### 所以「补这 11 条」不是一个可执行的方案

要拿到它们，只有一条路：**登录一个 Cursor 账号**。本仓库的硬约束明确拒绝绕过登录/伪造
token，所以这条路不在选项内。

**结论**：这一项**没有本地代码可改**。它应当在交付说明里记成「账号门」，而不是一条
待办 —— 否则下一个会话会去 catalog 里找过滤器、找夹具、找开关，找半天什么也没有，
而真相在服务端。渲染侧已经证明与官方逐项一致（类表、几何、CTA、首页/类目页/管理页全绿）。
