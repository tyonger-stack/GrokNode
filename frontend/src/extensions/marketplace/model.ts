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
  /** Official 0.66 ships a multi-valued key array; `Le` is looked up across all of it and every key
   *  that misses is dropped, so one entry can land in several buckets. This build's catalog does not
   *  carry it — see the DATA-GAP COMPENSATIONS block on `VENDOR_BUCKET_OVERRIDES`. */
  readonly categoryKeys?: unknown;
  /** Upstream's vendor-override probe reads `pluginName` before `name`; `displayName` is never used. */
  readonly pluginName?: unknown;
  readonly iconUrl?: unknown;
  /** The plugin's own URL. Confirmed against the live 0.66 build: the 查看源码 link target for
   *  both Gmail and Ahrefs is exactly this field's value. */
  readonly homepage?: unknown;
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

/**
 * Upstream's four workflow sources, verbatim. `privateSkillsFromRecords` below keeps three of them
 * and drops `automation`, which is a schedule projection rather than a skill.
 *
 * @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#L802 (upstream's own filter)
 */
export type PrivateSkillSource = "managed" | "plugin" | "workflow";

export interface PrivateSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Upstream's raw source. Only `plugin` is 已发布; `managed` and `workflow` are 本地创建. */
  readonly source: PrivateSkillSource;
  /** The SKILL.md body. Upstream's edit form needs it, and the detail page shows it. */
  readonly body: string;
  /** `/home/box/sand-data/…`; shown on the detail page and used to explain where a skill lives. */
  readonly filePath: string;
  readonly enabled: boolean;
  /** `managed-skills/` skills are installed by the platform; `workflows/` skills the user wrote. */
  readonly pluginId: string | null;
}

/**
 * Upstream's converter, reproduced rather than invented.
 *
 * @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#L802
 *
 * Three rules, all load-bearing:
 *  - `automation` is dropped. The host's `getAgentWorkflows` returns schedule projections alongside
 *    skills, and a live call returns exactly one of them for this account.
 *  - `plugin` is kept ONLY when `publishedByCurrentUser === true`. "已发布" means *you* published it
 *    to a team; a plugin you merely installed is not a private skill.
 *  - `id` and `name` must be strings, or the record is dropped rather than rendered half-empty.
 */
export function privateSkillsFromRecords(records: readonly unknown[]): readonly PrivateSkill[] {
  return records.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate == null || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const rawSource = record.source;
    const source =
      rawSource === "workflow" || rawSource === "managed" || rawSource === "plugin" ? rawSource : null;
    if (source == null) return [];
    if (source === "plugin" && record.publishedByCurrentUser !== true) return [];
    if (typeof record.id !== "string" || typeof record.name !== "string") return [];
    return [{
      id: record.id,
      name: record.name,
      description: typeof record.description === "string" ? record.description : "",
      source,
      body: typeof record.body === "string" ? record.body : "",
      filePath: typeof record.filePath === "string" ? record.filePath : "",
      enabled: record.isEnabledForAgent === true,
      pluginId: typeof record.pluginId === "string" ? record.pluginId : null,
    } satisfies PrivateSkill];
  });
}

/**
 * Upstream only lets the user edit a skill they wrote themselves.
 *
 * @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#L1377,#L1387
 *
 * `source === "workflow"` plus three non-empty fields plus at least one actual change. A
 * `managed` skill is installed by the platform and editing it would write to a file the product
 * owns, so the detail page must not offer the form for it.
 */
