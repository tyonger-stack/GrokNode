# 打开市场的首屏耗时（2026-10-05）

用户反馈「随便打开看就不一样」。详情页对齐之后，这条是**整站对拍时暴露出来的第二个真实差异**，
而且是唯一一个用户每次打开都会撞上的。

## 测量方法

`probe-open-latency.mjs`（scratchpad）：点「连接应用」入口开始计时，每 100ms 采样一次对话框，
直到出现第一个可见的 `.sand-plugins-row__open` 为止。同时记录期间是否出现过加载态文案。
两个 app 各 5 轮，每轮之间关闭对话框、间隔 1.2s。

硬约束：打印 `location.href` 确认是哪个 app；每轮必须以「有行」收尾，未就绪如实报 `>30s` 而不是记 0ms。

## 结果

| | 官方 0.66.0 | 本地（修前） |
| --- | --- | --- |
| 第 1 轮 | 149ms | 5003ms |
| 第 2 轮 | 58ms | 5309ms |
| 第 3 轮 | 55ms | 3449ms |
| 第 4 轮 | 59ms | 4790ms |
| 第 5 轮 | 58ms | 4264ms |
| min / avg / max | 55 / 76 / 149ms | 3449 / 4563 / 5309ms |
| 出现「正在加载市场…」 | **0/5** | **5/5** |

## 归因：不是本地拉得更慢，是本地在等

第一反应是「本地 bridge 慢」。直接量三个调用（`probe-bridge-timing.mjs`，直接调
`window.desktop.mcp`，只读不改状态）后，这个猜测被否掉：

| 调用 | 官方 | 本地 |
| --- | --- | --- |
| `catalog()` | 2792 → 26 → 26ms | 2996 → 19 → 17ms |
| `list()` | 2106 → 1212 → 674ms | 3933 → 1651 → 1412ms |
| `teamPopularity()` | 1455 → 709 → 273ms | 7 → 18 → 17ms |

两边成本同量级，官方甚至更慢（`teamPopularity` 1455ms vs 本地 7ms）。

**决定性推论**：官方 `list()` 单次就要 674ms 以上，而它的行在 58ms 就出现了 ——
所以官方**不等**这次往返就首屏渲染。这不是推断，是两个数字不能同时成立。

## 缺陷本身

`index.ts` 的 `open()` 无条件设 `loading: true`，而 `view.ts` 的 `renderBrowse` 在
`state.loading` 为真时**整块替换**内容为 `CatalogStatus`（「正在加载市场…」）并 `return`。
于是上一轮打开时已经拿到的 model 被一个转圈盖住 3.5–5.3 秒。

数据其实一直在：`close()` 有意保留 `state`，`reset()` 只回退页面栈。所以丢的不是数据，
是那个 flag 把数据藏了。

## 修法

```ts
const cold = state.model.rows.length === 0;
state = { ...state, query: "", installedExpanded: false, loading: cold, catalogError: null };
```

冷启动（没有任何 model）仍然显示状态块——那时确实没东西可画。
`await reload()` 保留，刷新仍在后台发生。

## 守卫

`tests/marketplace-open-latency.test.mjs`，4 条源码断言。**这一层是源码断言，属于本项目里
通常较弱的那一层**——但本缺陷不是类配方也不是像素，而是「一个布尔量传给渲染器的一个提前
return」，两者之间的配对恰好是源码能看见的东西。行为侧的对应物是上面那个 CDP 探针。

三条关键断言：
1. `loading:` 必须由 cold-start 谓词赋值，不能是裸 `true`（裸 `true` 就是缺陷本身）
2. `createMarketplaceDialog` → `append` → `paint` 必须在 `await reload()` **之前**
3. 视图侧必须仍是「整块替换 + return」——如果哪天它不再是提前 return，上面两条就在守空气
