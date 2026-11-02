// Regression cover for official 0.78.1's plugin DETAIL page, ported into upstream 0.18's plugins
// view: the hero-title block with the copy-link button, the share + connect action group, the
// 应用 / 技能 cards and the 信息 table.
//
// The guards here are the ones that matter for a port that rewrites MINIFIED upstream code:
//
//   * every anchor must be replaced exactly once — the patch refuses a missing or ambiguous
//     anchor at build time, and an anchor that became ambiguous would patch the wrong site;
//   * the injected source must parse on its own (a broken splice takes the whole renderer down);
//   * every Chinese string the port writes must be official's own, matched against the captured
//     official locale fixture — a typo or an invented translation fails here;
//   * every class the port applies must resolve in upstream 0.18's stylesheet or in an official
//     CSS companion. A stylix class name is the hash of its declaration block, so a class that
//     exists in one build and not in another is a *no-op*: the button would render unstyled with
//     every other test still green. This guard does NOT depend on `.build` — it bites in CI.
//   * the row builder must produce official's own row set and labels for every input shape.
//
// The staged chunk is checked too when a build is present.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
  MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES,
  MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE,
  MARKETPLACE_DETAIL_VIEW_0781_MESSAGES,
  MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS,
  MARKETPLACE_DETAIL_VIEW_0781_SECTION_MESSAGES,
  patchMarketplaceDetailView0781,
} from "../scripts/lib/marketplace-detail-view-0781-patch.mjs";
import { applyMarketplaceDetailView0781Css } from "../scripts/lib/marketplace-detail-view-0781-css-patch.mjs";
import { EXTRA_I18N_FILES } from "../scripts/lib/extra-i18n-patch.mjs";
import { MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS } from "../scripts/lib/marketplace-browse-chrome-0781-patch.mjs";
import { findDomChildrenInThirdArgument } from "../scripts/lib/marketplace-jsx-children.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const fixture = JSON.parse(read("tests", "fixtures", "official-0781-detail-view-messages.json"));
const detailCss = read("scripts", "lib", "marketplace-detail-view-0781-official.css");
const browseCss = read("scripts", "lib", "marketplace-browse-chrome-0781-official.css");
const layoutCss = read("scripts", "lib", "marketplace-dialog-0781-layout.css");
const routineCss = read("scripts", "lib", "routine-surface-0758-official.css");

/**
 * Official 0.78.1's own switch recipes for the detail page's per-tool rows.
 *
 * They are written out here rather than read from the port, so a port that swapped official's
 * recipes for upstream's cannot satisfy itself. Every string is official's own class string: the
 * checked track and the checked knob were read off official's live DOM, and the unchecked track is
 * official's own recipe-table entry for the same control in its unchecked state — official's live
 * plugin has every tool enabled, so the unchecked variant is not observable on screen.
 */
const OFFICIAL_0781_SWITCH_TRACK_ON =
  "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-ymw2ht sand-2k1e5v sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-12rn374 sand-wji4o3 sand-23j0i4 sand-lup9mm sand-lrd64x sand-1hshjfz sand-1akln4p sand-1cgqir sand-1moagsb sand-jhkic0";
const OFFICIAL_0781_SWITCH_TRACK_OFF =
  "sand-jyslct sand-1lugfcp sand-9f619 sand-1n2onr6 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-amitd3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-exx8yu sand-yri2b sand-18d9i69 sand-1c1uobl sand-c342km sand-ng3xce sand-ymw2ht sand-fwqdrz sand-19jy9ex sand-1g6zli8 sand-2k1e5v sand-6ikm8r sand-10wlt62 sand-14ju556 sand-gxxoiu sand-xymvpz sand-1ypdohk sand-1s07b3s sand-15406qy sand-12rn374 sand-wji4o3 sand-23j0i4 sand-lup9mm sand-lrd64x sand-1hshjfz sand-1akln4p";
const OFFICIAL_0781_SWITCH_KNOB_ON =
  "sand-9f619 sand-10l6tqk sand-s7f9wi sand-16rqkct sand-7qiiw0 sand-1gdvyqu sand-2hifos sand-12rn374 sand-wji4o3 sand-smyaan sand-1kpxq89 sand-1r4y97";
const OFFICIAL_0781_SWITCH_KNOB_OFF =
  "sand-9f619 sand-10l6tqk sand-s7f9wi sand-aoy8p5 sand-16rqkct sand-7qiiw0 sand-1gdvyqu sand-2hifos sand-12rn374 sand-wji4o3 sand-smyaan sand-1kpxq89";

/** Upstream 0.18's own shared-switch recipes, the ones the port replaces. */
const UPSTREAM_018_SWITCH_CLASSES = ["sand-1jq8sgu", "sand-khjh7l"];

/**
 * Official's five switch rules that upstream 0.18's stylesheet does not declare.
 *
 * They are byte-for-byte official's own rules; the two that read a token read the tokens the
 * dialog's own token block declares.
 */
const OFFICIAL_0781_SWITCH_RULES = [
  ".sand-2k1e5v:not(#\\#):not(#\\#):not(#\\#){box-shadow:inset 0 0 0 .5px var(--sand-border-quaternary-translucent)}",
  ".sand-lrd64x:not(#\\#):not(#\\#):not(#\\#):not(#\\#){min-width:26px}",
  ".sand-1akln4p:not(#\\#):not(#\\#):not(#\\#):not(#\\#){max-height:16px}",
  ".sand-1gdvyqu:not(#\\#):not(#\\#):not(#\\#){box-shadow:0 1px 3px 0 var(--sand-shadow-control)}",
  ".sand-1r4y97:not(#\\#):not(#\\#):not(#\\#){inset-inline-start:12px}",
];

/**
 * The tokens official's switch reads.
 *
 * Measured from the switch's own recipes — the 53 classes the port applies — and the
 * declarations those classes carry in upstream 0.18's stylesheet, in this repository's official
 * CSS companions and in official 0.78.1's own stylesheet. The set is written out so the guard can
 * bite on a runner that carries no upstream payload at all, and so a recipe that starts reading a
 * tenth token is caught on a runner that does.
 */
const OFFICIAL_0781_SWITCH_TOKENS = [
  "--sand-bg-accent-primary",
  "--sand-bg-accent-primary-disabled",
  "--sand-bg-accent-primary-hover",
  "--sand-bg-luminous",
  "--sand-bg-secondary",
  "--sand-bg-secondary-disabled",
  "--sand-bg-secondary-hover",
  "--sand-border-quaternary-translucent",
  "--sand-shadow-control",
];

/**
 * The classes upstream 0.18's stylesheet already defines, so the port does not have to lift them.
 *
 * This list is the port's declared style contract. It is cross-checked against upstream 0.18's own
 * stylesheet whenever that stylesheet is present (`npm run bootstrap`), so it cannot drift
 * silently, and it lets the resolution guard below bite even on a runner that has no upstream
 * payload at all.
 */
