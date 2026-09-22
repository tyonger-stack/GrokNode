import { installBotTemplatePreview } from "./bot-template-preview";

if (window.desktop?.botTemplates !== undefined) installBotTemplatePreview(window.desktop);
