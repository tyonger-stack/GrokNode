import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalRoutineSurfaces } from "../scripts/lib/routine-surfaces-renderer-patch.mjs";
import { patchOriginalWebhookTriggerFormGuard } from "../scripts/lib/router-renderer-patch.mjs";

const bundlePath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");
const bundle = await readFile(bundlePath, "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

const INJECTED_DEPENDENCIES = ["Emt", "Fe", "re", "iJt", "lr", "rJt", "S2", "Qs", "fr", "vt", "Dr", "uhe", "Ar", "m3", "Ut", "_2n", "no", "It"];

function isDefined(source, id) {
  const escaped = id.replace(/[$]/g, "\\$");
  return new RegExp("(function " + escaped + "\\(|(?:const|let|var) " + escaped + "=|[,;{ ]" + escaped + "=(?!=))").test(source);
}

test("routine surfaces patch applies once to the pinned 0.18 chunk and stays parseable", { skip: bundleSkip }, () => {
  const patched = patchOriginalRoutineSurfaces(patchOriginalWebhookTriggerFormGuard(bundle));
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RRtOfficialRow(").length - 1, 1);
  assert.equal(patched.split("function RRtRowMenu(").length - 1, 1);
  assert.equal(patched.split("function RRtOfficialSwitch(").length - 1, 1);
  assert.equal(patched.split("function RRtOfficialList(").length - 1, 1);
  assert.equal(patched.split("function RRoutineDetail(").length - 1, 1);
  assert.match(patched, /k=v=>p\.jsx\(RRtOfficialRow,\{agentId:t,automation:v,onOpen:r\},v\.id\)/);
  assert.match(patched, /p\.jsx\(RRoutineSurface,\{agentId:t\.id,automation:V,/);
  assert.doesNotMatch(patched, /rowClassName:"sand-routine__row"/, "the upstream row renderer is replaced, not duplicated");
  for (const id of INJECTED_DEPENDENCIES) assert.ok(isDefined(patched, id), id + " must be defined in the chunk the components are injected into");
});

test("routine surfaces patch fails closed when an anchor is missing or repeated", { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalRoutineSurfaces("function K2n(n){}"), /anchor must appear exactly once/);
  const guarded = patchOriginalWebhookTriggerFormGuard(bundle);
  assert.throws(() => patchOriginalRoutineSurfaces(patchOriginalRoutineSurfaces(guarded)), /anchor must appear exactly once/);
});

test("known-empty routines retain the one-row height without growing the overview", { skip: bundleSkip }, () => {
  const patched = patchOriginalRoutineSurfaces(patchOriginalWebhookTriggerFormGuard(bundle));
  const functions = source => parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.filter(n => n.type === "FunctionDeclaration");
  const get = (source, name) => {
    const node = functions(source).find(n => n.id.name === name);
    assert.ok(node, name);
    return source.slice(node.start, node.end);
  };
  assert.ok(get(patched, "K2n").includes('N=p.jsx("div",{className:v.className,style:{minHeight:60,flex:"none"},children:b})'), "the empty state is a single-child copy-only mount");
  assert.ok(!get(patched, "K2n").includes('sand-yamay9 sand-1l90r2v'));
  assert.ok(get(patched, "p3n").includes('1:{className:"sand-78zum5 sand-dt5ytf sand-17d4w8g"}}[!!Cmt(x)<<0].className'));
  for (const name of ["Cmt", "c2", "_2n"]) assert.equal(get(patched, name), get(bundle, name), `${name} eligibility/editor is unchanged`);
});

test("known-empty routine state is official 0.75.8 copy with no UI create entry", { skip: bundleSkip }, () => {
  const patched = patchOriginalRoutineSurfaces(patchOriginalWebhookTriggerFormGuard(bundle));
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(
    patched.split('RRtLoc("Routines are recurring tasks this Bot runs on a schedule. Ask it in chat to set one up.","例行任务是此 Bot 按计划重复运行的任务。请在聊天中让它设置一个。")').length - 1,
    1,
    "the official ZJmAzX empty-state copy is injected exactly once",
  );
  assert.ok(!patched.includes('children:"Routines are recurring tasks this agent runs on a schedule."'), "the 0.18 empty-state literal is gone");
  assert.ok(!patched.includes("Create Routine"), "no create-entry literal survives (button children, heading tooltip, aria-label)");
  assert.ok(!patched.includes('p.jsx(yo,{content:"Create Routine"'), "the heading + action expression is removed");
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

test("email trigger lines use the official 0.75.8 copy with a mail icon, and only email lines match", () => {
  return readFile(path.resolve(import.meta.dirname, "../scripts/lib/routine-surfaces-renderer-patch.mjs"), "utf8").then((source) => {
    assert.ok(source.includes("/^when email arrives at (\\S+?)(, including unauthenticated senders)?$/i"), "the injected email regex carries the official wording, case-insensitive for describeTrigger's lowercased group segments");
    assert.match(source, /mail\?p\.jsx\(uhe,\{title:"Email",children:p\.jsx\(RRtEmailCard,\{trigger:s\.trigger\}\)\},"email"\):null/, "the Email card section follows the Webhook card for email-triggered routines");
    assert.match(source, /label:RRtLoc\("Address","地址"\)/, "the inbox address is a copy field");
    assert.match(source, /This Bot wakes when mail arrives at this address\./, "the local-only explanation note is present");
    // Behavioral check: evaluate the injected helpers exactly as they ship.
    const helpers = source.slice(source.indexOf("function RRtLoc("), source.indexOf("function RRtSummary("));
    const { RRtTriggerLines } = new Function("RLocT", helpers + "\nreturn { RRtTriggerLines };")(undefined);
    const en = RRtTriggerLines({ triggerDescription: "When email arrives at bot@mail.grokbot.com" });
    assert.deepEqual(en, [{ icon: "mail", text: "When email arrives at bot@mail.grokbot.com" }]);
    const unauthenticated = RRtTriggerLines({ triggerDescription: "When email arrives at bot@mail.grokbot.com, including unauthenticated senders" });
    assert.deepEqual(unauthenticated, [{ icon: "mail", text: "When email arrives at bot@mail.grokbot.com, including unauthenticated senders" }]);
    // A group's non-first segment arrives lowercased and must still match.
    const group = RRtTriggerLines({ triggerDescription: "Every day at 9:00 AM or when email arrives at bot@mail.grokbot.com" });
    assert.deepEqual(group, [{ icon: "clock", text: "Every day at 9:00 AM" }, { icon: "mail", text: "When email arrives at bot@mail.grokbot.com" }]);
    // Non-email descriptions keep the clock icon.
    assert.deepEqual(RRtTriggerLines({ triggerDescription: "Every day at 9:00 AM" }), [{ icon: "clock", text: "Every day at 9:00 AM" }]);
    assert.deepEqual(RRtTriggerLines({ triggerDescription: "when its webhook URL is called" }), [{ icon: "globe", text: "When a webhook fires" }]);
    // In the zh locale the official zh copy is emitted.
    const zh = new Function("RLocT", helpers + "\nreturn { RRtTriggerLines };")((enText, zhText) => zhText);
    assert.deepEqual(zh.RRtTriggerLines({ triggerDescription: "When email arrives at bot@mail.grokbot.com" }), [{ icon: "mail", text: "当 bot@mail.grokbot.com 收到邮件时" }]);
    assert.deepEqual(zh.RRtTriggerLines({ triggerDescription: "when email arrives at bot@mail.grokbot.com, including unauthenticated senders" }), [{ icon: "mail", text: "当 bot@mail.grokbot.com 收到邮件时（包括未经验证的发件人）" }]);
  });
});

test("routine row context menu wraps the row in Menu Trigger/Content with the official 0.75.8 items", () => {
  return readFile(path.resolve(import.meta.dirname, "../scripts/lib/routine-surfaces-renderer-patch.mjs"), "utf8").then((source) => {
    const row = source.slice(source.indexOf("function RRtRowMenu("));
    // Menu shell: the row group stays the data-automation-row element and becomes the
    // Trigger child; the Content carries only the official aria-label (zDSFmP, both
    // sides read off the official 0.75.8 eager-app chunk and locale table).
    assert.match(row, /function RRtRowMenu\(\{label,sections,children\}\)\{return p\.jsxs\(no,\{children:\[p\.jsx\(no\.Trigger,\{children:children\}\),p\.jsx\(no\.Content,\{"aria-label":label,children:sections\}\)\]\}\)\}/);
    assert.match(row, /p\.jsx\(RRtRowMenu,\{label:RRtLoc\("Routine actions","例行任务操作"\),sections:sections,children:p\.jsxs\("div",\{className:RRtOfficial\.group,role:"group",tabIndex:0,"aria-labelledby":ids\+"-name "\+ids\+"-schedule","data-automation-row":v\.id,onClick:open,onKeyDown:keys/);
    // Item order must be the official M$e order: pause/resume, test, edit, webhook, then
    // the delete section with its divider.
    const order = [
      'name:on?"pause":"play"',
      'name:"flask"',
      'name:"pencil"',
      'name:"globe"',
      'color:"red",name:"trash"',
    ];
    let cursor = row.indexOf("function RRtOfficialRow(");
    for (const literal of order) {
      const at = row.indexOf(literal, cursor);
      assert.ok(at > cursor, "menu item out of official order or missing: " + literal);
      cursor = at;
    }
    // Section A items with official copy (IgrLD//v39wLo, NnH3pK/lziBgy, ePK91l, TRDppN).
    assert.match(row, /children:on\?RRtLoc\("Pause","暂停"\):RRtLoc\("Resume","恢复"\)/);
    assert.match(row, /children:running\?RRtLoc\("Running…","运行中…"\):RRtLoc\("Test","测试"\)/);
    assert.match(row, /children:RRtLoc\("Edit","编辑"\)/);
    assert.match(row, /hook\?p\.jsx\(It\.Item,\{leading:p\.jsx\(Dr,\{name:"globe",size:"base"\}\),onSelect:focusHook,children:"Webhook"\}\):null/);
    assert.match(row, /p\.jsx\(It\.Section,\{children:\[p\.jsx\(It\.Item,/);
    assert.match(row, /p\.jsx\(It\.Section,\{children:p\.jsx\(It\.Item,\{leading:p\.jsx\(Dr,\{color:"red",name:"trash",size:"base"\}\)/);
    // Test disables on the same running predicate as the detail button, and the edit item
    // seeds the composer with the official hsz5he prefix.
    assert.match(row, /running=run\.isPending\|\|blocked\|\|v\.runs\?\.\[0\]\?\.status==="running"/);
    assert.match(row, /RRtSeedComposer\(RRtLoc\("Edit your routine: ","编辑你的例行任务："\)\+v\.name\)\|\|open\(\)/);
    // Webhook item opens the detail and focuses the webhook URL copy field.
    assert.match(row, /document\.querySelector\('\[data-routine-detail\] input\[data-r-webhook-url\]'\)/);
    assert.match(row, /el&&\(el\.focus\(\),el\.scrollIntoView\(\{block:"nearest"\}\)\)/);
    assert.match(row, /inputProps:\{"data-r-webhook-url":""\}/, "the webhook card's URL copy field carries the focus hook");
    assert.match(row, /function RRtCopyField\(\{label:l,value:v,placeholder:ph,tip:tip,inputProps:ip\}\)/);
    assert.match(row, /p\.jsx\("input",\{\.\.\.ip,"aria-label":l/, "inputProps spreads ahead of the fixed attributes, so the default shape is unchanged");
    // Delete keeps the detail page's S2 confirm copy verbatim.
    assert.match(row, /confirm=S2\(\)/);
    assert.match(row, /title:RRtLoc\("Delete “","删除“"\)\+v\.name\+"”"/);
    assert.match(row, /destructive:!0,perform:async\(\)=>\{try\{return await ctl\.remove\(t,v\.id\),null\}catch\{return RRtLoc\("Deleting failed\. Check your connection and try again\.","删除失败。请检查网络连接后重试。"\)\}\}/);
    assert.match(row, /style:\{color:"var\(--cursor-text-red,#e5484d\)"\}/, "the delete label span uses the inline danger color");
    // The switch keeps sharing the same optimistic toggle as the menu item.
    assert.match(row, /p\.jsx\(RRtOfficialSwitch,\{checked:on,label:\(on\?RRtLoc\("Pause ","暂停"\):RRtLoc\("Resume ","恢复"\)\)\+v\.name,onToggle:toggle\}\)/);
    // Official lM replaces the row's schedule line with URAE3q ("Paused" / 已暂停) while paused.
    assert.match(row, /children:on\?RRtSummary\(v\):RRtLoc\("Paused","已暂停"\)/);
  });
});
