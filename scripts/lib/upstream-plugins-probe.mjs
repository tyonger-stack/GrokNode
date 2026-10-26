/**
 * Decisive probe: neutralize the repo's capture-phase click interceptor on the sidebar
 * Plugins pill and let the UPSTREAM 0.18 React handler run, so the genuine upstream
 * plugins dialog renders. Then dump what it produced.
 *
 * Read-only apart from opening a dialog. It does not install, remove, authenticate, or
 * mutate account state. The prototype patch is reverted immediately after the click.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

const result = await session.evaluate(`(() => {
  const button = document.querySelector(".sand-agents-sidebar__plugins");
  if (button == null) return { ok: false, reason: "no pill" };
  const originalStop = Event.prototype.stopPropagation;
  const originalPrevent = Event.prototype.preventDefault;
  Event.prototype.stopPropagation = function () {};
  Event.prototype.preventDefault = function () {};
  try {
    button.click();
  } finally {
    Event.prototype.stopPropagation = originalStop;
    Event.prototype.preventDefault = originalPrevent;
  }
  return { ok: true };
})()`);
console.log("## click dispatched:", JSON.stringify(result));
await new Promise((resolve) => setTimeout(resolve, 3000));

const snapshot = await session.evaluate(`(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  return dialogs.map((dlg) => ({
    aria: dlg.getAttribute("aria-label"),
    textLength: (dlg.innerText ?? "").length,
    headings: Array.from(dlg.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      tag: h.tagName, text: (h.innerText ?? "").trim().slice(0, 60),
    })),
    text: (dlg.innerText ?? "").slice(0, 2500),
    classNames: Array.from(new Set(Array.from(dlg.querySelectorAll("*"))
      .filter((el) => typeof el.className === "string")
      .flatMap((el) => el.className.split(/\\s+/))
      .filter((c) => c.startsWith("sand-plugins")))).sort(),
  }));
})()`);

for (const [index, dialog] of snapshot.entries()) {
  console.log(`\n########## dialog[${index}] aria=${dialog.aria} textLength=${dialog.textLength}`);
  console.log("headings:", JSON.stringify(dialog.headings));
  console.log("plugin classes:", dialog.classNames.join(" "));
  console.log("--- text ---");
  console.log(dialog.text);
}

session.close();
