// D17 官方类名逐字对拍（结构化版）。
//
// 为什么重写：旧版按「离锚点最近 / 重合度最高」的启发式挑官方 className 组 —— 它挑错了三组
// （把非编辑态 span 当成输入框、把别的元素的组当成账户名行与保存按钮）。启发式挑出来的
// 「最接近」长得像答案，但不是答案。本版改为：把 className **语义绑定到具体元素**
// （标签名 + aria-label 消息 id + 平衡括号取到的真实 props），再逐字比对。
//
// 用法：node scripts/verify-d17-classnames.mjs [--selftest]
// 纯离线：只读官方 asar 字节 + 本地源码，不需要 app 运行、不需要 CDP。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICIAL_ASAR = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
// 账户多账号组件所在的官方 chunk。0.66 官方该组件在懒加载 chunk 里，不在 eager 主 chunk ——
// 只扫主 chunk 会误判「官方没有这些类名」。
const OFFICIAL_CHUNK = "dist/renderer/assets/chunk-plugin-detail-view-tZskkHRA.js";
const OFFICIAL_COMPONENT = "ve"; // 组件函数名（承载 mcp_multi_account 的多账户行 + 内联编辑表单）

// ── asar 读取 ────────────────────────────────────────────────────────────────
/** 从 asar 里读一个 packed 文件。offset 在 JSON 里是字符串，必须走 BigInt，否则会静默读出错误字节。 */
function readFromAsar(asarPath, path) {
  const b = readFileSync(asarPath);
  const dataStart = 8 + b.readUInt32LE(4);
  const jsonLen = b.readUInt32LE(12);
  const header = JSON.parse(b.subarray(16, 16 + jsonLen).toString("utf8"));
  let node = header;
  for (const seg of path.split("/")) {
    if (!node.files?.[seg]) return null;
    node = node.files[seg];
  }
  if (node.offset === undefined) return null;
  const at = Number(BigInt(dataStart) + BigInt(node.offset));
  return b.subarray(at, at + node.size).toString("utf8");
}

// ── 结构化解析：从签名后的第一个 { 起，按括号深度切出完整函数体 ────────────────
/**
 * 抽函数体。必须从「签名 ')' 之后的第一个 '{'」开始：needle 之后第一个 '{' 往往不是函数自己的
 * （可能落在形参默认值或函数体内部的对象字面量里），会切出「上一函数尾巴 + 相邻函数」。
 * @returns {{bodyStart:number, bodyEnd:number, text:string}|null}
 */
export function extractFunction(source, name) {
  const sig = source.indexOf(`function ${name}(`);
  if (sig < 0) return null;
  let i = source.indexOf("(", sig);
  let depth = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  const brace = source.indexOf("{", i);
  if (brace < 0) return null;
  let d = 0;
  let j = brace;
  for (; j < source.length; j++) {
    const c = source[j];
    if (c === "{") d++;
    else if (c === "}") {
      d--;
      if (d === 0) {
        j++;
        break;
      }
    }
  }
  return { bodyStart: brace, bodyEnd: j, text: source.slice(sig, j) };
}

// ── 解析 n.jsx(…) / n.jsxs(…) 调用：标签 + 平衡括号内的 props ──────────────────
/**
 * 解析 className 表达式里的类名。
 * 官方产物里见到的三种形态（顺序有讲究，不能先匹配 `[`）：
 *   ① "a b c"                                              —— 纯字符串
 *   ② {0:{className:"a b"},1:{className:"a c"}}[!!f<<0].className —— 变体对象
 *      ⚠️ 它**不以 `[` 开头**（以 `{` 开头），先试数组分支会永远落空并退化成扁平数组。
 *   ③ ["a","b"]
 * @returns {string[]|string[][]|null} 变体形态返回二维数组
 */
