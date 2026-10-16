const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>\"]/g, (character) => ESCAPES[character] ?? character);
}
