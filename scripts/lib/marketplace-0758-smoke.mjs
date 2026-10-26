/**
 * Post-deploy smoke for the official 0.75.8 "连接应用" marketplace port.
 *
 * Opens upstream 0.18's OWN plugins dialog (the pill is an upstream React node whose `onClick`
 * is `Rme.open(Uf.plugins())`; nothing intercepts it any more) and checks that the surface
 * carries official 0.75.8's shape and wording, then reads the bridge data the installed list is
 * built from.
 *
 * Read-only apart from opening a dialog: it installs, removes and authenticates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

const bridge = await session.evaluate(`(async () => {
  const d = window.desktop;
  const report = {};
  const safe = async (name, fn) => {
    try { report[name] = { ok: true, value: await fn() }; }
    catch (error) { report[name] = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  await safe("mcp.list", () => d.mcp.list());
  await safe("mcp.effectivePlugins", () => d.mcp.effectivePlugins());
  await safe("mcp.catalog", () => d.mcp.catalog());
  return report;
})()`);

const servers = bridge["mcp.list"].ok ? bridge["mcp.list"].value.servers ?? [] : [];
const effective = bridge["mcp.effectivePlugins"].ok ? bridge["mcp.effectivePlugins"].value : [];
const catalog = bridge["mcp.catalog"].ok ? bridge["mcp.catalog"].value : [];
console.log("## bridge");
console.log("   catalog entries:", catalog.length);
console.log("   installed servers:", servers.length, "| with pluginId:", servers.filter((s) => s.pluginId != null).length);
console.log("   effective plugins:", effective.length);
for (const plugin of effective.slice(0, 24)) {
  console.log(`     - ${plugin.pluginId} ${plugin.displayName} mode=${plugin.installMode} enabled=${plugin.isEnabled} servers=${JSON.stringify(plugin.mcpServerNames ?? [])}`);
}

// Open upstream's own dialog. The pill is an upstream React node; the rail row is this build's
// injection and reaches the same dialog through upstream's published opener.
const opened = await session.evaluate(`(() => {
  const pill = document.querySelector(".sand-agents-sidebar__plugins");
  if (pill != null) { pill.click(); return { via: "pill" }; }
  const rail = document.querySelector(".sand-plugins-dock-rail");
  if (rail != null) { rail.click(); return { via: "rail" }; }
  return { via: "none" };
})()`);
console.log("\n## dialog open:", JSON.stringify(opened));
await new Promise((resolve) => setTimeout(resolve, 3500));

const dialog = await session.evaluate(`(() => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
  if (dlg == null) return null;
  const rect = dlg.getBoundingClientRect();
  return {
    aria: dlg.getAttribute("aria-label"),
    box: [Math.round(rect.width), Math.round(rect.height)],
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => ({ tag: h.tagName, text: (h.innerText ?? "").trim().slice(0, 60) })),
    tabs: Array.from(dlg.querySelectorAll('[role="tab"], [role="radio"], [role="button"]'))
      .map((el) => (el.innerText ?? "").trim()).filter((t) => t.length > 0 && t.length < 40).slice(0, 24),
    text: (dlg.innerText ?? "").slice(0, 3000),
    classes: Array.from(new Set(Array.from(dlg.querySelectorAll("*"))
      .filter((el) => typeof el.className === "string")
      .flatMap((el) => el.className.split(/\\s+/))
      .filter((c) => c.startsWith("sand-plugins")))).sort(),
  };
})()`);

if (dialog == null) {
  console.log("\n## NO DIALOG RENDERED");
} else {
  console.log("\n## dialog");
  console.log("   aria-label:", dialog.aria, "| box:", JSON.stringify(dialog.box));
  console.log("   headings:", JSON.stringify(dialog.headings));
  console.log("   tabs:", JSON.stringify(dialog.tabs));
  console.log("   classes:", dialog.classes.join(" "));
  console.log("   --- text ---");
  console.log(dialog.text);
}

session.close();