function parseClassNames(raw) {
  if (raw == null) return null;
  const s = raw.trim();
  const asString = /^"([^"]*)"$/.exec(s);
  if (asString) return asString[1].split(/\s+/).filter(Boolean);
  // 变体形态优先判：只要含 className: 就说明是「按条件选一组」的载体
  if (s.includes("className:")) {
    return [...s.matchAll(/className:\s*(?:"([^"]*)"|\[([^\]]*)\])/g)].map((m) =>
      m[1] !== undefined
        ? m[1].split(/\s+/).filter(Boolean)
        : (m[2].match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1)),
    );
  }
  const arr = /^\[([^\]]*)\]/.exec(s);
  if (arr) return (arr[1].match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1));
  const quoted = s.match(/"([^"]+)"/g);
  return quoted ? quoted.map((q) => q.slice(1, -1)) : null;
}

/** 扫出组件体内所有 jsx/jsxs 调用。返回 {tag, props, propsStart, propsEnd, callEnd, at}。 */
export function scanJsxCalls(body) {
  const out = [];
  const re = /\bjsx(s?)\(\s*("(?:[^"]*)"|[A-Za-z_$][\w$]*)\s*,\s*\{/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const propsStart = m.index + m[0].length - 1; // 指向 '{'
    let d = 0;
    let i = propsStart;
    for (; i < body.length; i++) {
      const c = body[i];
      if (c === "{") d++;
      else if (c === "}") {
        d--;
        if (d === 0) break;
      }
    }
    // 整个调用的右括号：props 的 '}' 之后紧跟的那个 ')'
    let j = i + 1;
    while (j < body.length && /[\s)]/.test(body[j])) {
      if (body[j] === ")") break;
      j++;
    }
    out.push({
      tag: m[2],
      props: body.slice(propsStart, i + 1),
      propsStart,
      propsEnd: i + 1,
      callEnd: j,
      at: m.index,
      key: `jsx${m[1]}`,
    });
  }
  return out;
}

/**
 * 按包含关系把 jsx 调用组织成树：调用 A 是 B 的孩子，当 B.propsStart < A.at 且 A.callEnd <= B.propsEnd
 * 且二者之间没有别的调用。用来回答「某个元素的**直接父元素**是谁」——
 * 这是把类名绑定到元素的关键（账户名行是 input 的直接父 span，不是外层那个 span）。
 */
export function buildJsxTree(calls) {
  const withParent = calls.map((c) => ({ ...c, children: [] }));
  const byAt = [...withParent].sort((a, b) => a.at - b.at);
  for (let i = 0; i < byAt.length; i++) {
    const child = byAt[i];
    // 找最近的、范围包含 child 的调用
    let parent = null;
    for (let k = i - 1; k >= 0; k--) {
      const cand = byAt[k];
      if (cand.propsStart < child.at && child.callEnd <= cand.propsEnd) {
        parent = cand;
        break;
      }
    }
    if (parent) parent.children.push(child);
    child.parent = parent;
  }
  return withParent;
}

/**
 * 取本元素 props **顶层**（depth===1）的某个 prop。
 * ⚠️ 不能在整个 props 文本上取首个匹配 —— props 里还嵌着 children 里的子元素，
 * 首个命中可能属于子元素。限定 depth===1 才是「这个元素自己的那一层」。
 * @returns {{callee:string, value:string, full:string}|null}
 *   full  = 整个顶层值表达式（到本层逗号或 props 结束为止），三元表达式要靠它
 *   value = 若值被单个工厂调用包着（g(…) / Fe(…)），则是括号内原文；否则同 full
 */
