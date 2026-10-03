/**
 * Marketplace data model.
 *
 * This is a faithful port of official 0.66's browse model, not a redesign. The upstream code lives
 * in `chunk-marketplace-browse-model-DoOY91TS.js` and `chunk-view-BudImuR0.js` of the shipped asar;
 * the functions it exports are `deriveMarketplaceBrowseModel` (as `y`), `groupCatalog` (as `h`),
 * `sliceForPreview` (as `i`) and `selectForYou` (as `g`). Upstream's own comments and structure are
 * preserved in the notes below so the two can be diffed by eye later.
 *
 * Everything the model needs already exists on the local bridge — `mcp.catalog()` returns the same
 * 393-entry payload the official build renders, `mcp.list()` returns the configured servers with
 * their `status`, and `mcp.teamPopularity()` is the (empty, in this login-free build) team feed.
 * No backend change is required for any of this.
 */

export interface CatalogEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly displayName?: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
  readonly categoryKey?: unknown;
  readonly iconUrl?: unknown;
  readonly iconId?: unknown;
  readonly marketplace?: unknown;
  readonly connectors?: unknown;
  readonly skills?: unknown;
  readonly publisher?: unknown;
}

export interface McpServer {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly url?: unknown;
  readonly status?: unknown;
  readonly statusDetail?: unknown;
  readonly toolCount?: unknown;
  readonly accountKey?: unknown;
  readonly isTeamServer?: unknown;
}

export interface PrivateSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Upstream distinguishes `plugin`-sourced skills from locally created ones. */
  readonly source: "plugin" | "local";
}

export interface BrowseRow {
  readonly entry: CatalogEntry;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly iconUrl: string;
  readonly connectorCount: number;
  readonly skillCount: number;
  readonly isTeam: boolean;
  readonly teamName: string | null;
  /** True when a configured MCP server already backs this entry. */
  readonly isInstalled: boolean;
  readonly server: McpServer | null;
}

export interface BrowseGroup {
  readonly key: string;
  readonly title: string;
  readonly items: readonly BrowseRow[];
}

/* ------------------------------------------------------------------ *
 * Constants lifted from the official model
 * ------------------------------------------------------------------ */

const FEATURED_SECTION_KEY = "category:featured";
const TEAM_SECTION_KEY = "team-plugins";
const CATEGORY_PREFIX = "marketplace:category:";

/** `const Xe = 6, le = 4, je = 6, ue = 20;` — the four preview caps upstream uses. */
export const MANAGE_VISIBLE_ROWS = 6; // Xe — installed rows shown before 显示全部
export const HOMEPAGE_PREVIEW_LIMIT = 4; // le — category-group preview rows
export const PLUGINS_PREVIEW_LIMIT = 6; // je — generic section preview in the `plugins` layout
export const POPULAR_LIMIT = 20; // ue

/** `const q = 4` — `selectForYou`'s row limit, passed as `pluginLimit` from `ml`. */
export const FOR_YOU_ROW_LIMIT = 4;

/** `const lo = 4` — `Bt`'s installed-icon cap in the header preview. */
export const PREVIEW_ICON_LIMIT = 4;

/** `const Q = .5` — the team/affinity split inside `selectForYou`. */
const FOR_YOU_TEAM_SHARE = 0.5;

/**
 * `const Ce = ["credentials","productivity","communication","design","code","data","sales",
 *              "finance","research","support"]` — the single source of truth for bucket order.
 * Empty buckets are omitted entirely, which is why a live capture shows 8 of these 10.
 */
export const CATEGORY_BUCKET_ORDER = [
  "credentials", "productivity", "communication", "design", "code", "data", "sales", "finance",
  "research", "support",
] as const;
export type CategoryBucketKey = (typeof CATEGORY_BUCKET_ORDER)[number];

/** `const we = { credentials:{id:"3Ia71M"}, … }` resolved to the strings the official build renders. */
export const CATEGORY_BUCKET_LABELS: Readonly<Record<CategoryBucketKey, string>> = {
  credentials: "登录与凭据管理",
  productivity: "效率",
  communication: "通信",
  design: "设计",
  code: "代码",
  data: "数据",
  sales: "销售",
  finance: "财务",
  research: "研究",
  support: "支持",
};

