/** JSON-safe encoding for Library binary fields crossing the gateway. */
function base64ToBytes(value: string): Uint8Array {
  const nodeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }).Buffer;
  if (nodeBuffer !== undefined && typeof nodeBuffer.from === "function") {
    return new Uint8Array(nodeBuffer.from(value, "base64"));
  }
  const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
  if (atobFn === undefined) throw new Error("No base64 decoder available in this runtime");
  const binary = atobFn(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeLibraryJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $b64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encodeLibraryJson);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$b64 === "string" && Object.keys(record).length === 1) return record;
    const encoded: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) encoded[key] = encodeLibraryJson(child);
    return encoded;
  }
  return value;
}

export function decodeLibraryJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(decodeLibraryJson);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$b64 === "string" && Object.keys(record).length === 1) return base64ToBytes(record.$b64);
    const decoded: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) decoded[key] = decodeLibraryJson(child);
    return decoded;
  }
  return value;
}
