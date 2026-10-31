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
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
  MARKETPLACE_DETAIL_VIEW_0781_CATEGORIES,
  MARKETPLACE_DETAIL_VIEW_0781_INJECTED_SOURCE,
  MARKETPLACE_DETAIL_VIEW_0781_MESSAGES,
  MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS,
  patchMarketplaceDetailView0781,
} from "../scripts/lib/marketplace-detail-view-0781-patch.mjs";
import { MARKETPLACE_BROWSE_CHROME_0781_REPLACEMENTS } from "../scripts/lib/marketplace-browse-chrome-0781-patch.mjs";
import { findDomChildrenInThirdArgument } from "../scripts/lib/marketplace-jsx-children.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const fixture = JSON.parse(read("tests", "fixtures", "official-0781-detail-view-messages.json"));
const detailCss = read("scripts", "lib", "marketplace-detail-view-0781-official.css");
const browseCss = read("scripts", "lib", "marketplace-browse-chrome-0781-official.css");
const layoutCss = read("scripts", "lib", "marketplace-dialog-0781-layout.css");

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
];

/**
 * The classes the port applies that official 0.78.1 itself gives no rule to.
 *
 * They are stylix namespace markers (`sand-kit-button`, `sand-kit-icon`, …), so they carry no
 * style on either side.
 */
const STYLIX_NOOP_CLASSES = ["sand-kit-button", "sand-kit-icon", "sand-kit-icon-button", "sand-settings-detail-bar"];

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

/** A chunk that contains every anchor exactly once (the anchors are fragments, so this is text). */
function syntheticChunk() {
  let source = "const Os=1,Re=2,ue=3,C=4,t=5,k=6,RLocT=7,Pl=8,nt=9,qn={};\n";
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) source += `/*${entry.label}*/${entry.before}\n`;
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

test("every anchor is replaced exactly once", () => {
  const source = syntheticChunk();
  for (const entry of MARKETPLACE_DETAIL_VIEW_0781_REPLACEMENTS) {
    const hits = source.split(entry.before).length - 1;
    assert.equal(hits, 1, `the anchor for "${entry.label}" must appear exactly once`);
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
  ]);
  for (const name of ["sand-1xr8qbc", "sand-jodmca", "sand-1pic42t", "sand-1onr9mi", "sand-2fvf9", "sand-p4054r", "sand-1lziwak"]) {
    assert.ok(companion.has(name), `official's ${name} must be lifted into a companion CSS`);
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