/**
 * `Le` — how upstream's 15 catalog categories collapse onto the 10 buckets, plus `Te`'s
 * hard-coded vendor overrides. Transcribed from the bundle; a catalog category with no entry here
 * is reported as `null` rather than being guessed into a bucket.
 *
 * Keyed on the SNOWFLAKE form, and `categoryToken` normalises whatever the catalog actually holds
 * into that form — the official build reads `entry.categoryKey` (`"INBOX_AND_COLLABORATION"`) while
 * this build's catalog only ships the human label (`"Inbox And Collaboration"`), and both denote the
 * same upstream category. Without the normalisation every entry would fall through to no bucket.
 */
const CATALOG_CATEGORY_TO_BUCKET: Readonly<Record<string, CategoryBucketKey>> = {
  SCHEDULING: "communication",
  INBOX_AND_COLLABORATION: "communication",
  PAYMENTS: "finance",
  FINANCE_AND_LEGAL: "finance",
  CANVAS: "design",
  DESIGN: "design",
  DOCUMENTS_AND_FILES: "productivity",
  PRODUCTIVITY: "productivity",
  DATA_ANALYTICS: "data",
  SALES: "sales",
  RESEARCH: "research",
  CUSTOMER_SUPPORT: "support",
  INFRASTRUCTURE: "code",
  AGENT_ORCHESTRATION: "code",
  FEATURED: "productivity",
};

const VENDOR_BUCKET_OVERRIDES: Readonly<Record<string, readonly CategoryBucketKey[]>> = {
  slack: ["communication"],
  notion: ["productivity"],
  linear: ["productivity"],
  figma: ["design"],
  tldraw: ["design"],
  github: ["code"],
  runlayer: ["code"],
  superpowers: ["code"],
  "create-plugin": ["code"],
  langfuse: ["data"],
  parallel: ["research", "data"],
  context7: ["research"],
};

/* ------------------------------------------------------------------ *
 * Normalisation helpers
 * ------------------------------------------------------------------ */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function normalize(value: unknown): string {
  return str(value).trim().toLocaleLowerCase();
}

/** Catalog entries are addressed by `id`; fall back to the name so a catalog without ids still
 *  resolves, matching how the dock pill already keys its logo lookup. */
function entryId(entry: CatalogEntry): string {
  return str(entry.id) || str(entry.name);
}

function marketplaceName(entry: CatalogEntry): string | null {
  const value = entry.marketplace;
  if (value == null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "object") {
    const displayName = (value as { displayName?: unknown }).displayName;
    return str(displayName).length > 0 ? str(displayName) : null;
  }
  return null;
}

function connectorCount(entry: CatalogEntry): number {
  return countOf(entry.connectors);
}

function skillCount(entry: CatalogEntry): number {
  return countOf(entry.skills);
}

/* ------------------------------------------------------------------ *
 * Installed-state resolution
 * ------------------------------------------------------------------ */

/** `serverPrefix` — upstream keys configured servers as `Plugin:connector`, and the dock pill
 *  already matches a server to a catalog entry by the prefix before the colon. */
function serverPrefix(name: string): string {
  return name.includes(":") ? name.slice(0, name.indexOf(":")) : name;
}

export function buildInstalledIndex(
  servers: readonly McpServer[],
  catalog: readonly CatalogEntry[],
): {
  byId: Map<string, BrowseRow>;
  byName: Map<string, BrowseRow>;
} {
  const rows = catalog.map((entry) => toRow(entry, servers));
  const byId = new Map<string, BrowseRow>();
  const byName = new Map<string, BrowseRow>();
  for (const row of rows) {
    byId.set(row.id, row);
    const key = normalize(row.name);
    if (key.length > 0 && !byName.has(key)) byName.set(key, row);
  }
  return { byId, byName };
}

function toRow(entry: CatalogEntry, servers: readonly McpServer[]): BrowseRow {
  const id = entryId(entry);
  const name = str(entry.displayName) || str(entry.name);
  const server =
    servers.find((candidate) => str(candidate.name).split(":")[0] === name)
    ?? servers.find((candidate) => normalize(serverPrefix(str(candidate.name))) === normalize(name))
    ?? null;
  return {
    entry,
    id,
    name,
    description: str(entry.description),
    iconUrl: str(entry.iconUrl),
    connectorCount: connectorCount(entry),
    skillCount: skillCount(entry),
    isTeam: marketplaceName(entry) != null,
    teamName: marketplaceName(entry),
    isInstalled: server != null,
    server,
  };
}

/* ------------------------------------------------------------------ *
 * Section keys
 * ------------------------------------------------------------------ */

/** The category in the form the bucket table is keyed on. `"Inbox And Collaboration"` and
 *  `"INBOX_AND_COLLABORATION"` must resolve to the same bucket, so spaces/dashes collapse to
 *  underscores and the result is upper-cased. */
