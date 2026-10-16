// Regression cover for the 0.71.2 turn-failure copy port (tray title/detail + notice text).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import * as acorn from "acorn";

import {
  patchFailureCopyMainChunk,
  patchFailureCopyNoticeChunk,
} from "../scripts/lib/failure-copy-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const run = promisify(execFile);

const pinnedMain = await readFile(path.join(ASSETS, "index-UbX-y3il.js"), "utf8").catch(() => null);
const pinnedNotice = await readFile(path.join(ASSETS, "view-1r0bwdK4.js"), "utf8").catch(() => null);
const skip = pinnedMain == null || pinnedNotice == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;

async function assertParses(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "failure-copy-"));
  const file = path.join(dir, "chunk.mjs");
  await writeFile(file, source, "utf8");
  await run(process.execPath, ["--check", file]);
}

function loadHelpers(source, locale) {
  const start = source.indexOf("const RFailTitleCopy=");
  const end = source.indexOf("function yzn(", start);
  assert.ok(start >= 0 && end > start, "helpers must sit immediately before yzn");
  const RLocT = (en, zh) => (locale === "zh" ? zh : en);
  return new Function("RLocT", source.slice(start, end)
    + "return {RFailTrayTitle,RFailTrayDetail,RFailNoticeText};")(RLocT);
}

function yznBody(source) {
  const start = source.indexOf("function yzn(");
  return source.slice(start, source.indexOf("function kzn(", start));
}

/** Behavioural contract; returns failure messages so mutations can be scored. */
function contractFailures(main, notice) {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    behaviouralChecks(main, notice, check);
  } catch (error) {
    failures.push(`threw: ${error.message}`);
  }
  return failures;
}

function behaviouralChecks(main, notice, check) {
  const zh = loadHelpers(main, "zh");
  const en = loadHelpers(main, "en");
  const body = yznBody(main);
  check(body.includes("children:RFailTrayTitle(n)}"), "tray title not routed through titleKind");
  check(body.includes(":RFailTrayDetail(n),"), "tray detail not routed through errorKind");
  check(!body.includes('"provider_overloaded"&&i?'), "overloaded copy still gated on sandModelExperiment");
  check(zh.RFailTrayTitle({ title: "Bot failed to respond", titleKind: "bot_failed_to_respond" }) === "Bot 未能回复", "zh bot title");
  check(zh.RFailTrayTitle({ title: "x", titleKind: "model_provider_overloaded" }) === "模型提供方已过载", "zh overloaded title");
  check(en.RFailTrayTitle({ title: "Server title" }) === "Server title", "title without titleKind must stay verbatim");
  check(zh.RFailTrayTitle({ title: "Other", titleKind: "automation_failed" }) === "Other", "unmapped titleKind must fall back");
  check(zh.RFailTrayTitle({ title: "T", titleKind: "toString" }) === "T", "prototype keys must not resolve");
  check(zh.RFailTrayDetail({ detail: "d", errorKind: "first_token_stall" }) === "模型未能及时开始响应。请重试。", "first_token_stall detail");
  check(en.RFailTrayDetail({ detail: "d", errorKind: "conversation_too_large" })
    === "This conversation is too large to continue. Start a new conversation with this agent.", "too-large detail");
  check(en.RFailTrayDetail({ detail: "raw", errorKind: "unknown_failure", errorParams: { technicalDetail: "boom" } })
    === "Something went wrong. Technical details: boom", "technicalDetail wrapper");
  check(zh.RFailTrayDetail({ detail: "", errorKind: "unknown_failure" }) === "生成回复时出错了。请重试。", "unknown without detail");
  check(en.RFailTrayDetail({ detail: "kept" }) === "kept", "no errorKind keeps detail");
  check(en.RFailTrayDetail({ detail: "kept", errorKind: "backend_unreachable" }) === "kept", "backend_unreachable keeps host detail");
  const entry = {
    text: "Bot failed to respond: This turn ended without a reply (…)",
    failure: {
      titleKind: "bot_failed_to_respond",
      title: { id: "Uq1VXs", message: "Bot failed to respond", zh: "Bot 未能回复" },
      detail: { id: "Ly7/5m", message: "The model didn't start responding in time. Try again.", zh: "模型未能及时开始响应。请重试。" },
    },
  };
  check(zh.RFailNoticeText(entry) === "Bot 未能回复：模型未能及时开始响应。请重试。", "zh notice text");
  check(en.RFailNoticeText(entry) === "Bot failed to respond: The model didn't start responding in time. Try again.", "en notice text");
  check(zh.RFailNoticeText({ ...entry, failure: { ...entry.failure, detail: undefined } }) === entry.text, "no detail falls back");
  check(zh.RFailNoticeText({ text: "plain" }) === "plain", "plain notice unchanged");
  check(notice.includes('children:RFailNoticeText(n)})'), "notice card does not use the failure copy");
  check(/import\{[^}]*RFailNoticeText as RFailNoticeText\}from"\.\/index-UbX-y3il\.js"/.test(notice), "notice import missing");
  check(main.includes("export{RFailNoticeText,"), "main chunk does not export the notice helper");
}

test("patched chunks parse and satisfy the 0.71.2 failure-copy contract", { skip }, async () => {
  const main = patchFailureCopyMainChunk(pinnedMain);
  const notice = patchFailureCopyNoticeChunk(pinnedNotice);
  await assertParses(main);
  await assertParses(notice);
  assert.deepEqual(contractFailures(main, notice), []);
  // The cg5y8u literal must survive verbatim: main-i18n's FULL pair is its only translator.
  assert.ok(main.includes('"The model provider is under heavy load right now. This is usually temporary — try again shortly."'));
  assert.throws(() => patchFailureCopyMainChunk(main), /missing or ambiguous/);
  assert.throws(() => patchFailureCopyNoticeChunk(notice), /missing or ambiguous/);
});

test("injected helpers are module-level bindings of the main chunk", { skip }, () => {
  const main = patchFailureCopyMainChunk(pinnedMain);
  const ast = acorn.parse(main, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration") names.add(node.id.name);
    if (node.type === "VariableDeclaration") for (const d of node.declarations) if (d.id.type === "Identifier") names.add(d.id.name);
  }
  for (const id of ["RFailTitleCopy", "RFailDetailCopy", "RFailTrayTitle", "RFailTrayDetail", "RFailNoticeText", "yzn"]) {
    assert.ok(names.has(id), `${id} must be top-level`);
  }
});

test("mutations: reverting any single anchor breaks the contract", { skip }, () => {
  const main = patchFailureCopyMainChunk(pinnedMain);
  const notice = patchFailureCopyNoticeChunk(pinnedNotice);
  const mutations = [
    ["title anchor reverted", main.replace("children:RFailTrayTitle(n)}", "children:n.title}"), notice],
    ["experiment gate restored", main.replace('"provider_overloaded"?', '"provider_overloaded"&&i?'), notice],
    ["detail anchor reverted", main.replace(":RFailTrayDetail(n),", ":n.detail,"), notice],
    ["notice text reverted", main, notice.replace("children:RFailNoticeText(n)})", "children:n.text})")],
    ["notice falls back on detail-less copy removed", main.replace("||!RFailCopyOk(f.detail)", ""), notice],
    ["technical detail ignored", main.replace("const d=n.errorParams?.technicalDetail;", "const d=null;"), notice],
  ];
  for (const [label, m, n] of mutations) {
    assert.notEqual(m + n, main + notice, `${label}: mutation did not change anything`);
    assert.ok(contractFailures(m, n).length > 0, `${label}: contract stayed green`);
  }
});
