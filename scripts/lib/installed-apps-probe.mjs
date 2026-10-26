/**
 * Extract the official 0.75.8 "已安装" (Installed) list from the live official renderer,
 * and the same from the reconstructed Grok Node, so the two installed sets can be compared
 * item by item.
 *
 * Read-only: reads the DOM of an already-open dialog.
 */

import { CdpSession } from "./cdp-probe.mjs";

const READ_INSTALLED = `(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return null;
  // Installed entries carry a connector/skill count line. Find leaf text nodes whose
  // own text contains the count, then walk up to the nearest row-like container.
  const COUNT = /[0-9]+\\s*(个连接器|项技能|connector|skill)/i;
  const rows = [];
  const seen = new Set();
  const walker = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (!COUNT.test(text)) continue;
    let el = node.parentElement;
    // Climb to a container that also holds the plugin name (a few levels up).
    let container = el;
    for (let depth = 0; depth < 6 && container != null; depth += 1) {
      const own = (container.innerText ?? "").trim();
      if (own.length > text.length && own.length < 400) { container = el; break; }
      el = container.parentElement;
      container = el;
    }
    if (container == null) continue;
    const key = container.innerText ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ text: key.replace(/\\s+/g, " ").slice(0, 220), cls: (typeof container.className === "string" ? container.className : "").slice(0, 140) });
  }
  const showAll = Array.from(dlg.querySelectorAll("button,a"))
    .map((el) => (el.innerText ?? "").trim())
    .find((t) => /显示全部|Show all/i.test(t));
  return { rows, showAll };
})()`;

for (const [label, port] of [["official", 9222], ["grok-node", 9224]]) {
  const session = await CdpSession.open(port);
  const opened = await session.evaluate(`(() => {
    const selectors = [".sand-agents-sidebar__plugins", "[data-sidebar-marketplace]", ".sand-plugins-dock"];
    // If a dialog is already open, leave it alone; a second click would toggle it closed.
    if (document.querySelector('[role="dialog"]') != null) return "already-open";
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el != null) { el.click(); return selector; }
    }
    return null;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const data = await session.evaluate(READ_INSTALLED);
  console.log(`\n########## ${label} (opened via ${opened})`);
  if (data == null) {
    console.log("no dialog");
  } else {
    console.log("showAll:", data.showAll ?? "(none)");
    console.log(`installed rows: ${data.rows.length}`);
    for (const row of data.rows) console.log(`  - ${row.text}`);
  }
  session.close();
}
