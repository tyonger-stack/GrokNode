import type { ExternalDocumentId } from "./external-doc-url-utils.js";
import { hostMatches, matched, segments } from "./external-doc-url-utils.js";

export function parseBoxUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "box.com")) return null;
  const [type, id] = segments(url);
  const file = type === "file" || type === "notes" ? matched(id ?? "", /^\d+$/) : null;
  return file === null ? null : { provider: "box", externalId: file, url: "https://app.box.com/" + type + "/" + file };
}

export function parseDropboxUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "dropbox.com")) return null;
  const [first, second, third] = segments(url);
  const id = first === "s" ? second : first === "scl" && second === "fi" ? third : undefined;
  const rlkey = matched(url.searchParams.get("rlkey") ?? "", /^[A-Za-z0-9]+$/);
  if (id === undefined) return null;
  return { provider: "dropbox", externalId: id, url: url.origin + url.pathname + (rlkey === null ? "" : "?rlkey=" + rlkey) };
}

const AIRTABLE_ID = /^app[A-Za-z0-9]{14}$/;
function airtableId(value: string): ExternalDocumentId | null {
  const id = matched(value.trim(), AIRTABLE_ID);
  return id === null ? null : { provider: "airtable", externalId: id, url: "https://airtable.com/" + id };
}
export function parseAirtableUrl(url: URL): ExternalDocumentId | null {
  return hostMatches(url.hostname, "airtable.com") ? airtableId(segments(url)[0] ?? "") : null;
}
export function airtableDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? airtableId(value) : null;
}

export function parseCodaUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "coda.io")) return null;
  const [type, tail] = segments(url);
  const id = type === "d" ? /_d([A-Za-z0-9_-]{6,})$/.exec(tail ?? "")?.[1] : undefined;
  return id === undefined ? null : { provider: "coda", externalId: id, url: "https://coda.io/d/_d" + id };
}

const MIRO_ID = /^[A-Za-z0-9_=-]{8,}$/;
function miroId(value: string): ExternalDocumentId | null {
  const id = matched(value.trim(), MIRO_ID);
  return id === null ? null : { provider: "miro", externalId: id, url: "https://miro.com/app/board/" + id + "/" };
}
export function parseMiroUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "miro.com")) return null;
  const [type, board, id] = segments(url);
  return type === "app" && board === "board" && id !== undefined ? miroId(id) : null;
}
export function miroDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? miroId(value) : null;
}

const CANVA_ID = /^DA[A-Za-z0-9_-]{6,}$/;
function canvaId(value: string): ExternalDocumentId | null {
  const id = matched(value.trim(), CANVA_ID);
  return id === null ? null : { provider: "canva", externalId: id, url: "https://www.canva.com/design/" + id + "/edit" };
}
export function parseCanvaUrl(url: URL): ExternalDocumentId | null {
  if (!hostMatches(url.hostname, "canva.com")) return null;
  const [type, id] = segments(url);
  return type === "design" && id !== undefined ? canvaId(id) : null;
}
export function canvaDocumentId(value: unknown): ExternalDocumentId | null {
  return typeof value === "string" ? canvaId(value) : null;
}

export function parseHexUrl(url: URL): ExternalDocumentId | null {
  if (url.hostname !== "app.hex.tech") return null;
  const [workspace, type, tail] = segments(url);
  const id = type === "hex" || type === "app" ? matched(tail ?? "", /^[0-9a-f-]{16,}$/i) : null;
  if (workspace === undefined || id === null) return null;
  return { provider: "hex", externalId: id, url: "https://app.hex.tech/" + workspace + "/" + type + "/" + id };
}
