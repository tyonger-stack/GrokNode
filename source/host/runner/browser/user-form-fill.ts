import { z } from "zod";
import type { UserFormField, UserFormFieldOutcome } from "../../../shared/user-forms.js";
import { USER_FORM_PRIVATE_DRIVER_SOURCE } from "./user-form-private-driver.js";

export type UserFormFillEntry = { readonly field: UserFormField; readonly value: string | boolean };
export type UserFormFillInput = {
  readonly probeOnly?: boolean;
  readonly agentId: string; readonly entries: readonly UserFormFillEntry[];
  readonly domain: string | undefined; readonly submitAfterFill: boolean; readonly signal: AbortSignal;
};
const fillResultSchema = z.object({
  fields: z.array(z.object({ id: z.string(), status: z.enum(["filled", "not_filled", "failed"]), reason: z.enum(["driver_unavailable", "page_moved", "domain_mismatch", "stale_locator", "fill_failed"]).optional() }).strict()),
  submit: z.object({ attempted: z.boolean(), succeeded: z.boolean().optional() }).strict().optional(),
}).strict();
export type UserFormFillResult = z.infer<typeof fillResultSchema>;
export type PrivateUserFormFill = (input: UserFormFillInput) => Promise<UserFormFillResult>;
export interface PrivateUserFormBox {
  readonly windowIndex: number;
  readonly terminalsFolder: string;
  upload(path: string, bytes: Uint8Array): Promise<void>;
  download(path: string, options: { readonly maxBytes: number }): Promise<Uint8Array>;
  spawn(input: { readonly command: string; readonly suppressStdinLogging: true; readonly signal: AbortSignal }): Promise<{ readonly shellId: number; readonly stdinLoggingSuppressed: true }>;
  writeStdin(shellId: number, chars: string): Promise<void>;
  terminate(shellId: number): Promise<void>;
}
export function createPrivateUserFormFill(resolveBox: (agentId: string) => Promise<PrivateUserFormBox | undefined>): PrivateUserFormFill {
  return async input => {
    const failed = (): UserFormFillResult => ({ fields: input.entries.map(({ field }): UserFormFieldOutcome => ({ id: field.id, status: "failed", reason: "driver_unavailable" })) });
    if (!input.entries.some(entry => entry.field.target)) return { fields: input.entries.map(entry => ({ id: entry.field.id, status: "not_filled" })) };
    let box: PrivateUserFormBox | undefined;
    let shellId: number | undefined;
    let cancel: (() => void) | undefined;
    try {
      box = await resolveBox(input.agentId);
      if (!box || !Number.isInteger(box.windowIndex) || box.windowIndex < 0 || input.signal.aborted || !input.domain) return failed();
      const path = "/tmp/.sand-user-form-private.mjs";
      await box.upload(path, Buffer.from(USER_FORM_PRIVATE_DRIVER_SOURCE));
      if (input.signal.aborted) return failed();
      const spawned = await box.spawn({ command: `node ${path} --stdin`, suppressStdinLogging: true, signal: input.signal });
      shellId = spawned.shellId;
      const activeBox = box;
      const activeShellId = shellId;
      cancel = () => { void activeBox.terminate(activeShellId).catch(() => { console.warn("user_form_private_cleanup_failed"); }); };
      input.signal.addEventListener("abort", cancel, { once: true });
      if (spawned.stdinLoggingSuppressed !== true || input.signal.aborted) return failed();
      await box.writeStdin(shellId, JSON.stringify({ cdpPort: 9222 + box.windowIndex, domain: input.domain, entries: input.entries, submitAfterFill: input.submitAfterFill, probeOnly: input.probeOnly === true }) + "\n");
      const deadline = Date.now() + 30_000;
      while (!input.signal.aborted && Date.now() < deadline) {
        // The background terminal file may not exist until the process produces output.
        const bytes = await box.download(`${box.terminalsFolder}/${shellId}.txt`, { maxBytes: 512 * 1024 }).catch(() => undefined);
        const output = bytes === undefined ? "" : Buffer.from(bytes).toString("utf8");
        const line = output.split("\n").find(line => line.startsWith("__USER_FORM_RESULT__"));
        if (line) {
          const parsed = fillResultSchema.safeParse(JSON.parse(line.slice("__USER_FORM_RESULT__".length)));
          if (!parsed.success || parsed.data.fields.length !== input.entries.length || parsed.data.fields.some((field, i) => field.id !== input.entries[i]?.field.id)) return failed();
          return parsed.data;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
      return failed();
    } catch { // Private transport boundary: never propagate driver errors that could echo values.
      return failed();
    } finally {
      if (cancel) input.signal.removeEventListener("abort", cancel);
      if (box && shellId !== undefined) {
        try { await box.terminate(shellId); }
        catch { console.warn("user_form_private_cleanup_failed"); }
      }
    }
  };
}
