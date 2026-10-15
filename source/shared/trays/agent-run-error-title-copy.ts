export interface LocalizedCopy {
  readonly id: string;
  readonly message: string;
  readonly zh: string;
}

export type AgentRunErrorKind =
  | "backend_unreachable"
  | "provider_overloaded"
  | "first_token_stall"
  | "conversation_too_large"
  | "opaque_wire_failure"
  | "unknown_failure";

export type TurnTrayTitleKind = "model_provider_overloaded" | "bot_failed_to_respond";

export const TITLE_BY_KIND: Readonly<Record<TurnTrayTitleKind, LocalizedCopy>> = {
  model_provider_overloaded: { id: "Rdu4z7", message: "Model provider is overloaded", zh: "模型提供方已过载" },
  bot_failed_to_respond: { id: "Uq1VXs", message: "Bot failed to respond", zh: "Bot 未能回复" },
};

// backend_unreachable has no entry: the official copy (u6fkmt) names the Cursor backend, which this build never contacts.
export const DETAIL_BY_ERROR_KIND: Readonly<Partial<Record<AgentRunErrorKind, LocalizedCopy>>> = {
  provider_overloaded: { id: "cg5y8u", message: "The model provider is under heavy load right now. This is usually temporary — try again shortly.", zh: "模型服务商目前负载过高。这通常是暂时的，请稍后重试。" },
  first_token_stall: { id: "Ly7/5m", message: "The model didn't start responding in time. Try again.", zh: "模型未能及时开始响应。请重试。" },
  conversation_too_large: { id: "5wdRDj", message: "This conversation is too large to continue. Start a new conversation with this agent.", zh: "此对话过长，无法继续。请与该 Bot 开始新的对话。" },
  opaque_wire_failure: { id: "tixDan", message: "Something went wrong while generating the reply. Try again.", zh: "生成回复时出错了。请重试。" },
};

export function turnTrayTitleKind(errorKind: AgentRunErrorKind | undefined): TurnTrayTitleKind {
  switch (errorKind) {
    case "provider_overloaded":
      return "model_provider_overloaded";
    case "backend_unreachable":
    case "first_token_stall":
    case "conversation_too_large":
    case "opaque_wire_failure":
    case "unknown_failure":
    case undefined:
      return "bot_failed_to_respond";
    default: {
      const unhandled: never = errorKind;
      return unhandled;
    }
  }
}

export interface TurnFailureCopy {
  readonly errorKind?: AgentRunErrorKind;
  readonly titleKind: TurnTrayTitleKind;
  readonly title: LocalizedCopy;
  readonly detail?: LocalizedCopy;
}

export function turnFailureCopy(errorKind: AgentRunErrorKind | undefined): TurnFailureCopy {
  const titleKind = turnTrayTitleKind(errorKind);
  const detail = errorKind == null ? undefined : DETAIL_BY_ERROR_KIND[errorKind];
  return {
    ...(errorKind == null ? {} : { errorKind }),
    titleKind,
    title: TITLE_BY_KIND[titleKind],
    ...(detail == null ? {} : { detail }),
  };
}
