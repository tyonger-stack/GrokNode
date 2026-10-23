import { z } from "zod";

const role = z.enum(["owner", "admin", "member"]);
const team = z.object({ teamId: z.string(), name: z.string(), role });
const member = z.object({ accountId: z.string(), principalId: z.string(), role });
const recipient = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), accountId: z.string().trim().min(1), principalId: z.string().trim().min(1) }),
  z.object({ kind: z.literal("team"), teamId: z.string().min(1) }),
]);
export const grantSchema = z.object({
  kind: z.enum(["agent", "store"]), id: z.string().trim().min(1), recipient,
  actions: z.array(z.enum(["view", "use", "create-automation"])).min(1),
  expiresAtMs: z.number().int().positive().safe().nullable(),
});
const tailnet = z.object({
  available: z.boolean(), canManage: z.boolean(), enabled: z.boolean(), connected: z.boolean(),
  magicDnsSuffix: z.string().nullable(), detectedMagicDnsSuffix: z.string().nullable(),
  credentialConfigured: z.boolean(), postureClientAvailable: z.literal(false),
  signInUrl: z.string().nullable(), rejection: z.string().nullable(),
});
const discovery = z.object({ magicDnsSuffix: z.string().nullable(), signInUrl: z.string().nullable(), failureReason: z.string().nullable() });
export type LocalTeam = z.infer<typeof team>;
export type LocalMember = z.infer<typeof member>;
export type LocalGrant = z.infer<typeof grantSchema>;
export type TailnetStatus = z.infer<typeof tailnet>;
export type TailnetConfig = { teamId: string; enabled: boolean; magicDnsSuffix: string | null; consent: boolean; tags?: string[] };
export type TailnetCredential = { teamId: string; clientId: string; clientSecret: string } | { teamId: string; remove: true };

export function localTeamsDesktop(raw: unknown) {
  const desktop = z.object({ teams: z.record(z.string(), z.unknown()), tailnet: z.record(z.string(), z.unknown()) }).parse(raw);
  async function call(area: "teams" | "tailnet", method: string, args?: unknown): Promise<unknown> {
    const fn = desktop[area][method];
    if (typeof fn !== "function") throw new Error(`Local ${area} method is unavailable: ${method}`);
    return args === undefined ? fn.call(desktop[area]) : fn.call(desktop[area], args);
  }
  return {
    list: async () => z.array(team).parse(await call("teams", "list")),
    create: async (name: string) => team.parse(await call("teams", "create", { name })),
    listMembers: async (teamId: string) => z.array(member).parse(await call("teams", "listMembers", { teamId })),
    setMember: async (input: { teamId: string; accountId: string; principalId: string; role: "admin" | "member" | null }) => { await call("teams", "setMember", input); },
    getAgentAccess: async (agentId: string) => z.array(grantSchema).parse(await call("teams", "getAgentAccess", { agentId })),
    setAccessGrant: async (grant: LocalGrant, enabled: boolean) => z.array(grantSchema).parse(await call("teams", "setAccessGrant", { grant: grantSchema.parse(grant), enabled })),
    getTailnet: async (teamId: string) => tailnet.parse(await call("tailnet", "getTeamTailnet", { teamId })),
    updateTailnet: async (config: TailnetConfig) => tailnet.parse(await call("tailnet", "updateTeamTailnet", config)),
    updateCredential: async (credential: TailnetCredential) => {
      try { return tailnet.parse(await call("tailnet", "updateTeamTailnetCredential", credential)); }
      catch { throw new Error("Could not save Tailnet credentials. Check your local team administrator access and secure storage."); }
    },
    discover: async (teamId: string) => discovery.parse(await call("tailnet", "discoverTeamTailnetSuffix", { teamId })),
    connect: async (teamId: string) => tailnet.parse(await call("tailnet", "connectTeamTailnet", { teamId })),
  };
}
export type LocalTeamsDesktop = ReturnType<typeof localTeamsDesktop>;

export function grantFromForm(form: FormData): LocalGrant {
  const expiry = String(form.get("expires") ?? "");
  const expiresAtMs = expiry ? Date.parse(expiry) : null;
  if (expiresAtMs !== null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())) throw new Error("Choose an expiry in the future.");
  return grantSchema.parse({ kind: form.get("kind"), id: form.get("resourceId"),
    recipient: form.get("recipientKind") === "team" ? { kind: "team", teamId: form.get("recipientTeam") }
      : { kind: "person", accountId: form.get("accountId"), principalId: form.get("principalId") },
    actions: form.getAll("actions"), expiresAtMs });
}

export function safeSignInUrl(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
