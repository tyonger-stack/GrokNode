import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

async function load() {
  const output = path.join(root, "node_modules/.cache/vault-card-form.cjs");
  await build({
    stdin: {
      contents: [
        'export * as userForms from "./source/shared/user-forms.ts";',
        'export { UserFormService } from "./source/host/extensions/session/user-form-service.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "error",
  });
  return createRequire(import.meta.url)(output);
}

const cardForm = {
  title: "Card for checkout",
  instruction: "Enter the card to save.",
  reason: "checkout",
  saveToVault: "card",
  vaultKind: "card",
  fields: [
    { id: "cc_number", label: "Card number", type: "text", required: true, secret: true },
    { id: "cc_exp", label: "Expiry (MM/YY)", type: "text", required: true },
    { id: "cc_csc", label: "Security code", type: "text", secret: true },
    { id: "cc_name", label: "Name on card", type: "text" },
  ],
};

test("vault card schema: whitelisted chat-filled card form passes; contract violations fail", async () => {
  const { userForms } = await load();
  const parsed = userForms.requestUserFormParameters.parse(cardForm);
  assert.equal(parsed.saveToVault, "card");
  // Missing cc_number / cc_exp (official required set `jt`).
  assert.throws(() => userForms.requestUserFormParameters.parse({
    ...cardForm, fields: cardForm.fields.filter((field) => field.id !== "cc_number"),
  }), /cc_number and cc_exp/);
  // Non-whitelisted id (official whitelist `At`).
  assert.throws(() => userForms.requestUserFormParameters.parse({
    ...cardForm, fields: [...cardForm.fields, { id: "ssn", label: "SSN", type: "text" }],
  }), /not a vault card field/);
  // Browser targets are refused: vault card forms are chat-filled.
  assert.throws(() => userForms.requestUserFormParameters.parse({
    ...cardForm, fields: cardForm.fields.map((field) => ({ ...field, target: { kind: "selector", value: "#cc" } })),
  }), /chat card, not on a page/);
  // A plain (non-vault) form with a targeted secret keeps working — the legacy path is untouched.
  assert.doesNotThrow(() => userForms.requestUserFormParameters.parse({
    title: "Sign in", instruction: "Fill the sign-in page.", reason: "auth",
    domain: "example.com",
    fields: [{ id: "password", label: "Password", type: "password", required: true, secret: true, target: { kind: "selector", value: "#password" } }],
  }));
});

test("vault card submission short-circuits browser fill and returns outcomes without values", async () => {
  const { UserFormService } = await load();
  let fillCalls = 0;
  const receipts = [];
  const service = new UserFormService({
    emitForm: async (agentId, message) => {
      assert.equal(message.type, "user-form");
      assert.equal(message.form.saveToVault, "card");
      return "entry-1";
    },
    privateFill: () => { fillCalls += 1; return Promise.resolve({ fields: [] }); },
    onReceipt: async (agentId, receipt) => { receipts.push(receipt); },
  });
  const shown = await service.request("agent-1", "turn-1", cardForm);
  assert.equal(shown.status, "shown");
  // Raw card values ride the submit hop for validation and are discarded host-side;
  // the receipt projects outcomes + secureValueStorage only.
  const receipt = await service.submit({ agentId: "agent-1", requestId: shown.requestId, values: { cc_number: "4242424242424242", cc_exp: "12/29", cc_csc: "123", cc_name: "Synthetic Person" } });
  assert.equal(receipt.status, "submitted");
  assert.equal(fillCalls, 0, "vault card forms never touch the browser filler");
  assert.deepEqual(receipt.fields?.map((field) => ({ id: field.id, status: field.status, storage: field.secureValueStorage })), [
    { id: "cc_number", status: "filled", storage: "stored" },
    { id: "cc_exp", status: "filled", storage: "stored" },
    { id: "cc_csc", status: "filled", storage: "stored" },
    { id: "cc_name", status: "filled", storage: "stored" },
  ]);
  assert.equal(JSON.stringify(receipt).includes("4242424242424242"), false, "card number never reaches the model receipt");
  assert.equal(JSON.stringify(receipts.at(-1)).includes("4242424242424242"), false, "wake receipt carries no values either");
});

test("legacy browser-fill forms keep their fill path", async () => {
  const { UserFormService } = await load();
  let fillCalls = 0;
  const service = new UserFormService({
    emitForm: async () => "entry-1",
    privateFill: (input) => {
      if (input.probeOnly !== true) fillCalls += 1;
      return Promise.resolve({ fields: input.entries.map((entry) => ({ id: entry.field.id, status: "filled" })), submit: input.probeOnly === true ? undefined : { attempted: true, succeeded: true } });
    },
  });
  const shown = await service.request("agent-1", "turn-1", {
    title: "Sign in", instruction: "Fill the sign-in page.", reason: "auth",
    domain: "example.com",
    fields: [{ id: "password", label: "Password", type: "password", required: true, secret: true, target: { kind: "selector", value: "#password" } }],
  });
  assert.equal(shown.status, "shown");
  const receipt = await service.submit({ agentId: "agent-1", requestId: shown.requestId, values: { password: "synthetic" } });
  assert.equal(fillCalls, 1, "legacy forms browser-fill exactly once (the probe is not a fill)");
  assert.equal(receipt.status, "submitted");
  assert.equal(receipt.fields?.[0]?.secureValueStorage, undefined, "legacy receipts carry no vault marker");
});
