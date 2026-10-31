# Marketplace 0.78.1 port

This wave ports five official Grok Bot 0.78.1 deltas of the "连接应用" marketplace onto upstream
0.18's own plugins chunk. It replaces the 0.75.8 wave: the 0.75.8 scripts
(`marketplace-browse-chrome-0758-patch.mjs`, `marketplace-dialog-0758-css-patch.mjs`,
`marketplace-browse-chrome-0758-css-patch.mjs` and their two CSS companions) are deleted in the
same wave, and `scripts/clean-build.mjs` now runs the 0.78.1 chain instead.

| id | What official 0.78.1 changed | Where it lands |
|---|---|---|
| P1 | the plugins dialog is 900 px wide, not 800 px | `marketplace-official-wording-patch.mjs` (the class recipe) + `marketplace-dialog-0781-css-patch.mjs` (the rules) |
| P2 | the browse page groups the catalog by official's eleven chip categories | `marketplace-browse-chrome-0781-patch.mjs` |
| P3 | a 为你推荐 section leads the list, and every over-full section carries a 查看全部 group action | same |
| P4 | a Bot 模板 ↗ button sits on the search row | same |
| P5 | a row's trailing action is 连接 / 正在连接… / 已连接, and there is no button once connected | same |

## The evidence

Everything below is measured or read out of official 0.78.1, never invented.

**Official 0.78.1's own sources.**

| artefact | what it carries |
|---|---|
| `rea-grokbot-0781/app/dist/renderer/assets/chunk-marketplace-browse-model-9vlJFqic.js` | the browse model: `b` (chip order), `x` (upstream-category-key map), `O`/`M` (an entry's chips), `P` (group by chip), `y` (ranking), `W` (logo urls), `F` (chip message ids), `I` (leading sub-category), `Zo` (native markers), `hm` (locale lowercase), `E` (key normalisation) |
| `rea-grokbot-0781/app/dist/renderer/assets/index.eager-app-D1juOWZp.js` | `MAt` (the section component), `NAt` (the group action), `Pq` (the connected status), `hm` |
| `rea-grokbot-0781/app/dist/renderer/assets/chunk-view-KV06RTpF.js` | the browse section component (`Qo`, `pluginLimit`), the chip row (`Ga`), the row's trailing action (`iSLIjg`/`JrFTcr`/`QHcLEN`/`5ZzgbQ`), the dialog class recipe |
| `rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css` | the 36 stylix rules this wave lifts |
| `rea-grokbot-0781/app/dist/renderer/assets/chunk-core-CXBwRBzw.js` | the zh-Hans locale entries |
| `rea-grokbot-0781/app/dist/renderer/assets/index.eager-common-DbK3Oi_r.js` | the English locale entries |

**Live measurement on official 0.78.1 (CDP 9333, 2026-10-30).**

* Thirteen sections in the "all" state: 为你推荐, then the eleven chip buckets, then 团队插件.
* Each section previews **six** rows. A section carries 查看全部 exactly when it holds more than six.
* The chip row holds **seven** buttons — 全部, the first five chips, and 更多 — and 更多 opens a
  dropdown with the remaining six chips.
* Selecting a chip leaves **one** section: that chip's full list, with no group action.
* 为你推荐's 查看全部 leaves the chip selection alone and appends a hero block at the end of the
  list: a `<section>` whose header is an `<h1 data-detail-hero-title>` reading 为你推荐, holding 24
  rows.
* The dialog measures 900×702.
* A connected row has **no** button in its trailing slot — only the 已连接 text.

## P1 — the dialog is 900 px wide

Official 0.78.1's dialog recipe is
`sand-1sdb7ul sand-tqtr64 sand-1eh7du3 sand-1717udv sand-xrbq2n sand-1j6au1h sand-pe8fed sand-1r6a6jf`
and its layout recipe is
`sand--default-marker sand-9f619 sand-1n2onr6 sand-78zum5 sand-dt5ytf sand-xe7e0x sand-2lwn1j sand-7giv3`.

Upstream 0.18 ships `sand-1gys7z3` = `width:min(1e3px, calc(100vw - 40px))`, so the dialog was
1000 px; the 0.75.8 wave replaced that with `sand-h6vr4k` = `width:min(800px, 100vw - 40px)`.
Official 0.78.1 ships `sand-1sdb7ul` = `width:min(900px, 100vw - 32px)`.

Eight rules are missing from upstream 0.18's stylesheet and are lifted verbatim into
`scripts/lib/marketplace-dialog-0781-official.css`:

```
.sand-1sdb7ul  width:min(900px,100vw - 32px)
.sand-tqtr64   width:min(560px,100vw - 32px)      (the custom-connector overlay)
.sand-1eh7du3  max-width:calc(100vw - 32px)
.sand-xrbq2n   transition-property:width
.sand-1j6au1h  transition-duration:.3s
.sand-pe8fed   transition-duration:.12s
.sand-1r6a6jf  transition-timing-function:linear(...)
.sand-xe7e0x   height:min(700px,100vh - 96px)
```

The height cap moved with the width: 0.75.8 shipped it as `sand-z03ioa`, official 0.78.1 ships the
same declaration under `sand-xe7e0x`. The 800 px rule disappears with the wave, because the whole
0.75.8 CSS companion is deleted.

## P2 — the chip taxonomy as the section taxonomy

`MARKETPLACE_0781_CHIP_REGISTRY` in `scripts/lib/marketplace-browse-chrome-0781-patch.mjs` is the
only place a chip is named. The chip order, the upstream-category-key → chip map, the labels and
the message ids are all derived from it, so nothing is written twice.

The eleven chips are official's own (`b` in the browse model): credentials, productivity,
communication, design, code, data, sales, marketing, finance, research, support — with official's
message ids (`P+nzjE`, `N42ane`, `hZotg6`, `f8fH8W`, `EWPtMO`, `HKH+W+`, `mUv9U4`, `vo2a+a`,
`8V6XO3`, `bdztP2`, `XYLcNv`).

An entry's chip comes from official's `O` (its plugin name) first and official's `M` (its upstream
category key) second; the two never merge. Upstream 0.18's catalog carries `categoryKey`
(`FEATURED`, `PRODUCTIVITY`, `INFRASTRUCTURE`, …), so official's `x` map applies unchanged.
Official's map has no chip for `FEATURED` or `AGENT_ORCHESTRATION`, so those entries fall out of
every chip bucket — official-faithful, and asserted by the test.

