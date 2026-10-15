# Library (文档库) 还原记录

**目标**：还原官方 Grok Bot 0.63.0 的 Library 功能数据层。
**证据来源**：`asar/0.68.1/dist/renderer/assets/index-ByKx0M82.js`（1.9 MB，minified）。
**交叉验证**：Wakaru 1.14.0 控制流展开，与人工逐字节读取结果一致。

---

## 1. 入口链

```
qOe (父组件)                       sand_simplified_right_pane 门控
└─ BW   @1824145                   grok_bot_library_v2 门控
   ├─ v2: CG → NG @1608985         includeDocuments / includeExternalDocs
   └─ v1: LW @1579400 + iG @1588976
```

## 2. 数据流

```
kk(agentId)  →  transcript.entries
FRe(entries) →  LibraryItem[]        @1581347
ZF(items,now)→  {today, week, older} @1579435
NG           ←  三路合并: linked.pages + media.items + externalDocs
```

## 3. 还原出的常量

| 符号 | 值 | 位置 |
|---|---|---|
| `RRe` | `["today","week","older"]` | @1579209 |
| `ERe` | `7` | @1579238 |
| `TS` | `5`（每组渐进揭示卡片数） | @1579197 |
| `rEe` | `1e3`（loading 提示延迟） | @1594600 |

> **2026-10-14 复核更正（`$S` 不是揭示批量）**：本表原先记 `$S = 24`（每批揭示卡片数），
> 这是误读。`$S` 是 Library 卡片缩略图的 width/height 像素（@1588049
> `r.jsx("img",{height:$S,width:$S,src:r,…})`），与分页无关。真正的揭示批量是
> `TS = 5`，出现在分组卡片 `oG` 的揭示分页里（@1589691 `c=f_(d,TS,a)`、
> @1589856 `const _=y+TS,I=d.slice(y,_)` → `c.setCount(_)`）。
>
> 双版本交叉验证（防止又是 symbol 漂移误判）：0.68.1 `index-ByKx0M82.js`
> `const TS=5,PRe=10,RRe=[...],ERe=7` @1579197 ↔ 0.70.2 `index-CjjO5fU0.js`
> `const aC=5,eHe=10,tHe=[...],nHe=7` @1763513。四个常量一一对应、值一致，
> 说明揭示语义两版未变，`TS → aC` 只是改名。批量 5 也解释了 0.70.2 里
> `n.items.slice(0,k)` + `k<n.items.length ? "Show more" : null` 的形状：
> 每 5 条一批、按组独立分页（不是全局一次拉全部）。

## 4. 分组边界（与直觉不同，重点）

```js
PS(now, daysBack)  = 本地时区 new Date(now) → setDate(-daysBack) → setHours(0,0,0,0)
MRe(ts, now)       = ts == null        ? "older"
                   : ts >= PS(now,0)  ? "today"
                   : ts >= PS(now,6)  ? "week"
                   : "older"
```

- **"本周" = 本地午夜 6 天前**，不是滚动 168h，也不是自然周（周一）。
- 同一个 group 实际跨度在 6–7 天之间，取决于当前时刻。
- `timestampMs == null` 一律进 `older`，无时间戳条目不会被提升。

## 5. 归属三分法

```
QF(entry) = ORe(entry) ? "returned-artifact"
          : zRe(entry) ? "user-upload"
          : "bot"
```

逐 source 再判一次（`RS`）：即使 entry 本身是 `bot`，若该 source 命中用户上传路径集合
（经 `Ay()` 做 `file:` → 路径归一），仍标记为 `user-upload`——**防止 agent 回显用户文件时被洗白**。

## 6. 项目符号四类

```js
{ kind:"image"|"video", id:`${entry.id}:visual:${src}`, source, name }
{ kind:"file",          id:`${entry.id}:file:${src}`,   source, name }
{ kind:"link",          id:`${entry.id}:link:${url}`,   url }
```

