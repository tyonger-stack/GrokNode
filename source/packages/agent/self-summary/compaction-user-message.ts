/**
 * Stricter "last real user message" detection for xAI compaction
 * (evidence: host-main.cjs XaiCompactionHandler.partitionMessages).
 */

// Keep this module free of heavy action-handler imports so compaction tests can
// bundle it without pulling mime-types / whole agent graphs. The lead string
// matches `SUBAGENT_NOTIFICATION_VISIBLE_SUMMARY_LEAD` in background-task-completion.
const SUBAGENT_NOTIFICATION_VISIBLE_SUMMARY_LEAD =
  "The beginning of the above subagent result is already visible to the user.";
const SHELL_NOTIFICATION_ACKNOWLEDGEMENT_USER_QUERY_BASE =
  "Briefly inform the user about the task result and perform any follow-up actions (if needed).";
const HISTORICAL_VISIBLE_FINISHED_TURN_LEADS = [
  "A worker finished its turn, and the beginning of its result is already visible to the user, so don't repeat it unless asked.",
  "Workers finished their turns, and the beginning of each result is already visible to the user, so don't repeat them unless asked.",
] as const;
const SUBAGENT_NOTIFICATION_HIDDEN_SUMMARY_LEAD =
  "Perform any necessary follow-up actions in response to the subagent completion above.";
const USER_DRIVEN_INTERACTIVE_CHILD_LEAD = "The user is actively driving this Project child.";
const WORKER_MESSAGE_LEAD = "A worker agent sent you a message mid-turn.";
const WORKER_NEEDS_ATTENTION_LEAD = "A worker agent is paused waiting for the user to respond.";

export const SYNTHETIC_ACKNOWLEDGEMENT_USER_QUERY_PREFIXES: readonly string[] = [
  SHELL_NOTIFICATION_ACKNOWLEDGEMENT_USER_QUERY_BASE,
  SUBAGENT_NOTIFICATION_VISIBLE_SUMMARY_LEAD,
  ...HISTORICAL_VISIBLE_FINISHED_TURN_LEADS,
  SUBAGENT_NOTIFICATION_HIDDEN_SUMMARY_LEAD,
  USER_DRIVEN_INTERACTIVE_CHILD_LEAD,
  WORKER_MESSAGE_LEAD,
  WORKER_NEEDS_ATTENTION_LEAD,
];

const SYSTEM_NOTIFICATION_CLOSE_TAG = "</system_notification>";
const AGENT_MESSAGE_TURN_PROVIDER_KEY = "agentMessageTurn";

function cursorFlag(providerOptions: unknown, flag: "isSummary" | "agentMessageTurn"): boolean {
  if (typeof providerOptions !== "object" || providerOptions === null || !("cursor" in providerOptions)) return false;
  const cursor = providerOptions.cursor;
  return typeof cursor === "object" && cursor !== null && Reflect.get(cursor, flag) === true;
}

export function extractUserQueryText(text: string): string | undefined {
  const start = text.lastIndexOf("<user_query>");
  if (start === -1) return undefined;
  const contentStart = start + "<user_query>".length;
  const end = text.indexOf("</user_query>", contentStart);
  return (end === -1 ? text.slice(contentStart) : text.slice(contentStart, end)).trim();
}

export function isSyntheticUserQuery(queryText: string): boolean {
  return SYNTHETIC_ACKNOWLEDGEMENT_USER_QUERY_PREFIXES.some(prefix =>
    queryText.startsWith(prefix),
  );
}

export function isConsolidatedWakeText(text: string): boolean {
  const body = text.trimEnd();
  if (!body.endsWith(SYSTEM_NOTIFICATION_CLOSE_TAG)) return false;
  const taskClose = "</task>";
  const lastTaskClose = body.lastIndexOf(taskClose);
  if (lastTaskClose === -1) return false;
  const instruction = body
    .slice(lastTaskClose + taskClose.length, body.length - SYSTEM_NOTIFICATION_CLOSE_TAG.length)
    .trim();
  return SYNTHETIC_ACKNOWLEDGEMENT_USER_QUERY_PREFIXES.some(prefix =>
    instruction.startsWith(prefix),
  );
}

export function isAgentMessageTurnMessage(message: {
  readonly role: string;
  readonly providerOptions?: unknown;
}): boolean {
  return message.role === "user" &&
    cursorFlag(message.providerOptions, AGENT_MESSAGE_TURN_PROVIDER_KEY);
}

export function isSummaryCursorMessage(message: {
  readonly providerOptions?: unknown;
}): boolean {
  return cursorFlag(message.providerOptions, "isSummary");
}

/**
 * Prefer a real user `<user_query>` (or agent-message turn) over synthetic
 * wake / shell / subagent acknowledgement injections.
 */
export function findLastRealUserMessageForCompaction<
  TMessage extends {
    readonly role: string;
    readonly providerOptions?: unknown;
  },
>(
  messages: readonly TMessage[],
  extractText: (message: TMessage) => string,
): TMessage | undefined {
  const nonSummaryUserMessages = messages.filter(
    message => message.role === "user" && !isSummaryCursorMessage(message),
  );
  for (let index = nonSummaryUserMessages.length - 1; index >= 0; index--) {
    const message = nonSummaryUserMessages[index]!;
    if (isAgentMessageTurnMessage(message)) return message;
    const text = extractText(message);
    if (isConsolidatedWakeText(text)) continue;
    const queryText = extractUserQueryText(text);
    if (queryText !== undefined && !isSyntheticUserQuery(queryText)) return message;
  }
  return undefined;
}
