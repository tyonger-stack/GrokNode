import { useDraftActions, draftStatusLabels } from "./draft-actions";
import { draftStatusClass, reviewCardClasses as css } from "./review-card-classes";
import { ReviewButton } from "./review-button";
import { useId, useState, type FormEvent } from "react";
import type { EmailDraft } from "../protocol";
import { projectLeafEntry, visualLineCount, type TranscriptCardLeafProps } from "./shared";

// @evidence src/app/dist/renderer/assets/view-ClhdNXKM.js#byteOffset=0 (email-draft card leaf)
// @evidence src/app/dist/renderer/assets/view-ClhdNXKM.js#byteOffset=838 (email validation, collapse, status, and presentation lifecycle)
// @evidence src/app/dist/renderer/assets/view-ClhdNXKM.js#byteOffset=10227 (shipped empty send/discard callbacks)

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function parseRecipients(value: string): string[] {
  return value.split(",").map((recipient) => recipient.trim()).filter((recipient) => recipient.length > 0);
}

function EmailSent({ draft, titleId }: { draft: EmailDraft; titleId: string }) {
  const firstRecipient = (draft.to ?? [])[0] ?? "";
  return <section aria-labelledby={titleId} className={`sand-email-composer ${css.widget} ${css.card}`} role="region"><div className={css.header}><span className={css.title} id={titleId}>New email</span><span className={css.statusSent} role="status">Sent</span></div><span className={css.summary}>Sent to {firstRecipient} — “{draft.subject}”</span></section>;
}

export function EmailDraftTranscriptCard(props: TranscriptCardLeafProps) {
  const entry = projectLeafEntry(props.entry);
  const draft = entry?.message.type === "email-draft" ? entry.message.draft : null;
  const initialRecipients = (draft?.to ?? []).join(", ");
  const initialDraft = draft ?? { subject: "", body: "" };
  const [recipientsValue, setRecipientsValue] = useState(initialRecipients);
  const [from, setFrom] = useState(draft?.from ?? "");
  const [cc, setCc] = useState(draft?.cc?.join(", ") ?? "");
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const action = useDraftActions(entry?.id, entry?.draftSendState, props.isStale);
  const [signature, setSignature] = useState(draft?.signature ?? "");
  const [attachments, setAttachments] = useState(draft?.attachments ?? []);
  if (entry == null || entry.message.type !== "email-draft" || draft == null) return null;
  const status = action.state;
  const recipients = parseRecipients(recipientsValue);
  const valid = action.enabled && recipients.length > 0 && [...recipients, ...parseRecipients(cc), from].every((recipient) => emailPattern.test(recipient)) && body.trim().length > 0;
  const collapsed = visualLineCount(body) > 8 && !expanded;
  const disabled = !action.enabled;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (valid) void action.run({type: "email-draft", draft: {...draft, to: recipients, cc: parseRecipients(cc), from, subject, body, signature, attachments}}); };
  if (status === "sent") return <EmailSent draft={draft} titleId={titleId} />;
  return <form aria-labelledby={titleId} className={`sand-email-composer ${css.widget} ${css.card}`} onSubmit={submit}>
    <div className={css.header}><h3 className={css.title} id={titleId}>New email</h3><span className={draftStatusClass(status)} role="status">{draftStatusLabels[status]}</span></div>
    <div className={css.group}>
    <label className={css.row}>From<input className={`sand-email-composer__input ${css.input}`} disabled={disabled} value={from} onChange={(event) => setFrom(event.currentTarget.value)} /></label>
    <label className={css.row}>Cc<input className={`sand-email-composer__input ${css.input}`} disabled={disabled} value={cc} onChange={(event) => setCc(event.currentTarget.value)} /></label>
    <label className={css.row}><span>To</span><input autoComplete="off" className={`sand-email-composer__input ${css.input}`} disabled={disabled} onChange={(event) => setRecipientsValue(event.currentTarget.value)} placeholder="name@example.com" spellCheck={false} type="text" value={recipientsValue} /></label>
    <label className={css.row}><span>Subject</span><input autoComplete="off" className={`sand-email-composer__input ${css.input}`} disabled={disabled} onChange={(event) => setSubject(event.currentTarget.value)} placeholder="Subject" spellCheck type="text" value={subject} /></label>
    <div className={css.bodyStack}>{collapsed ? <p className={css.preview}>{body}</p> : <textarea aria-label="Message" autoComplete="off" className={`sand-email-composer__body ${css.body}`} disabled={disabled} onChange={(event) => setBody(event.currentTarget.value)} placeholder="Write a message" rows={4} spellCheck value={body} />}
      <textarea aria-label="Signature" autoComplete="off" className={css.signature} disabled={disabled} onChange={(event) => setSignature(event.currentTarget.value)} placeholder="Signature" rows={2} spellCheck value={signature} />
    </div>
    {status === "editable" && visualLineCount(body) > 8 ? <ReviewButton variant="secondary" onClick={() => setExpanded((value) => !value)} type="button">{expanded ? "Show less" : "Show more"}</ReviewButton> : null}
    {attachments.map((attachment) => <div className={css.row} key={attachment.id}><span className={css.summary}>{attachment.name}</span><ReviewButton variant="secondary" type="button" disabled={disabled} aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}>Remove</ReviewButton></div>)}
    </div>
    {action.rejected ? <p className={css.summary} role="alert">Action was not accepted. Review the draft before trying again.</p> : null}
    <div className={css.actions}><ReviewButton disabled={!valid} sending={status === "sending"} type="submit">{status === "sending" ? "Sending…" : "Send email"}</ReviewButton><ReviewButton variant="secondary" disabled={disabled} onClick={() => { void action.run(); }} type="button">Discard</ReviewButton></div>
  </form>;
}

export default EmailDraftTranscriptCard;
