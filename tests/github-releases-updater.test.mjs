import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Behavioral + wiring guards for the reconstructed GitHub Releases updater.
//
// Why a mirror instead of importing the TS module: source/*.ts is typechecked
// via `npm run source:typecheck` (tsc, unavailable in dependency-free sandboxes)
// and cannot be imported by plain `node --test`. The pure mapping algorithm is
// therefore mirrored here in dependency-free JS, while every piece of DATA
// (repo, URLs, asset patterns) is extracted live from the TS source so pattern
// drift fails fast. Keep this file in sync with
// `source/electron-main/update/github-update-feed.ts`.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const feedTs = () => read("source/electron-main/update/github-update-feed.ts");
const serviceTs = () => read("source/electron-main/update/sand-update-service.ts");

function extractConstString(source, name) {
  const m = source.match(new RegExp(`export const ${name} = "([^"]+)"`));
  assert.ok(m, `${name} must exist in github-update-feed.ts`);
  return m[1];
}

function extractPattern(source, name) {
  const m = source.match(new RegExp(`export const ${name} = (\/[^;]+\/);`));
  assert.ok(m, `${name} must exist in github-update-feed.ts`);
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

// ---- Minimal ports of source/electron-main/update/update-version.ts ----
const RELEASE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
function parseVersion(version) {
  const hyphenIndex = version.indexOf("-");
  const releasePart = hyphenIndex === -1 ? version : version.slice(0, hyphenIndex);
  const prereleasePart = hyphenIndex === -1 ? null : version.slice(hyphenIndex + 1);
  const match = RELEASE_PATTERN.exec(releasePart);
  if (match == null) return null;
  const prerelease = prereleasePart == null ? [] : prereleasePart.split(".");
  if (prerelease.some((id) => id.length === 0)) return null;
  return { release: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
}
function compareVersionIdentifiers(a, b) {
  const aIsNumeric = /^\d+$/.test(a);
  const bIsNumeric = /^\d+$/.test(b);
  if (aIsNumeric && bIsNumeric) return Math.sign(Number(a) - Number(b));
  if (aIsNumeric) return -1;
  if (bIsNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (parsedA == null || parsedB == null) throw new Error(`Cannot compare "${a}" and "${b}"`);
  for (let i = 0; i < 3; i += 1) {
    const diff = parsedA.release[i] - parsedB.release[i];
    if (diff !== 0) return Math.sign(diff);
  }
  if (parsedA.prerelease.length === 0 && parsedB.prerelease.length === 0) return 0;
  if (parsedA.prerelease.length === 0) return 1;
  if (parsedB.prerelease.length === 0) return -1;
  const length = Math.min(parsedA.prerelease.length, parsedB.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const diff = compareVersionIdentifiers(parsedA.prerelease[i], parsedB.prerelease[i]);
    if (diff !== 0) return diff;
  }
  return Math.sign(parsedA.prerelease.length - parsedB.prerelease.length);
}
const isNewerVersion = (candidate, current) => compareVersions(candidate, current) > 0;

// ---- Mirror of github-update-feed.ts pure mapping (patterns read live) ----
function normalizeTag(tag) {
  if (typeof tag !== "string" || tag.length === 0) return null;
  const version = tag.startsWith("v") || tag.startsWith("V") ? tag.slice(1) : tag;
  if (version.length === 0) return null;
  return parseVersion(version) == null ? null : version;
}
function patternFor(platform, patterns) {
  if (platform === "darwin-arm64") return patterns.macArm64;
  if (platform === "darwin-x64") return patterns.macX64;
  if (platform.startsWith("win32")) return patterns.windows;
  return null;
}
function findAsset(release, platform, patterns) {
  const pattern = patternFor(platform, patterns);
  if (pattern == null) return null;
  for (const asset of release.assets ?? []) {
    if (asset != null && typeof asset.name === "string" && typeof asset.browser_download_url === "string" && pattern.test(asset.name)) {
      try { new URL(asset.browser_download_url); } catch { continue; }
      return asset;
    }
  }
  return null;
}
function mapRelease(release, platform, patterns, htmlFallback) {
  if (release == null || typeof release !== "object" || release.draft === true) return null;
  const version = normalizeTag(release.tag_name);
  if (version == null) return null;
  const asset = findAsset(release, platform, patterns);
  if (asset == null) return null;
  return { version, url: asset.browser_download_url, htmlUrl: typeof release.html_url === "string" && release.html_url.length > 0 ? release.html_url : htmlFallback };
}
function selectNewest(releases, currentVersion, platform, patterns, htmlFallback) {
  if (!Array.isArray(releases) || parseVersion(currentVersion) == null) return null;
  const candidates = [];
  for (const release of releases) {
    const m = mapRelease(release, platform, patterns, htmlFallback);
    if (m == null) continue;
    try { if (isNewerVersion(m.version, currentVersion)) candidates.push(m); } catch { continue; }
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}
// Port of parseUpdateResponse squirrel-shape validation: adapter output must satisfy it.
function assertSquirrelShaped(payload) {
  assert.equal(typeof payload, "object");
  new URL(payload.url);
  assert.equal(typeof payload.name, "string");
  assert.ok(payload.name.length > 0);
}

function fixtureRelease(tag, { draft = false, prerelease = false, assets = [], htmlSuffix = tag } = {}) {
  return {
    tag_name: tag,
    html_url: `https://github.com/tyonger-stack/GrokNode/releases/tag/${htmlSuffix}`,
    published_at: "2026-10-23T00:00:00Z",
    draft,
    prerelease,
    assets,
  };
}
const macAsset = (version) => ({
  name: `Grok-Node-${version}-mac-arm64.zip`,
  browser_download_url: `https://github.com/tyonger-stack/GrokNode/releases/download/v${version}/Grok-Node-${version}-mac-arm64.zip`,
});

test("github feed constants point at this repo, not the Cursor endpoint", () => {
  const src = feedTs();
  assert.equal(extractConstString(src, "GITHUB_UPDATE_OWNER"), "tyonger-stack");
  assert.equal(extractConstString(src, "GITHUB_UPDATE_REPO"), "GrokNode");
  assert.equal(extractConstString(src, "DEFAULT_GITHUB_RELEASES_API_BASE"), "https://api.github.com/repos/tyonger-stack/GrokNode");
  assert.equal(extractConstString(src, "GITHUB_RELEASES_HTML_URL"), "https://github.com/tyonger-stack/GrokNode/releases");
  assert.ok(!src.includes("LEGACY_CURSOR_UPDATE_BASE_URL"), "github feed must not depend on the legacy Cursor base");
  assert.ok(!src.includes("/api/update/"), "github feed must not build Cursor-style update URLs");
  const svc = serviceTs();
  assert.ok(svc.includes("fetchGitHubUpdateManifest"), "service must fetch from the GitHub feed");
  assert.ok(svc.includes("isLegacyCursorFeedBaseUrl"), "service must keep the legacy override branch explicit");
});

test("tag normalization strips leading v and validates reconstructed versions", () => {
  assert.equal(normalizeTag("v0.75.3-reconstructed.6"), "0.75.3-reconstructed.6");
  assert.equal(normalizeTag("0.75.3-reconstructed.6"), "0.75.3-reconstructed.6");
  assert.equal(normalizeTag("V0.18.0-reconstructed.1"), "0.18.0-reconstructed.1");
  assert.equal(normalizeTag("not-a-version"), null);
  assert.equal(normalizeTag(""), null);
  assert.equal(normalizeTag("v"), null);
});

test("reconstructed version ordering recognizes 0.75.3-reconstructed.N as newer", () => {
  assert.ok(isNewerVersion("0.75.3-reconstructed.6", "0.18.0-reconstructed.1"));
  assert.ok(isNewerVersion("0.75.3-reconstructed.6", "0.75.3-reconstructed.5"));
  assert.ok(!isNewerVersion("0.75.3-reconstructed.6", "0.75.3-reconstructed.6"));
  assert.ok(!isNewerVersion("0.18.0-reconstructed.1", "0.75.3-reconstructed.6"));
});

test("asset matching only accepts the mac-arm64 zip for darwin-arm64", () => {
  const src = feedTs();
  const patterns = {
    macArm64: extractPattern(src, "GITHUB_MAC_ARM64_ASSET_PATTERN"),
    macX64: extractPattern(src, "GITHUB_MAC_X64_ASSET_PATTERN"),
    windows: extractPattern(src, "GITHUB_WINDOWS_ASSET_PATTERN"),
  };
  const htmlFallback = extractConstString(src, "GITHUB_RELEASES_HTML_URL");
  const release = fixtureRelease("v0.75.3-reconstructed.6", { assets: [macAsset("0.75.3-reconstructed.6")] });
  const mapped = mapRelease(release, "darwin-arm64", patterns, htmlFallback);
  assert.ok(mapped);
  assert.equal(mapped.version, "0.75.3-reconstructed.6");
  assertSquirrelShaped({ url: mapped.url, name: mapped.version });
  // Wrong platform / wrong asset name -> no offer (honest gap, not an error).
  assert.equal(mapRelease(release, "win32-x64-user", patterns, htmlFallback), null);
  assert.equal(mapRelease(fixtureRelease("v0.75.3-reconstructed.6", { assets: [{ name: "notes.txt", browser_download_url: "https://example.com/notes.txt" }] }), "darwin-arm64", patterns, htmlFallback), null);
  assert.equal(mapRelease(fixtureRelease("v0.75.3-reconstructed.6", { draft: true, assets: [macAsset("0.75.3-reconstructed.6")] }), "darwin-arm64", patterns, htmlFallback), null);
  assert.equal(mapRelease(fixtureRelease("bad-tag", { assets: [macAsset("0.75.3-reconstructed.6")] }), "darwin-arm64", patterns, htmlFallback), null);
});

test("newest-offer selection prefers the latest newer release and skips drafts", () => {
  const src = feedTs();
  const patterns = {
    macArm64: extractPattern(src, "GITHUB_MAC_ARM64_ASSET_PATTERN"),
    macX64: extractPattern(src, "GITHUB_MAC_X64_ASSET_PATTERN"),
    windows: extractPattern(src, "GITHUB_WINDOWS_ASSET_PATTERN"),
  };
  const htmlFallback = extractConstString(src, "GITHUB_RELEASES_HTML_URL");
  const releases = [
    fixtureRelease("v0.75.3-reconstructed.6", { assets: [macAsset("0.75.3-reconstructed.6")] }),
    fixtureRelease("v0.75.3-reconstructed.5", { assets: [macAsset("0.75.3-reconstructed.5")] }),
    fixtureRelease("v9.9.9", { draft: true, assets: [{ name: "Grok-Node-9.9.9-mac-arm64.zip", browser_download_url: "https://example.com/9.zip" }] }),
    fixtureRelease("v0.18.0-reconstructed.1", { assets: [macAsset("0.18.0-reconstructed.1")] }),
  ];
  const newest = selectNewest(releases, "0.18.0-reconstructed.1", "darwin-arm64", patterns, htmlFallback);
  assert.ok(newest);
  assert.equal(newest.version, "0.75.3-reconstructed.6");
  assertSquirrelShaped({ url: newest.url, name: newest.version });
  assert.equal(selectNewest(releases, "0.75.3-reconstructed.6", "darwin-arm64", patterns, htmlFallback), null);
  assert.equal(selectNewest(releases, "0.18.0-reconstructed.1", "win32-x64-user", patterns, htmlFallback), null);
});

test("service exposes releases fallback metadata and keeps the legacy branch", () => {
  const svc = serviceTs();
  assert.ok(svc.includes("releasesUrl: GITHUB_RELEASES_HTML_URL"), "status must carry the Releases fallback URL");
  assert.ok(svc.includes("githubRelease"), "status must carry the resolved GitHub offer");
  assert.ok(svc.includes("lastGitHubTargetVersion"), "service must remember the last GitHub offer for the UI");
  // No silent default back to Cursor: DEFAULT_UPDATE_BASE_URL appears only in the import
  // and inside the explicit legacy-override branch (never as an implicit fetch default).
  assert.ok(svc.includes("isLegacyCursorFeedBaseUrl(this.options.feedBaseUrl)"));
  const legacyBranchUses = svc.split("buildUpdateRequestUrl(this.options.feedBaseUrl ?? DEFAULT_UPDATE_BASE_URL").length - 1;
  assert.equal(legacyBranchUses, 1);
});

test("packaging guard leaves updates enabled but telemetry/sentry off", () => {
  const guard = read("scripts/lib/build-asar.mjs");
  // NOTE: build-asar.mjs stores the guard lines escaped (backslash-quote) inside a JS
  // string literal, so match on the env names rather than the evaluated bytes.
  assert.ok(!guard.includes('SAND_DISABLE_UPDATES'), "guard must not force SAND_DISABLE_UPDATES=1");
  assert.ok(guard.includes('SAND_DISABLE_SENTRY'));
  assert.ok(guard.includes('SAND_DISABLE_TELEMETRY'));
  assert.ok(guard.includes("GitHub Releases"));
});

test("settings UI always offers the Releases fallback link", () => {
  const updates = read("frontend/src/recovered/features/settings/overlay/updates.ts");
  const panels = read("frontend/src/recovered/features/settings/overlay/panels.tsx");
  assert.ok(updates.includes('GITHUB_RELEASES_URL = "https://github.com/tyonger-stack/GrokNode/releases"'));
  assert.ok(panels.includes("GITHUB_RELEASES_URL"), "panel must reference the fallback URL");
  assert.ok(panels.includes("githubRelease"), "panel must render the resolved offer when present");
  assert.ok(panels.includes("GitHub Releases"));
});
