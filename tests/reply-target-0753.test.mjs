import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "acorn";
import { extractFile } from "@electron/asar";
import { patchReplyTarget0753, REPLY_TARGET_0753_CSS } from "../scripts/lib/reply-target-0753-patch.mjs";
import official from "../scripts/lib/reply-target-0753-official.json" with { type: "json" };

const baseline = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(() => null);
const skip = baseline == null ? "pinned renderer not hydrated" : false;
const archive = process.env.GROK_NODE_REPLY_TARGET_TEST_ASAR;

test("reply target highlight follows the message bubble and leaves row layout unchanged", { skip }, () => {
  const patched = archive ? extractFile(archive, "dist/renderer/assets/index-UbX-y3il.js").toString() : patchReplyTarget0753(baseline).text;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  assert(!patched.includes("sand-5p1i9e sand-1aquc0h sand-1h5mrz9 sand-a3vuyk sand-jk8ly"));
  assert(patched.includes(official.className));
  assert(patched.includes('"data-highlighted":z'));
  assert.equal(patchReplyTarget0753(patched).applied, false);
  assert.throws(() => patchReplyTarget0753(baseline.replace("sand-5p1i9e", "changed")), /eight highlighted row/);
});

test("official focus ring uses primary text color and keeps reduced motion behavior", () => {
  const css = archive ? extractFile(archive, "dist/renderer/assets/index-lCyB53CO.css").toString() : REPLY_TARGET_0753_CSS;
  assert(css.includes(REPLY_TARGET_0753_CSS));
  assert(REPLY_TARGET_0753_CSS.includes("box-shadow:0 0 0 3px var(--sand-text-primary)"));
  assert.match(REPLY_TARGET_0753_CSS, /@media\s*\(prefers-reduced-motion:reduce\)/);
  assert(REPLY_TARGET_0753_CSS.includes("animation-duration:2.5s"));
  assert(!REPLY_TARGET_0753_CSS.includes("cursor-warn"));
});

test("transplanted highlight rules retain the official artifact hashes", async t => {
  const css = await readFile("/tmp/official0753/dist/renderer/assets/index-CFSAhbDS.css", "utf8").catch(() => null);
  if (css == null) return t.skip("official comparison artifact unavailable");
  assert.equal(createHash("sha256").update(css).digest("hex"), official.cssSha256);
  assert(css.includes("@keyframes sand-zzcn73-B{0%{box-shadow:0 0 0 0 var(--sand-text-primary)}"));
});
