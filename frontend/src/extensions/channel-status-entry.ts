import { normalizeOpenRouterChannelStatus, type OpenRouterChannelStatus } from "../../../source/shared/openrouter-channel-status";

const STATUS_ELEMENT_ID = "sand-openrouter-channel-status";
const STYLE_ELEMENT_ID = "sand-openrouter-channel-status-style";
const POLL_INTERVAL_MS = 20_000;

const STATUS_COPY: Record<Exclude<OpenRouterChannelStatus["state"], "ok">, string> = {
  out_of_quota: "无额度",
  rate_limited: "限流中",
  upstream_403: "上游 403",
  connection_failed: "连接失败",
  response_timeout: "响应超时",
  model_list_abnormal: "模型列表异常",
};

let latestStatus: OpenRouterChannelStatus | null = null;
let insertFrame: number | null = null;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID) != null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = [
    `#${STATUS_ELEMENT_ID}{align-items:center;display:inline-flex;gap:5px;margin-left:8px;vertical-align:middle;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;}`,
    `#${STATUS_ELEMENT_ID}:before{border-radius:999px;content:"";display:inline-block;height:7px;width:7px;}`,
    `#${STATUS_ELEMENT_ID}[data-state="out_of_quota"]{color:#f5506e;}#${STATUS_ELEMENT_ID}[data-state="out_of_quota"]:before{background:#f5506e;}`,
    `#${STATUS_ELEMENT_ID}[data-state="rate_limited"]{color:#d8921f;}#${STATUS_ELEMENT_ID}[data-state="rate_limited"]:before{background:#d8921f;}`,
    `#${STATUS_ELEMENT_ID}[data-state="upstream_403"]{color:#e46835;}#${STATUS_ELEMENT_ID}[data-state="upstream_403"]:before{background:#e46835;}`,
    `#${STATUS_ELEMENT_ID}[data-state="connection_failed"]{color:#f05252;}#${STATUS_ELEMENT_ID}[data-state="connection_failed"]:before{background:#f05252;}`,
    `#${STATUS_ELEMENT_ID}[data-state="response_timeout"]{color:#c98524;}#${STATUS_ELEMENT_ID}[data-state="response_timeout"]:before{background:#c98524;}`,
    `#${STATUS_ELEMENT_ID}[data-state="model_list_abnormal"]{color:#9b6df6;}#${STATUS_ELEMENT_ID}[data-state="model_list_abnormal"]:before{background:#9b6df6;}`,
  ].join("\n");
  document.head.append(style);
}

function removeStatusElement(): void {
  document.getElementById(STATUS_ELEMENT_ID)?.remove();
}

function localTextNodes(): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeValue?.trim() !== "Local") return NodeFilter.FILTER_SKIP;
      const element = node.parentElement;
      if (element == null || element.closest(`#${STATUS_ELEMENT_ID}`) != null) return NodeFilter.FILTER_SKIP;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_SKIP;
      if (rect.top < window.innerHeight * 0.72 || rect.left > window.innerWidth * 0.35) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode() != null) nodes.push(walker.currentNode as Text);
  return nodes;
}

function chooseLocalNode(): Text | null {
  const targetX = 72;
  const targetY = window.innerHeight - 28;
  let best: { node: Text; distance: number } | null = null;
  for (const node of localTextNodes()) {
    const rect = node.parentElement!.getBoundingClientRect();
    const distance = Math.hypot(rect.left - targetX, rect.top - targetY);
    if (best == null || distance < best.distance) best = { node, distance };
  }
  return best?.node ?? null;
}

function describeStatus(status: OpenRouterChannelStatus): string {
  const rows = [
    `OpenCodex 通道：${STATUS_COPY[status.state as Exclude<OpenRouterChannelStatus["state"], "ok">]}`,
    status.source === "chat" ? "来源：对话请求" : "来源：模型列表探测",
    `观测时间：${new Date(status.observedAt).toLocaleString()}`,
    status.httpStatus != null ? `HTTP：${status.httpStatus}` : null,
    status.latencyMs != null ? `耗时：${status.latencyMs} ms` : null,
    status.code ? `错误码：${status.code}` : null,
    status.resetAt ? `恢复时间：${new Date(status.resetAt).toLocaleString()}` : null,
    status.message ? `详情：${status.message}` : null,
  ];
  return rows.filter((row): row is string => row != null).join("\n");
}

function insertStatusElement(): void {
  insertFrame = null;
  if (latestStatus == null) {
    removeStatusElement();
    return;
  }
  const anchor = chooseLocalNode();
  if (anchor == null) return;
  const existing = document.getElementById(STATUS_ELEMENT_ID);
  const element = existing ?? document.createElement("span");
  element.id = STATUS_ELEMENT_ID;
  element.setAttribute("role", "status");
  element.dataset.state = latestStatus.state;
  element.textContent = STATUS_COPY[latestStatus.state as Exclude<OpenRouterChannelStatus["state"], "ok">];
  element.setAttribute("aria-label", `OpenCodex 通道${STATUS_COPY[latestStatus.state as Exclude<OpenRouterChannelStatus["state"], "ok">]}`);
  element.title = describeStatus(latestStatus);
  if (existing == null) anchor.after(element);
}

function scheduleInsert(): void {
  if (insertFrame != null) return;
  insertFrame = window.requestAnimationFrame(insertStatusElement);
}

async function refreshStatus(): Promise<void> {
  try {
    const value = await window.desktop?.agent?.getOpenRouterChannelStatus?.();
    const normalized = normalizeOpenRouterChannelStatus(value);
    latestStatus = normalized != null && normalized.state !== "ok" ? normalized : null;
  } catch {
    scheduleInsert();
    return;
  }
  scheduleInsert();
}

function install(): void {
  ensureStyles();
  const observer = new MutationObserver(() => {
    if (latestStatus != null) scheduleInsert();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("beforeunload", () => observer.disconnect());
  void refreshStatus();
  window.setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
