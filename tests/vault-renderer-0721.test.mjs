import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";
import {
  VAULT_RENDERER_MARK,
  buildVaultRendererBundle,
  patchVaultSettingsSources,
} from "../scripts/lib/vault-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asarSkip = !existsSync(path.resolve(repoRoot, "../rea-grokbot-0755/asar/app.asar"))
  && "0.75.5 snapshot is absent";
const window = new Window({ url: "http://localhost/" });
for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "MutationObserver", "getComputedStyle", "performance"]) {
  globalThis[name] = name === "window" ? window : name === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[name] ?? globalThis[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const evidence = process.env.R1_EVIDENCE_DIR;
function record(name, value) {
  if (evidence === undefined) return;
  mkdirSync(evidence, { recursive: true });
  if (typeof value === "string") writeFileSync(path.join(evidence, name + ".html"), value);
  else writeFileSync(path.join(evidence, name + ".json"), JSON.stringify(value, null, 2));
}

async function loadHost() {
  const built = await buildVaultRendererBundle();
  const context = {
    S: React,
    p: jsxRuntime,
    Wr: ReactDOM,
    window,
    document: window.document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    TextEncoder,
    TextDecoder,
    URL,
    Intl,
    crypto,
    performance,
    navigator: window.navigator,
    requestAnimationFrame: typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : clearTimeout,
    ResizeObserver: globalThis.ResizeObserver,
    MutationObserver: window.MutationObserver,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    ShadowRoot: window.ShadowRoot ?? class {},
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
    history: window.history,
    CSS: window.CSS ?? { supports: () => false, escape: (value) => String(value) },
    reportError: (error) => console.error(error),
  };
  vm.runInNewContext(built.bundle, context);
  assert.equal(typeof context.__sandVaultRendererNS.RVaultSettingsHost, "function");
  return { built, host: context.__sandVaultRendererNS.RVaultSettingsHost };
}

function credential() {
  return [
    { id: "login-1", title: "Example", username: "user@example.test", notes: "", sites: ["https://example.com"], createdAtMs: 1, updatedAtMs: 1 },
    { id: "card-1", title: "Card 4242", username: "", notes: "", sites: [], card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2029, holderName: "Synthetic User", nickname: "", billingAddressId: "", billingAddress: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "" } }, createdAtMs: 1, updatedAtMs: 1 },
    { id: "contact-1", title: "Billing contact", username: "", notes: "", sites: [], contact: { name: "Synthetic Contact", line1: "", line2: "", city: "", region: "", postalCode: "", country: "", phone: "", email: "contact@example.test", defaultShipping: true }, createdAtMs: 1, updatedAtMs: 1 },
  ];
}

function mockDesktop() {
  const calls = { list: 0, mutations: [] };
  const items = credential();
  return {
    calls,
    listGrokBotVaultCredentials: async () => {
      calls.list += 1;
      return items;
    },
    putGrokBotVaultCredential: async (input) => {
      calls.mutations.push(["put", input]);
      return items[0];
    },
    createGrokBotVaultLogins: async (input) => {
      calls.mutations.push(["createLogins", input]);
      return input.logins.map(() => ({ kind: "imported" }));
    },
    updateGrokBotVaultCard: async (input) => {
      calls.mutations.push(["updateCard", input]);
      return items[1];
    },
    putGrokBotVaultContact: async (input) => {
      calls.mutations.push(["putContact", input]);
      return items[2];
    },
    createGrokBotVaultCard: async (input) => {
      calls.mutations.push(["createCard", input]);
      return items[1];
    },
    deleteGrokBotVaultCredential: async (input) => {
      calls.mutations.push(["delete", input]);
    },
    readGrokBotCardPhoto: async () => ({ outcome: "unavailable" }),
    cancelGrokBotCardPhotoRead: async () => undefined,
  };
}

async function render(t, ui, Host) {
  const host = window.document.createElement("div");
  const shell = window.document.createElement("div");
  shell.className = "sand-shell";
  shell.dataset.theme = "dark";
  const header = window.document.createElement("header");
  header.className = "sand-settings-pane-header";
  header.append(window.document.createElement("span"));
  host.setAttribute("data-vault-test-root", "");
  shell.append(header, host);
  window.document.body.append(shell);
  const root = ui.createRoot(host);
  t.after(async () => {
    await ui.act(async () => root.unmount());
    host.remove();
    await closeLibraryDom(window);
  });
  await ui.act(async () => root.render(ui.createElement(Host, {})));
  for (let index = 0; index < 20; index += 1) {
    await ui.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if ((host.textContent ?? "").length > 0) break;
  }
  return host;
}

