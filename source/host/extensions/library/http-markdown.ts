import { escapeHtml } from "./http-escape.js";
import { documentAssetName } from "../../../shared/library/document-assets.js";

const TOKEN = /!\[([^\]\n]*)\]\(\s*<?([^\s)>\"']+)>?(?:\s+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^)\n]*\)))?\s*\)|\[([^\]\n]+)\]\((https:\/\/[^()\s]+)\)/g;

function renderProseEscaped(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function renderRichRaw(raw: string, assets: ReadonlySet<string>, assetsBase: string): string {
  TOKEN.lastIndex = 0;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(raw)) !== null) {
    out += renderProseEscaped(raw.slice(last, match.index));
    const alt = match[1];
    if (alt !== undefined) {
      const name = documentAssetName(match[2] ?? "");
      out += name !== null && assets.has(name)
        ? `<img src="${escapeHtml(`${assetsBase}/${encodeURIComponent(name)}`)}" alt="${escapeHtml(alt)}">`
        : escapeHtml(match[0]);
    } else {
      const href = match[4] ?? "";
      let valid = false;
      try {
        valid = new URL(href).protocol === "https:";
      } catch {
        valid = false;
      }
      out += valid
        ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${renderProseEscaped(match[3] ?? "")}</a>`
        : escapeHtml(match[0]);
    }
    last = match.index + match[0].length;
  }
  out += renderProseEscaped(raw.slice(last));
  return out;
}

function renderInline(raw: string, assets: ReadonlySet<string>, assetsBase: string): string {
  return raw
    .split(/(`[^`\n]+`)/g)
    .map((part) =>
      part.length >= 2 && part.startsWith("`") && part.endsWith("`")
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : renderRichRaw(part, assets, assetsBase),
    )
    .join("");
}

export function renderMarkdownBody(source: string, assetNames: readonly string[], assetsBase: string): string {
  const assets = new Set(assetNames);
  const lines = source.split("\n");
  const blocks: string[] = [];
  let index = 0;
  const flushList = (items: string[], ordered: boolean): void => {
    blocks.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
  };
  let pending: string[] = [];
  let pendingOrdered = false;
  const flushPending = (): void => {
    if (pending.length > 0) flushList(pending, pendingOrdered);
    pending = [];
  };
  while (index < lines.length) {
    const line = lines[index] ?? "";
    index += 1;
    if (line.trim().startsWith("```")) {
      flushPending();
      const code: string[] = [];
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPending();
      const level = (heading[1] ?? "#").length;
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "", assets, assetsBase)}</h${level}>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    const item = ordered ?? unordered;
    if (item) {
      const isOrdered = ordered !== null;
      if (pending.length > 0 && pendingOrdered !== isOrdered) flushPending();
      pendingOrdered = isOrdered;
      pending.push(`<li>${renderInline(item[1] ?? "", assets, assetsBase)}</li>`);
      continue;
    }
    flushPending();
    if (line.trim().startsWith(">")) {
      blocks.push(`<blockquote>${renderInline(line.trim().slice(1).trim(), assets, assetsBase)}</blockquote>`);
      continue;
    }
    if (line.trim() !== "") blocks.push(`<p>${renderInline(line.trim(), assets, assetsBase)}</p>`);
  }
  flushPending();
  return blocks.join("\n");
}

export function renderDocumentPageHtml(args: {
  readonly title: string;
  readonly source: string;
  readonly assetNames: readonly string[];
  readonly canonicalHref: string;
  readonly rawHref: string;
  readonly visibility: string;
}): string {
  const body = renderMarkdownBody(args.source, args.assetNames, `${args.canonicalHref}/assets`);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="referrer" content="no-referrer">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; base-uri 'none'; form-action 'none'">` +
    `<title>${escapeHtml(args.title)}</title>` +
    `<style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;line-height:1.6}img{max-width:100%}pre{overflow:auto;background:#f4f4f4;padding:1rem}code{font-family:ui-monospace,monospace}</style>` +
    `</head><body><header><h1>${escapeHtml(args.title)}</h1>` +
    `<p>Visibility: ${escapeHtml(args.visibility)} \u00B7 <a href="${escapeHtml(args.rawHref)}" rel="noopener noreferrer">raw</a></p></header>` +
    `<article>${body}</article></body></html>`;
}
