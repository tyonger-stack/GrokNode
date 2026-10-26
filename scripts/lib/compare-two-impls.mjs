/**
 * Compare the INSTALLED surface of the two marketplace implementations in Grok Node:
 *
 *   A. the repo's hand-written replica (aria="市场"), opened from the pill;
 *   B. the genuine upstream 0.18 implementation (aria="插件"), opened by neutralizing
 *      the repo's capture-phase interceptor.
 *
 * Reports for each: the page structure, whether an installed/manage page exists, the
 * installed entries with their connector/skill counts and status, the private-skills
 * section, and the "show all N" affordance.
 *
 * Read-only: opens dialogs and clicks a tab. Installs, removes and authenticates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

const NEUTRALIZE = `(() => {
  const button = document.querySelector(".sand-agents-sidebar__plugins");
  if (button == null) return "no pill";
  const originalStop = Event.prototype.stopPropagation;
  const originalPrevent = Event.prototype.preventDefault;
  Event.prototype.stopPropagation = function () {};
  Event.prototype.preventDefault = function () {};
  try { button.click(); } finally {
    Event.prototype.stopPropagation = originalStop;
    Event.prototype.preventDefault = originalPrevent;
  }
  return "clicked";
})()`;

const READ = (aria) => `(() => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
    .find((d) => d.getAttribute("aria-label") === ${JSON.stringify(aria)});
  if (dlg == null) return null;
  const text = (dlg.innerText ?? "");
  const COUNT = /[0-9]+\\s*(个连接器|项技能|connector|skill)/i;
  const entries = [];
  const seen = new Set();
  const walker = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const value = (node.textContent ?? "").trim();
    if (!COUNT.test(value)) continue;
    let el = node.parentElement;
    for (let depth = 0; depth < 5 && el != null; depth += 1) {
      const own = (el.innerText ?? "").trim();
      if (own.length > value.length && own.length < 300) break;
      el = el.parentElement;
    }
    if (el == null) continue;
    const key = (el.innerText ?? "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(key.replace(/\\s+/g, " "));
  }
  const showAll = Array.from(dlg.querySelectorAll("button,a"))
    .map((el) => (el.innerText ?? "").trim())
    .find((t) => /显示全部|Show all/i.test(t));
  const tabs = Array.from(dlg.querySelectorAll("button,[role='tab'],a"))
    .map((el) => (el.innerText ?? "").trim().split("\\n")[0])
    .filter((t) => t.length > 0 && t.length < 24)
    .slice(0, 30);
  return {
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => (h.innerText ?? "").trim().slice(0, 50)),
    tabs,
    installedEntries: entries,
    showAll: showAll ?? null,
    hasPrivateSection: /私有技能|Private/.test(text),
    hasInstalledSection: /已安装|Installed/.test(text),
    textLength: text.length,
  };
})()`;

await session.evaluate(`(() => {
  const close = document.querySelector('[role="dialog"] button[aria-label="关闭"]');
  if (close != null) close.click();
})()`);
await new Promise((resolve) => setTimeout(resolve, 600));

// A: the replica, via the pill (unmodified click path).
await session.evaluate(`(() => {
  const button = document.querySelector(".sand-agents-sidebar__plugins");
  if (button != null) button.click();
})()`);
await new Promise((resolve) => setTimeout(resolve, 2500));
console.log("########## A. repo replica (aria=市场)");
console.log(JSON.stringify(await session.evaluate(READ("市场")), null, 1));

// B: the genuine upstream implementation.
await session.evaluate(NEUTRALIZE);
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log("\n########## B. upstream genuine (aria=插件), default page");
console.log(JSON.stringify(await session.evaluate(READ("插件")), null, 1));

// Click the upstream "Yours" tab.
const tab = await session.evaluate(`(() => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
    .find((d) => d.getAttribute("aria-label") === "插件");
  if (dlg == null) return "no dialog";
  const el = Array.from(dlg.querySelectorAll("button,[role='tab'],a"))
    .find((x) => /^Yours$/i.test((x.innerText ?? "").trim()));
  if (el == null) return "no tab";
  el.click();
  return "clicked";
})()`);
console.log("\n## Yours tab:", tab);
await new Promise((resolve) => setTimeout(resolve, 2500));
console.log("\n########## B. upstream genuine, Yours page");
console.log(JSON.stringify(await session.evaluate(READ("插件")), null, 1));

session.close();
