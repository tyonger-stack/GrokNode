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
import { applyAnchored } from "../scripts/lib/i18n-patch-engine.mjs";

const NL = String.fromCharCode(10);

// Synthetic main-shell slice. Every pair EN literal is embedded once as a
// title attribute so the test proves each row applies; extra lines pin the
// mode restrictions (logic positions must stay raw).
function baseSource() {
  const rows = MAIN_I18N_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})");
  rows.push(...MAIN_I18N_061_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})"));
  rows.push(...MAIN_I18N_LOCAL_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})"));
  rows.unshift("const anchor=sand.navigateBack;");
  rows.push("function yc(){return s?" + JSON.stringify("Cancel") + ":z}");
  rows.push("function dc(){d={46:" + JSON.stringify("Delete") + "}}");
  rows.push("function XGn(n){switch(n){case\"never\":return\"Never allow\";case\"always\":return\"Always allow\";case\"ask\":return\"Ask every time\"}}");
  rows.push("function ec(){e=n.isEnabled?n.runs[0]?.status===\"running\"?{detail:n.triggerDescription,iconName:\"loading\",iconStyle:Moe.runningIcon}:{detail:n.triggerDescription,iconName:\"clock\",iconStyle:Moe.enabledIcon}:{detail:\"Paused\",iconName:\"pause-circle\",iconStyle:Moe.pausedIcon}}}");
  rows.push("function _3n(n){switch(n){case\"subagent\":return\"Subagent\";case\"shell\":return\"Shell\";case\"cloud-agent\":return\"Cloud agent\"}}");
  rows.push("te.show(\"Couldn't cancel your message. Try again.\");");
  rows.push("te.show(\"Couldn't resend your message. Try again.\");");
  rows.push("te.show(\"Couldn't delete your message. Try again.\");");
  rows.push("te.show(\"Couldn't send your message. Check your connection and try again.\");");
  rows.push("const Z9n=[\"Getting ready\",\"Cleaning up\",\"Reconnecting\"];");
  rows.push("const X9n=[\"Getting ready\",\"Wiping your data\",\"Creating Grok Bot's computer\"];");
  rows.push("const Q9n=[\"Getting ready\",\"Recreating Grok Bot's computer\",\"Starting\"];");
  rows.push("const l=\"x\";l=`Open exchange with ${o}`;let c;");
  rows.push("x({detail:P?`${r} is learning your steps…`:`${r}'s screen`});");
  rows.push("x({\"aria-label\":`${l}'s screen`});");
  rows.push("function yc2(n){y=n.direction==\"inbound\"?`Message from ${n.peer.name}`:`Messaged ${n.peer.name}`;case\"fanout\":return`Messaged ${n.peers.length} agents`;}");
  rows.push("function zp(n){return n.length===0?x:`Message ${n.map(e=>e.name).join(\", \")}`}");
  rows.push("function wp(n){return n=1,e!=null&&e.length>0?`Message ${e}`:n?.isGroup===!0?\"Message group\":x1t}");
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
  assert.equal(anchored.length, 16 + MAIN_I18N_LOCAL_ANCHORED.length, "all whole-block anchors must apply");
  assert.ok(patched.includes('(RLocT("Getting ready","正在准备"))'), "boot state catalog first element must branch to +6Ex1c wording");
  assert.ok(patched.includes('(RLocT("Couldn\'t cancel your message. Try again.","无法取消你的消息。请重试。"))'), "cancel failure toast must branch to 8gi/JY wording");
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
  // Production guard (2026-09-28 settings outage): a quoted "(RLocT(" is a
  // string literal, not a call — the module then fails to parse in the
  // renderer. The synthetic fixture cannot be parsed as a module (its anchor
  // lines are deliberately ragged switch fragments), so we assert on the
  // concrete failure signature instead of a full parse.
  assert.ok(!patched.includes('["(RLocT('), "children array entries must hold RLocT calls, not quoted strings");
  assert.ok(!patched.includes(':"(RLocT('), "prop values must hold RLocT calls, not quoted strings");

});

