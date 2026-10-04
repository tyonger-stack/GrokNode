#!/usr/bin/env node
// Rendered-value parity check for the marketplace detail page, run over CDP against a LIVE app.
//
// Why this exists and why it is not part of `npm test`: the whole 886-test suite is source-text
// and logic assertions — there is no DOM library in the project. That is enough for structure, but
// it let two real defects ship with a green suite:
//
//   - the add-account CTA put its copy in `aria-label` and rendered icon-only (34px vs official's
//     43px), because a source assertion only proved the CONSTANT existed, never that the string
//     reached the screen;
//   - every full-width detail row computed `padding: 12px 0px` against official's `12px 14px`.
//
// So the assertions that matter for those are made here, against computed styles and textContent.
//
// The baselines below were measured on official 0.66 by cloning each button one class at a time to
// find which class carries which padding, and by reading textContent / aria-label / child counts.
//
// Usage:
//   node scripts/verify-marketplace-detail-parity.mjs 9232          # local build
//   node scripts/verify-marketplace-detail-parity.mjs 9224          # official build
//
// Exit code 0 = every check passed. Identity is asserted first: a wrong bundle reports a pass that
// means nothing, and this project has already been burned by an "official" forensics script that was
// a byte-for-byte copy of the local one.

import { writeFileSync } from "node:fs";

const port = process.argv[2] ?? "9232";
const outPath = process.argv[3] ?? null;
// Derived from the port on purpose: pointing this at the wrong app must fail loudly, because a
// parity check that silently measures the build it is supposed to be comparing against is worse
// than no check at all.
const OFFICIAL_PORT = "9224";
const EXPECT = process.env.EXPECT_BUNDLE
  ?? (port === OFFICIAL_PORT ? "Grok%20Bot.app" : "Grok%20Node.app");

const BASELINES = {
  addAccount: {
    textContent: "添加其他账户",
    ariaLabel: null,
    childCount: 1,
    padding: "12px 14px",
    height: 43,
  },
  toolsRow: { padding: "12px 14px", height: 42 },
};

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.error(`no page target on :${port} — is the app running with --remote-debugging-port=${port}?`);
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id != null && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const guard = setTimeout(() => { console.error("evaluate timed out after 45s — the page is likely blocked"); process.exit(3); }, 45_000);
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  clearTimeout(guard);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page exception");
  return r.result.value;
};

// --- identity ---------------------------------------------------------------------------------
const id = await evaluate("return { href: location.href };");
if (!id.href.includes(EXPECT)) {
  console.error(`IDENTITY MISMATCH: expected ${EXPECT} in ${decodeURIComponent(id.href)}`);
  process.exit(2);
}
console.log(`identity OK: ${decodeURIComponent(id.href)}\n`);

// --- open a detail page for an installed entry -------------------------------------------------
// No evaluation below awaits ACROSS a UI state transition. Opening the marketplace and opening a
// detail page both swap the renderer's execution context, and an `awaitPromise` evaluation still
// pending at that moment never resolves — it hangs until the CDP timeout instead of erroring.
// So each step fires its transition, returns immediately, and the wait happens Node-side.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wideFn = `
  const wide = () => document.querySelector('[role="dialog"]')
    ?? [...document.querySelectorAll("div")].filter(n => { const b = n.getBoundingClientRect();
         return b.width > 500 && b.height > 300; })
       .sort((a,b) => (b.getBoundingClientRect().width*b.getBoundingClientRect().height)
                    - (a.getBoundingClientRect().width*a.getBoundingClientRect().height))[0];
`;

// step 1 — make sure the marketplace dialog is on screen
await evaluate(`${wideFn}
  if (!wide()) {
    (document.querySelector('[data-sidebar-marketplace]')
     ?? document.querySelector('.sand-plugins-dock-rail button')
     ?? document.querySelector('.sand-agents-sidebar__plugins-entry button'))?.click();
  }
  return true;`);
await sleep(3500);

// step 2 — click the detail row (prefer Gmail: installed, so 账户 + 工具 both render)
const opened = await evaluate(`${wideFn}
  if (!wide()) return { error: "marketplace dialog never opened" };
  const row = [...document.querySelectorAll('button[aria-label^="打开"]')]
    .find(b => b.getAttribute("aria-label") === "打开 Gmail")
    ?? document.querySelector('button[aria-label^="打开"]');
  if (!row) return { error: "no detail row available on the current page" };
  const name = row.getAttribute("aria-label");
  row.click();
  return { entry: name };`);
if (opened.error) { console.error(`  ${opened.error}`); process.exit(2); }
await sleep(2500);
console.log(`entry: ${opened.entry}\n`);

// step 3 — read the rendered values
const measured = await evaluate(`${wideFn}
  const v = wide();
  const box = (n) => {
    if (!n) return null;
    const cs = getComputedStyle(n);
    return { textContent: n.textContent, ariaLabel: n.getAttribute("aria-label"),
             childCount: n.children.length, padding: cs.padding,
             height: Math.round(n.getBoundingClientRect().height) };
  };
  return {
    addAccount: box(v?.querySelector(".sand-plugins-detail__add-account")),
    toolsRow: box([...(v?.querySelectorAll("button") ?? [])].find(b => /已启用/.test(b.innerText || ""))),
  };`);

const checks = [];
const eq = (name, got, want) => checks.push({ name, got, want, pass: got === want });

if (measured.addAccount == null) {
  checks.push({ name: "add-account CTA present", got: null, want: "an element", pass: false });
} else {
  for (const key of ["textContent", "ariaLabel", "childCount", "padding", "height"]) {
    eq(`add-account ${key}`, measured.addAccount[key], BASELINES.addAccount[key]);
  }
}
if (measured.toolsRow == null) {
  checks.push({ name: "工具 row present", got: null, want: "an element", pass: false });
} else {
  for (const key of ["padding", "height"]) {
    eq(`tools row ${key}`, measured.toolsRow[key], BASELINES.toolsRow[key]);
  }
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) {
  const detail = c.pass ? "" : `   got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}${detail}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (outPath) writeFileSync(outPath, JSON.stringify({ port, href: id.href, entry: opened.entry, measured, baselines: BASELINES, checks, failed }, null, 2) + "\n");

ws.close();
process.exit(failed === 0 ? 0 : 1);
