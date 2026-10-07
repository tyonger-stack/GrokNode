import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export const pattern = { width: 64, height: 48, rgba: [37, 149, 211, 255] };
export async function createRfbFixture({ delayMs = 0, stall = false } = {}) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const counters = { connections: 0, frames: 0, keyEvents: 0, pointerEvents: 0 };
  const timers = new Set();
  wss.on('connection', socket => {
    counters.connections++;
    let stage = 0, pending = Buffer.alloc(0), sent = false;
    socket.send(Buffer.from('RFB 003.008\n'));
    socket.on('message', bytes => {
      pending = Buffer.concat([pending, bytes]);
      while (pending.length) {
        let size = stage === 0 ? 12 : stage < 3 ? 1 : null;
        if (stage === 3) {
          if (pending[0] === 0) size = 20;
          else if (pending[0] === 2) size = pending.length >= 4 ? 4 + pending.readUInt16BE(2) * 4 : null;
          else if (pending[0] === 3) size = 10;
          else if (pending[0] === 4) size = 8;
          else if (pending[0] === 5) size = 6;
          else { socket.close(); return; }
        }
        if (size === null || pending.length < size) return;
        const message = pending.subarray(0, size); pending = pending.subarray(size);
        if (stage === 0) { socket.send(Buffer.from([1, 1])); stage++; }
        else if (stage === 1) { socket.send(Buffer.alloc(4)); stage++; }
        else if (stage === 2) {
          const name = Buffer.from('Known synthetic framebuffer');
          const init = Buffer.alloc(24 + name.length);
          init.writeUInt16BE(pattern.width, 0); init.writeUInt16BE(pattern.height, 2);
          init[4] = 32; init[5] = 24; init[7] = 1;
          init.writeUInt16BE(255, 8); init.writeUInt16BE(255, 10); init.writeUInt16BE(255, 12);
          init[14] = 16; init[15] = 8; init[16] = 0;
          init.writeUInt32BE(name.length, 20); name.copy(init, 24); socket.send(init); stage++;
        } else if (message[0] === 4) counters.keyEvents++;
        else if (message[0] === 5) counters.pointerEvents++;
        else if (message[0] === 3 && !sent && !stall) {
          sent = true;
          const frame = Buffer.alloc(16 + pattern.width * pattern.height * 4);
          frame[3] = 1; frame.writeUInt16BE(pattern.width, 8); frame.writeUInt16BE(pattern.height, 10);
          for (let i = 16; i < frame.length; i += 4) { frame[i] = pattern.rgba[0]; frame[i + 1] = pattern.rgba[1]; frame[i + 2] = pattern.rgba[2]; }
          const timer = setTimeout(() => { timers.delete(timer); if (socket.readyState === 1) { counters.frames++; socket.send(frame); } }, delayMs);
          timers.add(timer);
        }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: 'ws://127.0.0.1:' + server.address().port, counters, async close() { for (const timer of timers) clearTimeout(timer); for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); return { sockets: wss.clients.size, timers: timers.size }; } };
}
