import { useDraftActions, draftStatusLabels } from "./draft-actions";
import { draftStatusClass, reviewCardClasses as css } from "./review-card-classes";
import { useId, useState, type FormEvent } from "react";
import type { SlackDraft } from "../protocol";
import { SandIcon } from "../../../../../ui/sand-kit-primitives";
import { ReviewButton } from "./review-button";
import { projectLeafEntry, visualLineCount, boundedFirstLine, type TranscriptCardLeafProps } from "./shared";

// @evidence src/app/dist/renderer/assets/view-DyaeCHiE.js#byteOffset=0 (Slack-draft card leaf)
// @evidence src/app/dist/renderer/assets/view-DyaeCHiE.js#byteOffset=800 (Slack validation, collapse, status, and presentation lifecycle)
// @evidence src/app/dist/renderer/assets/view-DyaeCHiE.js#byteOffset=9687 (shipped empty send/discard callbacks)

function SlackSent({ draft, titleId }: { draft: SlackDraft; titleId: string }) {
  return <section aria-labelledby={titleId} className={`sand-slack-composer ${css.widget} ${css.card}`} role="region"><div className={css.header}><SandIcon name="logo-slack" /><span className={css.title} id={titleId}>Slack message</span><span className={css.statusSent} role="status">Sent</span></div><span className={css.summary}>Sent to {draft.target} — “{boundedFirstLine(draft.body)}”</span></section>;
}

export function SlackDraftTranscriptCard(props: TranscriptCardLeafProps) {
  const entry = projectLeafEntry(props.entry);
  const draft = entry?.message.type === "slack-draft" ? entry.message.draft : null;
  const initialDraft = draft ?? { target: "", body: "" };
  const [target, setTarget] = useState(draft?.target ?? "");
  const [body, setBody] = useState(initialDraft.body);
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const action = useDraftActions(entry?.id, entry?.draftSendState, props.isStale);
  const [signature, setSignature] = useState(draft?.signature ?? "");
  const [attachments, setAttachments] = useState(draft?.attachments ?? []);
  if (entry == null || entry.message.type !== "slack-draft" || draft == null) return null;
  const status = action.state;
  const valid = action.enabled && body.trim().length > 0;
  const collapsed = visualLineCount(body) > 8 && !expanded;
  const disabled = !action.enabled;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (valid) void action.run({type: "slack-draft", draft: {...draft, target, body, signature, attachments}}); };
  if (status === "sent") return <SlackSent draft={draft} titleId={titleId} />;
  return <form aria-labelledby={titleId} className={`sand-slack-composer ${css.widget} ${css.card}`} onSubmit={submit}>
    <div className={css.header}><h3 className={css.title} id={titleId}><SandIcon name="logo-slack" />Slack message</h3><span className={draftStatusClass(status)} role="status">{draftStatusLabels[status]}</span></div>
    <div className={css.group}>
    <label className={css.row}>To<input className={css.input} disabled={disabled} value={target} onChange={(event) => setTarget(event.currentTarget.value)} /></label>
    <div className={css.row}><span>Thread</span><span className={css.summary}>{draft.thread == null ? "New message" : `Reply in “${draft.thread}”`}</span></div>
    <div className={css.bodyStack}>{collapsed ? <p className={css.preview}>{body}</p> : <textarea aria-label="Message" autoComplete="off" className={`sand-slack-composer__body ${css.body}`} disabled={disabled} onChange={(event) => setBody(event.currentTarget.value)} placeholder="Write a message" rows={4} spellCheck value={body} />}
      <textarea aria-label="Signature" autoComplete="off" className={css.signature} disabled={disabled} onChange={(event) => setSignature(event.currentTarget.value)} placeholder="Signature" rows={2} spellCheck value={signature} />
    </div>
    {status === "editable" && visualLineCount(body) > 8 ? <ReviewButton variant="secondary" onClick={() => setExpanded((value) => !value)} type="button">{expanded ? "Show less" : "Show more"}</ReviewButton> : null}
    {attachments.map((attachment) => <div className={css.row} key={attachment.id}><span className={css.summary}>{attachment.name}</span><ReviewButton variant="secondary" type="button" disabled={disabled} aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}>Remove</ReviewButton></div>)}
    </div>
    {action.rejected ? <p className={css.summary} role="alert">Action was not accepted. Review the draft before trying again.</p> : null}
    <div className={css.actions}><ReviewButton disabled={!valid} sending={status === "sending"} type="submit">{status === "sending" ? "Sending…" : "Send message"}</ReviewButton><ReviewButton variant="secondary" disabled={disabled} onClick={() => { void action.run(); }} type="button">Discard</ReviewButton></div>
  </form>;
}

export default SlackDraftTranscriptCard;