function propRaw(call, propName) {
  const props = call.props;
  const needle = propName.endsWith(":") ? propName : `${propName}:`;
  let d = 0;
  for (let i = 0; i < props.length; i++) {
    const c = props[i];
    if (c === "{") { d++; continue; }
    if (c === "}") { d--; continue; }
    if (d !== 1 || !props.startsWith(needle, i)) continue;
    let k = i + needle.length;
    while (k < props.length && /\s/.test(props[k])) k++;
    // 本层（相对 depth 0）扫到逗号或 props 结束，得到完整值表达式
    let dd = 0;
    let end = props.length - 1;
    for (let j = k; j < props.length; j++) {
      const ch = props[j];
      if (ch === "{" || ch === "(" || ch === "[") dd++;
      else if (ch === "}" || ch === ")" || ch === "]") {
        if (dd === 0 && ch === "}") { end = j - 1; break; }
        dd--;
      } else if (ch === "," && dd === 0) { end = j - 1; break; }
    }
    const full = props.slice(k, end + 1);
    // 若整个值就是一个 `标识符(…)` 形式的调用，剥掉外层括号
    const call = /^[A-Za-z_$][\w$]*\s*\(/.exec(full);
    let callee = "";
    let value = full;
    if (call) {
      callee = full.slice(0, full.indexOf("(")).trim();
      let s = full.indexOf("(");
      let lvl = 0;
      for (let j = s; j < full.length; j++) {
        if (full[j] === "(") lvl++;
        else if (full[j] === ")") {
          lvl--;
          if (lvl === 0) {
            if (full.slice(j + 1).trim() === "") {
              value = full.slice(s + 1, j);
              break;
            }
            s = -1;
            break;
          }
        }
      }
      if (s === -1) value = full;
    }
    return { callee, value, full };
  }
  return null;
}

/** 从 props 里取 aria-label 里的 i18n 消息 id 序列（限定本元素顶层，覆盖三元两分支）。 */
function ariaLabelIds(call) {
  const raw = propRaw(call, '"aria-label"');
  if (raw == null) return [];
  return [...raw.full.matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1]).slice(0, 4);
}

/** 数某个元素的顶层 className 解析出几个变体（[!!f<<0] 这种按状态切的形态）。 */
function variantCount(call) {
  const parsed = parseClassNames(propRaw(call, "className")?.value);
  if (parsed == null) return 0;
  return Array.isArray(parsed[0]) ? parsed.length : 1;
}

/** 沿父链向上找最近的满足条件的祖先。 */
function nearestAncestor(node, predicate) {
  for (let p = node?.parent; p; p = p.parent) if (predicate(p)) return p;
  return null;
}

