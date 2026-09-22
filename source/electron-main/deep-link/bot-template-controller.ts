import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BotTemplateBridge, BotTemplateManualContents, BotTemplateRecord } from "../../shared/bot-template.js";
import { BotTemplateError, fetchBotTemplateRecord } from "./bot-template-import.js";

interface ImportRequest {
  readonly name: string;
  readonly description: string;
  readonly origin: "template";
  readonly templateId: string;
  readonly isKickstartRequested: true;
  readonly clientNonce: string;
  readonly localTemplateContents: BotTemplateManualContents;
}

const manualContentsSchema = z.object({
  instructions: z.string(),
  memory: z.string(),
  skills: z.string(),
  routines: z.string(),
  integrations: z.string(),
});

export function createBotTemplateController(deps: {
  readonly fetchTemplate?: (id: string) => Promise<BotTemplateRecord>;
  readonly createAgent: (request: ImportRequest) => Promise<unknown>;
}): BotTemplateBridge {
  const previews = new Map<string, { readonly template: BotTemplateRecord; result?: Promise<{ agentId: string }> }>();
  const register = (template: BotTemplateRecord): string => {
    const previewId = randomUUID();
    if (previews.size >= 32) {
      const oldest = previews.keys().next().value;
      if (oldest !== undefined) previews.delete(oldest);
    }
    previews.set(previewId, { template });
    return previewId;
  };
  return {
    async preview(templateId) {
      const template = await (deps.fetchTemplate ?? fetchBotTemplateRecord)(templateId);
      const previewId = register(template);
      return { previewId, templateId, template };
    },
    async previewManual(templateId, name) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(templateId)) throw new BotTemplateError("Invalid Bot template id.");
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 120) throw new BotTemplateError("Invalid Bot name.");
      const previewId = register({ templateId, sourceUrl: "https://x.ai/bot/" + encodeURIComponent(templateId), name: trimmed, description: "", author: null, color: null, shape: null });
      return { previewId, templateId, template: previews.get(previewId)?.template as BotTemplateRecord };
    },
    import(previewId, rawContents) {
      const pending = previews.get(previewId);
      if (pending === undefined) return Promise.reject(new BotTemplateError("This Bot preview has expired. Open the link again."));
      const parsedContents = manualContentsSchema.safeParse(rawContents);
      if (!parsedContents.success) return Promise.reject(new BotTemplateError("Invalid manual Bot contents."));
      const contents: BotTemplateManualContents = {
        instructions: parsedContents.data.instructions,
        memory: parsedContents.data.memory,
        skills: parsedContents.data.skills,
        routines: parsedContents.data.routines,
        integrations: parsedContents.data.integrations,
      };
      if (contents.instructions.trim().length === 0) return Promise.reject(new BotTemplateError("Bot instructions are required."));
      pending.result ??= (async () => {
        const template = pending.template;
        const result = await deps.createAgent({ name: template.name, description: template.description, origin: "template", templateId: template.templateId, isKickstartRequested: true, clientNonce: "template-" + previewId, localTemplateContents: contents });
        const parsed = z.object({ agent: z.object({ id: z.string().min(1) }) }).safeParse(result);
        if (!parsed.success) throw new BotTemplateError("Imported Bot did not return a local agent id.");
        return { agentId: parsed.data.agent.id };
      })().catch((error: unknown) => { delete pending.result; throw error; });
      return pending.result;
    },
  };
}
