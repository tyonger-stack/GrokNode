/** Webhook routine credentials: when a routine is opened in the Routines editor, fetch its webhook
 *  credential from the host and — only when it is really webhook-triggered — present it the way the
 *  official routines UI does: a read-only "Webhook" trigger row in the trigger card, plus a credential
 *  card (URL / key / Authorization header) directly below it. The host is the authority on whether a
 *  routine is webhook-triggered, so nothing here depends on the editor's own rendering.
 *  Mounts the same way as channel-status-entry (appended to the pinned renderer chunk). */

const BLOCK_ID = "sand-webhook-credential";
const TRIGGER_ROW_ID = "sand-webhook-trigger";
const STYLE_ID = "sand-webhook-credential-style";
/** The routine editor root is the .sand-automation-detail div that owns the Name input (the pane section shares the class). */
const EDITOR_ANCHOR_SELECTOR = '.sand-automation-detail input[aria-label="Name"]';
const ROUTE_ROW_SELECTOR = "button.sand-routine__row[data-routine-row]";
const TRIGGER_CARD_SELECTOR = ".sand-trigger-card";

interface WebhookCredential {
  readonly agentId: string;
  readonly automationId: string;
  readonly url: string;
  readonly key: string;
}

let lastOpenedRoutine: { readonly id: string } | null = null;
/** True once the editor has been seen in the DOM; the click-captured routine survives intermediate
 *  list-unmount mutations and is only cleared when an open editor actually disappears again. */
let editorWasOpen = false;
let renderFrame: number | null = null;
/** Positive results only: a routine that is not webhook-triggered now may become one later. */
const credentialCache = new Map<string, WebhookCredential>();

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) != null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    `#${BLOCK_ID}{border:1px solid var(--cursor-stroke-secondary);border-radius:6px;display:flex;flex-direction:column;gap:6px;margin:10px 0 12px;padding:10px;}`,
    `#${BLOCK_ID} h3{font-size:12px;font-weight:600;margin:0;}`,
    `#${TRIGGER_ROW_ID}{align-items:center;display:flex;gap:8px;padding:4px 2px;}`,
    `#${TRIGGER_ROW_ID} svg{flex:none;opacity:0.8;}`,
    `#${TRIGGER_ROW_ID} .sand-webhook-trigger__name{font-size:13px;}`,
    `#${TRIGGER_ROW_ID} small{color:var(--cursor-text-secondary);}`,
    `#${BLOCK_ID} .sand-webhook-credential__row{align-items:center;display:flex;gap:8px;justify-content:space-between;}`,
    `#${BLOCK_ID} .sand-webhook-credential__label{color:var(--cursor-text-secondary);flex:none;font-size:11px;width:56px;}`,
    `#${BLOCK_ID} .sand-webhook-credential__value{flex:1;font-family:var(--cursor-font-mono,ui-monospace,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `#${BLOCK_ID} .sand-webhook-credential__copy{background:var(--cursor-bg-input,var(--cursor-bg-editor));border:1px solid var(--cursor-stroke-secondary);border-radius:4px;color:var(--cursor-text-primary);cursor:pointer;flex:none;font-size:11px;padding:2px 8px;}`,
    `#${BLOCK_ID} .sand-webhook-credential__hint{color:var(--cursor-text-secondary);font-size:11px;margin:0;}`,
  ].join("\n");
  document.head.append(style);
}

function trackRoutineClick(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest?.(ROUTE_ROW_SELECTOR) ?? null;
  if (row == null) return;
  const id = row.getAttribute("data-routine-row") ?? "";
  lastOpenedRoutine = id.length === 0 || id === "new" ? null : { id };
}

function copyRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "sand-webhook-credential__row";
  const labelElement = document.createElement("span");
  labelElement.className = "sand-webhook-credential__label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "sand-webhook-credential__value";
  valueElement.textContent = value;
  valueElement.title = value;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sand-webhook-credential__copy";
  button.textContent = "Copy";
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(value).then(() => {
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = "Copy"; }, 1200);
    }).catch(() => {});
  });
  row.append(labelElement, valueElement, button);
  return row;
}

