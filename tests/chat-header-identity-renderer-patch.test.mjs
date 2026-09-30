// Regression cover for the 0.61.0 chat-header identity port.
//
// The interesting failure modes are all "silently ships the old control": an anchor that
// drifts, a borrowed class that the pinned stylesheet no longer defines, a custom
// property the inlined pill surface reads going missing, and the mutation checks — the
// control has to open the details pane and the header has to stay centred, otherwise the
// build goes green and the app quietly keeps 0.18's left-aligned settings button.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  applyOriginalRendererChatHeaderIdentity,
  assertChatHeaderIdentityStylesResolve,
  HEADER_CLASS_NAMES,
  HEADER_CUSTOM_PROPERTIES,
  patchOriginalChatHeaderIdentity,
} from "../scripts/lib/chat-header-identity-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(
  REPO_ROOT,
  "src/app/dist/renderer/assets/index-UbX-y3il.js",
);
const PINNED_CSS = path.join(
  REPO_ROOT,
  "src/app/dist/renderer/assets/index-lCyB53CO.css",
);

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");
const readPinnedCss = () => readFile(PINNED_CSS, "utf8");

const ROOT_GRID = 'q={className:"sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-rvj5dj",style:RChHeaderGrid};';
const IDENTITY_OPEN_DETAILS =
  '"aria-label":"View conversation details",className:Z,onClick:()=>RChOpenInfo(c,o,RChOpenOv),style:RChIdentity';
const CONTROLS_IN_TAIL_CELL = 'j=p.jsxs("div",{className:ee,style:RChControls,children:[te,ne]})';
const THREE_COLUMN_GRID = 'gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)"';

/** Pull the injected handler back out of the patched chunk so it can be exercised. */
function extractOpenInfoHandler(patched) {
  const start = patched.indexOf("function RChOpenInfo(");
  assert.ok(start >= 0, "RChOpenInfo was not found in the patched chunk");
  const bodyStart = patched.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < patched.length; i += 1) {
    if (patched[i] === "{") depth += 1;
    else if (patched[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > bodyStart, "RChOpenInfo body did not brace-balance");
  // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
  return new Function(`return (${patched.slice(start, end)})`)();
}

/** The patched chat-header component only, so assertions cannot match a neighbour. */
function extractChatHeaderComponent(patched) {
  const start = patched.indexOf("function aSn(");
  assert.ok(start >= 0, "aSn not found in the patched chunk");
  const next = patched.indexOf("function ", start + 12);
  return patched.slice(start, next < 0 ? undefined : next);
}

test("every anchor still resolves exactly once in the pinned 0.18 chunk", async () => {
  const source = await readPinnedChunk();
  for (const label of ["function aSn(n){const e=he.c(109),", ROOT_GRID.slice(0, 60)]) {
    assert.ok(source.includes(label), `anchor drifted: ${label}`);
  }
  // The pre-patch forms are what make the anchors unique; assert they are gone afterwards.
  const patched = patchOriginalChatHeaderIdentity(source);
  for (const before of [
    '"aria-label":"View agent settings",className:Z,onClick:u,style:X,type:"button"',
    'j=p.jsxs("div",{className:ee,style:Y.style,children:[te,ne]})',
  ]) {
    assert.ok(!patched.includes(before), `pre-patch anchor survived: ${before}`);
  }
});

test("the header root becomes a three-column grid and the identity sits in the middle cell", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  assert.ok(patched.includes(ROOT_GRID), "root class/style replacement did not apply");
  assert.ok(patched.includes(THREE_COLUMN_GRID), "three-column grid template missing");
  // gridColumn must land on the identity-row WRAPPER, not on the button inside it: the
  // wrapper is the grid child, so putting it on the button left the whole thing in
  // column 1 and the pill stayed left-aligned after the grid was applied.
  assert.ok(
    patched.includes('B=p.jsxs("div",{className:N,style:RChIdentityRow,children:[A,I]})'),
    "the identity row wrapper is not pinned to the centre column",
  );
  assert.ok(
    patched.includes('const RChIdentityRow={gridColumn:"2"}'),
    "centre column placement is missing",
  );
  assert.ok(
    !patched.includes('RChIdentity={gridColumn'),
    "gridColumn is still on the button, which is not the grid child",
  );
  assert.ok(
    patched.includes(CONTROLS_IN_TAIL_CELL),
    "controls group is not pinned to the trailing column",
  );
  assert.ok(patched.includes('gridColumn:"3"'), "controls column placement missing");
  // space-between survives on the class list (0.61.0 keeps it too) but is inert on a
  // grid; the centring must come from the template, so assert both are present.
  assert.ok(patched.includes("sand-1qughib"), "justify-content:space-between was removed");
});

