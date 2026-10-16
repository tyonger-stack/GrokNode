import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SAND_PROFILE_FILENAME = "profile.json";

export interface SandAgentProfile {
  name: string;
  description: string;
  title: string;
  avatarShape: string;
  avatarColor: string;
}

export function getSandProfilePath(agentDir: string): string { return join(agentDir, SAND_PROFILE_FILENAME); }

function parseProfileJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function readSandProfileFile(path: string): SandAgentProfile | null {
  const parsed = parseProfileJson(path);
  if (parsed == null) return null;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    description: typeof parsed.description === "string" ? parsed.description : "",
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    avatarShape: typeof parsed.avatarShape === "string" ? parsed.avatarShape.trim() : "",
    avatarColor: typeof parsed.avatarColor === "string" ? parsed.avatarColor.trim() : ""
  };
}

export function readLegacyProfileAvatarField(path: string): string | null {
  const avatar = parseProfileJson(path)?.avatar;
  if (typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function writeSandProfileFile(path: string, profile: SandAgentProfile): void {
  mkdirSync(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify({ ...profile, title: profile.title.trim(), avatarShape: profile.avatarShape.trim(), avatarColor: profile.avatarColor.trim() }, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, serialized, "utf8");
  renameSync(temporary, path);
}

export interface SandProfileEdit {
  readonly name?: string;
  readonly description?: string;
  readonly title?: string;
  readonly avatarShape?: string;
  readonly avatarColor?: string;
}

function keptProfileName(current: SandAgentProfile | null): string {
  const name = current?.name?.trim() ?? "";
  return name.length > 0 ? name : "Grok";
}

/**
 * Official 0.71.2 `editSandProfile` (host-main.cjs): merge a partial profile write into
 * `profile.json`, keeping unset fields. Empty `title` clears the role chip.
 */
export function editSandProfile(agentDir: string, edit: SandProfileEdit): void {
  const path = getSandProfilePath(agentDir);
  const current = readSandProfileFile(path);
  const name = edit.name?.trim() ?? "";
  writeSandProfileFile(path, {
    name: name.length > 0 ? name : keptProfileName(current),
    description: edit.description?.trim() ?? current?.description ?? "",
    title: edit.title?.trim() ?? current?.title ?? "",
    avatarShape: edit.avatarShape?.trim() ?? current?.avatarShape ?? "",
    avatarColor: edit.avatarColor?.trim() ?? current?.avatarColor ?? "",
  });
}
