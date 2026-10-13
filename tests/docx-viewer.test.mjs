// Regression guard for the .docx preview pipeline (frontend/src/recovered/
// features/conversation/workspace/docx-convert.ts).
//
// What this exists to stop, and why it is worth the fixture:
//
//   The first implementation hand-rolled the ZIP read (EOCD scan → central
//   directory → local header offsets → DecompressionStream("deflate-raw")) and
//   then walked word/document.xml itself. Measured against three real .docx
//   files, that recovered **0 of 34 / 11 / 11 tables and 0 of 9 images**, and
//   recognised 0 headings. Typecheck, `frontend:build` and `npm test` were all
//   green while it shipped. So the assertions here are on recovered structure
//   counts, not on "it built".
//
//   The fixtures are synthetic on purpose. The three measurements above came
//   from real documents that are not ours to commit (the repository is public),
//   and those specific files also *reference* heading styles they never define,
//   which would have made them useless as a regression baseline anyway.
//
// The module under test is bundled with esbuild and imported from a temp file,
// following tests/i18n-language-preference.test.mjs: a `data:` URL cannot
// resolve the module's own relative specifiers.
//
// happy-dom supplies DOMParser. That is a deliberate constraint, not a test
// convenience: convertDocxToHtml is browser-only by construction, so the test
// installs a browser rather than the code growing a Node-only branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JSZip from "jszip";
import { Window } from "happy-dom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const MODULE = "frontend/src/recovered/features/conversation/workspace/docx-convert.ts";

