/**
 * Task 7: faithful Node projection of the original v1 media rules
 * (R FRe@1581347 with QF@1580279/RS@1580355/excSet@1579923, BRe files,
 * LRe links; golden vectors in tests/fixtures/library-parity-*.json).
 *
 * QF/RS exclude user uploads and returned artifacts. kN reads Markdown and
 * structured images; BRe reads file attachments; LRe normalizes links.
 * Null messages retain the existing hardening guard (original throws).
 */
export type TranscriptMediaKind = "image" | "video" | "file" | "link";
export interface TranscriptMediaItem {
  readonly id: string;
  readonly kind: TranscriptMediaKind;
  readonly timestampMs: number | null;
  readonly source: string;
  readonly name: string;
}
export interface TranscriptLinkItem {
  readonly id: string;
  readonly kind: "link";
  readonly timestampMs: number | null;
  readonly url: string;
}
export type TranscriptMediaRow = TranscriptMediaItem | TranscriptLinkItem;
export interface TranscriptMediaImage { readonly url?: string; readonly alt?: string | null }
export interface TranscriptMediaMessage {
  readonly type?: string;
  readonly content?: string;
  readonly images?: readonly TranscriptMediaImage[];
  readonly url?: string;
  readonly alt?: string | null;
  readonly file_name?: string | null;
}
export interface TranscriptMediaEntry {
  readonly id: string;
  readonly kind: string;
  readonly role?: string;
  readonly content?: string;
  readonly streaming?: boolean;
  readonly fromAgent?: unknown;
  readonly author?: { readonly kind?: string };
  readonly cloudAgentArtifacts?: readonly unknown[];
  readonly timestampMs?: number | null;
  readonly message?: TranscriptMediaMessage | null;
  readonly file_path?: string;
  readonly file_name?: string | null;
  readonly images?: readonly TranscriptMediaImage[];
}

export function normalizeMediaSource(value: string): string {
  const trimmed = value.trim();
  if (!/^file:/i.test(trimmed)) return trimmed;
  let parsed: URL | null = null;
  try { parsed = new URL(trimmed); } catch { return trimmed; }
  if (parsed.protocol !== "file:") return trimmed;
  try { return decodeURIComponent(parsed.pathname); } catch { return parsed.pathname; }
}
export function mediaBasename(source: string): string {
  let decoded = source;
  try { const url = new URL(source); if (url.protocol === "file:") decoded = decodeURIComponent(url.pathname); } catch { /* original Eee keeps the raw source */ }
  const parts = decoded.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : source;
}
export function mediaName(name: string | null | undefined, source: string): string {
  if (name == null || name.trim().length === 0) return mediaBasename(source);
  return name;
}
export function isVideoSource(source: string): boolean {
  return VIDEO_EXTENSIONS.has(sourceExtension(source));
}

function sourceExtension(source: string): string {
  let rest = source;
  try { rest = new URL(source).pathname; } catch { /* relative paths stay whole */ }
  const lower = rest.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg",
  ".png", ".svg", ".webp", ".heic", ".heif",
]);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".m4v", ".mov", ".mp4", ".ogv", ".webm",
]);

function isSandUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("sand://");
}

function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.length === 0) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function probeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed) || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.length === 0) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isMediaSource(url: string): boolean {
  return IMAGE_EXTENSIONS.has(sourceExtension(url)) || VIDEO_EXTENSIONS.has(sourceExtension(url));
}

function classifyAttachmentUrl(url: string): "legacy-link" | "media" | "file" {
  const probe = probeWebUrl(url);
  if (probe !== null && !isMediaSource(url)) return "legacy-link";
  return isMediaSource(url) ? "media" : "file";
}

function artifactBasename(source: string): string {
  const trimmed = source.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return base.length > 0 ? base : source;
}

function httpsOnly(value: string): string | null {
  const normalized = normalizeHttpUrl(value);
  if (normalized === null) return null;
  return new URL(normalized).protocol === "https:" ? normalized : null;
}

const SINGLE_LINK_PATTERN = /^\[[^\]\n]*\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)\s*$/;

function extractContentLink(value: string): string | null {
  const trimmed = value.trim();
  return httpsOnly(SINGLE_LINK_PATTERN.exec(trimmed)?.[1] ?? trimmed);
}

function isInlineImageUrl(url: string): boolean {
  return url.startsWith("data:image/") || isMediaSource(url);
}

const CLOUD_ARTIFACT_PREFIX = "/workspace/cloud-agent-artifacts/";
const CLOUD_ARTIFACT_ID = /^bc-[A-Za-z0-9-]{1,80}$/;

