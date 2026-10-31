// Regression cover for official 0.78.1's browse page, ported into upstream 0.18's plugins view:
// the chip taxonomy as the section taxonomy, the 为你推荐 section, the 查看全部 group action (both
// of official's semantics), the chip row, the Bot-templates button and the connect action.
//
// The guards here are the ones that matter for a port that rewrites MINIFIED upstream code:
//
//   * every anchor must be replaced exactly once — the patch refuses a missing or ambiguous
//     anchor at build time, and an anchor that became ambiguous would patch the wrong site;
//   * the injected source must parse on its own (a broken splice takes the whole renderer down);
//   * every Chinese string the port writes must be official's own, matched against the captured
//     official locale fixture — a typo or an invented translation fails here;
//   * every class the port applies must resolve in upstream 0.18's stylesheet or in the 0781
//     official CSS companion. A stylix class name is the hash of its declaration block, so a class
//     that exists in one build and not in another is a *no-op*: the chip would render unstyled with
//     every other test still green. This guard does NOT depend on `.build` — it bites in CI.
//
// The staged chunk is checked too when a build is present.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
  MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE,
  MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS,
  MARKETPLACE_0781_CHIP_ORDER,
  MARKETPLACE_0781_MESSAGES,
  MARKETPLACE_0781_RECOMMENDED_LIMIT,
  MARKETPLACE_0781_SECTION_LIMIT,
  patchMarketplaceBrowseChrome0781,
} from "../scripts/lib/marketplace-browse-chrome-0781-patch.mjs";
import { EXTRA_I18N_FILES, patchExtraFile } from "../scripts/lib/extra-i18n-patch.mjs";
import { patchMarketplaceOfficialWording } from "../scripts/lib/marketplace-official-wording-patch.mjs";
import {
  findDomChildrenInThirdArgument,
  normalizeJsxChildren,
} from "../scripts/lib/marketplace-jsx-children.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const fixture = JSON.parse(read("tests", "fixtures", "official-0781-marketplace-wording.json"));
const botMarkFrame = JSON.parse(read("tests", "fixtures", "official-0781-bot-mark-frame.json"));
const nativeIconFrame = JSON.parse(read("tests", "fixtures", "official-0781-native-icons.json"));
const officialCss = read("scripts", "lib", "marketplace-browse-chrome-0781-official.css");
const dialogOfficialCss = read("scripts", "lib", "marketplace-dialog-0781-official.css");

/**
 * The classes upstream 0.18's stylesheet already defines, so the port does not have to lift them.
 *
 * This list is the port's declared style contract. It is cross-checked against upstream 0.18's own
 * stylesheet whenever that stylesheet is present (`npm run bootstrap`), so it cannot drift
 * silently, and it lets the resolution guard below bite even on a runner that has no upstream
 * payload at all.
 */
const UPSTREAM_RESOLVED_CLASSES = [
  "sand-10b6aqq", "sand-10e981r", "sand-10w6t97", "sand-1120s5i", "sand-11wthnw", "sand-12oo3zp",
  "sand-149ho13", "sand-167g77z", "sand-169k319", "sand-17d4w8g", "sand-195vfkc", "sand-1awh872",
  "sand-1c4vz4f", "sand-1d3mw78", "sand-1fgtraw", "sand-1g0dm76", "sand-1ghz6dp", "sand-1iorvi4",
  "sand-1jnr06f", "sand-1k57tk5", "sand-1kky2od", "sand-1lliihq", "sand-1lugfcp", "sand-1n2onr6",
  "sand-1nejdyq", "sand-1nn3v0j", "sand-1o0liin", "sand-1pha0wt", "sand-1qmwy7c", "sand-1qughib",
  "sand-1qx5ct2", "sand-1rhlpx6", "sand-1t137rt", "sand-1uczgqu", "sand-1wm8ruf", "sand-1y0btm7",
  "sand-1y1aw1k", "sand-1y3gkto", "sand-1ypdohk", "sand-25sj25", "sand-2lah0s", "sand-2vl965",
  "sand-3nfvp2", "sand-5yr21d", "sand-6s0dn4", "sand-784prv", "sand-78zum5", "sand-9f619",
  "sand-9v5kkp", "sand-amitd3", "sand-b3r6kr", "sand-c342km", "sand-dl72j9", "sand-dqyycr",
  "sand-dt5ytf", "sand-euugli", "sand-f159sx", "sand-fc7y3v", "sand-h8yej3", "sand-jb2p0i",
  "sand-jbqb8w", "sand-jkvuk6", "sand-jyslct", "sand-l1xv1r", "sand-l56j7k", "sand-lshs6z",
  "sand-lup9mm", "sand-lyipyv", "sand-mkeg23", "sand-n4ifyr", "sand-ng3xce", "sand-qcrz7y",
  "sand-sag5q8", "sand-t9pb60", "sand-tyxrsu", "sand-uxw1ft", "sand-w4jnvo", "sand-wz0xwf",
  "sand-xhr3t",
];

/**
 * The classes the port applies that official 0.78.1 itself gives no rule to.
 *
 * They are stylix namespace markers (`sand-plugins__group`, `sand-kit-icon`, …) or a recipe whose
 * declaration block is empty, so they carry no style on either side.
 */
const STYLIX_NOOP_CLASSES = [
  "sand-grok-bot-mark",
  "sand-iorvi4",
  "sand-kit-icon",
  "sand-plugins__added",
  "sand-plugins__group",
  "sand-plugins__group-action",
  "sand-plugins__installed-preview",
  "sand-tool-icon",
];

/** Every class the port applies — `var(--sand-…)` custom-property references are not classes. */
function appliedClasses() {
  const classes = new Set();
  for (const match of MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE.matchAll(/(?<!--)sand-[a-z0-9+_-]+/g)) {
    classes.add(match[0]);
  }
  return classes;
}

/** The classes the 0781 official CSS companion defines. */
function companionClasses(css) {
  return new Set([...css.matchAll(/\.(sand-[a-z0-9+_-]+)/g)].map((match) => match[1]));
}

/** A chunk that contains every anchor exactly once (the anchors are fragments, so this is text). */
function syntheticChunk() {
  let source = "const Os=1,Re=2,ue=3,C=4,t=5,k=6,RLocT=7,Pl=8,nt=9,qn={};\n";
  for (const entry of MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS) source += `/*${entry.label}*/${entry.before}\n`;
  return source;
}