- 去重 Set 跨整条 transcript 共享，按 `visual:` / `file:` / `link:` 前缀区分。
- **首次出现胜出**；结果 `.toReversed()`（transcript 是旧→新，Library 要新→旧）。
- files 额外跳过已被 visual 占用的 source，以及 entry 自身的 link。

## 7. 状态机

`KRe`: `hasOlder ? (isLoadingOlder ? "loading" : olderFailure==null ? "loadable" : "failed") : "exhausted"`

---

## 8. 对先前草稿的更正

先前基于 0.18.0 的 `TranscriptMessage` 模型写过一版，**六处实质性错误**：

| 项 | 错误草稿 | 官方 0.68.1 |
|---|---|---|
| 第三组 key | `"earlier"` | **`"older"`** |
| 分组边界 | 滚动 24h / 168h | **日历午夜，6 天前** |
| 条目种类 | 仅 file | **image / video / file / link** |
| 归属判定 | 仅 `role === "assistant"` | **bot / user-upload / returned-artifact 三分** |
| 数据源 | 单路 transcript | **三路合并：pages + transcript + external docs** |
| 渐进揭示 | 无 | **`TS = 5` 按组分页 + 高度捕获 FLIP** |

第三组 key 那个错尤其值得记：产物里 `grep Earlier` 有 2 次命中，容易误判为 `earlier`；
真值是 `older`，另两次命中来自无关上下文。

---

## 9. 边界声明（未还原）

以下函数在 1.9 MB 主 chunk 的提取区间之外（位于 vendor split），**已恢复调用点、未恢复函数体**，
在 `library-core.ts` 中以 stub 形式标注 BOUNDARY：

`kN`(视觉抽取) · `sae`(artifact URL 探测) · `pae`(三路合并) · `mae`(external docs hook)
· `kk`(transcript store) · `Qi`(session id) · `lae`(transcript key)
· `a1`/`ni`(文件名推导) · `nae`/`nC`(link 提取) · `B4`(视频判定) · `f_`/`m_`(揭示分页)

这些是换入上游真实模块即可替换的接缝。

---

## 10. 验证

- `npx tsc --project frontend/tsconfig.json --noEmit` — 通过
- `npm run frontend:build` — `✓ built in 3.37s`
- 扩展打包 — 8.0 KB IIFE，CSS 经 `?inline` 插件内联
- 24 条行为断言（分组边界 11 / 归属 6 / file URL 4 / 空组顺序 2 / 状态机 4，另 1 条跨日边界）全部通过

**未覆盖**：`projectLibraryItems` 的端到端行为，因为其依赖的 `kN`/`BRe`/`LRe` 仍是 stub，
需接入真实 transcript store 后才有意义。

---

## 11. 挂载位变更（2026-10-11，用户定案：例行任务正下方）

资料库分节改挂**例行任务分区容器之后**（用户截图定案），不再追加 info-pane 末尾。

锚点链（全部 locale 无关，源 `index-UbX-y3il.js` @2734249/@2774922 逐字节核对）：

```
pane 内例行任务分区容器（styled-div，无稳定类名）
├─ 标题行: span.sand-info-pane__section-heading（文案随 locale 变，不可作锚点）
│          + button[data-routine-row="new"]（Create Routine ➕）
└─ K2n 输出: ul.sand-routine__list（非空） / div.sand-routine__empty（空态）
              ← 从此稳定子锚点回溯 parentElement 得分区容器
```

- 插入位：分区容器 `nextSibling` 位 ⇒ 例行任务与后续分区导航（D2n）之间。
- 同步守卫：条目签名（挂载位 + 分钟取整 now + 条目 id@timestamp 列表）不变且分节在位
  ⇒ 跳过重建。止住「重建→自身 MutationObserver→再重建」的 300ms 自持循环，
  同时保住「显示更多」的揭示进度不被周期性回滚。
- 回归：tests/library-extension.test.mjs 第 3 用例断言 previousElementSibling/nextElementSibling
  精确位置 + 幂等；尾部 finally 停观察者再关窗（断言抛错也不挂起进程）。
