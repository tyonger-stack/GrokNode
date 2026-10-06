import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { ApiError, badRequest, forbidden } from './errors.mjs';
import { createRfbFilter } from './rfb-filter.mjs';
import { normalizeApplicationId } from './runtime/applications.mjs';

const nonce = () => randomBytes(32).toString('base64url');
const STYLE = '<style>#noVNC_control_bar,#noVNC_control_bar_handle,#noVNC_control_bar_anchor,#noVNC_status,.noVNC_logo{display:none!important;pointer-events:none!important;visibility:hidden!important}</style>';

function normalizeTarget(value = { type: 'desktop' }) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw badRequest('Invalid desktop target');
  if (value.type === 'desktop') {
    if (Object.keys(value).some(key => key !== 'type')) throw badRequest('Invalid desktop target');
    return { type: 'desktop', applicationId: null };
  }
  if (value.type !== 'application') throw badRequest('Invalid desktop target');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('application_id')) throw badRequest('Invalid desktop target');
  const applicationId = normalizeApplicationId(value.application_id);
  if (!applicationId) throw badRequest('Invalid application id');
  return { type: 'application', applicationId };
}

function sameEnvironment(left, right) {
  return left?.display === right?.display
    && left?.websocketUrl === right?.websocketUrl
    && left?.containerGenerationImmutableId === right?.containerGenerationImmutableId
    && (left?.applicationId ?? null) === (right?.applicationId ?? null);
}

