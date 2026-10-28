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
  rArSumTranslate,
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
  // Whole-card zh pass anchors (2026-10-25): upstream title map, surface captions,
  // and the summary/reason display points inside me().
  "const ee={host_shell:{title:\"The agent wants to run a command\",subject:\"command\"},box_shell:{title:\"The agent wants to run a command\",subject:\"command\"},mcp:{title:\"The agent wants to use a connected service\",subject:\"details\"},computer:{title:\"Auto-review Paused This Action\",subject:\"details\"},automation_write:{title:\"Auto-review Paused This Action\",subject:\"details\"},cloud_agent:{title:\"Auto-review Paused This Action\",subject:\"details\"},subagent:{title:\"The agent wants to run a task\",subject:\"details\"}},te={title:\"Auto-review Paused This Action\",subject:\"details\"};",
  "function J(t){switch(t){case\"host_shell\":return\"Runs on your local computer\";case\"box_shell\":case\"computer\":return\"Runs on Grok Bot's computer\";case\"mcp\":case\"automation_write\":case\"cloud_agent\":case\"subagent\":return;default:return}}",
  "function le(t){return/^Use .+ tool .+ with /.test(t)}",
  "function mid(){const m=I,v=a.command??a.summary;const d=le(a.summary)?void 0:a.summary;const $=a.reason,B=m.subject;return [m,v,d,$,B]}",
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
  // Whole-card zh (2026-10-25): titles/captions/errors wrap with RArT, display-side
  // summary translation is wired, and the raw matcher stays untouched.
  assert.ok(patched.includes('RArT("The agent wants to use a connected service","Bot 想要使用连接服务")'));
  assert.ok(patched.includes('RArT("The agent wants to run a command","Bot 想要运行一条命令")'));
  assert.ok(patched.includes('RArT("The agent wants to run a task","Bot 想要运行一个任务")'));
  assert.ok(patched.includes('RArT("Auto-review Paused This Action","自动审核已暂停此操作")'));
  assert.ok(patched.includes('RArT("Runs on your local computer","在你的电脑上运行")'));
  assert.ok(patched.includes('RArT("Runs on Grok Bot\'s computer","在 Grok Bot 的电脑上运行")'));
  assert.ok(!patched.includes('title:"The agent wants'));
  assert.ok(!patched.includes('title:"Auto-review Paused'));
  assert.ok(patched.includes('RArT("No reusable rule is available. Choose Allow once or retry the command for a new review.","没有可复用的规则。请选择“允许一次”，或重试命令以重新审核。")'));
  assert.ok(patched.includes('RArT("Could not load Auto-review settings. Retry or choose Allow once.","无法加载自动审核设置。请重试或选择“允许一次”。")'));
  assert.ok(!patched.includes('new Error("No reusable rule'));
  assert.ok(patched.includes("v=a.command??RArSum(a.summary);"));
  assert.ok(patched.includes("le(a.summary)?void 0:RArSum(a.summary)"));
  assert.ok(patched.includes("const $=RArReason(a.reason),B=m.subject;"));
  assert.ok(patched.includes("function RArSum("));
  assert.ok(patched.includes("function RArReason("));
  assert.ok(patched.includes('"Local Auto-review requires your confirmation.":"自动审核需要你的确认。"'));
  assert.ok(patched.includes("function le(t){return/^Use .+ tool .+ with /.test(t)}"));
  assert.ok(patched.includes('window.desktop&&window.desktop.language'), "RArLocale must read the app language preference");
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

