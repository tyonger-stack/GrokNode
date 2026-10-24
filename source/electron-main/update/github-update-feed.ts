import { SAND_PRODUCT_DISPLAY_NAME } from "../../shared/product-name.js";
import { compareVersions, isNewerVersion, parseVersion } from "./update-version.js";
import { UpdateHttpStatusError } from "./update-feed.js";

/**
 * GitHub Releases update feed for reconstructed builds.
 *
 * Reconstructed packages must NOT consume the official Cursor update endpoint
 * (`https://api2.cursor.sh/updates`). The default update source is this repo's
 * GitHub Releases (`tyonger-stack/GrokNode`).
 *
 * Design notes (read before extending):
 * - Track semantics are intentionally ignored on this feed: GitHub releases have
 *   no stable/nightly/dogfood channels, so every check scans recent releases and
 *   picks the newest version newer than the running build. Telemetry still
 *   records the effective track for continuity, but it does not filter offers.
 * - Only `darwin-arm64` has a first-class asset today
 *   (`Grok-Node-<version>-mac-arm64.zip`). Other platforms return `null` from the
 *   mapper (== "no update"), which is an honest gap, not a silent failure: the
 *   asset naming convention only defines the mac-arm64 zip.
 * - GitHub's releases API provides no sha256/signature sidecar, so `sha256` is
 *   absent from the mapped manifest and `downloadAndVerify` skips hash pinning on
 *   this path. Squirrel.Mac staging additionally requires a Developer ID
 *   signature to auto-install; reconstructed ad-hoc builds may stage but fail to
 *   apply. The Settings UI therefore always surfaces the Releases page link as
 *   the reliable fallback (prompt + manual download), even when download/staging
 *   succeeds.
 * - Unauthenticated `api.github.com` calls are rate-limited (60/hr/IP). The
 *   hourly check cadence stays far below that; a 403/429 surfaces as a normal
 *   check error, never as a staged update.
 */

export const GITHUB_UPDATE_OWNER = "tyonger-stack";
export const GITHUB_UPDATE_REPO = "GrokNode";
export const DEFAULT_GITHUB_RELEASES_API_BASE = "https://api.github.com/repos/tyonger-stack/GrokNode";
export const GITHUB_RELEASES_HTML_URL = "https://github.com/tyonger-stack/GrokNode/releases";
export const GITHUB_RELEASES_PER_PAGE = 20;

/** First-class asset: `Grok-Node-0.75.3-reconstructed.6-mac-arm64.zip`. */
export const GITHUB_MAC_ARM64_ASSET_PATTERN = /^Grok-Node-.*-mac-arm64\.zip$/;
/** Reserved for a future x64 asset; no such artifact is published today. */
export const GITHUB_MAC_X64_ASSET_PATTERN = /^Grok-Node-.*-mac-(x64|intel)\.zip$/;
/** Reserved for future Windows artifacts; no such artifact is published today. */
export const GITHUB_WINDOWS_ASSET_PATTERN = /^Grok-Node-.*-win-(x64|arm64)\.exe$/;

export interface GitHubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface GitHubRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly published_at: string | null;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly GitHubReleaseAsset[];
}

export interface GitHubUpdateManifest {
  /** Version without a leading `v` (e.g. `0.75.3-reconstructed.6`). */
  readonly version: string;
  /** Direct asset download URL (== Squirrel `url`). */
  readonly url: string;
  /** Display name (`Grok Bot <version>`). */
  readonly name: string;
  readonly htmlUrl: string;
  readonly pubDate?: string;
}

/**
 * Strip a leading `v`/`V` from a release tag and validate the remainder with
 * the shared reconstructed version parser (handles `0.75.3-reconstructed.N`).
 */
export function normalizeGitHubTagVersion(tag: string): string | null {
  if (typeof tag !== "string" || tag.length === 0) return null;
  const version = tag.startsWith("v") || tag.startsWith("V") ? tag.slice(1) : tag;
  if (version.length === 0) return null;
  return parseVersion(version) == null ? null : version;
}

export function githubAssetPatternForPlatform(platform: string): RegExp | null {
  if (platform === "darwin-arm64") return GITHUB_MAC_ARM64_ASSET_PATTERN;
  if (platform === "darwin-x64") return GITHUB_MAC_X64_ASSET_PATTERN;
  if (platform.startsWith("win32")) return GITHUB_WINDOWS_ASSET_PATTERN;
  return null;
}

