import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: 'export * from "./source/electron-main/box/agent-data-reader.ts";export {setDocker} from "reader-test:docker";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  plugins: [{ name: 'reader-docker-boundary', setup(builder) {
    builder.onResolve({ filter: /local-docker-host-connector\.js$|^reader-test:docker$/ }, () => ({ path: 'docker', namespace: 'reader-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'reader-test' }, () => ({ contents: 'export const LOCAL_DOCKER_BOX_CONTAINER="grok-node-local-vm";let dispatch;export function setDocker(fn){dispatch=fn}export const runDocker=args=>dispatch(args);' }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const id = '11111111-1111-4111-8111-111111111111';
test('overview discovers actual .md journals and preserves established paths', async () => {
  const commands = [];
  api.setDocker(async args => {
    if (args[0] === 'inspect') return { ok: true, output: 'false' };
    const command = args.at(-1); commands.push(command);
    const output = command.includes('/memory/log ') ? '2026-09.md\n2026-10.md\n2026-13.md\nREADME.md\n2026-01.md.bak' : command.includes('/workflows ') ? 'weekly-report\nnotes' : command.includes('/user-memory/') ? '用户画像内容' : command.includes('/memory/profile.md') ? '人格内容' : '';
    return { ok: true, output };
  });
  const result = await api.readAgentDataOverview(id);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.memoryLogMonths, ['2026-10', '2026-09']);
  assert.equal(result.data.soul, '人格内容');
  assert.equal(result.data.userProfile, '用户画像内容');
  assert.deepEqual(result.data.workflows, ['notes', 'weekly-report']);
  assert(commands.some(command => command.includes(`/agents/${id}/audit.jsonl`)));
  assert(commands.some(command => command.includes(`/user-memory/agents/${id}/profile.md`)));
});
test('month and workflow viewers read their selected content; invalid input never reaches Docker', async () => {
  const calls = [];
  api.setDocker(async args => { calls.push(args); return { ok: true, output: args[0] === 'inspect' ? 'false' : '所选文件内容' }; });
  assert.equal((await api.readAgentMemoryLog(id, '2026-10')).data.content, '所选文件内容');
  assert(calls.some(args => args.at(-1).includes('/memory/log/2026-10.md')));
  assert.equal((await api.readAgentWorkflowContent('weekly-report')).data.content, '所选文件内容');
  assert(calls.some(args => args.at(-1).includes('/workflows/weekly-report/SKILL.md')));
  const count = calls.length;
  assert.equal((await api.readAgentMemoryLog(id, '../../secrets')).ok, false);
  assert.equal((await api.readAgentDataOverview('../bad')).ok, false);
  assert.equal((await api.readAgentWorkflowContent('../bad')).ok, false);
  assert.equal(calls.length, count);
});
test('audit displays the latest 60 valid records in reverse order and marks omitted records', () => {
  const lines = Array.from({ length: 65 }, (_, n) => JSON.stringify({ ts: `2026-10-24T00:00:${String(n).padStart(2, '0')}Z`, type: 'shell_command', command: `echo ${n}` }));
  const result = api.parseAuditTail('broken prefix\n' + lines.join('\n') + '\ninvalid\n', 100000);
  assert.equal(result.entries.length, 60);
  assert.equal(result.entries[0].summary, 'echo 64');
  assert.equal(result.entries.at(-1).summary, 'echo 5');
  assert.equal(result.truncated, true);
  const unicode = JSON.stringify({ type: 'shell_command', command: '测试' });
  assert.equal(api.parseAuditTail(unicode, Buffer.byteLength(unicode)).truncated, true);
});
