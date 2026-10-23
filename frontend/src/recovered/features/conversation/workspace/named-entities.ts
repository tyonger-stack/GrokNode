import table from "./named-entities.json";

const namedHtmlEntities: Readonly<Record<string, string>> = table;

export function decodeNamedHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (entity, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return entity;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(namedHtmlEntities, body) ? namedHtmlEntities[body] ?? entity : entity;
  });
}
