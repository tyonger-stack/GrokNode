import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalRoutineSurfaces } from "../scripts/lib/routine-surfaces-renderer-patch.mjs";
import { BOT_COLOR_HUE_SOURCE, buildBotColorTintTable, normalizeBotColorHue } from "../scripts/lib/bot-color-renderer-components.mjs";

const bundlePath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");
const bundle = await readFile(bundlePath, "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const portCssPath = path.resolve(import.meta.dirname, "../scripts/lib/routine-surface-0758-official.css");
const portCss = await readFile(portCssPath, "utf8");
const baseCssPath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-lCyB53CO.css");
const baseCss = await readFile(baseCssPath, "utf8").catch(() => null);

/** Official 0.75.8 class lists, read off the running official app over CDP. */
const OFFICIAL = {
  card: "sand-9f619 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-f6zju3 sand-1tlft3r sand-cnij5n sand-tw3t59 sand-e8uvvx sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-hojbe8 sand-10e981r",
  li: "sand-78zum5 sand-euugli",
  rowOuter: "sand-9f619 sand-1n2onr6 sand-c8icb0 sand-78zum5 sand-6s0dn4 sand-ehausa sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-1yrsyyn sand-f159sx sand-10b6aqq sand-mzvs34 sand-1qmwy7c sand-jbqb8w sand-11hyl0l",
  group: "sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-1t137rt sand-1s928wv sand-1j6awrg sand-arstr8 sand-7cl8nr sand-1ybvw9k",
  switchOn: "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-149ho13 sand-qxvkua sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-1firant sand-wji4o3 sand-1td3qas sand-1qx5ct2 sand-46jg8d sand-isnujt sand-19phtnz sand-1cgqir sand-1moagsb sand-jhkic0",
  switchOff: "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-149ho13 sand-fwqdrz sand-19jy9ex sand-1g6zli8 sand-qxvkua sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-1firant sand-wji4o3 sand-1td3qas sand-1qx5ct2 sand-46jg8d sand-isnujt sand-19phtnz",
  knobOn: "sand-9f619 sand-10l6tqk sand-s7f9wi sand-16rqkct sand-7qiiw0 sand-12sv23o sand-2hifos sand-1firant sand-wji4o3 sand-1kky2od sand-lup9mm sand-9p6ekw",
  heading: "sand-11wthnw sand-w8bs97 sand-14gdtuo sand-78zum5 sand-6s0dn4 sand-11twubx sand-t1q3vd sand-8fiw5y sand-1o0liin sand-1qughib",
};

test("the routine surface renders official 0.75.8 class lists", { skip: bundleSkip }, () => {
  const patched = patchOriginalRoutineSurfaces(bundle);
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  for (const [role, classList] of Object.entries(OFFICIAL)) {
    assert.ok(patched.includes(classList), `${role} must use official's class list`);
  }
  assert.match(patched, /l=RRtOfficialList,c="sand-routine__list",u="roomy",d=s;/, "the flush list is replaced by official's card list");
  assert.doesNotMatch(patched, /l=U2n,c="sand-routine__list"/, "the 0.18 flush list is not left in place");
  const injected = patched.slice(patched.indexOf("const RRtOfficial={"), patched.indexOf("function RRoutineSurface("));
  assert.ok(injected.length > 0, "the official routine components are injected");
  assert.doesNotMatch(injected, /Hlt/, "the 0.18 switch is replaced by official's switch");
  assert.match(patched, /role:"switch"/, "the ported switch keeps the switch role");
  assert.match(patched, /"aria-checked":checked\?"true":"false"/, "the ported switch reports its state");
  assert.match(patched, /"data-automation-row":v\.id/, "the ported row keeps official's automation-row hook");
  assert.match(patched, /onClick:open/, "the ported row still opens the routine");
  assert.match(patched, /onKeyDown:keys/, "the ported row keeps keyboard activation");
  const rowSource = injected.slice(injected.indexOf("function RRtOfficialRow("), injected.indexOf("function RRtCopyField("));
  assert.ok(
    rowSource.includes('p.jsx("li",{className:RRtOfficial.li,children:p.jsx("div",{className:RRtOfficial.rowOuter,children:['),
    "the switch sits inside official's row outer element, which is the only child of the list item",
  );
  assert.ok(
    rowSource.indexOf("RRtOfficial.rowInner") < rowSource.indexOf("RRtOfficialSwitch"),
    "official's row inner precedes the switch inside the row outer element",
  );
});

test("the port stylesheet carries official's rules and dark-theme token values", () => {
  assert.match(portCss, /\.sand-1cgqir:not\(#\\#\):not\(#\\#\):not\(#\\#\)\{background-color:var\(--sand-bg-accent-primary\)\}/);
  assert.match(portCss, /\.sand-7qiiw0:not\(#\\#\):not\(#\\#\):not\(#\\#\)\{background-color:var\(--sand-bg-luminous\)\}/);
  assert.match(portCss, /\.sand-9p6ekw:not\(#\\#\):not\(#\\#\):not\(#\\#\)\{inset-inline-start:14px\}/);
  assert.match(portCss, /\.sand-5fd6op:not\(#\\#\):not\(#\\#\)\{border-color:var\(--sand-border-tertiary-translucent\)\}/);
  assert.match(portCss, /\.sand-c8icb0:not\(#\\#\):not\(#\\#\):not\(#\\#\)\{isolation:isolate\}/);
  for (const [token, value] of [
    ["--sand-bg-luminous", "#f5f5f5"],
    ["--sand-bg-elevated", "#1f1f1f"],
    ["--sand-text-primary", "#f5f5f5"],
    ["--sand-text-secondary", "#f5f5f5a8"],
    ["--sand-border-tertiary-translucent", "#f5f5f50f"],
    ["--sand-line-height-sm", "18px"],
    ["--sand-letter-spacing-sm", "0em"],
    ["--cursor-base", "oklch(0.97 0 0)"],
    ["--cursor-text-primary", "#f5f5f5"],
    ["--cursor-text-secondary", "#f5f5f5a8"],
    ["--cursor-text-tertiary", "#f5f5f58a"],
    ["--cursor-font-weight-normal", "420"],
    ["--sand-shadow-control", "#f5f5f500"],
  ]) {
    assert.ok(portCss.includes(`${token}:${value}`), `${token} must carry official's dark value ${value}`);
  }
  assert.match(portCss, /\.sand-info-pane__inner:not\(#\\#\):not\(#\\#\)\{/, "official's tokens are scoped to the right-hand pane");
  const selectors = [...portCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^([^\s@][^{]*)\{/gm)].map((m) => m[1]);
  for (const selector of selectors) {
    assert.doesNotMatch(selector, /:root/, "official's tokens are not applied to the whole app: " + selector);
  }
});

test("the routine switch accent projects onto the Bot color fill family", () => {
  // Official 0.78.1's routine switch reads var(--sand-bg-accent-primary*) and its bot-tint
  // layer overrides that trio on the Bot details pane (WMn -> CO(hue), under the same
  // 强调色 gate as chat), so the switch tracks the Bot's color. The port projects the
  // trio onto 0.18's native --sand-fill-accent* family, which RbcTint.info already
  // remaps per Bot; a 0.75.8-style pinned hex here would shadow that inline override.
  assert.ok(portCss.includes("--sand-bg-accent-primary:var(--sand-fill-accent)"), "the checked track projects onto the accent fill family");
  assert.ok(portCss.includes("--sand-bg-accent-primary-hover:var(--sand-fill-accent-hover)"), "the hover state projects too");
  assert.ok(portCss.includes("--sand-bg-accent-primary-disabled:var(--sand-fill-accent-disabled)"), "the disabled state projects too");
  assert.doesNotMatch(portCss, /--sand-bg-accent-primary:#/, "the switch accent tokens carry no pinned color of their own");
});

test("every Bot hue remaps all three switch accent states", { skip: baseCss == null ? "0.18 stylesheet not present" : false }, () => {
  for (const suffix of ["", "-hover", "-disabled"]) {
    assert.ok(new RegExp(`--sand-fill-accent${suffix}:#`).test(baseCss), `0.18 defines the tint-off fallback --sand-fill-accent${suffix}`);
  }
  const tintTable = buildBotColorTintTable(baseCss);
  for (const [paletteId, source] of Object.entries(BOT_COLOR_HUE_SOURCE)) {
    if (source === "accent") continue; // blue IS the accent family; official keeps the default
    const entry = tintTable[normalizeBotColorHue(paletteId)];
    assert.ok(entry, `${paletteId} must be tintable`);
    for (const suffix of ["", "-hover", "-disabled"]) {
      assert.equal(entry[`--sand-fill-accent${suffix}`], `var(--sand-fill-${source}${suffix})`, `${paletteId} remaps --sand-fill-accent${suffix}`);
    }
  }
});

test("the port carries official 0.75.8's form-control reset, re-scoped to the right-hand pane", () => {
  // Official 0.75.8 declares this reset globally; 0.18 does not ship it at all, so every
  // button in the reconstruction falls back to the UA font (Arial 13.3333px, weight 400)
  // while official's right-hand pane resolves to the app font at weight 420.
  const officialReset =
    ":where(button,input,select,textarea){font-family:inherit;font-size:var(--sand-font-size-sm);font-weight:inherit;line-height:var(--sand-line-height-sm);letter-spacing:var(--sand-letter-spacing-sm);font-feature-settings:inherit}";
  assert.ok(
    portCss.includes(`:where(.sand-info-pane__inner) ${officialReset}`),
    "official's form-control reset is ported verbatim, re-scoped to the right-hand pane",
  );
  assert.match(
    portCss,
    /\.sand-info-pane__inner #sand-info-pane-tabs \[role="tab"\]\{font-weight:inherit\}/,
    "0.18's runtime-injected tab rule (font-weight:400) is overridden with official's inherited weight",
  );
  assert.doesNotMatch(
    portCss,
    /^:where\(button,input,select,textarea\)\{/m,
    "official's global reset is never applied unscoped, so the rest of the app keeps 0.18's tokens",
  );
});

test("every copied rule belongs to a class 0.18 does not already carry", { skip: baseCss == null ? "0.18 stylesheet not present" : false }, () => {
  const missing = [...portCss.matchAll(/^\.([a-z0-9-]+)[^{]*\{/gm)].map((m) => m[1]);
  const copied = missing.filter((cls) => !new RegExp(`\\.${cls}(?![a-zA-Z0-9_-])`).test(baseCss));
  assert.ok(copied.length > 0, "the port must copy at least one class 0.18 lacks");
  for (const cls of missing) {
    const inBase = new RegExp(`\\.${cls}(?![a-zA-Z0-9_-])`).test(baseCss);
    const inPort = new RegExp(`\\.${cls}(?![a-zA-Z0-9_-])`).test(portCss);
    assert.ok(inBase || inPort, `${cls} must resolve in one of the two stylesheets`);
  }
});
