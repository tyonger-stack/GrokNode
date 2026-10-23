import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamIndex = path.resolve(
  path.dirname(repoRoot),
  "rea-grokbot-0750/app/dist/renderer/assets/index.eager-app-wqHXQRAi.js",
);

const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "File", "DataTransfer", "Event"]) {
  globalThis[name] = name === "window" ? window : window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const built = await build({
  stdin: {
    contents: `export {act} from "react";
export {createElement} from "react";
export {createRoot} from "react-dom/client";
export {VaultCardDialog, collectPhotoFiles, photoFailureCopy, scanPromptCopy, CARD_PHOTO_ACCEPTED_MIME_TYPES, DEFAULT_VAULT_CARD_DIALOG_COPY, UPSTREAM_VAULT_CARD_DIALOG_COPY_IDS} from "./frontend/src/recovered/features/vault/card-dialog";
export {VaultCardEditor, validateVaultCardDraft, isVaultCardDraftValid, cardBrandOf, formatCardNumber, formatCardExpiry, cardDraftToVaultValues, EMPTY_CARD_DRAFT, UPSTREAM_VAULT_CARD_EDITOR_COPY_IDS} from "./frontend/src/recovered/features/vault/card-editor";`,
    resolveDir: repoRoot,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const ui = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

const host = document.createElement("div");
document.body.append(host);
const root = ui.createRoot(host);

const validDraft = {
  number: "4242 4242 4242 4242",
  expiry: "12/28",
  securityCode: "123",
  holderName: "Ada Lovelace",
};

function dialogProps(overrides = {}) {
  return {
    open: true,
    mode: { kind: "new" },
    draft: { ...validDraft },
    photo: { status: "idle" },
    disabled: false,
    saving: false,
    onChange: () => {},
    onSubmitPhoto: () => {},
    onCancelPhoto: () => {},
    onSave: () => {},
    onClose: () => {},
    ...overrides,
  };
}

async function render(props) {
  await ui.act(async () => {
    root.render(ui.createElement(ui.VaultCardDialog, props));
  });
}

function buttonNamed(label) {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === label);
}

function setNativeValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test.after(async () => {
  await ui.act(async () => {
    root.unmount();
  });
  host.remove();
  await closeLibraryDom(window);
});

test("photo entry accepts card images and hands them to the injected bridge callback", async () => {
  const submitted = [];
  await render(dialogProps({
    onSubmitPhoto: (files) => submitted.push(...files),
  }));
  assert.match(host.textContent, /Fill from photos of the card/);

  const input = host.querySelector('input[type="file"]');
  assert.ok(input, "the dialog renders a photo file input");
  assert.equal(input.getAttribute("accept"), "image/png,image/jpeg,image/gif,image/webp");

  const image = new window.File(["card"], "card.png", { type: "image/png" });
  const notes = new window.File(["notes"], "notes.txt", { type: "text/plain" });
  await ui.act(async () => {
    input.files = [image, notes];
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.deepEqual(submitted.map((file) => file.name), ["card.png"]);

  const picked = ui.collectPhotoFiles({ length: 2, 0: image, 1: notes });
  assert.deepEqual(picked, [image]);
  assert.deepEqual(ui.CARD_PHOTO_ACCEPTED_MIME_TYPES, ["image/png", "image/jpeg", "image/gif", "image/webp"]);
});

test("dragging a photo over the drop zone shows the upstream drop copy", async () => {
  await render(dialogProps());
  assert.equal(host.textContent.includes("Drop the photo to fill the card"), false);
  const zone = host.querySelector(".sand-vault-card-photo");
  assert.ok(zone, "the dialog renders the photo drop zone");
  await ui.act(async () => {
    zone.dispatchEvent(new window.Event("dragover", { bubbles: true }));
  });
  assert.match(host.textContent, /Drop the photo to fill the card/);
});

test("field validation uses the upstream card helpers and blocks save", async () => {
  const now = new Date("2026-10-22T00:00:00Z");
  assert.deepEqual(ui.validateVaultCardDraft(validDraft, undefined, now), {});
  assert.equal(ui.isVaultCardDraftValid(validDraft, undefined, now), true);

  const badNumber = ui.validateVaultCardDraft({ ...validDraft, number: "4242 4242 4242 4243" }, undefined, now);
  assert.equal(badNumber.number, "Enter a valid card number");
  assert.equal(ui.isVaultCardDraftValid({ ...validDraft, number: "4242 4242 4242 4243" }, undefined, now), false);

  const badExpiry = ui.validateVaultCardDraft({ ...validDraft, expiry: "13/40" }, undefined, now);
  assert.equal(badExpiry.expiry, "Invalid expiry");

  const expired = ui.validateVaultCardDraft({ ...validDraft, expiry: "01/20" }, undefined, now);
  assert.equal(expired.expiry, "Card has expired");

  const badSecurity = ui.validateVaultCardDraft({ ...validDraft, securityCode: "12" }, undefined, now);
  assert.equal(badSecurity.securityCode, "Invalid security code");

  const amex = { number: "3782 822463 10005", expiry: "12/28", securityCode: "1234", holderName: "Ada Lovelace" };
  assert.equal(ui.cardBrandOf(amex.number), "amex");
  assert.equal(ui.cardBrandOf(validDraft.number), "visa");
  assert.equal(ui.validateVaultCardDraft({ ...amex, securityCode: "123" }, undefined, now).securityCode, "Invalid security code");

  assert.equal(ui.formatCardNumber("378282246310005"), "3782 822463 10005");
  assert.equal(ui.formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
  assert.equal(ui.formatCardExpiry("1228"), "12/28");
  assert.equal(ui.formatCardExpiry("1"), "1");

  let saved = 0;
  await render(dialogProps({
    draft: { ...validDraft, number: "4242 4242 4242 4243" },
    onSave: () => saved++,
  }));
  assert.match(host.textContent, /Enter a valid card number/);
  const save = buttonNamed("Save card");
  assert.ok(save, "the dialog renders a save action");
  assert.equal(save.disabled, true);
  await ui.act(async () => {
    save.click();
  });
  assert.equal(saved, 0);
});

test("a valid draft saves once and the edited values reach the injected callback", async () => {
  let saved = 0;
  const changes = [];
  await render(dialogProps({
    onSave: (result) => {
      assert.equal(result, "saved");
      saved++;
    },
    onChange: (draft) => changes.push(draft),
  }));
  const save = buttonNamed("Save card");
  assert.equal(save.disabled, false);
  await ui.act(async () => {
    save.click();
  });
  assert.equal(saved, 1);

  const number = host.querySelector('input[name="cardNumber"]');
  assert.ok(number, "the editor renders a card number input");
  await ui.act(async () => {
    setNativeValue(number, "5555555555554444");
  });
  assert.equal(changes.length >= 1, true);
  assert.equal(changes.at(-1).number, "5555 5555 5555 4444");

  const values = ui.cardDraftToVaultValues({ ...validDraft });
  assert.equal(values.cc_number, "4242424242424242");
  assert.equal(values.cc_exp, "12/28");
  assert.equal(values.cc_csc, "123");
  assert.equal(values.cc_name, "Ada Lovelace");
});

test("cancel closes the dialog without saving and without cancelling the photo read", async () => {
  let saved = 0;
  let closed = 0;
  let photoCancelled = 0;
  await render(dialogProps({
    onSave: () => saved++,
    onClose: (result) => {
      assert.equal(result, "cancelled");
      closed++;
    },
    onCancelPhoto: () => photoCancelled++,
  }));
  await ui.act(async () => {
    buttonNamed("Cancel").click();
  });
  assert.equal(closed, 1);
  assert.equal(saved, 0);
  assert.equal(photoCancelled, 0);

  await render(dialogProps({
    photo: { status: "reading" },
    onSave: () => saved++,
    onClose: () => closed++,
    onCancelPhoto: () => photoCancelled++,
  }));
  assert.match(host.textContent, /Reading the card/);
  const cancel = host.querySelector(".sand-vault-card-photo-actions button");
  await ui.act(async () => {
    cancel.click();
  });
  assert.equal(photoCancelled, 1);
  assert.equal(closed, 1);
});

test("photo failure states render the upstream message for each backend outcome", async () => {
  const cases = [
    ["not_found", /Try more light/],
    ["rate_limited", /Too many tries/],
    ["unavailable", /Scanning isn't available right now/],
    ["refused", /Card scanning isn't turned on for this account/],
    ["invalid_photo", /Couldn't read the card/],
  ];
  for (const [failure, expected] of cases) {
    await render(dialogProps({ photo: { status: "failed", failure } }));
    assert.match(host.textContent, expected);
  }
  assert.equal(
    ui.photoFailureCopy(ui.DEFAULT_VAULT_CARD_DIALOG_COPY, "refused"),
    "Card scanning isn't turned on for this account",
  );
});

test("every renderer copy string is traceable to an upstream catalog id", async () => {
  const source = await readFile(upstreamIndex, "utf8");
  const ids = { ...ui.UPSTREAM_VAULT_CARD_EDITOR_COPY_IDS, ...ui.UPSTREAM_VAULT_CARD_DIALOG_COPY_IDS };
  const copy = { ...ui.DEFAULT_VAULT_CARD_DIALOG_COPY };
  for (const [key, id] of Object.entries(ids)) {
    const value = copy[key];
    assert.equal(typeof value, "string", `${key} resolves to a string`);
    const needle = `"${id}":["${value}"`;
    assert.equal(source.includes(needle), true, `upstream index carries ${id} for ${key}`);
  }
});

test("the scan prompts render the upstream guidance for each card side", async () => {
  const copy = ui.DEFAULT_VAULT_CARD_DIALOG_COPY;
  assert.equal(ui.scanPromptCopy(copy, "front"), "Hold the front of the card inside the frame");
  assert.equal(ui.scanPromptCopy(copy, "back"), "Hold the back of the card inside the frame");
  assert.equal(ui.scanPromptCopy(copy, "flip-for-name"), "Flip the card for the name");
  assert.equal(ui.scanPromptCopy(copy, "flip-for-security-code"), "Flip the card for the security code");
  assert.equal(ui.scanPromptCopy(copy, undefined), null);

  await render(dialogProps({ photo: { status: "reading", scanPrompt: "front" } }));
  assert.match(host.textContent, /Hold the front of the card inside the frame/);
  await render(dialogProps({ photo: { status: "reading", scanPrompt: "flip-for-name" } }));
  assert.match(host.textContent, /Flip the card for the name/);
});

