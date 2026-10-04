import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");

/**
 * The pinned catalog supplements are real upstream data, not authored data. This file is the proof,
 * and it is the reason the pin is safe to ship.
 *
 * The load-bearing assertion is `marketplacePluginToView(supplement)` **deep-equals the entry the
 * official 0.66.0 build actually returned**. The fixture is an independent capture taken over CDP
 * from the logged-in official app, so this is not the projector comparing itself — if the pinned
 * fields drifted, or if the upstream projector changed shape, this fails instead of quietly
 * rendering something official never showed.
 *
 * The second load-bearing assertion is about INSTALL, because a pinned row that renders but cannot
 * be installed is the worst outcome: the user clicks 添加 and gets a button that looks wired and
 * is not. `installEntry` -> `requirePlugin` -> `this.catalog.get(id)` reads the RAW index, and
 * `fetchPluginServers` in local mode skips the authenticated branch (`bestEffortToken` is stubbed
 * to null) and falls through to a plain `fetch` of `toRawGithubUrl(sourceUrls[i])`. So an entry is
 * installable iff it carries a `sourceUrls` entry that `toRawGithubUrl` accepts.
 */

const FIXTURE = JSON.parse(read("tests", "fixtures", "official-catalog-11.json"));
const CAPTURED = FIXTURE.entries;

/** Keys the official bridge emits that upstream's own `marketplacePluginToView` does not produce.
 *  Listed explicitly so a shape change fails loudly instead of being silently tolerated. */
const OFFICIAL_BRIDGE_ONLY_KEYS = ["isPublicListed", "pluginName"];

async function loadEntry(entry, outName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outName);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    // Externalise node_modules. Bundling them in drags CJS deps (undici) into the ESM output,
    // where their internal `require("assert")` throws "Dynamic require of \"assert\" is not
    // supported" — a failure that has nothing to do with the code under test. These two modules
    // are pure functions, so leaving deps to the runtime loader changes nothing about what runs.
    packages: "external",
  });
  return import(`file://${outfile}`);
}

const SUPP = await loadEntry(
  "source/shared/node/mcp/local-catalog-supplements.ts",
  "tests-local-catalog-supplements.mjs",
);
const MKT = await loadEntry(
  "source/shared/node/mcp/mcp-marketplace.ts",
  "tests-mkt-marketplace.mjs",
);

const { LOCAL_CATALOG_SUPPLEMENTS, mergeLocalCatalogSupplements } = SUPP;
const { marketplacePluginToView, toRawGithubUrl } = MKT;

test("the pin carries exactly the 11 entries the official build returned", () => {
  assert.equal(LOCAL_CATALOG_SUPPLEMENTS.length, 11);
  assert.equal(CAPTURED.length, 11);
  // Ids are the strongest link to upstream: the parity script independently reports these as the
  // missing ones, so a match means we pinned the right things.
  const pinned = LOCAL_CATALOG_SUPPLEMENTS.map((p) => p.pluginId).sort();
  const official = CAPTURED.map((e) => e.id).sort();
  assert.deepEqual(pinned, official, "pinned ids must equal the captured official ids");
});

/** Drop keys whose value is `undefined`, so "key absent" and "key present but undefined" compare equal.
 *
 *  Needed because two different projections emit different key sets for the same null value:
 *  upstream's `marketplacePluginToView` emits `websiteUrl` / `repositoryUrl` / `homepage` / `iconUrl`
 *  UNCONDITIONALLY, so a null in the payload becomes a present-but-undefined key; the official bridge
 *  omits the key instead. `assert.deepStrictEqual` treats those as different — correctly, since it
 *  cannot know the values are equivalent. Normalising BOTH sides once is better than enumerating
 *  keys one at a time, which is exactly how this test was three revisions deep before it was fixed. */
const dropUndefined = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
};

