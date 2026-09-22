import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BotTemplateBridge, BotTemplateRecord } from "../../shared/bot-template.js";
import { BotTemplateError, fetchBotTemplateRecord } from "./bot-template-import.js";

interface ImportRequest {
  readonly name: string;
  readonly description: string;
  readonly origin: "template";
  readonly templateId: string;
  readonly isKickstartRequested: true;
  readonly clientNonce: string;
}

export function createBotTemplateController(deps: {
  readonly fetchTemplate?: (id: string) => Promise<BotTemplateRecord>;
  readonly createAgent: (request: ImportRequest) => Promise<unknown>;
}): BotTemplateBridge {
  const previews = new Map<string, { readonly template: BotTemplateRecord; result?: Promise<{ agentId: string }> }>();
  return {
    async preview(templateId) {
      const template = await (deps.fetchTemplate ?? fetchBotTemplateRecord)(templateId);
      const previewId = randomUUID();
      if (previews.size >= 32) {
        const oldest = previews.keys().next().value;
        if (oldest !== undefined) previews.delete(oldest);
      }
      previews.set(previewId, { template });
      return { previewId, template };
    },
    import(previewId) {
      const pending = previews.get(previewId);
      if (pending === undefined) return Promise.reject(new BotTemplateError("This Bot preview has expired. Open the link again."));
      pending.result ??= (async () => {
        const template = pending.template;
        const result = await deps.createAgent({ name: template.name, description: template.description, origin: "template", templateId: template.templateId, isKickstartRequested: true, clientNonce: "template-" + previewId });
        const parsed = z.object({ agent: z.object({ id: z.string().min(1) }) }).safeParse(result);
        if (!parsed.success) throw new BotTemplateError("Imported Bot did not return a local agent id.");
        return { agentId: parsed.data.agent.id };
      })().catch((error: unknown) => { delete pending.result; throw error; });
      return pending.result;
    },
  };
}