/** The injected source, as it lands in the chunk. */
function injectedSource(patched) {
  const marker = "const RM0781ChipRegistry=";
  const index = patched.indexOf(marker);
  assert.ok(index >= 0, "the injected source must be present");
  return patched.slice(index);
}

/**
 * The injected source, evaluated on its own so the pure section builder can be exercised.
 *
 * Only `RLocT` is needed; every other chunk-scope identifier is referenced from a function body
 * this test never calls.
 */
function builder() {
  const factory = new Function(
    "RLocT",
    `${MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE}\n` +
      "return {RM0781BuildSections,RM0781GroupByChip,RM0781ChipsOf,RM0781ChipRow,RM0781ChipRegistry};",
  );
  return factory((en, zh) => zh);
}

/** A catalog with official's own shape: an upstream category key, a display category and a name. */
function catalog() {
  const entries = [];
  const add = (id, name, category, categoryKey) =>
    entries.push({ id, name, displayName: name, category, categoryKey, iconUrl: `https://x/${id}.png` });
  add("c1", "Onepassword", "Login and Credential Management", "LOGIN_AND_CREDENTIAL_MANAGEMENT");
  for (let i = 0; i < 8; i += 1) add(`p${i}`, `Productivity ${i}`, "Productivity", "PRODUCTIVITY");
  for (let i = 0; i < 4; i += 1) add(`m${i}`, `Marketing ${i}`, "Marketing", "MARKETING");
  for (let i = 0; i < 2; i += 1) add(`s${i}`, `Support ${i}`, "Customer Support", "CUSTOMER_SUPPORT");
  // Official's own map has no chip for FEATURED or AGENT_ORCHESTRATION, so those entries fall out
  // of every chip bucket — official-faithful, and asserted below.
  add("f1", "Featured One", "Featured", "FEATURED");
  add("f2", "Featured Two", "Featured", "FEATURED");
  // A marketplace-published entry: official's grouping skips it.
  entries.push({
    id: "mp",
    name: "Marketplace One",
    displayName: "Marketplace One",
    category: "Productivity",
    categoryKey: "PRODUCTIVITY",
    marketplace: { name: "marketplace-one", displayName: "Marketplace One" },
  });
  return entries;
}

test("every anchor is replaced exactly once", () => {
  const chunk = syntheticChunk();
  for (const entry of MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS) {
    const count = chunk.split(entry.before).length - 1;
    assert.equal(count, 1, `the anchor of "${entry.label}" must occur exactly once, found ${count}`);
  }
  const patched = patchMarketplaceBrowseChrome0781(chunk);
  for (const entry of MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS) {
    // One replacement is additive (the chip state is appended to the existing state list), so the
    // old text may legitimately survive inside the new one. What must not happen is the old text
    // surviving *on its own*.
    const beforeCount = patched.split(entry.before).length - 1;
    const expected = entry.after.includes(entry.before) ? 1 : 0;
    assert.equal(beforeCount, expected, `"${entry.label}" must be replaced`);
    assert.ok(patched.includes(entry.after), `"${entry.label}" must write its replacement`);
  }
});

test("the injected source parses on its own", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  const injected = injectedSource(patched);
  assert.doesNotThrow(
    () => parse(injected, { ecmaVersion: "latest", sourceType: "module" }),
    "the injected source must parse as a module",
  );
});

test("no element writes its children through the jsx runtime's third argument", () => {
  // Upstream 0.18's chunk calls React through the AUTOMATIC runtime: jsx(type, props, key).
  // The third argument is therefore the KEY. A DOM element that passes children there renders
  // EMPTY — React silently consumes the children as the key, nothing throws, and the chunk
  // still parses. That is exactly how the first cut of this port lost its chip labels, its
  // 查看全部 group action, its Bot-templates button and its connected-apps entry.
  const injected = MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE;
  const injectedOffenders = findDomChildrenInThirdArgument(injected);
  assert.deepEqual(
    injectedOffenders.map((offender) => offender.text),
    [],
    "the injected source must not pass children as the third argument",
  );

  // The real chunk, not the synthetic one: the synthetic chunk is a text fragment of anchors and
  // does not parse on its own. Upstream's payload only exists after `npm run bootstrap`.
  const chunkPath = path.join(repoRoot, "src", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(chunkPath)) {
    assert.ok(true, "upstream 0.18's payload is not present; the patched-chunk guard did not run");
    return;
  }
  const pristine = readFileSync(chunkPath, "utf8");
  const entry = EXTRA_I18N_FILES.find((file) => file.file === "view-B5Ug8wEm.js");
  assert.ok(entry != null, "the extra-i18n pass must own the plugins chunk");
  const localised = patchExtraFile(pristine, entry).patched;
  const worded = patchMarketplaceOfficialWording(localised);
  const patched = patchMarketplaceBrowseChrome0781(worded);
  const patchedOffenders = findDomChildrenInThirdArgument(patched);
  assert.deepEqual(
    patchedOffenders.map((offender) => offender.text),
    [],
    "the patched chunk must not pass children as the third argument",
  );
});

test("the jsx children transform is a no-op on upstream 0.18's own code", () => {
  // Upstream's own three-argument DOM calls all declare `children` in their props, so their
  // third argument is a key and the transform must leave them alone. The pristine chunk is only
  // present after `npm run bootstrap`; without it this guard reports that it could not run.
  const pristine = path.join(repoRoot, "src", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(pristine)) {
    assert.ok(true, "upstream 0.18's payload is not present; the transform guard did not run");
    return;
  }
  const source = readFileSync(pristine, "utf8");
  const before = findDomChildrenInThirdArgument(source);
  assert.equal(before.length, 0, "upstream 0.18's own code must not use the classic convention");
  assert.equal(normalizeJsxChildren(source), source, "the transform must not touch upstream's code");
});

