# 盒子生命周期缺口分析：Grok Node vs 上游 e4c9fc7

对比基准：
- **上游 oracle**：`grok-bot-local-vm`（`universal:sand-box-e4c9fc7`，上游自带 `/opt/sand/sand-host/host-main.cjs` 29MB）
- **本机**：`grok-node-local-vm`（`universal@sha256:f9dff5cd…`，自建 `/home/box/sand-host/host-main.cjs` 20MB）
- **官方 app**：0.63.0 `com.anysphere.sand`（**不含**本地 VM，见 §1）

---

## 0. 先纠正一个前提

**官方 0.63.0 没有「超时自动关闭 bot 电脑」这个功能。** 它也不需要——官方跑远程 box，桌面端不管理任何容器生命周期。

官方 `main-app.cjs`（2.26MB）实测：

| 符号 | 命中 |
|---|---|
| `local-vm` / `grok-bot-local-vm` | 0 |
| `stopBox` / `stopSandBox` / `boxStop` | 0 |
| `idleShutdown` / `autoStopBox` / `shutdownWhenIdle` / `boxIdleTimer` | 0 |
| `recreateInBox` / `autoUpdateBoxNow` / `releaseAgentBox` | 0 |
| `docker` | 5（全在 `dev-box-docker.mjs` 开发态路径，该脚本不在 asar 内） |

`grok-bot-local-vm` 容器**不是官方 0.63.0 创建的**，是上一轮为做 RPC schema 对比手工起的 oracle 容器
（label `com.grok-bot.local-vm:1`，entrypoint `/usr/local/bin/start-sand-box`）。别把它当官方行为的证据源。

**结论：不存在可参考的「上游空闲关电脑」实现。** 上游的设计是 box 永续（产品名就叫 *forever box*），
空闲时只做**原地重建**（`autoUpdateNow` / `recreateInBox({preserveData:true})`），从不关停盒子。

---

## 1. 真正的缺口：三处，都不是「关电脑」

### 缺口 A：`sand-exit-watch` 缺受管 daemon 监督 + 优雅关闭

> **可行性：无法在本仓库实施。** `sand-exit-watch` / `start-sand-box` 是**镜像内文件**，
> 仓库里不存在（`glob **/sand-exit-watch*` 零命中）。详见 §3。

| 指标 | 上游 | 本机 |
|---|---|---|
| 行数 / 字节 | 622 / 21916 | 281 / 8993 |
| `--daemon-launcher` 参数 | 有 | **无** |
| daemon supervisor 状态机 | `ManagedDaemonSupervisor` | 无 |
| 关闭三态 | ACTIVE→STOPPING→STOPPED | 无 |
| SIGTERM 宽限期 | 50s（可配） | 无 |
| 宽限到期 SIGKILL 升级 | 有 | 无 |
| 崩溃退避重启 | 1s→60s，10min 稳定重置 | 无 |
| 配置类退出码(2/78)不重启 | 有 | 无 |

`start-sand-box` 侧同样缺失：`SAND_DAEMON_RELEASE_STORE_DIR`、`SAND_DAEMON_LAUNCHERS_DIR`、
`collect_daemon_launcher_args()`、`discover_bundled_daemons()` 在本机版本里**全无**。
`/var/lib/sand-daemon-supervisor/`、`/usr/local/libexec/sand/sand-daemon-supervisor`(9MB) 在本机镜像里不存在。

**现状影响**：本机 PID 1 是 `sand-exit-watch`，但它只能被动感知两个 owner 进程的死活。
任何**不是** owner 的后代进程泄漏（孤儿 Chromium、X server、daemon 进程）不会被回收，
因为没有 `reap_all` → `signal_running_daemon_supervisors(SIGKILL)` 这条收尾链。
容器关闭时依赖 Docker 强杀，不是协作式退出——**这正是 AGENTS.md 记录的 X server 残留问题的根因之一**
（`loopback.releaseWindow` 在 daemon ping 不通时直接 return 丢 stop-window → X 残留 → 座位号被占）。

### 缺口 B：`stopLocalDockerBox` 死代码

`source/electron-main/box/local-docker-host-connector.ts:407` 已实现，带 ownership 校验
（拒绝停非本 app 容器），但**全仓零调用**。一个能停掉 VM 的函数没有任何触发路径。

