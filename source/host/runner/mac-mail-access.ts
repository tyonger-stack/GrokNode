/**
 * Mac 邮件草稿的会话访问门 —— 形状对齐 canUseGrokBotVault（vault-session-access.ts）：
 * 非共享房间回合、非 subagent、且只服务自己的主会话。门之外另有
 * grok_bot_apple_apps 本地 feature 门（port-0721-features.ts）与 local-exec
 * 权限门（LocalToolPermission extension），三层各自 fail-closed。
 */
export function canUseMacDraftMail(input: {
  readonly isSharedRoomTurn: boolean;
  readonly isSubagentRunner: boolean | undefined;
  readonly agentId: string;
  readonly sessionId: string;
}): boolean {
  return !input.isSharedRoomTurn
    && input.isSubagentRunner !== true
    && input.agentId === input.sessionId;
}
