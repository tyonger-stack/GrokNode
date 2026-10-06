import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import { createApplicationPool, listApplications, parseWindowName, parseWindowTree } from '../tools/node-agent-api/runtime/applications.mjs';

test('UTF8_STRING window titles decode octal bytes as UTF-8', () => {
  const output = String.raw`_NET_WM_NAME(UTF8_STRING) = "\347\231\276\345\272\246\344\270\200\344\270\213\357\274\214\344\275\240\345\260\261\347\237\245\351\201\223 - Google Chrome"`;
  assert.equal(parseWindowName(output), '百度一下，你就知道 - Google Chrome');
  assert.equal(parseWindowName(String.raw`WM_NAME(UTF8_STRING) = "Test \360\237\232\200"`), 'Test 🚀');
});

test('window title decoding preserves Unicode, escaped literals and legacy STRING bytes', () => {
  assert.equal(parseWindowName(String.raw`_NET_WM_NAME(UTF8_STRING) = "中文 \"title\" \\347"`), '中文 "title" \\347');
  assert.equal(parseWindowName(String.raw`WM_NAME(STRING) = "Caf\351"`), 'Café');
});

test('application discovery uses a UTF-8 locale and returns decoded Chinese titles', async () => {
  const applications = await listApplications({ display: ':5', sanitize: true, execFileImpl: (file, args, options, callback) => {
    assert.equal(options.env.DISPLAY, ':5');
    assert.equal(options.env.LC_ALL, 'C.UTF-8');
    assert.equal(file, 'xprop');
    const stdout = args[0] === '-root'
      ? '_NET_CLIENT_LIST(WINDOW): window id # 0x200004'
      : String.raw`_NET_WM_NAME(UTF8_STRING) = "\344\270\255\346\226\207 - Google Chrome"`;
    queueMicrotask(() => callback(null, stdout, ''));
  } });
  assert.deepEqual(applications, [{ object: 'desktop.application', application_id: '0x200004', name: '中文 - Google Chrome' }]);
});

test('window discovery handles native displays without a window-manager list', () => {
  const tree = '     0x1a00004 "about:blank - Google Chrome": ("google-chrome" "box-chrome")  1050x780+10+10  +10+10\n     0x200003 "Node Agent Linux project": ("xfce4-terminal" "Xfce4-terminal")  817x485+0+0  +0+0\n     0xe00003 "plank": ("plank" "Plank")  1280x137+0+663  +0+663\n     0x200001 "Xfce Terminal": ("xfce4-terminal" "Xfce4-terminal")  10x10+10+10  +10+10\n        0x200004 "child": ()  817x485+0+0';
  assert.deepEqual([...parseWindowTree(tree)], [['0x1a00004', 'about:blank - Google Chrome'], ['0x200003', 'Node Agent Linux project']]);
});
import { startDesktopProxy } from '../tools/node-agent-api/runtime/desktop-proxy.mjs';

function execFileWith(ids) {
  return (file, args, options, callback) => {
    if (file === 'xprop' && args[0] === '-root') {
      queueMicrotask(() => callback(null, `_NET_CLIENT_LIST(WINDOW): window id # ${ids.join(' ')}\n`, ''));
      return;
    }
    queueMicrotask(() => callback(new Error(file + ' ' + args.join(' ')), '', ''));
  };
}

function fakeCreateConnection() {
  const socket = new EventEmitter();
  socket.setTimeout = () => {};
  socket.destroy = () => {};
  queueMicrotask(() => socket.emit('connect'));
  return socket;
}

function unavailableCreateConnection() {
  const socket = new EventEmitter();
  socket.setTimeout = () => {};
  socket.destroy = () => {};
  queueMicrotask(() => socket.emit('error', new Error('refused')));
  return socket;
}

let fakePort = 30000;
function nextPort() { return Promise.resolve(fakePort++); }

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => queueMicrotask(() => {
    child.exitCode = 0;
    child.signalCode = signal;
    child.emit('exit', 0, signal);
  });
  return child;
}

test('application pool size is a numeric map property and rejects invalid input', async () => {
  let spawns = 0;
  const pool = createApplicationPool({
    maxProcesses: 2,
    execFileImpl: execFileWith(['0x0a000001']),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: () => { spawns += 1; return fakeChild(); },
  });
  assert.equal(pool.size, 0);
  await assert.rejects(() => pool.connect('1'), error => error.status === 400);
  await assert.rejects(() => pool.connect('0x0a000001', 'inject'), error => error.status === 400);
  assert.equal(pool.size, 0);
  assert.equal(spawns, 0);
});