export function findGitHubAssetForPlatform(
  release: Pick<GitHubRelease, "assets">,
  platform: string,
): GitHubReleaseAsset | null {
  const pattern = githubAssetPatternForPlatform(platform);
  if (pattern == null) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const asset of assets) {
    if (asset != null && typeof asset.name === "string" && typeof asset.browser_download_url === "string" && pattern.test(asset.name)) {
      try {
        new URL(asset.browser_download_url);
      } catch {
        continue;
      }
      return asset;
    }
  }
  return null;
}

/**
 * Map one GitHub release to the squirrel-shaped manifest the existing
 * `parseUpdateResponse` path consumes (`{ url, name: version }`), enriched with
 * display/HTML metadata for status + UI. Returns `null` when the release has no
 * usable version or no asset for this platform.
 */
export function mapGitHubReleaseToUpdateManifest(
  release: GitHubRelease,
  platform: string,
): GitHubUpdateManifest | null {
  if (release == null || typeof release !== "object" || release.draft === true) return null;
  const version = normalizeGitHubTagVersion(release.tag_name);
  if (version == null) return null;
  const asset = findGitHubAssetForPlatform(release, platform);
  if (asset == null) return null;
  const htmlUrl = typeof release.html_url === "string" && release.html_url.length > 0 ? release.html_url : GITHUB_RELEASES_HTML_URL;
  return {
    version,
    url: asset.browser_download_url,
    name: `${SAND_PRODUCT_DISPLAY_NAME} ${version}`,
    htmlUrl,
    ...(release.published_at == null ? {} : { pubDate: release.published_at }),
  };
}

/**
 * Pick the newest release newer than `currentVersion` with a usable asset.
 * Drafts are skipped; prereleases are considered because reconstructed tags
 * (`-reconstructed.N`) parse as prereleases under semver rules.
 */
export function selectNewestGitHubUpdate(
  releases: readonly GitHubRelease[],
  currentVersion: string,
  platform: string,
): GitHubUpdateManifest | null {
  if (!Array.isArray(releases) || parseVersion(currentVersion) == null) return null;
  const candidates: GitHubUpdateManifest[] = [];
  for (const release of releases) {
    if (release == null || typeof release !== "object") continue;
    const manifest = mapGitHubReleaseToUpdateManifest(release, platform);
    if (manifest == null) continue;
    try {
      if (isNewerVersion(manifest.version, currentVersion)) candidates.push(manifest);
    } catch {
      continue;
    }
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}

export function buildGitHubReleasesListUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/releases?per_page=${GITHUB_RELEASES_PER_PAGE}&page=1`;
}

export function resolveGitHubApiBase(feedBaseUrl?: string): string {
  if (feedBaseUrl == null || feedBaseUrl.length === 0) return DEFAULT_GITHUB_RELEASES_API_BASE;
  return feedBaseUrl.replace(/\/+$/, "");
}

/** True for `api.github.com/repos/...` bases (and empty/undefined, which default to GitHub). */
export function isGitHubFeedBaseUrl(value: string | undefined): boolean {
  if (value == null || value.length === 0) return true;
  return value.includes("api.github.com/repos/");
}

/** True only when the configured base is an explicit non-GitHub (legacy Cursor) feed. */
export function isLegacyCursorFeedBaseUrl(value: string | undefined): boolean {
  return value != null && value.length > 0 && !isGitHubFeedBaseUrl(value);
}

export async function fetchGitHubUpdateManifest(options: {
  readonly baseUrl?: string;
  readonly currentVersion: string;
  readonly platform: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<GitHubUpdateManifest | null> {
  const base = resolveGitHubApiBase(options.baseUrl);
  const url = buildGitHubReleasesListUrl(base);
  const response = await (options.fetchImpl ?? fetch)(url, {
    redirect: "follow",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "GrokNode-Reconstructed-Updater",
      "cache-control": "no-cache",
    },
  });
  if (!response.ok) throw new UpdateHttpStatusError(response.status, url);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return null;
  return selectNewestGitHubUpdate(payload as GitHubRelease[], options.currentVersion, options.platform);
}
