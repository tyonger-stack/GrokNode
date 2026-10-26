import { useState, type ReactNode } from "react";
import { CUSTOM_MCP_FORM_WORDING, officialWording } from "../i18n/official-marketplace-copy";

export interface CustomMcpHeaderDraft {
  readonly key: string;
  readonly value: string;
}

export interface CustomMcpServerDraft {
  readonly name: string;
  readonly url: string;
  readonly headers: readonly CustomMcpHeaderDraft[];
}

export const EMPTY_CUSTOM_MCP_DRAFT: CustomMcpServerDraft = { name: "", url: "", headers: [] };

export interface CustomMcpFormCopy {
  readonly title: string;
  readonly nameLabel: string;
  readonly urlLabel: string;
  readonly urlHint: string;
  readonly headersLabel: string;
  readonly addHeader: string;
  readonly removeHeader: string;
  readonly save: string;
  readonly cancel: string;
  readonly removeServer: string;
  readonly testConnection: string;
  readonly testing: string;
  readonly testOk: string;
  readonly testFailed: string;
  readonly requiredName: string;
  readonly invalidUrl: string;
  readonly nonHttpUrl: string;
  readonly credentialsInUrl: string;
  readonly genericError: string;
}

/**
 * Official 0.75.8's message id for every ported field; `"no-official-counterpart"` marks the
 * fields official has no message for, which keep their English text.
 */
export const CUSTOM_MCP_FORM_COPY_IDS: Record<keyof CustomMcpFormCopy, string> = {
  title: "JgMRiA",
  nameLabel: "6YtxFj",
  urlLabel: "9rG25a",
  urlHint: "no-official-counterpart",
  headersLabel: "VPpyHp",
  addHeader: "m16xKo",
  removeHeader: "t/YqKh",
  save: "tfDRzk",
  cancel: "dEgA5A",
  removeServer: "t/YqKh",
  testConnection: "no-official-counterpart",
  testing: "no-official-counterpart",
  testOk: "no-official-counterpart",
  testFailed: "FGWsd4",
  requiredName: "Ra3OR9",
  invalidUrl: "no-official-counterpart",
  nonHttpUrl: "no-official-counterpart",
  credentialsInUrl: "no-official-counterpart",
  genericError: "D2AZQg",
};

/**
 * Official 0.75.8's wording. The English side is official's too; the Chinese side is resolved at
 * render time through upstream's own locale runtime. The fields official has no message for keep
 * their English text rather than getting invented Chinese — see
 * `frontend/src/i18n/official-marketplace-copy.ts`.
 */
export const DEFAULT_CUSTOM_MCP_FORM_COPY: CustomMcpFormCopy = {
  title: CUSTOM_MCP_FORM_WORDING.title.en,
  nameLabel: CUSTOM_MCP_FORM_WORDING.nameLabel.en,
  urlLabel: CUSTOM_MCP_FORM_WORDING.urlLabel.en,
  urlHint: "https://example.com/mcp",
  headersLabel: CUSTOM_MCP_FORM_WORDING.headersLabel.en,
  addHeader: CUSTOM_MCP_FORM_WORDING.addHeader.en,
  removeHeader: CUSTOM_MCP_FORM_WORDING.removeHeader.en,
  save: CUSTOM_MCP_FORM_WORDING.save.en,
  cancel: CUSTOM_MCP_FORM_WORDING.cancel.en,
  removeServer: CUSTOM_MCP_FORM_WORDING.removeServer.en,
  testConnection: "Test connection",
  testing: "Testing…",
  testOk: "Connection works.",
  testFailed: CUSTOM_MCP_FORM_WORDING.testFailed.en,
  requiredName: CUSTOM_MCP_FORM_WORDING.requiredName.en,
  invalidUrl: "That is not a valid URL. Enter the server's full https endpoint.",
  nonHttpUrl: "The server URL must be http(s). Grok Bot only connects remote http/sse MCP servers.",
  credentialsInUrl: "Don't put credentials in the server URL — pass them as headers instead.",
  genericError: CUSTOM_MCP_FORM_WORDING.genericError.en,
};

export function customMcpFormCopy(override?: Partial<CustomMcpFormCopy>): CustomMcpFormCopy {
  return {
    ...DEFAULT_CUSTOM_MCP_FORM_COPY,
    title: officialWording(CUSTOM_MCP_FORM_WORDING.title),
    nameLabel: officialWording(CUSTOM_MCP_FORM_WORDING.nameLabel),
    urlLabel: officialWording(CUSTOM_MCP_FORM_WORDING.urlLabel),
    headersLabel: officialWording(CUSTOM_MCP_FORM_WORDING.headersLabel),
    addHeader: officialWording(CUSTOM_MCP_FORM_WORDING.addHeader),
    removeHeader: officialWording(CUSTOM_MCP_FORM_WORDING.removeHeader),
    save: officialWording(CUSTOM_MCP_FORM_WORDING.save),
    cancel: officialWording(CUSTOM_MCP_FORM_WORDING.cancel),
    removeServer: officialWording(CUSTOM_MCP_FORM_WORDING.removeServer),
    testFailed: officialWording(CUSTOM_MCP_FORM_WORDING.testFailed),
    requiredName: officialWording(CUSTOM_MCP_FORM_WORDING.requiredName),
    genericError: officialWording(CUSTOM_MCP_FORM_WORDING.genericError),
    ...override,
  };
}

export type CustomMcpDraftError = "required-name" | "invalid-url" | "non-http-url" | "credentials-in-url";

