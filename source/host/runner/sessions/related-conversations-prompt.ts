export const READ_TRANSCRIPT_TOOL_NAME = "ReadTranscript";
export const GROK_BOT_RELATED_CONVERSATIONS_MAX = 8;

export const RELATED_CONVERSATIONS_LEAD =
  `Related conversations: other conversations of yours that people in this conversation took part in and can see from here. Links only; nothing from them is copied into this prompt. When the current conversation refers to one, open it with ${READ_TRANSCRIPT_TOOL_NAME} (session_id) and say that you did.`;

export interface RelatedConversationLink {
  readonly sessionId: string;
  readonly label: string;
  readonly url?: string;
}

export interface RelatedConversationsSnapshot {
  readonly render: string;
  readonly compactionEpoch: number;
  readonly announcedRender?: string | undefined;
}

export interface RelatedConversationsUpdate {
  readonly name: "related_conversations";
  readonly lastSeen: string;
  readonly live: string;
  readonly snapshotToPersist: RelatedConversationsSnapshot;
}

const sessionIdPattern = /^- .* \(session_id ([^\s)]+)\)/;
function sessionIdOf(line: string): string | undefined { return sessionIdPattern.exec(line)?.[1]; }
function linkLines(render: string): string[] { return render.split("\n").filter((line) => sessionIdOf(line) !== undefined); }
function renderLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : [RELATED_CONVERSATIONS_LEAD, ...lines.slice(0, GROK_BOT_RELATED_CONVERSATIONS_MAX)].join("\n");
}
function linkLine(link: RelatedConversationLink): string {
  return `- ${link.label} (session_id ${link.sessionId})${link.url === undefined ? "" : `: ${link.url}`}`;
}

export function renderRelatedConversationsPrompt(
  links: readonly (RelatedConversationLink | { readonly id: string; readonly name: string })[],
): string {
  return renderLines(links.slice(0, GROK_BOT_RELATED_CONVERSATIONS_MAX)
    .map((link) => "sessionId" in link ? link : { sessionId: link.id, label: link.name })
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId)).map(linkLine));
}

export function resolveRelatedConversationsPromptSection(args: {
  readonly snapshot: RelatedConversationsSnapshot | null;
  readonly compactionEpoch: number;
  readonly live: readonly RelatedConversationLink[] | undefined;
}): { readonly render: string | null; readonly snapshotToPersist?: RelatedConversationsSnapshot; readonly update?: RelatedConversationsUpdate } {
  if (args.live === undefined) return { render: null };
  const pinned = args.snapshot?.compactionEpoch === args.compactionEpoch ? args.snapshot : null;
  if (pinned === null) {
    const render = renderRelatedConversationsPrompt(args.live);
    return { render: render || null, snapshotToPersist: { render, compactionEpoch: args.compactionEpoch } };
  }
  const liveIds = new Set(args.live.map((link) => link.sessionId));
  const stillSeen = (render: string) => linkLines(render).filter((line) => liveIds.has(sessionIdOf(line) ?? ""));
  const render = renderLines(stillSeen(pinned.render));
  const seenLines = stillSeen(pinned.announcedRender ?? pinned.render);
  const seenIds = new Set(seenLines.map(sessionIdOf));
  const lastSeen = renderLines(seenLines);
  const announced = renderLines([...seenLines, ...args.live.filter((link) => !seenIds.has(link.sessionId))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId)).map(linkLine)]);
  const withNotes = (announcedRender: string): RelatedConversationsSnapshot => announcedRender === render
    ? { render, compactionEpoch: args.compactionEpoch } : { render, compactionEpoch: args.compactionEpoch, announcedRender };
  const kept = withNotes(lastSeen);
  const unchanged = kept.render === pinned.render && kept.announcedRender === pinned.announcedRender;
  return { render: render || null, ...(unchanged ? {} : { snapshotToPersist: kept }),
    ...(announced === lastSeen ? {} : { update: { name: "related_conversations", lastSeen, live: announced, snapshotToPersist: withNotes(announced) } }) };
}