const UPSTREAM_RESOLVED_CLASSES = [
  "sand-10b6aqq", "sand-10e981r", "sand-11wthnw", "sand-12oo3zp", "sand-12w9bfk", "sand-13a6bvl", "sand-13ly8rp", "sand-14z9mp", "sand-167g77z", "sand-169k319",
  "sand-17d4w8g", "sand-18d9i69", "sand-19991ni", "sand-1a8lsjc", "sand-1c4vz4f", "sand-1d3mw78", "sand-1fgtraw", "sand-1heor9g",
  "sand-1iyjqo2", "sand-1jnr06f", "sand-1k57tk5", "sand-1kky2od", "sand-1kogg8i", "sand-1lqcxt8", "sand-1lugfcp", "sand-1n2onr6", "sand-1nhvcw1",
  "sand-1o0liin", "sand-1oqui1x", "sand-1pkpdue", "sand-1qughib", "sand-1qx5ct2", "sand-1qlqyl8", "sand-1rhlpx6", "sand-1t137rt", "sand-1wm8ruf", "sand-1xlntvz",
  "sand-1xp8n7a", "sand-1y0btm7", "sand-1y1aw1k", "sand-1y3gkto", "sand-1ypdohk", "sand-25t5g8",
  "sand-2b8uid", "sand-2lah0s", "sand-2lprc", "sand-2vl965", "sand-3nfvp2", "sand-4hv7ue", "sand-68av9p", "sand-6s0dn4",
  "sand-784prv", "sand-78zum5", "sand-7giv3", "sand-889kno", "sand-9f619", "sand-9lcvmn", "sand-9v5kkp",
  "sand-at24cr", "sand-b3r6kr", "sand-c342km", "sand-d4r4e8", "sand-dj266r", "sand-dl72j9",
  "sand-dt5ytf", "sand-euugli", "sand-exx8yu", "sand-f7dkkf", "sand-fc7y3v", "sand-g01cxk", "sand-g7klql", "sand-gd8bvy",
  "sand-h8yej3", "sand-jb2p0i", "sand-jbqb8w", "sand-jyslct", "sand-l56j7k", "sand-lshs6z", "sand-lup9mm", "sand-lyipyv",
  "sand-mix8c7", "sand-ng3xce", "sand-oyc9vk", "sand-rvj5dj", "sand-s2xxs2", "sand-s83m0k", "sand-sdox4t", "sand-tgyt42", "sand-thy2uy",
  "sand-tyxrsu", "sand-uxw1ft", "sand-v54qhq", "sand-w4jnvo", "sand-wib8y2", "sand-wz0xwf",
  // The recipes the detail page's own rows, buttons and chevrons carry.
  "sand-11xpdln", "sand-1717udv", "sand-19jd1h0", "sand-1v2ro7d", "sand-n4ifyr", "sand-wji4o3",
  // Official's small secondary button recipe (the setup section's "Edit Values" button).
  "sand-178xt8z", "sand-so031l", "sand-13fuv20", "sand-1q0q8m5", "sand-1t7ytsu", "sand-1v8p93f", "sand-16stqrj", "sand-1k6tqyu", "sand-krqix3", "sand-87ps6o", "sand-ggy1nq", "sand-1s07b3s", "sand-1hc1fzr", "sand-uhm2yv", "sand-67bb7w", "sand-aqnwrm", "sand-1uczgqu", "sand-1wfwxd8", "sand-7s97pk", "sand-1eaenvl", "sand-1pbvl4h", "sand-d7y6wv", "sand-9h44rk", "sand-spwq11",
  // The tool-row switch's own recipes (official 0.78.1's accent-primary track and its knob).
  "sand-amitd3", "sand-6ikm8r", "sand-10wlt62", "sand-14ju556", "sand-xymvpz", "sand-15406qy", "sand-23j0i4", "sand-1hshjfz", "sand-10l6tqk", "sand-s7f9wi", "sand-16rqkct", "sand-smyaan", "sand-1kpxq89",
];

/**
 * The classes the port applies that official 0.78.1 itself gives no rule to.
 *
 * They are stylix namespace markers (`sand-kit-button`, `sand-kit-icon`, …), so they carry no
 * style on either side.
 */
const STYLIX_NOOP_CLASSES = ["sand-button", "sand-kit-button", "sand-kit-icon", "sand-kit-icon-button", "sand-settings-detail-bar"];

/**
 * Upstream 0.18's own semantic hooks on the detail page.
 *
 * They name a part of the page for upstream's own code and for the repository's tests; neither
 * upstream's stylesheet nor official's gives them a rule, so they resolve to nothing on either
 * side and carry no style.
 */
const SEMANTIC_MARKER_CLASSES = [
  "sand-plugins-detail__accounts",
  "sand-plugins-detail__add-account",
  "sand-plugins-detail__connectors",
  "sand-plugins-detail__desc",
  "sand-plugins-detail__header",
  "sand-plugins-detail__setup",
  "sand-plugins-detail__skills",
];

/** Every class the port applies — `var(--sand-…)` custom-property references are not classes. */
function appliedClasses() {
  const classes = new Set();
  for (const match of MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.matchAll(/sand-[a-z0-9+_-]+/g)) {
    classes.add(match[0]);
  }
  return classes;
}

/** The classes an official CSS companion defines. */
function companionClasses(css) {
  return new Set([...css.matchAll(/\.(sand-[a-z0-9+_-]+)/g)].map((match) => match[1]));
}

/**
 * A chunk that contains every anchor exactly as many times as the entry declares (the anchors are
 * fragments, so this is text).
 *
 * An entry that replaces one recipe everywhere it appears declares how many places that is; the
 * fragment is repeated that many times so the patch's own count check bites here as well.
 */
function syntheticChunk() {
  let source = "const Os=1,Re=2,ue=3,C=4,t=5,k=6,RLocT=7,Pl=8,nt=9,qn={};\n";
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) {
    const times = entry.occurrences ?? 1;
    for (let i = 0; i < times; i += 1) source += `/*${entry.label}*/${entry.before}\n`;
  }
  return source;
}

/**
 * The injected source, evaluated on its own so the pure row builders can be exercised.
 *
 * Only `RLocT` and `RM0781Locale` are needed; every other chunk-scope identifier is referenced
 * from a function body this test never calls.
 */
function builders() {
  const factory = new Function(
    "RLocT",
    "RM0781Locale",
    `${MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE}\n` +
      "return {RM0781DetailRows,RM0781DetailCategoryLabel,RM0781DetailAvailability," +
      "RM0781DetailPluginUrl,RM0781DetailConnectors,RM0781DetailHostname};",
  );
  return factory((en, zh) => zh, () => "en");
}

/**
 * The port's own switch component, evaluated with a stub jsx runtime.
 *
 * The component IS the port's code, so the guard reads what it actually renders: the button's
 * attribute set, the track's recipe and the knob's recipe.
 */
