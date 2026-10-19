import { randomUUID } from "node:crypto";
import { dismissUserFormRequestSchema, submitUserFormRequestSchema, remapUserFormTargetsParameters, requestUserFormParameters, normalizeUserFormDomain, isSecretUserFormField } from "../../../shared/user-forms.js";
import type { UserForm, UserFormMessage, UserFormReceipt } from "../../../shared/user-forms.js";
import type { PrivateUserFormFill, UserFormFillEntry, UserFormFillResult } from "../../runner/browser/user-form-fill.js";

type Pending = {
  readonly agentId: string; turnId: string; readonly form: UserForm; entryId?: string;
  readonly controller: AbortController; readonly timer: ReturnType<typeof setTimeout>;
  entries: UserFormFillEntry[]; busy: boolean; submitted: boolean; remapped: boolean;
};
export interface UserFormServiceDependencies {
  emitForm(agentId: string, message: UserFormMessage): Promise<string>;
  onStateChange?(agentId: string, entryId: string, receipt: UserFormReceipt): Promise<void>;
  onReceipt?(agentId: string, receipt: UserFormReceipt): Promise<void>;
  onError?(code: "form_emit_failed" | "form_fill_failed" | "form_callback_failed"): void;
  readonly privateFill: PrivateUserFormFill;
  readonly timeoutMs?: number;
}
export class UserFormService {
  readonly #pending = new Map<string, Pending>();
  readonly #remapSpent = new Set<string>();
  constructor(readonly deps: UserFormServiceDependencies) {}
  async request(agentId: string, turnId: string, raw: unknown): Promise<UserFormReceipt> {
    const parsed = requestUserFormParameters.parse(raw);
    const domain = parsed.domain === undefined ? undefined : normalizeUserFormDomain(parsed.domain);
    const form: UserForm = { ...parsed, ...(domain === undefined ? {} : { domain }), id: randomUUID(), fields: parsed.fields.map(field => ({ ...field, secret: isSecretUserFormField(field) })) };
    const pending: Pending = { agentId, turnId, form, controller: new AbortController(), entries: [], busy: false, submitted: false, remapped: false,
      timer: setTimeout(() => {
        this.#clear(form.id);
        void this.#notify(pending, { requestId: form.id, status: "expired" }, true);
      }, this.deps.timeoutMs ?? 300_000) };
    pending.timer.unref();
    this.#pending.set(form.id, pending);
    try {
      if (form.fields.some(field => field.target)) {
        const probe = await this.deps.privateFill({ agentId, domain: form.domain, entries: form.fields.map(field => ({ field, value: field.type === "checkbox" ? false : "" })), submitAfterFill: false, probeOnly: true, signal: pending.controller.signal });
        if (pending.controller.signal.aborted || probe.fields.some(field => field.status === "failed")) {
          this.#clear(form.id);
          return { requestId: form.id, status: "unavailable", fields: probe.fields.map(({ id, status, reason }) => ({ id, status: status === "filled" ? "not_filled" : status, ...(reason ? { reason } : {}) })) };
        }
      }
      pending.entryId = await this.deps.emitForm(agentId, { type: "user-form", form });
      if (pending.controller.signal.aborted) await this.#notify(pending, { requestId: form.id, status: "expired" }, false);
    }
    catch { this.#reportError("form_emit_failed"); this.#clear(form.id); return { requestId: form.id, status: "unavailable" }; }
    return { requestId: form.id, status: this.#pending.has(form.id) ? "shown" : "expired" };
  }
  async submit(raw: unknown): Promise<UserFormReceipt> {
    const parsed = submitUserFormRequestSchema.safeParse(raw);
    if (!parsed.success) return { requestId: "", status: "invalid_values" };
    const { agentId, requestId, values } = parsed.data;
    const pending = this.#pending.get(requestId);
    if (!pending || pending.agentId !== agentId || pending.busy || pending.submitted) return { requestId, status: "unavailable" };
    const invalid = Object.keys(values).some(id => !pending.form.fields.some(field => field.id === id)) || pending.form.fields.some(field => {
      const value = values[field.id];
      if (value === undefined) return field.required === true;
      if (field.type === "checkbox") return typeof value !== "boolean" || (field.required === true && !value);
      return typeof value !== "string" || (field.required === true && value.trim() === "") || (field.type === "select" && !field.options?.some(option => option.value === value));
    });
    if (invalid) return { requestId, status: "invalid_values" };
    pending.submitted = true;
    pending.entries = pending.form.fields.flatMap(field => {
      const value = values[field.id];
      return value === undefined ? [] : [{ field, value }];
    });
    for (const key of Object.keys(values)) delete values[key];
    return this.#fill(pending, false);
  }
  async remap(agentId: string, turnId: string, raw: unknown): Promise<UserFormReceipt> {
    const parsed = remapUserFormTargetsParameters.safeParse(raw);
    const pending = [...this.#pending.values()].find(p => p.agentId === agentId && p.turnId === turnId && p.submitted && !p.busy && !p.remapped && p.entries.length > 0);
    if (!pending || !parsed.success || this.#remapSpent.has(JSON.stringify([agentId, turnId]))) return { requestId: pending?.form.id ?? "", status: "unavailable" };
    const targets = parsed.data.targets;
    if (new Set(targets.map(t => t.fieldId)).size !== targets.length || targets.some(t => !pending.entries.some(e => e.field.id === t.fieldId))) return { requestId: pending.form.id, status: "unavailable" };
    pending.remapped = true;
    this.#remapSpent.add(JSON.stringify([agentId, turnId]));
    pending.entries = targets.flatMap(target => {
      const entry = pending.entries.find(e => e.field.id === target.fieldId);
      return entry ? [{ field: { ...entry.field, target: target.target }, value: entry.value }] : [];
    });
    return this.#fill(pending, true);
  }
  dismiss(raw: unknown): UserFormReceipt {
    const { agentId, requestId } = dismissUserFormRequestSchema.parse(raw);
    if (this.#pending.get(requestId)?.agentId !== agentId) return { requestId, status: "unavailable" };
    const pending = this.#pending.get(requestId);
    this.#clear(requestId);
    if (pending) void this.#notify(pending, { requestId, status: "dismissed" }, true);
    return { requestId, status: "dismissed" };
  }
  activateResumeTurn(agentId: string, newTurnId: string, requestId?: string): void {
    for (const pending of this.#pending.values()) {
      if (pending.agentId !== agentId || !pending.submitted || pending.busy) continue;
      // With a request id this is a lease for exactly that form's receipt, so a
      // background routine waking the agent cannot inherit another form's hold.
      if (requestId !== undefined && pending.form.id !== requestId) continue;
      pending.turnId = newTurnId;
    }
  }
  settleTurn(agentId: string, turnId: string, reason: "stopped" | "turn_ended" = "turn_ended"): readonly UserFormReceipt[] {
    this.#remapSpent.delete(JSON.stringify([agentId, turnId]));
    return [...this.#pending.values()].filter(p => p.agentId === agentId && (reason === "stopped" || (p.turnId === turnId && p.submitted))).map(p => {
      this.#clear(p.form.id);
      const receipt: UserFormReceipt = { requestId: p.form.id, status: reason };
      void this.#notify(p, receipt, false);
      return receipt;
    });
  }
  dispose(): readonly UserFormReceipt[] {
    const receipts = [...this.#pending.values()].map(pending => {
      this.#clear(pending.form.id);
      // Instance shutdown never wakes a bot; only the card learns the outcome.
      const receipt: UserFormReceipt = { requestId: pending.form.id, status: "stopped" };
      void this.#notify(pending, receipt, false);
      return receipt;
    });
    this.#remapSpent.clear();
    return receipts;
  }
  async expireAll(): Promise<void> {
    const pending = [...this.#pending.values()];
    this.#remapSpent.clear();
    await Promise.all(pending.map(async item => {
      this.#clear(item.form.id);
      // Recovery marks stale cards expired and never wakes a bot for them.
      await this.#notify(item, { requestId: item.form.id, status: "expired" }, false);
    }));
  }
  #reportError(code: "form_emit_failed" | "form_fill_failed" | "form_callback_failed"): void {
    try {
      if (this.deps.onError) this.deps.onError(code);
      else console.warn(code);
    } catch { console.warn("form_error_reporter_failed"); }
  }
  async #notify(pending: Pending, receipt: UserFormReceipt, wake: boolean): Promise<void> {
    try { if (pending.entryId) await this.deps.onStateChange?.(pending.agentId, pending.entryId, receipt); }
    catch { this.#reportError("form_callback_failed"); }
    try { if (wake) await this.deps.onReceipt?.(pending.agentId, receipt); }
    catch { this.#reportError("form_callback_failed"); }
  }
  #clear(id: string): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    pending.controller.abort();
    clearTimeout(pending.timer);
    pending.entries.length = 0;
    this.#pending.delete(id);
  }
  async #fill(pending: Pending, remap: boolean): Promise<UserFormReceipt> {
    pending.busy = true;
    let result: UserFormFillResult;
    try {
      result = await this.deps.privateFill({ agentId: pending.agentId, entries: pending.entries, domain: pending.form.domain, submitAfterFill: !remap && pending.form.submitAfterFill === true, signal: pending.controller.signal });
    } catch {
      this.#reportError("form_fill_failed");
      result = { fields: pending.entries.map(e => ({ id: e.field.id, status: "failed", reason: "fill_failed" })) };
    }
    if (pending.controller.signal.aborted) return { requestId: pending.form.id, status: "unavailable" };
    const held = new Set(remap ? [] : result.fields.filter(f => f.status === "failed" && (f.reason === "stale_locator" || f.reason === "page_moved" || f.reason === "fill_failed")).map(f => f.id));
    // Projection is deliberately explicit: private transports cannot smuggle values into receipts.
    const fields = result.fields.map(({ id, status, reason }) => ({ id, status, ...(reason === undefined ? {} : { reason }) }));
    pending.entries = pending.entries.filter(e => held.has(e.field.id));
    pending.busy = false;
    if (!pending.entries.length) this.#clear(pending.form.id);
    const receipt: UserFormReceipt = { requestId: pending.form.id, status: remap ? "remapped" : "submitted", fields,
      ...(pending.entries.length ? { remapFieldIds: pending.entries.map(e => e.field.id) } : {}),
      ...(result.submit ? { submit: { attempted: result.submit.attempted, ...(result.submit.succeeded === undefined ? {} : { succeeded: result.submit.succeeded }) } } : {}) };
    await this.#notify(pending, receipt, !remap);
    return receipt;
  }
}
