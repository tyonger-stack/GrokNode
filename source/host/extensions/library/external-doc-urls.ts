import type { LibraryExternalProvider } from "../../../shared/library-contracts.js";
import { parseAirtableUrl, parseBoxUrl, parseCanvaUrl, parseCodaUrl, parseDropboxUrl, parseHexUrl, parseMiroUrl } from "./external-doc-cloud-urls.js";
import { hostMatches, matched, segments, type ExternalDocumentId } from "./external-doc-url-utils.js";

export type { ExternalDocumentId };

const NOTION_32 = /^[0-9a-f]{32}$/i;
const NOTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTION_TRAILING = /(?:^|-)([0-9a-f]{32})$/i;

function notionId(value: string): ExternalDocumentId | null {
  const trimmed = value.trim();
  const id = NOTION_32.test(trimmed)
    ? trimmed.toLowerCase()
    : NOTION_UUID.test(trimmed)
      ? trimmed.replaceAll("-", "").toLowerCase()
      : null;
  return id === null ? null : { provider: "notion", externalId: id, url: "https://www.notion.so/" + id };
}

function parseNotionUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "notion.so") && !hostMatches(url.hostname, "notion.com")) return null;
  const queryId = url.searchParams.get("p");
  if (queryId !== null) return notionId(queryId);
  const last = segments(url).at(-1);
  if (last === undefined) return null;
  return notionId(last) ?? notionId(NOTION_TRAILING.exec(last)?.[1] ?? "");
}

const GOOGLE_ID = /^[A-Za-z0-9_-]{10,}$/;
const GOOGLE_KINDS: Readonly<Record<string, LibraryExternalProvider>> = {
  document: "google-docs", spreadsheets: "google-sheets", presentation: "google-slides",
} as const satisfies Record<string, LibraryExternalProvider>;

function googleId(kind: string, value: string): ExternalDocumentId | null {
  const id = matched(value.trim(), GOOGLE_ID);
  if (id === null) return null;
  return kind === "file"
    ? { provider: "google-drive", externalId: id, url: "https://drive.google.com/file/d/" + id + "/view" }
    : { provider: GOOGLE_KINDS[kind] ?? "google-drive", externalId: id, url: "https://docs.google.com/" + kind + "/d/" + id + "/edit" };
}

function parseGoogleUrl(url: URL): ExternalDocumentId | null {
  const path = segments(url);
  const idIndex = path.indexOf("d");
  const id = idIndex === -1 ? undefined : path[idIndex + 1];
  if (url.hostname === "docs.google.com") {
    const kind = path[0];
    if (kind !== "document" && kind !== "spreadsheets" && kind !== "presentation" || id === undefined) return null;
    return googleId(kind, id);
  }
  if (url.hostname !== "drive.google.com") return null;
  if (path[0] === "file" && id !== undefined) return googleId("file", id);
  if (path[0] === "open") return googleId("file", url.searchParams.get("id") ?? "");
  return null;
}

export function googleDestinationSpreadsheet(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? googleId("spreadsheets", value) : null;
}

export function googleDocumentArgumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? googleId("document", value) : null;
}

export function googlePresentationArgumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? googleId("presentation", value) : null;
}

function parseMicrosoftUrl(url: URL): ExternalDocumentId | null {
  const host = url.hostname.toLowerCase();
  if (host === "onedrive.live.com") {
    const id = url.searchParams.get("resid") ?? url.searchParams.get("id");
    return id === null ? null : { provider: "onedrive", externalId: id, url: "https://onedrive.live.com/?id=" + encodeURIComponent(id) };
  }
  if (host === "1drv.ms" && url.pathname.length > 1) {
    return { provider: "onedrive", externalId: url.pathname, url: "https://1drv.ms" + url.pathname };
  }
  if (!hostMatches(host, "sharepoint.com") || url.pathname.length <= 1) return null;
  return {
    provider: host.endsWith("-my.sharepoint.com") ? "onedrive" : "sharepoint",
    externalId: host + url.pathname,
    url: "https://" + host + url.pathname,
  };
}

const FIGMA_KINDS: Readonly<Record<string, LibraryExternalProvider>> = {
  design: "figma", file: "figma", make: "figma", proto: "figma", board: "figjam", slides: "figma-slides",
} as const satisfies Record<string, LibraryExternalProvider>;
const FIGMA_ID = /^[A-Za-z0-9]{10,}$/;

function figmaId(value: string): ExternalDocumentId | null {
  const id = matched(value.trim(), FIGMA_ID);
  return id === null ? null : { provider: "figma", externalId: id, url: "https://www.figma.com/file/" + id };
}

function parseFigmaUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "figma.com")) return null;
  const [kind, id] = segments(url);
  const provider = kind === undefined ? undefined : FIGMA_KINDS[kind];
  if (provider === undefined || id === undefined || !FIGMA_ID.test(id)) return null;
  return { provider, externalId: id, url: "https://www.figma.com/" + kind + "/" + id };
}

const LINEAR_ISSUE = /^[A-Z][A-Z0-9]*-\d+$/;

function parseLinearUrl(url: URL): ExternalDocumentId | null {
  if (url.hostname !== "linear.app") return null;
  const [team, type, tail] = segments(url);
  if (team === undefined || tail === undefined) return null;
  if (type === "issue" && LINEAR_ISSUE.test(tail)) {
    return { provider: "linear-issue", externalId: team + "/" + tail, url: "https://linear.app/" + team + "/issue/" + tail };
  }
  const documentId = type === "document" ? /-([0-9a-f]{8,})$/i.exec(tail)?.[1] : undefined;
  if (documentId === undefined) return null;
  return { provider: "linear-document", externalId: team + "/" + documentId, url: "https://linear.app/" + team + "/document/" + tail };
}