test('concurrent connects for the same mode and application spawn one x11vnc process', async () => {
  let spawns = 0;
  const argsSeen = [];
  const pool = createApplicationPool({
    maxProcesses: 4,
    execFileImpl: execFileWith(['0x0a000001']),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: (binary, args) => { spawns += 1; argsSeen.push(args); return fakeChild(); },
  });
  const lanes = await Promise.all([
    pool.connect('0x0A000001', 'view'),
    pool.connect('0x0a000001', 'view'),
  ]);
  assert.equal(spawns, 1);
  assert.equal(pool.size, 1);
  assert.equal(argsSeen[0].includes('-viewonly'), true);
  lanes.forEach(lane => lane.release());
  await pool.close();
});

test('view and control lanes for one application remain separate', async () => {
  let spawns = 0;
  const argsSeen = [];
  const pool = createApplicationPool({
    maxProcesses: 4,
    execFileImpl: execFileWith(['0x0a000001']),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: (binary, args) => { spawns += 1; argsSeen.push(args); return fakeChild(); },
  });
  const view = await pool.connect('0x0a000001', 'view');
  const control = await pool.connect('0x0a000001', 'control');
  assert.equal(spawns, 2);
  assert.equal(pool.size, 2);
  assert.equal(argsSeen[0].includes('-viewonly'), true);
  assert.equal(argsSeen[1].includes('-viewonly'), false);
  assert.deepEqual([...new Set(argsSeen.flat().filter(arg => arg === '-localhost' || arg === '-nopw'))], ['-localhost', '-nopw']);
  view.release(); control.release();
  await pool.close();
});

test('capacity eviction synchronously removes an idle lane and allows reuse', async () => {
  const pool = createApplicationPool({
    maxProcesses: 1,
    execFileImpl: execFileWith(['0x0a000001', '0x0a000002']),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: fakeChild,
  });
  const first = await pool.connect('0x0a000001', 'view');
  first.release();
  const second = await pool.connect('0x0a000002', 'control');
  assert.equal(pool.size, 1);
  assert.equal(second.mode, 'control');
  second.release();
  await pool.close();
});

test('capacity fails with 503 when every lane has an active client', async () => {
  const pool = createApplicationPool({
    maxProcesses: 1,
    execFileImpl: execFileWith(['0x0a000001', '0x0a000002']),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: fakeChild,
  });
  const active = await pool.connect('0x0a000001', 'view');
  await assert.rejects(() => pool.connect('0x0a000002', 'control'), error => error.status === 503 && error.code === 'application_capacity');
  active.release();
  await pool.close();
});

test('capacity counts pending different applications and fails before spawning another listener', async () => {
  let rootCalls = 0, spawns = 0, releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const execFileImpl = (file, args, options, callback) => {
    if (file === 'xprop' && args[0] === '-root') {
      rootCalls += 1;
      queueMicrotask(() => callback(null, '_NET_CLIENT_LIST(WINDOW): window id # 0x0a000001\n', ''));
    } else if (file === 'xprop' && args[0] === '-id') {
      gate.then(() => callback(null, '_NET_WM_NAME(UTF8_STRING) = "Terminal"\n', ''));
    } else {
      queueMicrotask(() => callback(new Error('missing'), '', ''));
    }
  };
  const pool = createApplicationPool({
    maxProcesses: 1,
    execFileImpl,
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: () => { spawns += 1; return fakeChild(); },
  });
  const firstPromise = pool.connect('0x0a000001', 'view');
  await assert.rejects(pool.connect('0x0a000002', 'control'), error =>
    error.status === 503 && error.code === 'application_capacity');
  assert.equal(spawns, 0);
  assert.equal(rootCalls, 1);
  assert.equal(pool.pendingSize, 1);
  releaseGate();
  const first = await firstPromise;
  assert.equal(spawns, 1);
  first.release();
  await pool.close();
});

test('capacity does not evict a lane that is still starting', async () => {
  let spawns = 0, releaseReadiness;
  let capacityCheck;
  const readinessGate = new Promise(resolve => { releaseReadiness = resolve; });
  const gatedConnection = () => {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    readinessGate.then(() => socket.emit('connect'));
    return socket;
  };
  const pool = createApplicationPool({
    maxProcesses: 1,
    execFileImpl: execFileWith(['0x0a000001', '0x0a000002']),
    createConnectionImpl: gatedConnection,
    portImpl: nextPort,
    spawnImpl: () => {
      spawns += 1;
      if (spawns === 1) {
        queueMicrotask(() => { capacityCheck = assert.rejects(pool.connect('0x0a000002', 'control'), error => error.status === 503 && error.code === 'application_capacity'); });
      }
      return fakeChild();
    },
  });
  const firstPromise = pool.connect('0x0a000001', 'view');
  while (!capacityCheck) await new Promise(resolve => setImmediate(resolve));
  await capacityCheck;
  releaseReadiness();
  const first = await firstPromise;
  assert.equal(spawns, 1);
  assert.equal(pool.size, 1);
  first.release();
  await pool.close();
});

