import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadEmbeddedViewer({ directory = path.resolve(import.meta.dirname, '../../.lab/node-agent-viewer') } = {}) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (manifest.schema !== 1 || !/^viewer-[a-f0-9]{64}\.js$/.test(manifest.file) || typeof manifest.novncVersion !== 'string') throw new Error('Invalid embedded viewer manifest');
  const body = readFileSync(path.join(directory, manifest.file));
  if (body.length > 1024 * 1024 || 'viewer-' + createHash('sha256').update(body).digest('hex') + '.js' !== manifest.file) throw new Error('Embedded viewer checksum mismatch');
  return {
    version: manifest.novncVersion,
    asset(asset) { return asset === manifest.file ? { body, contentType: 'text/javascript; charset=utf-8', cacheControl: 'private, max-age=31536000, immutable' } : null; },
    html({ mode, expiresAt, socketPath }) {
      const socket = '/' + socketPath.replace(/^\//, '');
      if (!['view', 'control'].includes(mode) || !Number.isSafeInteger(expiresAt) || !/^\/desktop\/lane\/[A-Za-z0-9_-]+\/socket$/.test(socket)) throw new Error('Invalid embedded viewer configuration');
      const config = JSON.stringify({ mode, expiresAt, socketPath: socket }).replaceAll('<', '\\u003c');
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>机器人桌面</title><style>html,body,#screen{width:100%;height:100%;margin:0;overflow:hidden;background:#111}#screen{display:flex;align-items:center;justify-content:center}#connection-status{position:fixed;left:12px;top:12px;padding:8px;color:#ddd;background:#222;font:14px system-ui;pointer-events:none}</style></head><body><div id="screen"></div><div id="connection-status" role="status">正在连接桌面…</div><script id="node-viewer-config" type="application/json">' + config + '</script><script type="module" src="./' + manifest.file + '"></script></body></html>';
    },
  };
}