Official's grouping skips an entry whose `marketplace` field is set. Upstream 0.18's catalog
declares `marketplace` as an optional object and leaves it unset for ordinary plugins, so
official's literal guard works unchanged.

## P3 — 为你推荐 and 查看全部

**The section.** Official's `y` ranking is ported literally: the team signal, the affinity signal,
the quotas (`m = {team: 0, affinity: 1}`, `h = .5`) and the tie-break (popularity rank, then
display name). The affinity bucket is the locale-lowercased `entry.category`, which is official's
`hm` — `toLocaleLowerCase(locale || "en")`, `ς` → `σ`, and `ı` → `i` only under `tr`.

**The group action.** Official's `NAt` markup, and its threshold: a section carries 查看全部
exactly when it holds more than six entries. The port carries that as `hiddenCount`, the number of
entries the six-row preview hides. `hiddenCount === 0` means "show every row", which is how a
selected chip renders its full list.

**The two semantics.** A chip section's 查看全部 selects that chip, exactly as clicking the chip
does. 为你推荐's 查看全部 does not touch the chip selection: it appends official's hero block at the
end of the list, with official's own markup and class recipe
(`sand-1mmermx sand-vh7mc1 sand-1ehaq9d sand-1ghz6dp sand-f159sx sand-1g0dm76 sand-tyxrsu
sand-1rhlpx6 sand-iorvi4 sand-sag5q8` on the `<h1 data-detail-hero-title>`).

## P4 — the Bot 模板 button

Official's own markup: a `<button data-bot-templates-link>` with official's class recipe, the
grok-bot mark, the label (`bpVWP/`, Bot 模板 / Bot templates) and the `arrow-right-up` icon.

**The button is inert, and that is official's own behaviour.** Clicking it on official 0.78.1
produced no observable change on 2026-10-30: the dialog's innerHTML length did not move, no new
dialog opened and the URL did not change. The port renders the same button with the same
behaviour — no template browser is invented.

## P5 — the trailing connect action

Official's row renders one button whose three labels are stacked in the same grid cell, with the
inactive ones hidden (`sand-lshs6z` = `visibility:hidden`, and `sand-1agbcgv`/`sand-crlgei` pin every
label to grid row 1 / column 1 so they overlap).

| state | official's message id | text |
|---|---|---|
| connect | `iSLIjg` | 连接 / Connect |
| connecting | `JrFTcr` | 正在连接… / Connecting… |
| connected | `QHcLEN` | 已连接 / Connected |

A **connected** row has no button at all — only the 已连接 text, in official's `sand-plugins__added`
markup. Upstream 0.18's own `添加` button and `已添加` badge are both replaced.

## The jsx runtime — why the first cut of this port rendered empty elements

Upstream 0.18's renderer chunk calls React through the **automatic** runtime: the chunk's own `t`
is `jsx`/`jsxs`, so the signature is

```
jsx(type, props, key)
```

The third argument is the **key**, not children. Upstream's own code follows that convention
everywhere: children live in a `children` property of the props object, and the third argument
is a key.

The classic convention — `jsx(type, props, children)` — looks natural to write but is silently
wrong here. React consumes the children as the key, the element ends up with no children, and it
renders as an **empty element**. Nothing throws, the chunk still parses, and every test that
looks at strings passes. The UI just loses its text.

The first cut of this port was written in the classic convention in ten places, and the live
build showed exactly that: the chip labels, the 查看全部 group action, the Bot 模板 button and
the connected-apps entry were all present in the DOM and all empty. The structure and the class
recipes were right; only the text was missing.