async function settle(ui, predicate) {
  for (let index = 0; index < 30; index += 1) {
    await ui.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) return;
  }
}

async function openNewItem(ui) {
  const trigger = [...window.document.querySelectorAll("[data-sand-vault-actions] button, #sand-vault-0721-root button")]
    .find((button) => (button.textContent ?? "").trim() === "New item");
  assert.equal(trigger instanceof window.HTMLButtonElement, true, "New item trigger is missing");
  await ui.act(async () => trigger.click());
  await settle(ui, () => window.document.querySelector('[role="menuitem"]') !== null);
  return [...window.document.querySelectorAll('[role="menuitem"]')];
}

async function chooseNewItem(ui, index) {
  const items = await openNewItem(ui);
  assert.equal(items.length, 4, "New item must expose login, card, contact, and CSV actions");
  const item = items[index];
  await ui.act(async () => {
    item.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    item.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    item.click();
  });
  await settle(ui, () => window.document.querySelector('[role="dialog"]') !== null);
  return window.document.querySelector('[role="dialog"]');
}

async function closeDialog(ui) {
  const dialog = window.document.querySelector('[role="dialog"]');
  const close = dialog && [...dialog.querySelectorAll("button")]
    .find((button) => ["Close dialog", "关闭对话框", "Cancel", "取消"].includes(button.getAttribute("aria-label") ?? (button.textContent ?? "").trim()));
  assert.equal(close instanceof window.HTMLButtonElement, true, "Open dialog must expose its close control");
  await ui.act(async () => close.click());
  await settle(ui, () => window.document.querySelector('[role="dialog"]') === null);
}