test("the identity control opens the details pane and carries 0.61.0's label", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  assert.ok(patched.includes(IDENTITY_OPEN_DETAILS), "identity control replacement did not apply");
  assert.ok(
    !patched.includes('"aria-label":"View agent settings"'),
    "0.18's settings label survived",
  );
  assert.ok(
    !patched.includes("onClick:u,style:X"),
    "0.18's settings handler survived on the identity control",
  );
  // aria-expanded stays bound to the info pane, which is what made 0.18 internally
  // inconsistent: it advertised the info pane but opened settings.
  assert.ok(
    patched.includes('"aria-controls":upe,"aria-expanded":o'),
    "aria wiring to the info pane was lost",
  );
});

test("opening from the header always lands on the overview section", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  // The landing is a three-hop wire; a dropped hop still builds and still looks right.
  for (const [needle, what] of [
    ["openInfoOverview:hr.openSection", "app root prop"],
    ["onOpenInfoOverview:n.openInfoOverview,", "chat header wiring"],
    ["onOpenInfoOverview:RChOpenOv", "chat header destructure"],
    ['openOverview("overview")', "overview request"],
  ]) {
    assert.ok(patched.includes(needle), `overview landing lost its ${what}`);
  }
  // The memo slots have to follow the new prop. `u` is no longer read by this control,
  // and `he.c(109)` leaves no spare index, so the slot is reused rather than appended.
  // Scope to aSn: the chunk has a dozen other components with an `e[7]!==u` memo.
  const header = extractChatHeaderComponent(patched);
  assert.ok(
    header.includes("e[7]!==RChOpenOv") && header.includes("e[7]=RChOpenOv"),
    "outer memo no longer tracks the overview callback",
  );
  assert.ok(
    header.includes("e[92]!==RChOpenOv") && header.includes("e[92]=RChOpenOv"),
    "identity memo no longer tracks the overview callback",
  );
  assert.ok(
    !header.includes("e[7]!==u||e[8]!==s") && !header.includes("e[92]!==u||e[93]!==Z"),
    "a memo slot in the chat header still tracks the replaced settings handler",
  );
  assert.ok(
    !header.includes("onClick:u,"),
    "the chat header still calls the replaced settings handler somewhere",
  );
  // The label has to stay a raw literal so main-i18n can localise it; a runtime RLocT
  // wrapper would make the build pass and ship English under a Chinese UI.
  assert.ok(
    !patched.includes("RChLoc("),
    "the label is wrapped in a runtime RLocT call instead of being left as a literal",
  );
  assert.ok(
    patched.includes('"aria-label":"View conversation details"'),
    "the 0.61.0 label literal is not reachable for the i18n engine",
  );
});

