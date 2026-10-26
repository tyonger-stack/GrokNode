/**
 * Compare the live Connect Apps surface of the official Grok Bot and the reconstructed
 * Grok Node: page shell, section titles, installed entries, and per-entry status.
 *
 * Read-only: opens the dialog and reads the DOM.
 */

import { CdpSession } from "./cdp-probe.mjs";

const OPEN = `(() => {
  const selectors = [
    ".sand-agents-sidebar__plugins",
    ".sand-agents-sidebar__plugins-entry button",
    "[data-sidebar-marketplace]",
    ".sand-plugins-dock",
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el != null) { el.click(); return selector; }
  }
  return null;
})()`;

const READ = `(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg == null) return null;
  const rows = Array.from(dlg.querySelectorAll(".sand-plugins-row, .sand-plugins__yours button, [data-plugin-id]")).map((el) => ({
    cls: (typeof el.className === "string" ? el.className : "").split(/\\s+/).filter((c) => c.startsWith("sand-plugins")).join(" "),
    text: (el.innerText ?? "").trim().slice(0, 160),
  }));
  return {
    dialogAria: dlg.getAttribute("aria-label"),
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      tag: h.tagName, text: (h.innerText ?? "").trim().slice(0, 60),
    })),
    text: (dlg.innerText ?? "").slice(0, 2500),
    rows: rows.slice(0, 80),
    rowCount: rows.length,
  };
})()`;

for (const [label, port] of [["official", 9222], ["grok-node", 9224]]) {
  const session = await CdpSession.open(port);
  const opened = await session.evaluate(OPEN);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const data = await session.evaluate(READ);
  console.log(`\n########## ${label} (port ${port}) opened via ${opened}`);
  if (data == null) {
    console.log("no dialog found");
  } else {
    console.log("dialogAria:", data.dialogAria);
    console.log("headings:", JSON.stringify(data.headings));
    console.log("rowCount:", data.rowCount);
    console.log("--- text ---");
    console.log(data.text);
  }
  session.close();
}
