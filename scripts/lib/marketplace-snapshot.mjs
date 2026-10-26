/**
 * Open the Connect Apps (连接应用) marketplace surface in a live renderer and dump a
 * structural snapshot: the dialog shell, its headings, section titles, and the app rows.
 *
 * Read-only: it clicks the entry point and reads the DOM. It does not install, remove,
 * authenticate, or otherwise mutate account state.
 */

const ENTRY_SELECTORS = [
  ".sand-agents-sidebar__plugins",
  ".sand-agents-sidebar__plugins-entry button",
  "[data-sidebar-marketplace]",
  ".sand-plugins-dock",
];

export async function openMarketplace(session) {
  const clicked = await session.evaluate(`(() => {
    const selectors = ${JSON.stringify(ENTRY_SELECTORS)};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el != null) { el.click(); return selector; }
    }
    return null;
  })()`);
  if (clicked == null) return { clicked: null, snapshot: null };
  // The official surface mounts a dialog; give the lazy chunk a moment to load.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return { clicked, snapshot: await readMarketplaceSnapshot(session) };
}

export async function readMarketplaceSnapshot(session) {
  return session.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const root = dialog ?? document.body;
    const text = root.innerText ?? "";
    const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      tag: h.tagName,
      text: (h.innerText ?? "").trim().slice(0, 80),
    }));
    const ariaLabels = Array.from(root.querySelectorAll("[aria-label]"))
      .map((el) => el.getAttribute("aria-label"))
      .filter((v) => v != null && v.length > 0);
    const buttons = Array.from(root.querySelectorAll("button")).map((b) => ({
      text: (b.innerText ?? "").trim().slice(0, 40),
      aria: b.getAttribute("aria-label"),
      cls: (b.className && typeof b.className === "string" ? b.className : "").slice(0, 200),
    }));
    const classNames = new Set();
    for (const el of root.querySelectorAll("*")) {
      if (typeof el.className !== "string") continue;
      for (const c of el.className.split(/\\s+/)) if (c.startsWith("sand-")) classNames.add(c);
    }
    return {
      dialogAria: dialog?.getAttribute("aria-label") ?? null,
      textLength: text.length,
      textHead: text.slice(0, 3000),
      headings,
      ariaLabels: Array.from(new Set(ariaLabels)).slice(0, 60),
      buttonCount: buttons.length,
      buttons: buttons.slice(0, 120),
      sandClassCount: classNames.size,
      sandClasses: Array.from(classNames).sort(),
    };
  })()`);
}
