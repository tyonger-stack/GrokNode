import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalRoutineSurfaces } from "../scripts/lib/routine-surfaces-renderer-patch.mjs";
import { patchOriginalWebhookTriggerFormGuard } from "../scripts/lib/router-renderer-patch.mjs";
import { patchOriginalLibraryHost } from "../scripts/lib/library-host-renderer-patch.mjs";
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";

const bundlePath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");
const bundle = await readFile(bundlePath, "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

const INJECTED_DEPENDENCIES = ["Emt", "Oie", "_s", "Fe", "re", "iJt", "lr", "rJt", "S2", "Hlt", "Qs", "fr", "vt", "Dr", "uhe", "Ar", "m3", "Ut", "_2n"];

function isDefined(source, id) {
  const escaped = id.replace(/[$]/g, "\\$");
  return new RegExp("(function " + escaped + "\\(|(?:const|let|var) " + escaped + "=|[,;{ ]" + escaped + "=(?!=))").test(source);
}

test("routine surfaces patch applies once to the pinned 0.18 chunk and stays parseable", { skip: bundleSkip }, () => {
  const patched = patchOriginalRoutineSurfaces(patchOriginalWebhookTriggerFormGuard(bundle));
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RRoutineRow(").length - 1, 1);
  assert.equal(patched.split("function RRoutineDetail(").length - 1, 1);
  assert.match(patched, /k=v=>p\.jsx\(RRoutineRow,\{agentId:t,automation:v,onOpen:r\},v\.id\)/);
  assert.match(patched, /p\.jsx\(RRoutineSurface,\{agentId:t\.id,automation:V,/);
  assert.doesNotMatch(patched, /rowClassName:"sand-routine__row"/, "the upstream row renderer is replaced, not duplicated");
  for (const id of INJECTED_DEPENDENCIES) assert.ok(isDefined(patched, id), id + " must be defined in the chunk the components are injected into");
});

test("routine surfaces patch fails closed when an anchor is missing or repeated", { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalRoutineSurfaces("function K2n(n){}"), /anchor must appear exactly once/);
  const guarded = patchOriginalWebhookTriggerFormGuard(bundle);
  assert.throws(() => patchOriginalRoutineSurfaces(patchOriginalRoutineSurfaces(guarded)), /anchor must appear exactly once/);
});

test("compact empty layout rejects missing or duplicate wrapper, root and mount anchors", { skip: bundleSkip }, () => {
  const anchors = [
    /1:\{className:"sand-78zum5 sand-dt5ytf sand-17d4w8g [^"]+"\}\}\[!!Cmt\(x\)<<0\]\.className/,
    /v=\{className:"sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k [^"]+"\},e\[10\]=v/,
    /N=p\.jsxs\("div",\{className:v\.className,children:\[b,x\]\}\)/,
  ];
  for (const pattern of anchors) {
    const anchor = bundle.match(pattern)?.[0];
    assert.ok(anchor, `real compact layout anchor: ${pattern}`);
    assert.throws(() => patchOriginalRoutineSurfaces(bundle.replace(anchor, "")), /known-empty routine .* anchor must appear exactly once/);
    assert.throws(() => patchOriginalRoutineSurfaces(bundle + anchor), /known-empty routine .* anchor must appear exactly once/);
  }
});

test("compact routines compose before Library host and routine i18n without changing empty-state eligibility", { skip: bundleSkip }, () => {
  const routines = patchOriginalRoutineSurfaces(patchOriginalWebhookTriggerFormGuard(bundle));
  const getFunction = (source, name) => {
    const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
    assert.ok(node, name);
    return source.slice(node.start, node.end);
  };
  for (const name of ["Cmt", "c2", "_2n"]) assert.equal(getFunction(routines, name), getFunction(bundle, name), `${name} stays unchanged`);
  const { patched } = applyPair(patchOriginalLibraryHost(routines, "/* sand-library-host */"), "Routines are recurring tasks this agent runs on a schedule.", "例行任务是这个智能体按计划重复执行的任务。", "PROP");
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.ok(patched.includes('minHeight:72,flex:"none",gap:3'));
  assert.ok(patched.includes('p.jsx(__sandLibraryHostNS.RLibraryHost,{agentId:t.id})'));
  assert.ok(patched.includes('RLocT("Routines are recurring tasks this agent runs on a schedule.","例行任务是这个智能体按计划重复执行的任务。")'));
});

test("routine detail keeps 0.59 copy, the webhook card gate, and the create path on the upstream editor", () => {
  return readFile(path.resolve(import.meta.dirname, "../scripts/lib/routine-surfaces-renderer-patch.mjs"), "utf8").then((source) => {
    for (const zh of ["当 Webhook 被触发时", "指令", "何时运行", "POST 到", "密钥", "标头", "暂停", "恢复", "测试", "编辑", "删除例行任务", "编辑你的例行任务：", "这将删除例行任务并停止其后续运行。此操作无法撤销。"]) {
      assert.ok(source.includes(zh), "missing 0.59 zh-CN copy: " + zh);
    }
    assert.match(source, /hook\?p\.jsx\(uhe,\{title:"Webhook"/, "the webhook card renders only for webhook-triggered routines");
    assert.match(source, /n\.automation==null\?startedCreate\?p\.jsx\(_2n,\{\.\.\.n\}\)/, "Create Routine still opens the upstream editor");
    assert.match(source, /getAutomationWebhookCredential\?\.\(t,id\)/, "credentials are fetched per agent and routine");
  });
});