function toolSwitch() {
  const factory = new Function(
    "RLocT",
    "RM0781Locale",
    "C",
    "t",
    `${MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE}\nreturn RM0781DetailToolSwitch;`,
  );
  const t = { jsx: (type, props) => ({ type, props }) };
  const component = factory((en, zh) => zh, () => "en", {}, t);
  return (props) => component(props);
}

/**
 * The classes the port's own switch applies.
 *
 * They are read out of the port's injected source — the four recipe constants the switch picks
 * between — so the guard follows the port instead of a copy of it.
 */
function switchRecipeClasses() {
  const source = MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE;
  const classes = new Set();
  for (const name of [
    "RM0781DetailSwitchOn",
    "RM0781DetailSwitchOff",
    "RM0781DetailKnobOn",
    "RM0781DetailKnobOff",
  ]) {
    const at = source.indexOf(`const ${name}=`);
    assert.ok(at >= 0, `the port must define ${name}, the switch's own recipe`);
    const literal = source.slice(at, source.indexOf(";", at));
    for (const match of literal.matchAll(/sand-[a-z0-9+_-]+/g)) classes.add(match[0]);
  }
  return classes;
}

/**
 * The tokens the switch's own recipes read.
 *
 * A recipe's declaration lives in upstream 0.18's stylesheet, in one of this repository's official
 * CSS companions, or — for the five the port lifts — in the detail companion itself, so the union
 * of the available stylesheets is read. Comments are stripped first: a class named in a comment
 * is not a rule, and counting it would report a rule that does not exist.
 */
function switchRecipeTokens() {
  const classes = switchRecipeClasses();
  const sources = [detailCss, browseCss, layoutCss, routineCss];
  const assets = path.join(repoRoot, "src", "app", "dist", "renderer", "assets");
  if (existsSync(assets)) {
    const cssFile = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
    if (cssFile != null) sources.push(readFileSync(path.join(assets, cssFile), "utf8"));
  }
  const tokens = new Set();
  for (const css of sources) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const name of classes) {
      const rule = new RegExp(`\\.${name}(?![A-Za-z0-9_+-])[^}]*\\{([^}]*)\\}`, "g");
      let match;
      while ((match = rule.exec(bare)) !== null) {
        for (const token of match[1].matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) tokens.add(token[1]);
      }
    }
  }
  return tokens;
}

/**
 * Every token the switch's recipes read must be declared on the dialog in BOTH themes.
 *
 * A `var(--x)` whose target is not declared on the dialog subtree is invalid at computed-value
 * time: the rule falls back to its initial value, so the track loses its colour while every other
 * guard stays green. Upstream 0.18 ships an older palette, so "upstream happens to define it" is
 * not good enough — the value would be the wrong one.
 */
function assertSwitchTokensDeclared(cssText) {
  const light = cssText.match(/^\.sand-plugins-dialog\{(.+)\}$/m);
  const dark = cssText.match(/^html\[data-theme="cursor-dark"\] \.sand-plugins-dialog\{(.+)\}$/m);
  assert.ok(light != null, "the light token block must be scoped to the dialog");
  assert.ok(dark != null, "the dark token block must be scoped to the dialog under cursor-dark");
  const official = JSON.parse(
    read("tests", "fixtures", "official-0781-marketplace-theme-tokens.json"),
  ).tokens;
  const declared = (body) =>
    new Map([...body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)].map((match) => [match[1], match[2]]));
  const lightTokens = declared(light[1]);
  const darkTokens = declared(dark[1]);
  const referenced = switchRecipeTokens();
  assert.deepEqual(
    [...referenced].sort(),
    [...OFFICIAL_0781_SWITCH_TOKENS].sort(),
    "the ported switch's recipes must read exactly the tokens official's switch reads",
  );
  for (const token of referenced) {
    const captured = official[token];
    assert.ok(captured != null, `official's fixture is missing ${token}`);
    assert.equal(
      lightTokens.get(token),
      captured.light,
      `the dialog's light block must declare ${token} as official does`,
    );
    assert.equal(
      darkTokens.get(token),
      captured.dark,
      `the dialog's dark block must declare ${token} as official does`,
    );
  }
}

/** An entry with official's own shape for a listed marketplace plugin. */
function pluginEntry(overrides = {}) {
  return {
    id: "71001007",
    name: "x-money",
    displayName: "X Money",
    description: "Use your X Money Card.",
    category: "MCP",
    categoryKey: undefined,
    connectors: [{ name: "x-money", description: "" }],
    skills: [{ name: "x-money-guide", description: "Read this before the first X Money action." }],
    publisher: { name: "cursor", displayName: "Cursor", isUserOwned: false },
    websiteUrl: "https://cursor.com/",
    ...overrides,
  };
}

test("every anchor is replaced exactly the declared number of times", () => {
  const source = syntheticChunk();
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) {
    const hits = source.split(entry.before).length - 1;
    assert.equal(hits, entry.occurrences ?? 1, `the anchor for "${entry.label}" must appear exactly the declared number of times`);
  }
  const patched = patchMarketplaceDetailView0781(source);
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) {
    assert.ok(!patched.includes(entry.before), `the anchor for "${entry.label}" must be gone`);
    assert.ok(patched.includes(entry.after), `the replacement for "${entry.label}" must be in place`);
  }
});

test("a missing anchor fails the patch closed", () => {
  const target = MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS.find((entry) =>
    entry.label.startsWith("detail description"),
  );
  const source = syntheticChunk().replace(target.before, "G=null");
  assert.throws(
    () => patchMarketplaceDetailView0781(source),
    /anchor is missing/,
    "the patch must refuse to run against a chunk it does not recognise",
  );
});

test("an ambiguous anchor fails the patch closed", () => {
  const target = MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS.find((entry) =>
    entry.label.startsWith("detail description"),
  );
  const source = syntheticChunk() + `${target.before}\n`;
  assert.throws(
    () => patchMarketplaceDetailView0781(source),
    /anchor is ambiguous/,
    "the patch must refuse to patch a site it cannot identify",
  );
});

test("the injected source parses on its own", () => {
  parse(MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE, { ecmaVersion: "latest", sourceType: "module" });
});

test("the injected source passes no children as the third argument", () => {
  // Upstream 0.18's chunk calls React through the AUTOMATIC runtime, so `t.jsx(type, props, child)`
  // consumes the child as the KEY and renders an EMPTY element — no exception, no parse error,
  // the chunk just loses its labels. The port's share, connect and copy-link buttons all rendered
  // with no text before this guard existed.
  const offenders = findDomChildrenInThirdArgument(MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE);
  assert.deepEqual(
    offenders.map((offender) => offender.text),
    [],
    "the injected source must not pass children as the third argument",
  );
});

