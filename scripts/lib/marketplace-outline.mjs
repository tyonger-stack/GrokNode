/**
 * Dump a structural outline of the live marketplace dialog so the official 0.75.8 shell
 * and the reconstructed Grok Node shell can be compared node-for-node.
 *
 * Read-only: reads the DOM, mutates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const DIALOG_ARIA = process.argv[3] ?? null;
const PORT = Number(process.argv[2] ?? 9222);

const outlineExpression = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const root = dialog ?? document.body;
  const out = [];
  const walk = (el, depth) => {
    if (depth > 8) return;
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      const cls = (typeof child.className === "string" ? child.className : "")
        .split(/\\s+/).filter((x) => x.startsWith("sand-")).slice(0, 5).join(" ");
      const role = child.getAttribute("role");
      const aria = child.getAttribute("aria-label");
      const own = Array.from(child.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean).join(" ").slice(0, 60);
      const interesting = cls || role || aria || own ||
        ["h1", "h2", "h3", "h4", "button", "nav", "ul", "li", "a", "input", "section", "img"].includes(tag);
      if (interesting) {
        out.push({ d: depth, tag, role: role ?? "", aria: aria ?? "", cls, txt: own });
      }
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
})()`;

const session = await CdpSession.open(PORT);
if (DIALOG_ARIA != null) {
  const opened = await session.evaluate(`(() => {
    const target = ${JSON.stringify(DIALOG_ARIA)};
    const existing = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((d) => d.getAttribute("aria-label") === target);
    if (existing) return "already-open";
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
  })()`);
  console.log("# opened via:", opened);
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

const rows = await session.evaluate(outlineExpression);
for (const row of rows) {
  const parts = [row.tag];
  if (row.role) parts.push(`[${row.role}]`);
  if (row.aria) parts.push(`aria="${row.aria}"`);
  if (row.cls) parts.push(`.${row.cls.split(" ").join(".")}`);
  if (row.txt) parts.push(`| ${row.txt}`);
  console.log(" ".repeat(row.d * 2) + parts.join(" "));
}
session.close();