`scripts/lib/marketplace-jsx-children.mjs` now rewrites those call sites. The rule is precise
and is checked against upstream 0.18's own code, which contains three three-argument DOM calls
whose props all declare `children:` — their third argument is a key, and the transform leaves
them alone:

| condition | consequence |
|---|---|
| the first argument is a string literal (a DOM element) | the third argument can only be children |
| the props object already declares `children` | the third argument is a key |

The transform parses the source, rewrites one call site per pass and re-parses between passes, so
a call nested inside another call's children argument is handled from the inside out. It is
idempotent, and it throws rather than shipping a source that does not parse.

## The CSS this wave lifts

Twenty-eight rules go into `scripts/lib/marketplace-browse-chrome-0781-official.css`, all copied
byte-for-byte from official 0.78.1's stylesheet.

The 0.75.8 companion carried six of them and **missed three**, which was a real defect rather than
a false alarm: the 0.75.8 chip row had no background at all and its selected state had no text
colour.

| class | official 0.78.1's rule | 0.75.8 |
|---|---|---|
| `sand-fwqdrz` | `background-color:var(--sand-bg-secondary)` | missing |
| `sand-8rotk8` | `background-color:var(--sand-bg-primary)` | missing |
| `sand-sa7k8x` | `color:var(--sand-text-inverted)` | missing |

### One deliberate class-name substitution

Official 0.78.1's chip recipe carries `sand-ymw2ht` = `border-radius:9999px`; upstream 0.18 hashes
that same declaration to `sand-149ho13`. The chip row uses `sand-149ho13`, so the rule does not have
to be injected for it. The group action, the Bot-templates button and the connected status keep
official's `sand-ymw2ht`, whose rule this wave lifts. Both names declare `border-radius:9999px`, so
the rendered result is identical.

### Every lifted rule is byte-for-byte official

The `:not(#\#)` repetitions in a stylix rule are the specificity ladder that orders the rule
against its neighbours, so their **count** is part of the rule, not decoration. A rule whose
declaration matches but whose guard count is short is a different rule with a lower specificity,
and it loses to a neighbour that upstream's own stylesheet already carries:

| class | official's rule | upstream 0.18's neighbour |
|---|---|---|
| `sand-1eh7du3` | `max-width:calc(100vw - 32px)`, 4 guards | `sand-w7nakj` has the same declaration with 4 guards |
| `sand-xrbq2n` | `transition-property:width`, 3 guards | `sand-1eaenvl` sets `transition-property` on the same button |
| `sand-1r6a6jf` | `transition-timing-function:…`, 3 guards | — |
| `sand-1v39l1b` | `outline-color:var(--sand-border-focus-primary)`, 3 guards | `sand-1uczgqu` sets `outline-color:transparent` on the same button |

All thirty-six lifted rules are copied byte-for-byte from official 0.78.1's stylesheet, guard
count included, and a test asserts it.

## The theme tokens — official 0.78.1's palette, scoped to the dialog

Lifting official's rules is not enough. Those rules read design tokens, and official 0.78.1 resolves
them from a **newer palette** than upstream 0.18 ships:

| token | official 0.78.1 | upstream 0.18 |
|---|---|---|
| `--sand-bg-primary` | `#f5f5f5` | **not defined** |
| `--sand-bg-secondary` | `#f5f5f50a` | **not defined** |
| `--sand-text-inverted` | `#121212` | **not defined** |
| `--sand-text-primary` | `#f5f5f5` | `#fcfcfc` |

A token that is not defined makes `var()` invalid at computed-value time, so the rule falls back to
its initial value: the chip surfaces render transparent and the chip labels inherit the colour
around them. Nothing throws, the chunk still parses, and every test that looks at strings or class
names passes. The dialog just looks wrong.

`scripts/lib/marketplace-dialog-0781-theme-tokens.css` therefore declares official's palette on
`.sand-plugins-dialog`, with the dark variant under `html[data-theme="cursor-dark"]` — the exact
attribute upstream 0.18's own theme installer sets (`runtime-theme-token-installer.ts`,
`Bzn()` → `documentElement.dataset.theme = "cursor-dark" | "cursor-light"`).

The scope is deliberately narrow, the same convention this repository already uses for the 0.75.8
info-pane and the 0.75.3 composer ports: official's palette is applied to the marketplace dialog
subtree, and the rest of the app keeps upstream 0.18's token set.

### Official keeps two token families, and they are not interchangeable

Official declares a `cursor-*` family (`:root,.ui-qruemj`) and a `sand-*` family
(`:root,.sand-1hqobez`) with **different numbers**:

| | base | lg |
|---|---|---|
| `--cursor-font-size-*` | 13px | 14px |
| `--sand-font-size-*` | 14px | 15px |

The ported rules read from both — the section title takes its size from `--cursor-font-size-lg` and
its line height and letter spacing from `--sand-line-height-base` / `--sand-letter-spacing-base` —
so both families are reproduced.

