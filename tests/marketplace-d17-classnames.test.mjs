// D17 账户编辑表单的类名必须与官方 0.66 逐字相同 —— 门禁化 `scripts/verify-d17-classnames.mjs`。
//
// 这条守卫存在的理由：类名拼错一个字母，样式**照常生效**（匹配上了别的规则），
// 看起来「有样式」，实际几何全错，而且没有任何既有自检会报。
//
// 守卫自身的三条性质（缺一不可）：
//   ① 官方侧取值靠**语义绑定**（JSX 树里「重命名 input 的直接父 span / 最近的 div 变体祖先」），
//      不是「离哪个类名近」——后者在实测中把非编辑态 span 当成输入框，三组全挑错。
//   ② 判据是**与官方变体 0 集合完全相等**，不是子集（少抄会静默通过），
//      也不是「匹配任一变体」（抄成 connected 态会静默通过，变异 M4 实测）。
//   ③ 「0.18 能否解析该类」查的是 **CSS 规则 + LIFTED_OFFICIAL_RULES**，不是 JS chunk
//      里有没有这个字符串 —— 两种查法各错过一次，见脚本内注释。
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = resolve(REPO, "scripts/verify-d17-classnames.mjs");
const OFFICIAL_APP = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
const DEPLOYED_APP = "/Applications/Grok Node.app/Contents/Resources/app.asar";

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 60000 });
}

// 官方 0.66 是这个比对的事实来源。缺它就没有可比对象 —— 明确跳过而不是假装通过。
const skip = !existsSync(OFFICIAL_APP)
  ? "官方 0.66 不在本机（/Applications/Grok Bot.app），无法做逐字比对"
  : !existsSync(DEPLOYED_APP)
    ? "部署版不在本机（/Applications/Grok Node.app），无法判定 0.18 能否解析类名"
    : false;

test("抽取器与判据先在合成夹具上自证正确", { skip }, () => {
  const r = runScript(["--selftest"]);
  assert.equal(r.status, 0, `自检未通过:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /自检全绿/);
});

test("D17 四组类名配方与官方逐字相同", { skip }, () => {
  const r = runScript([]);
  assert.equal(r.status, 0, `类名对拍未通过:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /完全相等/);
  // 四组都要有通过记录，且官方侧四个元素必须各自唯一定位（定位歧义会自己报错）
  for (const group of [
    "DETAIL_ACCOUNT_NAME_ROW_CLASSES",
    "DETAIL_ACCOUNT_FORM_INPUT_CLASSES",
    "DETAIL_ACCOUNT_SAVE_CLASSES",
    "DETAIL_ACCOUNT_FORM_SLOT_CLASSES",
  ]) {
    assert.match(r.stdout, new RegExp(`=== ${group} ===`), `缺少 ${group} 的判定`);
  }
  // 官方组里的类必须全部能在 0.18 解析（有 lift 或有 CSS 规则）
  assert.doesNotMatch(r.stdout, /官方组中 0\.18 无法解析的类: (?!无)/);
});