test("the port writes no backtick and no double-wrapped locale call", () => {
  assert.ok(
    !MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes("`"),
    "the injected source is appended with a template literal, so it must contain no backtick",
  );
  assert.ok(
    !/RLocT\(RLocT\(/.test(MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE),
    "the port must not wrap a locale call in another locale call",
  );
});

test("every Chinese string the port writes is official's own", () => {
  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  for (const message of Object.values(MARKETPLACE_DETAIL_VIEW_0781_MESSAGES)) {
    const official = fixture.messages[message.id];
    assert.ok(official != null, `the official fixture is missing ${message.id}`);
    if (message.plural === true) {
      // A plural message's official value is its ICU form set, not a single string.
      assert.equal(official.plural.en.other, message.en, `official's ${message.id} must be ${message.en}`);
      assert.equal(official.plural.en.one, message.oneEn, `official's ${message.id} must be ${message.oneEn}`);
      assert.equal(official.plural.zh.other, message.zh, `official's ${message.id} must be ${message.zh}`);
      // The port composes the count at runtime, so the literal it writes is the plural's tail.
      assert.ok(
        patched.includes(message.zh.slice(message.zh.indexOf("#") + 1).trim()),
        `the port must write official's ${message.zh}`,
      );
      continue;
    }
    if (message.composed === true) {
      // A placeholder message: the port composes the count at runtime, so the guard checks the
      // exact expression that renders official's own parts around it.
      assert.equal(official.zh, message.zh, `official's ${message.id} must be ${message.zh}`);
      assert.ok(patched.includes(message.source), `the port must write official's ${message.id}`);
      continue;
    }
    assert.equal(official.zh, message.zh, `official's ${message.id} must be ${message.zh}`);
    assert.ok(patched.includes(message.zh), `the port must write official's ${message.zh}`);
  }
  for (const category of Object.values(MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES)) {
    assert.ok(category.zh.length > 0, "every category must carry Chinese text");
    assert.ok(category.en.length > 0, "every category must carry English text");
  }
});

test("every category the port names is official's own category table", () => {
  // Official's `zq` is the category-key → message-id table the detail page reads.
  const official = fixture.messages;
  const expected = {
    FEATURED: "FkMol5",
    INFRASTRUCTURE: "Mo77P4",
    DATA_ANALYTICS: "svH45G",
    PRODUCTIVITY: "N42ane",
    PAYMENTS: "H0ShEF",
    AGENT_ORCHESTRATION: "byAjqm",
    CANVAS: "Zty/IJ",
    INBOX_AND_COLLABORATION: "IzFMeN",
    SCHEDULING: "DbZMYM",
    DOCUMENTS_AND_FILES: "gDShYL",
    SALES: "mUv9U4",
    CUSTOMER_SUPPORT: "n+xLOH",
    FINANCE_AND_LEGAL: "hxm6On",
    RESEARCH: "bdztP2",
    DESIGN: "f8fH8W",
    MARKETING: "vo2a+a",
    LOGIN_AND_CREDENTIAL_MANAGEMENT: "P+nzjE",
  };
  assert.deepEqual(
    Object.keys(MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES).sort(),
    Object.keys(expected).sort(),
    "the port must carry exactly official's category keys",
  );
  for (const [key, id] of Object.entries(expected)) {
    const entry = MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES[key];
    assert.equal(official[id].en, entry.en, `official's ${id} must be ${entry.en}`);
    assert.equal(official[id].zh, entry.zh, `official's ${id} must be ${entry.zh}`);
  }
});

test("every class the port applies resolves in upstream 0.18 or in an official CSS companion", () => {
  const companion = new Set([
    ...companionClasses(browseCss),
    ...companionClasses(detailCss),
    ...companionClasses(layoutCss),
    ...companionClasses(routineCss),
  ]);
  const upstream = new Set(UPSTREAM_RESOLVED_CLASSES);
  const noop = new Set(STYLIX_NOOP_CLASSES);
  const missing = [];
  for (const name of appliedClasses()) {
    if (companion.has(name) || upstream.has(name) || noop.has(name)) continue;
    missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    "these classes have no rule in upstream 0.18's stylesheet and none in an official CSS companion, so the port would render unstyled",
  );
});

test("every class the port writes into the upstream chunk resolves", () => {
  // The port's own source is checked above. This guard covers the other half: the class recipes the
  // port writes INTO upstream 0.18's chunk, where a token that resolves nowhere renders the row
  // unstyled while every other guard stays green.
  const companion = new Set([
    ...companionClasses(browseCss),
    ...companionClasses(detailCss),
    ...companionClasses(layoutCss),
    ...companionClasses(routineCss),
  ]);
  const upstream = new Set(UPSTREAM_RESOLVED_CLASSES);
  const noop = new Set([...STYLIX_NOOP_CLASSES, ...SEMANTIC_MARKER_CLASSES]);
  const written = new Set();
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) {
    for (const match of entry.after.matchAll(/sand-[a-z0-9+_-]+/g)) written.add(match[0]);
  }
  const missing = [...written].filter(
    (name) => !companion.has(name) && !upstream.has(name) && !noop.has(name),
  );
  assert.deepEqual(
    missing,
    [],
    "these classes have no rule in upstream 0.18's stylesheet and none in an official CSS companion, so the port would render unstyled",
  );
});

test("every section message id is official's own and the repository's i18n table uses it", () => {
  const sections = MARKETPLACE_DETAIL_VIEW_0781_SECTION_MESSAGES;
  for (const message of Object.values(sections)) {
    const official = fixture.messages[message.id];
    assert.ok(official != null, `the official fixture is missing ${message.id}`);
    assert.equal(official.en, message.en, `official's ${message.id} must be ${message.en}`);
    assert.equal(official.zh, message.zh, `official's ${message.id} must be ${message.zh}`);
  }
  // The repository's own extra-i18n table localizes these strings; it must use official's ids, so a
  // message that drifts in either app is caught here rather than on screen.
  const plugins = EXTRA_I18N_FILES.find((entry) => entry.file === "view-B5Ug8wEm.js");
  assert.ok(plugins != null, "the extra-i18n table must carry the plugins chunk");
  const byEnglish = new Map(plugins.pairs.map(([en, zh, id]) => [en, { zh, id }]));
  for (const message of Object.values(sections)) {
    const entry = byEnglish.get(message.en);
    if (entry == null) continue; // "Tools" is localized by the marketplace wording patch
    assert.equal(entry.id, message.id, `the i18n table must localize "${message.en}" under official's ${message.id}`);
    assert.equal(entry.zh, message.zh, `the i18n table must write official's ${message.zh}`);
  }
  const wording = read("scripts", "lib", "marketplace-official-wording-patch.mjs");
  assert.ok(
    wording.includes('RLocT("Tools","工具")'),
    "the wording patch must localize the tools heading with official's own text",
  );
});

test("the declared upstream class list matches upstream 0.18's own stylesheet", () => {
  const assets = path.join(repoRoot, "src", "app", "dist", "renderer", "assets");
  if (!existsSync(assets)) return; // upstream's stylesheet only exists after npm run bootstrap
  const cssFile = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
  const css = readFileSync(path.join(assets, cssFile), "utf8");
  const missing = UPSTREAM_RESOLVED_CLASSES.filter(
    (name) => !new RegExp(`\\.${name}(?![A-Za-z0-9_+-])`).test(css),
  );
  assert.deepEqual(missing, [], "these classes are declared upstream but upstream does not define them");
});

test("every lifted detail rule is byte-for-byte official", () => {
  const officialCssPath = path.join(
    repoRoot,
    "..",
    "rea-grokbot-0781",
    "app",
    "dist",
    "renderer",
    "assets",
    "index-Dh7EWA8t.css",
  );
  if (!existsSync(officialCssPath)) return; // official's tree is not part of the repository
  const official = readFileSync(officialCssPath, "utf8");
  const rules = detailCss.split("\n").filter((line) => line.startsWith(".sand-"));
  assert.ok(rules.length > 0, "the detail companion must carry rules");
  for (const rule of rules) {
    assert.ok(official.includes(rule), `this rule is not official's own: ${rule}`);
  }
});

test("the detail companion carries every rule the port needs that upstream lacks", () => {
  const companion = new Set([
    ...companionClasses(browseCss),
    ...companionClasses(detailCss),
    ...companionClasses(layoutCss),
    ...companionClasses(routineCss),
  ]);
  for (const name of ["sand-1xr8qbc", "sand-jodmca", "sand-1pic42t", "sand-1onr9mi", "sand-2fvf9", "sand-p4054r", "sand-1lziwak"]) {
    assert.ok(companion.has(name), `official's ${name} must be lifted into a companion CSS`);
  }
});

test("the CSS patch ships a standalone rule even when a scoped rule names the same class", async () => {
  // Regression: the patch used to decide "this rule is already here" with a substring search.
  // Our own computer-card patch ships `.r-conversation-computer-card .sand-1lun4ml{…}`, which
  // *contains* the unscoped rule as a substring, so the unscoped rule was silently skipped — and
  // the detail page's button lost its border width while every other guard stayed green.
  const stage = mkdtempSync(path.join(tmpdir(), "sand-detail-css-"));
  try {
    const assets = path.join(stage, "dist", "renderer", "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(
      path.join(assets, "index-scoped.css"),
      [
        ".r-conversation-computer-card .sand-1lun4ml:not(#\\#):not(#\\#):not(#\\#){border-inline-end-width:1px}",
        ".r-conversation-computer-card .sand-pilrb4:not(#\\#):not(#\\#):not(#\\#){border-inline-start-width:1px}",
        "",
      ].join("\n"),
    );
    await applyMarketplaceDetailView0781Css({ stageRoot: stage });
    const lines = readFileSync(path.join(assets, "index-scoped.css"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    for (const name of ["sand-1lun4ml", "sand-pilrb4"]) {
      const standalone = lines.filter((line) => line.startsWith(`.${name}`));
      assert.equal(
        standalone.length,
        1,
        `official's unscoped ${name} rule must ship as its own rule, got ${standalone.length}`,
      );
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test("the information table carries official's own rows", () => {
  const { RM0781DetailRows } = builders();
  const rows = RM0781DetailRows(pluginEntry(), null);
  assert.deepEqual(
    rows.map((row) => row.term),
    ["功能", "开发者", "类别", "网站", "可用性"],
    "official's row set is 功能 / 开发者 / 类别 / 网站 / 可用性",
  );
  assert.equal(rows[0].value, "1 个应用, 1 项技能", "official joins the capability counts with a comma");
  assert.equal(rows[1].value, "Cursor", "the developer row is the publisher's display name");
  assert.equal(rows[2].value, "MCP", "an entry without a curated key falls back to its category");
  assert.equal(rows[3].value, "cursor.com", "the website row is the hostname");
  assert.equal(rows[4].value, "公开", "a listed marketplace plugin is public");
});

test("the team usage row appears only when teammates use the plugin", () => {
  const { RM0781DetailRows } = builders();
  const terms = (count) =>
    RM0781DetailRows(pluginEntry(), count).map((row) => row.term);
  assert.ok(!terms(null).includes("团队使用情况"), "no team row without a teammate count");
  assert.ok(!terms(0).includes("团队使用情况"), "no team row for a zero teammate count");
  assert.ok(terms(3).includes("团队使用情况"), "a used plugin carries official's team row");
});

test("the availability label follows official's rule", () => {
  const { RM0781DetailAvailability } = builders();
  assert.equal(RM0781DetailAvailability(pluginEntry()), "公开", "a listed plugin is public");
  assert.equal(
    RM0781DetailAvailability(pluginEntry({ marketplace: { name: "m", displayName: "M", ownership: "team" } })),
    "你的团队",
    "a team-owned plugin is the team's",
  );
  assert.equal(
    RM0781DetailAvailability(pluginEntry({ marketplace: { name: "m", displayName: "M", ownership: "user" } })),
    null,
    "a user-owned plugin is not public-listed",
  );
  assert.equal(
    RM0781DetailAvailability(pluginEntry({ native: "onepassword" })),
    null,
    "official's native entries carry no public-listing flag",
  );
});

test("the plugin URL follows official's rule", () => {
  const { RM0781DetailPluginUrl } = builders();
  assert.equal(
    RM0781DetailPluginUrl(pluginEntry()),
    "https://x.ai/bot/plugin/71001007",
    "official's public plugin URL is the x.ai bot page",
  );
  assert.equal(
    RM0781DetailPluginUrl(pluginEntry({ marketplace: { name: "m", displayName: "M", ownership: "user" } })),
    null,
    "official gives a user-owned plugin no URL",
  );
  assert.equal(
    RM0781DetailPluginUrl(pluginEntry({ native: "onepassword" })),
    null,
    "official's native entries have no plugin page",
  );
});

test("the category label resolves through official's own table", () => {
  const { RM0781DetailCategoryLabel } = builders();
  assert.equal(
    RM0781DetailCategoryLabel(pluginEntry({ category: "密码管理器", categoryKey: "LOGIN_AND_CREDENTIAL_MANAGEMENT" })),
    "密码管理器",
    "a curated key resolves through official's category table",
  );
  assert.equal(
    RM0781DetailCategoryLabel(pluginEntry({ category: "MCP", categoryKey: undefined })),
    "MCP",
    "a category outside the table keeps its own text",
  );
  assert.equal(
    RM0781DetailCategoryLabel(pluginEntry({ category: "  ", categoryKey: undefined })),
    null,
    "an empty category has no label",
  );
});

test("the connector count falls back to the entry itself, official's rule", () => {
  const { RM0781DetailConnectors } = builders();
  assert.equal(
    RM0781DetailConnectors(pluginEntry({ connectors: undefined })).length,
    1,
    "official counts the plugin itself when it declares no connector",
  );
  assert.equal(RM0781DetailConnectors(pluginEntry()).length, 1, "a declared connector is counted");
});

test("the website row shows the hostname", () => {
  const { RM0781DetailHostname } = builders();
  assert.equal(RM0781DetailHostname("https://cursor.com/"), "cursor.com");
  assert.equal(RM0781DetailHostname(undefined), null);
  assert.equal(RM0781DetailHostname("not a url"), null);
});

test("the port replaces upstream 0.18's detail surface with official's", () => {
  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  assert.ok(patched.includes('"data-detail-hero-title":""'), "official's hero-title wrapper must be in place");
  assert.ok(patched.includes("RM0781DetailCopyLink"), "official's copy-link button must be in place");
  assert.ok(patched.includes("RM0781DetailActions"), "official's action group must be in place");
  assert.ok(patched.includes("RM0781DetailCard"), "official's 应用 / 技能 cards must be in place");
  assert.ok(patched.includes("RM0781DetailsList"), "official's 信息 table must be in place");
  assert.ok(
    !patched.includes('t.jsx($n,{cardClassName:"sand-plugins-detail__connectors"'),
    "upstream's collapsible card must be gone",
  );
});

test("the native tile on the detail page is official's 56×56 one", () => {
  // The tile itself belongs to the browse port: the detail header's icon slot is the 56px one
  // and the browse row's is the 40px one. The detail patch only replaces the surface around it.
  const detailSlot = MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS.find((entry) =>
    entry.after.includes("name:s.displayName,size:56"),
  );
  assert.ok(detailSlot != null, "the browse port must own the detail header's icon slot");
  assert.ok(
    detailSlot.after.includes("RM0781NativeIcon(s,56)"),
    "the detail page's brand tile must be the 56×56 one",
  );
  const rowSlot = MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS.find((entry) =>
    entry.after.includes("name:w.displayName,size:40"),
  );
  assert.ok(
    rowSlot.after.includes("RM0781NativeIcon(w,40)"),
    "the browse row must keep the 40×40 tile",
  );
});

test("the detail page's rows and cards carry official's own recipes", () => {
  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  // The port's own injected source is appended after the chunk; the recipes this guard counts are
  // the ones the port writes INTO upstream 0.18's chunk.
  const chunk = patched.slice(0, patched.indexOf(MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE));
  const count = (needle) => chunk.split(needle).length - 1;
  const cases = [
    ["the section heading", 'k("sand-9f619 sand-1y1aw1k sand-1pic42t sand-10b6aqq sand-1onr9mi")', 4],
    ["the details row", 'k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi")', 7],
    ["the row label", 'k("sand-9f619 sand-2lah0s sand-thy2uy sand-b3r6kr sand-uxw1ft sand-lyipyv sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-tyxrsu")', 5],
    ["the accounts card", 'k("sand-plugins-detail__accounts","sand-9f619 sand-7giv3 sand-13ly8rp sand-1xlntvz sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r")', 1],
    ["the setup card", 'k("sand-plugins-detail__setup","sand-9f619 sand-7giv3 sand-13ly8rp sand-1xlntvz sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r")', 1],
    ["the tools card", 'k(l,"sand-9f619 sand-7giv3 sand-4hv7ue sand-1y0btm7 sand-5fd6op sand-1pkpdue sand-10e981r sand-exx8yu sand-18d9i69")', 1],
    ["the account title", 'k("sand-9f619 sand-b3r6kr sand-11wthnw sand-d4r4e8 sand-12oo3zp sand-tyxrsu sand-lyipyv sand-uxw1ft")', 1],
    ["the add-account row", 'k("sand-plugins-detail__add-account","sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-h8yej3 sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-c342km sand-ng3xce sand-jbqb8w sand-1o0liin sand-n4ifyr sand-jb2p0i sand-11wthnw sand-12oo3zp sand-1yc453h sand-1ypdohk sand-1t137rt sand-1yfcfk6")', 1],
    ["the edit-account button", 'k("sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-1717udv sand-c342km sand-ng3xce sand-jbqb8w sand-169k319 sand-n4ifyr sand-1ypdohk")', 1],
    ["the tools summary button", 'k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi sand-jyslct sand-1lugfcp sand-h8yej3 sand-dj266r sand-14z9mp sand-at24cr sand-1lziwak sand-c342km sand-ng3xce sand-jb2p0i sand-1qlqyl8 sand-1yc453h sand-1ypdohk sand-jbqb8w sand-1ecwv3n sand-1t137rt sand-1yfcfk6")', 1],
  ];
  for (const [name, recipe, expected] of cases) {
    assert.equal(count(recipe), expected, `official's ${name} recipe must be applied ${expected} time(s)`);
  }
  const upstream = [
    ["the section heading", 'k("sand-9f619 sand-1y1aw1k sand-19tmk5i sand-10b6aqq sand-zjhap9")'],
    ["the details row", 'k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-z9dl7a sand-19tmk5i sand-sag5q8 sand-zjhap9")'],
    ["the row label", 'k("sand-9f619 sand-2lah0s sand-thy2uy sand-b3r6kr sand-uxw1ft sand-lyipyv sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-1wd3ewq")'],
  ];
  for (const [name, recipe] of upstream) {
    assert.equal(count(recipe), 0, `upstream's ${name} recipe must be gone`);
  }
});

test("the setup section's button is official's own small secondary button", () => {
  const source = MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE;
  for (const token of [
    "sand-1lun4ml",
    "sand-pilrb4",
    "sand-18b5jzi",
    "sand-1o3jo1z",
    "sand-v5lvn5",
    "sand-4meti",
    "sand-fwqdrz",
    "sand-19jy9ex",
    "sand-tyxrsu",
  ]) {
    assert.ok(source.includes(token), `official's ${token} must be on the button`);
  }
  for (const token of ["sand-s1s249", "sand-1kxuqrf", "sand-uo9n5k"]) {
    assert.ok(!source.includes(token), `upstream's ${token} must not be on the button`);
  }
});

test("mutations: swapping official's small secondary button back to upstream's fails the guard", async () => {
  const original = path.join(repoRoot, "scripts/lib/marketplace-detail-view-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source.replace(
    "sand-1lun4ml sand-so031l sand-pilrb4 sand-13fuv20 sand-18b5jzi",
    "sand-s1s249 sand-so031l sand-e0pwq sand-13fuv20 sand-32b0ac",
  );
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-detail-button.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    assert.ok(
      !mutant.MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes("sand-1lun4ml"),
      "the guard must fail on a button that carries upstream's recipe",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("mutations: swapping official's details row back to upstream's fails the guard", async () => {
  const original = path.join(repoRoot, "scripts/lib/marketplace-detail-view-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source.replace(
    "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi",
    "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-z9dl7a sand-19tmk5i sand-sag5q8 sand-zjhap9",
  );
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-detail-recipes.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    const official = "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-oyc9vk sand-1pic42t sand-2lprc sand-1onr9mi";
    const upstream = "sand-9f619 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-z9dl7a sand-19tmk5i sand-sag5q8 sand-zjhap9";
    const chunkOf = (module) => {
      const patched = module.patchMarketplaceDetailView0781(syntheticChunk());
      return patched.slice(0, patched.indexOf(module.MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE));
    };
    const real = chunkOf(await import(pathToFileURL(original).href));
    const mutatedChunk = chunkOf(mutant);
    assert.ok(
      real.split(official).length - 1 > mutatedChunk.split(official).length - 1,
      "the guard must fail on a patch that writes upstream's details row instead of official's",
    );
    assert.ok(
      mutatedChunk.split(upstream).length - 1 > real.split(upstream).length - 1,
      "the mutant must write upstream's details row everywhere official's was written",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("mutations: dropping the information table fails the port's guard", async () => {
  // The mutant has to live inside the repo so the patch module's own relative imports resolve.
  const original = path.join(repoRoot, "scripts/lib/marketplace-detail-view-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source.replace(
    't.jsx(RM0781DetailsList,{label:RLocT(\\"Information\\",\\"信息\\"),',
    'null,{label:RLocT(\\"Information\\",\\"信息\\"),',
  );
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-detail-rows.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    const patched = mutant.patchMarketplaceDetailView0781(syntheticChunk());
    assert.throws(
      () => assert.ok(patched.includes("t.jsx(RM0781DetailsList")),
      "the guard must fail on a patch that drops the information table",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("the patched upstream chunk parses", () => {
  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
});

test("the detail bar is official 0.78.1's own bar", () => {
  // Official's marketplace renders the shared `sand-settings-detail-bar` component: a 48px
  // three-column grid (back | title | trailing), the back button a 28×28 ghost icon button,
  // and the title hidden for a plugin detail because the detail page carries its own heading.
  // Upstream 0.18's bar is a 44px flex row that shows the title and a bare 16px icon.
  const source = MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE;
  assert.ok(
    source.includes(
      'RM0781DetailBarClasses="sand-settings-detail-bar sand-9f619 sand-rvj5dj sand-37c5m6 ' +
        'sand-6s0dn4 sand-sdox4t sand-889kno sand-2vl965 sand-1a8lsjc sand-e2zdcy"',
    ),
    "the bar must carry official's own class recipe",
  );
  assert.ok(
    source.includes('RM0781DetailBarBackClasses="sand-1lqcxt8 sand-euugli"'),
    "official wraps the back button in a start-aligned cell",
  );
  assert.ok(
    source.includes(
      'RM0781DetailBarTrailingClasses="sand-78zum5 sand-6s0dn4 sand-1qab1bc sand-euugli"',
    ),
    "official's trailing cell is end-aligned",
  );
  assert.ok(
    source.includes('"data-sentiment":"neutral","data-size":"md","data-variant":"ghost"'),
    "the back button is official's ghost icon button at the md size",
  );
  assert.ok(
    source.includes("sand-gd8bvy sand-1fgtraw"),
    "the back button is official's 28×28 recipe",
  );
  assert.ok(
    source.includes('t.jsx("h3",{"aria-hidden":true,className:RM0781DetailBarTitleClasses'),
    "official hides the bar title for a plugin detail, so the heading must be aria-hidden",
  );
  assert.ok(
    source.includes("sand-19991ni sand-ibwnj sand-12w9bfk sand-9lcvmn sand-g01cxk"),
    "official's bar title carries the fading recipe and the hidden opacity",
  );
  const bar = MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS.find((entry) =>
    entry.label.startsWith("marketplace detail bar"),
  );
  assert.ok(bar, "the patch must own the detail bar");
  assert.equal(bar.before, "t.jsx(el,{headingId:a,onBack:W,title:Ts})");
  assert.equal(bar.after, "t.jsx(RM0781DetailBar,{headingId:a,onBack:W,title:Ts})");
});

test("the button variants are official 0.78.1's own recipes", () => {
  // Official's Button merges `hC.root`, `Cx.body1`, `hC.sizeLg` and the neutral variant recipe.
  // `primary` is `hC.neutralPrimary`, `secondary` is `hC.neutralSecondary` and `tertiary` is
  // `hC.neutralTertiary` — a port that swaps the first two renders the wrong button colour.
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(
      'RM0781DetailButtonPrimary=RM0781DetailButtonBase+" sand-8rotk8 sand-5b9xvv sand-1ialtwx sand-sa7k8x sand-g7klql"',
    ),
    "official's primary recipe is the neutral-primary one",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(
      'RM0781DetailButtonSecondary=RM0781DetailButtonBase+" sand-fwqdrz sand-urwpdt sand-1g6zli8 sand-tyxrsu sand-g7klql"',
    ),
    "official's secondary recipe is the neutral-secondary one",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(
      'RM0781DetailButtonTertiary=RM0781DetailButtonBase+" sand-jbqb8w sand-15cxclc sand-1oqui1x sand-tyxrsu sand-g7klql"',
    ),
    "official's tertiary recipe is the neutral-tertiary one",
  );
});

test("mutations: swapping official's primary and secondary button recipes fails the guard", async () => {
  const original = path.join(repoRoot, "scripts/lib/marketplace-detail-view-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source.replace(
    'RM0781DetailButtonPrimary=RM0781DetailButtonBase+\\" sand-8rotk8',
    'RM0781DetailButtonPrimary=RM0781DetailButtonBase+\\" sand-fwqdrz',
  );
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-detail-buttons.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    const patched = mutant.patchMarketplaceDetailView0781(syntheticChunk());
    assert.throws(
      () =>
        assert.ok(
          patched.includes(
            'RM0781DetailButtonPrimary=RM0781DetailButtonBase+" sand-8rotk8',
          ),
          "the guard must bite when the button recipes are swapped",
        ),
      "the guard must fail on a port that swapped official's button variants",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("the information table omits the rows official omits", () => {
  const { RM0781DetailRows } = builders();
  const bare = pluginEntry({ publisher: undefined, websiteUrl: undefined });
  const terms = RM0781DetailRows(bare, null).map((row) => row.term);
  assert.deepEqual(
    terms,
    ["功能", "类别", "可用性"],
    "official drops the developer and website rows when the entry carries neither",
  );
  const builtin = pluginEntry({ builtinServerIdentifier: "builtin:1" });
  const builtinTerms = RM0781DetailRows(builtin, null).map((row) => row.term);
  assert.deepEqual(
    builtinTerms,
    ["功能", "网站", "可用性"],
    "official drops the developer and category rows for a built-in plugin but keeps the website row",
  );
});

test("the card collapses at official's five rows and offers official's more button", () => {
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes("items.slice(0,5)"),
    "official's card shows five rows before it collapses",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes('RLocT(hidden+" more","另外 "+hidden+" 个")'),
    "official's more button carries official's own text",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes("RM0781DetailCardClassesMore"),
    "official's card swaps its container recipe once rows are hidden",
  );
});

test("the team-managed state is official's own separate disabled button", () => {
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(
      'installMode==="team-required"||installMode==="team-default"',
    ),
    "official shows the managed button for both team modes",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes('installMode!=="team-required"'),
    "official renders no removal button for a team-required plugin",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(
      'RLocT("Managed by your team","由你的团队管理")',
    ),
    "official's team-required label is q1LJYo's own text",
  );
  assert.ok(
    MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes('RLocT("Added by your team","由你的团队添加")'),
    "official's team-default label is MoPMW6's own text",
  );
});

test("the staged chunk carries the ported detail page", () => {
  const assets = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets");
  if (!existsSync(assets)) return; // the staged chunk only exists after a build
  const file = readdirSync(assets).find((name) => name === "view-B5Ug8wEm.js");
  if (file == null) return;
  const chunk = readFileSync(path.join(assets, file), "utf8");
  for (const marker of [
    "RM0781DetailActions",
    "RM0781DetailCopyLink",
    "RM0781DetailCard",
    "RM0781DetailsList",
    "RM0781DetailRows",
    "RM0781NativeIcon(s,56)",
  ]) {
    assert.ok(chunk.includes(marker), `the staged chunk must carry ${marker}`);
  }
});

test("the tool-row switch carries official 0.78.1's own track and knob recipes", () => {
  // Upstream 0.18 renders the per-tool row's on/off switch with its shared switch, whose checked
  // track is the grey `--sand-fill-control-checked`. Official renders the same control with its
  // own switch: the checked track is the accent primary and the knob is the luminous surface.
  const render = toolSwitch();
  const on = render({ isChecked: true, label: "Disable Get me", onToggle: () => {} });
  const off = render({ isChecked: false, label: "Enable Get me", onToggle: () => {} });

  assert.equal(on.type, "button", "official's switch is a button");
  assert.deepEqual(
    Object.keys(on.props).sort(),
    ["aria-checked", "aria-label", "children", "className", "onClick", "role", "type"],
    "official's switch renders aria-checked, aria-label, role, type and class, and nothing else",
  );
  assert.equal(on.props.role, "switch", "official's switch carries role=switch");
  assert.equal(on.props.type, "button", "official's switch is a button");
  assert.equal(on.props["aria-checked"], true, "a checked switch reports aria-checked=true");
  assert.equal(on.props["aria-label"], "Disable Get me", "the switch carries the row's own label");
  assert.equal(
    on.props.className,
    OFFICIAL_0781_SWITCH_TRACK_ON,
    "the checked track must be official's own recipe",
  );
  assert.equal(
    off.props["aria-checked"],
    false,
    "an unchecked switch reports aria-checked=false",
  );
  assert.equal(
    off.props.className,
    OFFICIAL_0781_SWITCH_TRACK_OFF,
    "the unchecked track must be official's own recipe",
  );

  assert.equal(on.props.children.type, "span", "the knob is a span");
  assert.deepEqual(
    Object.keys(on.props.children.props).sort(),
    ["aria-hidden", "className"],
    "the knob carries nothing but its hidden flag and its recipe",
  );
  assert.equal(
    on.props.children.props["aria-hidden"],
    true,
    "the knob is hidden from the accessibility tree",
  );
  assert.equal(
    on.props.children.props.className,
    OFFICIAL_0781_SWITCH_KNOB_ON,
    "the checked knob must be official's own recipe",
  );
  assert.equal(
    off.props.children.props.className,
    OFFICIAL_0781_SWITCH_KNOB_OFF,
    "the unchecked knob must be official's own recipe",
  );

  for (const upstream of UPSTREAM_018_SWITCH_CLASSES) {
    assert.ok(
      !MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE.includes(upstream),
      `upstream's shared switch recipe ${upstream} must not be on the tool-row switch`,
    );
  }

  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  assert.ok(
    patched.includes("t.jsx(RM0781DetailToolSwitch,"),
    "the tool row must render official's switch",
  );
  assert.ok(!patched.includes("t.jsx(Kn,"), "upstream's shared switch must not render the tool row");
});

test("the tool-row switch's label is official's own text in both languages", () => {
  // Official builds the label from two locale ids: `y5UgU8` ("Disable {0}" / "停用 {0}") for a
  // tool that is enabled and `FZtBeR` ("Enable {0}" / "启用 {0}") for a tool that is not. Official's
  // live plugin carries `aria-label="停用 Get me"` on an enabled tool. Upstream 0.18 builds the
  // same label from two English literals, and the extra-i18n pass localizes only the "Enable"
  // half, so the enabled branch reads "Disable <name>" inside a Chinese page.
  const entry = MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS.find((candidate) =>
    candidate.label.startsWith("detail tool rows"),
  );
  assert.ok(entry != null, "the patch must own the tool row's switch");
  assert.ok(
    entry.after.includes('RLocT("Disable","停用")'),
    "the tool row's switch must carry official's own Disable text",
  );
  assert.ok(
    !entry.after.includes(':"Disable"'),
    "the tool row's switch must not keep the bare English Disable literal",
  );
  const patched = patchMarketplaceDetailView0781(syntheticChunk());
  assert.ok(
    patched.includes('RLocT("Disable","停用")'),
    "the patched chunk must carry official's own Disable text at the tool-row switch",
  );
  assert.ok(
    !patched.includes(':"Disable"} ${P.get(j.name)??j.name}'),
    "the patched chunk must not keep upstream's bare English Disable branch",
  );
});

test("the detail companion carries official's switch rules", () => {
  for (const rule of OFFICIAL_0781_SWITCH_RULES) {
    assert.ok(
      detailCss.includes(rule),
      `official's switch rule must be lifted into the detail companion: ${rule}`,
    );
  }
});

test("mutations: swapping official's switch recipes back to upstream's fails the guard", async () => {
  const original = path.join(repoRoot, "scripts/lib/marketplace-detail-view-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source
    .replace(
      OFFICIAL_0781_SWITCH_TRACK_ON,
      OFFICIAL_0781_SWITCH_TRACK_ON.replace("sand-amitd3", "sand-1jq8sgu"),
    )
    .replace(
      OFFICIAL_0781_SWITCH_KNOB_ON,
      OFFICIAL_0781_SWITCH_KNOB_ON.replace("sand-1r4y97", "sand-khjh7l"),
    );
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-detail-switch.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    const mutantSource = mutant.MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE;
    assert.ok(
      !mutantSource.includes(OFFICIAL_0781_SWITCH_TRACK_ON),
      "the guard must fail when the checked track is not official's",
    );
    assert.ok(
      mutantSource.includes("sand-1jq8sgu"),
      "the mutant must carry upstream's grey checked track",
    );
    assert.ok(
      !mutantSource.includes(OFFICIAL_0781_SWITCH_KNOB_ON),
      "the guard must fail when the knob is not official's",
    );
    assert.ok(
      mutantSource.includes("sand-khjh7l"),
      "the mutant must carry upstream's knob recipe",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("every token the ported switch's recipes read is declared on the dialog in both themes", () => {
  const css = read("scripts", "lib", "marketplace-dialog-0781-theme-tokens.css");
  assertSwitchTokensDeclared(css);
  // The guard must bite: a dialog that stops declaring one of the switch's own tokens renders
  // the rule at its initial value, so the track loses its colour.
  assert.throws(
    () => assertSwitchTokensDeclared(css.replace(/--sand-shadow-control:[^;]+;/, "")),
    /--sand-shadow-control/,
    "the guard must fail on a dialog that stops declaring the switch's own token",
  );
});
