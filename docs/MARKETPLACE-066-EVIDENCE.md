# Official 0.66 App-marketplace evidence (CDP capture, 2026-10-04)

Source of truth: the locally installed `/Applications/Grok Bot.app`, `CFBundleShortVersionString`
= **0.66.0**, `com.anysphere.sand`. Captured live over CDP (`--remote-debugging-port=9224`) with the
官方 app running its own account (已安装 16 个). Every number below is a `getBoundingClientRect()`
measurement or an observed DOM class string — nothing here is inferred.

> **Debug-port note.** The official app does *not* always expose CDP. Scan wider than 9222-9225: the
> instance used for this capture was already running **without** a port, and `open -a` produced a
> silent no-op because a second launch is ejected by Chromium's `SingletonLock`
> (`~/Library/Application Support/Grok Bot/SingletonLock`). A relaunch with the port is required,
> and a relaunch that prints `DevTools listening …` and *then exits with status 0* is the singleton
> ejection, not a crash. Note also that our own `Grok Node.app` has a binary named `Grok Bot`, so
> `ps | grep "Grok Bot"` matches both apps — match on the `.app` path, not the binary name.

## 1. Page ladder

```
browse  市场                     dialog[role=dialog][aria-label=市场]  800×702 @ (32,160)
  ├─ 查看全部 (featured)      → section page  (单列, H1 = 分类名)
  ├─ 查看全部 (类目桶)        → results page (双列, H3 结果)
  ├─ click row               → detail page   (插件详情)
  └─ 已安装 N 个             → manage page   (管理插件和技能)
detail / section  → 返回 → previous page
```

The `dialog` keeps `aria-label="市场"` at every level — only the header swaps. The 48px band
(`[33,161,798,48]`) is present on every page and holds the detail bar once you leave `browse`.

## 2. browse (市场)

Scroll content `[33,209,798,2518]`, content column `[65,213,734,2486]` (32px left + 32px right gutter).

```
DIV.sand-settings-pane
  DIV                                       [65,213,734,2486]
    DIV                                     [65,213,734,24]   title row
      H2 · 市场                              [65,213,734,24]
      DIV                                   [629,211,170,28]
        BUTTON.sand-plugins__installed-preview  aria-label="你的插件"
          4 × SPAN.sand-tool-icon 18×18      [635,217] [649,217] [663,217] [677,217]
          SPAN · 已安装 16 个
          I (chevron 12×12)                  [779,219,12,12]
    I (search icon 14×14)                   [78,264,14,14]
    INPUT placeholder=搜索插件                [98,261,693,20]
    DIV                                     [65,307,734,2392] sections
      SECTION ×13
```

Section rhythm — title row 34px, grid 130px (2 rows of 64px + 2px gap), section box 172px,
stride 196px. `为你推荐`/`团队插件`/`登录与凭据管理` box 106px (1 row); stride 130px.

| # | 标题 | 行数 | 查看全部 | y | 首项 |
|---|------|------|---------|---|------|
| 0 | 为你推荐 | 4 | – | 307 | Agent Compatibility |
| 1 | 精选插件 | 4 | ✔ | 503 | Gmail |
| 2 | 团队插件 | 1 | – | 699 | oh-my-claudecode |
| 3 | 登录与凭据管理 | 1 | – | 829 | 1Password |
| 4 | 效率 | 4 | ✔ | 959 | Adobe Developer App Builder |
| 5 | 通信 | 4 | ✔ | 1155 | ActiveCampaign |
| 6 | 设计 | 4 | ✔ | 1351 | Canva |
| 7 | 代码 | 4 | ✔ | 1547 | Amazon Location Service |
| 8 | 数据 | 4 | ✔ | 1743 | Amplitude |
| 9 | 销售 | 4 | ✔ | 1939 | Adspirer |
| 10 | 财务 | 4 | ✔ | 2135 | 1inch |
| 11 | 研究 | 4 | ✔ | 2331 | Ahrefs |
| 12 | 支持 | 3 | – | 2527 | Intercom |

Bucket order matches the ported `CATEGORY_BUCKET_ORDER` exactly
(credentials → productivity → communication → design → code → data → sales → finance → research →
support), with 登录与凭据管理 hoisted to slot 3 (right after 团队插件) and rendered as its own
titled section. **查看全部 appears only when the group has more than the 4-row preview.**

Row anatomy (grid column, 2-column layout — `363 + 8 + 363 = 734`):

```
LI.sand-plugins-row                                    [65,349,363,64]
  BUTTON.sand-plugins-row__open  aria-label="打开 X"     [77,361,281,40]
    SPAN.sand-tool-icon.sand-tool-icon--logo 40×40       [77,361,40,40]
      IMG 39×39
    SPAN.sand-plugins-row__main                          [127,363,231,37]
      SPAN.sand-plugins-row__name   18px line
      SPAN.sand-plugins-row__subtitle 18px line
  SPAN.sand-plugins-row__trailing                        [370,366,46,26]
    BUTTON.sand-button · 添加                              46×26
    — or — SPAN.sand-plugins__added · 已添加              67×20
```

