import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, lstat, symlink, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { privateDirectory, resourceNames } from './common.mjs';

const execute = promisify(execFile);
export async function prepareCodex({ namespace, botId, stateRoot, runtime, codexBinary = 'codex', authFile = join(homedir(), '.codex/auth.json'), model, baseUrl, status, registry }) {
  const n = resourceNames(namespace, botId);
  const home = await privateDirectory(join(stateRoot, namespace, n.key, 'mac-codex'));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CODEX_HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp', TERM: process.env.TERM ?? 'xterm-256color', OCX_SHIM_BYPASS: '1', NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' };
  const version = await execute(codexBinary, ['--version'], { env, encoding: 'utf8' });
  if (version.stdout.trim() !== 'codex-cli 0.160.0') throw new Error('Local Codex must be exactly 0.160.0');
  status ??= await runtime.status(botId);
  if (!status.running) throw new Error('Bot environment unavailable');
  registry ??= await runtime.descriptor(botId);
  const auth = resolve(authFile);
  if (!(await lstat(auth)).isFile()) throw new Error('Mac auth file is missing');
  const link = join(home, 'auth.json');
  try {
    if (!(await lstat(link)).isSymbolicLink() || await readlink(link) !== auth) throw new Error('Unexpected Mac auth link');
  } catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(auth, link); }
  const inferenceUrl = new URL(baseUrl ?? 'http://127.0.0.1:10100/v1').href;
  const config = ['approval_policy = "on-request"', 'sandbox_mode = "danger-full-access"', 'suppress_unstable_features_warning = true',
    ...(model ? [`model = ${JSON.stringify(model)}`] : []), 'model_provider = "opencodex"', 'model_reasoning_effort = "medium"',
    `openai_base_url = ${JSON.stringify(inferenceUrl)}`, `model_catalog_json = ${JSON.stringify(join(homedir(), '.codex/opencodex-catalog.json'))}`,
    '[model_providers.opencodex]', 'name = "Existing local opencodex proxy"', `base_url = ${JSON.stringify(inferenceUrl)}`, 'wire_api = "responses"', 'requires_openai_auth = false', 'supports_websockets = false',
    '[features]', 'apps = false', 'plugins = false', 'remote_plugin = false', 'shell_snapshot = false', 'enable_request_compression = false', 'respect_system_proxy = false', 'system_proxy_fallback = false',
    '[shell_environment_policy]', 'inherit = "none"', 'include_only = []', registry.environments[0].display ? `set = { DISPLAY = ${JSON.stringify(':' + registry.environments[0].display)} }` : 'set = {}', ''];
  const entry = registry.environments[0];
  const transport = entry.transport === 'stdio'
    ? [`program = ${JSON.stringify(entry.program)}`, `args = ${JSON.stringify(entry.args)}`]
    : [`url = ${JSON.stringify(status.execServerUrl)}`, `auth_bearer_token = ${JSON.stringify(entry.authToken)}`, 'connect_timeout_sec = 3'];
  const environments = ['default = "bot"', 'include_local = false', '[[environments]]', 'id = "bot"', ...transport, 'initialize_timeout_sec = 20', ''];
  for (const [file, lines] of [['config.toml', config], ['environments.toml', environments]]) {
    const path = join(home, file);
    try { if (!(await lstat(path)).isFile()) throw new Error('Unexpected Codex configuration file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(path, lines.join('\n'), { mode: 0o600 });
  }
  return { binary: codexBinary, env, cwd: home, args: ['--strict-config', '--cd', runtime.workspaceRoot ?? '/workspace'] };
}

export async function launchCodex(options, prompt) {
  await options.runtime.ensure(options.botId);
  const command = await prepareCodex(options);
  return new Promise((resolve, reject) => {
    const subcommand = options.threadId
      ? prompt === undefined ? ['resume', options.threadId] : ['exec', 'resume', '--skip-git-repo-check', options.threadId, prompt]
      : prompt === undefined ? [] : ['exec', '--skip-git-repo-check', '--', prompt];
    // The CLI canonicalizes --cd on Mac before remote bootstrap. The shared
    // stdio executor already starts at the selected Linux project directory.
    const launchArgs = options.runtime.shared ? ['--strict-config'] : command.args;
    const child = spawn(command.binary, [...launchArgs, ...subcommand], { env: command.env, cwd: command.cwd, stdio: 'inherit' });
    child.on('error', () => reject(new Error('Unable to launch local Codex')));
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}
