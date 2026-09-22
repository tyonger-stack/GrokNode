import { z } from "zod";
import type { BotTemplateRecord } from "../../shared/bot-template.js";

export type BotTemplateImportRecord = BotTemplateRecord;
export class BotTemplateError extends Error {}
const templateIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const publicTemplateSchema = z.object({
  id: templateIdSchema,
  botName: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(100_000),
  sharerName: z.string().max(200).nullish(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
  shape: z.string().max(32).nullish(),
});

function decodeHtml(value: string): string {
  const named: Readonly<Record<string, string>> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi, (entity: string, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
    const number = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  }).trim();
}

function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((match) => [match[1]?.toLowerCase(), match[3] ?? match[4] ?? ""]));
    if (attrs.get("property") === key || attrs.get("name") === key) return decodeHtml(attrs.get("content") ?? "");
  }
  return undefined;
}

function findTemplate(value: unknown, templateId: string, depth = 0): z.infer<typeof publicTemplateSchema> | null {
  if (value === null || typeof value !== "object" || depth > 60) return null;
  const parsed = publicTemplateSchema.safeParse(value);
  if (parsed.success && parsed.data.id === templateId) return parsed.data;
  for (const child of Object.values(value)) {
    const found = findTemplate(child, templateId, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export function parseBotTemplateDocument(html: string, templateId: string, sourceUrl: string): BotTemplateRecord {
  let flight = "";
  for (const match of html.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)) {
    try {
      const chunk: unknown = JSON.parse(match[1] ?? "null");
      if (Array.isArray(chunk) && typeof chunk[1] === "string") flight += chunk[1];
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  for (const row of flight.split("\n")) {
    const start = row.indexOf(":");
    if (start < 0) continue;
    let value: unknown;
    try { value = JSON.parse(row.slice(start + 1)); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    const record = findTemplate(value, templateId);
    if (record !== null) return { templateId, sourceUrl, name: record.botName, description: record.description, author: record.sharerName ?? null, color: record.color ?? null, shape: record.shape ?? null };
  }
  const name = decodeHtml(metaContent(html, "og:title") ?? metaContent(html, "twitter:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const description = metaContent(html, "og:description") ?? metaContent(html, "description") ?? metaContent(html, "twitter:description") ?? "";
  if (!name || !description || name.length > 120 || /\.\.\.$|…$/.test(description)) throw new BotTemplateError("The public page does not provide a complete Bot template.");
  return { templateId, sourceUrl, name, description, author: null, color: null, shape: null };
}

export async function fetchBotTemplateRecord(templateId: string, fetchImpl: typeof fetch = fetch): Promise<BotTemplateRecord> {
  if (!templateIdSchema.safeParse(templateId).success) throw new BotTemplateError("Invalid Bot template id.");
  const sourceUrl = "https://x.ai/bot/" + encodeURIComponent(templateId);
  const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(20_000), redirect: "error", headers: { accept: "text/html" } });
  if (!response.ok) throw new BotTemplateError("Bot template page returned HTTP " + response.status + ".");
  if (response.body === null) throw new BotTemplateError("Bot template page was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new BotTemplateError("Bot template page is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return parseBotTemplateDocument(Buffer.concat(chunks).toString("utf8"), templateId, sourceUrl);
}
