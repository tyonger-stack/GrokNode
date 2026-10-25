/**
 * messages-op 判决链 —— 语义移植自 0.75.8 daemon 的 handleMessagesOp
 * （rea-grokbot-0758/app/dist/local-exec-daemon/main.cjs @3000877）。
 *
 * 上游帧序：send 且无 approvalId 且宿主提供 decideLocalUse 时，先发
 * messages-accepted，再取判决；判决非 allow → 发 messages-consent-result
 * {verdict} 且不执行；判决缺省 → isLocalUseBlocked 命中发 messages-error
 * {error}；否则执行并回 messages-result。判决值对 daemon 是不透明的
 * （上游 verdict 类型未在本次证据提取中锚定，保持 JsonValue 透传）。
 */

export type MessagesVerdict = unknown;

export type MessagesConsentEvent =
  | { readonly kind: "messages-accepted" }
  | { readonly kind: "messages-consent-result"; readonly verdict: MessagesVerdict }
  | { readonly kind: "messages-error"; readonly error: string }
  | { readonly kind: "messages-result"; readonly result: unknown };

export interface MessagesConsentPorts {
  readonly decideLocalUse?: (args: { readonly op: unknown; readonly approvalId?: string }) => Promise<MessagesVerdict | undefined>;
  readonly isLocalUseBlocked?: (args: { readonly op: unknown; readonly approvalId?: string }) => Promise<string | undefined>;
  readonly perform: (op: unknown) => Promise<unknown>;
  readonly emit: (event: MessagesConsentEvent) => void;
}

export interface MessagesOpShape { readonly kind?: unknown }

function isSendOp(op: unknown): boolean {
  return typeof op === "object" && op !== null && (op as MessagesOpShape).kind === "send";
}

export async function runMessagesOpConsent(
  args: { readonly op: unknown; readonly approvalId?: string },
  ports: MessagesConsentPorts,
): Promise<{ readonly performed: boolean }> {
  const needsConsent = isSendOp(args.op) && (args.approvalId === undefined || args.approvalId.length === 0);
  if (needsConsent && ports.decideLocalUse !== undefined) {
    ports.emit({ kind: "messages-accepted" });
    const verdict = await ports.decideLocalUse({ op: args.op, ...(args.approvalId === undefined ? {} : { approvalId: args.approvalId }) });
    if (verdict !== undefined && (typeof verdict !== "object" || verdict === null || (verdict as MessagesOpShape).kind !== "allow")) {
      ports.emit({ kind: "messages-consent-result", verdict });
      return { performed: false };
    }
    if (verdict === undefined) {
      const blocked = await ports.isLocalUseBlocked?.({ op: args.op, ...(args.approvalId === undefined ? {} : { approvalId: args.approvalId }) });
      if (blocked !== undefined) {
        ports.emit({ kind: "messages-error", error: blocked });
        return { performed: false };
      }
    }
  } else if (!needsConsent && (args.op !== undefined)) {
    const blocked = await ports.isLocalUseBlocked?.({ op: args.op, ...(args.approvalId === undefined ? {} : { approvalId: args.approvalId }) });
    if (blocked !== undefined) {
      ports.emit({ kind: "messages-error", error: blocked });
      return { performed: false };
    }
  }
  const result = await ports.perform(args.op);
  ports.emit({ kind: "messages-result", result });
  return { performed: true };
}
