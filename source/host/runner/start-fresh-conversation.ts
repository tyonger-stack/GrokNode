/**
 * Official `StartFreshGrokBotConversation`: messages leave the model context.
 * Memory, files, routines, connections, and settings stay.
 *
 * The official RPC refuses unless an inference hook blocked the last turn.
 * This build has no that hook, so this only clears a prompt executor. It is
 * not registered as a user-facing action.
 */
export interface FreshConversationExecutor {
  clearMessages(): void;
}

export class LocalConversationResetUnavailableError extends Error {
  constructor() {
    super("A reset is only available for agents that run on Cursor's servers.");
    this.name = "LocalConversationResetUnavailableError";
  }
}

export function refuseLocalConversationReset(): never {
  throw new LocalConversationResetUnavailableError();
}

export interface FreshConversationResult {
  readonly messagesLeftModelContext: true;
  readonly kept: readonly ["memory", "files", "routines", "connections", "settings"];
}

export function startFreshModelContext(
  executor: FreshConversationExecutor,
): FreshConversationResult {
  executor.clearMessages();
  return {
    messagesLeftModelContext: true,
    kept: ["memory", "files", "routines", "connections", "settings"],
  };
}
