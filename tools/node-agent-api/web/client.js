export const sessionPath = id => `/v1/agents/sessions/${encodeURIComponent(id)}`;

export function capabilities(value = {}) {
  return {
    send: value.writes_enabled === true,
    sse: value.events?.sse === true,
    cancel: value.events?.cancellation === true,
    actions: value.required_actions === true || value.events?.required_actions === true,
    diff: value.project?.diff === true,
    import: value.project?.import === true,
    export: value.project?.export === true,
    view: value.desktop?.view === true,
    control: value.desktop?.control === true,
    applications: value.desktop?.applications === true,
    shared: value.environment?.isolation === 'shared_container_separate_display',
    clipboardRead: value.clipboard?.read === true,
    clipboardWrite: value.clipboard?.write === true,
  };
}

export function createClient(key, origin, fetcher = fetch) {
  key = key.trim().replace(/^Bearer\s+/i, '').trim();
  async function request(path, { method = 'GET', body, signal, headers = {} } = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) throw new Error('拒绝向其他来源发送密钥');
    const response = await fetcher(url.href, {
      method, signal, redirect: 'error', cache: 'no-store', credentials: 'same-origin',
      headers: { ...headers, Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      const error = new Error(`HTTP ${response.status} · ${value.error?.type ?? 'request_failed'} · ${value.error?.message ?? '请求失败；操作结果未知'}`);
      error.code = value.error?.type; error.status = response.status;
      throw error;
    }
    return response;
  }
  async function json(path, options) {
    const { timeoutMs = options?.method && options.method !== 'GET' ? 0 : 30000, ...extra } = options ?? {};
    const timeout = new AbortController();
    const timer = timeoutMs ? setTimeout(() => timeout.abort(new Error('连接请求超时，请检查本机 API 与 GrokNode 状态后重试。')), timeoutMs) : undefined;
    try {
      const response = await request(path, timeoutMs ? { ...extra, signal: extra.signal ? AbortSignal.any([extra.signal, timeout.signal]) : timeout.signal } : extra);
      if (response.status === 204) return {};
      return await response.json();
    } catch (error) {
      if (timeout.signal.aborted && !extra.signal?.aborted) throw timeout.signal.reason;
      if (error instanceof TypeError) throw new Error('无法连接本机 API；请检查服务是否运行，或刷新页面后重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function list(path, signal) {
    const rows = [], seen = new Set();
    let after = '';
    do {
      const url = new URL(path, origin);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const page = await json(url.href, { signal });
      if (!Array.isArray(page.data)) throw new Error('列表响应缺少 data 数组');
      rows.push(...page.data);
      if (!page.has_more) return rows;
      after = page.last_id;
      if (typeof after !== 'string' || !after || seen.has(after)) throw new Error('分页游标无效，列表可能不完整');
      seen.add(after);
    } while (!signal?.aborted);
    throw new DOMException('Aborted', 'AbortError');
  }
  return { request, json, list };
}

export async function projectDownload(client, value, sessionId, signal) {
  if (Array.isArray(value.files)) return {
    blob: new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    name: `${sessionId}-project.json`,
    message: `已收到 ${value.files.length} 个文件，已触发浏览器下载。`,
  };
  const artifact = value.artifact;
  if (!artifact || typeof artifact.download_url !== 'string' || !artifact.download_url) throw new Error('导出响应缺少 files 或 artifact.download_url，未生成下载');
  const response = await client.request(artifact.download_url, { signal });
  const blob = await response.blob();
  const name = typeof artifact.name === 'string' && artifact.name.trim()
    ? artifact.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_') : `${sessionId}-project.tar.gz`;
  return { blob, name, message: `已收到导出文件 ${name}（${blob.size} 字节），已触发浏览器下载。` };
}

export async function readSSE(response, receive) {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('服务没有返回 SSE 事件流');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], type = '', id = '';
  const line = text => {
    if (!text) {
      if (data.length) receive({ type: type || 'message', id, data: JSON.parse(data.join('\n')) });
      data = []; type = ''; id = '';
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    if (field === 'event') type = value;
    if (field === 'id' && !value.includes('\0')) id = value;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 1024 * 1024 || data.join('\n').length > 1024 * 1024) throw new Error('事件超出客户端大小限制');
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function desktopURL(value, origin) {
  if (typeof value !== 'string' || !value) throw new Error('桌面响应缺少 URL');
  const url = new URL(value, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/desktop/') || url.username || url.password) throw new Error('拒绝非同源桌面 URL');
  return url.href;
}

export function eventView(event) {
  const envelope = event.data;
  const type = envelope.type ?? event.type;
  const payload = envelope.data ?? envelope;
  const method = payload.method ?? envelope.method ?? '';
  const params = payload.params ?? envelope.params ?? payload;
  const turn = params.turn ?? {};
  const turnId = params.turn_id ?? params.turnId ?? turn.id;
  let turnStatus;
  if (method === 'turn/started' || /(?:^|\.)turn\.(?:started|running)$/.test(type)) turnStatus = 'running';
  if (method === 'turn/completed') turnStatus = turn.status ?? 'unknown';
  if (/(?:^|\.)turn\.(completed|failed|cancelled|interrupted|unknown)$/.test(type)) turnStatus = type.split('.').at(-1);
  const itemId = params.item_id ?? params.itemId ?? params.item?.id;
  const delta = typeof params.delta === 'string' ? params.delta : undefined;
  return { type, method, params, turnId, turnStatus, itemId, delta };
}
