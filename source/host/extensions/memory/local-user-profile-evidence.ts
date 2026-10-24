import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isSafeFolderId } from "../../storage/folder-id.js";

export const LOCAL_PROFILE_MAX_CONVERSATIONS = 100;
export const LOCAL_PROFILE_INPUT_CHARS = 120_000;
const messageSchema = z.object({ id: z.string().min(1), content: z.string(), timestampMs: z.number().finite() });
export interface LocalProfileConversation {
  readonly id: string;
  readonly messages: readonly z.infer<typeof messageSchema>[];
}

export function isUsefulProfileMessage(content: string): boolean {
  const text = content.trim();
  if (!text || text.includes("<<SAND_") || text.startsWith("【记忆导入】")) return false;
  if (/(?:自检|连通性测试|健康检查)[\s:：，,]|connectivity (?:check|probe)|health ?check/iu.test(text)) return false;
  if (/只回复.{0,10}(?:收到|hi|ok)/iu.test(text)) return false;
  return !/^(?:hi|hello|ok|thanks|收到|继续|好|好的|谢谢|[a-d])[\s!！.。]*$/iu.test(text);
}

// The plain-text mirror loses author provenance. Only the desktop transcript can
// distinguish the local human from a peer Bot, connector sender or remote user.
const humanMessagesSql = `SELECT id,
  substr(json_extract(entry, '$.content'), 1, 2000) AS content,
  json_extract(entry, '$.timestampMs') AS timestampMs
  FROM transcript_entries
  WHERE json_valid(entry)
    AND json_extract(entry, '$.kind') = 'message'
    AND json_extract(entry, '$.role') = 'user'
    AND json_type(entry, '$.content') = 'text'
    AND json_extract(entry, '$.fromAgent') IS NULL
    AND json_extract(entry, '$.toAgent') IS NULL
    AND json_extract(entry, '$.fromUser') IS NULL
    AND json_extract(entry, '$.channel') IS NULL
    AND json_extract(entry, '$.channelSender') IS NULL
    AND json_extract(entry, '$.source') IS NULL
    AND json_extract(entry, '$.requestSource') IS NULL
    AND COALESCE(json_extract(entry, '$.hidden'), 0) = 0
    AND COALESCE(json_extract(entry, '$.isHidden'), 0) = 0
    AND COALESCE(json_extract(entry, '$.isStreaming'), 0) = 0
    AND COALESCE(json_extract(entry, '$.clientNonce'), '') NOT LIKE 'memory-import-%'
  ORDER BY seq DESC LIMIT 40`;

export function collectLocalProfileEvidence(agentsRoot: string): LocalProfileConversation[] {
  if (!existsSync(agentsRoot)) return [];
  const conversations: LocalProfileConversation[] = [];
  for (const folder of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!folder.isDirectory() || !isSafeFolderId(folder.name)) continue;
    const agentDir = join(agentsRoot, folder.name);
    if (existsSync(join(agentDir, "group.json")) || existsSync(join(agentDir, "remote-room.json"))) continue;
    const path = join(agentDir, "store.db");
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 50");
      const origin = db.prepare("SELECT value FROM kv WHERE key = 'origin'").get();
      const purpose = db.prepare("SELECT value FROM kv WHERE key = 'purpose'").get();
      if (origin?.value === "dev" || typeof purpose?.value === "string" && purpose.value.length > 0) continue;
      const messages = db.prepare(humanMessagesSql).all().flatMap(row => {
        const parsed = messageSchema.safeParse(row);
        if (!parsed.success || !isUsefulProfileMessage(parsed.data.content)) return [];
        return [parsed.data];
      });
      if (messages.length > 0) conversations.push({ id: folder.name, messages });
    } finally {
      db.close();
    }
  }
  const latest = (conversation: LocalProfileConversation) => Math.max(...conversation.messages.map(message => message.timestampMs));
  const recent = conversations.sort((a, b) => latest(b) - latest(a) || a.id.localeCompare(b.id)).slice(0, LOCAL_PROFILE_MAX_CONVERSATIONS);
  // Give every selected conversation a fair share; a long chat must not crowd
  // all other evidence out of the model's bounded input.
  const share = Math.floor(LOCAL_PROFILE_INPUT_CHARS / Math.max(1, recent.length));
  return recent.map(conversation => {
    let remaining = share;
    const messages = conversation.messages.flatMap(message => {
      const content = message.content.slice(0, remaining);
      remaining -= content.length;
      return content.length > 0 ? [{ ...message, content }] : [];
    }).reverse();
    return { id: conversation.id, messages };
  });
}
