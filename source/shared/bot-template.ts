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
  readonly templateId: string;
  readonly template: BotTemplateRecord;
}

export interface BotTemplateManualContents {
  readonly instructions: string;
  readonly memory: string;
  readonly skills: string;
  readonly routines: string;
  readonly integrations: string;
}

export interface BotTemplateBridge {
  preview(templateId: string): Promise<BotTemplatePreview>;
  previewManual(templateId: string, name: string): Promise<BotTemplatePreview>;
  import(
    previewId: string,
    contents: BotTemplateManualContents,
  ): Promise<{ readonly agentId: string }>;
}