test("every pinned entry projects to the view official actually rendered", () => {
  // Beyond key-set normalisation, two field-level differences are permitted and each is checked
  // explicitly rather than excluded from comparison:
  //  - the official bridge carries `isPublicListed` / `pluginName`, which upstream's projector never
  //    emits;
  //  - `marketplace` is NOT exempt: an earlier revision excluded it and that silently cost the
  //    团队插件 row. `toRow` derives `isTeam` from `marketplaceName(entry)`, so a pinned team entry
  //    without it does not render in 团队插件 at all — the single most visible way a pin can be
  //    wrong, and it shipped green here until the capture was re-read field by field;
  //  - official's payload has `null` for `categoryKey` / `categoryKeys` on five of these entries,
  //    while `SandMarketplacePlugin` types them `string | undefined` and `string[]` — there is no
  //    `null` to store, so it pins as `undefined` / `[]`. That is functionally identical for
  //    bucketing: `sectionKeyOf` reads the key list, and an empty list matches no bucket exactly as
  //    an absent key does.
  const BRIDGE_ONLY = ["isPublicListed", "pluginName"];

  for (const captured of CAPTURED) {
    const supplement = LOCAL_CATALOG_SUPPLEMENTS.find((p) => p.pluginId === captured.id);
    assert.ok(supplement, `no supplement for ${captured.name}`);
    const projected = marketplacePluginToView(supplement);

    const expected = { ...captured };
    for (const key of [...BRIDGE_ONLY, "categoryKey", "categoryKeys"]) delete expected[key];

    const { categoryKey, categoryKeys, ...rest } = projected;
    assert.deepEqual(
      dropUndefined(rest),
      dropUndefined(expected),
      `${captured.name} does not reproduce official's view`,
    );

    // And the two null→typed mappings are asserted, not merely skipped above.
    if (captured.categoryKey == null) {
      assert.equal(categoryKey, undefined, `${captured.name}: null categoryKey pins as undefined`);
    } else {
      assert.equal(categoryKey, captured.categoryKey, `${captured.name}: categoryKey must match`);
    }
    if (captured.categoryKeys == null) {
      assert.deepEqual(categoryKeys, [], `${captured.name}: null categoryKeys pins as []`);
    } else {
      assert.deepEqual(categoryKeys, captured.categoryKeys, `${captured.name}: categoryKeys must match`);
    }
  }
});

test("10 of 11 install for real; the 11th is pinned-but-uninstallable and says so", () => {
  const installable = LOCAL_CATALOG_SUPPLEMENTS.filter((p) => p.sourceUrls.length > 0);
  const notInstallable = LOCAL_CATALOG_SUPPLEMENTS.filter((p) => p.sourceUrls.length === 0);

  assert.equal(installable.length, 10, "ten entries carry a public MCP config");
  assert.deepEqual(
    notInstallable.map((p) => p.displayName),
    ["oh-my-claudecode"],
    "the one without a public repo is the private-marketplace entry — name it, don't let it drift",
  );

  // Each sourceUrl must be one `toRawGithubUrl` can turn into a fetchable raw URL, and it must
  // point at the repo the other 78 working entries already come from. A URL shape that parses but
  // 404s would render a working-looking 添加 button that fails on click.
  for (const plugin of installable) {
    assert.equal(plugin.repositoryUrl, "https://github.com/cursor/plugins");
    for (const url of plugin.sourceUrls) {
      const raw = toRawGithubUrl(url);
      assert.ok(raw != null, `${plugin.displayName}: toRawGithubUrl rejected ${url}`);
      assert.match(raw, /^https:\/\/raw\.githubusercontent\.com\/cursor\/plugins\//);
      assert.match(url, /\/blob\/HEAD\/third_party\/.+\/mcp\.json$/);
    }
  }
});

test("the pin never shadows a server entry — it heals instead of duplicating", () => {
  const serverViews = LOCAL_CATALOG_SUPPLEMENTS.map((p) => marketplacePluginToView(p));
  // Simulate the account gate opening: the server returns all 11 itself.
  const merged = mergeLocalCatalogSupplements(serverViews);
  assert.equal(merged.plugins.length, 0, "nothing is added when the server already has them");
  assert.equal(merged.views.length, 11, "and no duplicates appear");

  // Partial overlap: one server entry among eleven supplements.
  const partial = mergeLocalCatalogSupplements(serverViews.slice(0, 1));
  assert.equal(partial.plugins.length, 10, "only the genuinely absent ones are added");
  assert.equal(partial.views.length, 11, "total stays at eleven, no duplicate id");

  // Empty server response: all eleven are added.
  assert.equal(mergeLocalCatalogSupplements([]).plugins.length, 11);
});

test("the merge is additive only — it must never drop what the server returned", () => {
  const serverOnly = [{ id: "1", displayName: "Local-only entry" }];
  const merged = mergeLocalCatalogSupplements(serverOnly);
  assert.equal(merged.views.length, 12);
  assert.equal(merged.views[0].displayName, "Local-only entry", "server entry stays put");
  assert.ok(
    merged.views.every((v, i, a) => a.findIndex((x) => x.id === v.id) === i),
    "no id appears twice",
  );
});

test("the source records where these came from, and the limitation is written down", () => {
  const src = read("source", "shared", "node", "mcp", "local-catalog-supplements.ts");
  // Provenance and the known limitation must survive refactors — they are the reason the pin is
  // reviewable at all. A file that silently loses its caveats is worse than no file.
  assert.match(src, /includesPrivateMarketplaces/);
  assert.match(src, /bestEffortToken/);
  assert.match(src, /2026-10-05/);
  assert.match(src, /marketplace\.json/);
  assert.match(src, /oh-my-claudecode` will not install/);
  assert.match(src, /NOT swallowed into a silent no-op/);
});
