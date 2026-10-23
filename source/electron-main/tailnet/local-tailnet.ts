import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SecureStorageCodec } from "../secrets/secret-store.js";
import { assertNoSymlinkInPath, ensureSecureDirectoryChain } from "../../packages/agent-store-sync/paths.js";

const execute = promisify(execFile);
const configSchema = z.object({ enabled: z.boolean(), magicDnsSuffix: z.string().max(253).nullable(),
  consent: z.boolean(), tags: z.array(z.string().regex(/^tag:[a-zA-Z0-9_-]+$/)).max(32) }).strict();
const credentialsSchema = z.object({ clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(16384) }).strict();
const storedSchema = z.object({ version: z.literal(1), teamId: z.string().min(1).max(512),
  config: configSchema, credentials: credentialsSchema.nullable() }).strict();
const statusSchema = z.object({ BackendState: z.string(), AuthURL: z.string().optional(),
  CurrentTailnet: z.object({ MagicDNSSuffix: z.string().optional(), Name: z.string().optional() }).optional(),
  Self: z.object({ ID: z.string().optional(), Online: z.boolean().optional(), DNSName: z.string().optional() }).optional(),
}).passthrough();
type Stored = z.infer<typeof storedSchema>;

export interface LocalTailnetOptions {
  readonly dataRoot: string;
  readonly codec: SecureStorageCodec;
  readonly requireTeam: (teamId: string, action: "view" | "manage") => Promise<void>;
  readonly cliPath?: string;
}

function suffix(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized) || normalized.includes("..")) throw new TypeError("Invalid tailnet DNS suffix");
  return normalized;
}

