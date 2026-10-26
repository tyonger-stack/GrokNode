/**
 * Open the genuine UPSTREAM 0.18 plugins dialog (by neutralizing the repo's
 * capture-phase interceptor) and read both of its pages: the browse page and the
 * "Yours" (installed) page.
 *
 * Read-only: opens dialogs and clicks a tab. It installs, removes and authenticates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

await session.evaluate(`(() => {
  const button = document.querySelector(".sand-agents-sidebar__plugins");
  if (button == null) return;
  const originalStop = Event.prototype.stopPropagation;
  const originalPrevent = Event.prototype.preventDefault;
  Event.prototype.stopPropagation = function () {};
  Event.prototype.preventDefault = function () {};
  try { button.click(); } finally {
    Event.prototype.stopPropagation = originalStop;
    Event.prototype.preventDefault = originalPrevent;
  }
})()`);
await new Promise((resolve) => setTimeout(resolve, 3000));

// The upstream dialog is the one whose aria-label is not the repo's replica label.
const upstream = await session.evaluate(`(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  return dialogs.map((d) => d.getAttribute("aria-label"));
})()`);
console.log("## dialogs present:", JSON.stringify(upstream));

const readUpstream = `(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  const dlg = dialogs.find((d) => d.getAttribute("aria-label") === "插件")
    ?? dialogs.find((d) => !["市场"].includes(d.getAttribute("aria-label")));
  if (dlg == null) return null;
  return {
    aria: dlg.getAttribute("aria-label"),
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => (h.innerText ?? "").trim().slice(0, 60)),
    text: (dlg.innerText ?? "").slice(0, 3500),
  };
})()`;

console.log("\n## upstream dialog, default page:");
console.log(JSON.stringify(await session.evaluate(readUpstream), null, 1));

// Click the "Yours" tab.
const tabClicked = await session.evaluate(`(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  const dlg = dialogs.find((d) => d.getAttribute("aria-label") === "插件");
  if (dlg == null) return "no upstream dialog";
  const tab = Array.from(dlg.querySelectorAll("button,[role='tab'],a"))
    .find((el) => /^Yours$/i.test((el.innerText ?? "").trim()));
  if (tab == null) return "no Yours tab";
  const label = (tab.innerText ?? "").trim();
  tab.click();
  return label;
})()`);
console.log("\n## Yours tab click:", tabClicked);
await new Promise((resolve) => setTimeout(resolve, 2500));

console.log("\n## upstream dialog, Yours page:");
console.log(JSON.stringify(await session.evaluate(readUpstream), null, 1));

session.close();
