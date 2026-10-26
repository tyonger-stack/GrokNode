/**
 * Explore the live official 0.75.8 Connect Apps surface:
 *   1. the manage page (installed plugins + skills) that the sidebar entry opens,
 *   2. the browse view reached from it, so both shells can be compared.
 *
 * Read-only: clicks navigation only, never installs/removes/authenticates.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9222);
const session = await CdpSession.open(PORT);

const manage = await session.evaluate(`(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return null;
  const links = Array.from(dlg.querySelectorAll("button, a")).map((el) => ({
    text: (el.innerText ?? "").trim(),
    tag: el.tagName.toLowerCase(),
    aria: el.getAttribute("aria-label"),
  })).filter((x) => x.text.length > 0);
  return { dialogAria: dlg.getAttribute("aria-label"), links };
})()`);

console.log("## dialog aria:", manage?.dialogAria);
console.log("## clickable entries:");
for (const link of manage?.links ?? []) console.log(`   [${link.tag}] ${link.text}`);

// Click the "show all N plugins" affordance if present.
const browse = await session.evaluate(`(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return { ok: false };
  const el = Array.from(dlg.querySelectorAll("button, a"))
    .find((x) => /显示全部|查看全部|show all/i.test((x.innerText ?? "").trim()));
  if (el == null) return { ok: false, reason: "no show-all affordance" };
  el.click();
  return { ok: true, text: (el.innerText ?? "").trim() };
})()`);
console.log("## browse click:", JSON.stringify(browse));
await new Promise((resolve) => setTimeout(resolve, 2500));

const browseSnapshot = await session.evaluate(`(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return null;
  return {
    dialogAria: dlg.getAttribute("aria-label"),
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      tag: h.tagName, text: (h.innerText ?? "").trim().slice(0, 80),
    })),
    textLength: (dlg.innerText ?? "").length,
    text: (dlg.innerText ?? "").slice(0, 4000),
  };
})()`);
console.log("## browse dialog aria:", browseSnapshot?.dialogAria);
console.log("## browse headings:", JSON.stringify(browseSnapshot?.headings, null, 1));
console.log("## browse text:");
console.log(browseSnapshot?.text ?? "");

session.close();