function buildCredentialBlock(credential: WebhookCredential): HTMLElement {
  const block = document.createElement("div");
  block.id = BLOCK_ID;
  block.dataset.routineId = credential.automationId;
  const heading = document.createElement("h3");
  heading.textContent = "Webhook";
  const hint = document.createElement("p");
  hint.className = "sand-webhook-credential__hint";
  hint.textContent = "POST with this header to wake the routine. From inside this agent's own box, call host.docker.internal on the same port instead of 127.0.0.1.";
  block.append(heading, copyRow("URL", credential.url), copyRow("Key", credential.key), copyRow("Header", `Authorization: Bearer ${credential.key}`), hint);
  return block;
}

const TRIGGER_ROW_GLOBE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.7 3.7 2.7 6S9.8 12.3 8 14c-1.8-1.7-2.7-3.7-2.7-6S6.2 3.7 8 2z"/></svg>';

/** Read-only trigger row mirroring the official routines UI ("Webhook — when its webhook URL is called"). */
function buildTriggerRow(): HTMLElement {
  const row = document.createElement("div");
  row.id = TRIGGER_ROW_ID;
  row.setAttribute("role", "note");
  row.innerHTML = TRIGGER_ROW_GLOBE_SVG;
  const name = document.createElement("span");
  name.className = "sand-webhook-trigger__name";
  name.textContent = "Webhook";
  const detail = document.createElement("small");
  detail.textContent = "When its webhook URL is called";
  row.append(name, detail);
  return row;
}

/** The pinned trigger card has no vocabulary for webhook triggers: show the read-only webhook row and
 *  hide its "Add trigger" affordance (matching the official presentation; trigger changes for webhook
 *  routines are made by the agent through update_state, not from this editor). */
function installTriggerRow(editor: HTMLElement): void {
  const card = editor.querySelector<HTMLElement>(TRIGGER_CARD_SELECTOR);
  if (card == null) return;
  if (card.querySelector(`#${TRIGGER_ROW_ID}`) == null) card.prepend(buildTriggerRow());
  if (card.querySelector(".sand-trigger-card__row") == null) {
    const addButton = card.querySelector<HTMLButtonElement>('button[aria-label="Add trigger"], button[aria-label="Add another"]');
    if (addButton != null) addButton.style.display = "none";
  }
}

/** The credential card sits directly below the trigger card, the way the official routines UI lays it out. */
function insertCredentialBlock(editor: HTMLElement, block: HTMLElement): void {
  const card = editor.querySelector<HTMLElement>(TRIGGER_CARD_SELECTOR);
  if (card?.parentElement != null) card.insertAdjacentElement("afterend", block);
  else editor.prepend(block);
}

function editorRoot(): HTMLElement | null {
  const nameInput = document.querySelector<HTMLInputElement>(EDITOR_ANCHOR_SELECTOR);
  return nameInput?.closest<HTMLElement>(".sand-automation-detail") ?? null;
}

function scheduleRender(): void {
  if (renderFrame != null) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null;
    void renderCredentialBlock();
  });
}

async function fetchCredential(automationId: string): Promise<WebhookCredential | null> {
  const cached = credentialCache.get(automationId);
  if (cached != null) return cached;
  try {
    const credential = await window.desktop?.agent?.getAutomationWebhookCredential?.(automationId) ?? null;
    const value = credential != null && typeof credential === "object"
      && typeof (credential as { url?: unknown }).url === "string"
      && typeof (credential as { key?: unknown }).key === "string"
      ? credential as WebhookCredential
      : null;
    if (value != null) credentialCache.set(automationId, value);
    return value;
  } catch {
    return null;
  }
}

async function renderCredentialBlock(): Promise<void> {
  const editor = editorRoot();
  const routine = lastOpenedRoutine;
  if (editor == null || routine == null) return;
  const existing = document.getElementById(BLOCK_ID);
  if (existing != null && existing.dataset.routineId === routine.id) {
    installTriggerRow(editor);
    return;
  }
  existing?.remove();
  const credential = await fetchCredential(routine.id);
  if (credential == null || editorRoot() !== editor) return;
  installTriggerRow(editor);
  insertCredentialBlock(editor, buildCredentialBlock(credential));
}

function install(): void {
  ensureStyles();
  document.addEventListener("click", trackRoutineClick, true);
  const observer = new MutationObserver(() => {
    if (editorRoot() == null) {
      if (editorWasOpen) {
        lastOpenedRoutine = null;
        editorWasOpen = false;
      }
      return;
    }
    editorWasOpen = true;
    scheduleRender();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
