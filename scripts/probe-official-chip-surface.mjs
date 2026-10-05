// 官方 0.66 的 `sand-plugins__chip` / `__chips` 到底在不在市场界面上渲染？
//
// 起因（2026-10-05 18:3x）：EVIDENCE §26 曾断言这两个类名是「区块行的分类标签」，
// 而本地没有 ⇒ 构成要求 1 点名的可见差异。那条断言只读了产物字节，**没验过界面**。
//
// 本脚本分两段，各自都要证据：
//   段一（产物）：官方产物里这些类名出现在哪个函数、该函数的 props 是什么形态
//   段二（实机）：官方 app 开着 CDP 端口时，走一遍市场全流程，数 DOM 里实际有几个 chip
//
// 用法：
//   node scripts/probe-official-chip-surface.mjs            # 只跑段一
//   node scripts/probe-official-chip-surface.mjs 9224       # 段一 + 段二（官方实例端口）
//
// 判据要点：**类名在产物里存在 ≠ 该类名在界面上会被渲染。** 只有实机 DOM 计数能回答后者。
// 这正是 §26 那条断言缺的环节。

import { readFileSync } from "node:fs";

const OFFICIAL_ASAR = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
const OFFICIAL_CHUNK = "dist/renderer/assets/chunk-view-BudImuR0.js";
const CHUNK_NAMES = ["sand-plugins__chip", "sand-plugins__chips", "sand-plugins-row__byline"];

/** 解 asar header。offset 是字符串，必须走 BigInt。 */
function readAsar(asarPath) {
  const b = readFileSync(asarPath);
  const dataStart = 8 + b.readUInt32LE(4);
  const jsonLen = b.readUInt32LE(12);
  const header = JSON.parse(b.subarray(16, 16 + jsonLen).toString("utf8"));
  const resolve = (p) => {
    let node = header;
    for (const seg of p.split("/")) {
      if (!node.files || !node.files[seg]) return null;
      node = node.files[seg];
    }
    return node;
  };
  const read = (p) => {
    const node = resolve(p);
    if (!node || node.offset === undefined) return null;
    const at = Number(BigInt(dataStart) + BigInt(node.offset));
    return b.subarray(at, at + node.size).toString("utf8");
  };
  const listJs = () => {
    const out = [];
    const walk = (node, prefix) => {
      if (!node) return;
      const kids = node.files;
      if (kids && typeof kids === "object") {
        for (const k of Object.keys(kids)) walk(kids[k], prefix ? `${prefix}/${k}` : k);
        return;
      }
      if (prefix && prefix.endsWith(".js") && node.offset !== undefined) out.push(prefix);
    };
    walk(header, "");
    return out;
  };
  return { read, listJs };
}

/** 从 `function NAME(` 起做括号深度扫描切出完整函数体。 */
function sliceFunction(source, at) {
  let depth = 0;
  const bodyStart = source.indexOf("{", at);
  if (bodyStart < 0) return null;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  return null;
}