### 缺口 C：缺「主动中止单个 agent 回合」的公共入口（**比原判断小得多**）

> **2026-10-02 二次修正**：本节初版说「turn 无优雅中断」是**错的**。
> 优雅 quiesce 机制我们**早就有**，只是命名不同（`quiesce` vs 上游 `pause`）。

逐符号对照（上游用 pause 命名，本机用 quiesce 命名，**功能对等**）：

| 上游符号 | 上游 | 本机对等物 | 本机状态 |
|---|---|---|---|
| `pausingForUpgrade` | 11 | `upgradeResume.quiescingForUpgrade` | ✅ 有 |
| `requestPauseForUpgrade` | 8 | `requestQuiesceForUpgrade` | ✅ 有 |
| `stopRunIfRequested` 检查点消费 | 有 | `quiescedForUpgrade` 结果分支 | ✅ 有 |
| `markAllRunningAgentsForUpgradeResume` | 有 | `markAllRunningAgentsForUpgradeResume` | ✅ 同名 |
| `resumeInterruptedUpgradeTurns` | 有 | `resumeInterruptedUpgradeTurns` | ✅ 同名 |
| `MAX_DEFER` / `forceNow` | supervisor 侧 | 镜像内 supervisor 齐备（3/3 命中） | ✅ 有 |
| `interruptRunForUpdateEscape` | 2 | — | ❌ **真缺** |
| `interruptRun`（带 report 参数的公共方法） | 有 | — | ❌ **真缺** |
| `SubagentOwnershipRegistry` | ~70 行 | 无对应物（但有 `interruptAll`/`abortSubagent`） | ⚠️ 设计差异 |
| `interruptAgentRun` RPC | 9 | — | ❌ **真缺** |

`runner-registry.ts:35` 已有 `interruptWedgedRunForWatchdog`（watchdog 版），
结构与上游 `interruptRun` 一致，缺的只是**按 reason 分派的公共 `interruptRun`**。

**真实缺口**：
1. `interruptAgentRun` RPC 方法**完全不存在**——UI 的「停止」按钮没有后端。
2. 没有 `interruptRun(agentId, reason, report)` 公共方法，上游两个调用方各自复制了逻辑。
3. 无 `SubagentOwnershipRegistry`：我们靠 `runner.interruptAll()` 遍历本 runner 的 subagents，
   跨 runner 聚合的归属表没有。这在单 agent 场景等价，多 agent 并发时归属边界更松。

**换 bundle 路径本身没问题**：`host-bundle-upgrade.ts` 有完整 staged 通道
（`incoming-host-bundle.tgz` + `command.json` + `mode:"bundle"` + `swaps when idle`），
supervisor 侧 `pendingUpgradeVersion`/`MAX_DEFER`/`forceNow` 齐备，`status.json` 实时显示 `pendingUpgradeVersion: null`。

**边界提醒**：该通道换的是 `host-main.cjs`，**不含** `box-scripts/`。
AGENTS.md 记的「换 bundle 连带同步 box-scripts」说的是**另一条路径**（直接换镜像内 host bundle 目录），别混。

---

## 2. 已排除的伪缺口（别再改）

**桌面 crash-loop storm 抑制：两边完全一致，不要动。**

`sand-supervisor-desktop.mjs` 符号计数逐项相同（`crashloopEpisodes` 12 / `backoff` 26 /
`downReason` 26 / `restarts within` 1 / `giving up until` 1），26105 B vs 26908 B。
本机实机日志证明它**正在生效**：

```
[sand-supervisor] desktop: d3/xfwm4 crash-looping (8 restarts within 600000ms; episode 73; down reason exit-1); giving up until the storm subsides
```

`supervise-sand-supervisor`(253行) 也已有 `SAND_SUPERVISOR_STARTUP_GRACE_S=120`、
`SAND_SUPERVISOR_STOP_GRACE_S=5`、restart-intent 文件与 stale-intent 丢弃逻辑。

> 注：`sand-supervisor.mjs` 里的 2 处 `crash-loop` 是 **host 换版回滚**
> （`POST_SWAP_CRASH_LOOP_ERROR_CLASS`），与桌面 storm 无关，别混。

---

## 3. 参考实现方案

### 优先级排序（2026-10-02 修正后）

