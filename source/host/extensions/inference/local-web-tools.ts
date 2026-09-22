import { execFile } from "node:child_process";

const WEB_FETCH_TIMEOUT_MS = 30_000;
const WEB_FETCH_MAX_BYTES = 2_000_000;
const WEB_SEARCH_TIMEOUT_MS = 30_000;
const WEB_SEARCH_MAX_RESULTS = 8;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/");
}

function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resolveRedirect(href: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  if (match == null) {
    if (href.startsWith("//")) return `https:${href}`;
    return href;
  }
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

interface LocalSearchDocument {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

function toDocuments(entries: readonly unknown[]): LocalSearchDocument[] {
  return entries.flatMap((entry: unknown) => {
    const record = entry as { url?: unknown; link?: unknown; title?: unknown; text?: unknown; snippet?: unknown };
    const url = typeof record.url === "string" ? record.url : typeof record.link === "string" ? record.link : undefined;
    const title = typeof record.title === "string" ? record.title : undefined;
    const text = typeof record.text === "string" ? record.text : typeof record.snippet === "string" ? record.snippet : undefined;
    return url != null && title != null && text != null ? [{ url, title, text }] : [];
  });
}

/**
 * Local WebSearch replacement. The Cursor AiService backend is unavailable on
 * accounts without Grok Bot access, so local inference routes search through the
 * mmx CLI when it is installed, then fall back to a configured endpoint or the
 * DuckDuckGo HTML endpoint.
 */
export function createLocalWebSearchService() {
  const searchWithMmx = (searchTerm: string): Promise<LocalSearchDocument[] | undefined> => new Promise((resolve) => {
    execFile(
      "mmx",
      ["search", "query", "--q", searchTerm, "--output", "json", "--quiet"],
      { timeout: WEB_SEARCH_TIMEOUT_MS, maxBuffer: 8_000_000 },
      (error, stdout) => {
        if (error != null) {
          resolve(undefined);
          return;
        }
        try {
          const payload = JSON.parse(stdout) as { organic?: unknown };
          resolve(Array.isArray(payload.organic) ? toDocuments(payload.organic) : undefined);
        } catch {
          resolve(undefined);
        }
      },
    );
  });
  return async (_ctx: unknown, args: { searchTerm: string; explanation?: string }): Promise<{ answer: string; documents: LocalSearchDocument[] }> => {
    const endpoint = process.env.SAND_WEB_SEARCH_URL?.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
    try {
      if (endpoint == null || endpoint.length === 0) {
        const documents = await searchWithMmx(args.searchTerm);
        if (documents != null && documents.length > 0) {
          return {
            answer: documents.map((document) => `${document.title} — ${document.url}`).join("\n"),
            documents,
          };
        }
      }
      if (endpoint != null && endpoint.length > 0) {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            searchTerm: args.searchTerm,
            ...(args.explanation === undefined ? {} : { explanation: args.explanation }),
          }),
        });
        if (!response.ok) throw new Error(`Search endpoint returned HTTP ${response.status}.`);
        const payload = await response.json() as { answer?: unknown; documents?: unknown };
        return {
          answer: typeof payload.answer === "string" ? payload.answer : "",
          documents: Array.isArray(payload.documents) ? toDocuments(payload.documents) : [],
        };
      }
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.searchTerm)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "text/html",
          "accept-language": "en,zh;q=0.8",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
      });
      if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}.`);
      const body = await response.text();
      const documents: LocalSearchDocument[] = [];
      const anchors = body.split("<a ").slice(1);
      for (const anchor of anchors) {
        if (documents.length >= WEB_SEARCH_MAX_RESULTS) break;
        if (!anchor.includes("result__a")) continue;
        const href = /class="result__a"[^>]*href="([^"]+)"/.exec(anchor) ?? /href="([^"]+)"[^>]*class="result__a"/.exec(anchor);
        const title = /class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(anchor);
        if (href == null || title == null) continue;
        const rest = anchor.slice(anchor.indexOf("</a>"));
        const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(rest) ?? /class="result__snippet"[^>]*>([\s\S]*?)<\/div>/.exec(rest);
        documents.push({
          url: resolveRedirect(href[1]!),
          title: stripTags(title[1]!),
          text: snippet == null ? "" : stripTags(snippet[1]!),
        });
      }
      if (documents.length === 0) throw new Error("The search returned no usable results.");
      return {
        answer: documents.map((document) => `${document.title} — ${document.url}`).join("\n"),
        documents,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("The search request timed out.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Local WebFetch replacement. The Cursor AiService backend is unavailable on
 * accounts without Grok Bot access, so the local inference routes fetch pages
 * directly and convert HTML to text.
 */
export function createLocalWebFetchService() {
  return async (_ctx: unknown, url: string): Promise<{ content: string } | { error: string; isTimeout?: boolean }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "accept-language": "en,zh;q=0.8",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
      });
      if (!response.ok) return { error: `Fetch failed with HTTP ${response.status} ${response.statusText}.` };
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > WEB_FETCH_MAX_BYTES) return { error: `Page is too large (${buffer.byteLength} bytes).` };
      const contentType = response.headers.get("content-type") ?? "";
      const decoded = new TextDecoder("utf-8").decode(buffer);
      const content = contentType.includes("html") ? htmlToText(decoded) : decoded;
      if (content.length === 0) return { error: "The page returned no readable content." };
      return { content };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { error: "The fetch timed out.", isTimeout: true };
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  };
}

