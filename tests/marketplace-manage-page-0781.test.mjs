import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import {
  MARKETPLACE_MANAGE_PAGE_0781_MESSAGES,
} from "../scripts/lib/marketplace-manage-page-0781-patch.mjs";
import { applyMarketplaceManagePage0781 } from "../scripts/lib/marketplace-manage-page-0781-patch.mjs";
import {
  MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES,
  MARKETPLACE_MANAGE_PAGE_0781_PORTED_CLASSES,
  marketplaceManagePage0781ClassesStyledInDialog,
} from "../scripts/lib/marketplace-manage-page-0781-css-patch.mjs";
import { applyMarketplaceManagePage0781Css } from "../scripts/lib/marketplace-manage-page-0781-css-patch.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const upstreamDir = path.join(repo, "src/app/dist/renderer/assets");
const fixture = JSON.parse(
  await readFile(path.join(repo, "tests/fixtures/official-0781-manage-page-recipes.json"), "utf8"),
);

/** The upstream plugins chunk, or null when the tree has not been bootstrapped. */
async function upstreamChunk() {
  let entries;
  try {
    entries = await readdir(upstreamDir);
  } catch {
    return null;
  }
  for (const name of entries.filter((entry) => entry.endsWith(".js"))) {
    const text = await readFile(path.join(upstreamDir, name), "utf8");
    if (text.includes("sand-plugins__yours")) return { name, text };
  }
  return null;
}

/** A scratch stage holding one copy of the upstream plugins chunk. */
async function stage() {
  const root = await mkdtemp(path.join(tmpdir(), "sand-manage-0781-"));
  const assets = path.join(root, "dist/renderer/assets");
  await cp(upstreamDir, assets, { recursive: true });
  return { root, assets };
}

