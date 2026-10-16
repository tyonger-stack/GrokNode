import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import {
  patchAutoReviewSettingsOpener,
  patchOriginalAutoReviewApproval,
} from "../scripts/lib/auto-review-renderer-patch.mjs";

const rendererDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const RENDERER_ANCHOR = "async function de(t,e){if(e===void 0)";
const SETTINGS_OPENER_ANCHOR = "k1=I0t.actions;function xRn";

async function findRendererSource() {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    return null;
  }
  const candidates = entries.filter((name) => name.startsWith("view-") && name.endsWith(".js")).sort();
  for (const name of candidates) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    if (text.includes(RENDERER_ANCHOR)) return { name, text };
  }
  return null;
}

async function findRegistrySource() {
  try {
    const text = await readFile(path.join(rendererDir, "index-UbX-y3il.js"), "utf8");
    if (text.includes(SETTINGS_OPENER_ANCHOR)) return text;
  } catch {
    return null;
  }
  return null;
}

const found = await findRendererSource();
const source = found?.text ?? null;
const registrySource = await findRegistrySource();
const bundleSkip = found
  ? false
  : "src/app/dist is gitignored and only exists after `npm run bootstrap` (macOS DMG mount); bundle assertions skipped.";
const registrySkip = registrySource
  ? false
  : "src/app/dist registry chunk missing; settings-opener assertions skipped.";

const syntheticSource = [
  'function ne(t){switch(t.status){case"ready":return t.value;default:return}}',
  'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}',
  'async function pe(t){const{agentId:e,entryId:s,requestId:n,resolution:a,loadAlwaysAllow:l,resolveAutoReviewApproval:i}=t;let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}}',
  "function me(t){const e=P.c(43);return e}",
  "function call(t){i(L),pe({entryId:t})}",
  "function settle(p){p.then(()=>i(void 0),()=>i(void 0))}",
  "function note(){_=ue(u,N)}",
  "const surface={loadAlwaysAllow:()=>de(r.autoReviewInstructions,N)}",
  "// :j=e[42],j}function we(t)",
  "function we(t){return t}",
].join("\n");

const syntheticRegistry = 'const I0t={actions:{open(){}}},Uf={settings:(n)=>({kind:"settings",...n})};k1=I0t.actions;function xRn(){return 1}';

test("renderer patch applies to the anchor fixture and stays fail-closed", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  assert.ok(patched.includes("Always allow all Shell commands on this local Docker VM."));
  assert.ok(patched.includes("No reusable rule is available."));
  assert.ok(patched.includes('a.surface==="box_shell"'));
  assert.ok(patched.includes('role:"alert"'));
  assert.ok(patched.includes("setArError"));
  assert.ok(patched.includes("throw error"));
  assert.ok(patched.includes("data-sand-auto-review-edit-rule"));
  assert.ok(patched.includes('sand-open-settings'));
  assert.ok(patched.includes('section:"general"'));
  assert.ok(patched.includes("Edit rule"));
  assert.ok(patched.includes("编辑规则"));
  assert.ok(patched.includes('u==="always"'));
  assert.ok(!patched.includes(RENDERER_ANCHOR), "patched fixture must not retain the original loader");
  assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
});

test("patched anchor fixture still parses as a module", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  assert.doesNotThrow(() => parse(patched, { sourceType: "module", ecmaVersion: "latest" }));
});

test("settings opener patch wires sand-open-settings to Uf.settings({section})", () => {
  const patched = patchAutoReviewSettingsOpener(syntheticRegistry);
  assert.ok(patched.includes('window.addEventListener("sand-open-settings"'));
  assert.ok(patched.includes("k1.open(Uf.settings({section:s}))"));
  assert.throws(() => patchAutoReviewSettingsOpener(patched), /missing or ambiguous/);
  assert.doesNotThrow(() => parse(patched, { sourceType: "module", ecmaVersion: "latest" }));
});

test("settings opener event opens general by default and honors section detail", () => {
  const opened = [];
  let listener = null;
  const k1 = {
    open(target) {
      opened.push(target);
    },
  };
  const Uf = {
    settings(n) {
      return { entrypoint: "settings", ...n };
    },
  };
  const window = {
    addEventListener(type, fn) {
      listener = { type, fn };
    },
  };
  // Mirror the injected listener body from SETTINGS_OPENER_AFTER.
  window.addEventListener("sand-open-settings", function (ev) {
    try {
      const s =
        ev && ev.detail && typeof ev.detail.section === "string" && ev.detail.section.length > 0
          ? ev.detail.section
          : "general";
      k1.open(Uf.settings({ section: s }));
    } catch {
      /* ignore */
    }
  });
  assert.equal(listener.type, "sand-open-settings");
  listener.fn({ detail: {} });
  listener.fn({ detail: { section: "usage" } });
  assert.deepEqual(opened, [
    { entrypoint: "settings", section: "general" },
    { entrypoint: "settings", section: "usage" },
  ]);
  // Patched source must still carry the same open call shape.
  const patched = patchAutoReviewSettingsOpener(syntheticRegistry);
  assert.ok(patched.includes("k1.open(Uf.settings({section:s}))"));
});