function stageOne() {
  console.log("══ 段一：官方产物里的类名归属 ══\n");
  const asar = readAsar(OFFICIAL_ASAR);
  const chunk = asar.read(OFFICIAL_CHUNK);
  if (!chunk) {
    console.log(`❌ 读不到 ${OFFICIAL_CHUNK}`);
    return null;
  }
  console.log(`${OFFICIAL_CHUNK}  ${chunk.length} B\n`);

  const results = {};
  for (const name of CHUNK_NAMES) {
    // ⚠️ 必须按**完整类名**匹配：`sand-plugins__chip` 是 `sand-plugins__chips` 的前缀，
    //    裸 indexOf 会把 `__chips` 的那次也算进 `__chip` 头上（初版就数成 3 而非 2）。
    const needle = `${name}"`;
    const hits = [];
    let i = chunk.indexOf(needle);
    while (i >= 0) {
      // 从命中点回溯到最近的具名函数 —— 锚点是属性串，不是压缩后的函数名。
      // ⚠️ 必须同时认两种形态：`function NAME(` 与 `NAME=(...)=>`（箭头函数）。
      //    只认前者会在这份产物上全部失灵（命中点都在 `ol` 的 hook 体内）。
      const head = chunk.lastIndexOf("function ", i);
      const viaFunction =
        head >= 0 ? /^function ([A-Za-z_$][\w$]*)\(/.exec(chunk.slice(head, i + 40)) : null;
      // 退路：扫描 `NAME=(` 且带 `=>` 的箭头函数定义
      let viaArrow = null;
      for (let k = i; k >= 0 && k > i - 4000; k -= 1) {
        const m2 = /([A-Za-z_$][\w$]*)=\(([^()]*)\)=>/.exec(chunk.slice(k, k + 220));
        if (m2) {
          viaArrow = m2[1];
          break;
        }
      }
      const fnName = viaFunction ? viaFunction[1] : viaArrow ?? "(未定位)";
      const fnBody = viaFunction ? sliceFunction(chunk, head) : null;
      hits.push({ at: i, fnName, fnBody, scoped: fnBody ? fnBody.indexOf(name) >= 0 : false });
      i = chunk.indexOf(needle, i + needle.length);
    }
    results[name] = hits;
    console.log(`── ${name} ── 完整串命中 ${hits.length} 次`);
    for (const h of hits) {
      if (h.fnName === "(未定位)") {
        console.log(`   @${h.at}  ⚠️ 无法回溯到具名函数 —— 抽取器失灵，不是结论`);
        continue;
      }
      console.log(`   @${h.at}  所在函数: ${h.fnName}${h.scoped ? "" : "  ⚠️ 该函数体内并未出现此名，回溯可能跨错"}`);
      if (h.fnBody && h.fnBody.length <= 700) {
        const props = /\{([^}]*)\}\s*=\s*\w/.exec(h.fnBody.slice(0, 300));
        if (props) console.log(`      props: {${props[1]}}`);
      }
      // 该处是否就是 chip 的实际渲染点？渲染点会带 `jsx("button"` 之类的元素创建。
      const around = chunk.slice(Math.max(0, h.at - 160), h.at + 160);
      const renders = /jsx[s]?\(\s*"(button|div|span)"|aria-pressed|aria-selected/.test(around);
      if (renders) {
        const tag = /jsx[s]?\(\s*"(button|div|span)"/.exec(around);
        const aria = /aria-(pressed|selected)/.exec(around);
        console.log(`      ↳ 渲染点：<${tag ? tag[1] : "?"}>${aria ? ` 带 ${aria[0]}（可点击的选中态，非静态标签）` : ""}`);
      }
    }
    console.log();
  }
  const failed = Object.values(results).flat().some((h) => h.fnName === "(未定位)" || !h.scoped);
  if (failed) {
    console.log("❌ 抽取器在本产物上未全部定位成功 —— 上面的归属不可当结论用。");
  }
  return { asar, chunk, results, detectorOk: !failed };
}

/** 段二：官方实机走一遍市场全流程，数 DOM 里实际渲染了几个 chip。 */
async function stageTwo(port) {
  console.log(`══ 段二：官方实机（CDP :${port}）chip 渲染计数 ══\n`);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  if (!target) {
    console.log("❌ 没有可用的 page target");
    return null;
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  // ⚠️ 必须给每条命令设超时。官方 app 可能被并发 agent 操作，CDP 连接会静默挂住，
  //    无超时的 `await` 会让整个脚本挂到外部 timeout（实测 300s 超时，什么也没产出）。
  //    挂住时返回 err 而不是无限等 —— 读数作废好过没有读数。
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((resolve) =>
        setTimeout(() => resolve({ err: `CDP 超时 ${ms}ms（${label}）—— 读数不采信` }), ms),
      ),
    ]);
  await withTimeout(
    new Promise((r) => {
      ws.onopen = r;
    }),
    8000,
    "连接",
  );
  const evaluate = async (expression, label = "eval") => {
    const r = await withTimeout(
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      12000,
      label,
    );
    if (r?.err) return { err: r.err };
    if (r?.exceptionDetails) return { err: `EXC ${r.exceptionDetails.text}` };
    return r?.result?.value ?? { err: "null" };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const DLG = `const d=[...document.querySelectorAll('[role="dialog"]')].find(x=>/\\u5e02\\u573a/.test(x.getAttribute("aria-label")||""));`;
  const PROBE = `(()=>{ ${DLG}
    if(!d) return {err:"市场未打开"};
    return { title:(d.querySelector("h1,h2,h3")?.textContent||"").trim(),
             hasDetail: !!d.querySelector(".sand-plugins-detail"),
             chips:[...d.querySelectorAll('[class*="chip"]')].map(c=>String(c.className).slice(0,50)),
             inputs:[...d.querySelectorAll("input")].map(i=>i.getAttribute("aria-label")||"") }; })()`;
  const show = (label, v) => {
    if (!v || v.err) {
      console.log(`[${label}] ${v?.err || "无返回"}`);
      return v;
    }
    console.log(`[${label}] title=${v.title} chips=${v.chips.length} inputs=${JSON.stringify(v.inputs)}`);
    if (v.chips.length) console.log(`      ${JSON.stringify(v.chips)}`);
    return v;
  };

  // ⚠️ 起点状态必须自证。上一版从「当前页面」接着走，结果官方窗口还停在详情页，
  //    返回点不到、`.sand-plugins-row__open` 也不存在（no btn），四段读数全是详情页的，
  //    而结论行照样打了「已自证 hasDetail=true」——**假绿**。
  //    修法：先关掉任何已开的市场弹窗（ESC），再从「打开市场」重新起步，并逐段断言页面形态。
  await evaluate(`(()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));})()`);
  await wait(1000);
  const reopened = await evaluate(`(()=>{
    const b=[...document.querySelectorAll("button,a")].filter(x=>/\\u63d2\\u4ef6|\\u5e02\\u573a|\\u8fde\\u63a5\\u5e94\\u7528/.test(x.textContent||""));
    if(!b.length) return "no-entry";
    b[0].click(); return b[0].textContent.trim().slice(0,20); })()`);
  await wait(2200);
  const L0 = show("L0 市场首页", await evaluate(PROBE));

  // 断言确实在首页（有行、无详情）
  const atHome = await evaluate(`(()=>{ ${DLG}
    if(!d) return false;
    return d.querySelectorAll(".sand-plugins-row").length > 0 && !d.querySelector(".sand-plugins-detail"); })()`);
  if (!atHome) {
    console.log("❌ 不在市场首页（可能是残留弹窗或入口没找到：" + reopened + "）—— 本段作废，请重置官方窗口后重跑。");
    ws.close();
    return null;
  }

  await evaluate(`(()=>{ ${DLG} const b=[...d.querySelectorAll("button")].find(x=>/\\u8fd4\\u56de/.test(x.textContent||"")); if(b)b.click(); })()`);
  await wait(900);
  await evaluate(`(()=>{ ${DLG} const a=[...d.querySelectorAll("a,button")].find(x=>/\\u67e5\\u770b\\u5168\\u90e8/.test(x.textContent||"")); if(a)a.click(); })()`);
  await wait(1300);
  const L1 = show("L1 类目页（点查看全部后）", await evaluate(PROBE));
  const atCategory = await evaluate(`(()=>{ ${DLG}
    if(!d) return false;
    const t=(d.querySelector("h1,h2,h3")?.textContent||"").trim();
    return t!=="\\u5e02\\u573a" && d.querySelectorAll(".sand-plugins-row").length>0; })()`);
  if (!atCategory) {
    console.log("❌ 没进类目页（返回点不到？）—— 本段作废。");
    ws.close();
    return null;
  }

  // ⚠️ 必须点 `.sand-plugins-row__open`（真正的 `<button aria-label="打开 X">`），
  //    点 `<li class="sand-plugins-row">` **不会触发**——行本身不是可点元素。
  //    这条踩过：点 li 后 hasDetail 仍为 false，一度以为详情页 chip 为 0 是有效读数。
  const opened = await evaluate(
    `(()=>{ ${DLG} const b=d.querySelector(".sand-plugins-row__open"); if(!b) return "no btn";
       b.click(); return b.getAttribute("aria-label")||"clicked"; })()`,
  );
  await wait(2000);
  console.log(`  （点开：${opened}）`);
  const L2 = show("L2 详情页", await evaluate(PROBE));
  const real = (v) => !!(v && !v.err && v.hasDetail === true);
  if (!real(L2)) {
    console.log("❌ 没进详情页（hasDetail≠true）—— L2/L2b 读数不采信，本段作废。");
    ws.close();
    return null;
  }
  await evaluate(
    `(()=>{ ${DLG} const b=[...d.querySelectorAll("button")].find(x=>/^(\\u6dfb\\u52a0|\\u5b89\\u88c5|\\u8fde\\u63a5)/.test((x.textContent||"").trim())); if(b)b.click(); })()`,
  );
  await wait(2000);
  const L2b = show("L2 详情页点「添加」后", await evaluate(PROBE));

  // 详情页探针必须自证：hasDetail 为 false 说明没进详情，那段读数不作数
  const total = (v) => (v && !v.err && Array.isArray(v.chips) ? v.chips.length : 0);
  const all = [L0, L1, L2, L2b].map(total);
  console.log();
  if (all.every((n) => n === 0)) {
    console.log("✅ 结论：官方实机市场全流程（含详情页，已自证 hasDetail=true）chip 数为 0 ——");
    console.log("   这些类名在产物里存在但界面不渲染。本地缺它们**不构成可见差异**；");
    console.log("   要求 1 点名的「分类标签」在官方界面上本就看不到。");
  } else {
    console.log(`⚠️ 结论待定：chip 计数 ${all.join("/")}，详情页有效=${real(L2)} —— 需人工复核。`);
  }
  return all;
}

const port = Number(process.argv[2]);
const one = stageOne();
if (port) {
  await stageTwo(port);
} else {
  console.log("（传端口号可加跑段二实机走查，例如：node scripts/probe-official-chip-surface.mjs 9224）");
}