| # | 项 | 价值 | 风险 | 仓库内可做？ |
|---|---|---|---|---|
| 1 | 缺口 C：turn 主动中止 | 高 | 中 | ✅ 是（改 TS，重打包） |
| 2 | 缺口 B：`stopLocalDockerBox` | 中 | 低 | ✅ 是 |
| 3 | 缺口 A：exit-watch daemon 层 | **降级** | 高 | ❌ **否，见下** |

**明确不做**：空闲 N 分钟自动 `docker stop`。理由：
- 容器 24×7 在跑，agent 随时可能被唤醒；
- `READY_TIMEOUT_MS=180000`，冷启动会明显劣化体验；
- 上游（产品名 forever box）明确选择不关停。逆向重建不应发明上游没有的行为。

### ⚠️ 项 1（缺口 A）可行性修正：无法在仓库内实施

初版方案写的是「改造 `start-sand-box` + `sand-exit-watch`」。**这个前提是错的。**

`glob **/sand-exit-watch*` 与 `grep sand-exit-watch` 实测：这两个脚本**不在本仓库**。
它们是**镜像内文件**，随 digest 钉死在 `universal@sha256:f9dff5cd…` 里。

仓库里唯一相关的是 `source/packages/constants/sand-supervisor.ts`（42 行）——
它只是一组**路径常量**（`SAND_SUPERVISOR_DIR`、`command.json`、`incoming-host-bundle.tgz`…）
和 command 构造函数，**没有任何执行逻辑**。全仓 `box-scripts` 仅 1 处命中，且在注释里。

⇒ 要做缺口 A，只有三条路，都有明确代价：

| 路径 | 代价 | 建议 |
|---|---|---|
| 换上游 digest 到 e4c9fc7 | 会连带换掉整套 supervisor/exit-watch，**且 host 路径从 `/home/box` 变成 `/opt/sand`**，我们 20MB bind mount 变死文件（AGENTS.md 已记录该坑，就是为躲它才钉回 f9dff5cd） | ❌ |
| 维护私有镜像派生层 | 需要建仓、建构建、digest 固定、回归面扩大到整套 supervisor | ⚠️ 只在真需要时 |
| bind mount 覆盖单个脚本 | `sand-exit-watch` 来自镜像 `/usr/local/bin`，覆盖它等于**接管容器 PID 1**，风险极高 | ❌ |

**结论：缺口 A 是「知悉并记录」，不是本轮可做的工作。** 它的实际影响（后代进程不回收）
在 `Supervisor` 已是单层 owner 的架构下影响面有限——owner 挂了盒就关，泄漏场景主要是
owner 存活而子进程泄漏，那是 `supervise-sand-supervisor`(253行) 和 `sand-supervisor-desktop.mjs`
已经在管的范畴（且两边逻辑一致）。

**原阶段 1–4 作废。** 若将来真要做，走「私有镜像派生层」并先回答：
派生前基线用哪个 digest、Chrome 是否被迫降级、`box-scripts` 同步如何处理。

### 项 1′（缺口 C，修正后）实施步骤

**前置**：基线 `npm run check` 已验证 **647/647 通过**（2026-10-02）。
改动只在 TS 侧，不动镜像承重墙（`SAND_BOX_AUTO_UPDATE=0` 保留）。

**注意**：工作区已有 4 个文件的既有改动（VNC 死座位回收：
`loopback-sand-box.ts` / `production.ts` / `shared-desktop-sand-box.ts` /
`tests/box-startup-cancellation.test.mjs`，+168 行含 100 行测试）。
文件层面与本项**不重叠**，但**不要把它们一起提交**——那是独立一条线。

1. `runner-registry.ts` 补 `interruptRun(agentId, reason, report)` 公共方法
   （把现有 `interruptWedgedRunForWatchdog` 的逻辑抽出来复用，避免第二份副本）
2. 补 `interruptRunForUpdateEscape(agentId)`，reason 用上游字面量
   `"user stop: unblocking the computer update"`，report `"update_escape"`
3. 接 `forceNow: true`：`host-bundle-upgrade.ts` 已有该字段，
   让「不等自然空闲，立即换版」真正可达