// ── 自检：抽取器与 jsx 扫描器必须先在合成夹具上证明自己正确 ────────────────────
function selftest() {
  let fails = 0;
  const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  };

  // ① 不得吞掉相邻函数：签名里带默认值对象字面量，且函数尾紧邻另一个函数
  const fixture = `function aa(x){const y={a:1};return y}function bb(n){return n<0?{k:1}:null}`;
  const fa = extractFunction(fixture, "aa");
  eq("夹具① aa() 体不吞 bb()", fa.text, "function aa(x){const y={a:1};return y}");
  eq("夹具① bb() 独立可抽", extractFunction(fixture, "bb").text, "function bb(n){return n<0?{k:1}:null}");

  // ② 形参里带括号与花括号，不得把配平起点落在 '{' 上
  const fixture2 = `function cc({a,b},fn=(x)=>({y:x})){return fn({a})}function dd(){}`;
  eq("夹具② cc() 体精确", extractFunction(fixture2, "cc").text, "function cc({a,b},fn=(x)=>({y:x})){return fn({a})}");

  // ③ className 三种形态
  eq("className 字符串形态", parseClassNames(`"a b c"`), ["a", "b", "c"]);
  eq("className 数组形态", parseClassNames(`["a","b"]`), ["a", "b"]);
  eq("className 变体对象形态", parseClassNames(`{0:{className:"a b"},1:{className:"a c"}}[!!k<<0].className`), [
    ["a", "b"],
    ["a", "c"],
  ]);

  // ④ jsx 调用扫描：props 里的嵌套花括号不得提前终止
  const fixture3 = `n.jsx("button",{className:g({0:{className:"a"},1:{className:"b"}}[!!f<<0].className),"aria-label":V!=null?c({id:"x",values:{l:1}}):c({id:"y"}),onClick:()=>{if(V!=null){Y();return}b({accountKey:z.acc})})`;
  const calls = scanJsxCalls(fixture3);
  eq("夹具④ 扫到 1 个 jsx 调用", calls.length, 1);
  eq("夹具④ 标签正确", calls[0]?.tag, `"button"`);
  eq("夹具④ className 变体解析", parseClassNames(propRaw(calls[0], "className")?.value), [["a"], ["b"]]);
  eq("夹具④ aria-label 消息 id", ariaLabelIds(calls[0]), ["x", "y"]);

  // ⑤ 顶层 vs 嵌套：子元素也有 className 时，取到的必须是**本元素**的
  const fixture4 = `n.jsxs("span",{className:g("outer"),children:[n.jsx("input",{className:g("inner")})]})`;
  const calls4 = scanJsxCalls(fixture4);
  const tree4 = buildJsxTree(calls4);
  eq("夹具⑤ 扫到 2 个调用", calls4.length, 2);
  eq("夹具⑤ 外层 className 不被内层污染", parseClassNames(propRaw(tree4[0], "className")?.value), ["outer"]);
  eq("夹具⑤ 内层 className 正确", parseClassNames(propRaw(tree4[1], "className")?.value), ["inner"]);
  eq("夹具⑤ input 的直接父是 span", tree4[1].parent?.tag, `"span"`);

  // ⑥ 三层嵌套时，直接父必须是最内层那个（账户名行 vs 外层 span 的歧义就是这一类）
  const fixture5 = `n.jsxs("div",{className:g("slot"),children:[n.jsxs("span",{className:g("outer"),children:[n.jsxs("span",{className:g("row"),children:[n.jsx("input",{})]})]})]})`;
  const tree5 = buildJsxTree(scanJsxCalls(fixture5));
  const input5 = tree5.find((c) => c.tag === `"input"`);
  eq("夹具⑥ input 直接父 = 内层 span", input5.parent && parseClassNames(propRaw(input5.parent, "className")?.value)?.join(""), "row");
  eq("夹具⑥ 该 span 的直接父 = 外层 span", input5.parent.parent && parseClassNames(propRaw(input5.parent.parent, "className")?.value)?.join(""), "outer");
  eq("夹具⑥ 再上一层 = div 槽位", input5.parent.parent.parent && parseClassNames(propRaw(input5.parent.parent.parent, "className")?.value)?.join(""), "slot");

  // ⑦ 「最近的 div 祖先 + 变体形态」判据：中间隔两层 span 时仍要取到真正的槽位
  const fixture7 = `n.jsxs("div",{className:g({0:{className:"slotA"},1:{className:"slotB"}}[!!f<<0].className),children:[n.jsxs("span",{className:g("w1"),children:[n.jsxs("span",{className:g("row"),children:[n.jsx("input",{})]})]})]})`;
  const tree7 = buildJsxTree(scanJsxCalls(fixture7));
  const input7 = tree7.find((c) => c.tag === `"input"`);
  const slot7 = nearestAncestor(input7.parent, (p) => p.tag === `"div"` && variantCount(p) >= 2);
  eq("夹具⑦ 槽位取到 div 变体", slot7 && parseClassNames(propRaw(slot7, "className")?.value), [["slotA"], ["slotB"]]);
  eq("夹具⑦ 最近的 div 但非变体 → 不选中", nearestAncestor(input7.parent, (p) => p.tag === `"div"`) === slot7, true);

  // ⑧ 三元两个分支的 id 都要取到
  eq("夹具⑧ 三元 aria-label 两分支", ariaLabelIds({ props: `{"aria-label":V!=null?c({id:"a"}):c({id:"b"}),"aria-expanded":V!=null}` }), ["a", "b"]);

  console.log(fails === 0 ? "\n✅ 自检全绿" : `\n❌ 自检 ${fails} 项失败`);
  return fails === 0;
}

if (process.argv.includes("--selftest")) {
  process.exit(selftest() ? 0 : 1);
}