Group action: `BUTTON.sand-plugins__group-action` at `[723, y+7, 64, 20]` — right-aligned to the
grid's right edge (723 + 64 = 787 ≈ 65+734−12). Absent for 支持 (3 rows ≤ 4).

## 3. section pages — two distinct shapes

Both replace the header with `sand-settings-detail-bar` and put the section title in its H3.

### 3a. featured → single column (`精选插件`, 6 items)

```
DIV.sand-settings-pane            [33,209,798,496]
  DIV.sand-plugins__marketplace   [65,231,734,446]
    SECTION                        [65,231,734,446]
      DIV                          [65,231,734,44]
        H1 · 精选插件               [65,231,107,44]      ← h1, 44px
      UL.sand-plugins__grid        [65,283,734,394]
        LI.sand-plugins-row        [65,283,734,64]      ← FULL WIDTH 734
          BUTTON.sand-plugins-row__open  [77,295,631,40]
          SPAN.sand-plugins-row__trailing [720,305,67,20]
            SPAN.sand-plugins__added      67×20 · 已添加
```

### 3b. 类目桶 → two columns, titled 结果 (`效率` 63 items, `研究` 11 items)

```
SECTION                                     [65,231,734,2152]   ← no .sand-plugins__marketplace wrapper
  DIV                                       [65,231,734,34]
    H3 · 结果                                [65,231,48,34]      ← h3, 34px
  UL.sand-plugins__grid                     [65,273,734,2110]
    LI.sand-plugins-row                     [65,273,363,64]
    LI.sand-plugins-row                     [436,273,363,64]
```

**No pagination.** 效率 renders all 63 rows into one scroll area (`scrollHeight 2202` vs
`clientHeight 652`); there is no 加载更多 / 下一页 affordance anywhere in the dialog. "翻页" is
continuous vertical scroll.

## 4. detail page (插件详情)

```
DIV.sand-plugins-detail                      [65,231,734,458 … 677]
  DIV                                        [65,231,734,88]
    HEADER.sand-plugins-detail__header       [65,231,734,56]
      SPAN.sand-tool-icon 56×56              [65,231,56,56]
        IMG 55×55
      DIV                                    [133,237,504,44]
        DIV                                  [133,237,504,24]
          H3 · Ahrefs                          [133,237,50,24]
          BUTTON[aria-label=复制此插件的链接]   [187,239,20,20]
        SPAN                                 [133,263,504,18]
          A[href=…] · 查看源码 + external icon
      DIV                                    [649,241,150,36]
        BUTTON.sand-kit-button · 分享          [649,241,82,36]
        BUTTON.sand-kit-button · 添加 / 卸载    [739,241,60,36]
  P.sand-plugins-detail__desc                 [65,299,734,20]
  DIV.sand-ou54vl                             [65,343,734,346 … 565]
    … 账户 / 工具 / 应用 / 信息 …
```

Observed label set: `复制此插件的链接`, `查看源码` (link, `https://github.com/cursor/plugins`),
`分享`, `添加` (not installed) / `卸载` (installed), `账户`, `工具`, `应用`, `信息`.

Sections, in order, and which ones are conditional:

| 分区 | present when | measured |
|------|--------------|----------|
| 账户 `sand-plugins-detail__accounts` | installed | `[65,373,734,85]`; `default` row 42px + `编辑 default 账户` (10×10) + `sand-plugins__status` 已连接; divider `[77,415,710,1]`; `sand-plugins-detail__add-account` 43px |
| 工具 `sand-plugins-detail__tools` | installed | `[65,504,734,42]`; `已启用 23/23 个` + chevron |
| 应用 `sand-plugins-detail__connectors` | always | header row 30px (`应用` + count), list 58px (`ahrefs` / `连接器`) |
| 信息 `dl` | always | rows 42px, divider 1px between; see below |

信息 rows — **only the fields the entry actually carries are rendered**:

| 字段 | value | seen on |
|------|-------|---------|
| 功能 | `1 个应用` | both |
| 开发者 | `Cursor` | both |
| 类别 | `研究` / `精选` | both |
| 网站 | `cursor.com` | Ahrefs only |
| 可用性 | `公开` | Ahrefs only |

Captured pairs: Gmail (installed, 账户+工具 present, 信息 = 功能/开发者/类别) and Ahrefs
(not installed, no 账户/工具, 信息 = 功能/开发者/类别/网站/可用性). Every non-installed app in
效率 showed the `添加` trailing button (60 of 63).

## 5. Reproduce

```sh
"/Applications/Grok Bot.app/Contents/MacOS/Grok Bot" --remote-debugging-port=9224 &
curl -s http://127.0.0.1:9224/json/list   # pick the page whose url contains "Grok%20Bot.app"
```
