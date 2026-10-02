// Narrow agent-row action tranche recovered from udn/fcn/ccn.
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L50271
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L51965
//
// The main-bot action is a PORT, not a 0.18 recovery: it exists in the official client only.
// @port /Applications/Grok Bot.app (CFBundleShortVersionString 0.66.0, built
// @port 2026-10-01T18:23:52Z) → renderer/assets/index-ZYxf-aBb.js @byteOffset 403587
// @port (component bA: SandMenu-style item, leading icon "arrow-swap", label id "EmmHd+",
// @port English "Replace with different Bot" / Chinese 「替换为其他 Bot」) and the menu
// @port assembly in xA which picks this item ONLY for the main agent:
// @port     isMain ? <bA onReplace/> : otherCandidates.length > 0 ? <kA onRequestDelete/> : null
// Absent from this build's 0.18 baseline: "EmmHd+" and "替换为其他 Bot" have 0 hits across
// src/app/dist/renderer.

export const AGENT_ROW_ACTIONS_LABEL = "Agent actions";

export interface AgentRowAction {
  id: "pin-agent" | "unpin-agent" | "hide-from-sidebar" | "delete-agent" | "copy-conversation-id" | "duplicate-agent" | "mark-read" | "mark-unread" | "replace-main-agent";
  label: "Pin" | "Unpin" | "Hide from sidebar" | "Delete" | "Copy conversation ID" | "Duplicate" | "Mark as Read" | "Mark as Unread" | "Replace with different Bot";
}

const PIN_AGENT_ACTION: AgentRowAction = {
  id: "pin-agent",
  label: "Pin"
};
const UNPIN_AGENT_ACTION: AgentRowAction = {
  id: "unpin-agent",
  label: "Unpin"
};
const HIDE_FROM_SIDEBAR_ACTION: AgentRowAction = {
  id: "hide-from-sidebar",
  label: "Hide from sidebar"
};
const DELETE_AGENT_ACTION: AgentRowAction = {
  id: "delete-agent",
  label: "Delete"
};
const COPY_CONVERSATION_ID_ACTION: AgentRowAction = {
  id: "copy-conversation-id",
  label: "Copy conversation ID"
};
const DUPLICATE_AGENT_ACTION: AgentRowAction = {
  id: "duplicate-agent",
  label: "Duplicate"
};
const MARK_READ_ACTION: AgentRowAction = {
  id: "mark-read",
  label: "Mark as Read"
};
const MARK_UNREAD_ACTION: AgentRowAction = {
  id: "mark-unread",
  label: "Mark as Unread"
};
// Ported: official label id "EmmHd+" (English "Replace with different Bot").
const REPLACE_MAIN_AGENT_ACTION: AgentRowAction = {
  id: "replace-main-agent",
  label: "Replace with different Bot"
};

export function agentRowActions({ isHidden, isPinned = false, hasUnread = false, isMain = false, includeCopy = false, includeDelete = false, includeDuplicate = false, includeMarkUnread = false, includePin = false, includeReplaceMainAgent = false }: { isHidden: boolean; isPinned?: boolean; hasUnread?: boolean; isMain?: boolean; includeCopy?: boolean; includeDelete?: boolean; includeDuplicate?: boolean; includeMarkUnread?: boolean; includePin?: boolean; includeReplaceMainAgent?: boolean }): readonly AgentRowAction[] {
  if (isHidden) return [];
  // Upstream puts "replace the main bot" and "delete these bots" in the SAME slot, and
  // shows the first when this row is the main bot. Mirrored here: a main bot offers
  // replace instead of delete, never both.
  const trailing = isMain && includeReplaceMainAgent
    ? [REPLACE_MAIN_AGENT_ACTION]
    : includeDelete ? [DELETE_AGENT_ACTION] : [];
  return [
    ...(includePin ? [isPinned ? UNPIN_AGENT_ACTION : PIN_AGENT_ACTION] : []),
    ...(includeMarkUnread ? [hasUnread ? MARK_READ_ACTION : MARK_UNREAD_ACTION] : []),
    ...(includeDuplicate ? [DUPLICATE_AGENT_ACTION] : []),
    ...(includeCopy ? [COPY_CONVERSATION_ID_ACTION] : []),
    HIDE_FROM_SIDEBAR_ACTION,
    ...trailing
  ];
}

export function isHideFromSidebarAction(action: AgentRowAction): boolean {
  return action.id === "hide-from-sidebar";
}

export function isTogglePinAction(action: AgentRowAction): boolean {
  return action.id === "pin-agent" || action.id === "unpin-agent";
}

export function togglePinValue(action: AgentRowAction): boolean {
  return action.id === "pin-agent";
}

export function isDeleteAgentAction(action: AgentRowAction): boolean {
  return action.id === "delete-agent";
}

export function isCopyConversationIdAction(action: AgentRowAction): boolean {
  return action.id === "copy-conversation-id";
}

export function isDuplicateAgentAction(action: AgentRowAction): boolean {
  return action.id === "duplicate-agent";
}

export function isMarkAgentUnreadAction(action: AgentRowAction): boolean {
  return action.id === "mark-read" || action.id === "mark-unread";
}

export function markAgentUnreadValue(action: AgentRowAction): boolean {
  return action.id === "mark-unread";
}

/** Ported from official 0.66.0 (see the @port header): the row is the user's main bot. */
export function isReplaceMainAgentAction(action: AgentRowAction): boolean {
  return action.id === "replace-main-agent";
}
