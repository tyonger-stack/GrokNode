import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyOriginalRendererMainI18n,
  patchOriginalMainI18n,
  MAIN_I18N_PAIRS,
  MAIN_I18N_061_PAIRS,
  MAIN_I18N_LOCAL_PAIRS,
  MAIN_I18N_LOCAL_ANCHORED,
  MAIN_I18N_GAPS,
} from "../scripts/lib/main-i18n-patch.mjs";

const NL = String.fromCharCode(10);

// Synthetic main-shell slice. Every pair EN literal is embedded once as a
// title attribute so the test proves each row applies; extra lines pin the
// mode restrictions (logic positions must stay raw).
function baseSource() {
  const rows = MAIN_I18N_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})");
  rows.push(...MAIN_I18N_061_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})"));
  rows.push(...MAIN_I18N_LOCAL_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})"));
  rows.unshift("const anchor=sand.navigateBack;");
  rows.push("y=s?" + JSON.stringify("Cancel") + ":z;");
  rows.push("d={46:" + JSON.stringify("Delete") + "};");
  rows.push("function XGn(n){switch(n){case\"never\":return\"Never allow\";case\"always\":return\"Always allow\";case\"ask\":return\"Ask every time\"}}");
  rows.push("e=n.isEnabled?n.runs[0]?.status===\"running\"?{detail:n.triggerDescription,iconName:\"loading\",iconStyle:Moe.runningIcon}:{detail:n.triggerDescription,iconName:\"clock\",iconStyle:Moe.enabledIcon}:{detail:\"Paused\",iconName:\"pause-circle\",iconStyle:Moe.pausedIcon}}");
  rows.push("function _3n(n){switch(n){case\"subagent\":return\"Subagent\";case\"shell\":return\"Shell\";case\"cloud-agent\":return\"Cloud agent\"}}");
  rows.push(...MAIN_I18N_LOCAL_ANCHORED.map((entry) => entry.anchor));
  return rows.join(NL);
}

test("main-i18n patch appends prelude and branches every pair literal", async () => {
  const { patched, applied, catalogApplied, localApplied, anchored } = patchOriginalMainI18n(baseSource());
  assert.equal(applied.length, MAIN_I18N_PAIRS.length);
  for (const row of applied) assert.ok(row.hits >= 1, "pair must hit at least once: " + row.en);
  assert.equal(catalogApplied.length, MAIN_I18N_061_PAIRS.length);
  for (const row of catalogApplied) assert.ok(row.hits >= 1, "0.61.0 catalog pair must hit: " + row.en);
  assert.equal(localApplied.length, MAIN_I18N_LOCAL_PAIRS.length);
  for (const row of localApplied) assert.ok(row.hits >= 1, "0.18-only pair must hit: " + row.en);
  assert.ok(patched.includes('(RLocT("Create Routine","创建例行任务"))'));
  assert.equal(anchored.length, 3 + MAIN_I18N_LOCAL_ANCHORED.length, "all whole-block anchors must apply");
  assert.ok(patched.includes("从不允许"), "XGn never-arm must branch to wvd4WD wording");
  assert.ok(patched.includes("每次询问"), "XGn ask-arm must branch to 6CTZeX wording");
  assert.ok(!patched.includes('return"Never allow"'), "raw XGn never-arm must be gone");
  assert.ok(patched.includes("云端智能体"), "cloud-agent arm must branch to 006KCk wording");
  assert.ok(patched.includes("回复你的消息") || patched.includes("RLocMessageTarget(e)"), "dynamic reply label must be localized");
  assert.ok(patched.includes('name:n.id===uc?RLocT("Unassigned","未分组")'), "section display name must branch without changing the stored name");
  assert.ok(patched.includes('RLocDateLocale=RLocBoot()==="zh-CN"'), "date formatting must follow the selected locale");
  assert.ok(!patched.includes('return"Cloud agent"'), "raw cloud-agent arm must be gone");
  assert.ok(patched.includes("function RLocFromPref("), "locale resolver must be appended");
  assert.ok(patched.includes("function RLocT("), "branch helper must be appended");
  assert.ok(patched.includes("location.reload"), "language flip must reload the renderer");
  assert.ok(patched.includes("sand.navigateBack"), "discovery anchor must survive");
  assert.ok(patched.includes('(RLocT("General","通用"))'), "General must branch to 0.59.1 wording");
  const prelude = patched.slice(patched.indexOf("function RLocFromPref("));
  assert.ok(!prelude.includes("(RLocT("), "prelude itself must not contain branch calls");
});

test("main-i18n patch restricts risky pairs to display positions", async () => {
  const { patched } = patchOriginalMainI18n(baseSource());
  assert.ok(patched.includes('y=s?"Cancel":z;'), "PROP-only Cancel must leave ternary branches raw");
  assert.ok(!patched.includes('y=s?(RLocT("Cancel",'), "PROP-only Cancel must not branch ternaries");
  assert.ok(patched.includes('d={46:"Delete"};'), "digit-key map values must stay raw");
});