test("original 0.75.5 Vault settings render list, cards, and contacts through the local bridge", { skip: asarSkip }, async (t) => {
  const ui = { createElement: React.createElement, createRoot, act: React.act };
  const { built, host: Host } = await loadHost();
  const desktop = mockDesktop();
  window.desktop = { vault: desktop };
  const host = await render(t, ui, Host);
  const text = host.textContent ?? "";
  assert.equal(desktop.calls.list >= 1, true);
  const state = window.__sandVault0721Client?.grokBotVault.snapshots.get();
  assert.equal(window.__sandVault0721Client?.theme.snapshots.get().resolved, "dark", "Vault must follow the Grok Node shell theme");
  await ui.act(async () => {
    window.document.querySelector(".sand-shell")?.setAttribute("data-theme", "light");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(window.__sandVault0721Client?.theme.snapshots.get().resolved, "light", "Vault must observe shell theme changes");
  assert.equal(text.includes("example.com"), true, `${host.outerHTML}\n${JSON.stringify(state)}`);
  assert.equal(text.includes("user@example.test"), true);
  assert.equal(text.includes("visa"), true);
  assert.equal(text.includes("Synthetic Contact"), true);
  assert.equal(host.querySelectorAll("button").length > 3, true);
  assert.equal((window.document.body.textContent ?? "").includes("New item"), true, "Vault settings must render the official create menu in the pane header portal");
  assert.equal(built.bundle.includes(VAULT_RENDERER_MARK), true);
  const officialUiRules = [...built.generated.style.matchAll(/#sand-vault-0721-root \.ui-/gu)].length;
  assert.equal(officialUiRules >= 500, true, "official UI design-system styles must accompany the transplanted component");
  assert.match(built.generated.style, /\[data-sand-vault-actions\] \.sand-/u, "official Vault styles must cover the pane-action portal");
  assert.match(built.generated.style, /data-sand-vault-actions\] \[aria-expanded="true"\].*data-component="menu-popup"/u, "official menu styles must also cover the body portal");
  assert.match(built.generated.style, /--sand-menu-radius:12px/u, "official menu dimensions must be transplanted with the component");
  assert.match(built.generated.style, /:is\(\.sand-13yp6sp\)/u, "official sand menu rules must reach the body portal");
  assert.match(built.generated.style, /body:has\(\.sand-settings-dialog\) \.sand-settings-dialog:not.*background-color:var\(--sand-bg-subtle\)/u, "Every settings section must use the Vault settings background");
  assert.match(built.generated.style, /body:has\(\.sand-settings-dialog\) \.sand-settings-dialog \.sand-settings-nav:not.*background-color:transparent/u, "Every settings section must use the Vault sidebar surface");
  assert.match(built.generated.style, /\.sand-settings-dialog:not.*--cursor-bg-secondary:var\(--sand-fill-secondary\).*--cursor-border-secondary:var\(--sand-border-default\).*--cursor-text-primary:var\(--sand-text-primary\)/u, "Settings cards must reuse the Vault color tokens");
  assert.equal(/createRoot\s*\(/u.test(built.bundle), false);
  assert.equal(/new\s+MutationObserver[\s\S]{0,320}\.observe\(\s*(?:document\.(?:body|documentElement)|window)\b/u.test(built.bundle), false);
  record("vault-render-host", host.outerHTML);
  const actions = window.document.querySelector("[data-sand-vault-actions]");
  assert.equal(actions instanceof window.HTMLElement, true, "Vault pane actions portal is missing");
  const newItem = [...actions.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("New item"));
  assert.equal(newItem instanceof window.HTMLButtonElement, true, "New item trigger is missing");
  await ui.act(async () => newItem.click());
  for (let index = 0; index < 20; index += 1) {
    await ui.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (window.document.querySelector('[data-component="menu-popup"], [role="menu"]') !== null) break;
  }
  const menu = window.document.querySelector('[data-component="menu-popup"], [role="menu"]');
  assert.equal(menu !== null, true, "New item menu did not open");
  record("vault-new-item-menu", window.document.body.outerHTML);

  await ui.act(async () => {
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle(ui, () => window.document.querySelector('[role="menuitem"]') === null);

  const loginDialog = await chooseNewItem(ui, 0);
  assert.match(loginDialog?.textContent ?? "", /New login|新登录信息/u, "Login action must open the official login dialog");
  await closeDialog(ui);

  const cardDialog = await chooseNewItem(ui, 1);
  assert.match(cardDialog?.textContent ?? "", /New card|新卡片/u, "Card action must open the official card dialog");
  await closeDialog(ui);

  const contactDialog = await chooseNewItem(ui, 2);
  assert.match(contactDialog?.textContent ?? "", /New contact info|新建联系信息/u, "Contact info action must open the official contact form");
  assert.equal(contactDialog?.querySelectorAll("input, select").length >= 8, true, "Contact form must retain every official field");
  await closeDialog(ui);

  const csvDialog = await chooseNewItem(ui, 3);
  assert.match(csvDialog?.textContent ?? "", /Import from CSV|从 CSV 导入/u, "CSV action must open the official import dialog");
  assert.equal(csvDialog?.querySelectorAll('input[type="file"]').length, 1, "CSV import must retain the official file picker");
  await closeDialog(ui);
  assert.equal(window.document.querySelector('[role="dialog"]') === null, true, "All New item dialogs must close without navigating away");
  record("vault-render-summary", {
    bundleBytes: built.bundle.length,
    styleBytes: built.generated.style.length,
    listCalls: desktop.calls.list,
    buttons: host.querySelectorAll("button").length,
  });
  delete window.desktop;
});

test("settings source patch adds the original Vault id, label, icon, and one host render branch", async () => {
  const view = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  const surface = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/desktop-surface.tsx"), "utf8");
  const patched = patchVaultSettingsSources({ view, surface });
  assert.match(patched.view, /"general" | "router" | "vault" | "usage" | "beta"/);
  assert.match(patched.view, /id: "vault", label: "Vault", icon: "vault"/);
  assert.equal(patched.surface.includes('if (section === "vault") return <RVaultSettingsHost focusSetting={null} />;'), true);
  assert.equal(patched.surface.split("RVaultSettingsHost").length - 1, 2);
  assert.throws(() => patchVaultSettingsSources(patched), /already applied/);
  record("vault-settings-patch", {
    sectionId: "vault",
    label: "Vault",
    icon: "vault",
    upstreamRegistryEvidence: "D6 uses id=vault, label id=GAYFP2, icon=vault",
  });
});

test("generated original module preserves the pinned CSV reader and planner closure", async () => {
  const source = readFileSync(path.join(repoRoot, "frontend/src/recovered/features/vault/upstream-vault-settings.generated.mjs"), "utf8");
  assert.match(source, /chunk-csv-parse-C5LpQq5n\.js/);
  assert.match(source, /function Me2?\(/);
  assert.match(source, /login_uri|login_username|login_password/);
  assert.match(source, /NoteType:Credit Card/);
  assert.match(source, /batchCreateGrokBotVaultCredentials|createGrokBotVaultLogins/);
  assert.match(source, /12bba50ba6cf12b35132518788610677a3fdc65de4ad849628d757bc7b780e5a/);
});