4. `interruptAgentRun` RPC：上游 schema 是 `{id: rpcString(), sessionId: rpcOptional(rpcString())}`，
   响应 `{hadActiveRun}`。**是否要接 UI 需先定产品决策**——
   我们 renderer 沿用上游产物，接了才不会出现「按钮存在但 404」。
   ⚠️ 若接，必须先在 `grok-bot-local-vm`（oracle，1341 端口）验证上游该方法的实际响应

**不做**：`SubagentOwnershipRegistry` 移植。单 agent 场景我们已有 `interruptAll` 等价，
移植会引入跨 runner 状态，收益不抵复杂度。仅在多 agent 并发归属出问题时再议。

### 项 2（缺口 B）决策
删除 `stopLocalDockerBox`。当前 `SandBoxRuntime` 只有 `local-docker` 一个值，
`setBoxRuntime` 无其他分支可走，UI 停机入口在产品上无意义；
留着会让后来人以为有这功能。**删前先确认无人引用**（`main-edge.ts:15` 只是 import，需一并清理）。

---

## 4. 本轮自我纠错记录（重要）

本次分析中我提出过**三个被自己取证推翻**的判断，都写在这里以免重犯：

| # | 我一度声称 | 实测 | 教训 |
|---|---|---|---|
| 1 | 「我们的 supervisor 对 crash-loop 无能为力」 | 实机日志 `crash-looping (8 restarts within 600000ms; episode 73); giving up until the storm subsides` 正在生效；`sand-supervisor-desktop.mjs` 两边符号计数逐项相同 | 断言「某机制缺失」前，先 grep 目标文件本身，别只看 `.cjs` |
| 2 | 「换 host bundle 只能 `docker restart` 硬来」 | `host-bundle-upgrade.ts` 有完整 staged 通道（`incoming-host-bundle.tgz` + `command.json` + `mode:"bundle"` + `swaps when idle`），supervisor 侧 `pendingUpgradeVersion`(13)/`MAX_DEFER`(3)/`forceNow`(3) 齐备 | 方案落地前先确认**机制归属**：这是镜像内的东西还是我们仓库里的东西 |
| 3 | 「turn 无优雅中断，缺 `pausingForUpgrade`/`requestPauseForUpgrade`」 | 我们**全都有**，只是命名不同：`upgradeResume.quiescingForUpgrade` / `requestQuiesceForUpgrade` / `quiescedForUpgrade` / `markAllRunningAgentsForUpgradeResume` / `resumeInterruptedUpgradeTurns` | **跨项目比符号名 = 自欺**。上游 `pause*` vs 本机 `quiesce*` 是同义不同名；先找功能等价物，再比数量 |

第 3 条是最贵的一次：符号计数表（`pausingForUpgrade` 11 vs 0）看起来像铁证，
实际是**命名差异造成的假缺口**。正确做法是**先列出本机同义符号，再比**。

第 2 条还牵出一个更根本的坑：**我最初把「镜像内文件」当成了「仓库内可改文件」。**
`start-sand-box` / `sand-exit-watch` 都不在仓库里（`glob` 零命中），
仓库只有 `constants/sand-supervisor.ts` 的路径常量。**动镜像层 ≠ 改本仓源码。**

---

## 5. 未验证项

- 云端（服务端）是否有 team 级 VM 销毁策略：`SandHibernatedOwnerVmTerminationSettings` proto
  （`enabled` / `minimum_hibernation_days` / `deletes_files`）+ `AdminHibernateSandBox` 强烈暗示存在，
  但那是 admin API，本机无从证实。**不要把它当本地行为的依据。**
- 官方 0.63.0 远程 box 的空闲回收策略：不可见。
- 上游 exit-watch 的 daemon 层在本机是否有对应能力由别处承担（如宿主侧）：未穷尽。
- 本轮 `diff` / `shasum` 被权限守卫拦截 4 次（`diff` 触发删除类检测），
  改用容器内符号计数比对，结论未受影响但**未做逐字节 diff**。

## 6. 取证物

- `.scratch/hosts/upstream-sand-exit-watch.py`（622 行，上游原文）
- `.scratch/hosts/ours-sand-exit-watch.py`（281 行，本机原文）
- `.scratch/hosts/upstream-host-main.cjs`（29MB）/ `ours-host-main.cjs`（20MB）
- 逐项出现次数对照表见本文件各节括号内数字，可复算