test("0.77 分词器：点串不再成词、尾句点不标插入（chunk-sand-rule-text-diff 增量）", async t => {
  const officialChunk = path.resolve(import.meta.dirname, "../../rea-grokbot-0770/app/dist/renderer/assets/chunk-sand-rule-text-diff-DZH51_ck.js");
  const official = await readFile(officialChunk, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (official == null) return t.skip("0.77.0 extract unavailable");
  const officialRe = '/[^\\s,.]+(?:\\.[^\\s,.]+)*/g';
  assert.ok(official.includes(`RArTokenRe=${officialRe}`) || official.includes(officialRe), "official tokenizer regex is as recorded");
  const patchSource = await readFile(path.resolve(import.meta.dirname, "../scripts/lib/auto-review-renderer-patch.mjs"), "utf8");
  assert.ok(patchSource.includes('"const RArTokenRe=/[^\\\\s,.]+(?:\\\\.[^\\\\s,.]+)*/g;"'), "emitted tokenizer regex matches the official 0.77 chunk");
  // 判别性用例：尾句点。旧正则把 "example.com." 整体当 token，与 before 的
  // "example.com" 不匹配 → 整段标插入；新正则句点不是 token，所有 after token
  // 都能与 before 对上 → 什么都不标，句点落在未插入尾段。
  const trailing = rArDiffSegments("trust example.com", "trust example.com.");
  const inserted = trailing.filter((s) => s.isInserted).map((s) => s.text).join("");
  assert.equal(inserted, "", "nothing is marked inserted once the trailing period stops tokenizing");
  assert.ok(trailing.some((s) => !s.isInserted && s.text.endsWith(".")), "the period lands in an unmarked tail segment");
  // 点分域名在两种正则下都保整（对齐性记录，非判别用例）
  const domain = rArDiffSegments("trust example.com", "trust example.com always");
  assert.ok(domain.some((s) => !s.isInserted && s.text.includes("example.com")), "dotted domain stays a matched token");
  const domainInserted = domain.filter((s) => s.isInserted).map((s) => s.text).join("");
  assert.equal(domainInserted, "always", "only the tail insertion is marked");
});

test("rArSumTranslate covers the host summary shapes without touching commands", () => {
  assert.equal(
    rArSumTranslate('Use Google Calendar:google-calendar tool list_events with {"startTime":"x"}'),
    '使用 Google Calendar:google-calendar 的 list_events 工具，参数：{"startTime":"x"}',
  );
  assert.equal(
    rArSumTranslate("Use a connected service tool action with {\"a\":1}"),
    '使用 连接服务 的 action 工具，参数：{"a":1}',
  );
  assert.equal(rArSumTranslate("Use a connected service"), "使用连接服务");
  assert.equal(rArSumTranslate("Use Gmail to send email"), "使用 Gmail：send email");
  assert.equal(rArSumTranslate("Use GitHub"), "使用 GitHub");
  assert.equal(
    rArSumTranslate("Local Auto-review requires your confirmation."),
    "自动审核需要你的确认。",
  );
  assert.equal(
    rArSumTranslate("Run a command on your local computer"),
    "在你的电脑上运行命令",
  );
  assert.equal(rArSumTranslate("ls -la /tmp"), "ls -la /tmp");
  assert.equal(rArSumTranslate("Use calendars"), "使用 calendars");
});

test("rArSumTranslate localizes the Q() truncation marker", () => {
  const out = rArSumTranslate("Use GitHub tool list_repos with aaa...[12 chars omitted]...");
  assert.ok(out.includes("工具，参数：aaa...[已省略 12 字符]..."));
  assert.ok(!out.includes("chars omitted"));
});

test("mutation: dropping the summary display wrap is detected", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  const mutated = patched.replace("v=a.command??RArSum(a.summary);", "v=a.command??a.summary;");
  assert.notEqual(mutated, patched);
  assert.throws(() => {
    assert.ok(mutated.includes("v=a.command??RArSum(a.summary);"), "summary display must translate via RArSum");
  }, /summary display must translate/);
});

test("mutation: translating the le() matcher breaks the shape guard", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  // The matcher must keep comparing the raw host English summary — simulate the
  // regression of pointing it at translated text.
  const mutated = patched.replace(
    "function le(t){return/^Use .+ tool .+ with /.test(t)}",
    'function le(t){return/^使用 .+ 的 .+ 工具/.test(t)}',
  );
  assert.notEqual(mutated, patched);
  assert.ok(mutated.includes("^使用"), "mutation applied");
  assert.ok(patched.includes("function le(t){return/^Use .+ tool .+ with /.test(t)}"), "real matcher must stay English");
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
  `packaged approval card renders fully localized with raw matchers intact (${found?.name ?? "bundle missing"})`,
  { skip: bundleSkip },
  () => {
    const patched = patchOriginalAutoReviewApproval(source);
    // Titles + captions wrapped; raw upstream title literals gone.
    assert.ok(patched.includes("Bot 想要使用连接服务"));
    assert.ok(patched.includes("Bot 想要运行一条命令"));
    assert.ok(patched.includes("自动审核已暂停此操作"));
    assert.ok(patched.includes("在你的电脑上运行"));
    assert.ok(!patched.includes('title:"The agent wants'));
    // Display-side summary/reason translation wired exactly once.
    assert.equal(patched.split("RArSum(a.summary)").length - 1, 2);
    assert.equal(patched.split("RArReason(a.reason)").length - 1, 1);
    // Matchers still compare raw host English.
    assert.ok(patched.includes("function le(t){return/^Use .+ tool .+ with /.test(t)}"));
    assert.ok(patched.includes('t==="Run a command on your local computer"'));
    assert.ok(patched.includes('function ue(t,e){return}'));
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
