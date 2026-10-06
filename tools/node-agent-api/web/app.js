import { capabilities, createClient, desktopURL, eventView, projectDownload, readSSE, sessionPath } from './client.js';

const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const pretty = value => JSON.stringify(value, null, 2);
const stateName = value => ({ idle: '待开始', pending: '提交中', accepted: '已接收', running: '正在执行', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '已中断', unknown: '状态待确认', closed: '已归档' }[value] ?? '状态待确认');
let client, flags = capabilities(), botId = '', session, turnId = '', epoch = 0;
let controller = new AbortController(), streamController, sending = false;
const cursors = new Map(), liveItems = new Map(), busy = new Map();
const status = value => text('status', value);

function controls() {
  const attached = Boolean(client && session), writable = attached && session.status !== 'closed';
  const enabled = {
    bots: Boolean(client), refresh: Boolean(client), disconnect: Boolean(client),
    history: Boolean(client && botId), attach: Boolean(client && botId),
    resume: attached, prompt: writable && flags.send, send: writable && flags.send && !sending,
    cancel: writable && flags.cancel && Boolean(turnId),
    'actions-refresh': attached && flags.actions, 'diff-refresh': attached && flags.diff,
    import: writable && flags.import, 'import-file': writable && flags.import, export: attached && flags.export,
    view: writable && flags.view, control: writable && flags.control, handback: attached && flags.control,
    clipboard: attached && (flags.clipboardRead || flags.clipboardWrite),
    'clipboard-read': attached && flags.clipboardRead, 'clipboard-write': writable && flags.clipboardWrite,
    applications: attached && flags.applications, 'applications-refresh': attached && flags.applications,
    'application-view': writable && flags.applications && Boolean($('applications').value), 'application-control': writable && flags.applications && flags.control && Boolean($('applications').value),
    'launch-terminal': writable && flags.applications && flags.control, 'launch-browser': writable && flags.applications && flags.control,
    backup: writable && flags.export, 'backup-id': writable && flags.import, 'restore-backup': writable && flags.import && Boolean($('backup-id').value),
  };
  for (const [id, allowed] of Object.entries(enabled)) $(id).disabled = !allowed || busy.has(id);
  $('connect').disabled = busy.has('auth');
}

async function run(id, action) {
  if (busy.has(id)) return;
  const generation = epoch, operation = Symbol(id);
  busy.set(id, operation); controls();
  try { await action(); }
  catch (error) { if (generation === epoch && error.name !== 'AbortError') status(error.message); }
  finally { if (busy.get(id) === operation) busy.delete(id); controls(); }
}
function bind(id, action) { $(id).addEventListener('click', () => run(id, action)); }
function resetSession() {
  ++epoch; controller.abort(); controller = new AbortController(); streamController?.abort();
  busy.clear();
  session = undefined; turnId = ''; sending = false; liveItems.clear();
  $('transcript').replaceChildren(); $('approvals').replaceChildren(); $('desktop').replaceChildren();
  $('clipboard').value = ''; $('prompt').value = ''; $('import-file').value = '';
  $('applications').replaceChildren(new Option('点击刷新应用', '')); $('backup-id').value = '';
  text('identity', '未选择会话'); text('thread', '未选择会话'); text('turn-status', '回合结果未知');
  text('diff', '尚未读取'); text('logs', '尚未收到事件'); text('stream-status', '事件流未连接');
  text('desktop-status', flags.view ? '可点击观看；接管需明确操作。' : '服务未声明桌面观看能力。');
  controls();
}
function disconnect() {
  resetSession(); client = undefined; flags = capabilities(); botId = ''; cursors.clear();
  $('key').value = ''; $('bots').replaceChildren(new Option('请先连接', ''));
  $('sessions').replaceChildren(); text('capabilities', '尚未查询'); text('context', '会话语义尚未查询。');
  text('title', '选择机器人与会话'); text('desktop-status', '未连接');
  text('workspace-status', '能力未声明的操作保持禁用。'); status('已断开，访问密钥已从本页清除。'); controls();
}
const options = extra => ({ signal: controller.signal, ...extra });
async function scopedJSON(path, extra) {
  const generation = epoch;
  const value = await client.json(path, options(extra));
  if (generation !== epoch) throw new DOMException('Aborted', 'AbortError');
  return value;
}
const post = (path, body) => scopedJSON(path, { method: 'POST', body });