test("dynamic reply and message-action labels switch between English and Chinese", () => {
  const replySource = MAIN_I18N_LOCAL_ANCHORED.find((entry) => entry.id === "local-reply-action").replacement;
  const actionsSource = MAIN_I18N_LOCAL_ANCHORED.find((entry) => entry.id === "ytzCVg/lKwbtc").replacement;
  let locale = "zh-CN";
  const localize = (en, zh) => locale === "zh-CN" ? zh : en;
  const reply = new Function("RLocT", "Wht", replySource + ";return rCn;")(localize, (message) => message.owner);
  const actions = new Function("RLocT", "Wht", "Lme", "OEn", replySource + actionsSource + ";return aCn;")(
    localize,
    (message) => message.owner,
    () => ({ timestampMs: 0 }),
    () => "09:02",
  );
  assert.equal(reply({ owner: "your message" }), "回复你的消息");
  assert.equal(reply({ owner: "Agent message" }), "回复智能体消息");
  assert.equal(reply({ owner: "工作管家 message" }), "回复工作管家的消息");
  assert.equal(actions({ owner: "Agent message", id: "t1" }), "智能体消息 于 09:02 的消息操作 (t1)");
  locale = "en";
  assert.equal(reply({ owner: "Agent message" }), "Reply to Agent message");
  assert.equal(actions({ owner: "Agent message", id: "t1" }), "Message actions for Agent message at 09:02 (t1)");
});

test("transcript date formatters use the selected English or Chinese locale", () => {
  const source = MAIN_I18N_LOCAL_ANCHORED.find((entry) => entry.id === "local-transcript-date-locale").replacement;
  const resolved = new Function("RLocBoot", source + ";return RLocDateLocale;");
  assert.equal(resolved(() => "zh-CN"), "zh-CN");
  assert.equal(resolved(() => "en"), "en-US");
});

test("main-i18n patch is fail-closed when a pair anchor is missing", async () => {
  assert.throws(() => patchOriginalMainI18n("const anchor=sand.navigateBack;"), /has no anchor/);
});

test("main-i18n pair table is 0.59.1-sourced, mode-shaped and gap-disjoint", async () => {
  const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  const seen = new Set();
  for (const [en, zh, id, mode] of MAIN_I18N_PAIRS) {
    assert.ok(typeof en === "string" && en.length > 0, "EN must be non-empty");
    assert.ok(typeof zh === "string" && zh.length > 0, "ZH must be non-empty, id=" + id);
    assert.ok(!zh.includes(String.fromCharCode(34)), "ZH must not contain quotes: " + id);
    assert.ok(!seen.has(en), "duplicate EN entry: " + en);
    seen.add(en);
    assert.ok(id.length >= 5 && id.length <= 8, "unexpected id shape: " + id);
    for (const ch of id) assert.ok(idChars.includes(ch), "unexpected id char in " + id);
    assert.ok(mode === "FULL" || mode === "PROP" || mode === "PROP_COLON" || mode === "PANEL", "unexpected mode: " + mode);
  }
  assert.ok(MAIN_I18N_PAIRS.length >= 300, "pair table must cover the main surface");
  for (const [gap] of MAIN_I18N_GAPS) assert.ok(!seen.has(gap), "gap listed as pair: " + gap);
  const modes = new Set(MAIN_I18N_PAIRS.map((row) => row[3]));
  assert.ok(modes.has("PROP") && modes.has("PROP_COLON"), "restricted modes must be present");
});

test("main-i18n stage application writes provenance", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "main-i18n-"));
  try {
    const assetsDir = path.join(tmp, "dist/renderer/assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, "index-FAKE.js"), baseSource());
    const result = await applyOriginalRendererMainI18n({ stageRoot: tmp });
    assert.equal(result.mode, "original-renderer-main-i18n");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].role, "main-shell");
    assert.ok(result.chunks[0].pairsApplied >= 300);
    assert.equal(result.chunks[0].catalog061PairsApplied.length, MAIN_I18N_061_PAIRS.length);
    assert.equal(result.chunks[0].localPairsApplied.length, MAIN_I18N_LOCAL_PAIRS.length);
    assert.ok(result.chunks[0].totalReplacements > 0);
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].original.sha256));
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].patched.sha256));
    assert.ok(Array.isArray(result.gaps) && result.gaps.length > 0);
    const onDisk = JSON.parse(await readFile(path.join(tmp, "dist/renderer-main-i18n-extension.json"), "utf8"));
    assert.equal(onDisk.mode, "original-renderer-main-i18n");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("main-i18n stage application rejects ambiguous chunks", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "main-i18n-"));
  try {
    await mkdir(path.join(tmp, "dist/renderer/assets"), { recursive: true });
    await writeFile(path.join(tmp, "dist/renderer/assets/x.js"), "const anchor=sand.navigateBack;");
    await writeFile(path.join(tmp, "dist/renderer/assets/y.js"), "const anchor=sand.navigateBack;");
    await assert.rejects(applyOriginalRendererMainI18n({ stageRoot: tmp }), /Expected one main shell chunk/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
