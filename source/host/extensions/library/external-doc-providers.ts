import type { LibraryExternalDoc, LibraryExternalProvider } from "../../../shared/library-contracts.js";
import { libraryExternalProviderSchema } from "../../../shared/library/schemas.js";
import { externalConnectorSpecs, type ExternalConnectorId } from "./external-doc-provider-table.js";
import type { ExternalDocumentId } from "./external-doc-urls.js";

export type { ExternalConnectorId, ExternalDocumentId };
export const originalExternalProviders = [
  "notion", "google-docs", "google-sheets", "google-slides", "google-drive", "onedrive", "sharepoint",
  "figma", "figjam", "figma-slides", "linear-issue", "linear-document", "confluence-page", "jira-issue",
  "github-file", "github-gist", "github-issue", "slack-canvas", "box", "dropbox", "airtable", "coda", "miro",
  "canva", "hex", "gmail-draft", "google-calendar-event", "slack-message", "github-pull-request", "web",
] as const satisfies readonly LibraryExternalProvider[];

export function normalizeExternalProvider(value: string): LibraryExternalProvider {
  const parsed = libraryExternalProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : "other";
}

export function findExternalConnector(name: string): ExternalConnectorId | null {
  const normalized = name.trim().toLowerCase();
  for (const entry of externalConnectorSpecs) {
    if (entry.spec.names.includes(normalized)) return entry.id;
  }
  return null;
}

export function parseExternalDocumentUrl(value: string): ExternalDocumentId | null {
  const url = URL.parse(value.trim());
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  for (const entry of externalConnectorSpecs) {
    const document = entry.spec.parseUrl?.(url);
    if (document !== null && document !== undefined) return document;
  }
  return null;
}

export function externalDocumentKey(document: ExternalDocumentId): string {
  return document.provider + ":" + document.externalId;
}

export function sortExternalDocs(docs: readonly LibraryExternalDoc[]): readonly LibraryExternalDoc[] {
  return docs.toSorted((left, right) => left.lastTouchedAtMs !== right.lastTouchedAtMs
    ? right.lastTouchedAtMs - left.lastTouchedAtMs
    : left.key.localeCompare(right.key));
}

