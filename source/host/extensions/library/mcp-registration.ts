import { LibraryCatalogError } from "./migrations.js";
import type { LibraryMcpResult, LibraryMcpExecution } from "../../../shared/library/mcp-result-hook.js";
import { createExternalDocRegistrationService, type ExternalDocExecutionContext } from "./external-docs.js";
import type { LibraryCatalog } from "./catalog.js";

/**
 * Task 13c: the trusted MCP-result registration boundary (Node design).
 * Success is decided here from the raw result; identity (account,
 * agent, store, connector, tool call) comes only from runner-supplied
 * context, never from result fields. Unknown connectors, unread tools
 * and failed calls register nothing.
 */
export interface McpRegistrationPorts { readonly catalog: LibraryCatalog; }
function isErrorResult(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  if (record.isError === true) return true;
  const result = record.result as Record<string, unknown> | undefined;
  return typeof result === "object" && result !== null && result.case === "error";
}
export function createLibraryMcpRegistration(ports: McpRegistrationPorts) {
  const service = createExternalDocRegistrationService({ catalog: ports.catalog.external });
  const hook = (result: LibraryMcpResult, execution: LibraryMcpExecution | undefined): void => {
    if (execution === undefined || result.agentId !== execution.agentId || isErrorResult(result.raw)) return;
    if (result.toolCallId !== undefined && result.toolCallId !== execution.toolCallId) return;
    try { ports.catalog.identity.requireExecution(execution); }
    catch (error) {
      if (error instanceof LibraryCatalogError && error.code === "denied") return;
      throw error;
    }
    const { connectorAccount, ...trusted } = execution;
    const context: ExternalDocExecutionContext = {
      ...trusted,
      connector: { identifier: result.providerIdentifier, account: connectorAccount },
    };
    service.registerSuccessfulMcpResult({
      connectorName: result.displayName,
      toolName: result.toolName,
      args: result.args ?? {},
      result: result.raw,
      context,
    });
  };
  return { hook, service };
}
export type LibraryMcpRegistration = ReturnType<typeof createLibraryMcpRegistration>;
