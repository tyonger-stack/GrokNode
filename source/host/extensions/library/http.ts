import { z } from "zod";
import { libraryArgsSchemas, libraryHttpEnvelopeSchema, libraryResultSchemas } from "../../../shared/library/schemas.js";
import type { LibraryHttpMethod } from "../../../shared/library/types.js";
import { encodeLibraryJson } from "../../../shared/library/json-bytes.js";
import { LibraryContractError } from "../../../shared/library/errors.js";
import type { LibraryHostService } from "./extension.js";
import { LibraryCatalogError } from "./migrations.js";

type Handler = (args: unknown, credential: string, signal: AbortSignal) => Promise<unknown>;

function method<A>(argsSchema: z.ZodType<A>, resultSchema: z.ZodType,
  call: (args: A & { credential: string }, signal: AbortSignal) => unknown): Handler {
  return async (input, credential, signal) => {
    const parsed = argsSchema.safeParse(input);
    if (!parsed.success) throw new LibraryContractError("invalid-argument", "Invalid Library request");
    return resultSchema.parse(await call({ ...parsed.data, credential }, signal));
  };
}

export function createLibraryHttpDispatcher(service: LibraryHostService) {
  const args = libraryArgsSchemas, results = libraryResultSchemas;
  const handlers = {
    listLibraryPins: method(args.listLibraryPins, results.listLibraryPins, service.listLibraryPins),
    setLibraryPin: method(args.setLibraryPin, results.setLibraryPin, service.setLibraryPin),
    mergeLibraryPins: method(args.mergeLibraryPins, results.mergeLibraryPins, service.mergeLibraryPins),
    readVisualizationFragment: method(args.readVisualizationFragment, results.readVisualizationFragment, service.readVisualizationFragment),
    listLocalTeams: method(args.listLocalTeams, results.listLocalTeams, service.listLocalTeams),
    checkLocalTeamAccess: method(args.checkLocalTeamAccess, results.checkLocalTeamAccess, service.checkLocalTeamAccess),
    createLocalTeam: method(args.createLocalTeam, results.createLocalTeam, service.createLocalTeam),
    listLocalTeamMembers: method(args.listLocalTeamMembers, results.listLocalTeamMembers, service.listLocalTeamMembers),
    setLocalTeamMember: method(args.setLocalTeamMember, results.setLocalTeamMember, service.setLocalTeamMember),
    getLocalAgentAccess: method(args.getLocalAgentAccess, results.getLocalAgentAccess, service.getLocalAgentAccess),
    setLocalAccessGrant: method(args.setLocalAccessGrant, results.setLocalAccessGrant, service.setLocalAccessGrant),
    resolveLibraryPages: method(args.resolveLibraryPages, results.resolveLibraryPages, service.resolveLibraryPages),
    listLibraryPages: method(args.listLibraryPages, results.listLibraryPages, service.listLibraryPages),
    listLibraryDocs: method(args.listLibraryDocs, results.listLibraryDocs, service.listLibraryDocs),
    getDocument: method(args.getDocument, results.getDocument, ({ groupChatId, ...rest }, signal) =>
      service.getDocument(groupChatId === undefined ? rest : { ...rest, groupChatId }, signal)),
    getDocumentEditRight: method(args.getDocumentEditRight, results.getDocumentEditRight, service.getDocumentEditRight),
    saveDocument: method(args.saveDocument, results.saveDocument, service.saveDocument),
    setDocumentVisibility: method(args.setDocumentVisibility, results.setDocumentVisibility, service.setDocumentVisibility),
    getDocumentAssets: method(args.getDocumentAssets, results.getDocumentAssets, ({ groupChatId, ...rest }, signal) =>
      service.getDocumentAssets(groupChatId === undefined ? rest : { ...rest, groupChatId }, signal)),
    getCanvasShare: method(args.getCanvasShare, results.getCanvasShare, service.getCanvasShare),
    setCanvasVisibility: method(args.setCanvasVisibility, results.setCanvasVisibility, service.setCanvasVisibility),
  } satisfies Record<LibraryHttpMethod, Handler>;

  return async (input: unknown, credential: string | null, signal: AbortSignal) => {
    if (credential === null) return { status: 401, body: { error: "authentication-required" } };
    try {
      service.catalog.identity.resolveCredential(credential, signal);
    } catch (error) {
      if (error instanceof LibraryCatalogError && error.code === "denied") {
        return { status: 401, body: { error: "authentication-required" } };
      }
      throw error;
    }
    const envelope = libraryHttpEnvelopeSchema.safeParse(input);
    if (!envelope.success) return { status: 400, body: { error: "invalid-argument" } };
    try {
      const result = await handlers[envelope.data.method](envelope.data.args, credential, signal);
      return { status: 200, body: { result: encodeLibraryJson(result ?? null) } };
    } catch (error) {
      if (error instanceof LibraryContractError) {
        const status = error.code === "invalid-argument" ? 400 : error.code === "read-only" ? 403
          : error.code === "not-found" || error.code === "store-unavailable" ? 404 : 500;
        return { status, body: { error: error.code } };
      }
      return { status: 500, body: { error: "internal-error" } };
    }
  };
}
