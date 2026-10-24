export function canUseGrokBotVault(input: {
  readonly isSharedRoomTurn: boolean;
  readonly isSubagentRunner: boolean | undefined;
  readonly agentId: string;
  readonly sessionId: string;
}): boolean {
  return !input.isSharedRoomTurn
    && input.isSubagentRunner !== true
    && input.agentId === input.sessionId;
}