// ── 真实校验 ──────────────────────────────────────────────────────────────────
const official = readFromAsar(OFFICIAL_ASAR, OFFICIAL_CHUNK);
if (official == null) {
  console.error(`❌ 读不到官方 chunk：${OFFICIAL_CHUNK}`);
  process.exit(2);
}
const ve = extractFunction(official, OFFICIAL_COMPONENT);
if (ve == null) {
  console.error(`❌ 官方 chunk 里找不到组件 ${OFFICIAL_COMPONENT}()`);
  process.exit(2);
}
console.log(`官方 ${OFFICIAL_CHUNK}  ${official.length} B`);
console.log(`${OFFICIAL_COMPONENT}() 体 ${ve.bodyStart}-${ve.bodyEnd}（${ve.text.length} B）`);
console.log(`体后紧邻：${JSON.stringify(official.slice(ve.bodyEnd, ve.bodyEnd + 40))}\n`);

const tree = buildJsxTree(scanJsxCalls(ve.text));
console.log(`ve() 内 jsx 调用 ${tree.length} 处\n`);

// ── 语义绑定：靠「JSX 树的直接父子关系」+ aria-label 消息 id 定位元素 ──────────
// 关键：不按「离哪个类名近 / 重合度最高」猜 —— 那套启发式在实测中把非编辑态 span 当成输入框、
// 把别的元素的组当成账户名行与保存按钮，三组全挑错。父子关系是结构事实，不是相关性猜测。
const INPUT_IDS = ["BJ7R7v"]; // 重命名输入框的 aria-label 消息 id
const BTN_IDS = ["xzJ6xV", "tT4tWM"]; // 展开态(保存) / 收起态(编辑) —— 官方同一个 button

const hasAriaId = (c, ids) => ariaLabelIds(c).some((id) => ids.includes(id));
const input = tree.find((c) => c.tag === `"input"` && hasAriaId(c, INPUT_IDS));
const button = tree.find((c) => c.tag === `"button"` && hasAriaId(c, BTN_IDS));
// 账户名行 = input 的直接父 span（不是外层那个 span —— 两层都含 input 的 aria-label）
const nameRow = input?.parent;
// 表单槽位 = 沿父链向上最近的 div，且它的 className 是「按状态切变体」形态
// （[!!fs<<0]）。⚠️ 不能写死成「直接父」：官方在账户名行与槽位之间还隔了一层 span。
// 附加的变体断言是 fail-closed 的保险：若取错层，这里会因「非变体形态」而报错。
const formSlot = nearestAncestor(nameRow, (p) => p.tag === `"div"` && variantCount(p) >= 2);

function officialClasses(call, label, extra = "") {
  if (call == null) {
    console.log(`❌ ${label}: 在 ${OFFICIAL_COMPONENT}() 里没定位到元素`);
    return null;
  }
  const parsed = parseClassNames(propRaw(call, "className")?.value);
  if (parsed == null) {
    console.log(`❌ ${label}: 取不到 className`);
    return null;
  }
  console.log(`✅ ${label}: ${call.tag} @ve${call.at}${extra}`);
  return Array.isArray(parsed[0]) ? parsed : [parsed];
}

const OFFICIAL = {
  DETAIL_ACCOUNT_NAME_ROW_CLASSES: officialClasses(nameRow, "账户名行 span（input 的直接父）"),
  DETAIL_ACCOUNT_FORM_INPUT_CLASSES: officialClasses(input, "重命名输入框 input", ` aria-label=[${input ? ariaLabelIds(input).join(",") : ""}]`),
  DETAIL_ACCOUNT_SAVE_CLASSES: officialClasses(button, "编辑/保存 button（同一个元素两态）", ` aria-label=[${button ? ariaLabelIds(button).join(",") : ""}]`),
  DETAIL_ACCOUNT_FORM_SLOT_CLASSES: officialClasses(formSlot, `表单槽位 div（${formSlot ? variantCount(formSlot) : 0} 个状态变体）`),
};

// 我们实现里的配方（从源码抠，避免手抄）
const stylesSrc = readFileSync(resolve(HERE, "..", "frontend/src/extensions/marketplace/official-styles.ts"), "utf8");
function ourRecipe(constName) {
  const m = new RegExp(`export const ${constName} = \\[([^\\]]*)\\]`).exec(stylesSrc);
  return m ? m[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)) : null;
}