function probeArtifactSource(source: string): { readonly bcId: string } | null {
  const trimmed = source.trim();
  let path: string | null = null;
  if (/^file:/i.test(trimmed)) {
    let parsed: URL | null = null;
    try { parsed = new URL(trimmed); } catch { return null; }
    if (parsed.protocol !== "file:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.pathname.length === 0) return null;
    path = parsed.pathname;
  } else if (trimmed.startsWith("/")) {
    path = trimmed;
  } else {
    return null;
  }
  if (!path.startsWith(CLOUD_ARTIFACT_PREFIX)) return null;
  const rest = path.slice(CLOUD_ARTIFACT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const bcId = rest.slice(0, slash);
  return CLOUD_ARTIFACT_ID.test(bcId) ? { bcId } : null;
}

export type MediaEntryClass = "returned-artifact" | "user-upload" | "bot";

export function classifyMediaEntry(entry: TranscriptMediaEntry): MediaEntryClass {
  if (entry.kind === "message") return entry.fromAgent != null ? "returned-artifact" : entry.role === "user" ? "user-upload" : "bot";
  if (entry.kind === "send-message") {
    if (entry.author?.kind === "cloud-agent") return "returned-artifact";
    if ((entry.cloudAgentArtifacts?.length ?? 0) > 0) return "returned-artifact";
    return "bot";
  }
  if (entry.kind === "user-attachment") return "user-upload";
  return "bot";
}

function classifyMediaSource(entry: TranscriptMediaEntry, source: string, excluded: ReadonlySet<string>): MediaEntryClass {
  const entryClass = classifyMediaEntry(entry);
  if (entryClass !== "bot") return entryClass;
  if (excluded.has(normalizeMediaSource(source))) return "user-upload";
  return probeArtifactSource(source) !== null ? "returned-artifact" : "bot";
}

export function isBotMediaEntry(entry: TranscriptMediaEntry): boolean {
  return classifyMediaEntry(entry) === "bot";
}

export function buildUserUploadExclusionSet(entries: readonly TranscriptMediaEntry[]): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "user-attachment" && typeof entry.file_path === "string") {
      excluded.add(normalizeMediaSource(entry.file_path));
    } else if (entry.kind === "message" && entry.role === "user" && Array.isArray(entry.images)) {
      for (const image of entry.images) {
        if (image != null && typeof image.url === "string") excluded.add(normalizeMediaSource(image.url));
      }
    }
  }
  return excluded;
}

function textImages(entry: TranscriptMediaEntry): Array<{ source: string; name: string | undefined }> {
  return knImages(entry);
}

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/g;

function knImages(entry: TranscriptMediaEntry): Array<{ source: string; name: string | undefined }> {
  const out: Array<{ source: string; name: string | undefined }> = [];
  const seen = new Set<string>();
  const add = (source: string, name: string | null | undefined): void => {
    const url = source.trim();
    if (url.length === 0 || seen.has(url)) return;
    seen.add(url);
    const label = name == null ? "" : String(name).trim();
    out.push({ source: url, name: label.length === 0 ? undefined : label });
  };
  const markdown = (content: string): void => {
    MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
    content.replace(MARKDOWN_IMAGE_PATTERN, (match, alt, url) => {
      if (!isSandUrl(url)) add(url, alt);
      return " ";
    });
  };
  if (entry.kind === "user-attachment") {
    if (typeof entry.file_path === "string" && isMediaSource(entry.file_path)) add(entry.file_path, entry.file_name ?? null);
    return out;
  }
  if (entry.kind === "send-message") {
    const message = entry.message;
    if (message == null || typeof message !== "object") return out;
    if (message.type === "text") {
      markdown(message.content ?? "");
      for (const image of message.images ?? []) {
        if (image != null && typeof image.url === "string" && !isSandUrl(image.url)) add(image.url, image.alt);
      }
      return out;
    }
    if (message.type === "attachment" && typeof message.url === "string" && !isSandUrl(message.url) && normalizeHttpUrl(message.url) === null && isInlineImageUrl(message.url)) {
      add(message.url, message.file_name ?? null);
    }
    return out;
  }
  if (entry.kind === "message") {
    markdown(entry.content ?? "");
    for (const image of entry.images ?? []) {
      if (image != null && typeof image.url === "string" && !isSandUrl(image.url)) add(image.url, image.alt);
    }
    return out;
  }
  return out;
}

