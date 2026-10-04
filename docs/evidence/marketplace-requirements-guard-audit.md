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