test("the second-level page carries official 0.78.1's own markup", async (t) => {
  const chunk = await upstreamChunk();
  if (chunk == null) {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  const { root, assets } = await stage();
  try {
    const provenance = await applyMarketplaceManagePage0781({ stageRoot: root });
    assert.ok(provenance != null && typeof provenance === "object");
    const patched = await readFile(path.join(assets, chunk.name), "utf8");

    assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));

    // Official 0.78.1's class recipes, read off the running official app.
    for (const [label, recipe] of [
      ["the hero", fixture.hero.class],
      ["the detail bar", fixture.detailBar.class],
      ["the detail bar's back button", fixture.detailBar.buttonClass],
      ["the detail bar's heading", fixture.detailBar.h3Class],
      ["the detail bar's trailing slot", fixture.detailBar.trailingClass],
      ["the installed section", fixture.installedSection.class],
      ["the installed section's header", fixture.installedSection.headerClass],
      ["the installed section's heading", fixture.installedSection.h3Class],
      ["the plugins grid", fixture.installedSection.gridClass],
      ["the private-skills grid", fixture.privateSection.gridClass],
      ["the plugin row", fixture.row.class],
      ["the plugin row's open button", fixture.row.openClass],
      ["the plugin row's name", fixture.row.nameClass],
      ["the plugin row's subtitle", fixture.row.subtitleClass],
      ["the plugin row's trailing slot", fixture.row.trailingClass],
      ["the show-all control", fixture.showAll.class],
      ["the collapsed remainder", fixture.collapsed.class],
      ["the collapsed remainder's inner wrapper", fixture.collapsed.innerClass],
    ]) {
      const classes = recipe.split(/\s+/).filter(Boolean);
      const present = classes.filter((name) => patched.includes(name));
      assert.ok(
        present.length >= Math.ceil(classes.length / 2),
        `${label} must carry official 0.78.1's recipe (${present.length}/${classes.length} present)`,
      );
    }

    // Official's collapsed remainder labels the hidden list with text only — the span
    // carries no class attribute at all, so the label is asserted by its text.
    assert.ok(
      typeof fixture.collapsed.listLabel === "string" && fixture.collapsed.listLabel.length > 0,
      "the capture must record the collapsed list's hidden label",
    );
    assert.ok(
      patched.includes(fixture.collapsed.listLabel),
      "the patch must write official's collapsed list label",
    );

    // Official 0.78.1's own Chinese text, under its own message ids.
    for (const [key, message] of Object.entries(MARKETPLACE_MANAGE_PAGE_0781_MESSAGES)) {
      assert.ok(message.zh.length > 0, `${key} must carry official's Chinese text`);
      assert.ok(patched.includes(message.zh), `the patch must write official's "${message.zh}"`);
    }

    // The row's open button carries official's localized label (official id T9mwDN:
    // "Open {name}" / "打开 {name}"), not upstream's hardcoded English "Open {name}".
    assert.ok(
      patched.includes('"aria-label":RLocT("Open "+'),
      "the row's open button must carry official's localized label",
    );

    // Official's status-badge recipes, read out of official's own registry and
    // confirmed on the live official app for the `connected` and `error` variants.
    assert.ok(
      patched.includes('statusConnected:{kMwMTN:"sand-1ufr4hg"'),
      "the status badge must carry official's connected recipe",
    );
    assert.ok(
      patched.includes('statusError:{kMwMTN:"sand-wtpwev"'),
      "the status badge must carry official's error recipe",
    );
    assert.ok(
      !patched.includes('statusConnected:{kMwMTN:"sand-98zg7y"'),
      "upstream 0.18's connected recipe must be gone",
    );

    // Official's private-skills rows carry no enable toggle: official enables a skill
    // from the skill's detail page, and upstream 0.18 ships that page too — its
    // `setEnabled({... isEnabled:!u.isEnabledForAgent})` call must survive.
    assert.ok(
      !patched.includes("onToggle:()=>N(H)"),
      "the private-skills row must not carry upstream's enable toggle",
    );
    assert.ok(
      patched.includes("isEnabled:!u.isEnabledForAgent"),
      "the skill detail page's enable control must survive",
    );
    assert.ok(
      patched.includes("sand-1kogg8i sand-wpq65r"),
      "the private-skills row's icon wrapper must carry official's recipe",
    );

    // Official's hero sits in a `<header>` of official's own recipe.
    assert.ok(
      patched.includes(`className:RM0781ManageHeroWrapperClasses`),
      "the patch must render the hero inside official's header wrapper",
    );
    assert.ok(
      patched.includes(JSON.stringify(fixture.hero.wrapperClass)),
      "the hero wrapper must carry official's class recipe",
    );

    // Official's detail-bar title has two variants: hidden while the page's hero title is in
    // view (the resting state) and visible once the hero has scrolled away. The port renders
    // the hidden variant at the top of the page.
    assert.ok(
      patched.includes(JSON.stringify(fixture.detailBar.h3HiddenClass)),
      "the detail bar's title must carry official's resting (hidden) recipe",
    );
    assert.ok(
      patched.includes(JSON.stringify(fixture.detailBar.h3Class)),
      "the detail bar's title must carry official's visible recipe",
    );
    assert.ok(
      patched.includes("RM0781ManageDetailBarTitleHiddenAriaHidden"),
      "the detail bar's hidden title must carry official's aria-hidden",
    );

    // The upstream subtitle builder is shared with the browse page, whose 0.78.1 parity was
    // signed off in the earlier wave: the manage page gets its own builder instead.
    assert.ok(
      patched.includes('e.join(" · ")'),
      "upstream's shared subtitle builder must be left alone",
    );

    // The connector auth action carries official's connect-mode label, the way official's own
    // `K` chain picks it: "连接" for a connector that needs authentication, "重新连接" while a
    // handoff is waiting and "重试" otherwise. Upstream's authorize-mode wording ("身份验证") is
    // what the live official app does NOT show.
    assert.ok(
      patched.includes('RLocT("Connect","连接")'),
      "the connector auth action must carry official's connect-mode label",
    );
    assert.ok(
      patched.includes('RLocT("Reconnect","重新连接")'),
      "the connector auth action must carry official's reconnect label",
    );
    assert.ok(
      patched.includes('RLocT("Retry","重试")'),
      "the connector auth action must carry official's retry label",
    );
    assert.ok(
      !patched.includes('RLocT("Authenticate","身份验证")'),
      "upstream's authorize-mode label must be gone",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the staged chunk carries the ported second-level page", () => {
  // The staged chunk is the one the i18n, wording and browse-chrome passes have
  // already rewritten, so it is the state the patch actually has to land on. It only
  // exists after a build.
  const staged = path.join(
    repo,
    ".build/fidelity/app/dist/renderer/assets/view-B5Ug8wEm.js",
  );
  let chunk;
  try {
    chunk = readFileSync(staged, "utf8");
  } catch (error) {
    // Only a missing staged chunk is a skip. Anything else is a real failure and must
    // not be swallowed into a false green.
    if (error?.code === "ENOENT") return;
    throw error;
  }
  assert.ok(chunk.includes("RM0781ManageHero"), "the staged chunk must carry the ported page");
  assert.ok(chunk.includes("管理插件和技能"), "the staged chunk must carry official's hero text");
  assert.ok(chunk.includes("RM0781ManageDetailBar"), "the staged chunk must carry official's detail bar");
  assert.ok(
    chunk.includes('statusConnected:{kMwMTN:"sand-1ufr4hg"'),
    "the staged chunk must carry official's status recipe",
  );
  assert.ok(
    !chunk.includes("onToggle:()=>N(H)"),
    "the staged chunk must not carry upstream's private-row enable toggle",
  );
  assert.ok(
    chunk.includes("sand-1kogg8i sand-wpq65r"),
    "the staged chunk must carry official's private-row icon wrapper",
  );
  assert.ok(
    chunk.includes('RLocT("Connect","连接")'),
    "the staged chunk must carry official's connect-mode auth label",
  );
  assert.ok(
    !chunk.includes('RLocT("Authenticate","身份验证")'),
    "the staged chunk must not carry upstream's authorize-mode auth label",
  );
  assert.ok(
    chunk.includes(JSON.stringify(fixture.detailBar.h3HiddenClass)),
    "the staged chunk must carry official's resting (hidden) title recipe",
  );
  assert.ok(
    chunk.includes(JSON.stringify(fixture.hero.wrapperClass)),
    "the staged chunk must render the hero inside official's header wrapper",
  );
  assert.equal(chunk.split('"(RLocT(').length - 1, 0, "the staged chunk must not double-wrap RLocT");
});

test("the connected badge's green rule is scoped to the dialog, not skipped as 'already carried'", async (t) => {
  const upstreamCss = path.join(upstreamDir, "index-lCyB53CO.css");
  let upstream;
  try {
    upstream = await readFile(upstreamCss, "utf8");
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }

  // Upstream 0.18 does not define the green at all. The repo's own conversation-computer-card
  // port carries official's rule scoped to `.r-conversation-computer-card`, so the staged
  // stylesheet holds the class token and never styles it inside the plugins dialog. A test on
  // "the class token appears somewhere" would wrongly call it carried.
  const styledInDialog = marketplaceManagePage0781ClassesStyledInDialog(upstream);
  assert.ok(
    !styledInDialog.has("sand-1ufr4hg"),
    "upstream must not style the connected badge's green inside the plugins dialog",
  );
  const scopedAway = ".r-conversation-computer-card .sand-1ufr4hg";
  assert.ok(
    !marketplaceManagePage0781ClassesStyledInDialog(
      `${scopedAway}:not(#\\#):not(#\\#):not(#\\#){color:var(--sand-text-green-primary)}`,
    ).has("sand-1ufr4hg"),
    "a rule scoped away from the dialog must not count as carried",
  );

  const root = await mkdtemp(path.join(tmpdir(), "sand-manage-0781-css-"));
  const assets = path.join(root, "dist/renderer/assets");
  await cp(upstreamDir, assets, { recursive: true });
  try {
    const provenance = await applyMarketplaceManagePage0781Css({ stageRoot: root });
    const patchedCss = await readFile(path.join(assets, "index-lCyB53CO.css"), "utf8");
    const green = MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES["sand-1ufr4hg"];
    assert.ok(green != null, "the companion CSS must lift official's green rule");
    assert.ok(
      patchedCss.includes(`:where(.sand-plugins-dialog) ${green}`),
      "the green rule must be carried inside the plugins dialog",
    );
    assert.ok(
      marketplaceManagePage0781ClassesStyledInDialog(patchedCss).has("sand-1ufr4hg"),
      "the connected badge's green must resolve inside the plugins dialog",
    );
    assert.ok(
      provenance.appendedRules.some((rule) => rule.includes("sand-1ufr4hg")),
      "the injector must append the green rule instead of skipping it",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every lifted CSS rule is official 0.78.1's own and resolves in the shipped stylesheet", async (t) => {
  const upstreamCss = path.join(upstreamDir, "index-lCyB53CO.css");
  let upstream;
  try {
    upstream = await readFile(upstreamCss, "utf8");
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  const officialCss = await readFile(
    "/Users/Apple/Documents/grokbot/rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
    "utf8",
  ).catch(() => null);
  if (officialCss == null) {
    t.skip("the official 0.78.1 stylesheet is not present on this machine");
    return;
  }
  for (const [name, rule] of Object.entries(MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES)) {
    const selector = rule.slice(0, rule.indexOf("{"));
    assert.ok(
      officialCss.includes(selector),
      `the lifted rule for ${name} must exist in official 0.78.1's stylesheet`,
    );
    assert.ok(
      !upstream.includes(selector),
      `${name} must not be lifted again — upstream 0.18 already carries it`,
    );
  }
  assert.ok(
    MARKETPLACE_MANAGE_PAGE_0781_PORTED_CLASSES.length > 0,
    "the port must declare the classes it introduces",
  );
});