export function validateCustomMcpDraft(draft: CustomMcpServerDraft): CustomMcpDraftError | null {
  if (draft.name.trim() === "") return "required-name";
  let parsed: URL;
  try {
    parsed = new URL(draft.url.trim());
  } catch {
    return "invalid-url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "non-http-url";
  if (parsed.username !== "" || parsed.password !== "") return "credentials-in-url";
  return null;
}

export function customMcpDraftErrorMessage(copy: CustomMcpFormCopy, error: CustomMcpDraftError): string {
  switch (error) {
    case "required-name": return copy.requiredName;
    case "invalid-url": return copy.invalidUrl;
    case "non-http-url": return copy.nonHttpUrl;
    case "credentials-in-url": return copy.credentialsInUrl;
  }
}

export function customMcpConfigJson(draft: CustomMcpServerDraft): string | null {
  const url = draft.url.trim();
  if (url === "") return null;
  const headers: Record<string, string> = {};
  for (const header of draft.headers) {
    if (header.key.trim() !== "") headers[header.key.trim()] = header.value;
  }
  return JSON.stringify({
    type: "http",
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
}

export type CustomMcpTestState = "idle" | "testing" | "ok" | "failed";

export function CustomMcpForm(props: {
  readonly initial?: CustomMcpServerDraft;
  readonly copy?: Partial<CustomMcpFormCopy>;
  readonly testState?: CustomMcpTestState;
  readonly testMessage?: string;
  readonly submitError?: string | null;
  readonly disabled?: boolean;
  readonly onSubmit: (draft: CustomMcpServerDraft) => void;
  readonly onTest?: () => void;
  readonly onCancel: () => void;
  readonly onRemove?: () => void;
}): ReactNode {
  const copy: CustomMcpFormCopy = customMcpFormCopy(props.copy);
  const [draft, setDraft] = useState<CustomMcpServerDraft>(props.initial ?? EMPTY_CUSTOM_MCP_DRAFT);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const error = validateCustomMcpDraft(draft);
  const setHeader = (index: number, patch: Partial<CustomMcpHeaderDraft>): void => {
    setDraft((current) => ({
      ...current,
      headers: current.headers.map((header, at) => at === index ? { ...header, ...patch } : header),
    }));
  };
  const saveDisabled = props.disabled === true || error != null;
  return (
    <div className="sand-custom-mcp-form">
      <h2 className="sand-custom-mcp-form-title">{copy.title}</h2>
      <label className="sand-custom-mcp-field">
        <span>{copy.nameLabel}</span>
        <input aria-label={copy.nameLabel} disabled={props.disabled} name="customMcpName" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} value={draft.name} />
      </label>
      <label className="sand-custom-mcp-field">
        <span>{copy.urlLabel}</span>
        <input aria-label={copy.urlLabel} disabled={props.disabled} inputMode="url" name="customMcpUrl" onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder={copy.urlHint} value={draft.url} />
      </label>
      <div className="sand-custom-mcp-headers">
        <span>{copy.headersLabel}</span>
        {draft.headers.map((header, index) => (
          <div className="sand-custom-mcp-header-row" key={index}>
            <input aria-label={officialWording(CUSTOM_MCP_FORM_WORDING.headerKeyLabel)} disabled={props.disabled} onChange={(event) => setHeader(index, { key: event.target.value })} placeholder="Authorization" value={header.key} />
            <input aria-label={officialWording(CUSTOM_MCP_FORM_WORDING.headerValueLabel)} disabled={props.disabled} onChange={(event) => setHeader(index, { value: event.target.value })} placeholder="Bearer …" value={header.value} />
            <button aria-label={copy.removeHeader} disabled={props.disabled} onClick={() => setDraft((current) => ({ ...current, headers: current.headers.filter((_, at) => at !== index) }))} type="button">×</button>
          </div>
        ))}
        <button disabled={props.disabled} onClick={() => setDraft((current) => ({ ...current, headers: [...current.headers, { key: "", value: "" }] }))} type="button">{copy.addHeader}</button>
      </div>
      {error == null ? null : <p className="sand-custom-mcp-error" role="alert">{customMcpDraftErrorMessage(copy, error)}</p>}
      {props.testState === "testing" ? <p className="sand-custom-mcp-status" role="status">{copy.testing}</p> : null}
      {props.testState === "ok" ? <p className="sand-custom-mcp-status" role="status">{copy.testOk}</p> : null}
      {props.testState === "failed" ? <p className="sand-custom-mcp-error" role="alert">{props.testMessage ?? copy.testFailed}</p> : null}
      {props.submitError == null || props.submitError === "" ? null : <p className="sand-custom-mcp-error" role="alert">{props.submitError}</p>}
      <div className="sand-custom-mcp-form-actions">
        {props.onTest == null ? null : <button disabled={props.disabled || props.testState === "testing"} onClick={props.onTest} type="button">{copy.testConnection}</button>}
        <button disabled={saveDisabled} onClick={() => props.onSubmit(draft)} type="button">{copy.save}</button>
        <button onClick={props.onCancel} type="button">{copy.cancel}</button>
        {props.onRemove == null ? null : confirmingRemove
          ? <span className="sand-custom-mcp-remove-confirm">
            <button onClick={() => { setConfirmingRemove(false); props.onRemove?.(); }} type="button">{copy.removeServer}</button>
            <button onClick={() => setConfirmingRemove(false)} type="button">{copy.cancel}</button>
          </span>
          : <button onClick={() => setConfirmingRemove(true)} type="button">{copy.removeServer}</button>}
      </div>
    </div>
  );
}
