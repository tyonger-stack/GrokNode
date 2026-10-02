import { z } from "zod";
import { GrokBotMainAgentRefusedError } from "../shared/node/grok-bot-main-agent.js";
import { isGrokBotMainAgentEnabled } from "./extensions/settings/main-agent-gate.js";

export const MAIN_AGENT_PROFILE = {
  name: "Grok Node",
  description: "The user's primary bot. Takes any task and routes it to the right one of their other bots. When the user wants a different primary bot, lists their bots with a one-line reason each, asks which, sets it with SetPrimaryBot, and confirms.",
  avatarShape: "blob",
  avatarColor: "black"
} as const;

const agentSchema = z.object({ id: z.string().min(1), name: z.string(), isGroup: z.boolean().optional(), viewerIsOwner: z.boolean().optional(), remoteRoom: z.unknown().optional() });
const idSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).nullable();
export type MainAgentRecord = z.infer<typeof agentSchema>;
export interface MainAgentSettings {
  readonly mainAgentId?: string | null | undefined;
  readonly defaultMainAgentId?: string | null | undefined;
  readonly pinnedAgentIds?: readonly string[] | undefined;
}
export interface MainAgentPorts {
  readonly readSettings: () => MainAgentSettings;
  readonly writeSettings: (update: MainAgentSettings) => void;
  readonly listAgents: () => Promise<unknown>;
  readonly createDefault: () => Promise<MainAgentRecord>;
  readonly enabled?: () => boolean;
}
export class MainAgentUnavailableError extends Error {
  constructor() { super("Choose a live Bot that you own, not a group or shared room."); this.name = "MainAgentUnavailableError"; }
}

export class MainAgentService {
  private creating: Promise<{ readonly agentId: string | null; readonly outcome: "created" | "present" | "hasMainAgent" | "tombstoned" }> | null = null;
  constructor(private readonly ports: MainAgentPorts) {}
  private assertEnabled(): void {
    if (!(this.ports.enabled ?? isGrokBotMainAgentEnabled)()) throw new GrokBotMainAgentRefusedError();
  }
  private async agents(): Promise<readonly MainAgentRecord[]> { return z.array(agentSchema).parse(await this.ports.listAgents()); }
  async get(): Promise<{ readonly agentId: string | null }> {
    const id = this.ports.readSettings().mainAgentId ?? null;
    return { agentId: id !== null && (await this.agents()).some(agent => agent.id === id) ? id : null };
  }
  async set(value: unknown): Promise<{ readonly agentId: string | null }> {
    this.assertEnabled();
    const id = idSchema.parse(value);
    if (id !== null) {
      const agent = (await this.agents()).find(agent => agent.id === id);
      if (agent == null || agent.isGroup || agent.viewerIsOwner === false || agent.remoteRoom != null) throw new MainAgentUnavailableError();
    }
    const pinned = this.ports.readSettings().pinnedAgentIds ?? [];
    this.ports.writeSettings({ mainAgentId: id, ...(id === null || pinned.includes(id) ? {} : { pinnedAgentIds: [...pinned, id] }) });
    return { agentId: id };
  }
  ensure() {
    this.assertEnabled();
    if (this.creating !== null) return this.creating;
    const work = this.ensureOnce();
    this.creating = work;
    void work.then(() => { this.creating = null; }, () => { this.creating = null; });
    return work;
  }
  private async ensureOnce(): Promise<{ readonly agentId: string | null; readonly outcome: "created" | "present" | "hasMainAgent" | "tombstoned" }> {
    const current = await this.get();
    if (current.agentId !== null) return { ...current, outcome: "hasMainAgent" };
    const defaultId = this.ports.readSettings().defaultMainAgentId;
    if (defaultId != null) {
      if (!(await this.agents()).some(agent => agent.id === defaultId)) return { agentId: null, outcome: "tombstoned" };
      return { ...await this.set(defaultId), outcome: "present" };
    }
    const agent = await this.ports.createDefault();
    this.ports.writeSettings({ defaultMainAgentId: agent.id });
    return { ...await this.set(agent.id), outcome: "created" };
  }
}