### The `--cursor-*` forwarding has to be re-declared

Upstream 0.18 forwards the whole `--cursor-*` family to `--sand-*` at `:root`:

```css
--cursor-bg-elevated: var(--sand-bg-elevated);
--cursor-text-primary: var(--sand-text-primary);
```

A custom property's `var()` is substituted where the property is **declared**, so those are already
computed against `:root`'s palette and inherit down unchanged — overriding `--sand-bg-elevated` on
the dialog cannot reach them. Official 0.78.1 forwards the same way, so the same forwarding is
re-declared on the dialog, against the dialog's own `--sand-*` values. Official's mapping is
reproduced exactly; only the values differ.

### Where the values come from

* **dark** — the running official app's computed values on the live 连接应用 dialog (theme
  `cursor-dark`). Official's static CSS `:root` groups are an older generation for some tokens
  (font-weight 400 vs 425, letter-spacing .005em vs 0.01em), so the runtime is the authority.
* **light** — official's own light palette block `:root,.sand-1vbcnu7` in its stylesheet.
* **typography** — theme-independent in official: the font sizes, line heights, letter spacings and
  the cursor font sizes are all declared outside any theme selector, so one value serves both
  themes.

Two tokens are deliberately not copied verbatim:

* `--sand-border-focus-primary` — official's palette declares `#1e86fc`, but official's
  `:root:not([data-sand-keyboard-nav])` rule forces `transparent!important` while keyboard
  navigation is off. That rule carries no tone selector, so the **rendered** value is `transparent`
  in both themes, and the rendered value is what the port reproduces. Upstream 0.18 ships no such
  rule at all.
* the four tokens official leaves undefined (`--sand-text-disabled`, `--sand-fill-ghost-hover`,
  `--sand-border-focus`, `--cursor-easing-default`) are reset to `initial`, the guaranteed-invalid
  value, so upstream's definitions do not render where official renders nothing.

### The guards

`tests/marketplace-browse-chrome-0781.test.mjs` asserts that the token block carries exactly the
captured official values, that every token which differs between official's themes is declared in
the dark block, that the scope never leaks to `:root`, and that official's own stylesheet agrees
with the captured fixture — the light palette statically, the cursor font sizes statically at
`:root,.ui-qruemj`.

The guard that would have caught the actual defect is **every token the ported rules read is
declared on the dialog**: it walks the rules of every class the port applies, collects their
`var(--x)` references and requires each one to be declared on the dialog subtree. "Upstream happens
to define it" is not accepted, because upstream's value is the wrong one.

## The typography — official's form-control reset

Official 0.78.1 resets every form control globally:

```css
:where(button,input,select,textarea) {
  font-family: inherit;
  font-size: var(--sand-font-size-sm);
  font-weight: inherit;
  line-height: var(--sand-line-height-sm);
  letter-spacing: var(--sand-letter-spacing-sm);
  font-feature-settings: inherit;
}
```

and its `:root` rule carries `font-weight: var(--sand-font-weight-regular)`, which official's
runtime sets to **425** — the regular weight of `XVF`, the variable font official ships.

Upstream 0.18 has the reset only under `.sand-info-pane__inner`, so every `<button>` inside the
marketplace dialog falls back to the browser's own `font: 400 13.333px Arial`, and upstream's
runtime writes **420** where official writes **425**. The measured result was that the chip labels,
the group action and the Bot-templates button rendered at weight 400 in the reconstruction and 425
in official — with every other colour already matching.

`scripts/lib/marketplace-dialog-0781-typography.css` ports the reset declaration for declaration,
in the same `:where()` construction, so it keeps official's zero specificity and weighs against
upstream's class rules exactly as official's global rule weighs against official's. Only the scope
is narrowed:

```css
:where(.sand-plugins-dialog) :where(button,input,select,textarea){…}
.sand-plugins-dialog{font-weight:var(--sand-font-weight-regular)}
```

`XVF` itself is proprietary and is **not** shipped, so the font *family* still differs — that is the
one typography difference that cannot be closed.

## The header and toolbar layout — official's three rows

Official 0.78.1's dialog stacks three rows, measured live over CDP on 2026-10-30 (900 px dialog,
dark theme):

| row | official | upstream 0.18 |
|---|---|---|
| 1 | the title band (24 px) with the connected-apps entry pinned to the right inset | the title component carries its own 32/6/32 px padding, and the entry had nowhere to go |
| 2 | the search field filling the row (671 px input) with the Bot-templates button at its right | the search field, the Bot-templates button, the segmented control and the filter icon shared one row, and the field measured 208 px |
| 3 | the chip row, 12 px below | the chip row shared the toolbar row |

The port rewrites the header row in the renderer patch (the entry moves out of the toolbar into the
title row) and gives the rows their geometry in `scripts/lib/marketplace-dialog-0781-layout.css`.

**Upstream's utility classes outrank a class-only rule.** Upstream 0.18's stylix classes raise
their own specificity with `:not(#\#)` pseudo-ids:

