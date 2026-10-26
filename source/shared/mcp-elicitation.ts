export interface McpElicitationSummary {
  readonly kind: "mcp_elicitation";
  readonly params: { readonly message: string; readonly serverDisplayName: string; readonly toolName?: string };
}

export interface McpElicitationApprovalRequest {
  readonly agentId: string;
  readonly serverDisplayName: string;
  readonly toolName: string;
  readonly message: string;
  readonly signal: AbortSignal;
}

export type McpElicitationApprover = (request: McpElicitationApprovalRequest) => Promise<"accept" | "decline" | "cancel">;
