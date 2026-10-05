import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 守卫 `scripts/verify-marketplace-parity.mjs` 里那几个 CDP 表达式常量。
 *
 * 它们是以**模板字面量**存的页面上下文 JS。这个脚本没被任何测试 import，所以测试套件
 * 对它内部的破坏是全绿的 —— 只有 `node --check` 抓得到。而 `node --check` 不在 `npm test` 里。
 *
 * 2026-10-05 本人就栽了一次：在 `SECTION_EXPR` **内部**写注释时给 `decorated` 加了反引号，
 * 反引号把模板字面量截断，文件直接语法错误。探针当时还能跑（提取器按原文切片，注释在页面
 * 上下文里只是注释），**只有 `node --check` 报了错** —— 两边表现不一致，正是最容易被忽略的形态。
 *
 * 所以这里断言的不是「脚本能跑」，而是「四个字面量都完整、没被反引号截断」。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(repoRoot, "scripts", "verify-marketplace-parity.mjs");
const SOURCE = readFileSync(SCRIPT, "utf8");

/** 按 `const NAME = \`` … `` `; `` 切出字面量原文。切法必须与探针实际用的完全一致。 */
function extractExpr(name) {
  const marker = `const ${name} = \``;
  const at = SOURCE.indexOf(marker);
  assert.notEqual(at, -1, `${name} 不在 ${SCRIPT} 里；改名了就同步这条守卫`);
  const body = at + marker.length;
  const end = SOURCE.indexOf("`;", body);
  assert.notEqual(end, -1, `${name} 的模板字面量没有闭合`);
  return SOURCE.slice(body, end);
}

const NAMES = ["SECTIONS_EXPR", "CTA_EXPR", "CATALOG_EXPR", "SECTION_EXPR"];

test("四个 CDP 表达式字面量都完整，未被反引号截断", () => {
  for (const name of NAMES) {
    const expr = extractExpr(name);
    // 每个都是 `(async () => { … })()`，尾部必须完整。
    assert.match(expr, /\}\)\(\)\s*$/, `${name} 的结尾被截断了（多半是注释里混进了反引号）`);
    assert.ok(expr.length > 2000, `${name} 只有 ${expr.length} 字符，异常短，疑似被提前截断`);
  }
});

test("字面量内部的反引号全部是转义的（裸反引号会截断模板串）", () => {
  for (const name of NAMES) {
    const expr = extractExpr(name);
    // `CATALOG_EXPR` 的注释里**合法地**有 6 处转义反引号（页面注释里给 `id` 加引号）。
    // 所以判据不是「一个反引号都不许有」，而是「每个反引号都得被反斜杠转义」——
    // 裸的那个才会把外层模板字面量截断、让整个文件语法报错。
    // 先去掉合法转义，剩下任何反引号都是截断源。
    const afterStrippingEscapes = expr.replace(/\\`/g, "");
    assert.equal(
      afterStrippingEscapes.includes("`"),
      false,
      `${name} 里有**未转义**的反引号，它会截断模板字面量（多半是某条注释里忘了转义）`,
    );
  }
});

test("字面量内部不含会在页面上下文里报错的 Node 专有写法", () => {
  // 这些表达式是被原样发到 `Runtime.evaluate` 里跑的页面 JS，出现 Node 专有标识符
  // 说明有人把宿主侧代码误写进了字面量。
  for (const name of NAMES) {
    const expr = extractExpr(name);
    for (const forbidden of ["process.env", "require(", "__dirname", "await import("]) {
      assert.equal(
        expr.includes(forbidden),
        false,
        `${name} 里出现 ${forbidden} —— 它跑在浏览器上下文，不是 Node`,
      );
    }
  }
});
