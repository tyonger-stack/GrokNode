// D17 实机验收：详情页「编辑 <account> 账户」内联表单。
//
// 跑法：node scripts/verify-account-edit-form.mjs [CDP端口] [app名]
//   例：node scripts/verify-account-edit-form.mjs 9232 Gmail
// 前置：Grok Node 已启动、钥匙串已解锁、CDP 端口可连。
//
// 每段都**自证页面形态**，不符即作废并打印原因 —— 不能拿残留弹窗的读数当证据。
//
// ⚠️ 2026-10-05 更正：原先记的官方基准「点编辑前可见输入框 **1**、之后 **2**（新账户标签常驻）」
// **是错的**，本脚本据此判过「我们少渲染了一个常驻输入框」，差点改错。官方 `ve()` 逐字读出来是：
//   账户行 children = [ 展开态 ? <input BJ7R7v 重命名> : <span>文本 , button ]
//   ⇒ **未编辑时账户行里一个输入框都没有**，只有文本 span + 铅笔按钮。
//   而「新账户标签」那个 input（aria `R2hekE`、placeholder 消息 id `mwTfIH`）在**另一个块**里：
//   紧邻 `sand-plugins-detail__add-account` 按钮（`onClick:()=>y("")`）的三元另一支，
//   同级是确认按钮 `yIVrHZ`。那是「添加其他账户」表单，与编辑表单无关、也**不常驻**。
// 那个「1」几乎肯定是**探针把整个文档的 input 都数了**（市场弹窗底下那层浏览页有个搜索框，
// 本项目自己的 L0 读数就是 `visibleInputs=1`），而本脚本的 `${D}` 限定在市场弹窗内。
// ⇒ 正确基准是 **0 → 1**（编辑展开后只有重命名框）。**不要**再拿「1→2」当官方事实。
//
// 现在仍与官方有差：本项目把「重命名」与「新账户标签」两个框合进了同一个编辑表单，
// 所以实测 0 → 2。合并本身是差异，但**不是**先前误判的「少了常驻框」。
//
// 官方基准（依据：live 0.66 产物 `ve()` 逐字 + 本项目实机读数）：
//   点「编辑 <account> 账户」前：市场弹窗内可见输入框 **0**
//   点之后：表单内联展开，出现 `重命名 <account> 账户`（value=<accountKey>）
//   按钮：编辑 <account> 账户 → 保存 <account> 账户 + 移除 <account> 账户
//   role=dialog 数：恒为 0（内联展开，不是弹层）
//   chip / select：恒为 0（官方没有任何位置/分组选择器）
//
// ⚠️ 全程**只读**：不点「保存」/「移除」。那两条会改真实账户状态，不该由验收脚本做。
//     保存路径的正确性由单测守（断言必须经 window.desktop.mcp.renameAccount）。
// ⚠️ 官方 app 当前的 Gmail **没有配置账户**（`ve()` 首行 `if(o==null)return null` → 账户区空），
//     所以官方侧的 live 读数现在复现不出来；本脚本只对本地跑，基准取自官方产物而非官方实机。
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
//
// ⚠️ 这里曾经只点第一行，而第一行常常是未安装条目（实测恒落在 `Adobe Developer App Builder`），
// 于是账户区压根没渲染、读数全错，而失败信息只是「没有账户输入框」—— 把「选错了对象」
// 报成了「功能缺失」。注释写着「找一个已安装的 app」而代码没做，是最坏的一种不一致。
//
// 行内 CTA 就是安装状态（实机 44 行读数）：
//   `添加` = 未安装 ｜ `连接` = 已安装未连通 ｜ **无 CTA** = 已安装且已连通
//   例：#4 Gmail / #5 Google Calendar 无 CTA；#6 Google Drive、#7 Granola、#17 Canva、#19 Figma 是 `连接`
// 所以判据是「CTA 不是 `添加`」，而不是猜名字。第二个参数可显式指定 app 名（走 aria-label 前缀匹配）。
const wantApp = process.argv[3] ?? "";
const picked = await evaluate(`(()=>{ ${D}
  const rows=[...d.querySelectorAll("li.sand-plugins-row, .sand-plugins-row")];
  const info=rows.map((li,ix)=>{
    const open=li.querySelector(".sand-plugins-row__open");
    const name=((open?.getAttribute("aria-label")||"")+" "+(li.textContent||"")).replace(/\\u6253\\u5f00\\s*/g,"").trim();
    const cta=[...li.querySelectorAll("button,a")].map(b=>((b.textContent||"").trim()||b.getAttribute("aria-label")||"")).join("|");
    return {ix,name:name.slice(0,40),installed:!/\\u6dfb\\u52a0/.test(cta),cta:cta.slice(0,40)};
  });
  const want=${JSON.stringify(wantApp)};
  const hit= want ? info.find(x=>x.name.includes(want)) : info.find(x=>x.installed);
  if(!hit) return {err: want? ("没有匹配 "+want+" 的行") : "没有任何已安装的行"};
  const r=rows[hit.ix]; const b=r.querySelector(".sand-plugins-row__open");
  if(!b) return {err:"目标行没有 __open 按钮"};
  b.click(); return hit;
})()`);
if (picked?.err) {
  console.log("❌ " + picked.err + " —— 作废");
  process.exit(2);
}
console.log(`目标条目: ${picked.name}  (安装态判据: CTA=${picked.cta || "无"})`);
await wait(2000);
const detail = show("L2 详情页", await evaluate(PROBE));
if (!detail || detail.err || !detail.hasDetail) {
  console.log("❌ 没进详情页 —— 作废");
  process.exit(2);
}
// 前置自证：账户区存在 = 有「编辑 … 账户」按钮。
// ⚠️ 原先这里守的是「详情页应有 ≥1 个可见输入框」—— 那条来自被推翻的「1→2」基准，
//    按正确基准（编辑前 **0** 个输入框）它会把每一次合法运行都判成失败。守卫的前提本身错了。
const hasEditBtn = detail.clickables.some((c) => c.startsWith("编辑 ") && c.includes("账户"));
if (!hasEditBtn) {
  console.log("❌ 详情页没有「编辑 … 账户」按钮 —— 该条目很可能没有已配置账户（官方 ve() 在无账户时 return null）");
  console.log(`   当前可见输入框 ${detail.visibleInputs.length} 个；换一个已配置账户的 app 再试（可传第二个参数指定）`);
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
//
// 「可见输入框 0→N」里的 N 记 **2** 而不是官方基准的 1：本项目把重命名框与新账户标签框
// **合进了同一个编辑表单**，官方是拆成两个表单（编辑只有重命名框，标签框属于「添加其他账户」）。
// 这是**已知且登记在案**的差异（D19），不是误判 —— 官方那条基准是 0→1。
// 判据只钉「编辑前为 0」这一条官方与本地无争议的事实，其余按当前实现形态断言。
const checks = [
  ["编辑前市场弹窗内无可见输入框（官方账户行是文本 span，非 input）", detail.visibleInputs.length === 0],
  ["表单已展开（editForms=1）", after.editForms === 1],
  ["展开后出现 2 个输入框（本项目合并形态；官方为 1，见 D19）", after.visibleInputs.length === 2],
  ["其中含「重命名 … 账户」且 value=账户名", after.visibleInputs.some((i) => /重命名/.test(i.aria) && i.value === (editAria.replace(/^编辑\s*/, "").replace(/\s*账户$/, "")))],
  ["其中含「新账户标签」", after.visibleInputs.some((i) => /新账户标签/.test(i.aria))],
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
