import { createHash } from "node:crypto";

export const DISPLAY_PROPS = [
  "aria-label", "confirmLabel", "cancelLabel", "pendingLabel", "idleLabel",
  "submitLabel", "subtitle", "description", "children", "label", "title",
  "content", "placeholder", "text", "header", "caption", "message",
];

export const NL = String.fromCharCode(10);
export const BT = String.fromCharCode(96);
export const SQ = String.fromCharCode(39);
export const DQ = String.fromCharCode(34);
export const BS = String.fromCharCode(92);

export const RUNTIME_LINES = [
  'function RLocFromPref(pref){',
  'if(pref==="zh-CN")return "zh-CN";',
  'if(pref==="en")return "en";',
  'try{',
  'var tags=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];',
  'for(var i=0;i<tags.length;i++){var t=String(tags[i]||"").trim().toLowerCase();',
  'if(t==="zh"||t.indexOf("zh-")===0)return "zh-CN";',
  'if(t==="en"||t.indexOf("en-")===0)return "en";}',
  '}catch(_e){}',
  'return "en";}',
  'function RLocBoot(){try{var s=window.desktop&&window.desktop.language;var p=s&&s.initial&&s.initial.preference;return RLocFromPref(p);}catch(_e){}return "en";}',
  'function RLocT(en,zh){return RLocBoot()==="zh-CN"?zh:en;}',
  'try{(function(){var s=window.desktop&&window.desktop.language;if(!s||typeof s.onChanged!=="function")return;var boot=RLocBoot();s.onChanged(function(st){var loc=RLocFromPref(st&&st.preference);if(loc!==boot){try{location.reload();}catch(_e){}}});})();}catch(_e){}'
];

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isIdentifierChar(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$";
}

function scanQuoteSpans(source) {
  const spans = [];
  const len = source.length;
  let i = 0;
  while (i < len) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl < 0 ? len : nl + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (c === "/" && source[i + 1] !== "=" && isRegexOpen(source, i)) {
      const end = scanRegexEnd(source, i + 1);
      if (end >= 0) { i = end; continue; }
    }
    if (c === SQ) {
      const close = scanQuotedEnd(source, i, SQ);
      if (close >= 0) {
        spans.push({ start: i, end: close });
        i = close + 1;
      } else {
        i += 1;
      }
    } else if (c === DQ) {
      const close = scanQuotedEnd(source, i, DQ);
      i = close >= 0 ? close + 1 : i + 1;
    } else if (c === BT) {
      i = scanTemplate(source, i, spans);
    } else {
      i += 1;
    }
  }
  return spans;
}

// Legitimate non-UI literals (SVG path data, base64 blobs) run past 4 KB —
// the 0.18 main chunk carries a 4,329-char SVG string, and rejecting it made
// the closing quote re-open a phantom span that desynced everything after it.
// Keep a generous ceiling so a true runaway scan (unbalanced quote from a
// scanner bug) still terminates well before end-of-file.
const SPAN_CAP = 200_000;

function isRegexOpen(source, i) {
  let k = i - 1;
  while (k >= 0 && (source[k] === " " || source[k] === "\n" || source[k] === "\t" || source[k] === "\r")) k -= 1;
  if (k < 0) return true;
  const p = source[k];
  if (isIdentifierChar(p)) {
    let w = k;
    while (w >= 0 && isIdentifierChar(source[w])) w -= 1;
    const word = source.slice(w + 1, k + 1);
    return REGEX_KEYWORDS.has(word);
  }
  if (p === ")" || p === "]" || p === "}") return false;
  return true;
}

// A slash starts a regex literal (rather than division) after these words:
// return <regex>, typeof <regex>, case <regex>: etc. Any other identifier
// means division (a / b) or a comment, never a regex literal.
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete",
  "void", "else", "do", "case", "yield", "await", "throw",
]);

function scanRegexEnd(source, from) {
  const len = source.length;
  let j = from;
  let inClass = false;
  while (j < len) {
    const d = source[j];
    if (d === BS) { j += 2; continue; }
    if (d === "\n") return -1;
    if (d === "[") inClass = true;
    else if (d === "]") inClass = false;
    else if (d === "/" && !inClass) break;
    j += 1;
  }
  if (j >= len || source[j] !== "/") return -1;
  j += 1;
  while (j < len && source[j] >= "a" && source[j] <= "z") j += 1;
  return j;
}

function scanQuotedEnd(source, from, quote) {
  const limit = Math.min(source.length, from + 1 + SPAN_CAP);
  let j = from + 1;
  while (j < limit) {
    const d = source[j];
    if (d === BS) { j += 2; continue; }
    if (d === quote) return j;
    j += 1;
  }
  return -1;
}

// Template literals need structural scanning: raw text between backticks is
// inert content (skip ranges), but ${...} interpolations hold live code
// whose literals must still branch. Nested templates recurse naturally.
function scanTemplate(source, from, spans) {
  const len = source.length;
  let j = from + 1;
  let rawStart = j;
  while (j < len) {
    const d = source[j];
    if (d === BS) { j += 2; continue; }
    if (d === BT) {
      if (j > rawStart) spans.push({ start: rawStart, end: j });
      return j + 1;
    }
    if (d === "$" && source[j + 1] === "{") {
      if (j > rawStart) spans.push({ start: rawStart, end: j });
      j = scanCodeBlock(source, j + 2, spans, true);
      rawStart = j;
      continue;
    }
    j += 1;
  }
  return len;
}

