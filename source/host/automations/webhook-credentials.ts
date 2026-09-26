import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_WEBHOOK_LISTENER_PORT, SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";

export const WEBHOOK_CREDENTIAL_FILENAME = "webhook.json";

/** A fresh per-routine webhook key: 32 random bytes, hex-encoded (matches the key the listener expects as a Bearer token). */
export function generateWebhookKey(): string { return randomBytes(32).toString("hex"); }

/** The credential file lives inside the routine's own folder, next to its automation.json. */
export function webhookCredentialPath(routineFolder: string): string { return join(routineFolder, WEBHOOK_CREDENTIAL_FILENAME); }

export function webhookCredentialExists(routineFolder: string): boolean { return existsSync(webhookCredentialPath(routineFolder)); }

export async function writeWebhookCredential(routineFolder: string, key: string, createdAt: number): Promise<void> {
  const path = webhookCredentialPath(routineFolder);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ key, createdAt }, null, 2)}\n`, "utf8");
}

export async function readWebhookKey(routineFolder: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(webhookCredentialPath(routineFolder), "utf8")) as unknown;
    return typeof parsed === "object" && parsed != null && typeof (parsed as { key?: unknown }).key === "string" ? (parsed as { key: string }).key : undefined;
  } catch { return undefined; }
}

export async function deleteWebhookCredential(routineFolder: string): Promise<void> { await rm(webhookCredentialPath(routineFolder), { force: true }); }

/** Constant-time comparison; length mismatch short-circuits before timingSafeEqual (which requires equal lengths). */
export function verifyWebhookKey(storedKey: string | undefined, presentedKey: string): boolean {
  if (storedKey == null || storedKey.length === 0) return false;
  const stored = Buffer.from(storedKey, "utf8"), presented = Buffer.from(presentedKey, "utf8");
  return stored.length === presented.length && timingSafeEqual(stored, presented);
}

/** The listener port is shared config: read from the sand root settings.json, defaulting when unset. */
export function resolveWebhookListenerPort(sandRoot: string): number {
  return new SandSettingsStore(join(sandRoot, "settings.json")).getWebhookListenerPort() ?? DEFAULT_WEBHOOK_LISTENER_PORT;
}

export function buildWebhookUrl(agentId: string, automationId: string, port: number): string {
  return `http://127.0.0.1:${port}/webhook/${encodeURIComponent(agentId)}/${encodeURIComponent(automationId)}`;
}