```css
.sand-1c4vz4f:not(#\#):not(#\#):not(#\#){flex-grow:0}
.sand-1miatn0:not(#\#):not(#\#):not(#\#):not(#\#){padding-top:32px}
```

so every rule in the first cut of this layout — all of them class-only — lost. The header stayed at
`flex: 0 0 auto`, the toolbar row stayed at 381 px and the search field at 208 px, with the rules
sitting in the stylesheet looking applied. Following the convention of
`scripts/lib/app-columns-0758-official.css`, every rule that has to beat one of those carries one
more `:not(#\#)` pseudo-id than the rule it overrides. The regression test compares the two
selectors' specificity directly, so the failure mode cannot come back silently.

**The title text.** The header replacement writes official's own locale call,
`title:(RLocT("Plugins","连接应用"))`. A first cut wrote `title:"Plugins"` — the word the wording
patch rewrites — so the dialog rendered the English label. The wording patch runs before the
browse-chrome patch, so the replacement has to be written in the post-wording form.

**The filter button.** Official's marketplace view has no filter icon: its only icon-only button is
the dialog's close button, which is absolutely positioned outside the toolbar. Upstream 0.18 keeps a
28 px "Filter plugins" button in the search row, and that button is 28 px of official's search field
width. The port hides it (`display:none`), which leaves upstream's filter menu itself untouched —
only its entry point disappears.

**The band above the title.** Official's dialog shell pads its content, so official's title band
starts 53 px below the dialog's top edge. Upstream 0.18's marketplace container starts at the top
edge, so the port reproduces the band with 52 px of padding on the container. The padding is on the
container, not on the title row, so the title row keeps official's 24 px height and the entry stays
centred on the title band.

**The chip row was empty because the toolbar memo did not depend on the catalogue.** Upstream 0.18
renders the whole toolbar — the title, the search field and, after this port, the chip row — inside a
React-compiler memo whose dependency list is `[Ts, w, G, a, W, m, Me, g, p]`. The marketplace items
(`wt`, the catalogue filtered by the query and the filter state) are **not** in that list, so the memo
keeps the tree it built on the first render, when the catalogue is still empty. The chip row reads
those items (`RM0781ChipRow(wt)`), so it rendered nothing and never recovered, while the sections
below it, which are rendered outside the memo, showed every chip section. Measured on the deployed
build before the fix: eleven sections, zero chips.

The port adds the items to the memo's dependency list (`e[902]!==wt` in the condition and
`e[902]=wt` in the store), which is what the React compiler itself emits for a component that reads
them. The regression test asserts that the toolbar's memo depends on the items whenever the chip row
reads them, and that guard was mutation-checked: with the dependency removed it fails.

**The chip row's selected state was frozen for the same reason.** The memo also did not depend on the
selected chip, so the chip row kept the state it had on the first render: the section list below
switched to the chosen chip — it is rendered outside the memo — while the chip row itself kept
`aria-pressed` on 全部 and the unselected class. Found by driving both apps through the GUI: in
official, clicking 效率 moves the pressed state (全部 1 → 0, 效率 0 → 1); in the reconstruction, the
list switched to 效率 while the chip row still showed 全部 selected, and clicking 效率 a second time
did nothing, because the stale `selectedKey` made the toggle look like a first click.

The port adds the selected chip to the same memo (`e[903]!==RM0781Chip` in the condition and
`e[903]=RM0781Chip` in the store). Measured on the deployed build after the fix: clicking 效率 gives
全部=false, 效率=true and the chip's own selected class; clicking 效率 again returns to 全部=true and
the full list, and clicking 全部 is idempotent. The regression test asserts the dependency, and a
second test mutates the patch (drops the dependency, keeps everything else) and asserts that the
guard then fails — so the guard cannot rot into a no-op.

**The content column.** Official's chip sections sit in a wrapper that pulls them 12 px past the
pane's 32 px padding — official's own rule is `.sand-lhcdhu:not(#\#):not(#\#){margin-inline:-12px}` —
so official's sections start 21 px from the dialog's edge and measure 858 px in the 900 px dialog.
Upstream 0.18's wrapper (`div.sand-plugins__marketplace`) has no such margin, and upstream's
stylesheet declares no rule for that class at all, so the port's layout CSS carries the margin
itself. The ported section also uses official's `sand-167g77z` (gap:8px) instead of upstream's
`sand-xhr3t` (gap:0), which restores the 8 px between a section header and its grid.

**Two deliberate class substitutions.** Official's connected-apps entry carries `sand-1x4j3cz`
(border-radius:8px) and its logo slot carries `sand-focxiw` (border-radius:6px). Upstream 0.18's
stylesheet declares no rule for either name, but it does declare `sand-1qmwy7c` (border-radius:8px)
and `sand-t9pb60` (border-radius:6px) — the same declarations under upstream's names. A stylix
class name is the hash of its declaration block, so the two names declare the same thing and the
port swaps them; that keeps every class the port applies resolvable in upstream 0.18's own
stylesheet.

