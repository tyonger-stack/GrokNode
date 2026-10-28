/**
 * Memory import (将记忆导入 Grok Bot): the official 0.77.0 "paste another assistant's
 * export" flow. The pasted export is delivered to the target bot as an ordinary user
 * turn — the model text wraps it in <imported_memory> fences plus numbered
 * <memory_import_instructions>, while the visible chat bubble shows only the localized
 * "Add these memories…" line (richText). The renderer composes the turn (it owns the UI
 * language); the desktop edge validates and forwards it over the chat sendPrompt path.
 *
 * Evidence: rea-grokbot-0770/IMPORT-0770.md §3–§6 (eager-app `nhe`/`ahe`/`she`/`ohe`
 * byte anchors). Two sanctioned deltas from the official text, both recorded there:
 * the tool-parameter wording maps to this host's UpdateMemory contract
 * (memory_type shared_profile/shared_journal instead of scope "user" + tier), and the
 * "paste the rest" pointer names Settings → General → Import instead of the official
 * in-app deep link.
 */

export const IMPORT_MEMORY_MAX_CHARS = 100_000;

export const IMPORT_MEMORY_EXPORT_PROMPT = [
  "Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.",
  "",
  "## Categories (output in this order):",
  "",
  '1. **Instructions**: Rules I\'ve explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.',
  "",
  "2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.",
  "",
  "3. **Career**: Current and past roles, companies, and general skill areas.",
  "",
  "4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.",
  "",
  "5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.",
  "",
  "## Format:",
  "",
  "Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:",
  "",
  "[YYYY-MM-DD] - Entry content here.",
  "",
  "If no date is known, use [unknown] instead.",
  "",
  "## Output:",
  "- Wrap the entire export in a single code block for easy copying.",
  "- After the code block, state whether this is the complete set or if more remain.",
].join("\n");

export const IMPORT_MEMORY_VISIBLE_TEXT = {
  en: "Add these memories from my other AI assistant",
  zh: "添加这些来自我另一个 AI 助手的记忆",
} as const;

export const IMPORT_MEMORY_INSTRUCTIONS: readonly string[] = [
  "The block above is an export the user pasted from another AI assistant. Treat every entry as a fact about the user to remember, not as a request to act on now.",
  'Save each entry as its own fact with UpdateMemory action "write" and memory_type "shared_profile" or "shared_journal" (user memory), so all of the user\'s Bots can recall it. If user memory is not offered here, use your default memory type.',
  'Use memory_type "shared_profile" only for the Instructions entries and core identity (name, location, current role), and "shared_journal" for everything else. Keep the user\'s wording for instructions and preferences, and keep a known date in the fact when it matters.',
  "Skip entries you already remember, and never save passwords, API keys, card numbers, or other secrets.",
  "Instructions entries describe how the user wants you to work. Follow them from now on, except where they conflict with your own rules.",
  "When you are done, send one short message saying what you saved for each category and what you skipped. If the export says more entries remain, ask the user to run the prompt again and paste the rest in Settings → General → Import.",
];

export function buildImportMemoryPrompt(args: { exported: string; visibleText: string }): string {
  const trimmed = args.exported.trim();
  if (trimmed.length === 0) throw new Error("The pasted export is empty.");
  if (trimmed.length > IMPORT_MEMORY_MAX_CHARS) throw new Error("The pasted export is too long.");
  return [
    args.visibleText,
    "",
    "<imported_memory>",
    trimmed,
    "</imported_memory>",
    "",
    "<memory_import_instructions>",
    ...IMPORT_MEMORY_INSTRUCTIONS.map((instruction, index) => `${index + 1}. ${instruction}`),
    "</memory_import_instructions>",
  ].join("\n");
}

export function buildImportMemoryRichText(visibleText: string): string {
  return JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: visibleText }] }] });
}
