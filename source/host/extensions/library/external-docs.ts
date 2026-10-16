import { z } from "zod";
import type { LibraryExternalDoc, LibraryExecutionContext, LibraryRequestContext } from "../../../shared/library-contracts.js";
import { libraryExternalDocSchema } from "../../../shared/library/schemas.js";
import { externalConnectorSpecs, type ExternalToolAction } from "./external-doc-provider-table.js";
import { externalDocumentKey, findExternalConnector, sortExternalDocs, type ExternalDocumentId } from "./external-doc-providers.js";
import { extractResultUrls, parseSuccessfulMcpResult } from "./external-doc-result.js";

export type ExternalConnectorIdentity = { readonly identifier: string; readonly account: string };
export type ExternalDocExecutionContext = LibraryExecutionContext & { readonly connector: ExternalConnectorIdentity };
export type ExternalDocRegistrationPort = {
  upsert(context: LibraryExecutionContext, input: LibraryExternalDoc): LibraryExternalDoc;
  list(context: LibraryRequestContext, agentId: string): readonly LibraryExternalDoc[];
};
export type ExternalDocTouch = ExternalDocumentId & { readonly action: ExternalToolAction };
export type ExternalDocClassificationInput = {
  readonly connectorName: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
};
export type ExternalDocRegistrationInput = ExternalDocClassificationInput & { readonly context: ExternalDocExecutionContext };

export class ExternalDocRegistrationError extends Error {
  override readonly name = "ExternalDocRegistrationError";
  constructor(readonly code: "invalid-context" | "identity-mismatch", message: string) { super(message); }
}

const identifier = z.string().min(1).max(512).refine(value => !/[\x00-\x1f]/.test(value));
const principalSchema = z.object({ accountId: identifier, principalId: identifier, teamIds: z.array(identifier) }).strict();
const httpsOrigin = z.string().url().refine(value => {
  const url = URL.parse(value);
  return url !== null && url.protocol === "https:" && url.username === "" && url.password === "" &&
    url.pathname === "/" && url.search === "" && url.hash === "";
});
const requestContextSchema = z.object({ principal: principalSchema, providerOrigin: httpsOrigin, signal: z.instanceof(AbortSignal) }).strict();
const executionContextSchema = requestContextSchema.extend({
  agentId: identifier, storeId: identifier, toolCallId: identifier, idempotencyKey: identifier,
  connector: z.object({ identifier, account: identifier }).strict(),
}).strict();
const argsSchema = z.record(z.unknown());

function parseRequestContext(context: LibraryRequestContext): LibraryRequestContext {
  return requestContextSchema.parse(context);
}

function parseExecutionContext(context: ExternalDocExecutionContext): ExternalDocExecutionContext {
  return executionContextSchema.parse(context);
}

function urlDocuments(input: { readonly urls: readonly string[]; readonly parseUrl: ((url: URL) => ExternalDocumentId | null) | undefined }): readonly ExternalDocumentId[] {
  const parseUrl = input.parseUrl;
  if (parseUrl === undefined) return [];
  return input.urls.flatMap(value => {
    const url = URL.parse(value);
    if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return [];
    const document = parseUrl(url);
    return document === null || document === undefined ? [] : [document];
  });
}

export function classifyExternalDocTouches(input: ExternalDocClassificationInput): readonly ExternalDocTouch[] {
  const result = parseSuccessfulMcpResult(input.result);
  if (result === null || result.isError) return [];
  const connector = findExternalConnector(input.connectorName);
  if (connector === null) return [];
  const entry = externalConnectorSpecs.find(candidate => candidate.id === connector);
  if (entry === undefined) return [];
  const rule = entry.spec.tools[input.toolName];
  if (rule === undefined) return [];
  const args = argsSchema.safeParse(input.args);
  if (!args.success) return [];
  const documents: ExternalDocumentId[] = [];
  const argDocs = entry.spec.argDocs?.[input.toolName]?.(args.data) ?? [];
  documents.push(...argDocs);
  if (argDocs.length === 0) {
    const idArgDocuments: ExternalDocumentId[] = [];
    for (const [key, parser] of Object.entries(entry.spec.idArgs ?? {})) {
      const value = parser(args.data[key]);
      if (value !== null) idArgDocuments.push(value);
    }
    documents.push(...idArgDocuments);
    const documentId = idArgDocuments.length === 0 ? entry.spec.documentId?.(args.data.documentId) : undefined;
    if (documentId !== null && documentId !== undefined) documents.push(documentId);
  }
  documents.push(...urlDocuments({ urls: extractResultUrls(result), parseUrl: entry.spec.parseUrl }));
  const unique = new Map<string, ExternalDocTouch>();
  for (const document of documents) unique.set(externalDocumentKey(document), { ...document, action: rule.action });
  return [...unique.values()];
}

function sameDocs(left: readonly LibraryExternalDoc[], right: readonly LibraryExternalDoc[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createExternalDocRegistrationService(options: {
  readonly catalog: ExternalDocRegistrationPort;
  readonly now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const captured = new Map<string, readonly LibraryExternalDoc[]>();
  return {
    classify: classifyExternalDocTouches,
    registerSuccessfulMcpResult(input: ExternalDocRegistrationInput): readonly LibraryExternalDoc[] {
      const context = parseExecutionContext(input.context);
      context.signal.throwIfAborted();
      const touches = classifyExternalDocTouches(input);
      const touchedAtMs = now();
      const docs = touches.map(touch => libraryExternalDocSchema.parse({
        key: externalDocumentKey(touch), provider: touch.provider, externalId: touch.externalId, url: touch.url,
        title: null, createdByBot: true, lastAction: touch.action,
        firstTouchedAtMs: touchedAtMs, lastTouchedAtMs: touchedAtMs,
      }));
      const captureKey = JSON.stringify([
        context.principal.accountId, context.principal.principalId, context.agentId, context.storeId,
        context.toolCallId, context.idempotencyKey, context.connector.identifier, context.connector.account,
      ]);
      const previous = captured.get(captureKey);
      if (previous !== undefined && !sameDocs(previous, docs)) {
        throw new ExternalDocRegistrationError("identity-mismatch", "Registration identity changed for the same execution");
      }
      if (previous === undefined) captured.set(captureKey, docs);
      const registered: LibraryExternalDoc[] = [];
      for (const doc of previous ?? docs) registered.push(options.catalog.upsert(context, doc));
      return registered;
    },
    listDocs(context: LibraryRequestContext, agentId: string): readonly LibraryExternalDoc[] {
      return sortExternalDocs(options.catalog.list(parseRequestContext(context), identifier.parse(agentId)));
    },
  };
}