## Operational notes

**A stale process silently owns the CDP port.** The first live check after the jsx fix reported
empty chip labels, and the cause was not the port: an older build was still running from a
previous location and held the debugging port, so the freshly deployed app never bound it and every
probe read the old process. Match the process by its executable path (`ps -o comm=`), not by its
working directory — the official app is `/Applications/Grok Bot.app/…`, ours is
`/Applications/Grok Node.app/…`, and a relative `./Grok Bot` shows up when the app was launched
from inside its own bundle directory.

**Verify the deployed asar, not the staged tree.** The staged `.build/fidelity` tree and the
deployed `/Applications/Grok Node.app` can disagree, and the disagreement is invisible until the
live app is measured. The verification reads the deployed `app.asar` directly.

**Another session shares this machine's deploy path.** `/Applications/Grok Node.app` is not this
port's private build directory. A second session working in the main checkout builds the same app
and deploys it to the same path, and it deployed a `ditto` **merge** of its own build over ours:
that replaced `Resources/app.asar` and `Contents/MacOS/Grok Bot` while leaving
`app.asar.unpacked` from our build. The result was a hybrid bundle whose asar was not ours, and the
symptom was a deployed bundle that answered the verifier with "16 ported rule(s) are missing" while
the live app showed upstream's own taxonomy instead of the port's.

Two lessons. Deploy with a full replace — remove the bundle, then `ditto` — never a merge, because a
merge leaves a bundle that is half one build and half another. And compare the deployed tree with
the built tree before trusting it: the deployed asar's sha256 and the built asar's sha256 must be
equal, and they must still be equal after the app has run. The port's own measurements also use a
CDP port of their own (9245) so that a second session probing 9224 cannot answer for this build.

**Match the process by its executable path, not by its working directory.** See the note above.

## What official 0.78.1 has that this port does not carry

| official item | why it is skipped |
|---|---|
| the 团队插件 section | it needs the cloud's `teamInstallCounts`. Grok Node has no team data, so official's team signal is always empty here. |
| `countConnectedApps`'s lazy chunk | a separate official chunk for the connected-app count. Upstream 0.18 counts its installed plugins in the chunk itself. |
| the `sand_connect_apps_collapse` remote config | an official remote-config flag for collapsing the connect-apps entry. Upstream 0.18 has no remote config surface for it. |
| official's `eager-app` bundling refactor | official moved the plugins view into an eager bundle. This port keeps upstream 0.18's chunk and rewrites it in place; the port never rebuilds the renderer. |

## Known differences and the trade-offs behind them

**The team signal is empty.** `teamInstallCounts` is `{}` in this build, so official's team branch
never fires. Official's own ranking then depends entirely on the affinity signal.

**Official's ranking can return nothing.** `y` only ever emits a team signal or an affinity
signal, so a profile with nothing installed and no team data gets no recommendation at all — and
为你推荐 would render as a bare header. The port keeps official's three loops verbatim and falls
back, only when they produce nothing, to official's own tie-break order over the same 24-entry
limit. This is the one behaviour in the port that official does not have; it is recorded here
rather than hidden.

**The connect button keeps its `aria-label`.** Official's source passes
`aria-label: {id: "5ZzgbQ", values: {0: displayName}}` — "连接 <name>" — but official's own button
component drops the attribute, so the live official DOM has no such label. The port keeps it: it is
official's own message id and template, and dropping an accessible name would be a regression. The
difference is intentional.

**The pending state keeps upstream's spinner.** Official renders a different component
(`Qn`) for the pending state; upstream 0.18 has its own `sand-plugins__add-pending` spinner
(`dt`), which this port keeps and relabels with official's 正在连接….

**The rows stay upstream's.** Official's row component (`FAt`) and grid (`PAt`) are not ported.
Upstream 0.18's row and grid are the same components one generation earlier, and the port writes
official's trailing markup into upstream's row.

**The search-results section stays upstream's.** When a query is active, upstream 0.18 renders one
results section through its own `ri` component with its own overflow button. The port leaves that
path untouched and only replaces the browse (unfiltered) sections.

**The dropdown kit stays upstream's.** Official's chip row opens its 更多 menu with official's own
radix wrapper; the port uses upstream 0.18's `re` dropdown kit, which renders the same menu with
upstream's own styling.

**Upstream 0.18 has no `popularityRank`.** Official's tie-break reads that field first; upstream's
catalog does not carry it, so the tie-break always falls through to the display name.

**The chip row's 更多 trigger.** Official's trigger shows the selected overflow chip's name when
one is selected and 更多 otherwise, and `aria-pressed` follows the selection. The port reproduces
both.

**The password-manager section is empty here.** Official's catalogue contains password managers
(1Password), so official shows a 密码管理器 section and puts that chip in the visible row. The
reconstruction's catalogue has none: searching the dialog for `password` and for `1password`
returns zero rows. The taxonomy itself is complete — the registry carries the `credentials` chip
with official's own message id — so the section appears as soon as the data does. The visible chip
row is the first five chips that have entries, so it shows 数据 where official shows 密码管理器.