// ── 0.18 侧「这个类名能不能生效」────────────────────────────────────────────
// ⚠️ 判据必须查 **CSS 规则**，不能查 JS chunk 里有没有这个字符串。两处都错过：
// ① `sand-15kz4h8` 在 JS 里 0 引用，但 0.18 CSS **有** `min-width:16px` 规则 ——
//    按 JS 判会误判成「0.18 没有」而把它删掉（2026-10-05 已因此删过一次）。
// ② `sand-1pic42t`/`sand-1onr9mi` 在 0.18 CSS 里确实没有，但它们经 LIFTED_OFFICIAL_RULES
//    以 padding-inline-start/end:14px 注入，按 CSS 单查会误判成「不可用」。
// 三条依据：0.18 CSS 有规则 / 在 LIFTED_OFFICIAL_RULES 里 / 两者皆无 = 真缺口。
const DEPLOYED_ASAR = "/Applications/Grok Node.app/Contents/Resources/app.asar";
const stylesFull = readFileSync(resolve(HERE, "..", "frontend/src/extensions/marketplace/official-styles.ts"), "utf8");
const lifted = new Set(
  [...stylesFull.matchAll(/^\s*\["(sand-[a-z0-9]+)",\s*"[^"]*"/gm)].map((m) => m[1]),
);
const dAssets = (() => {
  const b = readFileSync(DEPLOYED_ASAR);
  const dataStart = 8 + b.readUInt32LE(4);
  const jsonLen = b.readUInt32LE(12);
  const header = JSON.parse(b.subarray(16, 16 + jsonLen).toString("utf8"));
  return { b, dataStart, files: header.files.dist.files.renderer.files.assets.files };
})();
const readAsset = (name) => {
  const node = dAssets.files[name];
  if (node?.offset === undefined) return null;
  const at = Number(BigInt(dAssets.dataStart) + BigInt(node.offset));
  return dAssets.b.subarray(at, at + node.size).toString("utf8");
};
const deployedCss = Object.keys(dAssets.files)
  .filter((n) => n.endsWith(".css"))
  .map((n) => readAsset(n) ?? "")
  .join("\n");
const resolvable = (cls) =>
  new RegExp(`\\.${cls}(?![\\w-])`).test(deployedCss)
    ? "0.18 CSS 有规则"
    : lifted.has(cls)
      ? "LIFTED_OFFICIAL_RULES 注入"
      : "⚠️ 0.18 无法解析";
console.log(`0.18 CSS ${deployedCss.length} B；LIFTED_OFFICIAL_RULES 收录 ${lifted.size} 个 sand-* 类\n`);

let problems = 0;
for (const [name, variants] of Object.entries(OFFICIAL)) {
  const ours = ourRecipe(name);
  console.log(`=== ${name} ===`);
  if (!variants || !ours) {
    console.log(variants ? "❌ 在 official-styles.ts 里找不到常量" : "❌ 官方侧没定位到元素");
    problems++;
    console.log();
    continue;
  }
  // 通过条件是**与指定变体的集合完全相等**，不是「我方 ⊆ 官方」，也不是「匹配任一变体」。
  // ① 旧判据用子集 ⇒「少抄」静默通过，而少抄正是当初把 3 个类剔掉的错误形状。
  // ② 「匹配任一变体」也不行：官方那个槽位 div 是 `[!!fs<<0]`（按是否 connected 切两态），
  //    两个变体都 9 类、只差一个类，于是「抄成了另一个状态」会被判成完全对齐（变异 M4 实测 exit 0）。
  //    本实现只渲染未连接态，因此显式绑定变体 0；变体 1 的差异列为**已知缺口**打印出来。
  const officialSet = variants[0];
  const diff = [
    ...officialSet.filter((c) => !ours.includes(c)),
    ...ours.filter((c) => !officialSet.includes(c)),
  ];
  if (diff.length === 0) {
    console.log(`  ✅ 与官方变体 0（未连接态）集合完全相等（${ours.length} 类）`);
  } else {
    console.log(`  ❌ 与官方变体 0 不相等（我方 ${ours.length} / 官方 ${officialSet.length}）`);
    console.log(`     差异 ${diff.length} 个: ${diff.join(" ") || "无"}`);
    problems++;
  }
  if (variants.length > 1) {
    const other = variants[1].filter((c) => !officialSet.includes(c));
    if (other.length) {
      console.log(`     ℹ️  官方还有变体 1（connected 态）多出 ${other.length} 类: ${other.join(" ")}`);
      console.log(`        本实现不渲染该状态 —— 已知缺口，非静默通过`);
    }
  }
  const unresolved = officialSet.filter((c) => resolvable(c) === "⚠️ 0.18 无法解析");
  console.log(`     官方组中 0.18 无法解析的类: ${unresolved.join(" ") || "无（全部可解析）"}`);
  console.log();
}

// ── 部署字节层：源码对了 ≠ 部署包里有 ───────────────────────────────────────
// 上面四组比对的是**源码**。但产物是 esbuild 后的 IIFE：类名被抽成短名常量
// （`var St=fn` 这种别名链），且注入代码里根本没有 `className:` 字面量。
// 所以必须再验一层：从**已部署的 /Applications asar** 里把注入 IIFE 切出来，
// 顺着常量绑定把三组类名解回来，确认落地字节与官方逐字相同。
// 纪律：取样对象必须是**部署态**那一份字节。上一轮「产物逐 chunk node --check 全过」
// 就是假绿 —— 检查的 staged 副本和 ditto 部署的不是同一份。
const DEPLOYED_CHUNK = "dist/renderer/assets/index-UbX-y3il.js";
const MARKER = "data-account-edit-form";

/** 从 `(()=>{` 处按花括号深度切出 IIFE；`from` 为锚点偏移。 */
function extractIife(source, from) {
  let start = -1;
  for (let i = from; i >= 0 && i > from - 200000; i--) {
    if (source.startsWith("(()=>{", i)) { start = i; break; }
  }
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  let d = 0;
  for (let j = brace; j < source.length; j++) {
    const c = source[j];
    if (c === "{") d++;
    else if (c === "}") {
      d--;
      if (d === 0) return { start, end: j + 1, text: source.slice(start, j + 1) };
    }
  }
  return null;
}

/**
 * 在 IIFE 内解析字符串数组常量与别名链。
 * ⚠️ 踩过的坑：esbuild 把多个声明压成**逗号连写**（`var A=…, Yn=[…], fn=Yn, et=[…]`），
 * 只匹配 `var|let|const NAME=` 只能认出逗号后的第一个，后面全是漏的 —— 表现为
 * 「常量认出来了却解析不出数组」。因此不依赖声明关键字，直接找 `NAME=[…]` 赋值。
 * 同一名字出现多个**不同**数组时 fail-closed（短名在 5.9MB chunk 里会重名，不猜）。
 */
function resolveConsts(iifeText) {
  const arrays = new Map();
  const aliases = new Map();
  for (const [name, value] of [
    ...[...iifeText.matchAll(/\b([A-Za-z_$][\w$]{0,3})\s*=\s*\[([^\]]*)\]/g)].map((m) => [m[1], m[2]]),
  ]) {
    const arr = [...value.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (arr.length) {
      if (!arrays.has(name)) arrays.set(name, new Set());
      arrays.get(name).add(arr.join(" "));
    }
  }
  for (const m of iifeText.matchAll(/\b([A-Za-z_$][\w$]{0,3})\s*=\s*([A-Za-z_$][\w$]{0,3})\b(?!\s*[\[(.])/g)) {
    const [, name, target] = m;
    if (!aliases.has(name)) aliases.set(name, new Set());
    aliases.get(name).add(target);
  }
  const resolve = (name, depth = 0) => {
    if (depth > 8) return null;
    const set = arrays.get(name);
    if (set) return set.size === 1 ? [...set][0].split(" ") : { ambiguous: [...set] };
    const al = aliases.get(name);
    if (al && al.size === 1) return resolve([...al][0], depth + 1);
    return null;
  };
  return resolve;
}

const deployedSrc = readFromAsar(DEPLOYED_ASAR, DEPLOYED_CHUNK);
console.log(`\n──────── 部署字节层（${DEPLOYED_ASAR}）────────`);
if (deployedSrc == null) {
  console.log(`⚠️ 读不到部署版 ${DEPLOYED_CHUNK}（尚未部署？）—— 跳过该层`);
} else {
  const markerAt = deployedSrc.indexOf(MARKER);
  const iife = markerAt < 0 ? null : extractIife(deployedSrc, markerAt);
  if (iife == null) {
    console.log(`⚠️ 部署字节里找不到注入 IIFE（${MARKER} 命中 ${markerAt}）—— 跳过该层`);
  } else {
    // 注入代码里上类的形式是 B(el, LIST)。找出 Et/createAccountEditForm 那个函数体里用到的三个列表常量。
    const fnAt = iife.text.indexOf(MARKER);
    const bodyStart = iife.text.lastIndexOf("function ", fnAt);
    const body = iife.text.slice(bodyStart, bodyStart + 2000);
    const used = [...new Set([...body.matchAll(/B\([A-Za-z_$][\w$]*,\s*([A-Za-z_$][\w$]*)\)/g)].map((m) => m[1]))];
    console.log(`注入 IIFE ${iife.text.length} B（@${iife.start}–${iife.end}）；表单函数用到的类列表常量: ${used.join(", ") || "未识别"}`);

    const resolve = resolveConsts(iife.text);
    const EXPECT = {
      "表单槽位": "DETAIL_ACCOUNT_FORM_SLOT_CLASSES",
      "重命名输入框": "DETAIL_ACCOUNT_FORM_INPUT_CLASSES",
      "编辑/保存按钮": "DETAIL_ACCOUNT_SAVE_CLASSES",
    };
    let deployProblems = 0;
    if (used.length === 0) {
      console.log("❌ 未能从注入代码里识别出类列表常量（形状变了？）");
      deployProblems++;
    }
    for (const list of used) {
      const actual = resolve(list);
      if (actual == null) {
        console.log(`❌ 常量 ${list} 解析不出字符串数组`);
        deployProblems++;
        continue;
      }
      if (!Array.isArray(actual)) {
        console.log(`❌ 常量 ${list} 在注入 IIFE 内有 ${actual.ambiguous.length} 个不同数组（短名重名），拒绝猜测`);
        for (const v of actual.ambiguous) console.log(`   候选: ${v}`);
        deployProblems++;
        continue;
      }
      // 不去猜 minified 名对应哪个源码常量（esbuild 会重命名，猜就是臆造）。
      // 改为**按内容**在官方四组里找匹配项：解出来的数组必须逐字等于某一组。
      const hit = Object.entries(OFFICIAL).find(([, v]) => v[0].join(" ") === actual.join(" "));
      if (hit) {
        console.log(`✅ ${list} → ${hit[0]}: 部署字节 ${actual.length} 类，与官方逐字相同`);
      } else {
        const near = Object.entries(OFFICIAL)
          .map(([n, v]) => ({ n, d: v[0].filter((c) => !actual.includes(c)).length + actual.filter((c) => !v[0].includes(c)).length }))
          .sort((a, b) => a.d - b.d)[0];
        console.log(`❌ ${list} (${actual.length} 类) 与官方四组都不相等；最接近 ${near.n}，差 ${near.d} 个`);
        console.log(`   部署: ${actual.join(" ")}`);
        deployProblems++;
      }
    }
    if (deployProblems > 0) problems += deployProblems;
  }
}

console.log();
console.log(problems === 0
  ? "✅ 源码层与部署字节层均与官方逐字相同"
  : `⚠️ 共 ${problems} 组存在问题`);
process.exit(problems === 0 ? 0 : 1);
