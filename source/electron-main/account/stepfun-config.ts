import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readCodexConfigValue(key: string): string | null {
  try {
    const config = readFileSync(join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml"), "utf8");
    const value = new RegExp("^\\s*" + key + "\\s*=\\s*[\"']([^\"']+)[\"']", "m").exec(config)?.[1]?.trim();
    return value == null || value.length === 0 ? null : value;
  } catch { return null; }
}