test("main-i18n patch restricts risky pairs to display positions", async () => {
  const { patched } = patchOriginalMainI18n(baseSource());
  assert.ok(patched.includes('function yc(){return s?"Cancel":z}'), "PROP-only Cancel must leave ternary branches raw");
  assert.ok(!patched.includes('s?(RLocT("Cancel",'), "PROP-only Cancel must not branch ternaries");
  assert.ok(patched.includes('d={46:"Delete"}}'), "digit-key map values must stay raw");
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

// The "<Bot> is working" row the transcript shows while an agent is busy. The
// pair matcher structurally cannot reach it: `is working` is template text and
// `return"Typing…"` is a bare return, so both stayed English while every other
// "Typing…"/"Working…" copy in the chunk branched. Translations are byte-sourced
// from official Grok Bot 0.66.0 (rbijNi, Q5ywLe, yQopUI, OmANKk, uqs8Gd, PxYAul).
const ACTIVITY_LABEL_IDS = ["rbijNi/PxYAul", "rbijNi/Q5ywLe/yQopUI/OmANKk", "uqs8Gd"];

function activityLabelSource() {
  return ACTIVITY_LABEL_IDS.map(
    (id) => MAIN_I18N_LOCAL_ANCHORED.find((entry) => entry.id === id).replacement,
  ).join(NL);
}

test("activity label follows the selected locale in both languages", () => {
  let locale = "zh-CN";
  const RLocT = (en, zh) => (locale === "zh-CN" ? zh : en);
  const jGe = (names) =>
    names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  // new Function parses the replacements, so a brace/paren slip in the rewritten
  // minified functions fails here rather than as a black screen after packaging.
  const { gJn, _pt, hJn } = new Function(
    "RLocT",
    "qGe",
    "jGe",
    `${activityLabelSource()};return {gJn,_pt,hJn};`,
  )(RLocT, 3, jGe);
  const agent = (name) => ({ name });
  const roster = (n) => Array.from({ length: n }, (_, i) => agent(`Bot${i + 1}`));

  locale = "zh-CN";
  assert.equal(gJn("working", "Grok Node"), "Grok Node 正在工作", "rbijNi drops the is/are copula");
  assert.equal(gJn("working", "  "), null, "a blank name still yields no label");
  assert.equal(gJn("typing", "Grok Node"), "正在输入…", "PxYAul");
  assert.equal(_pt("working", [agent("工作管家")], "Grok Node"), "工作管家 正在工作");
  assert.equal(_pt("typing", [agent("工作管家")], "Grok Node"), "工作管家 正在输入", "yQopUI");
  assert.equal(_pt("working", [agent("A"), agent("B")], "Grok Node"), "A and B 正在工作", "Q5ywLe");
  assert.equal(hJn(roster(6)), "Bot1, Bot2, Bot3 and 另外 3 个", "uqs8Gd puts the counter after the noun");

  locale = "en";
  assert.equal(gJn("working", "Grok Node"), "Grok Node is working", "English must be byte-unchanged");
  assert.equal(gJn("typing", "Grok Node"), "Typing…");
  assert.equal(_pt("working", [agent("工作管家")], "Grok Node"), "工作管家 is working");
  assert.equal(_pt("typing", [agent("A"), agent("B")], "Grok Node"), "A and B are typing", "OmANKk");
  assert.equal(hJn(roster(6)), "Bot1, Bot2, Bot3 and 3 others");
  assert.equal(hJn(roster(2)), "Bot1 and Bot2", "below the overflow threshold the counter branch is not taken");
});

test("activity label patch leaves no raw English copy in the rendered row", async () => {
  const { patched } = patchOriginalMainI18n(baseSource());
  assert.ok(patched.includes('`${t} ${RLocT("is working","正在工作")}`'), "mark label must branch");
  assert.ok(!patched.includes("`${t} is working`"), "raw mark label must be gone");
  assert.ok(!patched.includes('return"Typing…"'), "bare-return Typing… must be gone");
  assert.ok(!patched.includes("are ${s}"), "raw group predicate must be gone");
  assert.ok(!patched.includes('is ${s}`'), "raw single predicate must be gone");
  assert.ok(!patched.includes('${s} ${s===1?"other":"others"}'), "raw overflow count must be gone");
  assert.ok(patched.includes("RLocOthersCount"), "overflow count must route through a localized helper");
});

test("activity label anchors are fail-closed on the pinned chunk", async () => {
  // Each row is anchored byte-exact, so a chunk that renames the minified
  // helpers or reshapes the predicate must stop packaging rather than ship a
  // half-localized row. Removing the match has to throw, not silently skip.
  const gJn = MAIN_I18N_LOCAL_ANCHORED.find((entry) => entry.id === "rbijNi/PxYAul");
  assert.throws(() => applyAnchored("const unrelated=1;", gJn.anchor, gJn.replacement), /missing|ambiguous/);
  assert.throws(
    () => applyAnchored(gJn.anchor + NL + gJn.anchor, gJn.anchor, gJn.replacement),
    /missing|ambiguous/,
  );
  for (const id of ACTIVITY_LABEL_IDS) {
    const entry = MAIN_I18N_LOCAL_ANCHORED.find((row) => row.id === id);
    assert.ok(entry, "missing anchored activity-label row: " + id);
    assert.ok(entry.anchor.startsWith("function "), "anchor must be a whole function: " + id);
    assert.ok(entry.replacement.includes("RLocT("), "replacement must branch on locale: " + id);
  }
});

// The activity-verb row: the "Searching the web" / "Thinking" line that `dse`
// produces. `Ja` is the single funnel for all of its labels, so the whole row is
// one anchor plus a table. Two labels reach their text by a route that bypasses
// `Ja` and are anchored separately.
const ACTIVITY_VERB_IDS = ["AUV+TY..oxsp1W + 2 local", "qIhBkq", "c7hvQd"];

// 18 labels, 16 byte-sourced from official 0.66.0. "Coding" and
// "Waiting on another agent" are the two translated under explicit user
// authorization (2026-10-02) because upstream cannot settle them: the former has
// two ids with two different Chinese forms and neither is referenced by name in
// the official bundle, the latter was retired upstream.
const ACTIVITY_VERB_ROWS = [
  ["Thinking", "思考中", "AUV+TY"],
  ["Working", "工作中", "b4itZn"],
  ["Searching the web", "正在搜索网页", "AyoeWR"],
  ["Reading the web", "正在阅读网页", "BaNnTc"],
  ["Reading file", "正在读取文件", "ZCUi1J"],
  ["Drafting the file", "正在起草文件", "z50Vh1"],
  ["On your computer", "正在使用你的电脑", "e7QvdT"],
  ["Running commands", "正在运行命令", "8GgDX+"],
  ["Organizing files", "正在整理文件", "P4dc6s"],
  ["Waiting on a command", "正在等待命令完成", "VMTxcE"],
  ["Generating a photo", "正在生成图片", "lZ/iKB"],
  ["On its computer", "正在使用它的电脑", "voyxge"],
  ["Messaging", "正在发送消息", "vtZ0lQ"],
  ["Browsing the web", "正在浏览网页", "+YZ9td"],
  ["Connecting to a third party app", "正在连接第三方应用", "oxsp1W"],
  ["Coding", "正在编写代码", "5PXDWI|i2BTio (ambiguous)"],
  ["Waiting on another agent", "正在等待另一个 Bot", "local (retired upstream)"],
];

function activityVerbEntry(id) {
  const entry = MAIN_I18N_LOCAL_ANCHORED.find((row) => row.id === id);
  assert.ok(entry, "missing anchored activity-verb row: " + id);
  return entry;
}

/** Build the Ja() funnel out of the anchored replacement, driven by a locale. */
function activityVerbApiWith(RLocT) {
  // new Function parses the replacement, so a brace or quote slip in the
  // rewritten minified function fails here instead of as a black screen.
  return new Function(
    "RLocT",
    "XCe",
    `${activityVerbEntry(ACTIVITY_VERB_IDS[0]).replacement};return {Ja,RLocActivityText};`,
  )(RLocT, (s) => s);
}

function activityVerbApi(locale) {
  return activityVerbApiWith((en, zh) => (locale === "zh-CN" ? zh : en));
}

test("activity-verb table covers every label with the expected wording", () => {
  const api = activityVerbApi("zh-CN");
  for (const [en, zh, id] of ACTIVITY_VERB_ROWS) {
    const row = api.Ja("v", en, "i");
    assert.equal(row.text, zh, `${en} (${id}) must render as ${zh}`);
    assert.equal(row.verb, "v", "localization must not touch the verb key");
    assert.equal(row.icon.name, "i", "localization must not touch the icon");
  }
  // The table is the whole row: nothing may be keyed on anything but the label.
  const table = activityVerbEntry(ACTIVITY_VERB_IDS[0]).replacement;
  for (const [en, zh] of ACTIVITY_VERB_ROWS) {
    assert.ok(table.includes(`"${en}":"${zh}"`), `table must carry ${en} -> ${zh}`);
  }
  assert.equal((table.match(/"[A-Za-z][A-Za-z ]*":"[^"]+"/g) ?? []).length, ACTIVITY_VERB_ROWS.length,
    "table must not carry rows beyond the audited label set");
});

test("activity-verb funnel is English in the English locale", () => {
  const api = activityVerbApi("en");
  for (const [en, , id] of ACTIVITY_VERB_ROWS) {
    assert.equal(api.Ja("v", en, "i").text, en, `${en} (${id}) must stay byte-unchanged in English`);
  }
  // An unlisted label must fall through untouched rather than render as a key.
  assert.equal(api.RLocActivityText("Some brand-new upstream label"), "Some brand-new upstream label");
  assert.equal(activityVerbApi("zh-CN").RLocActivityText("Some brand-new upstream label"), "Some brand-new upstream label",
    "an unlisted label has no translation and must pass through in both locales");
});

test("activity-verb dynamic branches follow the locale", () => {
  // The Messaging anchor is a ternary branch, so it is wrapped to be callable.
  // The Zon anchor is a whole function and needs its two collaborators.
  const buildNamed = (RLocT) =>
    new Function("RLocT", `function f(r){return r!=null&&r.trim().length>0${activityVerbEntry("qIhBkq").replacement}null}return f;`)(RLocT);
  const buildZon = (RLocT) =>
    new Function(
      "RLocT", "Ja", "XCe", "Yon",
      `${activityVerbEntry("c7hvQd").replacement};return Zon;`,
    )(
      RLocT,
      // The REAL funnel, not a pass-through: Zon(null) returns this object
      // directly, so stubbing Ja here would skip the table under test.
      activityVerbApiWith(RLocT).Ja,
      (s) => s,
      (s) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)),
    );

  let locale = "zh-CN";
  const RLocT = (en, zh) => (locale === "zh-CN" ? zh : en);
  const named = buildNamed(RLocT);
  const zon = buildZon(RLocT);
  assert.equal(named({ trim: () => "工作管家" }), "正在给 工作管家 发消息", "qIhBkq");
  assert.equal(named({ trim: () => "" }), null, "a whitespace-only name still yields no label");
  assert.equal(named(null), null);
  assert.equal(zon(null).text, "正在连接第三方应用", "oxsp1W, reached through the Ja funnel");
  assert.equal(zon("slack").text, "正在连接 Slack", "c7hvQd capitalizes the service label");

  locale = "en";
  const namedEn = buildNamed(RLocT);
  const zonEn = buildZon(RLocT);
  assert.equal(namedEn({ trim: () => "工作管家" }), "Messaging 工作管家");
  assert.equal(namedEn({ trim: () => "" }), null);
  assert.equal(zonEn(null).text, "Connecting to a third party app");
  assert.equal(zonEn("slack").text, "Connecting to Slack");
});

test("activity-verb anchors are fail-closed", () => {
  for (const id of ACTIVITY_VERB_IDS) {
    const entry = activityVerbEntry(id);
    assert.throws(() => applyAnchored("const unrelated=1;", entry.anchor, entry.replacement), /missing|ambiguous/);
    assert.throws(
      () => applyAnchored(entry.anchor + NL + entry.anchor, entry.anchor, entry.replacement),
      /missing|ambiguous/,
    );
  }
  // The Messaging anchor must match the POST-pair bytes: its static sibling is
  // already branched by the MGn904 pair, so anchoring on the pre-pair text would
  // never apply on a real packaging run.
  assert.ok(
    !activityVerbEntry("qIhBkq").anchor.includes("Messaging another assistant"),
    "the narrow anchor must not span a literal a pair already rewrote",
  );
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