test("every lifted CSS rule is byte-for-byte official", (t) => {
  // The `:not(#\#)` repetitions in a stylix rule are the specificity ladder that orders the rule
  // against its neighbours, so their COUNT is part of the rule. A rule with the right declaration
  // but too few guards loses to a neighbour upstream 0.18's own stylesheet already carries.
  //
  // Official 0.78.1's stylesheet lives in the sibling analysis tree, which is not checked out on
  // CI runners.
  const officialStylesheet = path.resolve(
    import.meta.dirname,
    "../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  );
  if (!existsSync(officialStylesheet)) {
    t.skip("the 0.78.1 extract is not present on this machine");
    return;
  }
  const official = readFileSync(officialStylesheet, "utf8");
  for (const [label, css] of [
    ["browse chrome", officialCss],
    ["dialog", dialogOfficialCss],
  ]) {
    const rules = css.split("\n").filter((line) => line.startsWith(".sand-"));
    assert.ok(rules.length > 0, `the ${label} companion must carry rules`);
    for (const rule of rules) {
      assert.ok(
        official.includes(rule),
        `the ${label} rule must be official's byte for byte: ${rule.slice(0, 60)}`,
      );
    }
  }
});

test("the dialog theme tokens carry official 0.78.1's values, scoped to the dialog", () => {
  // The ported chip rules read `var(--sand-bg-primary)`, `var(--sand-bg-secondary)` and
  // `var(--sand-text-inverted)`. Upstream 0.18's palette does not define them, so without this
  // token block the chip surfaces render transparent and every other test still passes.
  const css = read("scripts", "lib", "marketplace-dialog-0781-theme-tokens.css");
  const tokens = JSON.parse(
    read("tests", "fixtures", "official-0781-marketplace-theme-tokens.json"),
  ).tokens;
  const parseBlock = (body) =>
    Object.fromEntries(
      body
        .split(";")
        .filter((declaration) => declaration.length > 0)
        .map((declaration) => {
          const at = declaration.indexOf(":");
          return [declaration.slice(0, at).trim(), declaration.slice(at + 1).trim()];
        }),
    );
  const light = css.match(/^\.sand-plugins-dialog\{(.+)\}$/m);
  const dark = css.match(/^html\[data-theme="cursor-dark"\] \.sand-plugins-dialog\{(.+)\}$/m);
  assert.ok(light != null, "the light token block must be scoped to the dialog");
  assert.ok(dark != null, "the dark token block must be scoped to the dialog under cursor-dark");
  const lightTokens = parseBlock(light[1]);
  const darkTokens = parseBlock(dark[1]);
  assert.deepEqual(
    Object.keys(lightTokens).sort(),
    Object.keys(tokens).sort(),
    "the light block must carry exactly the captured official tokens",
  );
  for (const [name, value] of Object.entries(tokens)) {
    assert.equal(lightTokens[name], value.light, `the light value of ${name} must be official's`);
    if (name in darkTokens) {
      assert.equal(darkTokens[name], value.dark, `the dark value of ${name} must be official's`);
    } else {
      // A token the dark block does not declare is theme-independent in official, so its two
      // captured values must agree — otherwise the dark theme would silently keep the light one.
      assert.equal(
        value.dark,
        value.light,
        `${name} is absent from the dark block, so it must be theme-independent`,
      );
    }
  }
  // Every token that differs between the two themes has to be declared in the dark block.
  for (const [name, value] of Object.entries(tokens)) {
    if (value.light === value.dark) continue;
    assert.ok(
      name in darkTokens,
      `${name} differs between official's themes, so the dark block must declare it`,
    );
  }
  // The scope must not leak into the rest of the app: upstream 0.18's own token set stays intact.
  assert.ok(
    !/^:root/.test(css.trim()) && !/^html\[/.test(css.trim()),
    "the token block must not redefine the app-wide palette",
  );
});

test("official's own light palette agrees with the captured token fixture", (t) => {
  // Official 0.78.1's stylesheet carries the light palette at `:root,.sand-1vbcnu7`. The dark
  // values come from official's runtime theme stylesheet, which is not a file on disk, so only the
  // light column can be cross-checked statically — and only when the analysis tree is present.
  const officialStylesheet = path.resolve(
    import.meta.dirname,
    "../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  );
  if (!existsSync(officialStylesheet)) {
    t.skip("the 0.78.1 extract is not present on this machine");
    return;
  }
  const official = readFileSync(officialStylesheet, "utf8");
  const start = official.indexOf(":root,.sand-1vbcnu7{");
  assert.ok(start > 0, "official's light palette block must be present");
  const body = official.slice(start, official.indexOf("}", start));
  const officialLight = Object.fromEntries(
    [...body.matchAll(/(--sand-[a-z0-9-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]),
  );
  const tokens = JSON.parse(
    read("tests", "fixtures", "official-0781-marketplace-theme-tokens.json"),
  ).tokens;
  for (const [name, value] of Object.entries(tokens)) {
    if (!(name in officialLight)) continue; // the typography metrics are theme-independent
    if (name === "--sand-border-focus-primary") {
      // The one token whose palette value is not what official renders: official forces it to
      // `transparent!important` while keyboard navigation is off. The captured value is the rendered
      // one, so the palette disagreement is expected — but the rule that causes it must be there.
      assert.ok(
        official.includes("--sand-border-focus-primary:transparent!important"),
        "official's keyboard-navigation override must be present",
      );
      continue;
    }
    assert.equal(
      officialLight[name],
      value.light,
      `official's light palette must agree with the captured value of ${name}`,
    );
  }
});

test("every token the ported rules read is declared on the dialog", () => {
  // A `var(--x)` whose target is not declared on the dialog subtree is invalid at computed-value
  // time: the rule falls back to its initial value, so the chip surface renders transparent and
  // the section title loses its size — while every other test stays green. Upstream 0.18 ships an
  // older palette, so "upstream happens to define it" is NOT good enough: the value would be the
  // wrong one (official's `--sand-text-primary` is #f5f5f5, upstream's is #fcfcfc).
  const css = read("scripts", "lib", "marketplace-dialog-0781-theme-tokens.css");
  const declared = new Set([...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  const names = [...appliedClasses()];
  const sources = [officialCss, dialogOfficialCss];
  const assets = path.join(repoRoot, "src", "app", "dist", "renderer", "assets");
  if (existsSync(assets)) {
    const cssFile = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
    if (cssFile) sources.push(readFileSync(path.join(assets, cssFile), "utf8"));
  }
  const referenced = new Set();
  for (const source of sources) {
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!names.some((name) => rule[1].includes("." + name))) continue;
      for (const ref of rule[2].matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) referenced.add(ref[1]);
    }
  }
  assert.ok(referenced.size > 0, "the ported rules must read at least one token");
  const missing = [...referenced].filter((token) => !declared.has(token)).sort();
  assert.deepEqual(
    missing,
    [],
    "these tokens are read by the ported rules but not declared on the dialog, so they resolve to " +
      "an invalid value at computed-value time and the rule renders its initial value",
  );
});

test("official's connected-apps entry moves into the dialog header", () => {
  // Official 0.78.1 stacks three rows: title + connected-apps entry, search + Bot-templates button,
  // chip row. Upstream 0.18 puts the connected-apps entry, the search field, the Bot-templates
  // button and the segmented control into ONE toolbar row, which is why the port's search field
  // measured 146 px against official's 671 px.
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  assert.ok(
    patched.includes('className:"sand-plugins-0781-header"'),
    "the header row must be wrapped so official's connected-apps entry can sit beside the title",
  );
  assert.ok(
    patched.includes("t.jsx(RM0781InstalledEntry,{count:St.length"),
    "official's connected-apps entry must be rendered in the header row",
  );
  assert.ok(
    !patched.includes("Os.Item"),
    "upstream's segmented control must be gone from the toolbar",
  );
  assert.ok(
    patched.includes('className:"sand-plugins-0781-chips"'),
    "the chip row must be its own row, so it needs its own element to take a full line",
  );

  const css = read("scripts", "lib", "marketplace-dialog-0781-layout.css");
  for (const rule of [
    // Row 1: official's title row is the positioned box the entry is pinned into.
    ".sand-plugins-dialog .sand-plugins-0781-header{position:relative}",
    // Upstream's title component keeps its own 32/6/32 px padding; official's row IS the title band.
    ".sand-plugins-dialog .sand-plugins-0781-header>header:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding:0}",
    ".sand-plugins-dialog .sand-plugins-0781-header h2{padding-inline:32px 12px}",
    // Official's entry: position:absolute; top:50%; inset-inline-end:0; translateY(-50%).
    ".sand-plugins-dialog .sand-plugins-0781-header>.sand-plugins__installed-preview{position:absolute;top:50%;inset-inline-end:32px;transform:translateY(-50%)}",
    // Rows 2 and 3 each take a full line, so the search field can fill the row.
    ".sand-plugins-dialog .sand-plugins__bar>div:not(#\\#):not(#\\#):not(#\\#):not(#\\#){flex:1 1 100%}",
    ".sand-plugins-dialog .sand-plugins__bar{flex-wrap:wrap}",
    ".sand-plugins-dialog .sand-plugins__bar:not(#\\#):not(#\\#):not(#\\#){gap:12px}",
    ".sand-plugins-dialog .sand-plugins__bar:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding-top:18px}",
    ".sand-plugins-dialog .sand-plugins:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding-top:52px}",
    ".sand-plugins-dialog .sand-plugins__search:not(#\\#):not(#\\#):not(#\\#):not(#\\#){flex:1 1 auto;padding:0 8px 0 12px;gap:6px}",
    // Official's marketplace view has no filter icon; upstream's button is what shortens the field.
    ".sand-plugins-dialog .sand-plugins__bar>div>button.sand-kit-icon-button:not(#\\#):not(#\\#):not(#\\#):not(#\\#){display:none}",
  ]) {
    assert.ok(css.includes(rule), `the layout rule must be present: ${rule}`);
  }
  assert.ok(
    !/(^|\n)\s*(:root|html|body)\b/.test(css),
    "the layout rules must not leak outside the marketplace dialog",
  );
});

test("every layout rule that overrides an upstream utility class outranks it", (t) => {
  // Upstream 0.18's stylix utility classes raise their own specificity with `:not(#\#)` pseudo-ids,
  // so a class-only author rule LOSES to them. The port's first layout attempt was class-only and
  // lost every time: the header stayed at `flex: 0 0 auto`, the toolbar row stayed at 381 px and the
  // search field at 208 px, while the rules sat in the stylesheet looking applied.
  //
  // This guard compares the specificity of each overriding rule against the upstream rule it has to
  // beat, so the failure mode cannot come back silently.
  const assetsDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
  const sheets = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((name) => /^index-.*\.css$/.test(name))
    : [];
  if (sheets.length === 0) {
    t.skip("the pinned 0.18 stylesheet is not hydrated on this machine");
    return;
  }
  const upstream = readFileSync(path.join(assetsDir, sheets[0]), "utf8");
  const css = read("scripts", "lib", "marketplace-dialog-0781-layout.css");

  // Each upstream utility class, the property it declares, and the ported rule that overrides it.
  const overrides = [
    {
      upstream: "sand-1miatn0",
      property: "padding-top",
      ours: ".sand-plugins-dialog .sand-plugins-0781-header>header:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding:0}",
    },
    {
      upstream: "sand-1tudf5h",
      property: "padding-left",
      ours: ".sand-plugins-dialog .sand-plugins-0781-header>header:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding:0}",
    },
    {
      upstream: "sand-10b6aqq",
      property: "padding-bottom",
      ours: ".sand-plugins-dialog .sand-plugins-0781-header>header:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding:0}",
    },
    {
      upstream: "sand-1c4vz4f",
      property: "flex-grow",
      ours: ".sand-plugins-dialog .sand-plugins__bar>div:not(#\\#):not(#\\#):not(#\\#):not(#\\#){flex:1 1 100%}",
    },
    {
      upstream: "sand-1c4vz4f",
      property: "flex-grow",
      ours: ".sand-plugins-dialog .sand-plugins__search:not(#\\#):not(#\\#):not(#\\#):not(#\\#){flex:1 1 auto;padding:0 8px 0 12px;gap:6px}",
    },
    {
      upstream: "sand-1665zp3",
      property: "gap",
      ours: ".sand-plugins-dialog .sand-plugins__bar:not(#\\#):not(#\\#):not(#\\#){gap:12px}",
    },
    {
      upstream: "sand-1xy6bms",
      property: "padding-top",
      ours: ".sand-plugins-dialog .sand-plugins__bar:not(#\\#):not(#\\#):not(#\\#):not(#\\#){padding-top:18px}",
    },
    {
      upstream: "sand-78zum5",
      property: "display",
      ours: ".sand-plugins-dialog .sand-plugins__bar>div>button.sand-kit-icon-button:not(#\\#):not(#\\#):not(#\\#):not(#\\#){display:none}",
    },
  ];

  const specificity = (selector) => {
    const ids = (selector.match(/:not\(#\\#\)/g) || []).length;
    const rest = selector.replace(/:not\(#\\#\)/g, "");
    const classes = (rest.match(/\.[-_a-zA-Z0-9]+/g) || []).length;
    const types = (rest.match(/(^|[\s>+~])([a-zA-Z][a-zA-Z0-9-]*)/g) || []).length;
    return [ids, classes, types];
  };
  const beats = (a, b) =>
    a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));

  for (const entry of overrides) {
    const upstreamRule = upstream.match(new RegExp(`(\\.${entry.upstream}[^{}]*?)\\{([^}]*)\\}`));
    assert.ok(upstreamRule, `upstream must still declare .${entry.upstream}`);
    assert.ok(
      upstreamRule[2].includes(entry.property),
      `upstream's .${entry.upstream} must still declare ${entry.property}`,
    );
    assert.ok(
      css.includes(entry.ours),
      `the ported rule that overrides .${entry.upstream} must be present: ${entry.ours}`,
    );
    const ours = specificity(entry.ours.slice(0, entry.ours.indexOf("{")));
    const theirs = specificity(upstreamRule[1]);
    assert.ok(
      beats(ours, theirs),
      `the ported rule ${entry.ours} must outrank upstream's .${entry.upstream} ` +
        `(ours ${ours.join(",")} vs upstream ${theirs.join(",")}); otherwise upstream's utility ` +
        `class wins on specificity and the override is a silent no-op`,
    );
  }
});

test("official's section list bleeds 12 px past the pane's padding, and ours does too", (t) => {
  // Official's chip sections sit in a wrapper that pulls them 12 px past the pane's 32 px padding,
  // so official's sections start 21 px from the dialog's edge and measure 858 px in the 900 px
  // dialog. Upstream 0.18's wrapper (`div.sand-plugins__marketplace`) carries no such margin, which
  // left the reconstruction's content column 12 px narrower on each side.
  const officialStylesheet = path.resolve(
    import.meta.dirname,
    "../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  );
  if (!existsSync(officialStylesheet)) {
    t.skip("the 0.78.1 extract is not present on this machine");
    return;
  }
  const official = readFileSync(officialStylesheet, "utf8");
  const rule = official.match(/\.sand-lhcdhu[^{}]*\{([^}]*)\}/);
  assert.ok(rule, "official's section-list wrapper rule must be present");
  assert.match(rule[1], /margin-inline:-12px/, "official's wrapper must pull its sections 12 px outward");
  const css = read("scripts", "lib", "marketplace-dialog-0781-layout.css");
  assert.match(
    css,
    /\.sand-plugins-dialog \.sand-plugins__marketplace\{[^}]*margin-inline:-12px/,
    "the ported wrapper must use official's margin",
  );
});

test("the ported section carries official's gap, not upstream's zero gap", () => {
  // Official's section is `sand-167g77z` (gap:8px) — the 8 px between the section header and its
  // grid. Upstream 0.18's own section class is `sand-xhr3t` (gap:0), which closed that gap.
  const injected = MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE;
  const section = injected.match(/RM0781SectionClasses="([^"]+)"/);
  assert.ok(section, "the port must declare its section class list");
  const classes = section[1].split(/\s+/);
  assert.ok(classes.includes("sand-167g77z"), "official's section carries sand-167g77z");
  assert.ok(!classes.includes("sand-xhr3t"), "upstream's sand-xhr3t (gap:0) must not be used");
  const header = injected.match(/RM0781SectionHeaderClasses="([^"]+)"/);
  assert.ok(header, "the port must declare its section header class list");
  assert.ok(
    header[1].split(/\s+/).includes("sand-euugli"),
    "official's section header carries sand-euugli (min-width:0)",
  );
});

test("official's own cursor font sizes agree with the captured token fixture", (t) => {
  // Official declares the cursor font sizes at `:root,.ui-qruemj`, outside any theme selector.
  // The ported section-title rule (`sand-fc7y3v`) reads `var(--cursor-font-size-lg)`, so a silent
  // change of official's font scale would move the title without failing anything else.
  const officialStylesheet = path.resolve(
    import.meta.dirname,
    "../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  );
  if (!existsSync(officialStylesheet)) {
    t.skip("the 0.78.1 extract is not present on this machine");
    return;
  }
  const official = readFileSync(officialStylesheet, "utf8");
  const start = official.indexOf(":root,.ui-qruemj{");
  assert.ok(start > 0, "official's cursor font-size block must be present");
  const body = official.slice(start, official.indexOf("}", start));
  const officialCursor = Object.fromEntries(
    [...body.matchAll(/(--cursor-font-size-[a-z]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]),
  );
  const tokens = JSON.parse(
    read("tests", "fixtures", "official-0781-marketplace-theme-tokens.json"),
  ).tokens;
  for (const [name, value] of Object.entries(tokens)) {
    if (!name.startsWith("--cursor-font-size-")) continue;
    assert.equal(officialCursor[name], value.light, `official's ${name} must be the captured value`);
    assert.equal(value.dark, value.light, `${name} is theme-independent in official`);
  }
});

test("the dialog renders at official's regular weight, with official's form-control reset", (t) => {
  // Official 0.78.1 resets every form control globally and renders its whole app at
  // `--sand-font-weight-regular` = 425. Upstream 0.18 has the reset only under
  // `.sand-info-pane__inner`, so the dialog's buttons fall back to the browser's 400-weight
  // system font, and upstream's runtime writes 420 where official writes 425.
  const css = read("scripts", "lib", "marketplace-dialog-0781-typography.css");
  const officialDeclarations =
    "font-family:inherit;font-size:var(--sand-font-size-sm);font-weight:inherit;" +
    "line-height:var(--sand-line-height-sm);letter-spacing:var(--sand-letter-spacing-sm);" +
    "font-feature-settings:inherit";
  assert.ok(
    css.includes(`:where(.sand-plugins-dialog) :where(button,input,select,textarea){${officialDeclarations}}`),
    "official's form-control reset must be ported declaration for declaration, with the same " +
      ":where() construction so it keeps official's zero specificity",
  );
  assert.ok(
    css.includes(".sand-plugins-dialog{font-weight:var(--sand-font-weight-regular)}"),
    "the dialog subtree must render at official's regular weight",
  );
  // The scope must stay inside the dialog: the rest of the app keeps upstream 0.18's typography.
  assert.ok(
    !/(^|\n)\s*(:root|html|body)\b/.test(css),
    "the typography rules must not leak outside the marketplace dialog",
  );

  // Cross-check against official's own stylesheet when the 0.78.1 extract is present.
  const officialStylesheet = path.resolve(
    import.meta.dirname,
    "../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  );
  if (!existsSync(officialStylesheet)) {
    t.skip("the 0.78.1 extract is not present on this machine");
    return;
  }
  const official = readFileSync(officialStylesheet, "utf8");
  assert.ok(
    official.includes(`:where(button,input,select,textarea){${officialDeclarations}}`),
    "official's own form-control reset must carry the same declarations",
  );
  assert.ok(
    official.includes(":root{") &&
      /:root\{[^}]*font-weight:var\(--sand-font-weight-regular\)/.test(official),
    "official's :root must set the regular weight",
  );
});

test("the section title is official's own heading recipe, not 0.18's small Text", () => {
  // Official 0.78.1 renders the section title as a plain `h3` with its own class recipe
  // (`sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-1ghz6dp … sand-tyxrsu sand-1rhlpx6`). Upstream
  // 0.18's Text component with `size:"sm"` renders 12px in the tertiary colour instead of
  // official's 14px in the primary colour. Every class of official's recipe already exists in
  // upstream 0.18's stylesheet with the same declaration, so only the markup differs.
  const injected = MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE;
  assert.ok(
    injected.includes(
      'const RM0781SectionTitleClasses="sand-fc7y3v sand-1lvvshy sand-ja3w2a sand-1ghz6dp sand-1y1aw1k sand-f159sx sand-10b6aqq sand-1g0dm76 sand-tyxrsu sand-1rhlpx6"',
    ),
    "the section title must carry official's own class recipe",
  );
  assert.ok(
    injected.includes('t.jsx("h3",{className:RM0781SectionTitleClasses,id:titleId,children:'),
    "the section title must be a plain h3 with official's recipe",
  );
  assert.ok(
    !injected.includes('size:"sm",children:RLocT(label[0],label[1])'),
    "0.18's small Text size must not be used for the section title",
  );
});

test("the port writes no backtick and no double-wrapped locale call", () => {
  const injected = MARKETPLACE_BROWSE_CHROME_0781_INJECTED_SOURCE;
  assert.ok(!injected.includes("`"), "the injected source must not contain a backtick");
  assert.equal(injected.split('"(RLocT(').length - 1, 0, "the injected source must not double-wrap RLocT");
});

test("the port replaces 0.18's segmented control and adds official's chrome", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  assert.ok(!patched.includes("Os.Item"), "0.18's segmented control must be gone");
  assert.ok(patched.includes("RM0781Chips"), "official's chip row must be injected");
  assert.ok(patched.includes("RM0781InstalledEntry"), "official's connected-apps entry must be injected");
  assert.ok(patched.includes("RM0781BotTemplatesButton"), "official's Bot-templates button must be injected");
  assert.ok(patched.includes("RM0781GroupAction"), "official's group action must be injected");
  assert.ok(patched.includes("RM0781RecommendedHero"), "official's recommended hero must be injected");
  assert.ok(patched.includes('"data-marketplace-chips":""'), "official's chip group marker must be there");
  assert.ok(patched.includes("RM0781ChipRow(wt)"), "the chip list must be built from the browse items");
});

test("the chip row's items are a dependency of the toolbar that renders it", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  // Upstream 0.18 renders the whole toolbar (title, search, and the chip row the port injects)
  // inside a React-compiler memo whose dependency list does NOT include the marketplace items.
  // The chip row reads those items, so the memo has to depend on them: without the dependency the
  // toolbar keeps the tree it built on the first render — when the catalogue is still empty — and
  // the chip row never appears, while the sections below it, which are rendered outside the memo,
  // do show every chip. Measured on the deployed build before this fix: 11 sections, zero chips.
  assert.ok(patched.includes("RM0781ChipRow(wt)"), "the chip row must read the browse items");
  const condition = patched.match(/e\[57\]!==Ts[^?]*\?/);
  assert.ok(condition, "the toolbar's memo condition must be present");
  assert.match(condition[0], /\bwt\b/, "the toolbar's memo must depend on the marketplace items");
  const store = patched.match(/e\[57\]=Ts[^;]*e\[66\]=\$e/);
  assert.ok(store, "the toolbar's memo store must be present");
  assert.match(store[0], /\bwt\b/, "the toolbar's memo must store the marketplace items");
});

/**
 * The chip row reads the selected chip for its own pressed state.
 *
 * The toolbar that renders it is memoized, so without the selected chip in the memo's dependency
 * list the chip row keeps the state it had on the first render: the section list below switches
 * to the chosen chip (it is rendered outside the memo) while the chip row keeps aria-pressed on
 * 全部 and the unselected class. Official 0.78.1 moves the pressed state with the selection.
 *
 * Measured on the deployed build before this fix: clicking 效率 switched the sections to 效率 while
 * aria-pressed stayed 全部=true, 效率=false.
 */
function assertChipSelectionDependency(patched) {
  assert.ok(patched.includes("selectedKey:RM0781Chip"), "the chip row must read the selected chip");
  const condition = patched.match(/e\[57\]!==Ts[^?]*\?/);
  assert.ok(condition, "the toolbar's memo condition must be present");
  assert.match(condition[0], /\bRM0781Chip\b/, "the toolbar's memo must depend on the selected chip");
  const store = patched.match(/e\[57\]=Ts[^;]*e\[66\]=\$e/);
  assert.ok(store, "the toolbar's memo store must be present");
  assert.match(store[0], /\bRM0781Chip\b/, "the toolbar's memo must store the selected chip");
}

test("the chip row's selected chip is a dependency of the toolbar that renders it", () => {
  assertChipSelectionDependency(patchMarketplaceBrowseChrome0781(syntheticChunk()));
});

test("mutations: dropping the selected chip dependency fails the chip row's guard", async () => {
  // The mutant has to live inside the repo so the patch module's own relative imports resolve.
  const original = path.join(repoRoot, "scripts/lib/marketplace-browse-chrome-0781-patch.mjs");
  const source = readFileSync(original, "utf8");
  const mutated = source
    .replace("||e[903]!==RM0781Chip?", "?")
    .replace("e[903]=RM0781Chip,", "");
  assert.notEqual(mutated, source, "the mutation must apply");
  const mutantFile = path.join(repoRoot, "scripts/lib/.mutant-0781-chip-selection.mjs");
  writeFileSync(mutantFile, mutated);
  try {
    const mutant = await import(pathToFileURL(mutantFile).href);
    const patched = mutant.patchMarketplaceBrowseChrome0781(syntheticChunk());
    assert.throws(
      () => assertChipSelectionDependency(patched),
      "the guard must fail on a patch that drops the selected chip dependency",
    );
  } finally {
    rmSync(mutantFile, { force: true });
  }
});

test("every Chinese string the port writes is official's own", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  for (const message of Object.values(MARKETPLACE_0781_MESSAGES)) {
    const official = fixture.messages[message.id];
    assert.ok(official != null, `the official fixture is missing ${message.id}`);
    assert.equal(official.zh, message.zh, `official's ${message.id} must be ${message.zh}`);
    assert.equal(official.en, message.en, `official's ${message.id} must be ${message.en}`);
    assert.ok(patched.includes(message.zh), `the port must write official's ${message.zh}`);
  }
  for (const chip of Object.values(MARKETPLACE_0781_MESSAGES)) {
    assert.ok(fixture.messages[chip.id].zh.length > 0, "every message must carry Chinese text");
  }
  // The chip labels come from the frozen registry, which the test reads directly.
  const { RM0781ChipRegistry } = builder();
  for (const chip of Object.values(RM0781ChipRegistry)) {
    const official = fixture.messages[chip.messageId];
    assert.ok(official != null, `the official fixture is missing ${chip.messageId}`);
    assert.equal(official.zh, chip.zh, `official's ${chip.messageId} must be ${chip.zh}`);
    assert.equal(official.en, chip.en, `official's ${chip.messageId} must be ${chip.en}`);
  }
});

test("every class the port applies resolves in upstream 0.18 or in the 0781 official CSS", () => {
  const companion = companionClasses(officialCss);
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
    "these classes have no rule in upstream 0.18's stylesheet and none in the 0781 official CSS, so the port would render unstyled",
  );
});

test("the 0781 official CSS carries the three rules 0.75.8's companion missed", () => {
  for (const name of ["sand-fwqdrz", "sand-8rotk8", "sand-sa7k8x"]) {
    assert.ok(
      officialCss.includes(`.${name}:not(#\\#)`),
      `official's ${name} must be lifted into the 0781 companion CSS`,
    );
  }
  assert.ok(dialogOfficialCss.includes(".sand-1sdb7ul"), "the 900px dialog width must be lifted");
  assert.ok(!dialogOfficialCss.includes(".sand-h6vr4k"), "the 800px dialog width must be gone");
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
  const uncovered = [...appliedClasses()].filter((name) => {
    if (companionClasses(officialCss).has(name)) return false;
    if (STYLIX_NOOP_CLASSES.includes(name)) return false;
    return !new RegExp(`\\.${name}(?![A-Za-z0-9_+-])`).test(css);
  });
  assert.deepEqual(uncovered, [], "these classes resolve nowhere in upstream 0.18 nor in the 0781 official CSS");
});

test("the section builder produces official's fourteen-section shape", () => {
  const { RM0781BuildSections, RM0781ChipRow, RM0781ChipsOf } = builder();
  const entries = catalog();
  const sections = RM0781BuildSections(entries, { isInstalled: () => false, locale: "en" });
  assert.equal(sections[0].sectionKey, "recommended", "为你推荐 must lead the list");
  assert.deepEqual(sections[0].label, ["Recommended for you", "为你推荐"]);
  assert.deepEqual(
    sections.map((section) => section.chipKey),
    [null, "credentials", "productivity", "marketing", "support", "team"],
    "the chip buckets must follow official's chip order, FEATURED must fall out, and the team section closes the list",
  );
  assert.equal(sections[sections.length - 1].sectionKey, "team-plugins", "the team section is last, before any hero");
  const byChip = Object.fromEntries(sections.filter((s) => s.chipKey && s.chipKey !== "team").map((s) => [s.chipKey, s]));
  assert.equal(byChip.credentials.hiddenCount, 0, "one entry is never truncated");
  assert.equal(byChip.productivity.hiddenCount, 8 - MARKETPLACE_0781_SECTION_LIMIT);
  assert.equal(byChip.marketing.hiddenCount, 0, "four entries are never truncated");
  assert.equal(byChip.support.hiddenCount, 0, "two entries are never truncated");
  assert.equal(
    sections[0].hiddenCount,
    sections[0].items.length - MARKETPLACE_0781_SECTION_LIMIT,
    "the recommended section is truncated at the preview limit too",
  );
  assert.equal(sections[0].items.length, catalog().length, "every non-installed entry is recommendable");
});

test("an installed plugin gives official's affinity signal", () => {
  const { RM0781BuildSections } = builder();
  const entries = catalog();
  const sections = RM0781BuildSections(entries, {
    isInstalled: (entry) => entry.id === "p0",
    locale: "en",
  });
  const recommended = sections[0].items.map((entry) => entry.id);
  assert.ok(recommended.includes("p1"), "the other productivity entries share the installed one's category");
  assert.ok(!recommended.includes("p0"), "an installed entry is never recommended to itself");
  assert.ok(!recommended.includes("s0"), "a support entry shares no category with the installed one");
});

test("selecting a chip renders that chip's full list and drops the group action", () => {
  const { RM0781BuildSections } = builder();
  const sections = RM0781BuildSections(catalog(), {
    selectedChip: "productivity",
    isInstalled: () => false,
    locale: "en",
  });
  assert.equal(sections.length, 1, "a selected chip renders one section");
  assert.equal(sections[0].chipKey, "productivity");
  assert.equal(sections[0].hiddenCount, 0, "a selected chip is not truncated");
  assert.equal(sections[0].items.length, 8, "a selected chip shows every entry it holds");
});

test("the recommended hero is appended at the end and keeps the chip selection", () => {
  const { RM0781BuildSections } = builder();
  const sections = RM0781BuildSections(catalog(), {
    recommendedHero: true,
    isInstalled: () => false,
    locale: "en",
  });
  const hero = sections[sections.length - 1];
  assert.equal(hero.sectionKey, "recommended-hero");
  assert.equal(hero.hiddenCount, 0, "the hero is never truncated");
  assert.equal(hero.items.length, sections[0].items.length, "the hero holds every recommended entry");
  assert.ok(sections.length > 1, "the original sections stay in front of the hero");
});

test("the marketplace-published entries render official's team section after the chip sections", () => {
  const { RM0781BuildSections } = builder();
  const sections = RM0781BuildSections(catalog(), { isInstalled: () => false, locale: "en" });
  const team = sections.find((section) => section.sectionKey === "team-plugins");
  assert.ok(team, "official's 团队插件 section must render when the catalogue carries marketplace entries");
  assert.deepEqual(team.label, ["Team plugins", "团队插件"], "official's own section title");
  assert.deepEqual(
    team.items.map((entry) => entry.id),
    ["mp"],
    "the team section holds exactly the marketplace-published entries",
  );
  assert.equal(team.hiddenCount, 0, "a small team list is not truncated");
  const lastChip = sections.reduce(
    (index, section, at) => (section.chipKey != null && section.sectionKey.startsWith("chip:") ? at : index),
    -1,
  );
  assert.ok(sections.indexOf(team) > lastChip, "the team section follows the chip sections, official's own order");
});

test("the team section orders entries by teammate count, official's own sort", () => {
  const { RM0781BuildSections } = builder();
  const entries = [
    { id: "t2", name: "B", displayName: "B", category: "MCP", categoryKey: "PRODUCTIVITY", marketplace: { name: "x" } },
    { id: "t1", name: "A", displayName: "A", category: "MCP", categoryKey: "PRODUCTIVITY", marketplace: { name: "x" } },
  ];
  const sections = RM0781BuildSections(entries, {
    isInstalled: () => false,
    teamInstallCounts: { t1: 3, t2: 7 },
    locale: "en",
  });
  const team = sections.find((section) => section.sectionKey === "team-plugins");
  assert.deepEqual(
    team.items.map((entry) => entry.id),
    ["t2", "t1"],
    "teammate count descending, displayName localeCompare as the tie-break",
  );
});

test("a catalogue without marketplace entries renders no team section", () => {
  const { RM0781BuildSections } = builder();
  const sections = RM0781BuildSections(catalog().filter((entry) => entry.marketplace == null), {
    isInstalled: () => false,
    locale: "en",
  });
  assert.ok(!sections.some((section) => section.sectionKey === "team-plugins"));
});

test("the chip row lists official's chips and skips marketplace-published entries", () => {
  const { RM0781ChipRow, RM0781ChipsOf } = builder();
  const entries = catalog();
  assert.deepEqual(
    RM0781ChipRow(entries).map((chip) => chip.key),
    ["credentials", "productivity", "marketing", "support"],
    "the chip row lists the chips the browse items carry, in official's order",
  );
  assert.deepEqual(RM0781ChipsOf(entries[0]), ["credentials"]);
  assert.deepEqual(RM0781ChipsOf(entries[entries.length - 1]), ["productivity"]);
  assert.equal(MARKETPLACE_0781_CHIP_ORDER.length, 11, "official 0.78.1 has eleven chips");
});

/** The bracket balance of a code fragment, ignoring anything inside a string literal. */
function bracketBalance(source) {
  const opens = { "(": 0, "{": 0, "[": 0 };
  const closes = { ")": 0, "}": 0, "]": 0 };
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch in opens) opens[ch] += 1;
    else if (ch in closes) closes[ch] += 1;
  }
  return { parens: opens["("] - closes[")"], braces: opens["{"] - closes["}"], brackets: opens["["] - closes["]"] };
}

test("every replacement keeps its anchor's bracket balance", () => {
  for (const entry of MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS) {
    const before = bracketBalance(entry.before);
    const after = bracketBalance(entry.after);
    assert.deepEqual(
      after,
      before,
      `"${entry.label}" must not change the bracket balance of the code it replaces`,
    );
  }
});

test("the Bot-templates button carries official's idle mark frame as its first child", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  assert.ok(patched.includes(botMarkFrame.pathD), "official's own mark path bytes must be embedded");
  assert.ok(patched.includes(botMarkFrame.svgId), "official's own svg id");
  assert.ok(patched.includes(botMarkFrame.viewBox), "official's own viewBox");
  assert.ok(patched.includes(botMarkFrame.pathFill), "official's own ink fill");
  assert.ok(patched.includes('fillRule:"evenodd"'), "official's own fill rule");
  assert.ok(patched.includes('"data-grok-state":"idle"'), "official's idle state marker");
  assert.ok(patched.includes('"data-paused":"true"'), "the button's mark is paused, exactly as official renders it");
  const buttonSource = patched.slice(patched.indexOf("function RM0781BotTemplatesButton"));
  const markAt = buttonSource.indexOf("t.jsx(RM0781BotMark,{})");
  const labelAt = buttonSource.indexOf('RLocT("Bot templates","Bot 模板")');
  assert.ok(markAt >= 0 && labelAt >= 0 && markAt < labelAt, "the mark precedes the label, official's own child order");
});

test("the native rows carry official's brand icons, not the first-letter chip", () => {
  const patched = patchMarketplaceBrowseChrome0781(syntheticChunk());
  assert.ok(patched.includes(nativeIconFrame.onepassword.pathD), "official's 1Password brand path bytes");
  assert.ok(patched.includes(nativeIconFrame.onepassword.spanClass), "official's icon class recipe");
  assert.ok(patched.includes("#303136"), "official's 1Password brand background");
  assert.ok(patched.includes("var(--sand-bg-magenta-primary)"), "official's email background token");
  assert.ok(patched.includes('name:"envelope"'), "official's email glyph");
  assert.ok(
    patched.includes("RM0781NativeIcon(s)??t.jsx(m,"),
    "the row renders the native icon first and falls back to upstream's icon slot",
  );
});

test("the patched upstream chunk parses", () => {
  const chunkPath = path.join(repoRoot, "src", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(chunkPath)) return; // upstream's payload only exists after npm run bootstrap
  const pristine = readFileSync(chunkPath, "utf8");
  const entry = EXTRA_I18N_FILES.find((file) => file.file === "view-B5Ug8wEm.js");
  assert.ok(entry != null, "the extra-i18n pass must own the plugins chunk");
  const localised = patchExtraFile(pristine, entry).patched;
  const worded = patchMarketplaceOfficialWording(localised);
  const patched = patchMarketplaceBrowseChrome0781(worded);
  assert.doesNotThrow(
    () => parse(patched, { ecmaVersion: "latest", sourceType: "module" }),
    "the patched plugins chunk must parse as a module",
  );
  assert.equal(patched.split('"(RLocT(').length - 1, 0, "the patched chunk must not double-wrap RLocT");
  assert.ok(patched.includes("RM0781BuildSections"), "the patched chunk must carry the ported browse page");
});

test("the staged chunk carries the ported browse page", () => {
  const staged = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(staged)) return; // the staged chunk only exists after a build
  const chunk = readFileSync(staged, "utf8");
  const ported = chunk.includes("RM0781BuildSections");
  assert.equal(ported, chunk.includes("RM0781RecommendedHero"), "the ported components must land together");
  if (ported) {
    assert.ok(!chunk.includes("Os.Item"), "0.18's segmented control must be gone from the ported chunk");
    assert.ok(chunk.includes("在应用和技能中搜索"), "the ported chunk must carry official's search placeholder");
    assert.equal(chunk.split('"(RLocT(').length - 1, 0, "the ported chunk must not double-wrap RLocT");
  }
});