export function createLocalTailnet(options: LocalTailnetOptions) {
  const root = join(options.dataRoot, "tailnet");
  const tails = new Map<string, Promise<unknown>>();
  const file = (teamId: string) => join(root, `${createHash("sha256").update(teamId).digest("hex")}.enc`);
  const requiredTeamId = (value: unknown) => z.string().min(1).max(512).parse(value);
  async function load(teamId: string): Promise<Stored> {
    assertNoSymlinkInPath(root);
    let handle;
    try {
      handle = await open(file(teamId), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 65536 || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error("Unsafe tailnet credential file");
      if (!options.codec.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
      const stored = storedSchema.parse(JSON.parse(options.codec.decryptString(await handle.readFile())));
      if (stored.teamId !== teamId) throw new Error("Tailnet credential scope mismatch");
      return stored;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, teamId,
        config: { enabled: false, magicDnsSuffix: null, consent: false, tags: [] }, credentials: null };
      throw error;
    } finally { await handle?.close(); }
  }
  async function save(value: Stored): Promise<void> {
    if (!options.codec.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
    assertNoSymlinkInPath(root); ensureSecureDirectoryChain(root);
    const temporary = join(root, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, options.codec.encryptString(JSON.stringify(storedSchema.parse(value))), { mode: 0o600, flag: "wx" });
      await rename(temporary, file(value.teamId));
    } finally { await rm(temporary, { force: true }); }
  }
  async function mutate(teamId: string, update: (value: Stored) => Stored) {
    const previous = tails.get(teamId) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      const value = await load(teamId);
      await options.requireTeam(teamId, "manage");
      await save(update(value));
    });
    tails.set(teamId, work);
    try { await work; } finally { if (tails.get(teamId) === work) tails.delete(teamId); }
  }
  async function cli(): Promise<string> {
    for (const candidate of options.cliPath ? [options.cliPath] : ["/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"]) {
      try { await access(candidate, constants.X_OK); return candidate; } catch {}
    }
    throw new Error("Tailscale CLI is unavailable");
  }
  async function status(teamId: string) {
    const stored = await load(teamId);
    try {
      const result = await execute(await cli(), ["status", "--json"], { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
      const state = statusSchema.parse(JSON.parse(result.stdout));
      const actualSuffix = suffix(state.CurrentTailnet?.MagicDNSSuffix ?? null);
      const mismatch = stored.config.magicDnsSuffix !== null && actualSuffix !== stored.config.magicDnsSuffix;
      const connected = stored.config.enabled && state.BackendState === "Running" && !mismatch;
      return { available: true, canManage: true, enabled: stored.config.enabled, connected,
        magicDnsSuffix: stored.config.magicDnsSuffix, detectedMagicDnsSuffix: actualSuffix,
        credentialConfigured: stored.credentials !== null, postureClientAvailable: false,
        state: state.BackendState, rejection: mismatch ? "tailnet-mismatch" : state.BackendState === "NeedsMachineAuth" ? "approval-required" : null,
        signInUrl: state.AuthURL || null, memberDevices: state.Self ? [state.Self] : [] };
    } catch {
      return { available: false, canManage: true, enabled: stored.config.enabled, connected: false,
        magicDnsSuffix: stored.config.magicDnsSuffix, detectedMagicDnsSuffix: null,
        credentialConfigured: stored.credentials !== null, postureClientAvailable: false,
        state: "unavailable", rejection: "tailscale-unavailable", signInUrl: null, memberDevices: [] };
    }
  }
  return {
    async getTeamTailnet(input: { teamId: string }) {
      const teamId = requiredTeamId(input.teamId); await options.requireTeam(teamId, "view");
      const canManage = await options.requireTeam(teamId, "manage").then(() => true, () => false);
      await tails.get(teamId);
      const current = await status(teamId);
      await options.requireTeam(teamId, "view");
      return { ...current, canManage };
    },
    async updateTeamTailnet(input: { teamId: string; enabled: boolean; magicDnsSuffix?: string | null; consent: boolean; tags?: string[] | undefined }) {
      const teamId = requiredTeamId(input.teamId); await options.requireTeam(teamId, "manage");
      if (input.enabled && !input.consent) throw new Error("Tailnet consent is required");
      await mutate(teamId, (value) => ({ ...value, config: configSchema.parse({ enabled: input.enabled,
        magicDnsSuffix: suffix(input.magicDnsSuffix ?? null), consent: input.consent, tags: input.tags ?? value.config.tags }) }));
      const result = await status(teamId); await options.requireTeam(teamId, "view"); return result;
    },
    async updateTeamTailnetCredential(input: { teamId: string; clientId?: string; clientSecret?: string; remove?: boolean }) {
      const teamId = requiredTeamId(input.teamId); await options.requireTeam(teamId, "manage");
      const credentials = input.remove === true ? null : credentialsSchema.parse({ clientId: input.clientId, clientSecret: input.clientSecret });
      await mutate(teamId, (value) => ({ ...value, credentials })); return status(teamId);
    },
    async discoverTeamTailnetSuffix(input: { teamId: string }) {
      const teamId = requiredTeamId(input.teamId); await options.requireTeam(teamId, "manage");
      const current = await status(teamId);
      return { magicDnsSuffix: current.detectedMagicDnsSuffix, signInUrl: current.signInUrl,
        failureReason: current.detectedMagicDnsSuffix === null ? current.rejection ?? "not-connected" : null };
    },
    async connectTeamTailnet(input: { teamId: string }) {
      const teamId = requiredTeamId(input.teamId); await options.requireTeam(teamId, "manage");
      await tails.get(teamId); const value = await load(teamId);
      if (!value.config.enabled || !value.config.consent) throw new Error("Tailnet is disabled or lacks consent");
      const args = ["up", "--json", "--timeout=15s"];
      let temporary: string | undefined;
      try {
        if (value.credentials) {
          temporary = join(root, `.${randomUUID()}.secret`);
          await writeFile(temporary, value.credentials.clientSecret, { mode: 0o600, flag: "wx" });
          args.push(`--client-secret=file:${temporary}`);
          if (value.config.tags.length) args.push(`--advertise-tags=${value.config.tags.join(",")}`);
        }
        await options.requireTeam(teamId, "manage");
        try {
          await execute(await cli(), args, { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true });
        } catch {
          throw new Error("Tailscale could not connect; check its login and administrator approval status");
        }
        return status(teamId);
      } finally { if (temporary) await rm(temporary, { force: true }); }
    },
  };
}
