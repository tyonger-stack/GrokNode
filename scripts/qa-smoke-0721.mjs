const BASE = process.env.GROK_NODE_QA_CDP ?? "http://127.0.0.1:9333";
const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  console.log(`${status === "PASS" ? "✔" : status === "SKIP" ? "•" : "✖"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

async function waitForEndpoint(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/json/list`);
      if (response.ok) return await response.json();
    } catch {}
    if (Date.now() > deadline) throw new Error(`CDP endpoint ${BASE} did not come up`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", (event) => reject(new Error(`CDP websocket failed: ${event.message ?? "unknown"}`)), { once: true });
  });
}

let nextId = 1;
function evaluate(socket, expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("evaluate timed out")), 30000);
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (message.error) { reject(new Error(message.error.message)); return; }
      const result = message.result?.result;
      if (message.result?.exceptionDetails) { reject(new Error(message.result.exceptionDetails.exception?.description ?? "page exception")); return; }
      resolve(result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
  });
}

async function retry(name, fn, { attempts = 18, delayMs = 10000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn(); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, delayMs)); }
  }
  throw lastError;
}

const targets = await waitForEndpoint();
const page = targets.find((entry) => entry.type === "page" && /index\.html|^file:/u.test(entry.url)) ?? targets.find((entry) => entry.type === "page");
if (!page) throw new Error("No inspectable page target");
const socket = await connect(page);

const booted = await evaluate(socket, `(()=>{const root=document.querySelector("#root");return {children:root?root.childElementCount:-1,text:(document.body?.innerText??"").trim().length};})()`);
record("window renders", booted.children > 0 && booted.text > 0 ? "PASS" : "FAIL", JSON.stringify(booted));

const surface = await evaluate(socket, `Object.keys(window.desktop??{}).sort().join(",")`);
record("preload surface", typeof surface === "string" && surface.length > 0 ? "PASS" : "FAIL", surface);
for (const group of ["vault", "tailnet", "teams", "library", "desktop0721"]) {
  const ok = await evaluate(socket, `typeof (window.desktop??{})[${JSON.stringify(group)}]==="object"`);
  record(`desktop.${group}`, ok === true ? "PASS" : "FAIL");
}

try {
  const list = await evaluate(socket, `window.desktop.vault.listGrokBotVaultCredentials()`);
  record("vault list (real IPC + encrypted store)", Array.isArray(list) ? "PASS" : "FAIL", `entries=${Array.isArray(list) ? list.length : "?"}`);
} catch (error) { record("vault list (real IPC + encrypted store)", "FAIL", String(error.message ?? error)); }

try {
  const staged = await evaluate(socket, `window.desktop.library.stageVisualizationDocument({html:"<div>qa</div>"})`);
  const ok = staged && String(staged.frameUrl ?? "").length > 0;
  record("visualization stage", ok ? "PASS" : "FAIL", JSON.stringify(staged));
} catch (error) { record("visualization stage", "FAIL", String(error.message ?? error)); }

try {
  const teams = await retry("teams", () => evaluate(socket, `window.desktop.teams.list()`), { attempts: 18, delayMs: 10000 });
  record("local teams via host (waits container rebuild)", Array.isArray(teams) ? "PASS" : "FAIL", `teams=${Array.isArray(teams) ? teams.length : "?"}`);
} catch (error) { record("local teams via host (waits container rebuild)", "FAIL", String(error.message ?? error)); }

socket.close();
const failed = results.filter((entry) => entry.status === "FAIL").length;
console.log(failed === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
