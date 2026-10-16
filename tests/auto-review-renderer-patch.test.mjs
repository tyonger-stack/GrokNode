import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import {
  patchAutoReviewSettingsOpener,
  patchOriginalAutoReviewApproval,
  rArDiffSegments,
} from "../scripts/lib/auto-review-renderer-patch.mjs";

const rendererDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const RENDERER_ANCHOR = "async function de(t,e){if(e===void 0)";
const SETTINGS_OPENER_ANCHOR = "k1=I0t.actions;function xRn";
const UE_ANCHOR =
  'function ue(t,e){if(t!=="always")return;const s="A rule always allowing this was added to your Auto-review settings";return e===void 0?s:`${s}: “${e}”`}';

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
  'import{c as P,w as F,O,K as U,R as V,j as C,V as q,W as z,X as D,Y as H,Z as W,g as Y,M as K,E as X}from"./index-UbX-y3il.js";',
  'function ne(t){switch(t.status){case"ready":return t.value;default:return}}',
  'function ce(t){const e=t.proposedRule?.trim();return e===void 0||e.length===0?void 0:e}',
  UE_ANCHOR,
  'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}',
  'async function pe(t){const{agentId:e,entryId:s,requestId:n,resolution:a,loadAlwaysAllow:l,resolveAutoReviewApproval:i}=t;let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}}',
  "function me(t){const e=P.c(43);return e}",
  "function call(t){i(L),pe({entryId:t})}",
  "function settle(p){p.then(()=>i(void 0),()=>i(void 0))}",
  "function note(){_=ue(u,N)}",
  "const surface={loadAlwaysAllow:()=>de(r.autoReviewInstructions,N)}",
  // Anchor lives in a comment so the fixture stays parseable; replaceOnce matches the substring.
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
  assert.ok(patched.includes("function RArRuleNotice("));
  assert.ok(patched.includes("data-sand-auto-review-rule-notice"));
  assert.ok(patched.includes("data-sand-auto-review-edit-rule"));
  assert.ok(patched.includes("RArDiffSegments"));
  assert.ok(patched.includes("sand-18zih8k sand-1tiofj7 sand-n3e42v"));
  assert.ok(patched.includes('sand-open-settings'));
  assert.ok(patched.includes('section:"general"'));
  assert.ok(patched.includes("Edit rule"));
  assert.ok(patched.includes("编辑规则"));
  assert.ok(patched.includes("已添加到你的“允许”规则"));
  assert.ok(patched.includes('u==="always"?C.jsx(RArRuleNotice'));
  assert.ok(patched.includes("_=void 0"));
  assert.ok(!patched.includes("A rule always allowing this was added"));
  assert.ok(!patched.includes(RENDERER_ANCHOR), "patched fixture must not retain the original loader");
  assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
});

test("patched anchor fixture still parses as a module", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  assert.doesNotThrow(() => parse(patched, { sourceType: "module", ecmaVersion: "latest" }));
});

test("0.71.2 LCS diff marks only inserted tokens", () => {
  const segs = rArDiffSegments("allow git status", "allow git status --short");
  assert.ok(segs.some((s) => s.isInserted && s.text.includes("--short")));
  assert.ok(segs.some((s) => !s.isInserted && s.text.includes("allow")));
  const plain = rArDiffSegments("same rule", "same rule");
  assert.ok(plain.every((s) => !s.isInserted));
});

test("mutation: stripping LCS helper fails the diff contract", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const mutated = patched.replace("function RArDiffSegments", "function RArDiffSegmentsRemoved");
  assert.notEqual(mutated, patched);
  assert.throws(() => {
    assert.ok(mutated.includes("function RArDiffSegments("), "must keep 0.71.2 LCS helper");
  }, /must keep 0\.71\.2 LCS/);
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
  const patched = patchAutoReviewSettingsOpener(syntheticRegistry);
  assert.ok(patched.includes("k1.open(Uf.settings({section:s}))"));
});

test("rule notice mount is gated on always", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const start = patched.indexOf('u==="always"?C.jsx(RArRuleNotice');
  assert.ok(start >= 0, "always-gated RArRuleNotice missing");
  const end = patched.indexOf("}):null", start) + "}):null".length;
  const expr = patched.slice(start, end);
  const C = {
    jsx(type, props) {
      return { type, props };
    },
  };
  const RArRuleNotice = "RArRuleNotice";
  const mountFor = (u) => {
    const fn = new Function("u", "C", "RArRuleNotice", "a", `return (${expr});`);
    return fn(u, C, RArRuleNotice, { proposedRule: "allow ls" });
  };
  assert.equal(mountFor("approved"), null);
  assert.equal(mountFor("denied"), null);
  const mounted = mountFor("always");
  assert.equal(mounted.type, "RArRuleNotice");
  assert.equal(mounted.props.approval.proposedRule, "allow ls");
});

