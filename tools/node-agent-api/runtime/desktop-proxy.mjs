import http from 'node:http';
import net from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createApplicationPool, normalizeApplicationId } from './applications.mjs';

function constantTokenHash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : '').digest();
}

function bearerHash(req) {
  const value = req.headers.authorization;
  return constantTokenHash(typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '');
}

function authorized(req, expected) {
  const actual = bearerHash(req);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bridgeWebSocket(client, target, releaseTarget = () => {}) {
  const upstream = net.connect(target, '127.0.0.1');
  let queued = [], queuedBytes = 0, ready = false, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    client.terminate();
    upstream.destroy();
    releaseTarget();
  };
  upstream.on('connect', () => {
    ready = true;
    for (const bytes of queued) upstream.write(bytes);
    queued = [];
    queuedBytes = 0;
  });
  client.on('message', bytes => {
    if (ready && upstream.writableLength < 1024 * 1024) upstream.write(bytes);
    else if (!ready && (queuedBytes += bytes.length) <= 1024 * 1024) queued.push(bytes);
    else close();
  });
  upstream.on('data', bytes => {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 4 * 1024 * 1024) client.send(bytes);
    else close();
  });
  upstream.on('error', close);
  upstream.on('close', close);
  client.on('error', close);
  client.on('close', close);
}

export function startDesktopProxy({
  token,
  port,
  desktopTarget = 5900,
  applicationPool = createApplicationPool(),
  host = '0.0.0.0',
  mode = 'view',
} = {}) {
  if (!token || !Number.isInteger(port)) throw new Error('token and port are required');
  if (!['view', 'control'].includes(mode)) throw new Error('mode must be view or control');
  const expected = constantTokenHash(token);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const server = http.createServer(async (req, res) => {
    if (!authorized(req, expected)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'unauthorized', message: 'Desktop authorization required' } }));
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/applications') {
      try {
        const data = await applicationPool.list();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'desktop.applications', data }));
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'applications_unavailable', message: 'Window discovery failed' } }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'not_found', message: 'Route not found' } }));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const reject = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (!authorized(req, expected)) return reject('401 Unauthorized');
    if (url.pathname === '/desktop') {
      return wss.handleUpgrade(req, socket, head, client => bridgeWebSocket(client, desktopTarget));
    }
    const match = /^\/application\/([^/]+)$/.exec(url.pathname);
    const applicationId = match ? normalizeApplicationId(decodeURIComponent(match[1])) : null;
    if (!applicationId) return reject('404 Not Found');
    applicationPool.connect(applicationId, mode).then(lane => {
      wss.handleUpgrade(req, socket, head, client => bridgeWebSocket(client, lane.port, lane.release));
    }, error => {
      const status = error?.status === 400 ? '400 Bad Request'
        : error?.status === 503 ? '503 Unavailable'
        : '404 Not Found';
      reject(status);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({
      port: server.address().port,
      async close() {
        await applicationPool.close?.();
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
        await new Promise(resolve => server.close(resolve));
      },
    }));
  });
}