function categoryToken(entry: CatalogEntry): string {
  return str(entry.categoryKey || entry.category)
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function vendorTokens(entry: CatalogEntry): readonly string[] {
  const out: string[] = [];
  const name = normalize(entry.name);
  const display = normalize(entry.displayName);
  if (name.length > 0) out.push(name);
  if (display.length > 0 && display !== name) out.push(display);
  return out;
}

/** The bucket(s) an entry belongs to, or an empty list when upstream would not place it in one.
 *
 *  UNCERTAINTY, deliberately not invented: this build's catalog also ships an `MCP` category
 *  (146 of 393 entries — the largest single group) which has no counterpart in upstream's 15-value
 *  category enum, and it ships no `categoryKey` at all, so the vendor-level `Te` overrides are the
 *  only signal available for those rows. Entries in an unmapped category are therefore left out of
 *  the homepage buckets rather than being poured into an arbitrary one. Confirming where they
 *  belong needs a backend answer (see the follow-up note), not a guess here. */
function bucketsOf(entry: CatalogEntry): readonly CategoryBucketKey[] {
  for (const token of vendorTokens(entry)) {
    const override = VENDOR_BUCKET_OVERRIDES[token];
    if (override != null) return override;
  }
  const mapped = CATALOG_CATEGORY_TO_BUCKET[categoryToken(entry)];
  return mapped != null ? [mapped] : [];
}

function isFeatured(entry: CatalogEntry): boolean {
  return (
    str(entry.categoryKey).toUpperCase() === "FEATURED" || normalize(entry.category) === "featured"
  );
}

/** `sectionKeyOf` — the key the official build groups an entry under. */
export function sectionKeyOf(row: BrowseRow): string {
  if (row.isTeam) return TEAM_SECTION_KEY;
  if (isFeatured(row.entry)) return FEATURED_SECTION_KEY;
  return `category:${normalize(row.entry.category)}`;
}

function sectionTitle(row: BrowseRow): string {
  if (row.isTeam) return "团队插件";
  if (isFeatured(row.entry)) return "精选插件";
  return str(row.entry.category);
}

/* ------------------------------------------------------------------ *
 * Homepage model
 * ------------------------------------------------------------------ */

export interface MarketplaceModel {
  readonly rows: readonly BrowseRow[];
  /** `model.homepagePluginItems` — the `category:featured` entries. */
  readonly featured: readonly BrowseRow[];
  /** `model.hoistedTeamItems` — entries carrying a `marketplace` field. */
  readonly team: readonly BrowseRow[];
  /** `selectForYou(..., 4)`. */
  readonly forYou: readonly BrowseRow[];
  /** `categoryGroups` — the `Ce` buckets that actually have members, in `Ce` order. */
  readonly categoryGroups: readonly BrowseGroup[];
  readonly showsTrailingBrowse: boolean;
}

export function buildMarketplaceModel(
  catalog: readonly CatalogEntry[],
  servers: readonly McpServer[],
  teamInstallCounts: Readonly<Record<string, number>>,
): MarketplaceModel {
  const rows = catalog.map((entry) => toRow(entry, servers));
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // `teamPlugins` (se): `catalog.filter(e => e.marketplace != null)`, sorted by team install count
  // then displayName. The hoisted team group.
  const team = rows
    .filter((row) => row.isTeam)
    .sort(
      (a, b) =>
        (teamInstallCounts[b.id] ?? 0) - (teamInstallCounts[a.id] ?? 0) || a.name.localeCompare(b.name),
    );

  // `homepagePluginItems`: `candidates.filter(e => sectionKeyOf(t, e).key === "category:featured")`
  const featured = rows.filter((row) => sectionKeyOf(row) === FEATURED_SECTION_KEY);

  const forYou = selectForYou(rows, teamInstallCounts, FOR_YOU_ROW_LIMIT);

  // `categoryGroups` — `Ce.flatMap(...)`, omitting buckets with no members.
  const buckets = new Map<CategoryBucketKey, BrowseRow[]>();
  for (const row of rows) {
    if (sectionKeyOf(row) === FEATURED_SECTION_KEY) continue;
    for (const bucket of bucketsOf(row.entry)) {
      const list = buckets.get(bucket) ?? [];
      list.push(row);
      buckets.set(bucket, list);
    }
  }
  const categoryGroups: BrowseGroup[] = [];
  for (const key of CATEGORY_BUCKET_ORDER) {
    const items = buckets.get(key);
    if (items == null || items.length === 0) continue;
    categoryGroups.push({
      key: `${CATEGORY_PREFIX}${key}`,
      title: CATEGORY_BUCKET_LABELS[key],
      items,
    });
  }

  void rowById;
  return {
    rows,
    featured,
    team,
    forYou,
    categoryGroups,
    // `showsTrailingBrowse` collapses only in the two cases the official model special-cases.
    showsTrailingBrowse: featured.length > 0 || team.length === 0,
  };
}

/**
 * `selectForYou` (`te`) — team-signal first, category-affinity second.
 *
 * Upstream's ranking is: fill half the slots from entries teammates have installed, then affinity
 * (how many of YOUR installed plugins share a category), then any remaining team entries; finally
 * re-sort so team entries lead. `affinityStrength` needs a shared category token between the
 * candidate and your installed set — upstream compares the normalized catalog-category token, and
 * the vendor overrides are what make that comparison meaningful.
 */
export function selectForYou(
  catalog: readonly BrowseRow[],
  teamInstallCounts: Readonly<Record<string, number>>,
  limit: number,
): readonly BrowseRow[] {
  if (limit <= 0) return [];
  const installed = catalog.filter((row) => row.isInstalled);
  const affinity = new Map<string, number>();
  for (const row of installed) {
    for (const bucket of bucketsOf(row.entry)) {
      affinity.set(bucket, (affinity.get(bucket) ?? 0) + 1);
    }
  }

  const pool: Scored[] = [];
  for (const row of catalog) {
    if (row.isInstalled) continue;
    let affinityStrength = 0;
    for (const bucket of bucketsOf(row.entry)) affinityStrength = Math.max(affinityStrength, affinity.get(bucket) ?? 0);
    pool.push({ row, teammateCount: teamInstallCounts[row.id] ?? 0, affinityStrength });
  }

  const byName = (a: Scored, b: Scored): number => a.row.name.localeCompare(b.row.name);
  const byTeam = pool
    .filter((candidate) => candidate.teammateCount > 0)
    .sort((a, b) => b.teammateCount - a.teammateCount || byName(a, b));
  const byAffinity = pool
    .filter((candidate) => candidate.affinityStrength > 0)
    .sort((a, b) => b.affinityStrength - a.affinityStrength || b.teammateCount - a.teammateCount || byName(a, b));

  const seen = new Set<string>();
  const out: Scored[] = [];
  const push = (candidate: Scored): void => {
    if (seen.has(candidate.row.id) || out.length === limit) return;
    seen.add(candidate.row.id);
    out.push(candidate);
  };

  const half = Math.max(1, Math.floor(limit * FOR_YOU_TEAM_SHARE));
  for (const candidate of byTeam.slice(0, half)) push(candidate);
  for (const candidate of byAffinity) push(candidate);
  for (const candidate of byTeam) push(candidate);

  // `R = {team:0, affinity:1}` — team-signal entries lead.
  return out.sort((a, b) => rankOf(a) - rankOf(b)).map((candidate) => candidate.row);
}

interface Scored {
  readonly row: BrowseRow;
  readonly teammateCount: number;
  readonly affinityStrength: number;
}

function rankOf(candidate: Scored): number {
  return candidate.teammateCount > 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ *
 * `sliceForPreview` (upstream export `i`)
 * ------------------------------------------------------------------ */

export function sliceForPreview(
  items: readonly BrowseRow[],
  collapsible: boolean,
  limit: number,
): { visible: readonly BrowseRow[]; hiddenCount: number } {
  if (!collapsible || items.length <= limit) return { visible: items, hiddenCount: 0 };
  return { visible: items.slice(0, limit), hiddenCount: items.length - limit };
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** Upstream uses a shared fuzzy matcher whose ranking semantics were not extracted; this port does
 *  a case-insensitive substring match over name + description, which is deterministic and covers
 *  the same inputs. Recorded as an uncertainty rather than presented as upstream's algorithm. */
export function searchRows(rows: readonly BrowseRow[], query: string): readonly BrowseRow[] {
  const needle = normalize(query);
  if (needle.length === 0) return rows;
  return rows.filter((row) => {
    if (normalize(row.name).includes(needle)) return true;
    if (normalize(row.description).includes(needle)) return true;
    return row.entry.category != null && normalize(row.entry.category).includes(needle);
  });
}

/* ------------------------------------------------------------------ *
 * Installed rows for the manage view
 * ------------------------------------------------------------------ */

export interface InstalledRow {
  readonly key: string;
  readonly name: string;
  /** `1 个连接器` / `1 个连接器14 项技能` / `18 项技能` — upstream concatenates the parts with no
   *  separator, which is why the official rows read "1 个连接器14 项技能". */
  readonly subtitle: string;
  readonly iconUrl: string;
  readonly connectorCount: number;
  readonly skillCount: number;
  readonly status: string | null;
  readonly statusDetail: string;
  readonly serverId: string | null;
  readonly row: BrowseRow | null;
}

/** Upstream builds installed rows from BOTH the configured server list and the catalog, so a
 *  server with no catalog entry still appears (that is how `Cursor Team Kit` / `pstack` — skill
 *  only, no connector — show up in the official grid). */
export function buildInstalledRows(
  servers: readonly McpServer[],
  catalog: readonly CatalogEntry[],
): readonly InstalledRow[] {
  const index = buildInstalledIndex(servers, catalog);
  const out: InstalledRow[] = [];
  const consumed = new Set<string>();

  for (const server of servers) {
    const rawName = str(server.name);
    if (rawName.length === 0) continue;
    const prefix = serverPrefix(rawName);
    const match = index.byName.get(normalize(prefix)) ?? index.byId.get(prefix) ?? null;
    if (match != null) consumed.add(match.id);
    const connectorName = rawName.includes(":") ? rawName.slice(rawName.indexOf(":") + 1) : rawName;
    const connectorCount = match?.connectorCount ?? 1;
    const skillCount = match?.skillCount ?? 0;
    out.push({
      key: `server-${str(server.id) ?? rawName}`,
      // Upstream shows the catalog display name when there is a match and the raw server name
      // otherwise; the official grid shows "Gmail", not "Gmail:gmail".
      name: match?.name ?? rawName,
      subtitle: `${connectorCount} 个连接器${skillCount > 0 ? `${skillCount} 项技能` : ""}`,
      iconUrl: match?.iconUrl ?? "",
      connectorCount,
      skillCount,
      status: str(server.status) || null,
      statusDetail: str(server.statusDetail),
      serverId: str(server.id) || null,
      row: match,
    });
    void connectorName;
  }

  // Catalog entries that carry skills but have no server are still "installed" upstream (a skill
  // pack is installed without a connector). Local build has no way to observe those without a
  // skills bridge, so this stays empty rather than being invented — see README note.
  return out;
}

/* ------------------------------------------------------------------ *
 * Status mapping — `chunk-mcp-connector-status-DhhAF8A6.js`
 * ------------------------------------------------------------------ */

export type StatusTone = "connected" | "warn" | "error" | "neutral";

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "connected":
      return "connected";
    case "needsAuth":
    case "needsGrant":
      return "warn";
    case "error":
      return "error";
    case "initializing":
    case "disconnected":
    case "disabledByTeamAdminPolicy":
      return "neutral";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "disconnected":
      return "已断开连接";
    case "error":
      return "错误";
    case "initializing":
      return "启动中";
    case "needsAuth":
      return "需要认证";
    case "needsGrant":
      return "需要你批准";
    case "disabledByTeamAdminPolicy":
      return "已被团队管理员停用";
    default:
      return status;
  }
}

/* ------------------------------------------------------------------ *
 * Wording
 * ------------------------------------------------------------------ */

export const TEXT = {
  market: "市场",
  manage: "管理",
  manageTitle: "管理插件和技能",
  forYou: "为你推荐",
  featured: "精选插件",
  team: "团队插件",
  installed: "已安装",
  privateSkills: "私有技能",
  viewAll: "查看全部",
  searchPlaceholder: "搜索插件",
  installedAriaLabel: "你的插件",
  backToMarketAriaLabel: "返回市场",
  add: "添加",
  added: "已添加",
  connected: "已连接",
  localCreated: "本地创建",
  noPrivateSkills: "还没有私有技能。让你的 Bot 为你创建一个吧。",
  noInstalled: "尚未安装任何插件。请在市场中查找插件。",
  noAgentForSkills: "打开一个 Bot 以查看其私有技能",
  loadingCatalog: "正在加载市场…",
  catalogUnavailable: "无法加载市场目录：",
} as const;

export function installedCountLabel(count: number): string {
  return `已安装 ${count} 个`;
}

export function showAllLabel(count: number): string {
  return `显示全部 ${count} 个插件`;
}

export function skillSubtitle(skill: PrivateSkill): string {
  const provenance = skill.source === "plugin" ? "已发布" : TEXT.localCreated;
  return `${provenance} · ${skill.description}`;
}