export function createDesktop({ adapter, auth, store, governance, stateDirectory, clock = Date.now }) {
  const tickets = new Map(), viewers = new Map(), leases = new Map(), connections = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  function diagnosticReason(error) {
    const raw = error?.code ?? error?.status ?? error?.name;
    return typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,50}$/.test(raw) ? raw.toLowerCase() : 'transport_error';
  }
  async function logDiagnostic(stage, error) {
    if (!stateDirectory) return;
    try {
      await appendFile(path.join(stateDirectory, 'diagnostics.log'), JSON.stringify({ at: clock(), stage, reason: diagnosticReason(error) }) + '\n', { mode: 0o600 });
    } catch { /* Diagnostics must never break the desktop path. */ }
  }

  function disconnect(viewer) {
    if (leases.get(viewer.botId)?.id === viewer.id) leases.delete(viewer.botId);
    for (const pair of [...connections]) if (pair.viewer === viewer) {
      connections.delete(pair);
      pair.client.terminate();
      pair.upstream.terminate();
    }
  }

  function viewerCookies(req) {
    const values = [];
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name !== 'nodeviewer') continue;
      const value = rest.join('=');
      if (/^[A-Za-z0-9_-]{20,256}$/.test(value)) values.push(value);
    }
    return values;
  }

  function selectViewer(req, pathname) {
    const lane = /^\/desktop\/lane\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(pathname);
    const ids = viewerCookies(req);
    let id;
    if (lane) id = ids.find(value => value === lane[1]);
    else id = ids.find(value => viewers.get(value)?.target.type === 'desktop');
    const viewer = viewers.get(id);
    if (!viewer || viewer.expiresAt <= clock() || !auth.active(viewer.principal)) {
      if (viewer) { disconnect(viewer); viewers.delete(viewer.id); }
      throw new ApiError(401, 'viewer_expired', 'Desktop authorization expired');
    }
    if (lane && (viewer.target.type !== 'application' || viewer.id !== lane[1])) throw forbidden();
    if (!lane && viewer.target.type !== 'desktop') throw forbidden();
    return viewer;
  }

  function controls(viewer) {
    return viewer?.mode === 'control'
      && viewer.expiresAt > clock()
      && auth.active(viewer.principal)
      && leases.get(viewer.botId)?.id === viewer.id;
  }

  function socketPath(viewer) {
    return viewer.target.type === 'application'
      ? `desktop/lane/${viewer.id}/socket`
      : 'desktop/socket';
  }

  return {
    async issue(principal, session, input, origin) {
      const mode = input.mode ?? 'view', ttl = input.ttl_seconds ?? 60;
      if (!['view', 'control'].includes(mode) || !Number.isInteger(ttl) || ttl < 1 || ttl > 300) throw badRequest('Invalid desktop mode or ticket lifetime');
      auth.requireScope(principal, mode === 'control' ? 'desktop.control' : 'desktop.view', session.agent_id);
      const target = normalizeTarget(input.target);
      if (mode === 'control') {
        const held = leases.get(session.agent_id);
        if (held && controls(held)) throw new ApiError(409, 'desktop_busy', 'A controller already holds this desktop');
      }
      const environment = await adapter.desktop(session.agent_id, {
        type: target.type,
        ...(target.applicationId ? { application_id: target.applicationId } : {}),
      }, mode);
      if (!environment?.websocketUrl || (environment.applicationId ?? null) !== target.applicationId) throw new ApiError(502, 'desktop_upstream', 'Desktop upstream returned an invalid lane');
      for (const [key, ticket] of tickets) if (ticket.expiresAt <= clock()) tickets.delete(key);
      if (tickets.size >= 1000) throw new ApiError(429, 'desktop_capacity', 'Desktop ticket capacity reached');
      const expiresAt = clock() + ttl * 1000, ticket = nonce();
      tickets.set(ticket, { principal, botId: session.agent_id, sessionId: session.id, target, environment, mode, expiresAt });
      await store.append(session.id, 'node.desktop.authorization.created', { mode, target_type: target.type, expires_at: Math.floor(expiresAt / 1000) });
      return { object: 'node.desktop.authorization', agent_id: session.agent_id, mode, display: environment.display, url: `${origin}/desktop/open?ticket=${ticket}`, expires_at: Math.floor(expiresAt / 1000), single_use: true, server_enforced: true, pauses_agent: false };
    },

    async handle(req, res, url) {
      if (url.pathname === '/desktop/open' && req.method === 'GET') {
        const id = url.searchParams.get('ticket'), ticket = tickets.get(id);
        tickets.delete(id);
        if (!ticket || ticket.expiresAt <= clock() || !auth.active(ticket.principal)) throw new ApiError(401, 'ticket_invalid', 'Desktop ticket expired, invalid or already used');
        const current = await adapter.desktop(ticket.botId, {
          type: ticket.target.type,
          ...(ticket.target.applicationId ? { application_id: ticket.target.applicationId } : {}),
        }, ticket.mode);
        if (!sameEnvironment(ticket.environment, current)) throw new ApiError(409, 'desktop_changed', 'Bot desktop was reassigned; request a new authorization');
        const lease = leases.get(ticket.botId);
        if (ticket.mode === 'control' && lease && controls(lease)) throw new ApiError(409, 'desktop_busy', 'A controller already holds this desktop');
        const viewer = { ...ticket, environment: current, id: nonce(), expiresAt: clock() + 15 * 60 * 1000 };
        viewers.set(viewer.id, viewer);
        if (viewer.mode === 'control') leases.set(viewer.botId, viewer);
        if (viewer.target.type === 'application') {
          const location = `/desktop/lane/${viewer.id}/vnc.html`;
          res.writeHead(303, {
            'Set-Cookie': `nodeviewer=${viewer.id}; HttpOnly; SameSite=Strict; Path=/desktop/lane/${viewer.id}; Max-Age=900`,
            Location: location,
          });
        } else {
          res.writeHead(303, {
            'Set-Cookie': `nodeviewer=${viewer.id}; HttpOnly; SameSite=Strict; Path=/desktop; Max-Age=900`,
            Location: '/desktop/vnc.html',
          });
        }
        res.end(); return;
      }

      const viewer = selectViewer(req, url.pathname);
      if (req.method !== 'GET') throw forbidden();

      const lane = /^\/desktop\/lane\/[A-Za-z0-9_-]+(?:\/(.*))?$/.exec(url.pathname);
      const asset = lane ? (lane[1] || 'vnc.html') : url.pathname.slice('/desktop/'.length);
      if (asset === 'mandatory.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          autoconnect: true, resize: 'scale', reconnect: false,
          view_only: !controls(viewer), host: url.hostname, port: url.port,
          encrypt: url.protocol === 'https:', path: socketPath(viewer),
        }));
        return;
      }
      if (asset === 'defaults.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }

      const content = await adapter.viewerAsset(asset, viewer.botId);
      const extension = asset.split('.').at(-1);
      const type = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', json: 'application/json' }[extension];
      if (!type) throw new ApiError(404, 'not_found', 'Asset type unavailable');
      res.writeHead(200, { 'Content-Type': type });
      res.end(asset === 'vnc.html' ? Buffer.from(content).toString().replace('</head>', STYLE + '</head>') : content);
    },

    async upgrade(req, socket, head, origin) {
      let viewer, release = () => {};
      try {
        const requestUrl = new URL(req.url, origin);
        if (req.headers.host !== new URL(origin).host || req.headers.origin !== origin) throw forbidden();
        const laneSocket = /^\/desktop\/lane\/[A-Za-z0-9_-]+\/socket$/;
        if (requestUrl.pathname !== '/desktop/socket' && !laneSocket.test(requestUrl.pathname)) throw forbidden();
        viewer = selectViewer(req, requestUrl.pathname);
        const current = await adapter.desktop(viewer.botId, {
          type: viewer.target.type,
          ...(viewer.target.applicationId ? { application_id: viewer.target.applicationId } : {}),
        }, viewer.mode);
        if (!sameEnvironment(viewer.environment, current)) throw new ApiError(409, 'desktop_changed', 'Desktop reassigned');
        viewer.environment = current;
        if (governance) release = await governance.acquireStream({ id: viewer.principal.user_id ?? viewer.principal.id });
        wss.handleUpgrade(req, socket, head, client => {
          const upstream = new WebSocket(current.websocketUrl, ['binary'], { maxPayload: 4 * 1024 * 1024, headers: current.websocketHeaders ?? {} });
          const pair = { client, upstream, viewer };
          connections.add(pair);
          const filter = createRfbFilter(() => controls(viewer));
          let waiting = [], waitingBytes = 0, closed = false;
          const close = reason => {
            if (closed) return;
            closed = true;
            release();
            connections.delete(pair);
            if (leases.get(viewer.botId)?.id === viewer.id) leases.delete(viewer.botId);
            client.terminate();
            upstream.terminate();
            if (reason && reason !== 'client_closed') void logDiagnostic('upstream-transport', reason);
          };
          const ttlMs = Math.max(1, Math.min(viewer.expiresAt, viewer.principal.expiresAt) - clock());
          const timer = setTimeout(() => close(new ApiError(408, 'viewer_expired', 'Viewer expired')), ttlMs); timer.unref();
          upstream.on('open', () => { for (const message of waiting) upstream.send(message); waiting = []; waitingBytes = 0; });
          client.on('message', bytes => {
            try {
              selectViewer(req, requestUrl.pathname);
              for (const message of filter(bytes)) {
                if (upstream.readyState === WebSocket.OPEN && upstream.bufferedAmount < 1024 * 1024) upstream.send(message);
                else if (upstream.readyState === WebSocket.CONNECTING && (waitingBytes += message.length) < 1024 * 1024) waiting.push(message);
                else close(new ApiError(502, 'transport_error', 'Desktop transport unavailable'));
              }
            } catch (error) { close(error); }
          });
          upstream.on('message', (bytes, binary) => {
            if (auth.active(viewer.principal) && viewer.expiresAt > clock() && client.readyState === WebSocket.OPEN && client.bufferedAmount < 4 * 1024 * 1024) client.send(bytes, { binary });
            else close(new ApiError(408, 'viewer_expired', 'Viewer expired'));
          });
          client.on('close', () => { clearTimeout(timer); close('client_closed'); });
          upstream.on('close', () => { clearTimeout(timer); close(new ApiError(502, 'transport_closed', 'Desktop transport closed')); });
          client.on('error', error => { clearTimeout(timer); close(error); });
          upstream.on('error', error => { clearTimeout(timer); close(error); });
        });
      } catch (error) {
        release();
        if (error instanceof ApiError && error.status !== 401 && error.status !== 403) await logDiagnostic('desktop-upgrade', error);
        const status = error instanceof ApiError ? error.status : 500;
        const reason = status === 409 ? 'Conflict' : status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Internal Server Error';
        socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
      }
    },

    revokeKey(id) {
      for (const [key, viewer] of [...viewers]) {
        if (viewer.principal.id === id || !auth.active(viewer.principal)) {
          disconnect(viewer); viewers.delete(key);
        }
      }
    },
    hasControl(principal, session) {
      const lease = leases.get(session.agent_id);
      return !!lease && lease.principal.id === principal.id && controls(lease);
    },
    closeSession(id) {
      const botId = store.get(id)?.agent_id;
      if (!botId) return;
      for (const [ticket, value] of [...tickets]) if (value.botId === botId) tickets.delete(ticket);
      for (const [key, viewer] of [...viewers]) if (viewer.botId === botId) { disconnect(viewer); viewers.delete(key); }
    },
    handback(principal, session) {
      auth.requireScope(principal, 'desktop.control', session.agent_id);
      const lease = leases.get(session.agent_id);
      if (lease && principal.id !== 'owner' && lease.principal.id !== principal.id) throw forbidden();
      if (lease) { disconnect(lease); viewers.delete(lease.id); }
      return { released: true };
    },
    close() {
      for (const viewer of [...viewers.values()]) disconnect(viewer);
      tickets.clear(); viewers.clear(); wss.close();
    },
  };
}
