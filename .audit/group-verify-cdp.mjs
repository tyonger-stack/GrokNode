const list = await (await fetch("http://127.0.0.1:9224/json/list")).json();
const page = list.find(t => t.type === "page");
if (page == null) throw new Error("no CDP page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise(resolve => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async expression => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const action = process.argv[2] ?? "state";
if (action === "state") {
  const state = await evaluate(`(() => {
    const marker = document.querySelector("[data-r-info-pane-group]");
    const pane = document.querySelector('[class*="sand-info-pane__inner"]');
    const tabs = [...document.querySelectorAll('[role=tab]')].map(b => ({ label: b.textContent, selected: b.getAttribute("aria-selected"), inBar: b.closest("#sand-info-pane-tabs") != null }));
    const members = document.querySelector(".sand-group-members-section");
    const memberRows = [...document.querySelectorAll(".sand-group-member-row")].map(r => r.textContent.slice(0, 24));
    const hidden = [...document.querySelectorAll("[data-r-tabs-hidden]")].length;
    const groupRows = [...document.querySelectorAll(".sand-group-member-row")].length;
    const authorColored = [...document.querySelectorAll(".rg0755-colors")].length;
    return { groupMarker: marker?.getAttribute("data-r-info-pane-group") ?? null, panePresent: pane != null, activeTab: pane?.getAttribute("data-r-tabs-tab") ?? null, tabs, membersSection: members != null, groupRows, memberRows, hiddenCount: hidden, authorColored };
  })()`);
  console.log(JSON.stringify(state, null, 1));
} else if (action === "click-tab") {
  const label = process.argv[3];
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("#sand-info-pane-tabs [role=tab]")].find(b => b.textContent === ${JSON.stringify(label)});
    if (btn == null) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 400));
  const after = await evaluate(`(() => {
    const pane = document.querySelector('[class*="sand-info-pane__inner"]');
    const members = document.querySelector(".sand-group-members-section");
    const visible = members != null && members.getAttribute("data-r-tabs-hidden") == null && members.getClientRects().length > 0;
    return { activeTab: pane?.getAttribute("data-r-tabs-tab"), membersVisible: visible, memberRows: [...document.querySelectorAll(".sand-group-member-row")].map(r => r.textContent.slice(0, 24)) };
  })()`);
  console.log(JSON.stringify({ clicked, ...after }, null, 1));
}
ws.close();
