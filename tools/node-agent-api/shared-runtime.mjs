import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, chmod, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { ApiError } from './errors.mjs';
import { createGrokNodeAdapter } from './grok-node.mjs';
import { privateDirectory, resourceNames } from './runtime/common.mjs';
import { projectProgram } from './runtime/project.mjs';
import { listApplications, normalizeApplicationId } from './runtime/applications.mjs';
import { applicationStreamProgram } from './application-stream.mjs';
import { clipboardProgram } from './clipboard-x11.mjs';
import { createSnapshotBridge } from './snapshot-bridge.mjs';

const executeDefault = promisify(execFile);
const preparation = String.raw`const fs=require('fs'),path=require('path');const p=process.argv[1];for(const dir of ['/home/box/sand-data/node-agent-api','/home/box/sand-data/node-agent-api/executor-home',p]){let cur='/';for(const part of dir.split('/').filter(Boolean)){cur=path.join(cur,part);try{if(fs.lstatSync(cur).isSymbolicLink())throw Error('Unsafe directory')}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(cur)}}}if(fs.existsSync('/home/box/sand-data/node-agent-api/executor-home/auth.json'))throw Error('Executor credentials must be absent');try{fs.readFileSync('/root/.codex/auth.json');throw Error('Mac credentials exposed')}catch(e){if(!['EACCES','ENOENT'].includes(e.code))throw e}console.log('executor_private_home_ready');`;
export async function createSharedRuntime({ container = 'grok-node-local-vm', stateRoot, namespace = 'grok-node-lab-shared', workspaceRoot = '/workspace/codex-projects/node-agent-api', docker = '/usr/local/bin/docker', execute = executeDefault, spawnProcess = spawn, spawnSnapshot = execute === executeDefault ? spawnProcess : null } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container) || !/^\/workspace\/[A-Za-z0-9_./-]+$/.test(workspaceRoot) || workspaceRoot.split('/').includes('..')) throw new Error('Invalid shared runtime configuration');
  await privateDirectory(stateRoot);
  let snapshots;
  const bridge = createGrokNodeAdapter({ container, execute, docker, ...(spawnSnapshot ? { readSnapshot: (id, row) => snapshots.read(id, row) } : {}) });
  const codePath = '/home/box/sand-data/codex-vm/bin/codex', executorHome = '/home/box/sand-data/node-agent-api/executor-home';
  const viewerToken = randomBytes(32).toString('hex'), children = new Set(), sockets = new Set(), clipboardOwners = new Map();
  let closed = false;
  const viewerAssets = new Map(), assetRequests = new Map(), desktopPreparations = new Map(), executorPreparations = new Map();
  let assetBytes = 0, assetBatchScheduled = false;
  async function info() {
    try {
      if (closed) throw new Error('Runtime closed');
      const row = JSON.parse((await execute(docker, ['inspect', container], { timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' })).stdout)[0];
      if (closed || row.Name !== '/' + container || !row.State?.Running || typeof row.Id !== 'string' || !row.Id || typeof row.State.StartedAt !== 'string' || !row.State.StartedAt) throw new Error('Container unavailable');
      snapshots?.observe(row);
      return row;
    }
    catch { snapshots?.observe(null); throw new ApiError(503, 'execution_unavailable', 'Open GrokNode and its existing box; the API will not start or replace it'); }
  }
  const lowPrivilege = (id, args, interactive = false) => ['exec', ...(interactive ? ['-i'] : []), id, 'setpriv', '--reuid=box', '--regid=box', '--init-groups', '--bounding-set=-all', '--no-new-privs', '/usr/bin/env', '-i', 'HOME=' + executorHome, 'CODEX_HOME=' + executorHome, 'PATH=/usr/local/bin:/usr/bin:/bin', ...args];
  if (spawnSnapshot) snapshots = createSnapshotBridge({ docker, spawnSnapshot, argsFor: lowPrivilege });
  async function boxAt(id, args, options = {}) { try { return await execute(docker, lowPrivilege(id, args), { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...options }); } catch { throw new ApiError(502, 'execution_failed', 'Shared Linux operation failed'); } }
  async function box(args, options = {}) { return boxAt((await info()).Id, args, options); }
  async function seat(botId, prepare = false) {
    const row = await info();
    let environment;
    try { environment = await bridge.snapshot(botId, row.Id, row); }
    catch (error) {
      if (!prepare || error.code !== 'desktop_unavailable') throw error;
      const key = JSON.stringify([row.Id, row.State.StartedAt, botId]);
      if (!desktopPreparations.has(key)) {
        const pending = (async () => {
          try { return await bridge.snapshot(botId, row.Id, row); }
          catch (current) { if (current.code !== 'desktop_unavailable') throw current; }
          await bridge.gateway('ensureForeverBox', { id: botId }, row.Id);
          return bridge.snapshot(botId, row.Id, row);
        })();
        desktopPreparations.set(key, pending);
        pending.finally(() => { if (desktopPreparations.get(key) === pending) desktopPreparations.delete(key); }).catch(() => {});
      }
      environment = await desktopPreparations.get(key);
    }
    if (snapshots) {
      const after = await info();
      if (after.Id !== row.Id || after.State.StartedAt !== row.State.StartedAt) throw new ApiError(409, 'desktop_changed', 'Bot desktop generation changed');
    }
    if (closed) throw new ApiError(503, 'execution_unavailable', 'Shared runtime is closed');
    return { ...environment, containerId: row.Id, containerStartedAt: row.State.StartedAt };
  }
  async function applications(botId, environment) {
    environment ??= await seat(botId);
    return listApplications({ display: ':' + environment.display, sanitize: true, execFileImpl: (file, args, options, callback) => {
      boxAt(environment.containerId, ['env', 'DISPLAY=:' + environment.display, 'LC_ALL=' + options.env.LC_ALL, file, ...args], { timeout: 10000 }).then(result => callback(null, result.stdout, result.stderr), callback);
    } });
  }
  function status(environment) { return { running: true, exists: true, containerName: container, containerId: environment.containerId, containerStartedAt: environment.containerStartedAt, assignmentRevision: environment.assignmentRevision, display: environment.display, workspaceRoot, transport: 'stdio' }; }
  function trimAssets() {
    while (viewerAssets.size > 128 || assetBytes > 16 * 1024 * 1024) {
      const key = viewerAssets.keys().next().value;
      assetBytes -= viewerAssets.get(key).size; viewerAssets.delete(key);
    }
  }
  async function loadAssetBatch() {
    const batch = new Map(assetRequests); assetRequests.clear(); assetBatchScheduled = false;
    try {
      const row = await info();
      // Generation comes from the already-required inspect: container ID +
      // StartedAt + image digest. noVNC bytes are package-owned and change only
      // with the image/container lifecycle, so warm hits cost zero extra execs.
      // Stopped containers reject in info() and never serve cached bytes.
      const generation = JSON.stringify([row.Id, row.State.StartedAt, row.Image ?? row.Config?.Image ?? null]);
      for (const [asset, request] of batch) {
        const key = generation + '\n' + asset;
        let cached = viewerAssets.get(key);
        if (!cached) {
          cached = { size: 0, pending: null };
          const record = cached;
          record.pending = execute(docker, ['exec', row.Id, 'cat', '/usr/share/novnc/' + asset], { encoding: null, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }).then(result => {
            const bytes = result.stdout;
            if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new ApiError(404, 'not_found', 'Asset unavailable');
            if (viewerAssets.get(key) === record) { record.size = bytes.length; assetBytes += record.size; trimAssets(); }
            return bytes;
          });
          viewerAssets.set(key, record); trimAssets();
          record.pending.catch(() => { if (viewerAssets.get(key) === record) { assetBytes -= record.size; viewerAssets.delete(key); } });
        } else { viewerAssets.delete(key); viewerAssets.set(key, cached); }
        cached.pending.then(request.resolve, request.reject);
      }
    } catch (error) { for (const request of batch.values()) request.reject(error); }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const server = createServer((_req, res) => { res.writeHead(401); res.end(); });
  server.on('upgrade', (req, socket, head) => { void (async () => {
    try {
      if (closed || req.headers.authorization !== 'Bearer ' + viewerToken) throw new Error('Unauthorized');
      const parts = new URL(req.url, 'http://localhost').pathname.split('/');
      if (parts.length !== 6 || parts[1] !== 'application' || !['view', 'control'].includes(parts[5])) throw new Error('Invalid lane');
      const botId = decodeURIComponent(parts[2]), display = Number(parts[3]), id = normalizeApplicationId(parts[4]);
      const current = await seat(botId); if (!id || display !== current.display || !(await applications(botId, current)).some(app => app.application_id === id)) throw new Error('Stale lane');
      wss.handleUpgrade(req, socket, head, client => {
        sockets.add(client);
        const child = spawnProcess(docker, lowPrivilege(current.containerId, ['node', '-e', applicationStreamProgram, '--', botId, String(display), id, parts[5]], true), { stdio: ['pipe', 'pipe', 'ignore'] }); children.add(child);
        let ended = false;
        const end = () => { if (ended) return; ended = true; sockets.delete(client); children.delete(child); child.stdin.end(); child.kill('SIGTERM'); client.terminate(); };
        client.on('message', data => { if (child.stdin.writableLength > 1024 * 1024) end(); else child.stdin.write(data); });
        child.stdout.on('data', data => { if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 4 * 1024 * 1024) client.send(data); else end(); });
        child.on('exit', end); child.on('error', end); child.stdin.on('error', end); client.on('close', end); client.on('error', end);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  })(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'ws://127.0.0.1:' + server.address().port;
  const runtime = {
    shared: true, workspaceRoot, roster: bridge, applications,
    async validateDesktop(botId, previousEnvironment) {
      const current = await seat(botId);
      if (previousEnvironment && (previousEnvironment.agent_id !== botId || ['containerId', 'containerStartedAt', 'assignmentRevision', 'display'].some(key => current[key] !== previousEnvironment[key]))) throw new ApiError(409, 'desktop_changed', 'Bot desktop generation changed');
      if (previousEnvironment?.applicationId && !(await applications(botId, current)).some(app => app.application_id === previousEnvironment.applicationId)) throw new ApiError(404, 'application_not_found', 'Application is no longer on this bot desktop');
      return current;
    },
    async validateExecutor(botId) { const environment = await seat(botId); return { containerId: environment.containerId, containerStartedAt: environment.containerStartedAt, assignmentRevision: environment.assignmentRevision, display: environment.display }; },
    async viewerAsset(asset) {
      if (!/^(vnc\.html|package\.json|(?:app|core|vendor)\/[A-Za-z0-9_./-]+)$/.test(asset) || asset.split('/').includes('..')) throw new ApiError(404, 'not_found', 'Asset unavailable');
      if (assetRequests.has(asset)) return assetRequests.get(asset).pending;
      if (assetRequests.size >= 128) throw new ApiError(503, 'asset_capacity', 'Viewer asset batch is full');
      const request = {};
      request.pending = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
      assetRequests.set(asset, request);
      if (!assetBatchScheduled) { assetBatchScheduled = true; setImmediate(() => { void loadAssetBatch(); }); }
      return request.pending;
    },
    async launchApplication(botId, kind) {
      if (!['terminal', 'browser'].includes(kind)) throw new ApiError(400, 'application_kind', 'Choose terminal or browser');
      const environment = await seat(botId);
      const program = 'const fs=require("fs"),{spawn}=require("child_process");const [id,d,kind,cwd,home]=process.argv.slice(1),s=JSON.parse(fs.readFileSync("/home/box/.sand-window-assignments.json","utf8"));if(s.assignments[id]!==Number(d))process.exit(2);const child=spawn(kind==="terminal"?"xfce4-terminal":"google-chrome",kind==="terminal"?["--disable-server","--working-directory",cwd,"--title","Node Agent Linux project"]:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--class=box-chrome","--user-data-dir="+home+"/chrome-"+d,"--new-window","about:blank"],{cwd,env:{...process.env,DISPLAY:":"+d},stdio:"ignore",detached:true});child.on("error",()=>process.exit(3));child.unref();console.log(JSON.stringify({launched:true,kind,display:Number(d)}));';
      return JSON.parse((await box(['node', '-e', program, '--', botId, String(environment.display), kind, workspaceRoot, executorHome])).stdout);
    },
    async status(botId) { return status(await seat(botId)); },
    async ensure(botId) {
      const environment = await seat(botId, true);
      const key = JSON.stringify([environment.containerId, environment.containerStartedAt, environment.assignmentRevision]);
      if (executorPreparations.get(botId)?.key !== key) {
        const pending = (async () => {
          const version = await boxAt(environment.containerId, [codePath, '--version']);
          if (version.stdout.trim() !== 'codex-cli 0.160.0') throw new ApiError(409, 'codex_version', 'Install the already-authorized Codex 0.160.0 execution package; automatic upgrades are disabled');
          await boxAt(environment.containerId, ['node', '-e', preparation, workspaceRoot]);
        })();
        const record = { key, pending }; executorPreparations.set(botId, record);
        pending.catch(() => { if (executorPreparations.get(botId) === record) executorPreparations.delete(botId); });
      }
      await executorPreparations.get(botId).pending;
      return status(environment);
    },
    async descriptor(botId) {
      const environment = await seat(botId), row = { Id: environment.containerId };
      const args = ['exec', '--workdir', workspaceRoot, '-i', row.Id, 'setpriv', '--reuid=box', '--regid=box', '--init-groups', '--bounding-set=-all', '--no-new-privs', '/usr/bin/env', '-i', 'HOME=' + executorHome, 'CODEX_HOME=' + executorHome, 'DISPLAY=:' + environment.display, 'PATH=/usr/local/bin:/usr/bin:/bin', codePath, 'exec-server', '--listen', 'stdio'];
      return { version: 1, namespace, environments: [{ botId, containerName: container, containerId: row.Id, display: environment.display, workspaceRoot, program: docker, args, transport: 'stdio' }] };
    },
    async desktop(botId, target = { type: 'desktop' }, mode = 'view', options = { prepare: false }) {
      const environment = await seat(botId, options.prepare === true); let applicationId = null;
      if (target.type === 'application') { applicationId = normalizeApplicationId(target.application_id); if (!applicationId || !(await applications(botId, environment)).some(app => app.application_id === applicationId)) throw new ApiError(404, 'application_not_found', 'Application is no longer on this bot desktop'); }
      const websocketUrl = applicationId ? `${origin}/application/${encodeURIComponent(botId)}/${environment.display}/${applicationId}/${mode}` : environment.websocketUrl;
      return { ...environment, type: 'grok_node_codex', target: { type: target.type, application_id: applicationId }, applicationId, containerGenerationImmutableId: environment.containerId, workspaceRoot, websocketUrl, ...(applicationId ? { websocketHeaders: { authorization: 'Bearer ' + viewerToken } } : {}) };
    },
    async project(botId, action, input = {}) { await bridge.requireAgent(botId); return JSON.parse((await box(['node', '-e', projectProgram, '--', action, JSON.stringify(input), workspaceRoot])).stdout); },
    async approvedShell(botId, command) { await bridge.requireAgent(botId); if (typeof command !== 'string' || !command.trim() || command.length > 8192) throw new ApiError(400, 'invalid_command', 'Invalid command'); const program = 'const r=require("child_process").spawnSync("/bin/bash",["-lc",process.argv[1]],{cwd:process.argv[2],encoding:"utf8",timeout:15000,maxBuffer:1048576,env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:process.argv[3],DISPLAY:process.argv[4]}});console.log(JSON.stringify({exit_code:r.status,stdout:r.stdout??"",stderr:r.stderr??"",timed_out:r.error?.code==="ETIMEDOUT"}));'; const row = await info(), environment = await seat(botId); const args = ['exec', row.Id, 'setpriv', '--reuid=box', '--regid=box', '--init-groups', '--bounding-set=-all', '--no-new-privs', 'node', '-e', program, '--', command, workspaceRoot, executorHome, ':' + environment.display]; try { return JSON.parse((await execute(docker, args, { encoding: 'utf8', timeout: 20000 })).stdout); } catch { throw new ApiError(502, 'execution_failed', 'Approved Linux command failed'); } },
    clipboard: {
      async read(botId) { const environment = await seat(botId); return JSON.parse((await box(['python3', '-c', clipboardProgram, ':' + environment.display, 'read'])).stdout).text; },
      async write(botId, text) {
        if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new ApiError(400, 'clipboard_limit', 'Invalid clipboard text');
        const environment = await seat(botId), row = await info(), previous = clipboardOwners.get(botId);
        if (previous) { previous.stdin.end(); previous.kill('SIGTERM'); }
        const child = spawnProcess(docker, lowPrivilege(row.Id, ['python3', '-c', clipboardProgram, ':' + environment.display, 'write', text], true), { stdio: ['pipe','pipe','ignore'] });
        children.add(child); clipboardOwners.set(botId, child); child.once('exit', () => { children.delete(child); if (clipboardOwners.get(botId) === child) clipboardOwners.delete(botId); }); child.stdin.on('error', () => {});
        await new Promise((resolve, reject) => { let output=''; const timer=setTimeout(()=>{child.stdin.end();child.kill();reject(new ApiError(502,'clipboard_failed','Clipboard writer timed out'));},5000); child.stdout.on('data', bytes=>{output+=bytes.toString();if(output.includes('"written": true')){clearTimeout(timer);resolve();}});child.once('error',()=>{clearTimeout(timer);reject(new ApiError(502,'clipboard_failed','Clipboard writer unavailable'));});child.once('exit',()=>{if(!output.includes('"written": true')){clearTimeout(timer);reject(new ApiError(502,'clipboard_failed','Clipboard writer failed'));}}); });
      },
    },
    async exportProject(botId, destination) {
      await this.project(botId, 'inventory'); const row = await info(), archive = '/tmp/node-agent-export-' + randomBytes(12).toString('hex') + '.tgz';
      await box(['bash', '-c', 'umask 077; exec tar -czf "$1" -C "$2" .', 'node-agent-export', archive, workspaceRoot]);
      try { await execute(docker, ['cp', row.Id + ':' + archive, destination], { timeout: 30000 }); await chmod(destination, 0o600); } finally { await box(['rm', '--', archive]); }
      return { path: destination, size: (await lstat(destination)).size };
    },
    async backup(botId) {
      const n = resourceNames(namespace, botId), destination = await privateDirectory(path.join(stateRoot, namespace, n.key, 'backups', Date.now() + '-' + randomBytes(4).toString('hex')));
      await this.exportProject(botId, path.join(destination, 'workspace.tgz'));
      await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ container, workspaceRoot, sha256: createHash('sha256').update(await readFile(path.join(destination, 'workspace.tgz'))).digest('hex') }), { mode: 0o600 });
      return { path: destination, consistency: 'shared project live files; GrokNode processes are not paused' };
    },
    async restore(botId, backupPath) {
      const n = resourceNames(namespace, botId); let directory; try { directory = await realpath(backupPath); } catch { throw new ApiError(404, 'backup_not_found', 'Backup not found'); } const prefix = path.resolve(stateRoot, namespace, n.key, 'backups') + path.sep;
      if (!directory.startsWith(prefix)) throw new ApiError(403, 'backup_owner', 'Backup is outside this session runtime');
      let manifest, archive; try { manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')); archive = path.join(directory, 'workspace.tgz'); await lstat(archive); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, 'backup_not_found', 'Backup not found'); }
      if (manifest.container !== container || manifest.workspaceRoot !== workspaceRoot || createHash('sha256').update(await readFile(archive)).digest('hex') !== manifest.sha256) throw new ApiError(409, 'backup_invalid', 'Backup identity or integrity mismatch');
      await this.backup(botId); const row = await info(), remote = '/tmp/node-agent-restore-' + randomBytes(12).toString('hex') + '.tgz';
      await execute(docker, ['cp', archive, row.Id + ':' + remote]);
      await execute(docker, ['exec', row.Id, 'chown', 'box:box', remote]);
      await execute(docker, ['exec', row.Id, 'chmod', '600', remote]);
      try { await box(['tar', '-xzf', remote, '-C', workspaceRoot]); } finally { await box(['rm', '--', remote]); }
      return { restored: true, processes_restored: false };
    },
    async recreate() { throw new ApiError(409, 'managed_by_grok_node', 'Box lifecycle belongs to GrokNode; the API preserves its original program and services'); },
    async close() { closed = true; snapshots?.close(); for (const client of sockets) client.terminate(); for (const child of children) { child.stdin.end(); child.kill('SIGTERM'); } wss.close(); await new Promise(resolve => server.close(resolve)); },
  };
  return runtime;
}