export function canEditPrivateSkill(
  skill: Pick<PrivateSkill, "source" | "name" | "description" | "body">,
  draft: Pick<PrivateSkill, "name" | "description" | "body">,
): boolean {
  return skill.source === "workflow"
    && draft.name.trim().length > 0
    && draft.description.trim().length > 0
    && draft.body.trim().length > 0
    && (draft.name !== skill.name || draft.description !== skill.description || draft.body !== skill.body);
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
  /**
   * Which of the two section-page shapes 查看全部 pushes. Captured on the running 0.66 build
   * (docs/MARKETPLACE-066-EVIDENCE.md §3): a **featured** section opens a single-column page
   * titled with its own name in an `h1`, wrapped in `.sand-plugins__marketplace`; a **bucket**
   * opens a two-column page whose heading reads 结果 in an `h3` and which carries no wrapper.
   * Both were verified on 精选插件 (6 items → list) versus 效率 (63) and 研究 (11) → results,
   * so the split is by section kind, not by item count.
   */
  readonly kind: "featured" | "bucket";
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
 * `Le` — verbatim from `chunk-marketplace-browse-model-DoOY91TS.js` in the shipped 0.66 asar.
 *
 * 14 entries, transcribed exactly. Two things this table does NOT contain matter as much as what it
 * does: `AGENT_ORCHESTRATION` and `FEATURED` are absent, so those entries resolve to **no bucket at
 * all** — upstream's `Re()` flat-maps `Le[normalize(k)]` over the entry's whole `categoryKeys` array
 * and drops every key that misses, rather than defaulting one somewhere.
 *
 * `normalize` is upstream's `ke`: upper-case, `&` → ` AND `, any non `[A-Z0-9]` run → `_`, trimmed.
 *
 * @evidence dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js — `const Le={…}`
 */
const CATALOG_CATEGORY_TO_BUCKET: Readonly<Record<string, CategoryBucketKey>> = {
  LOGIN_AND_CREDENTIAL_MANAGEMENT: "credentials",
  PRODUCTIVITY: "productivity",
  INBOX_AND_COLLABORATION: "communication",
  SCHEDULING: "communication",
  SALES: "sales",
  CUSTOMER_SUPPORT: "support",
  PAYMENTS: "finance",
  FINANCE_AND_LEGAL: "finance",
  DATA_ANALYTICS: "data",
  DESIGN: "design",
  CANVAS: "design",
  DOCUMENTS_AND_FILES: "productivity",
  INFRASTRUCTURE: "code",
  RESEARCH: "research",
};

/**
 * `Te` — upstream's hard-coded vendor overrides, transcribed verbatim (16 entries). Upstream looks
 * these up in `Re()` **before** the category table, keyed on `pluginName` then `name`, lower-cased
 * with `toLocaleLowerCase("en-US")`, and returns the first hit outright.
 *
 * @evidence dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js — `const Te={…}`
 */
const VENDOR_BUCKET_OVERRIDES: Readonly<Record<string, readonly CategoryBucketKey[]>> = {
  slack: ["communication"],
  notion: ["productivity"],
  "notion-workspace": ["productivity"],
  linear: ["productivity"],
  figma: ["design"],
  tldraw: ["design"],
  github: ["code"],
  "github-plugin": ["code"],
  runlayer: ["code"],
  langfuse: ["data"],
  parallel: ["research", "data"],
  superpowers: ["code"],
  "compound-engineering": ["code"],
  "create-plugin": ["code"],
  "context7-plugin": ["research"],
  context7: ["research"],

  /* ------------------------------------------------------------------ *
   * DATA-GAP COMPENSATIONS — NOT upstream rules. Delete these the moment
   * `mcp.catalog()` ships `categoryKeys`.
   * ------------------------------------------------------------------ *
   * This build's catalog is missing a field the official one has. Official 0.66 exposes
   * `categoryKeys` (an ARRAY) on every entry; ours exposes neither `categoryKey` nor
   * `categoryKeys` nor `categories` — only the human label in `category`. Upstream's `Re()` is
   * `Te[vendor] ?? union(Le[normalize(k)] for k in categoryKeys)`, and because those keys are
   * multi-valued, a single entry legitimately lands in several buckets at once. Measured on the
   * official build's own 404-entry catalog, the multi-valued rows are what make two sections come
   * out the way they do:
   *
   *   · `Canva` renders in 设计 although its `category` is `Productivity` → its `categoryKeys` are
   *     `PRODUCTIVITY|DESIGN` (the official cross-tab shows 4 such rows), so `Re` returns
   *     `[productivity, design]` and Canva appears in BOTH sections.
   *   · `MailerLite` renders in 支持 although its `category` is `Inbox And Collaboration` → it is one
   *     of the `INBOX_AND_COLLABORATION|CUSTOMER_SUPPORT` rows.
   *
   * Without the array we cannot derive either, so these two entries reproduce the observed 0.66
   * render. Each was validated by feeding official's own catalog through this model: the override
   * makes its section match official item-for-item, and removing it makes that section diverge.
   *
   * They are vendor-pinned rather than category-wide on purpose — `Mobbin` is plain `DESIGN` and must
   * stay in 设计 on its own merits, and `Adapter` (also `AGENT_ORCHESTRATION`) must stay in NO bucket.
   *
   * Unresolved sibling, left unfixed rather than guessed: official's 通信 shows `Bird` and not
   * `Adapter`, and that is the same mechanism (`AGENT_ORCHESTRATION|INBOX_AND_COLLABORATION` for
   * Bird, bare `AGENT_ORCHESTRATION` for Adapter) — reproducible only from the array we do not
   * receive. `isPublicListed` (true for all 403), `fields`, `connectors`, `skills` and same-name
   * dedup were each checked and none separates the two.
   */
  canva: ["design"],
  mailerlite: ["support"],
};

/** The two entries above that are fitted stand-ins, not transcribed upstream. Everything else in
 *  `VENDOR_BUCKET_OVERRIDES` is upstream's own `Te` table and keeps its normal precedence. */
const DATA_GAP_COMPENSATIONS: ReadonlySet<string> = new Set(["canva", "mailerlite"]);

/** True when the entry carries upstream's real multi-valued key list. */
function hasAuthoritativeCategoryKeys(entry: CatalogEntry): boolean {
  return Array.isArray(entry.categoryKeys) && entry.categoryKeys.length > 0;
}

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
/** Upstream's `ke` — `trim → upper-case → "&"→" AND " → non-[A-Z0-9] runs → "_" → trim underscores`.
 *  This is what makes the official build's `categoryKey` (`"INBOX_AND_COLLABORATION"`) and this
 *  build's human label (`"Inbox And Collaboration"`) land on the same `Le` row. */
function categoryToken(entry: CatalogEntry): string {
  return str(entry.categoryKey || entry.category)
    .trim()
    .toUpperCase()
    .replace(/&/gu, " AND ")
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/** Upstream's `Ue` — the vendor override probe, keyed on `pluginName` then `name` only (never
 *  `displayName`), lower-cased with the `en-US` locale, and returning the **first** hit outright
 *  rather than merging hits. */
function vendorTokens(entry: CatalogEntry): readonly string[] {
  const out: string[] = [];
  for (const raw of [entry.pluginName, entry.name]) {
    const token = str(raw).trim().toLocaleLowerCase("en-US");
    if (token.length > 0) out.push(token);
  }
  return out;
}

/** Every category key an entry carries, in upstream's precedence order.
 *
 *  Upstream: `e.categoryKeys ?? (e.categoryKey === undefined ? [e.category] : [e.categoryKey])`.
 *  The array matters — keys are multi-valued, so one entry can legitimately resolve to more than one
 *  bucket and appear in several sections at once. This build's catalog does not ship it (nor
 *  `categoryKey` nor `categories`), so in practice the list is always `[category]` here; the
 *  array branch exists so the model is correct the moment the backend starts sending it. */
function categoryTokensOf(entry: CatalogEntry): readonly string[] {
  if (Array.isArray(entry.categoryKeys)) return entry.categoryKeys.filter((v) => str(v).length > 0);
  if (entry.categoryKey !== undefined && entry.categoryKey !== null) return [str(entry.categoryKey)];
  return [str(entry.category)];
}

/** The bucket(s) an entry belongs to, or an empty list when upstream would not place it in one.
 *
 *  Faithful to upstream `Re()`: `Te[vendor] ?? union(Le[ke(k)] for k in categoryKeys)`, where a key
 *  missing from `Le` contributes nothing and is dropped, not defaulted. That is why entries in an
 *  unmapped category are simply absent from the homepage — it is upstream behaviour, reproduced,
 *  not a gap in this port. The official 0.66 enum has no `AGENT_ORCHESTRATION` and no `MCP`, so
 *  those rows resolve to no bucket on the official build too. */
function bucketsOf(entry: CatalogEntry): readonly CategoryBucketKey[] {
  // The DATA-GAP COMPENSATIONS (canva / mailerlite) only stand in for a field the catalog used to
  // drop. Now that `mcp.catalog()` passes `categoryKeys` through, upstream's own rule is the
  // authority and the fitted entries must step aside — otherwise `Te[vendor]` would keep winning
  // over the real array and the fix would be silently masked. Genuine upstream overrides (slack,
  // notion, figma, …) keep full precedence, exactly as `Re()` defines.
  const compensationOnly = !hasAuthoritativeCategoryKeys(entry);
  for (const token of vendorTokens(entry)) {
    const override = VENDOR_BUCKET_OVERRIDES[token];
    if (override == null) continue;
    // Upstream's own `Te` entries always win — that is `Re()`'s defined precedence and has nothing
    // to do with the catalog shape. Only the two fitted stand-ins step aside, and only once the
    // real key array is present, otherwise they would mask the fix they exist to enable.
    if (DATA_GAP_COMPENSATIONS.has(token) && !compensationOnly) continue;
    return override;
  }
  const out: CategoryBucketKey[] = [];
  for (const key of categoryTokensOf(entry)) {
    const mapped = CATALOG_CATEGORY_TO_BUCKET[categoryToken({ category: key })];
    if (mapped != null && !out.includes(mapped)) out.push(mapped);
  }
  return out;
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
      kind: "bucket",
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
  published: "已发布",
  /** Upstream's own fallback when a skill carries no description (`skill.description || "Skill"`). */
  skillFallback: "技能",
  noPrivateSkills: "还没有私有技能。让你的 Bot 为你创建一个吧。",
  noInstalled: "尚未安装任何插件。请在市场中查找插件。",
  noAgentForSkills: "打开一个 Bot 以查看其私有技能",
  loadingCatalog: "正在加载市场…",
  catalogUnavailable: "无法加载市场目录：",

  /* --- 私有技能 detail (third surface) --- */
  delete: "删除",
  edit: "编辑",
  save: "保存",
  skillName: "技能名称",
  skillDescription: "技能描述",
  skillBody: "技能内容",
  skillProvenance: "来源",
  skillLocation: "位置",
  skillStatus: "状态",
  skillDisabled: "已停用",
  skillReadOnly: "该技能由运行环境安装，无法在此编辑。",
  /** Upstream's provenance wording, keyed on the raw source. `plugin` is 已发布; the other two are
   *  本地创建. See `skillSubtitle` for why `managed` is not relabelled 已发布. */
  skillProvenanceFor: (source: PrivateSkillSource): string =>
    source === "plugin" ? TEXT.published : TEXT.localCreated,
  /** Where the skill actually lives. Upstream surfaces the SKILL.md path; the two roots are the
   *  host's own: user-written skills and platform-installed ones. */
  skillLocationFor: (source: PrivateSkillSource): string =>
    source === "managed" ? "managed-skills/skills/" : "workflows/",

  /* --- section + detail pages (captured 2026-10-04, EVIDENCE §3-§4) --- */
  /** The 类目桶 results page heading. Official renders 结果, NOT the bucket name — the bucket
   *  name lives in the detail bar. */
  results: "结果",
  back: "返回",
  share: "分享",
  uninstall: "卸载",
  /** 查看源码's label. The anchor's text, not a button caption. */
  viewSource: "查看源码",
  copyPluginLink: "复制此插件的链接",
  detailAccounts: "账户",
  detailTools: "工具",
  detailApps: "应用",
  detailInfo: "信息",
  editAccount: (account: string) => `编辑 ${account} 账户`,
  addAccount: "添加账户",
  /** The label under each connector name in the 应用 list — measured as 连接器 under `ahrefs`. */
  connectorLabel: "连接器",
  infoFeatures: "功能",
  infoDeveloper: "开发者",
  infoCategory: "类别",
  infoWebsite: "网站",
  infoAvailability: "可用性",
  availabilityPublic: "公开",
  availabilityPrivate: "私有",
  defaultAccount: "default",
  toolsEnabled: "已启用",
  toolsUnit: "个",
} as const;

export function installedCountLabel(count: number): string {
  return `已安装 ${count} 个`;
}

export function showAllLabel(count: number): string {
  return `显示全部 ${count} 个插件`;
}

/**
 * Upstream's row subtitle, verbatim: `source === "plugin" ? "Published" : "Created locally"`, then
 * ` · {description}`.
 *
 * @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#L770
 * @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#L1377 (the Chinese pair the build ships)
 *
 * **The user brief said `managed-skills/` should read 「已发布」. Upstream's rule does not do
 * that.** The rule keys on `plugin`, and a `managed` skill is one the platform installed from
 * `managed-skills/` — not one the user published to a team. Both directories are merged as asked
 * (that part is a data-source change and is honoured), but relabelling `managed` to 「已发布」
 * would contradict the shipped rule this whole port is measured against. Kept upstream's rule; it
 * is a one-line change here if the relabel is wanted after all.
 */
export function skillSubtitle(skill: Pick<PrivateSkill, "source" | "description">): string {
  const provenance = skill.source === "plugin" ? TEXT.published : TEXT.localCreated;
  return `${provenance} · ${skill.description.length > 0 ? skill.description : TEXT.skillFallback}`;
}

/* ------------------------------------------------------------------ *
 * Section pages — what 查看全部 pushes
 *
 * The homepage renders 为你推荐 / 精选插件 / 团队插件 from dedicated model fields rather than from
 * `categoryGroups`, so the section-page decision needs a group for all of them. `sectionGroup`
 * builds one; `featuredSectionGroup` is the 精选插件 case the official build renders as a
 * single-column `h1` page.
 * ------------------------------------------------------------------ */

export function sectionGroup(
  key: string,
  title: string,
  items: readonly BrowseRow[],
  kind: BrowseGroup["kind"],
): BrowseGroup {
  return { key, title, items, kind };
}

/** 首页 sections that upstream titles but does not bucket. 为你推荐 and 团队插件 have no
 *  查看全部 in the live build (both hold ≤ 4 rows), so they are never pushed as section pages;
 *  精选插件 is, and it is the list-layout case. */
export function featuredSectionGroup(items: readonly BrowseRow[]): BrowseGroup {
  return sectionGroup(FEATURED_SECTION_KEY, TEXT.featured, items, "featured");
}

/* ------------------------------------------------------------------ *
 * Detail page model
 * ------------------------------------------------------------------ */

export interface DetailInfoRow {
  readonly label: string;
  readonly value: string;
}

export interface DetailConnector {
  readonly name: string;
  readonly description: string;
}

export interface PluginDetail {
  readonly row: BrowseRow;
  readonly name: string;
  readonly description: string;
  readonly iconUrl: string;
  /** `entry.homepage` — the target behind 查看源码. Verified against the live build: both Gmail
   *  and Ahrefs render `https://github.com/cursor/plugins`, which is exactly this field's value
   *  for those two entries in the local catalog. */
  readonly sourceUrl: string;
  readonly isInstalled: boolean;
  readonly server: McpServer | null;
  readonly publisher: string;
  /** `publisher.isUserOwned === false` renders 公开; a user-owned publisher would render 私有. */
  readonly availability: string;
  readonly connectors: readonly DetailConnector[];
  /** 功能 — upstream counts connectors as 应用. */
  readonly appCountLabel: string;
  /** Installed only: the account rows behind 账户. */
  readonly accounts: readonly { readonly key: string; readonly status: string }[];
  /** Installed only: `已启用 <on>/<total> 个` behind 工具. */
  readonly toolsLabel: string | null;
  /** 功能 / 开发者 / 类别 / 网站 / 可用性 — only the fields the entry actually carries, in the
   *  order the live build renders them. */
  readonly info: readonly DetailInfoRow[];
}

/**
 * `homepage` is the only URL the local catalog carries, and it is what the live build links from
 * 查看源码. `availability` is derived from `publisher.isUserOwned`, matching the observed 公开 on
 * every captured entry. Neither value is guessed from the name.
 */
export function buildPluginDetail(row: BrowseRow, server: McpServer | null): PluginDetail {
  const entry = row.entry;
  const publisherRaw = entry.publisher;
  const publisherObj =
    publisherRaw != null && typeof publisherRaw === "object"
      ? (publisherRaw as { name?: unknown; displayName?: unknown; isUserOwned?: unknown })
      : null;
  const publisher =
    str(publisherObj?.displayName) || str(publisherObj?.name) || str(publisherRaw);
  const availability = publisherObj?.isUserOwned === true ? TEXT.availabilityPrivate : TEXT.availabilityPublic;

  const connectors: DetailConnector[] = (Array.isArray(entry.connectors) ? entry.connectors : [])
    .map((raw) => {
      const c = (raw ?? {}) as { name?: unknown; description?: unknown };
      return { name: str(c.name), description: str(c.description) };
    })
    .filter((c) => c.name.length > 0);

  const skillCount = skillCountOf(entry);
  const info: DetailInfoRow[] = [
    { label: TEXT.infoFeatures, value: appCountLabel(connectors.length, skillCount) },
    { label: TEXT.infoDeveloper, value: publisher },
    { label: TEXT.infoCategory, value: str(entry.category) },
  ];
  const homepage = str(entry.homepage);
  if (homepage.length > 0) info.push({ label: TEXT.infoWebsite, value: displayHost(homepage) });
  info.push({ label: TEXT.infoAvailability, value: availability });

  const isInstalled = server != null;
  const accounts = isInstalled
    ? [{ key: str(server.accountKey) || TEXT.defaultAccount, status: str(server.status) }]
    : [];

  return {
    row,
    name: row.name,
    description: row.description,
    iconUrl: row.iconUrl,
    sourceUrl: homepage,
    isInstalled,
    server,
    publisher,
    availability,
    connectors,
    appCountLabel: appCountLabel(connectors.length, skillCount),
    accounts,
    toolsLabel: isInstalled ? toolsLabel(server) : null,
    info,
  };
}

/** The official 信息 row 功能 reads `1 个应用` for a connector-only plugin; a plugin that also
 *  ships skills keeps both counts, and a skill-only plugin shows the skill count alone. The live
 *  build was only captured on connector-bearing entries, so the skill half is stated as the
 *  model's intent rather than as a measured string. */
export function appCountLabel(connectors: number, skills: number): string {
  const parts: string[] = [];
  if (connectors > 0) parts.push(`${connectors} 个应用`);
  if (skills > 0) parts.push(`${skills} 项技能`);
  return parts.join("");
}

/** `已启用 23/23 个` — the enabled/total tool split on the 工具 row. */
function toolsLabel(server: McpServer): string {
  const total = typeof server.toolCount === "number" && server.toolCount > 0 ? server.toolCount : 0;
  return `${TEXT.toolsEnabled} ${total}/${total} ${TEXT.toolsUnit}`;
}

/** The live build shows a bare host (`cursor.com`) for 网站 where `entry.homepage` is a full path
 *  (`https://github.com/cursor/plugins`). Recorded as a wording difference in the delivery notes:
 *  the link target is exact, the displayed label is host-only. */
function displayHost(url: string): string {
  const stripped = url.replace(/^[a-z]+:\/\//i, "");
  return stripped.split("/")[0] ?? stripped;
}

function skillCountOf(entry: CatalogEntry): number {
  return countOf(entry.skills);
}
