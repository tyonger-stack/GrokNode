import { spawn as defaultSpawn, execFile as defaultExecFile } from 'node:child_process';
import { createServer, createConnection as defaultCreateConnection } from 'node:net';

export const APPLICATION_ID_RE = /^0x[0-9a-f]{1,16}$/;

export function normalizeApplicationId(value) {
  if (typeof value !== 'string') return null;
  const id = value.toLowerCase();
  return APPLICATION_ID_RE.test(id) ? id : null;
}

export function parseClientList(output) {
  const marker = output.indexOf('#');
  const source = marker >= 0 ? output.slice(marker + 1) : output;
  return [...source.matchAll(/0x[0-9a-f]+/gi)].map(match => match[0].toLowerCase());
}

function unquoteXprop(value) {
  if (!(value.startsWith('"') && value.endsWith('"'))) return value.trim();
  return value.slice(1, -1).replace(/\\([^0-7]|[0-7]{3})/g, (_, escape) => {
    if (/[0-7]{3}/.test(escape)) return String.fromCodePoint(Number.parseInt(escape, 8));
    return { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', s: ' ' }[escape] ?? '';
  });
}

export function parseWindowName(output) {
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^(?:_NET_WM_NAME|WM_NAME)\([^)]*\)\s*=/.test(line)) continue;
    let value = line.split('=').slice(1).join('=').trim();
    while (value.startsWith('"') && !value.endsWith('"') && i + 1 < lines.length) value += lines[++i].trim();
    return unquoteXprop(value);
  }
  return '';
}

export function parseWmctrlList(output) {
  const rows = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(0x[0-9a-f]+)\s+\S+\s+\S+\s+(.*)$/i.exec(line);
    if (match) rows.set(match[1].toLowerCase(), match[2]);
  }
  return rows;
}

export function sanitizeApplicationName(value, fallback = 'Application') {
  const text = String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const clipped = Array.from(text).slice(0, 180).join('');
  return clipped || fallback;
}

export function parseWindowTree(output) {
  const windows = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s{5}(0x[0-9a-f]+) "(.*?)":.*?\s(\d+)x(\d+)[+-]/i.exec(line);
    if (match && Number(match[3]) > 150 && Number(match[4]) > 100 && !/^(plank|picom)$/i.test(match[2])) windows.set(match[1].toLowerCase(), match[2]);
  }
  return windows;
}

function exec(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

export async function listApplications({
  display = ':1',
  execFileImpl = defaultExecFile,
  sanitize = false,
} = {}) {
  const env = { ...process.env, DISPLAY: display };
  let ids = [];
  try {
    const root = await exec(execFileImpl, 'xprop', ['-root', '_NET_CLIENT_LIST'], { env });
    ids = parseClientList(root.stdout);
  } catch {}

  let wmRows = new Map();
  if (!ids.length) {
    try {
      const wm = await exec(execFileImpl, 'wmctrl', ['-l'], { env });
      wmRows = parseWmctrlList(wm.stdout);
      ids = [...wmRows.keys()];
    } catch {}
  }

  if (!ids.length) {
    try { const tree = await exec(execFileImpl, 'xwininfo', ['-root', '-tree'], { env }); wmRows = parseWindowTree(tree.stdout); ids = [...wmRows.keys()]; } catch {}
  }

  const applications = [];
  for (const applicationId of ids.map(normalizeApplicationId).filter(Boolean)) {
    let name = wmRows.get(applicationId) ?? '';
    if (!name) {
      try {
        const props = await exec(execFileImpl, 'xprop', ['-id', applicationId, '_NET_WM_NAME', 'WM_NAME'], { env });
        name = parseWindowName(props.stdout);
      } catch {}
    }
    applications.push({ object: 'desktop.application', application_id: applicationId, name: sanitize ? sanitizeApplicationName(name, `Application ${applicationId}`) : name });
  }
  return applications;
}

async function ephemeralPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function waitForPort(port, signal = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (signal.exited) { clearInterval(timer); reject(new Error('x11vnc exited before listening')); return; }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error('x11vnc readiness timed out')); return; }
      const socket = signal.createConnection(port, '127.0.0.1');
      socket.setTimeout(250);
      socket.once('connect', () => { socket.destroy(); clearInterval(timer); resolve(); });
      socket.once('error', () => socket.destroy());
      socket.once('timeout', () => socket.destroy());
    }, 100);
  });
}