test("Edit rule button is gated on always and dispatches sand-open-settings", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const start = patched.indexOf('u==="always"?C.jsx("button"');
  assert.ok(start >= 0, "always-gated Edit rule button missing");
  const end = patched.indexOf("}):null", start) + "}):null".length;
  const expr = patched.slice(start, end);
  const events = [];
  const C = {
    jsx(_type, props) {
      return props;
    },
  };
  const buttonFor = (u) => {
    const fn = new Function(
      "u",
      "C",
      "RLocT",
      "window",
      `return (${expr});`,
    );
    return fn(u, C, (en) => en, {
      dispatchEvent(ev) {
        events.push(ev);
      },
    });
  };
  assert.equal(buttonFor("approved"), null);
  assert.equal(buttonFor("denied"), null);
  const btn = buttonFor("always");
  assert.equal(btn.type, "button");
  assert.equal(btn["data-sand-auto-review-edit-rule"], true);
  assert.equal(btn["aria-label"], "Edit rule");
  assert.equal(btn.children, "Edit rule");
  btn.onClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sand-open-settings");
  assert.equal(events[0].detail.section, "general");
});

test("mutation: dropping Edit rule gate is detected by the always-path assertion", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const mutated = patched.replace('u==="always"?C.jsx("button"', 'false?C.jsx("button"');
  assert.notEqual(mutated, patched);
  assert.throws(() => {
    assert.ok(mutated.includes('u==="always"?C.jsx("button"'), "Edit rule must stay gated on always");
  }, /Edit rule must stay gated/);
});

test("mutation: settings opener without k1.open is detected", () => {
  const patched = patchAutoReviewSettingsOpener(syntheticRegistry);
  const broken = patched.replace("k1.open(Uf.settings({section:s}))", "/*no-op*/");
  assert.notEqual(broken, patched);
  assert.throws(() => {
    assert.ok(broken.includes("k1.open(Uf.settings({section:s}))"), "opener must call k1.open");
  }, /opener must call k1\.open/);
});

test("mutation: removing Edit rule label fails the official zh assertion", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const mutated = patched.replaceAll("编辑规则", "EDIT_RULE_ZH_REMOVED");
  assert.notEqual(mutated, patched);
  assert.throws(() => {
    assert.ok(mutated.includes("编辑规则"), "must keep official 0.71 zh for 0doodQ");
  }, /must keep official/);
});

function harness(bundleText) {
  const patched = patchOriginalAutoReviewApproval(bundleText);
  const ast = parse(patched, { sourceType: "module", ecmaVersion: "latest" });
  const LOCAL_DOCKER_SHELL_RULE = "Always allow all Shell commands on this local Docker VM.";
  const changes = [], savedRules = [], context = { Error, W: (s, rule) => { savedRules.push(rule); return { ...s, allowInstructions: [...s.allowInstructions, rule] }; }, D: value => changes.push(value), H: value => changes.push({ ...value, cleared: true }) };
  vm.createContext(context);
  for (const name of ["ne", "de", "pe"]) {
    const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(patched.slice(fn.start, fn.end), context);
  }
  return { ...context, changes, savedRules, patched, LOCAL_DOCKER_SHELL_RULE };
}

test(`packaged host Shell Always allow persists the exact rule after successful persistence (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source);
  await h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) }, setInstructions: async () => {} }, "rule", "host_shell"), resolveAutoReviewApproval: async input => {
    assert.deepEqual(h.savedRules, ["rule"]);
    assert.equal(input.resolution, "always");
    return "resolved";
  } });
  assert.equal(h.changes.at(-1).status, "always");
});

test(`packaged Docker VM Shell Always allow persists one grant for every VM command (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source);
  await h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) }, setInstructions: async () => {} }, "exact pwd rule", "box_shell"), resolveAutoReviewApproval: async input => {
    assert.deepEqual(h.savedRules, [h.LOCAL_DOCKER_SHELL_RULE]);
    assert.equal(input.resolution, "always");
    return "resolved";
  } });
  assert.equal(h.changes.at(-1).status, "always");
  assert.ok(h.patched.includes(`a.surface==="box_shell"?"${h.LOCAL_DOCKER_SHELL_RULE}":N`));
});

test(`packaged missing-rule and persistence errors stay actionable without single-use approval (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source); let resolved = 0;
  for (const rule of [undefined, "rule"]) {
    await assert.rejects(() => h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => { throw new Error("offline"); } }, rule), resolveAutoReviewApproval: async () => { resolved++; return "resolved"; } }));
  }
  assert.equal(resolved, 0);
  assert.equal(h.changes.at(-1).cleared, true);
  assert.ok(h.patched.includes('role:"alert"'));
});

test(`packaged approval includes Edit rule on always path (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, () => {
  const patched = patchOriginalAutoReviewApproval(source);
  assert.ok(patched.includes("data-sand-auto-review-edit-rule"));
  assert.ok(patched.includes('sand-open-settings'));
  assert.ok(patched.includes("编辑规则"));
  assert.ok(patched.includes('u==="always"?C.jsx("button"'));
  assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
});

test(`packaged registry opens settings from sand-open-settings (${found ? "index-UbX-y3il.js" : "bundle missing"})`, { skip: registrySkip }, () => {
  const patched = patchAutoReviewSettingsOpener(registrySource);
  assert.ok(patched.includes('window.addEventListener("sand-open-settings"'));
  assert.ok(patched.includes("k1.open(Uf.settings({section:s}))"));
  assert.throws(() => patchAutoReviewSettingsOpener(patched), /missing or ambiguous/);
});

test(`renderer patch fails closed on missing anchors (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalAutoReviewApproval(patchOriginalAutoReviewApproval(source)), /missing or ambiguous/);
});