function scanCodeBlock(source, from, spans, stopAtBrace) {
  const len = source.length;
  let i = from;
  let depth = 0;
  while (i < len) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl < 0 ? len : nl + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (c === "/" && source[i + 1] !== "=" && isRegexOpen(source, i)) {
      const end = scanRegexEnd(source, i + 1);
      if (end >= 0) { i = end; continue; }
      i += 1;
      continue;
    }
    if (c === SQ) {
      const close = scanQuotedEnd(source, i, SQ);
      if (close >= 0) {
        spans.push({ start: i, end: close });
        i = close + 1;
      } else {
        i += 1;
      }
      continue;
    }
    if (c === DQ) {
      const close = scanQuotedEnd(source, i, DQ);
      i = close >= 0 ? close + 1 : i + 1;
      continue;
    }
    if (c === BT) {
      i = scanTemplate(source, i, spans);
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      if (stopAtBrace) {
        if (depth === 0) return i + 1;
        depth -= 1;
      }
    }
    i += 1;
  }
  return len;
}

function isInsideSpans(spans, offset) {
  for (const span of spans) {
    if (span.start < offset && offset < span.end) return span;
    if (span.start >= offset) break;
  }
  return null;
}

function isSkippedOffset(spans, offset) {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start < offset) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found >= 0 && offset < spans[found].end;
}

export function replaceOutsideSpans(source, spans, search, replacement) {
  let patched = "";
  let cursor = 0;
  let hits = 0;
  while (true) {
    const idx = source.indexOf(search, cursor);
    if (idx < 0) break;
    if (isInsideSpans(spans, idx) == null) {
      patched += source.slice(cursor, idx) + replacement;
      hits += 1;
    } else {
      patched += source.slice(cursor, idx + search.length);
    }
    cursor = idx + search.length;
  }
  patched += source.slice(cursor);
  return { patched, hits };
}

function branchReplacement(en, zh) {
  return "(RLocT(" + JSON.stringify(en) + "," + JSON.stringify(zh) + "))";
}

function isRlocInserted(source, idx) {
  return source.slice(Math.max(0, idx - 7), idx) === "(RLocT(";
}

export function computeSpans(source) {
  return scanQuoteSpans(source);
}

function isDigitKey(source, idx) {
  let j = idx - 1;
  let digits = 0;
  while (j >= 0 && source[j] >= "0" && source[j] <= "9") { j -= 1; digits += 1; }
  if (digits === 0) return false;
  const c = j >= 0 ? source[j] : "";
  return !isIdentifierChar(c) && c !== ".";
}

export function applyPair(source, en, zh, mode) {
  const spans = scanQuoteSpans(source);
  const search = JSON.stringify(en);
  const replacement = branchReplacement(en, zh);
  const lits = [];
  const claimed = [];
  const overlaps = (at) => claimed.some((range) => at >= range.start && at < range.end);
  const offer = (at) => {
    if (overlaps(at)) return;
    if (isSkippedOffset(spans, at)) return;
    if (isRlocInserted(source, at)) return;
    lits.push(at);
    claimed.push({ start: at, end: at + search.length });
  };
  const takeSearch = (needle) => {
    let cursor = 0;
    while (true) {
      const idx = source.indexOf(needle, cursor);
      if (idx < 0) break;
      offer(idx + needle.length - search.length);
      cursor = idx + needle.length;
    }
  };
  if (mode === "PROP" || mode === "PROP_COLON" || mode === "FULL" || mode === "PANEL") {
    for (const prop of DISPLAY_PROPS) {
      takeSearch(prop + ":" + search);
      takeSearch(JSON.stringify(prop) + ":" + search);
    }
  }
  if (mode === "FULL" || mode === "PANEL") {
    takeSearch("?" + search);
    takeSearch("Error(" + search);
    takeSearch("oTe(" + search);
  }
  if (mode === "PANEL") {
    takeSearch("return" + search);
    takeSearch("," + search);
    takeSearch("??" + search);
    let cursor = 0;
    const needle = "=" + search;
    while (true) {
      const idx = source.indexOf(needle, cursor);
      if (idx < 0) break;
      const prev = idx > 0 ? source[idx - 1] : "";
      if (prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">") offer(idx + 1);
      cursor = idx + needle.length;
    }
  }
  if (mode === "FULL" || mode === "PROP_COLON" || mode === "PANEL") {
    let cursor = 0;
    const needle = ":" + search;
    while (true) {
      const idx = source.indexOf(needle, cursor);
      if (idx < 0) break;
      const prev = idx > 0 ? source[idx - 1] : "";
      const propHit = DISPLAY_PROPS.some((prop) => source.slice(Math.max(0, idx - prop.length), idx) === prop);
      if (mode === "PANEL") {
        if (!isDigitKey(source, idx)) offer(idx + 1);
      } else if (!isIdentifierChar(prev) && !propHit) offer(idx + 1);
      cursor = idx + needle.length;
    }
  }
  if (lits.length === 0) throw new Error("i18n pair has no anchor outside string spans: " + en);
  lits.sort((a, b) => b - a);
  let patched = source;
  for (const at of lits) patched = patched.slice(0, at) + replacement + patched.slice(at + search.length);
  return { patched, hits: lits.length };
}

export function applyAnchored(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error("i18n anchored block is missing: " + anchor.slice(0, 60));
  if (source.indexOf(anchor, first + 1) >= 0) throw new Error("i18n anchored block is ambiguous: " + anchor.slice(0, 60));
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}