async function loadBots() {
  const rows = await client.list('/v1/agents', controller.signal);
  resetSession(); botId = '';
  $('bots').replaceChildren(new Option(rows.length ? '选择机器人' : '没有可访问的机器人', ''));
  for (const bot of rows) $('bots').add(new Option(bot.name || bot.id, bot.id));
  $('sessions').replaceChildren(); text('title', '选择机器人与会话');
  status(rows.length ? '已连接。请选择机器人。' : '服务返回空机器人列表。'); controls();
}

async function loadSessions() {
  const generation = epoch, selectedBot = botId;
  const rows = await client.list(`/v1/agents/sessions?agent_id=${encodeURIComponent(selectedBot)}`, controller.signal);
  if (generation !== epoch) return;
  $('sessions').replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button');
    button.textContent = `${row.metadata?.title || '会话 ' + (rows.indexOf(row) + 1)} · ${stateName(row.task_status ?? row.status)}`;
    button.title = row.id;
    button.setAttribute('aria-current', String(row.id === session?.id));
    button.addEventListener('click', () => run('select-session', () => selectSession(row.id)));
    $('sessions').append(button);
  }
  if (!rows.length) text('sessions', '此机器人没有已关联会话。');
}

function message(parent, label, value) {
  const article = document.createElement('article'); article.className = 'message';
  const heading = document.createElement('strong'); heading.textContent = label;
  const body = document.createElement('pre'); body.textContent = value;
  article.append(heading, body); parent.append(article); return body;
}
async function loadItems() {
  const generation = epoch;
  const rows = await client.list(`${sessionPath(session.id)}/items`, controller.signal);
  if (generation !== epoch) return;
  const fragment = document.createDocumentFragment();
  const roles = { user: '用户', assistant: '助手', tool: '工具', system: '系统' };
  for (const item of rows) {
    const label = roles[item.role] ?? ({ userMessage: '你', agentMessage: '助手', commandExecution: '终端', fileChange: '文件修改', reasoning: '进度', dynamicToolCall: '审批操作' }[item.type]) ?? '记录';
    const value = item.text ?? (item.type === 'userMessage' ? (item.content ?? []).map(part => part.text ?? '').join('\n') : item.type === 'commandExecution' ? [item.command, item.aggregatedOutput, item.exitCode === null || item.exitCode === undefined ? '' : '退出码：' + item.exitCode].filter(Boolean).join('\n') : pretty(item));
    message(fragment, label, value);
  }
  $('transcript').replaceChildren(fragment);
  if (!rows.length) text('transcript', '当前会话没有返回对话记录。');
}
async function loadActions() {
  if (!flags.actions) { text('approvals', '服务未声明审批能力。'); return; }
  const generation = epoch, path = `${sessionPath(session.id)}/actions`;
  const rows = await client.list(path, controller.signal);
  if (generation !== epoch) return;
  $('approvals').replaceChildren();
  for (const action of rows) {
    const box = document.createElement('div'); box.className = 'approval';
    message(box, `待审批 · ${action.id}`, pretty(action));
    for (const [decision, label] of [['accept', '允许'], ['decline', '拒绝']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', () => run(`action-${action.id}`, async () => {
        for (const child of box.querySelectorAll('button')) child.disabled = true;
        try {
          const result = await post(`${path}/${encodeURIComponent(action.id)}`, { decision });
          if (generation !== epoch) return;
          status(`审批响应：${pretty(result)}`); await loadActions();
        } finally { for (const child of box.querySelectorAll('button')) child.disabled = false; }
      }));
      box.append(button);
    }
    $('approvals').append(box);
  }
  if (!rows.length) text('approvals', '没有待审批操作。');
}