export function createApplicationPool({
  display = ':1',
  maxProcesses = 8,
  idleTtlMs = 300_000,
  absoluteTtlMs = 900_000,
  spawnImpl = defaultSpawn,
  execFileImpl = defaultExecFile,
  createConnectionImpl = defaultCreateConnection,
  portImpl = ephemeralPort,
} = {}) {
  const entries = new Map();
  const connecting = new Map();

  function remove(entry) {
    clearTimeout(entry.absoluteTimer);
    clearTimeout(entry.idleTimer);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  async function kill(entry, signal = 'SIGTERM') {
    if (entry.killing) return entry.exitPromise;
    entry.killing = true;
    remove(entry);
    entry.exitPromise = new Promise(resolve => {
      const finish = () => { clearTimeout(forceTimer); resolve(); };
      const forceTimer = setTimeout(() => {
        try { entry.child.kill('SIGKILL'); } catch {}
      }, 2000);
      forceTimer.unref();
      entry.child.once('exit', finish);
      try { entry.child.kill(signal); } catch { finish(); }
    });
    return entry.exitPromise;
  }

  async function createLane(mode, applicationId, key) {
    const current = await listApplications({ display, execFileImpl });
    if (!current.some(app => app.application_id === applicationId)) {
      throw Object.assign(new Error('Application window is no longer available'), { status: 404, code: 'application_not_found' });
    }
    const rfbport = await portImpl();
    const args = ['-display', display, '-id', applicationId, '-rfbport', String(rfbport), '-localhost', '-nopw', '-forever', '-shared', '-noxdamage'];
    if (mode === 'view') args.push('-viewonly');
    args.push('-nosel', '-noclipboard', '-nosetclipboard', '-nosetprimary');
    const child = spawnImpl('x11vnc', args, { stdio: ['ignore', 'ignore', 'ignore'] });
    const entry = {
      key, mode, applicationId, port: rfbport, child, clients: 0,
      createdAt: Date.now(), lastUsed: Date.now(), killing: false, starting: true,
      idleTimer: null, absoluteTimer: null, exitPromise: null,
    };
    entries.set(key, entry);
    let exited = false;
    const markExited = () => { exited = true; remove(entry); };
    child.once('exit', markExited);
    child.once('error', markExited);
    entry.absoluteTimer = setTimeout(() => { void kill(entry); }, absoluteTtlMs);
    entry.absoluteTimer.unref();
    try {
      await waitForPort(rfbport, { get exited() { return exited; }, createConnection: createConnectionImpl });
    } catch (error) {
      await kill(entry);
      throw error;
    }
    return entry;
  }

  async function evictIdle() {
    const idle = [...entries.values()]
      .filter(entry => entry.clients === 0 && !entry.killing && !entry.starting)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    if (!idle.length) {
      throw Object.assign(new Error('Application viewer capacity reached'), { status: 503, code: 'application_capacity' });
    }
    await kill(idle[0]);
  }

  function activeCount() {
    return new Set([...entries.keys(), ...connecting.keys()]).size;
  }

  function loadExcept(currentKey) {
    return new Set([...entries.keys(), ...connecting.keys()].filter(key => key !== currentKey)).size;
  }

  async function connect(applicationId, mode = 'view') {
    const id = normalizeApplicationId(applicationId);
    if (!id) throw Object.assign(new Error('Invalid application id'), { status: 400, code: 'application_invalid' });
    if (!['view', 'control'].includes(mode)) {
      throw Object.assign(new Error('Invalid application mode'), { status: 400, code: 'application_mode_invalid' });
    }
    const key = `${mode}:${id}`;
    const pending = connecting.get(key);
    if (pending) return finishConnect(await pending);

    const promise = (async () => {
      const existing = entries.get(key);
      if (existing && !existing.killing) {
        const current = await listApplications({ display, execFileImpl });
        if (!current.some(app => app.application_id === id)) {
          await kill(existing);
        } else {
          return existing;
        }
      }
      while (loadExcept(key) >= maxProcesses) await evictIdle();
      const entry = await createLane(mode, id, key);
      return entry;
    })();

    connecting.set(key, promise);
    try { return finishConnect(await promise); }
    finally { if (connecting.get(key) === promise) connecting.delete(key); }
  }

  function finishConnect(entry) {
    entry.starting = false;
    entry.clients += 1;
    entry.lastUsed = Date.now();
    clearTimeout(entry.idleTimer);
    let released = false;
    return {
      port: entry.port,
      mode: entry.mode,
      release() {
        if (released) return;
        released = true;
        entry.clients = Math.max(0, entry.clients - 1);
        entry.lastUsed = Date.now();
        clearTimeout(entry.idleTimer);
        if (!entry.killing && entry.clients === 0) {
          entry.idleTimer = setTimeout(() => { void kill(entry); }, idleTtlMs);
          entry.idleTimer.unref();
        }
      },
    };
  }

  return {
    connect,
    list: options => listApplications({ display, execFileImpl, sanitize: true, ...options }),
    get size() { return entries.size; },
    get pendingSize() { return connecting.size; },
    async close() { await Promise.allSettled([...entries.values()].map(entry => kill(entry))); },
  };
}