test("the injected handler toggles, and only asks for overview when it opened", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  const openInfo = extractOpenInfoHandler(patched);

  const closed = [];
  openInfo(() => closed.push("toggle"), false, (section) => closed.push(section));
  assert.deepEqual(closed, ["toggle", "overview"], "opening must request the overview section");

  const alreadyOpen = [];
  openInfo(() => alreadyOpen.push("toggle"), true, (section) => alreadyOpen.push(section));
  assert.deepEqual(alreadyOpen, ["toggle"], "an open pane must only close, not re-request a section");

  // A missing callback must not turn a click into a thrown error.
  const noCb = [];
  assert.doesNotThrow(() => openInfo(() => noCb.push("toggle"), false, undefined));
  assert.deepEqual(noCb, ["toggle"]);

  // A throwing callback must not break the toggle that already happened.
  const throwing = [];
  assert.doesNotThrow(() =>
    openInfo(
      () => throwing.push("toggle"),
      false,
      () => {
        throw new Error("pane not ready");
      },
    ),
  );
  assert.deepEqual(throwing, ["toggle"]);

  assert.doesNotThrow(() => openInfo(undefined, false, () => {}));
});

test("the pill surface copies 0.61.0's box-shadow verbatim", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  assert.ok(
    patched.includes(
      'boxShadow:"0 4px 12px -1px var(--sand-shadow-inline-ambient), 0 2px 4px -2px var(--sand-shadow-inline-key), 0 0 0 1px var(--sand-shadow-ring)"',
    ),
    "0.61.0's Co.inline shadow string was not copied verbatim",
  );
  for (const snippet of ['borderRadius:"9999px"', 'backgroundColor:"var(--sand-bg-elevated)"', 'borderColor:"var(--sand-border-weak)"']) {
    assert.ok(patched.includes(snippet), `missing pill surface declaration: ${snippet}`);
  }
});

test("every borrowed class and custom property resolves in the pinned stylesheet", async () => {
  const css = await readPinnedCss();
  const result = assertChatHeaderIdentityStylesResolve(css);
  assert.equal(result.classes, HEADER_CLASS_NAMES.length);
  assert.equal(result.customProperties, HEADER_CUSTOM_PROPERTIES.length);
});

test("the style gate fails closed when a class or custom property disappears", async () => {
  const css = await readPinnedCss();
  assert.throws(
    () => assertChatHeaderIdentityStylesResolve(css, { classNames: ["sand-does-not-exist"] }),
    /classes: sand-does-not-exist/,
  );
  // A custom property the pill surface reads must be required too: rename its
  // definition and the gate has to complain rather than ship an unstyled control.
  assert.throws(
    () =>
      assertChatHeaderIdentityStylesResolve(
        css.replace(/--sand-shadow-ring\s*:/g, "--sand-other-ring:"),
      ),
    /custom properties: --sand-shadow-ring/,
  );
  // Renaming only the *usage* must not trip the gate — it keys on definitions.
  assert.doesNotThrow(() =>
    assertChatHeaderIdentityStylesResolve(css.replace(/var\(--sand-shadow-ring\)/g, "red")),
  );
});

test("re-applying the patch fails closed instead of stacking", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  assert.throws(
    () => patchOriginalChatHeaderIdentity(patched),
    /anchor is missing or ambiguous/,
  );
});

test("the patched chunk is still parseable JavaScript", async () => {
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  // A regex-only smoke test is not enough: the injected component is real JSX-free
  // code inside a function body, so hand it to the real parser.
  const { writeFile, rm } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const tmp = path.join(REPO_ROOT, ".tmp-chat-header-patched.js");
  try {
    await writeFile(tmp, patched, "utf8");
    await run(process.execPath, ["--check", tmp]);
  } finally {
    await rm(tmp, { force: true });
  }
});