**The search field keeps upstream's input component.** Official's bar puts the search field on its own
full-width row: official's field measures 712 px and its input 671 px in the measured window. The
port reproduces that row, so the reconstruction's field measures 735 px and its input 693 px — 23 px
and 22 px wider, because official's Bot-templates button is 23 px wider (see below). The field's own
component, its 14 px magnifier and its placeholder are upstream's.

**The connected-apps entry is narrower here.** Official's entry measures 172×28 because it shows the
logo stack of the apps it has connected — 25 of them in the measured session. This build has none
connected, so the entry measures 94×24: the same recipe with no stack to show. The recipe itself is
official's — the button's class list, its 12 px / 425 type and its 4/8/4/4 padding are official's own.

**Official's title scrolls away; ours does not.** Official's title row is the first row of the
dialog's scrolled pane, so it scrolls out of view together with the sections. Upstream 0.18's
plugins pane has a fixed title component above the scroll area, and the port keeps that structure:
the title band, the search row and the chip row stay put while the sections scroll. Reproducing
official's structure would mean moving upstream's shared settings-pane header into the scroll area,
which the port does not do; it reproduces official's visible three-row geometry instead.

**The Bot-templates button is one pixel wider.** Official's button is 114 px and the reconstruction's is
115 px. Both carry the same mark — the port rebuilds official's inline Grok-bot SVG as its own path
data, not as a copied asset file — at the same 18×18 size, with the same path box (6, 6, 17, 17) and
the same `sand-grok-bot-mark sand-1n2onr6` classes. On the build before the chip-selection dependency
was added (see below) the mark had no size in the memoized toolbar and the button measured 91 px;
after the fix it renders, and it renders the same in both apps.

**The plugin detail page is upstream's.** Clicking a card opens a detail view inside the same dialog.
Official's shows a back arrow, the icon, the description, a connect button and an information table.
The reconstruction shows upstream 0.18's own detail view — the name, 查看源码, 添加, the description and
the plugin's skills. The browse path is the ported surface; the detail view is upstream's component,
kept as it is.

**The connect action keeps upstream's button component.** Official renders it with its own button
recipe (a `--sand-bg-secondary` surface); upstream 0.18's button component has a different one. The
port writes official's trailing markup into upstream's row and keeps upstream's button.

**The section count follows the catalogue.** Official renders thirteen sections (为你推荐, twelve
chips); the reconstruction renders eleven, because two of official's sections have no data here —
密码管理器, which the catalogue lacks, and 团队插件, which needs the cloud's team install counts.

## The measured parity

Measured over CDP on 2026-10-31 against the **deployed** `/Applications/Grok Node.app` — the
deployed asar and the built asar byte-identical, sha256 `99069a77…`, and still identical after the
app had run — and against official 0.78.1 on port 9333. Both dialogs are 900 px wide. Both apps were
started fresh for the comparison and both opened the marketplace list page.

| measurement | ours | official 0.78.1 |
|---|---|---|
| dialog width | 900 | 900 |
| title text | 连接应用 | 连接应用 |
| title band height | 24 | 24 |
| connected-apps entry, inset from the right | 33 | 33 |
| search row width | 834 | 834 |
| chip row | 850×28 | 850×28 |
| chip row items | 全部 / 效率 / 通信 / 设计 / 代码 / 数据 / 更多 | 全部 / 密码管理器 / 效率 / 通信 / 设计 / 代码 / 更多 |
| section list, inset from the dialog's left edge | 21 | 21 |
| section width | 858 | 858 |
| section list wrapper margin | −12 px | −12 px |
| section header to grid gap | 8 | 8 |
| sections | 为你推荐 + 10 chips | 为你推荐 + 12 chips |
| search field | 711×32 | 712×32 |
| search input | 669×18 | 671×20 |
| Bot-templates button | 115×32 | 114×32 |
| Bot-templates mark | 18×18, path box 6,6,17,17 | 18×18, path box 6,6,17,17 |
| connected-apps entry | 94×24 | 172×28 |
| icon-only buttons in the dialog | 1 (the close button) | 1 (the close button) |
| dialog max-height | 728 px = 100vh − 32 px of a 760 px viewport | 825 px = 100vh − 32 px of an 857 px viewport |
| title glyph, first lit image column | 116 | 115 |
| chip selection, pressed state | moves with the selection | moves with the selection |

Every remaining difference is accounted for under "Known differences" below.

**The dialog is shorter here because the window is.** The two apps were measured in windows of
1040×760 and 1395×857 CSS px, and both clamp the dialog with the same rule — `100vh` minus 32 px,
so 728 px and 825 px of max-height. The dialogs then take their height from their content, which
is 666 px and 702 px. The rule is identical; the viewport is not.

