export interface BotTemplateRecord {
  readonly templateId: string;
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly author: string | null;
  readonly color: string | null;
  readonly shape: string | null;
}

export interface BotTemplatePreview {
  readonly previewId: string;
  readonly template: BotTemplateRecord;
}

export interface BotTemplateBridge {
  preview(templateId: string): Promise<BotTemplatePreview>;
  import(previewId: string): Promise<{ readonly agentId: string }>;
}
