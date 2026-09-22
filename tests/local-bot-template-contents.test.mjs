import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'node_modules/.cache/local-bot-template-contents.cjs');
const entrySource = [
  'export { applyLocalBotTemplateContents } from "./source/host/extensions/transcript/local-bot-template-contents.ts";',
  'export { SandAgentDb } from "./source/host/extensions/session/agent-db.ts";',
  'export { AgentWorkflowEnablement } from "./source/host/agents/agent-workflow-enablement.ts";',
].join('\n');

async function loadModules() {
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    stdin: { contents: entrySource, resolveDir: root },
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'error',
  });
  return createRequire(import.meta.url)(output);
}

test('manual local Bot template updates profile, database, skills, routines, and integrations', async () => {
  const { applyLocalBotTemplateContents, SandAgentDb, AgentWorkflowEnablement } = await loadModules();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'local-bot-template-'));
  const agentDir = path.join(tmp, 'agents', 'agent-local');
  const profilePath = path.join(agentDir, 'profile.json');
  const dbPath = path.join(agentDir, 'store.db');
  await mkdir(agentDir, { recursive: true });
  await writeFile(profilePath, JSON.stringify({
    name: 'New Bot',
    description: 'old public summary',
    title: '',
    avatarShape: 'blob',
    avatarColor: 'red',
  }, null, 2));

  const initialDb = new SandAgentDb(dbPath);
  initialDb.close();
  const db = new SandAgentDb(dbPath);
  try {
    assert.equal(db.setSandProfile({
      description: 'old public summary',
      avatarPath: '/keep/avatar.png',
    }), true);
    assert.equal(db.writeKv('agentProfilePromptSnapshot', 'old prompt snapshot'), true);

    const skill = [
      '---',
      'name: Imported skill',
      'description: A local test skill',
      '---',
      '',
      '# Imported skill',
      '',
      'Follow this local workflow.',
    ].join('\n');
    const contents = {
      instructions: 'Imported instructions for local bot.',
      memory: 'Remember local context.',
      skills: skill,
      routines: [
        '0 9 * * 1-5 | Morning check | Review the work',
        'not-a-cron | Broken routine | This must fall back to memory',
      ].join('\n'),
      integrations: 'Local files',
    };
    const now = Date.parse('2026-09-23T01:35:10+08:00');

    applyLocalBotTemplateContents(
      agentDir,
      contents,
      now,
      () => 'Asia/Shanghai',
      db,
    );

    const profile = JSON.parse(await readFile(profilePath, 'utf8'));
    assert.equal(profile.name, 'New Bot');
    assert.equal(profile.description, contents.instructions);
    assert.equal(profile.avatarShape, 'blob');
    assert.equal(profile.avatarColor, 'red');

    const liveProfile = db.getSandProfile();
    assert.equal(liveProfile.description, contents.instructions);
    assert.equal(liveProfile.avatarPath, '/keep/avatar.png');
    assert.equal(db.readKv('agentProfilePromptSnapshot'), null);

    const memory = await readFile(path.join(agentDir, 'memory', 'profile.md'), 'utf8');
    assert.match(memory, /Remember local context\./);
    assert.match(memory, /Routine requirement: not-a-cron \| Broken routine/);
    assert.match(memory, /Integration requirement: Local files/);
    assert.doesNotMatch(memory, /Morning check/);
    assert.doesNotMatch(memory, /Imported skill/);

    const importedSkillPath = path.join(tmp, 'workflows', 'imported-skill', 'SKILL.md');
    const importedSkill = await readFile(importedSkillPath, 'utf8');
    assert.match(importedSkill, /name: "Imported skill"/);
    assert.match(importedSkill, /Follow this local workflow/);
    assert.equal(new AgentWorkflowEnablement(agentDir).isEnabled('imported-skill'), true);

    const automationPath = path.join(agentDir, 'automations', 'morning-check', 'automation.json');
    const automation = JSON.parse(await readFile(automationPath, 'utf8'));
    assert.equal(automation.name, 'Morning check');
    assert.equal(automation.prompt, 'Review the work');
    assert.equal(automation.enabled, true);
    assert.equal(automation.schedule, '0 9 * * 1-5');
    
  } finally {
    db.close({ checkpoint: true });
    await rm(tmp, { recursive: true, force: true });
  }
});