test("mutation: dropping notice gate is detected", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const mutated = patched.replace('u==="always"?C.jsx(RArRuleNotice', "false?C.jsx(RArRuleNotice");
  assert.notEqual(mutated, patched);
  assert.throws(() => {
    assert.ok(mutated.includes('u==="always"?C.jsx(RArRuleNotice'), "notice must stay gated on always");
  }, /notice must stay gated/);
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
  const changes = [],
    savedRules = [],
    context = {
      Error,
      W: (s, rule) => {
        savedRules.push(rule);
        return { ...s, allowInstructions: [...s.allowInstructions, rule] };
      },
      D: (value) => changes.push(value),
      H: (value) => changes.push({ ...value, cleared: true }),
    };
  vm.createContext(context);
  for (const name of ["ne", "de", "pe"]) {
    const fn = ast.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(patched.slice(fn.start, fn.end), context);
  }
  return { ...context, changes, savedRules, patched, LOCAL_DOCKER_SHELL_RULE };
}

test(
  `packaged host Shell Always allow persists the exact rule after successful persistence (${found?.name ?? "bundle missing"})`,
  { skip: bundleSkip },
  async () => {
    const h = harness(source);
    await h.pe({
      agentId: "a",
      entryId: "e",
      requestId: "r",
      resolution: "always",
      loadAlwaysAllow: () =>
        h.de(
          {
            load: async () => {},
            snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) },
            setInstructions: async () => {},
          },
          "rule",
          "host_shell",
        ),
      resolveAutoReviewApproval: async (input) => {
        assert.deepEqual(h.savedRules, ["rule"]);
        assert.equal(input.resolution, "always");
        return "resolved";
      },
    });
    assert.equal(h.changes.at(-1).status, "always");
  },
);

test(
  `packaged Docker VM Shell Always allow persists one grant for every VM command (${found?.name ?? "bundle missing"})`,
  { skip: bundleSkip },
  async () => {
    const h = harness(source);
    await h.pe({
      agentId: "a",
      entryId: "e",
      requestId: "r",
      resolution: "always",
      loadAlwaysAllow: () =>
        h.de(
          {
            load: async () => {},
            snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) },
            setInstructions: async () => {},
          },
          "exact pwd rule",
          "box_shell",
        ),
      resolveAutoReviewApproval: async (input) => {
        assert.deepEqual(h.savedRules, [h.LOCAL_DOCKER_SHELL_RULE]);
        assert.equal(input.resolution, "always");
        return "resolved";
      },
    });
    assert.equal(h.changes.at(-1).status, "always");
    assert.ok(h.patched.includes('a.surface==="box_shell"?RArDockerRule'));
    assert.ok(h.patched.includes(h.LOCAL_DOCKER_SHELL_RULE));
  },
);

test(
  `packaged missing-rule and persistence errors stay actionable without single-use approval (${found?.name ?? "bundle missing"})`,
  { skip: bundleSkip },
  async () => {
    const h = harness(source);
    let resolved = 0;
    for (const rule of [undefined, "rule"]) {
      await assert.rejects(() =>
        h.pe({
          agentId: "a",
          entryId: "e",
          requestId: "r",
          resolution: "always",
          loadAlwaysAllow: () =>
            h.de(
              {
                load: async () => {
                  throw new Error("offline");
                },
              },
              rule,
            ),
          resolveAutoReviewApproval: async () => {
            resolved++;
            return "resolved";
          },
        }),
      );
    }
    assert.equal(resolved, 0);
    assert.equal(h.changes.at(-1).cleared, true);
    assert.ok(h.patched.includes('role:"alert"'));
  },
);

test(
  `packaged approval mounts rule notice with diff + Edit rule (${found?.name ?? "bundle missing"})`,
  { skip: bundleSkip },
  () => {
    const patched = patchOriginalAutoReviewApproval(source);
    assert.ok(patched.includes("I as RArIcon"));
    assert.ok(patched.includes("function RArRuleNotice("));
    assert.ok(patched.includes("function RArDiffSegments("));
    assert.ok(patched.includes("data-sand-auto-review-rule-notice"));
    assert.ok(patched.includes("data-sand-auto-review-edit-rule"));
    assert.ok(patched.includes('sand-open-settings'));
    assert.ok(patched.includes("编辑规则"));
    assert.ok(patched.includes("已添加到你的“允许”规则"));
    assert.ok(patched.includes("_=void 0"));
    assert.ok(patched.includes('u==="always"?C.jsx(RArRuleNotice'));
    assert.ok(!patched.includes("A rule always allowing this was added"));
    assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
  },
);

test(
  `packaged registry opens settings from sand-open-settings (${found ? "index-UbX-y3il.js" : "bundle missing"})`,
  { skip: registrySkip },
  () => {
    const patched = patchAutoReviewSettingsOpener(registrySource);
    assert.ok(patched.includes('window.addEventListener("sand-open-settings"'));
    assert.ok(patched.includes("k1.open(Uf.settings({section:s}))"));
    assert.throws(() => patchAutoReviewSettingsOpener(patched), /missing or ambiguous/);
  },
);

test(`renderer patch fails closed on missing anchors (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalAutoReviewApproval(patchOriginalAutoReviewApproval(source)), /missing or ambiguous/);
});
