export type LibraryErrorCode = "invalid-argument" | "identity-mismatch" | "visibility-echo" | "not-found" | "read-only" | "rejected" | "store-unavailable";
export class LibraryContractError extends Error {
  override readonly name: string = "LibraryContractError";
  constructor(readonly code: LibraryErrorCode, message: string) { super(message); }
}
export class DocumentNotFoundError extends LibraryContractError {
  override readonly name = "DocumentNotFoundError";
  constructor(message: string) { super("not-found", message); }
}
export class DocumentReadOnlyError extends LibraryContractError {
  override readonly name = "DocumentReadOnlyError";
  constructor(message: string) { super("read-only", message); }
}
export class DocumentRejectedError extends LibraryContractError {
  override readonly name = "DocumentRejectedError";
  constructor(message: string) { super("rejected", message); }
}
export class DocumentVisibilityEchoError extends LibraryContractError {
  override readonly name = "DocumentVisibilityEchoError";
  constructor(message: string) { super("visibility-echo", message); }
}
export class CanvasStoreUnavailableError extends LibraryContractError {
  override readonly name = "CanvasStoreUnavailableError";
  constructor(message: string) { super("store-unavailable", message); }
}
export class CanvasPayloadIdentityError extends LibraryContractError {
  override readonly name = "CanvasPayloadIdentityError";
  constructor(message: string) { super("identity-mismatch", message); }
}
export class CanvasShareIdentityError extends LibraryContractError {
  override readonly name = "CanvasShareIdentityError";
  constructor(message: string) { super("identity-mismatch", message); }
}
export class CanvasVisibilityEchoError extends LibraryContractError {
  override readonly name = "CanvasVisibilityEchoError";
  constructor(message: string) { super("visibility-echo", message); }
}
