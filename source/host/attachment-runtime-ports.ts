import type { createAttachmentsService } from "./extensions/attachments/attachments-service.js";
import type { ForeverBoxService } from "./extensions/forever-box/forever-box-service.js";

export type AttachmentStagingPort = Pick<ReturnType<typeof createAttachmentsService>, "stageIntoBox" | "scheduleRestage" | "forgetAgent">;
export type AgentBoxPrewarmPort = Pick<ForeverBoxService, "prewarm">;

export function bindAttachmentStagingPort(api: unknown): AttachmentStagingPort {
  const port = api as Partial<AttachmentStagingPort> | null | undefined;
  if (typeof port?.stageIntoBox !== "function" || typeof port.scheduleRestage !== "function" || typeof port.forgetAgent !== "function") {
    throw new TypeError("Attachment staging lifecycle is not bound.");
  }
  return {
    stageIntoBox: port.stageIntoBox.bind(api),
    scheduleRestage: port.scheduleRestage.bind(api),
    forgetAgent: port.forgetAgent.bind(api),
  };
}

export function bindAgentBoxPrewarmPort(api: unknown): AgentBoxPrewarmPort {
  const port = api as Partial<AgentBoxPrewarmPort> | null | undefined;
  if (typeof port?.prewarm !== "function") throw new TypeError("Agent box prewarm lifecycle is not bound.");
  return { prewarm: port.prewarm.bind(api) };
}
