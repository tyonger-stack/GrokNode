import {
  getSandProfilePath,
  readSandProfileFile,
  writeSandProfileFile,
} from "../../agents/agent-profile.js";
import { FileAutomationStore } from "../../automations/automation-store.js";
import { FileMemoryStore } from "../memory/memory-service.js";
import { FileWorkflowStore } from "../../workflows/workflow-store.js";
import { getGlobalWorkflowsDir } from "../../workflows/workflow-library.js";
import { createRealDebouncePolicy } from "../../../internal/scheduling.js";
import { computeNextRunAt } from "../../../shared/automation-schedule.js";
import { cronTrigger } from "../../../shared/automations.js";
import type { BotTemplateManualContents } from "../../../shared/bot-template.js";
import type { SandAgentDb } from "../session/agent-db.js";

const debounce = createRealDebouncePolicy({
  name: "local-bot-template-contents",
  delayMs: 0,
});

function nonEmptyLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function applyLocalBotTemplateContents(
  agentDir: string,
  contents: BotTemplateManualContents,
  now: number,
  resolveUserTimeZone: () => string | undefined = () => undefined,
  db: SandAgentDb,
): void {
  const profilePath = getSandProfilePath(agentDir);
  const profile = readSandProfileFile(profilePath);
  if (profile == null) {
    throw new Error("Cannot apply local Bot template before the agent profile exists.");
  }

  const instructions = contents.instructions.trim();
  writeSandProfileFile(profilePath, { ...profile, description: instructions });
  const currentSandProfile = db.getSandProfile();
  const sandProfileWritten = db.setSandProfile({
    description: instructions,
    avatarPath: currentSandProfile.avatarPath,
  });
  if (!sandProfileWritten) {
    throw new Error("Failed to update the live local Bot template profile.");
  }
  db.clearAgentProfilePromptSnapshot();

  const memoryStore = new FileMemoryStore(`${agentDir}/memory`, debounce);
  for (const memory of nonEmptyLines(contents.memory)) {
    memoryStore.addMemory(memory, now, "profile");
  }

  const workflowStore = new FileWorkflowStore(
    agentDir,
    getGlobalWorkflowsDir(`${agentDir}/../..`),
    resolveUserTimeZone,
  );
  const skills = contents.skills.trim();
  if (skills.length > 0 && workflowStore.importMarkdown(skills, "Imported skill") == null) {
    memoryStore.addMemory(`Skill requirement: ${skills}`, now, "profile");
  }

  const automationStore = new FileAutomationStore(
    `${agentDir}/automations`,
    resolveUserTimeZone,
  );
  const timeZone = resolveUserTimeZone();
  for (const routine of nonEmptyLines(contents.routines)) {
    const parts = routine.split("|").map((part) => part.trim());
    const schedule = parts[0] ?? "";
    const name = parts.length === 3 ? parts[1] ?? "" : parts[1] ?? "";
    const prompt = parts[2] ?? parts[1] ?? "";
    if (
      schedule.length > 0 &&
      prompt.length > 0 &&
      computeNextRunAt(schedule, now, timeZone) != null &&
      automationStore.upsert(
        {
          name: name || prompt,
          prompt,
          trigger: cronTrigger(schedule),
          isEnabled: true,
        },
        now,
      ) == null
    ) {
      memoryStore.addMemory(`Routine requirement: ${routine}`, now, "profile");
    } else if (schedule.length === 0 || prompt.length === 0 || computeNextRunAt(schedule, now, timeZone) == null) {
      memoryStore.addMemory(`Routine requirement: ${routine}`, now, "profile");
    }
  }

  for (const integration of nonEmptyLines(contents.integrations)) {
    memoryStore.addMemory(`Integration requirement: ${integration}`, now, "profile");
  }
}
