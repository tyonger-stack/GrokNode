// D17 实机验收：详情页「编辑 <account> 账户」内联表单。
//
// 跑法：node scripts/verify-account-edit-form.mjs 9232
// 前置：Grok Node 已启动、钥匙串已解锁、CDP 端口可连。
//
// 每段都**自证页面形态**，不符即作废并打印原因 —— 不能拿残留弹窗的读数当证据。
// 官方基准（live 0.66，已安装 Gmail）：
//   点「编辑 default 账户」前：可见输入框 1
//   点之后：                可见输入框 2（多出 `重命名 default 账户`，value=default）
//   按钮：编辑 default 账户 → 保存 default 账户 + 移除 default 账户
//   role=dialog 数：恒为 0（内联展开，不是弹层）
//   chip / select：恒为 0（官方没有任何位置/分组选择器）
//
// ⚠️ 全程**只读**：不点「保存」/「移除」。那两条会改真实账户状态，不该由验收脚本做。
//     保存路径的正确性由单测守（断言必须经 window.desktop.mcp.renameAccount）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 9232);
const D = `const d=[...document.querySelectorAll('[role="dialog"]')].find(x=>/\\u5e02\\u573a/.test(x.getAttribute("aria-label")||""));`;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === "page");
if (!target) {
  console.log(`❌ :${port} 没有可用的 page target —— app 是否已启动并解锁？`);
  process.exit(2);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => {
  ws.onopen = r;
});
let id = 0;
const pend = new Map();
const send = (m, p) =>
  new Promise((r) => {
    const i = ++id;
    pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m.result);
    pend.delete(m.id);
  }
};
const evaluate = async (expression) => {
  const r = await Promise.race([
    send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
    new Promise((res) => setTimeout(() => res({ err: "CDP 超时" }), 12000)),
  ]);
  if (r?.err) return { err: r.err };
  if (r?.exceptionDetails) return { err: `EXC ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` };
  return r?.result?.value ?? { err: "null" };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(()=>{ ${D}
  if(!d) return { err: "市场弹窗未打开" };
  return {
    hasDetail: !!d.querySelector(".sand-plugins-detail"),
    title: (d.querySelector("h1,h2,h3")?.textContent || "").trim(),
    rows: d.querySelectorAll(".sand-plugins-row").length,
    dialogs: d.querySelectorAll('[role="dialog"]').length,
    chips: d.querySelectorAll('[class*="chip"]').length,
    selects: d.querySelectorAll("select").length,
    editForms: d.querySelectorAll("[data-account-edit-form]").length,
    visibleInputs: [...d.querySelectorAll("input")].filter((i) => i.offsetWidth || i.offsetHeight)
      .map((i) => ({ aria: i.getAttribute("aria-label") || "", value: i.value, ph: i.placeholder })),
    clickables: [...d.querySelectorAll("button, a")].map(
      (b) => b.getAttribute("aria-label") || (b.textContent || "").trim().replace(/\\s+/g, " ")).filter(Boolean),
  };
})()`;

const show = (label, v) => {
  if (!v || v.err) {
    console.log(`[${label}] ${v?.err || "无返回"} → 本段作废`);
    return v;
  }
  console.log(`[${label}] title=${v.title} rows=${v.rows} hasDetail=${v.hasDetail} ` +
    `dialogs=${v.dialogs} editForms=${v.editForms} chips=${v.chips} selects=${v.selects} ` +
    `visibleInputs=${v.visibleInputs.length}`);
  return v;
};

// 起点：先关掉任何已开的市场弹窗，避免从残留状态接着走。
await evaluate(`(()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));})()`);
await wait(1000);
const opened = await evaluate(`(()=>{
  const b=[...document.querySelectorAll("button,a")].filter(x=>/\\u63d2\\u4ef6|\\u5e02\\u573a|\\u8fde\\u63a5\\u5e94\\u7528/.test(x.textContent||""));
  if(!b.length) return "no-entry";
  b[0].click(); return b[0].textContent.trim().slice(0,16); })()`);
await wait(2200);
const home = show("L0 市场首页", await evaluate(PROBE));
if (home?.err || home.rows === 0) {
  console.log("❌ 不在市场首页（入口：" + opened + "）—— 作废");
  process.exit(2);
}

// 找一个**已安装**的 app：账户区只在已装时渲染。
await evaluate(`(()=>{ ${D} const r=d.querySelector(".sand-plugins-row__open"); if(r)r.click(); })()`);
await wait(2000);
const detail = show("L2 详情页", await evaluate(PROBE));
if (!detail || detail.err || !detail.hasDetail) {
  console.log("❌ 没进详情页 —— 作废");
  process.exit(2);
}
if (detail.visibleInputs.length === 0) {
  console.log("❌ 该条目没有账户输入框 —— 多半未安装，换一个已装的 app 再试");
  process.exit(2);
}

// 点「编辑 <account> 账户」—— 该按钮 textContent 为空，文案只在 aria-label 上。
const editAria = (detail.clickables.find((c) => c.startsWith("编辑 ") && c.includes("账户")) ?? "");
const clicked = await evaluate(`(()=>{ ${D}
  const b=[...d.querySelectorAll("button,a")].find(x=>x.getAttribute("aria-label")===${JSON.stringify(editAria)});
  if(!b) return "按钮不存在"; b.click(); return "已点"; })()`);
await wait(1800);
const after = show(`点「${editAria}」后`, await evaluate(PROBE));

// 判定
const checks = [
  ["表单已展开（editForms=1）", after.editForms === 1],
  ["可见输入框 1→2", detail.visibleInputs.length === 1 && after.visibleInputs.length === 2],
  ["新增的是「重命名 … 账户」", after.visibleInputs.some((i) => /重命名/.test(i.aria))],
  ["未弹出独立 dialog（内联）", after.dialogs === detail.dialogs],
  ["无 chip 选择器（官方 chip=0）", after.chips === 0],
  ["无 select 选择器（官方 select=0）", after.selects === 0],
  ["出现「保存 … 账户」", after.clickables.some((c) => c.startsWith("保存 "))],
  ["出现「移除 … 账户」", after.clickables.some((c) => c.startsWith("移除 "))],
];
console.log();
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (ok) pass += 1;
}
console.log(`\n${pass === checks.length ? "✅ D17 实机验收通过" : `⚠️ ${pass}/${checks.length} 项不符 —— 见上方读数`}（点击=${clicked}）`);
ws.close();
process.exit(pass === checks.length ? 0 : 1);
