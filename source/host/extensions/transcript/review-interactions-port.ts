export interface ReviewInteractionsPort {
  sendDraft(request: unknown): Promise<unknown>;
  discardDraft(request: unknown): Promise<unknown>;
  submitUserForm(request: unknown): Promise<unknown>;
  dismissUserForm(request: unknown): Promise<unknown>;
  onTurnEnded(agentId: string, requestId: string): void;
  recover(): Promise<void>;
  dispose(): void | Promise<void>;
}

export class ReviewInteractionsUnavailableError extends Error {
  override readonly name = "ReviewInteractionsUnavailableError";
  constructor() { super("Review interaction services are unavailable. Reopen this conversation and try again."); }
}