async function loadDocxConvert() {
  const dir = await mkdtemp(path.join(tmpdir(), "docx-viewer-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(REPO, MODULE)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  try {
    // Install the DOM before importing: the module body itself is DOM-free, but
    // every call into it needs DOMParser, and this keeps the failure attributable.
    const window = new Window();
    globalThis.DOMParser = window.DOMParser;
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ fixtures

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

/**
 * styles.xml is load-bearing, and leaving it out is the exact failure mode the
 * real-world measurement exposed: mammoth can only map a paragraph style it can
 * *resolve*, so a document that references `ListBullet` without defining it
 * produces a plain <p> and a "referenced but not defined" note. Each style here
 * carries both an id and a name, since mammoth matches on either.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/></w:style>
</w:styles>`;

/**
 * Lists come from numbering, not from the style name. mammoth's default style
 * map has no list entries at all — grep it and you will find only Body, Endnote,
 * Footnote, Heading*, Normal and annotation text. `body-reader.js` decides a
 * paragraph is a list item from `w:numPr`, resolved either inline or through
 * `numbering.findLevelByParagraphStyleId`. A paragraph that merely carries
 * `pStyle ListBullet` with no numPr stays a plain <p> and emits
 * "Unrecognised paragraph style".
 */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/**
 * A document that exercises every block the upstream sanitizer names: two
 * heading levels, a two-column table, both list flavours, inline emphasis, and
 * a run with an explicit bold/italic toggle.
 */
function documentXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Release notes</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Details</w:t></w:r></w:p>
<w:p><w:r><w:t>Plain body paragraph.</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Italic</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>bullet one</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ListNumber"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>number one</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>r1c1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>r1c2</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`;
}

async function makeDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels").file(".rels", ROOT_RELS);
  const word = zip.folder("word");
  word.file("document.xml", documentXml());
  word.file("styles.xml", STYLES);
  word.file("numbering.xml", NUMBERING);
  word.folder("_rels").file("document.xml.rels", DOC_RELS);
  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(buffer);
}

const count = (html, pattern) => (html.match(pattern) ?? []).length;

// --------------------------------------------------------------------- tests

test("a real .docx round-trips through mammoth with its structure intact", async () => {
  const { convertDocxToHtml } = await loadDocxConvert();
  const { html } = await convertDocxToHtml(await makeDocx());

  // These are the four the hand-rolled reader lost outright.
  assert.equal(count(html, /<h1[ >]/g), 1, "Heading1 must survive as <h1>");
  assert.equal(count(html, /<h2[ >]/g), 1, "Heading2 must survive as <h2>");
  assert.equal(count(html, /<table>/g), 1, "the table must survive");
  assert.equal(count(html, /<tr>/g), 2, "both rows must survive");
  // 3 cells total: one gridSpan=2 header cell plus two body cells. mammoth
  // emits every cell as <td> — it does not infer a header row.
  assert.equal(count(html, /<td/g), 3, "all three fixture cells must survive");
  assert.doesNotMatch(html, /<th[ >]/, "mammoth does not promote the first row to <th>");
  assert.ok(count(html, /<ul>/g) >= 1, "the bullet list must survive");
  assert.ok(count(html, /<ol>/g) >= 1, "the numbered list must survive");
  assert.match(html, /Plain body paragraph\./);

  // Text must arrive as text, never as markup.
  assert.doesNotMatch(html, /<w:/, "no OOXML leaked into the output");
});

test("the sanitizer keeps upstream's allow-list and drops everything else", async () => {
  const { sanitizeDocumentHtml } = await loadDocxConvert();
  const html = sanitizeDocumentHtml(
    `<p onclick="steal()">kept text</p>
     <script>alert(1)</script>
     <iframe src="https://evil.invalid"></iframe>
     <a href="javascript:alert(1)">bad link</a>
     <a href="https://ok.invalid/x">good link</a>
     <a href="mailto:a@b.invalid">mail</a>
     <img src="data:image/png;base64,AAA" alt="ok">
     <img src="http://plain.invalid/x.png" onerror="alert(1)">
     <section><span>unwrapped child</span></section>
     <table><tr><td colspan="2">cell</td></tr></table>`
  );

  // Removed outright.
  assert.doesNotMatch(html, /<script/i, "script must be removed");
  assert.doesNotMatch(html, /<iframe/i, "iframe must be removed");
  assert.doesNotMatch(html, /onclick/i, "event handler attributes must be stripped");
  assert.doesNotMatch(html, /onerror/i, "event handler attributes must be stripped");
  assert.doesNotMatch(html, /javascript:/i, "javascript: href must be stripped");

  // Kept, per anchor A's predicates.
  assert.match(html, /href="https:\/\/ok\.invalid\/x"/, "https href kept");
  assert.match(html, /href="mailto:a@b\.invalid"/, "mailto href kept");
  assert.match(html, /src="data:image\/png;base64,AAA"/, "data: image kept");
  assert.doesNotMatch(html, /src="http:\/\/plain\.invalid/, "plain-http image src dropped — only data:image/ and https:// pass");
  assert.match(html, /alt="ok"/, "img alt kept");
  assert.match(html, /colspan="2"/, "td colspan kept");

  // Disallowed element is unwrapped, keeping its children.
  assert.doesNotMatch(html, /<section/i, "section is not on the allow-list");
  assert.match(html, /unwrapped child/, "…but its children survive the unwrap");
});

test("the URL predicates match upstream's exact scheme rules", async () => {
  const { isSafeHref, isSafeImageSrc } = await loadDocxConvert();

  for (const href of ["https://a", "http://a", "mailto:a@b"]) {
    assert.equal(isSafeHref(href), true, `${href} should be allowed`);
  }
  for (const href of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x"]) {
    assert.equal(isSafeHref(href), false, `${href} must be rejected`);
  }
  // "" is ALLOWED, and that is upstream's answer, not an oversight here.
  // anchor A resolves against the `https://sand.invalid` base, so an empty
  // href parses to that base's protocol and passes. This assertion exists to
  // pin the behaviour so a later reader does not "fix" the port into a
  // divergence from upstream. It is not a security hole: an empty href points
  // at the current document and executes nothing.
  assert.equal(isSafeHref(""), true, "empty href resolves to the base URL and is kept, matching anchor A");

  assert.equal(isSafeImageSrc("data:image/png;base64,AAA"), true);
  assert.equal(isSafeImageSrc("DATA:IMAGE/PNG;base64,AAA"), true, "the data: check is case-insensitive upstream");
  assert.equal(isSafeImageSrc("https://a/b.png"), true);
  assert.equal(isSafeImageSrc("http://a/b.png"), false, "plain http images are rejected");
  assert.equal(isSafeImageSrc("data:text/html,<script>"), false, "data: only counts for images");
});