**The title lands in the same place even though its box does not.** Official's `h2` is a box inset
33 px from the dialog's edge, while this port's `h2` spans the row and carries the inset as its own
padding. Measured on the two screenshots, the title's first lit column and the chip row's first lit
column are the same column in each image (116 in ours, 115 in official's), so the difference is in
which element owns the padding, not in what the reader sees.

## The gates

| gate | command |
|---|---|
| types | `npm run typecheck` and `npm run source:typecheck` |
| tests | `npm test` |
| the chunk parses | `node --check` on every produced chunk |
| no double-wrapped locale call | `"(RLocT("` count is 0 in every produced chunk |

The regression test is `tests/marketplace-browse-chrome-0781.test.mjs`. It covers the anchors
(exactly once), the injected source (parses on its own), every Chinese string (against the captured
official fixture `tests/fixtures/official-0781-marketplace-wording.json`), every class (resolved in
upstream 0.18's stylesheet or in this wave's official CSS), and the section builder's behaviour
(the thirteen-section shape, the six-row preview, the group-action threshold, the selected chip's
full list and the appended hero).

Two further guards bite on the defect that this wave's first cut shipped:

* **no element writes its children through the jsx runtime's third argument** — it runs the
  transform's own detector over the injected source and over the real patched chunk.
* **the jsx children transform is a no-op on upstream 0.18's own code** — it proves the transform
  cannot rewrite upstream's three keyed DOM calls.
* **every lifted CSS rule is byte-for-byte official** — it compares each rule, guard count
  included, against official 0.78.1's stylesheet.
* **every token the ported rules read is declared on the dialog** — it collects the `var(--x)`
  references of every rule the port applies and requires each one to be declared on the dialog
  subtree, which is the guard that catches a missing theme token.
* **every layout rule that overrides an upstream utility class outranks it** — it reads upstream
  0.18's own stylesheet, counts the `:not(#\#)` pseudo-ids of the rule the port has to beat, and
  compares the two selectors' specificity. This is the guard for the defect the first cut of the
  header and toolbar layout shipped: every rule was class-only, every rule lost, and the layout
  silently kept upstream's geometry.
* **the chip row's items are a dependency of the toolbar that renders it** — it asserts that the
  toolbar's memo depends on the marketplace items whenever the chip row reads them. This is the
  guard for the defect the first cut of the chip row shipped: the memo's dependency list left the
  items out, the chip row froze on the empty first render, and the dialog showed all eleven chip
  sections with no chips above them. The guard was mutation-checked — with the dependency removed
  it fails.
* **official's section list bleeds 12 px past the pane's padding, and ours does too** — it reads
  official's own `.sand-lhcdhu` rule out of the 0.78.1 stylesheet and requires the ported wrapper
  to carry the same margin.
* **the ported section carries official's gap, not upstream's zero gap** — it requires the ported
  section to use official's `sand-167g77z` and not upstream's `sand-xhr3t`.

The class-resolution guard does **not** depend on `.build`. It bites on a runner that has no
upstream payload at all, and it cross-checks its declared upstream class list against upstream
0.18's own stylesheet whenever that stylesheet is present.

## The files

```
scripts/lib/marketplace-browse-chrome-0781-patch.mjs         the browse page
scripts/lib/marketplace-browse-chrome-0781-css-patch.mjs      the 28 browse rules
scripts/lib/marketplace-browse-chrome-0781-official.css        official's own rules
scripts/lib/marketplace-dialog-0781-css-patch.mjs             the 8 dialog rules
scripts/lib/marketplace-dialog-0781-official.css              official's own rules
scripts/lib/marketplace-dialog-0781-theme-tokens.css           official's palette for the dialog
scripts/lib/marketplace-dialog-0781-theme-tokens-css-patch.mjs  injects that palette
scripts/lib/marketplace-dialog-0781-typography.css              official's form-control reset and weight
scripts/lib/marketplace-dialog-0781-typography-css-patch.mjs    injects that typography
scripts/lib/marketplace-dialog-0781-layout.css                 official's header and toolbar rows
scripts/lib/marketplace-dialog-0781-layout-css-patch.mjs       injects that layout
scripts/lib/marketplace-jsx-children.mjs                     the jsx-runtime children transform
scripts/lib/marketplace-official-wording-patch.mjs            the dialog class recipe (P1)
scripts/clean-build.mjs                                       the chain
frontend/src/i18n/official-marketplace-copy.ts                the connect wording (P5)
tests/marketplace-browse-chrome-0781.test.mjs                 the regression cover
tests/fixtures/official-0781-marketplace-wording.json         official's locale entries
tests/fixtures/official-0781-marketplace-theme-tokens.json    official's palette for the dialog
```

The provenance JSON lands next to the staged renderer as
`dist/renderer-marketplace-browse-chrome-0781.json`,
`dist/renderer-marketplace-browse-chrome-0781-css.json`,
`dist/renderer-marketplace-dialog-0781-css.json` and
`dist/renderer-marketplace-dialog-0781-theme-tokens.json`. Each records the source chunk's sha256,
every anchor with its before and after text, every injected official message id with its English and
Chinese text, and the official CSS rules verbatim.