function breFiles(entry: TranscriptMediaEntry): Array<{ source: string; name: string }> {
  if (entry.kind === "user-attachment") {
    const source = entry.file_path;
    if (typeof source !== "string" || source.trim().length === 0 || isSandUrl(source)) return [];
    return [{ source, name: entry.file_name ?? mediaBasename(source) }];
  }
  const message = entry.message;
  if (entry.kind === "send-message" && message?.type === "attachment") {
    const url = message.url;
    if (typeof url !== "string" || isSandUrl(url) || classifyAttachmentUrl(url) === "legacy-link") return [];
    return [{ source: url, name: message.file_name ?? mediaBasename(url) }];
  }
  const images = entry.kind === "message" ? entry.images : entry.kind === "send-message" && message?.type === "text" ? message.images : [];
  return (images ?? []).flatMap(image => typeof image?.url === "string" && !isSandUrl(image.url)
    ? [{ source: image.url, name: mediaBasename(image.url) }] : []);
}

function lreLink(entry: TranscriptMediaEntry): string | null {
  if (entry.kind !== "send-message") return null;
  const message = entry.message;
  if (message == null) return null;
  if (message.type === "attachment" && typeof message.url === "string") return normalizeHttpUrl(message.url);
  if (message.type !== "text" || entry.streaming === true || (message.images?.length ?? 0) > 0) return null;
  return extractContentLink(message.content ?? "");
}

function entryTimestamp(entry: TranscriptMediaEntry): number | null {
  return entry.timestampMs == null ? null : entry.timestampMs;
}

/**
 * FRe: forward pass with first-occurrence-wins dedup per
 * `visual|file|link` + raw source, then reversed for display (newest first).
 */
export function extractTranscriptMedia(entries: readonly TranscriptMediaEntry[]): TranscriptMediaRow[] {
  return projectTranscriptMedia(entries, false);
}

/** Grok Node's conversation library also includes the user's uploaded files. */
export function extractConversationMedia(entries: readonly TranscriptMediaEntry[]): TranscriptMediaRow[] {
  return projectTranscriptMedia(entries, true);
}

function projectTranscriptMedia(entries: readonly TranscriptMediaEntry[], includeUserUploads: boolean): TranscriptMediaRow[] {
  const excluded = buildUserUploadExclusionSet(entries);
  const seen = new Set<string>();
  const out: TranscriptMediaRow[] = [];
  // user-attachment rows historically omit timestampMs (createUserAttachmentEntry
  // only started stamping it later). Carry the latest prior stamped entry so
  // library buckets/hover age still resolve for already-persisted uploads.
  let lastKnownMs: number | null = null;
  for (const entry of entries) {
    const ownMs = entryTimestamp(entry);
    if (ownMs != null) lastKnownMs = ownMs;
    const entryClass = classifyMediaEntry(entry);
    if (entryClass === "returned-artifact" || (!includeUserUploads && entryClass !== "bot")) continue;
    const timestampMs = ownMs ?? (entry.kind === "user-attachment" ? lastKnownMs : null);
    const visuals = textImages(entry);
    const link = lreLink(entry);
    const visualSources = new Set(visuals.map(item => item.source));
    for (const visual of visuals) {
      const sourceClass = classifyMediaSource(entry, visual.source, excluded);
      if (sourceClass === "returned-artifact" || (!includeUserUploads && sourceClass !== "bot")) continue;
      const key = `visual:${visual.source}`;
      const seenKey = includeUserUploads ? `visual:${normalizeMediaSource(visual.source)}` : key;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      out.push({
        kind: isVideoSource(visual.source) ? "video" : "image",
        id: `${entry.id}:${key}`,
        timestampMs,
        source: visual.source,
        name: mediaName(visual.name, visual.source),
      });
    }
    for (const file of breFiles(entry)) {
      if (visualSources.has(file.source) || file.source === link) continue;
      const sourceClass = classifyMediaSource(entry, file.source, excluded);
      if (sourceClass === "returned-artifact" || (!includeUserUploads && sourceClass !== "bot")) continue;
      const key = `file:${file.source}`;
      const seenKey = includeUserUploads ? `file:${normalizeMediaSource(file.source)}` : key;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      out.push({ kind: "file", id: `${entry.id}:${key}`, timestampMs, source: file.source, name: mediaName(file.name, file.source) });
    }
    if (link !== null) {
      const key = `link:${link}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind: "link", id: `${entry.id}:${key}`, timestampMs, url: link });
      }
    }
  }
  return out.reverse();
}
