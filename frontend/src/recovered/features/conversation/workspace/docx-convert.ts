// @evidence src/app/dist/renderer/assets/view-DPSBrvyV.js#byteOffset=0 (0.18 has no docx viewer; this is a new capability)
//
// The React shell lives in ./docx-viewer.tsx; everything here is DOM- and
// React-free so the regression test can drive it directly.
//
// Upstream 0.68.1 pipeline, reproduced role-for-role. Two anchors, both read out
// of the installed official app (sha256 recorded so a re-read can prove these
// are the bytes this file was written from):
//
//   A. /Applications/Grok Bot.app/.../app.asar → dist/renderer/assets/
//      chunk-docx-loader-DBICxPYd.js    1,986 B  sha256 2fbcaac0c858e430…
//         the sanitize whitelist + the dynamic import of the converter
//   B. … chunk-index-C_nW0FMU.js       508,080 B
//         the converter: mammoth 1.x + jszip + pako, called as
//         convertToHtml({arrayBuffer}) with no custom styleMap
//
// The converter is mammoth + jszip upstream, so we use those packages rather
// than re-deriving OOXML. A hand-rolled ZIP reader was measured against three
// real .docx files and recovered 0 of 34 / 11 / 11 tables and 0 of 9 images:
// mammoth's table, image and style mapping is where the weight sits, and that
// is not worth re-implementing. The ZIP reader it replaced is therefore gone —
// mammoth does the unzipping.
//
// Measured on the same three files, mammoth recovers every table and image,
// and still emits no headings — because those documents *reference* heading
// styles they never define ("Paragraph style with ID shimo heading 2 was
// referenced but not defined in the document"). That is a property of the
// inputs, not of the converter; the fixtures in tests/docx-viewer.test.mjs
// cover the defined case.
//
// mammoth's Node entry (lib/unzip.js) only accepts {path}/{fs}; {arrayBuffer}
// lives in the browser entry, which is what vite's `browser` field selects
// upstream. Importing mammoth/mammoth.browser.js explicitly keeps that choice
// from depending on bundler field resolution, and importing it dynamically
// keeps the ~1 MB converter off the initial chunk — upstream lazy-loads it too.

// ------------------------------------------------------------- sanitize
// Verbatim port of anchor A's sanitize. The tag table, the two URL predicates
// and the `||`-chained attribute rule keep upstream's shape so a diff against
// the extracted chunk stays readable.

/** Upstream calls this `s`; it is a membership table keyed by lowercased tag. */
const ALLOWED_TAGS: Readonly<Record<string, true>> = {
  p: true, br: true, hr: true,
  h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
  ul: true, ol: true, li: true,
  strong: true, b: true, em: true, i: true, u: true, s: true, sub: true, sup: true,
  blockquote: true, code: true, pre: true, span: true, a: true, img: true,
  table: true, thead: true, tbody: true, tr: true, td: true, th: true
};

export function isAllowedTag(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TAGS, tag);
}

/** Anchor A `l`: href may only be http(s) or mailto. */
export function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value, "https://sand.invalid");
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Anchor A `m`: image src may only be a data: image or https:. */
export function isSafeImageSrc(value: string): boolean {
  return /^data:image\//i.test(value) || /^https:\/\//i.test(value);
}

/** Anchor A `u`: unwrap disallowed elements (keeping children), strip unnamed attributes. */
export function scrub(element: Element): void {
  for (const child of Array.from(element.children)) {
    scrub(child);
    const tag = child.tagName.toLowerCase();
    if (!isAllowedTag(tag)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      const name = attribute.name.toLowerCase();
      const keep =
        (tag === "a" && name === "href" && isSafeHref(attribute.value)) ||
        (tag === "img" && name === "src" && isSafeImageSrc(attribute.value)) ||
        (tag === "img" && name === "alt") ||
        ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan"));
      if (!keep) child.removeAttribute(attribute.name);
    }
  }
}

/** Anchor A `f`: parse, drop the always-removed elements, scrub, return markup. */
export function sanitizeDocumentHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script, style, link, meta, iframe, object, embed").forEach((element) => element.remove());
  scrub(parsed.body);
  return parsed.body.innerHTML;
}

// ------------------------------------------------------------- conversion

export interface DocxConversion {
  readonly html: string;
  /** mammoth's own notes, e.g. styles referenced but never defined. */
  readonly messages: readonly string[];
}

/**
 * Anchor A `b`: lazy-load the converter, convert, sanitize.
 * Needs DOMParser, so it is browser-only by construction; the regression test
 * supplies happy-dom rather than the code growing a Node branch.
 */
export async function convertDocxToHtml(bytes: Uint8Array): Promise<DocxConversion> {
  const module = await import("mammoth/mammoth.browser.js");
  const mammoth = module.default ?? module;
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer as ArrayBuffer });
  return {
    html: sanitizeDocumentHtml(result.value),
    messages: result.messages.map((message: { message: string }) => message.message)
  };
}