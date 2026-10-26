/**
 * Capture the official 0.75.8 Connect Apps surface: the browse page and the
 * "已连接 N 个" (N connected) manage page, including every installed entry.
 *
 * Read-only: clicks navigation only. Installs, removes and authenticates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9222);
const session = await CdpSession.open(PORT);

const readDialog = `(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return null;
  return {
    aria: dlg.getAttribute("aria-label"),
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      tag: h.tagName, text: (h.innerText ?? "").trim().slice(0, 60),
    })),
    text: (dlg.innerText ?? ""),
  };
})()`;

// Ensure a clean open.
await session.evaluate(`(() => {
  if (document.querySelector('[role="dialog"]') != null) {
    const close = document.querySelector('[role="dialog"] button[aria-label="关闭"]');
    if (close != null) { close.click(); return "closed"; }
  }
  return "none";
})()`);
await new Promise((resolve) => setTimeout(resolve, 800));

const opened = await session.evaluate(`(() => {
  const selectors = ["[data-sidebar-marketplace]", ".sand-agents-sidebar__plugins"];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el != null) { el.click(); return selector; }
  }
  return null;
})()`);
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log("## opened via:", opened);

const browse = await session.evaluate(readDialog);
console.log("\n########## BROWSE PAGE");
console.log("aria:", browse?.aria);
console.log("headings:", JSON.stringify(browse?.headings));
console.log(browse?.text?.slice(0, 4000));

// Click the "已连接 N 个" affordance to reach the manage page.
const clicked = await session.evaluate(`(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return "no dialog";
  const el = Array.from(dlg.querySelectorAll("button,[role='tab'],a"))
    .find((x) => /已连接\\s*\\d+\\s*个/.test((x.innerText ?? "").trim()));
  if (el == null) return "not found";
  const label = (el.innerText ?? "").trim();
  el.click();
  return label;
})()`);
console.log("\n## manage click:", clicked);
await new Promise((resolve) => setTimeout(resolve, 2500));

const manage = await session.evaluate(readDialog);
console.log("\n########## MANAGE PAGE");
console.log("aria:", manage?.aria);
console.log("headings:", JSON.stringify(manage?.headings));
console.log(manage?.text?.slice(0, 6000));

session.close();
