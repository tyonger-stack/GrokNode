# 电脑全屏 Node × 0.71.2 对拍（顶栏 / stage / footer）

更新：2026-10-17。证据源：官方 asar `chunk-box-desktop-modal--0USskmH.js`（`kn`/`vn`/`jn`）；Node CDP `--remote-debugging-port=9333`。

## 1. 树形（承重）

| 层 | 0.71.2 | Node（修前） | 定案 |
| --- | --- | --- | --- |
| fullscreen 子节点 | `[vn 顶栏, body]` | `[顶栏, body]`（控制条 React 位返回 null，portal 进 stage） | **可接受**（portal 宿主在 stage 内即可） |
| stage 子节点 | `[frame/ds, footer>kn]` | **`[footer, frame]`**（placeholder 期 append 后 React 换入 frame） | **必须改**：footer 置底 `ensureFooterLast` |
| kn 挂载 | footer 内 React 子树 | `Wr.createPortal(bar, footer)` | 观感可平价；结构债记下 |

## 2. 几何 / 配方

| 项 | 0.71.2 | Node | 0.18 锚点 |
| --- | --- | --- | --- |
| footer 高 | `sand-dd8jsf` → 52px | 52px | 有 |
| stage 列布局 | control 时加 `sand-dt5ytf` | 我们加 `sand-dt5ytf` | 有 |
| stage 容器查询 | `sand-pqogu8` `container-type:size` | 0.18 已带 | 有 |
| frame 宽 | `min(100cqw, calc((100cqh - 52px) * 1920/1200))` | 同（`STAGE_W`） | inline |
| footer 底色 | `sand-1qj4qm9` = `var(--sand-bg-chrome)` + cover 渐变 | `--cursor-chrome` `#111`（token/类 0.18 皆无） | **等价填充，不造类** |
| kn 边框色 | `sand-5fd6op` = `var(--sand-border-tertiary-translucent)` | `rcompctl-bar` color-mix 近似 | token 0.18 无 → 保持注入近似 |
| kn `padding-inline-end:4px` | `sand-11lfxj5` | `sand-qrzla8`（同声明） | 已对齐 |
| watch-hint | `computer-watch-hint` 2500ms + `isHintShown` | 同延时 + `hintOn` | 文案已 RLocT |
| Take 按钮闪动 | `pn` 专用 class 集（含 0.18 无的 animation 名） | 无 | **暂缓**（缺动画名/box-shadow 类） |

## 3. 顶栏

| 项 | 结论 |
| --- | --- |
| 标记类 `sand-computer-top-bar` / `__actions` | 两边都有 |
| 本轮 | **无锚点差异可改**（未发现 Node 缺官方可映射类） |

## 4. 本轮只改

1. `ensureFooterLast`：stage 子序恒为 `[…, footer]`，MutationObserver 在 childList 变化时重排。  
2. 回归断言锁 `ensureFooterLast` / `lastElementChild!==footer`。

## 5. 明确不改（evidence-only）

- 把 portal 改回官方 React 树内联 `kn`（需重锚 bbn 大块，超出「有锚再改」小时预算）  
- 发明 `sand-1qj4qm9` / `sand-5fd6op` / hint 闪动动画（0.18 CSS 无同声明类）  
- draft / multiplayer / 搜索像素（见 `PORTING-WONT-REPRODUCE.md`）
