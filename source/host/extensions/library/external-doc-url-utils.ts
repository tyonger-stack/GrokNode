import type { LibraryExternalProvider } from "../../../shared/library-contracts.js";

export type ExternalDocumentId = {
  readonly provider: LibraryExternalProvider;
  readonly externalId: string;
  readonly url: string;
};

export function segments(url: URL): string[] {
  return url.pathname.split("/").filter(part => part.length > 0);
}

export function hostMatches(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith("." + expected);
}

export function matched(value: string, pattern: RegExp): string | null {
  return pattern.test(value) ? value : null;
}