function parseAtlassianUrl(url: URL): ExternalDocumentId | null {
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".atlassian.net")) return null;
  const path = segments(url);
  if (path[0] === "browse" && LINEAR_ISSUE.test(path[1] ?? "")) {
    const issue = path[1] ?? "";
    return { provider: "jira-issue", externalId: host + "/" + issue, url: "https://" + host + "/browse/" + issue };
  }
  const pages = path.indexOf("pages");
  const pageId = path[0] === "wiki" && pages !== -1 ? matched(path[pages + 1] ?? "", /^\d+$/) : null;
  if (pageId === null) return null;
  return {
    provider: "confluence-page", externalId: host + "/" + pageId,
    url: "https://" + host + "/wiki/" + path.slice(1, pages + 2).join("/"),
  };
}

function parseGitHubUrl(url: URL): ExternalDocumentId | null {
  const path = segments(url);
  if (url.hostname === "gist.github.com") {
    const id = matched(path.at(-1) ?? "", /^[0-9a-f]{20,}$/i);
    return id === null ? null : { provider: "github-gist", externalId: id, url: "https://gist.github.com/" + id };
  }
  if (url.hostname !== "github.com") return null;
  const [owner, repository, type, number, ...filePath] = path;
  if (owner === undefined || repository === undefined || number === undefined) return null;
  if (type === "pull" && /^\d+$/.test(number)) {
    return { provider: "github-pull-request", externalId: owner + "/" + repository + "/pull/" + number, url: "https://github.com/" + owner + "/" + repository + "/pull/" + number };
  }
  if (type === "issues" && /^\d+$/.test(number)) {
    return { provider: "github-issue", externalId: owner + "/" + repository + "#" + number, url: "https://github.com/" + owner + "/" + repository + "/issues/" + number };
  }
  if (type !== "blob" || filePath.length === 0) return null;
  const id = owner + "/" + repository + "/blob/" + number + "/" + filePath.join("/");
  return { provider: "github-file", externalId: id, url: "https://github.com/" + id };
}

const GITHUB_PART = /^[A-Za-z0-9_.-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const property = value[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

export function githubPushFiles(value: unknown): readonly ExternalDocumentId[] {
  const owner = matched(stringProperty(value, "owner") ?? "", GITHUB_PART);
  const repository = matched(stringProperty(value, "repo") ?? "", GITHUB_PART);
  const branch = stringProperty(value, "branch");
  const files = isRecord(value) && Array.isArray(value.files) ? value.files : [];
  if (owner === null || repository === null || branch === undefined) return [];
  return files.flatMap(file => {
    const path = stringProperty(file, "path");
    if (path === undefined) return [];
    const parts = [...branch.split("/"), ...path.split("/")];
    if (parts.includes("..")) return [];
    const encoded = parts.map(part => encodeURIComponent(part)).join("/");
    return [parseGitHubUrl(new URL("https://github.com/" + owner + "/" + repository + "/blob/" + encoded))].flatMap(id => id === null ? [] : [id]);
  });
}

function parseSlackUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "slack.com")) return null;
  const [type, channel, tail] = segments(url);
  if (type === "archives") {
    if (channel === undefined || matched(channel, /^[CDG][A-Z0-9]{6,}$/) === null || tail === undefined || !/^p\d{16}$/.test(tail)) return null;
    return { provider: "slack-message", externalId: channel + "/" + tail, url: url.origin + "/archives/" + channel + "/" + tail };
  }
  if (type !== "docs" || channel === undefined || matched(tail ?? "", /^F[A-Z0-9]{6,}$/) === null) return null;
  return { provider: "slack-canvas", externalId: channel + "/" + tail, url: url.origin + "/docs/" + channel + "/" + tail };
}

export function gmailDraftId(value: unknown): ExternalDocumentId | null {
  if (typeof value !== "string") return null;
  const id = matched(value.trim(), /^[A-Za-z0-9_-]{6,}$/);
  return id === null ? null : { provider: "gmail-draft", externalId: id, url: "https://mail.google.com/mail/#drafts" };
}

export function googleCalendarEventId(value: unknown): ExternalDocumentId | null {
  if (typeof value !== "string") return null;
  const id = matched(value.replaceAll(" ", "+"), /^[A-Za-z0-9+/_=-]{8,}$/);
  return id === null ? null : { provider: "google-calendar-event", externalId: id, url: "https://calendar.google.com/calendar/event?eid=" + encodeURIComponent(id) };
}

function parseGoogleCalendarUrl(url: URL): ExternalDocumentId | null {
  const host = url.hostname.toLowerCase();
  if (host !== "calendar.google.com" && host !== "www.google.com") return null;
  if (url.pathname !== "/calendar/event") return null;
  return googleCalendarEventId(url.searchParams.get("eid") ?? "");
}

export function notionDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? notionId(value) : null;
}

export function googleDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? googleId("file", value) : null;
}

export function figmaDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? figmaId(value) : null;
}

export const externalUrlParsers = {
  notion: parseNotionUrl,
  google: parseGoogleUrl,
  gmail: null,
  "google-calendar": parseGoogleCalendarUrl,
  microsoft: parseMicrosoftUrl,
  figma: parseFigmaUrl,
  linear: parseLinearUrl,
  atlassian: parseAtlassianUrl,
  github: parseGitHubUrl,
  slack: parseSlackUrl,
  box: parseBoxUrl,
  dropbox: parseDropboxUrl,
  airtable: parseAirtableUrl,
  coda: parseCodaUrl,
  miro: parseMiroUrl,
  canva: parseCanvaUrl,
  hex: parseHexUrl,
} as const;