async function selectSession(id) {
  resetSession();
  const generation = epoch;
  try {
    const value = await client.json(sessionPath(id), options());
    if (generation !== epoch) return;
    if (value.agent_id !== botId) throw new Error('会话所属机器人不匹配');
    session = value;
    turnId = value.active_turn_id ?? '';
    text('identity', flags.shared ? '机器人共用 Linux 项目与数据，桌面按机器人区分' : '当前机器人使用 Linux 项目环境'); text('thread', '当前会话');
    status(`会话已恢复 · ${stateName(value.task_status ?? value.status)}`);
    text('turn-status', turnId ? `活动回合：${turnId} · 结果未知` : '尚未观察到权威回合结果');
    controls();
    await Promise.all([loadItems(), loadActions(), loadSessions()]);
    if (generation === epoch) startStream();
  } catch (error) { if (generation === epoch && error.name !== 'AbortError') status(error.message); }
}

function receive(event) {
  if (!event.data || typeof event.data !== 'object') throw new Error('事件载荷不是对象');
  const envelope = event.data;
  if (envelope.session_id && envelope.session_id !== session.id) return;
  if (event.id) cursors.set(session.id, event.id);
  const view = eventView(event);
  text('logs', ($('logs').textContent === '尚未收到事件' ? '' : $('logs').textContent + '\n') + pretty(envelope));
  if ($('logs').textContent.length > 100000) text('logs', '较早事件已从显示区截断。\n' + $('logs').textContent.slice(-90000));
  if (view.turnStatus) {
    const labels = { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', unknown: '结果未知' };
    text('turn-status', `${view.turnId ?? '未提供回合 ID'} · ${labels[view.turnStatus] ?? view.turnStatus}`);
    if (view.turnStatus === 'running') turnId = view.turnId ?? '';
    else if (!view.turnId || view.turnId === turnId) turnId = '';
  }
  if (view.delta !== undefined && view.itemId) {
    let node = liveItems.get(view.itemId);
    if (!node) {
      node = message($('transcript'), `流式输出 · ${view.method || view.type} · ${view.itemId}`, '');
      liveItems.set(view.itemId, node);
    }
    node.textContent += view.delta;
  }
  if (/input\.(accepted|rejected|unknown)$/.test(view.type)) status(`输入状态：${view.type.split('.').at(-1)}；请以回合事件判断结果。`);
  if (view.type === 'node.upstream.unavailable') status('上游不可用，任务结果未知；不会自动重发输入。');
  if (view.type === 'node.session.closed') { session.status = 'closed'; $('desktop').replaceChildren(); }
  if (view.type.endsWith('items.changed')) void run('items-update', async () => { await loadItems(); liveItems.clear(); });
  if (view.method === 'turn/diff/updated' && typeof view.params.diff === 'string') text('diff', view.params.diff || '服务返回空差异。');
  if (/action|approval/i.test(view.type + view.method) && flags.actions) void run('actions-update', loadActions);
  controls();
}

function startStream() {
  streamController?.abort();
  if (!flags.sse) { text('stream-status', '服务未声明 SSE 能力，请手动刷新记录。'); return; }
  const generation = epoch, selectedSession = session.id, selectedClient = client;
  const stream = new AbortController(); streamController = stream;
  text('stream-status', '正在连接事件流…');
  void (async () => {
    try {
      const cursor = cursors.get(selectedSession);
      const response = await selectedClient.request(`${sessionPath(selectedSession)}/events`, {
        signal: stream.signal, headers: { Accept: 'text/event-stream', ...(cursor ? { 'Last-Event-ID': cursor } : {}) },
      });
      if (generation !== epoch || stream.signal.aborted) return;
      text('stream-status', '事件流已连接');
      await readSSE(response, event => { if (generation === epoch && !stream.signal.aborted) receive(event); });
      if (generation === epoch && !stream.signal.aborted) text('stream-status', '事件流已断开；点击恢复。回合结果可能未知。');
    } catch (error) {
      if (generation === epoch && !stream.signal.aborted) text('stream-status', `事件流不可用：${error.message}。可点击恢复；不会重发消息。`);
    }
  })();
}

$('auth').addEventListener('submit', event => {
  event.preventDefault();
  const key = $('key').value.trim();
  if (!key) return;
  disconnect();
  void run('auth', async () => {
    client = createClient(key, location.origin);
    try {
      const value = await client.json('/v1/capabilities', options());
      flags = capabilities(value); text('capabilities', pretty(value));
      text('context', value.sessions?.independent_conversations === false ? '同一机器人共享既有对话；关联会话不会创建独立上下文。' : '恢复已有会话不会自动重跑任务。');
      text('workspace-status', `差异：${flags.diff ? '支持' : '未声明支持'} · 导入：${flags.import ? '支持' : '未声明支持'} · 导出：${flags.export ? '支持' : '未声明支持'}`);
      await loadBots();
    } catch (error) { if (error.name !== 'AbortError') { disconnect(); status(error.message); } }
  });
});
bind('disconnect', disconnect);
bind('refresh', loadBots);
$('bots').addEventListener('change', () => {
  resetSession(); botId = $('bots').value; $('sessions').replaceChildren();
  text('title', botId ? $('bots').selectedOptions[0].textContent : '选择机器人与会话');
  status(botId ? '请选择已有会话，或关联当前机器人。' : '请选择机器人。'); controls();
  if (botId) void run('history', loadSessions);
});
bind('history', loadSessions);
bind('attach', async () => {
  const value = await post('/v1/agents/sessions', { agent_id: botId });
  await selectSession(value.id);
});
bind('resume', async () => { await Promise.all([loadItems(), loadActions()]); liveItems.clear(); startStream(); });
bind('actions-refresh', loadActions);
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  if (!session || !flags.send || sending || session.status === 'closed') return;
  const prompt = $('prompt').value;
  if (!prompt.trim()) return;
  const generation = epoch;
  void run('send', async () => {
    sending = true;
    try {
      const value = await post(`${sessionPath(session.id)}/events`, {
        events: [{ type: 'message', text: prompt }], idempotency_key: `nui_${crypto.randomUUID()}`,
      });
      if (generation !== epoch) return;
      status(`提交响应：${value.status ?? 'unknown'} · ${value.request_id ?? '未提供请求 ID'}。接收不代表任务完成。`);
      if (value.status === 'accepted') $('prompt').value = '';
    } catch (error) {
      if (generation === epoch && error.name !== 'AbortError') status(`提交未确认，结果可能未知；请先检查记录，勿盲目重发。${error.message}`);
    } finally { if (generation === epoch) sending = false; }
  });
});
bind('cancel', async () => {
  const value = await post(`${sessionPath(session.id)}/events`, { events: [{ type: 'agent.session.input.cancel', turn_id: turnId }] });
  status(`取消请求响应：${pretty(value)}；等待权威回合结果。`);
});
async function desktop(mode) {
  const value = await post(`${sessionPath(session.id)}/desktop`, { mode });
  const iframe = document.createElement('iframe');
  iframe.title = mode === 'control' ? '机器人桌面 · 接管' : '机器人桌面 · 观看';
  iframe.referrerPolicy = 'no-referrer'; iframe.src = desktopURL(value.url, location.origin);
  $('desktop').replaceChildren(iframe);
  text('desktop-status', `${mode === 'control' ? '已签发接管授权' : '已签发观看授权'}；画面连接由查看器显示。${value.pauses_agent === false ? '接管不会暂停机器人。' : '机器人暂停状态未确认。'}`);
}
bind('view', () => desktop('view')); bind('control', () => desktop('control'));
bind('applications-refresh', async () => {
  const rows = await client.list(`${sessionPath(session.id)}/applications`, controller.signal);
  $('applications').replaceChildren(new Option(rows.length ? '选择应用窗口' : '此桌面没有运行的应用', ''));
  for (const row of rows) $('applications').append(new Option(row.name || '应用窗口', row.id));
  controls();
});
$('applications').addEventListener('change', controls);
for (const [id, kind] of [['launch-terminal', 'terminal'], ['launch-browser', 'browser']]) bind(id, async () => {
  await post(`${sessionPath(session.id)}/applications`, { kind }); status('应用启动请求已接收。请刷新应用列表；需要先接管此机器人的桌面。');
});
for (const [id, mode] of [['application-view', 'view'], ['application-control', 'control']]) {
  $(id).addEventListener('click', () => {
    if (!session || !$('applications').value) return;
    const selected = $('applications').value, popup = window.open('', '_blank');
    if (!popup) { status('浏览器阻止了新窗口，请允许此页面打开窗口后再点击。'); return; }
    popup.opener = null;
    void run(id, async () => {
      try { const value = await post(`${sessionPath(session.id)}/desktop`, { mode, target: { type: 'application', application_id: selected } }); popup.location.href = desktopURL(value.url, location.origin); status(mode === 'control' ? '应用接管窗口已打开。' : '应用观看窗口已打开。'); }
      catch (error) { popup.close(); throw error; }
    });
  });
}
bind('handback', async () => {
  const value = await post(`${sessionPath(session.id)}/handback`, {});
  $('desktop').replaceChildren(); text('desktop-status', `交还响应：${pretty(value)}。可重新点击观看。`);
});
bind('clipboard-read', async () => {
  const value = await scopedJSON(`${sessionPath(session.id)}/clipboard`);
  if (typeof value.text !== 'string') throw new Error('剪贴板响应缺少 text');
  $('clipboard').value = value.text; status('机器人剪贴板已读取到文本框，可手动选择复制。');
});
bind('clipboard-write', async () => {
  const value = await post(`${sessionPath(session.id)}/clipboard`, { text: $('clipboard').value });
  status(`剪贴板写入响应：${pretty(value)}`);
});
bind('diff-refresh', async () => {
  const value = await scopedJSON(`${sessionPath(session.id)}/project/diff`);
  if (typeof value.diff !== 'string') throw new Error('差异响应缺少 diff，不能判断是否有修改');
  text('diff', value.diff || '服务返回空差异。');
});
$('backup-id').addEventListener('input', controls);
bind('backup', async () => {
  const value = await post(`${sessionPath(session.id)}/environment/backup`, {});
  $('backup-id').value = value.backup_id; status('备份已保存。请保留备份编号：' + value.backup_id); controls();
});
bind('restore-backup', async () => {
  await post(`${sessionPath(session.id)}/environment/restore`, { backup_id: $('backup-id').value.trim() });
  await Promise.all([loadItems(), loadActions()]); status('项目备份已恢复，当前文件也已先备份；需要的运行进程请手动重跑。');
});
bind('import', async () => {
  const file = $('import-file').files[0];
  if (!file) throw new Error('请先选择项目 JSON 文件');
  const generation = epoch;
  if (file.size > 4 * 1024 * 1024) throw new Error('文件超过 4 MiB，请拆分后导入');
  const value = JSON.parse(await file.text());
  if (generation !== epoch) return;
  if (!Array.isArray(value.files) || !value.files.length || value.files.some(row => typeof row.path !== 'string' || !row.path || typeof row.content !== 'string')) throw new Error('导入格式须为 {files:[{path,content}]}');
  const result = await post(`${sessionPath(session.id)}/project/import`, { files: value.files.map(({ path, content }) => ({ path, content })) });
  text('workspace-status', `导入响应：${pretty(result)}`);
});
bind('export', async () => {
  const selected = session.id, generation = epoch;
  const value = await post(`${sessionPath(selected)}/project/export`, {});
  const download = await projectDownload(client, value, selected, controller.signal);
  if (generation !== epoch) return;
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement('a'); link.href = url; link.download = download.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  text('workspace-status', download.message);
});
window.addEventListener('pagehide', disconnect);
controls();