test('a lane that never becomes ready is killed and removed from the pool', async () => {
  const kills = [];
  const pool = createApplicationPool({
    maxProcesses: 2,
    execFileImpl: execFileWith(['0x0a000001']),
    createConnectionImpl: unavailableCreateConnection,
    portImpl: nextPort,
    spawnImpl: () => {
      const child = fakeChild();
      const kill = child.kill.bind(child);
      child.kill = signal => { kills.push(signal); return kill(signal); };
      return child;
    },
  });
  await assert.rejects(() => pool.connect('0x0a000001', 'view'), /readiness timed out/);
  assert.equal(pool.size, 0);
  assert.equal(kills.includes('SIGTERM'), true);
  await pool.close();
});

test('desktop proxy authenticates HTTP and bridges legacy desktop and scoped application RFB', async () => {
  const sockets = new Set();
  async function rfbServer() {
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.write(Buffer.from('RFB 003.008\n', 'ascii'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
      port: server.address().port,
      async close() {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      },
    };
  }
  const desktopRfb = await rfbServer(), applicationRfb = await rfbServer();
  const applicationId = '0x0a000001';
  let connectCount = 0, released = 0;
  const applicationPool = {
    async list() {
      return [{ object: 'desktop.application', application_id: applicationId, name: 'Terminal' }];
    },
    async connect(id, laneMode) {
      connectCount += 1;
      if (id !== applicationId) throw Object.assign(new Error('not found'), { status: 404, code: 'application_not_found' });
      return { port: applicationRfb.port, mode: laneMode, release() { released += 1; } };
    },
  };
  const proxy = await startDesktopProxy({
    token: 'proxy-test-token',
    port: 0,
    host: '127.0.0.1',
    desktopTarget: desktopRfb.port,
    applicationPool,
    mode: 'view',
  });
  const origin = `http://127.0.0.1:${proxy.port}`;
  const wsHeaders = { authorization: 'Bearer proxy-test-token' };
  try {
    const unauthenticated = await fetch(origin + '/applications');
    assert.equal(unauthenticated.status, 401);
    const applications = await fetch(origin + '/applications', {
      headers: { authorization: 'Bearer proxy-test-token' },
    });
    assert.equal(applications.status, 200);
    assert.deepEqual((await applications.json()).data, [
      { object: 'desktop.application', application_id: applicationId, name: 'Terminal' },
    ]);

    async function expectUpgradeRejected(url, options = {}) {
      const socket = new WebSocket(url, options.authenticate === false ? undefined : { headers: wsHeaders });
      await new Promise((resolve, reject) => {
        socket.once('open', () => reject(new Error('unexpected accepted upgrade')));
        socket.once('error', resolve);
      });
      socket.terminate();
    }
    async function readRfb(url) {
      const socket = new WebSocket(url, { headers: wsHeaders });
      const closed = new Promise(resolve => socket.once('close', resolve));
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const message = await new Promise((resolve, reject) => {
        socket.once('message', resolve);
        socket.once('error', reject);
      });
      assert.equal(Buffer.from(message).toString(), 'RFB 003.008\n');
      socket.terminate();
      await closed;
    }

    await expectUpgradeRejected(origin.replace('http:', 'ws:') + '/desktop', { authenticate: false });
    await readRfb(origin.replace('http:', 'ws:') + '/desktop');
    await readRfb(origin.replace('http:', 'ws:') + '/application/' + applicationId);
    assert.equal(connectCount, 1);
    for (let i = 0; released < 1 && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(released, 1);
    await expectUpgradeRejected(origin.replace('http:', 'ws:') + '/application/0x0a000099');
    await expectUpgradeRejected(origin.replace('http:', 'ws:') + '/application/not-a-window');
  } finally {
    await proxy.close();
    await desktopRfb.close();
    await applicationRfb.close();
  }
});

test('an existing lane is rejected when its X11 window disappears', async () => {
  let ids = ['0x0a000001'];
  const pool = createApplicationPool({
    maxProcesses: 2,
    execFileImpl: (...args) => execFileWith(ids)(...args),
    createConnectionImpl: fakeCreateConnection,
    portImpl: nextPort,
    spawnImpl: fakeChild,
  });
  const first = await pool.connect('0x0a000001', 'view');
  first.release();
  ids = ['0x0a000002'];
  await assert.rejects(() => pool.connect('0x0a000001', 'view'), error => error.status === 404);
  assert.equal(pool.size, 0);
  await pool.close();
});