test("the staged renderer gets exactly one patched chunk plus provenance", async (t) => {
  const { mkdtemp, readFile: rf, cp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const stageRoot = await mkdtemp(path.join(tmpdir(), "grok-node-chat-header-"));
  t.after(() => rm(stageRoot, { recursive: true, force: true }));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  // A second chunk carrying the same anchor must be left alone — and because the gate
  // requires exactly one candidate, staging two of them has to fail the build instead.
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  await cp(PINNED_CHUNK, path.join(assets, "decoy-AAAA.js"));
  await cp(PINNED_CSS, path.join(assets, "index-lCyB53CO.css"));
  await assert.rejects(
    applyOriginalRendererChatHeaderIdentity({ stageRoot }),
    /Expected one original renderer chunk .* found 2/,
  );
  await rm(path.join(assets, "decoy-AAAA.js"), { force: true });

  const record = await applyOriginalRendererChatHeaderIdentity({ stageRoot });
  assert.equal(record.chunks.length, 1);
  assert.equal(record.chunks[0].role, "chat-header");
  assert.deepEqual(record.features, [
    "chat-header-identity-centre",
    "chat-header-identity-open-details",
  ]);
  const patched = await rf(path.join(assets, "index-UbX-y3il.js"), "utf8");
  assert.ok(patched.includes(THREE_COLUMN_GRID), "staged chunk was not patched");
  const provenance = JSON.parse(
    await rf(path.join(stageRoot, "dist", "renderer-chat-header-identity-extension.json"), "utf8"),
  );
  assert.equal(provenance.mode, "original-renderer-chat-header-identity");
  assert.notEqual(provenance.chunks[0].original.sha256, provenance.chunks[0].patched.sha256);
  assert.ok(record.provenanceBytes > 0);
});

test("clean-build runs the chat-header patch between the renderer extensions and the i18n passes", async () => {
  const source = await readFile(path.join(REPO_ROOT, "scripts/clean-build.mjs"), "utf8");
  const importIndex = source.indexOf('from "./lib/chat-header-identity-renderer-patch.mjs"');
  assert.ok(importIndex > 0, "clean-build does not import the chat-header patch");
  const callIndex = source.indexOf("await applyOriginalRendererChatHeaderIdentity({ stageRoot });");
  assert.ok(callIndex > 0, "clean-build never calls the chat-header patch");
  const searchIndex = source.indexOf("await applyOriginalRendererSidebarTopBarSearch({ stageRoot });");
  const i18nIndex = source.indexOf("await applyOriginalRendererMainI18n({ stageRoot });");
  assert.ok(
    searchIndex < callIndex && callIndex < i18nIndex,
    "chat-header patch must run after the renderer extension and before the i18n passes",
  );
});

test("no native style prop receives an array (the class of bug that broke the chat view)", async () => {
  // React walks a `style` array with for..in and throws "Failed to set an indexed property
  // [0] on 'CSSStyleDeclaration'", which the view error boundary reports as "This view
  // failed to load." It compiles, passes `node --check`, and only shows up at render time.
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  const header = extractChatHeaderComponent(patched);

  // The three fragments this patch authors all land on native elements.
  for (const prop of ["style:RChIdentity", "style:RChControls", "style:RChHeaderGrid"]) {
    assert.ok(header.includes(prop), `expected ${prop} to be a plain style object`);
  }
  // Scope the ban to the identity control's own JSX. Elsewhere in `aSn` there are
  // legitimate array styles — the computer pill passes `[vhe.computerPill, ...]` to `fr`,
  // a component whose props stylex merges and that never reaches a DOM style attribute.
  const identity = /p\.jsxs?\("button",\{[\s\S]*?\}\)/.exec(header);
  assert.ok(identity, "identity button JSX not found in the chat header");
  assert.ok(!/style:\[/.test(identity[0]), "the identity button got an array style prop");
  assert.ok(
    identity[0].includes("style:RChIdentity"),
    "identity button lost its plain style object",
  );
  // The dropped value was always undefined, so nothing is lost by not carrying it.
  assert.ok(!patched.includes("style:[X,"), "the undefined X slot is still being spread in");
});

test("the chat toolbar no longer paints an opaque band over the transcript", async () => {
  // 0.18's sand-toolbar carries sand-1ua6jya -> background-color:var(--cursor-bg-editor),
  // an opaque fill that hides transcript text passing under the header. 0.61.0's
  // sand-toolbar has no background declaration at all; that transparency is what makes the
  // text behind the pill read through.
  const css = await readPinnedCss();
  const resolved = /\.sand-1ua6jya(?::not\(#\\#\))+\{([^}]*)\}/.exec(css);
  assert.ok(resolved, "sand-1ua6jya no longer resolves in the pinned stylesheet");
  assert.match(resolved[1], /background-color/, "sand-1ua6jya is not the fill we expected to drop");

  const original = await readPinnedChunk();
  const toolbar = /re\("sand-toolbar",\{[\s\S]{0,1600}?\}\[[\s\S]{0,20}?\]\.className\)/.exec(original);
  assert.ok(toolbar, "sand-toolbar class set not found in the pinned chunk");
  const variants = [...toolbar[0].matchAll(/(\d):\{className:"([^"]*)"/g)];
  assert.equal(variants.length, 2, "expected both sand-toolbar variants to be rewritten");
  for (const [, index, classes] of variants) {
    assert.ok(classes.includes("sand-1ua6jya"), `variant ${index} should still carry the fill before patching`);
  }

  const patched = patchOriginalChatHeaderIdentity(original);
  const patchedToolbar = /re\("sand-toolbar",\{[\s\S]{0,1600}?\}\[[\s\S]{0,20}?\]\.className\)/.exec(patched);
  assert.ok(patchedToolbar, "sand-toolbar class set missing from the patched chunk");
  for (const [, index, classes] of patchedToolbar[0].matchAll(/(\d):\{className:"([^"]*)"/g)) {
    assert.ok(
      !classes.includes("sand-1ua6jya"),
      `variant ${index} still carries the opaque toolbar fill`,
    );
    // The other bar declarations must survive — dropping a class cannot take the
    // positioning, sizing or drag-region rules with it.
    assert.ok(classes.includes("sand-10l6tqk"), `variant ${index} lost position:absolute`);
    assert.ok(classes.includes("sand-1vkgffh"), `variant ${index} lost its min-height`);
    assert.ok(classes.includes("sand-1a4o4su"), `variant ${index} lost the app-region rule`);
  }
});

test("the chat header renders no computer control", async () => {
  // 0.61.0 keeps the class name only as a container-name and as a focus fallback; it never
  // renders the button. 0.18 renders it whenever the details pane is closed, which is the
  // stray icon reported against this build.
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  const header = extractChatHeaderComponent(patched);
  assert.ok(
    header.includes('!1?p.jsx(yo,{content:iSn,disabled:!m,children:p.jsx(fr,{'),
    "the computer control branch was not made unreachable",
  );
  assert.ok(
    !header.includes("!o||m?p.jsx(yo,{content:iSn"),
    "the pane-open/computer-busy render condition survived",
  );
  // The class name itself must stay: 0.18 uses it for the focus fallback, and removing it
  // would silently break focus restoration when the details pane closes.
  assert.ok(
    header.includes('className:"sand-chat-header__computer"'),
    "the computer class name was removed, which would break the focus fallback",
  );
  // The computer surface in the details pane is a separate path and must be untouched.
  assert.ok(
    patched.includes("sand-computer-preview"),
    "the details pane computer preview was removed from the chunk",
  );
});

test("the chat header renders no toolbar hairline", async () => {
  // 0.18 renders sand-toolbar-divider, whose opacity is driven by a scroll-timeline
  // animation, so it keeps painting after the bar behind it is made transparent. 0.61.0
  // has no such element. Measured on the live build: y=44..45, rgba(252,252,252,0.1).
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  assert.ok(
    patched.includes('q=!0?null:p.jsx("div",{"aria-hidden":!0,className:re("sand-toolbar-divider"'),
    "the toolbar hairline branch was not made unreachable",
  );
  assert.ok(
    !patched.includes('q=t||s?null:p.jsx("div",{"aria-hidden":!0,className:re("sand-toolbar-divider"'),
    "the pane-state render condition for the hairline survived",
  );
  // The scroll-driven declarations must stay in the stylesheet — they are what made this a
  // dynamic element rather than a static class, and they may be referenced elsewhere.
  const css = await readPinnedCss();
  const hairline = /\.sand-qjr0ry(?::not\(#\\#\))+\{([^}]*)\}/.exec(css);
  assert.ok(hairline, "sand-qjr0ry no longer resolves in the pinned stylesheet");
  assert.match(hairline[1], /background-color/, "sand-qjr0ry is not the hairline fill we expected");
});

test("the suppressed branches really evaluate to null, not to the element", async () => {
  // String matching alone missed this: `!1?null:X` contains the substring "null", passes any
  // `includes("…?null:…")` assertion, and still evaluates to `X` — so the hairline kept
  // rendering after a green build and a green test run. Evaluate the actual ternaries.
  const patched = patchOriginalChatHeaderIdentity(await readPinnedChunk());
  const evalTernary = (needle, label) => {
    const at = patched.indexOf(needle);
    assert.ok(at >= 0, `${label}: not found in the patched chunk`);
    const start = at;
    let depth = 0;
    let end = start;
    for (let i = patched.indexOf("(", at); i < patched.length; i += 1) {
      if (patched[i] === "(") depth += 1;
      else if (patched[i] === ")") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    // Stand in for the jsx factory: if the ternary reaches it, the control renders.
    const snippet = patched.slice(start, end).replace(/p\.jsx\(/g, "MARKER(");
    // eslint-disable-next-line no-new-func -- the chunk is the artefact under test.
    const value = new Function("MARKER", `let hit=false;const v=(${snippet});return {value:v,hit}`)(
      () => { throw new Error("element branch was taken"); },
    );
    assert.equal(value.value, null, `${label}: the ternary does not yield null`);
    assert.equal(value.hit, false, `${label}: the element branch was taken`);
    return snippet;
  };

  evalTernary('q=!0?null:p.jsx("div",{"aria-hidden":!0,className:re("sand-toolbar-divider"', "toolbar hairline");
  // The computer control is the opposite shape — the element sits in the *true* branch, so it
  // must be made unreachable with a false condition.
  const at = patched.indexOf('!1?p.jsx(yo,{content:iSn,disabled:!m,children:p.jsx(fr,{');
  assert.ok(at >= 0, "computer control: constant not found");
  assert.ok(!patched.includes("!0?p.jsx(yo,{content:iSn"), "computer control would render unconditionally");
});

test("the identity avatar is sized like 0.61.0's (24px fill, sm)", async () => {
  // 0.61.0: Sa({agent, fillPx:t2, size:"sm"}) with t2=24. 0.18: ml({…, fillPx:Tve, size:"xs"})
  // with Tve=20 — the whole 20-vs-24 difference the pill inherits.
  const original = await readPinnedChunk();
  assert.ok(
    original.includes("p.jsx(ml,{agent:t,fillPx:Tve,isStatic:!0,size:\"xs\"})"),
    "0.18's identity avatar call changed shape; re-derive the anchor",
  );
  const patched = patchOriginalChatHeaderIdentity(original);
  assert.ok(
    patched.includes('e[72]!==t?(Q=p.jsx(ml,{agent:t,fillPx:24,isStatic:!0,size:"sm"}),e[72]=t,e[73]=Q)'),
    "the identity avatar was not resized to 0.61.0's fill",
  );
  // Only the identity slot may change: the breadcrumb crumb shares the same call and keeps
  // 0.18's own size, so exactly one occurrence must be rewritten.
  const rewrote = [...patched.matchAll(/p\.jsx\(ml,\{agent:t,fillPx:(Tve|24),isStatic:!0,size:"(xs|sm)"\}\)/g)];
  assert.equal(rewrote.length, 2, "expected the identity slot and the breadcrumb slot only");
  const sizes = rewrote.map((m) => `${m[1]}/${m[2]}`).sort();
  assert.deepEqual(sizes, ["24/sm", "Tve/xs"], "only the identity avatar may be resized");
});
