import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SandIcon } from "../../../../../ui/sand-kit-primitives";
import { ReviewButton } from "./review-button";
import { reviewCardClasses as css } from "./review-card-classes";
import { projectLeafEntry, useTranscriptCardLeafProviders, type TranscriptCardLeafProps } from "./shared";

// Formal host: selected/07-user-form-tool.js; client: chunk-view-DbO2ying.js (masked password/otp).
export function UserFormTranscriptCard(props: TranscriptCardLeafProps) {
  const entry = projectLeafEntry(props.entry);
  const form = entry?.message.type === "user-form" ? entry.message.form : null;
  const providers = useTranscriptCardLeafProviders();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("pending");
  const [saveToVault, setSaveToVault] = useState(true);
  const busy = useRef(false);
  const titleId = useId();
  const lifecycle = entry?.userFormState;
  const terminal = entry?.formResolution ?? (lifecycle === "pending" || lifecycle === "shown" ? undefined : lifecycle);
  // Transcript staleness/turn completion does not expire an outstanding host form.
  useEffect(() => { setValues({}); setStatus(terminal ?? "pending"); }, [form?.id, terminal, providers?.scope.agentId, providers?.scope.accountSlot]);
  if (entry == null || form == null) return null;
  const actions = providers?.serverPortActions;
  const agentId = providers?.scope.agentId;
  const canAct = actions != null && agentId != null && terminal == null && (status === "pending" || status === "failed" || status === "invalid_values");
  const vaultCard = form.saveToVault === "card";
  const vaultBridge = vaultCard ? (window.desktop as { vault?: { createGrokBotVaultCard?: (args: unknown) => Promise<unknown> } } | undefined)?.vault : undefined;
  const saveVaultCard = vaultCard && vaultBridge != null && typeof vaultBridge.createGrokBotVaultCard === "function" ? vaultBridge.createGrokBotVaultCard.bind(vaultBridge) : null;
  const vaultSaveAvailable = saveVaultCard != null;
  const valid = form.fields.every((field) => !field.required || (field.type === "checkbox" ? values[field.id] === true : typeof values[field.id] === "string" && String(values[field.id]).trim().length > 0));
  async function resolve(submit: boolean) {
    if (!canAct || busy.current || actions == null || agentId == null || form == null) return;
    busy.current = true;
    const submitted = values;
    setValues({});
    setStatus("submitting");
    try {
      if (submit && saveVaultCard != null && saveToVault) {
        // 0.78.1 secure card contract: values go to the desktop Vault; the submitted
        // receipt only reports per-field outcomes. cc_nickname / save_billing_address
        // are official form fields our local card create does not take — stripped here.
        const allowed = new Set(["cc_number", "cc_exp", "cc_csc", "cc_name", "billing_line1", "billing_line2", "billing_city", "billing_region", "billing_postal_code", "billing_country"]);
        const cardValues: Record<string, string> = {};
        for (const [id, value] of Object.entries(submitted)) {
          if (allowed.has(id) && typeof value === "string") cardValues[id] = value;
        }
        await saveVaultCard({ values: cardValues });
      }
      setStatus(submit ? await actions.submitUserForm({agentId, requestId: form.id, values: submitted}) : await actions.dismissUserForm({agentId, requestId: form.id}));
    } catch {
      // Never render/log exceptions: a connector may include submitted credentials in its error.
      setStatus("failed");
    } finally { busy.current = false; }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (valid) void resolve(true); };
  return <form aria-labelledby={titleId} className={css.formShell} onSubmit={submit} autoComplete="off">
    <div className={`${css.widget} ${css.card}`}>
    <div className={css.formHeaderRow}><h3 className={css.formTitle} id={titleId}>{form.title}</h3><span className={css.formLock}><SandIcon name="lock" size="xs" /><span>{form.domain ?? "Destination unknown"}</span></span></div>
    <p className={css.formLabelText}>{form.instruction}</p>
    {vaultCard
      ? <p className={css.formLabelText}>Never shown to your Bot</p>
      : <p className={css.formLabelText}>{form.submitAfterFill ? "Fill and submit this page by pressing Enter" : "Fill fields only; the page will not be submitted"}</p>}
    <div className={css.formGrid}>
    {form.fields.map((field) => {
      const secret = field.secret === true || field.type === "password" || field.type === "otp";
      const value = typeof values[field.id] === "string" ? String(values[field.id]) : "";
      const change = (value: string | boolean) => setValues((current) => ({...current, [field.id]: value}));
      return <div className={css.formField} key={field.id}>
        <label className={css.formLabelText} htmlFor={`review-form-${form.id}-${field.id}`}>{field.label}</label>
        <div className={css.formControlFrame}>
        {secret ? <input id={`review-form-${form.id}-${field.id}`} className={css.formControl} type="password" autoComplete="off" spellCheck={false} disabled={!canAct} aria-required={field.required === true} value={value} onChange={(event) => change(event.currentTarget.value)} />
          : field.type === "select" ? <select id={`review-form-${form.id}-${field.id}`} className={css.formControl} disabled={!canAct} aria-required={field.required === true} value={value} onChange={(event) => change(event.currentTarget.value)}><option value="" />{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : field.type === "textarea" ? <textarea id={`review-form-${form.id}-${field.id}`} className={css.formControl} disabled={!canAct} aria-required={field.required === true} value={value} onChange={(event) => change(event.currentTarget.value)} />
          : field.type === "checkbox" ? <input id={`review-form-${form.id}-${field.id}`} className={css.formControl} type="checkbox" disabled={!canAct} aria-required={field.required === true} checked={values[field.id] === true} onChange={(event) => change(event.currentTarget.checked)} />
          : <input id={`review-form-${form.id}-${field.id}`} className={css.formControl} type={field.type} autoComplete="off" spellCheck={false} disabled={!canAct} aria-required={field.required === true} placeholder={field.placeholder} value={value} onChange={(event) => change(event.currentTarget.value)} />}
        </div>
      </div>;
    })}
    </div>
    {vaultCard && vaultSaveAvailable ? (
      <label className={css.formLabelText}>
        <input type="checkbox" checked={saveToVault} onChange={(event) => setSaveToVault(event.currentTarget.checked)} />
        {" Securely save to Bot's vault"}
      </label>
    ) : null}
    <div className={css.actions}>
      <ReviewButton type="submit" disabled={!canAct || !valid}>{vaultCard ? (vaultSaveAvailable ? "Save card" : "Continue") : form.submitAfterFill ? "Fill and submit" : "Fill fields"}</ReviewButton>
      <ReviewButton type="button" variant="secondary" disabled={!canAct} onClick={() => { void resolve(false); }}>Cancel</ReviewButton>
    </div>
    <p className={status === "failed" ? css.formError : css.formLabelText} role={status === "failed" ? "alert" : "status"}>{status === "failed" ? "Unable to confirm the form action. Values cleared." : terminal ?? status}</p>
    </div>
  </form>;
}
