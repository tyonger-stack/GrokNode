import RFB from '@novnc/core/rfb.js';
import { observeFirstFrame } from './viewer-frame.js';

const configuration = JSON.parse(document.getElementById('node-viewer-config').textContent);
const target = document.getElementById('screen');
const status = document.getElementById('connection-status');
const url = new URL(configuration.socketPath, location.origin);
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const report = (type, extra = {}) => parent.postMessage({ source: 'node-agent-viewer', type, mode: configuration.mode, expiresAt: configuration.expiresAt, ...extra }, location.origin);
let disposed = false;
report('ready');
const rfb = new RFB(target, url.href);
rfb.viewOnly = configuration.mode !== 'control';
rfb.scaleViewport = true;
rfb.resizeSession = false;
const stopFrame = observeFirstFrame(rfb, dimensions => {
  if (disposed) return;
  status.hidden = true;
  report('first-frame', dimensions);
});
rfb.addEventListener('connect', () => { if (!disposed) { status.textContent = '正在接收桌面画面…'; report('connected'); } });
rfb.addEventListener('disconnect', () => {
  stopFrame();
  if (disposed) return;
  status.hidden = false; status.textContent = '桌面连接已断开，请重新打开。';
  report('disconnected');
});
rfb.addEventListener('securityfailure', () => {
  status.hidden = false; status.textContent = '桌面连接验证失败，请重新打开。';
});
function dispose() {
  if (disposed) return;
  disposed = true;
  stopFrame();
  rfb.disconnect();
  navigator.sendBeacon(new URL('close', location.href).href, '');
}
addEventListener('message', event => {
  if (event.origin === location.origin && event.source === parent && event.data?.source === 'node-agent-parent' && event.data.type === 'dispose') dispose();
});
addEventListener('pagehide', dispose, { once: true });
