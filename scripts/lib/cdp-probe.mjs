/**
 * Minimal CDP probe helper for comparing the official Grok Bot renderer against the
 * reconstructed Grok Node renderer over the DevTools protocol.
 *
 * Both apps are Electron, so the page target exposes `Runtime.evaluate` with the
 * full DOM of the live renderer. No navigation, no mutation: `evaluate` is used
 * read-only here.
 */

const CONNECT_TIMEOUT_MS = 5000;

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CDP ${port} /json/list failed: ${response.status}`);
  return response.json();
}

export async function findPageTarget(port) {
  const targets = await listTargets(port);
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error(`CDP ${port} exposes no page target.`);
  // Prefer the renderer that actually carries the app root.
  for (const page of pages) {
    const title = page.title ?? "";
    if (/grok/i.test(title)) return page;
  }
  return pages[0];
}

export class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id == null) return;
      const entry = this.pending.get(message.id);
      if (entry == null) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result);
    });
  }

  static async open(port) {
    const target = await findPageTarget(port);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${port} websocket timed out`)), CONNECT_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP ${port} websocket error: ${event?.message ?? "unknown"}`));
      });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`CDP evaluate failed: ${detail}`);
    }
    return result.result.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}
