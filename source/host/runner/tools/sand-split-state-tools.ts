import { z } from "zod";
import { defineCommunicateTool } from "./communicate-tool.js";
import {
  applySandStateUpdate, sandUpdateStateParameters,
  type SandStateDependencies, type SandStateUpdate,
} from "./sand-state-tool.js";

type ActionArgs = Omit<SandStateUpdate, "target">;
type ProfileArgs = Omit<SandStateUpdate, "target" | "action">;

async function update(args: SandStateUpdate, deps: SandStateDependencies): Promise<string> {
  deps.assertNoPendingAutoReviewApproval?.();
  const result = await applySandStateUpdate(args, deps);
  return result.ok ? result.detail : `Not saved: ${result.reason}`;
}

export function createSandSplitStateTools(deps: SandStateDependencies) {
  const routine = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION", name: "UpdateRoutine",
    description: "Create, update, pause, resume or delete a routine. A routine runs a saved prompt on a schedule or event. Pass only changed fields on update. Writes use the same review as update_state.",
    parameters: sandUpdateStateParameters.pick({ action: true, id: true, name: true, prompt: true, schedule: true, trigger: true, enabled: true })
      .extend({ action: z.enum(["create", "update", "pause", "resume", "delete"]) }).strict(),
    execute: async (_ctx, args: ActionArgs, runtime) => update({ ...args, target: "routine" }, runtime),
  });
  const skill = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION", name: "UpdateSkill",
    description: "Save, rewrite or delete a reusable skill. A skill has no trigger. Supply name, description and body to write; id selects an existing skill. Managed skills remain protected.",
    parameters: sandUpdateStateParameters.pick({ action: true, id: true, name: true, description: true, body: true })
      .extend({ action: z.enum(["write", "delete"]) }).strict(),
    execute: async (_ctx, args: ActionArgs, runtime) => update({ ...args, target: "workflow" }, runtime),
  });
  const profile = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION", name: "UpdateProfile",
    description: "Change your name, description, title, default mark, sidebar visibility or notifications. Only supplied fields change. Use UpdateAvatar for a custom picture.",
    parameters: sandUpdateStateParameters.pick({ name: true, description: true, title: true, avatar_shape: true, avatar_color: true, hidden_from_sidebar: true, notify_on_updates: true }).strict(),
    execute: async (_ctx, args: ProfileArgs, runtime) => {
      const settings = args.hidden_from_sidebar !== undefined || args.notify_on_updates !== undefined;
      const profileFields = !settings || [args.name, args.description, args.title, args.avatar_shape, args.avatar_color].some(value => value !== undefined);
      const results: string[] = [];
      runtime.assertNoPendingAutoReviewApproval?.();
      if (profileFields) {
        const result = await applySandStateUpdate({ ...args, target: "profile", action: "set" }, runtime);
        if (!result.ok) return `Not saved: ${result.reason}`;
        results.push(result.detail);
      }
      if (settings) results.push(await update({ ...args, target: "settings", action: "set" }, runtime));
      return results.join("\n");
    },
  });
  const avatar = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION", name: "UpdateAvatar",
    description: "Set or clear your profile picture. On set, supply an existing image path. Change your picture only when the user asks.",
    parameters: sandUpdateStateParameters.pick({ action: true, path: true }).extend({ action: z.enum(["set", "clear"]) }).strict(),
    execute: async (_ctx, args: ActionArgs, runtime) => update({ ...args, target: "avatar" }, runtime),
  });
  const channel = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION", name: "DisconnectChannel",
    description: "Disconnect one connected channel by platform. This closes the existing connection.",
    parameters: z.object({ platform: sandUpdateStateParameters.shape.platform.unwrap() }).strict(),
    execute: async (_ctx, args: ProfileArgs, runtime) => update({ ...args, target: "channel", action: "disconnect" }, runtime),
  });
  return [routine, skill, profile, avatar, channel].map(tool => ({
    ...tool,
    contextType: { type: "dynamic" as const, conciseStaticContext: `Use ${tool.name} to change your own ${tool.name === "UpdateRoutine" ? "routines" : tool.name === "UpdateSkill" ? "skills" : tool.name === "UpdateAvatar" ? "picture" : tool.name === "DisconnectChannel" ? "channel connections" : "profile and settings"}.` },
  }));
}
