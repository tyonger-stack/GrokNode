import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CustomMcpForm,
  customMcpConfigJson,
  customMcpFormCopy,
  type CustomMcpFormCopy,
  type CustomMcpServerDraft,
} from "./custom-mcp-form";
import {
  BUTTON_SECONDARY,
  GRID,
  ROW,
  ROW_NAME,
  ROW_SECONDARY,
  SETUP_CARD,
} from "../recovered/features/plugins/overlay/marketplace-recipes";
import type { McpServerSummary } from "../recovered/contracts/desktop-bridge";

export interface CustomMcpHostBridge {
  list(): Promise<{ readonly servers: readonly McpServerSummary[] }>;
  add(request: { readonly name: string; readonly configJson: string }): Promise<unknown>;
  remove(serverId: string): Promise<unknown>;
}

export function isCustomMcpServer(server: Pick<McpServerSummary, "pluginId" | "isTeamServer">): boolean {
  return server.pluginId == null && server.isTeamServer !== true;
}

export function CustomMcpFormHost(props: {
  readonly bridge: CustomMcpHostBridge;
  readonly copy?: Partial<CustomMcpFormCopy>;
  readonly disabled?: boolean;
  readonly onChanged?: () => void;
}): ReactNode {
  const [servers, setServers] = useState<readonly McpServerSummary[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const state = await props.bridge.list();
    setServers(state.servers.filter(isCustomMcpServer));
  }, [props.bridge]);
  useEffect(() => {
    let live = true;
    void reload().catch(() => {
      if (live) setServers([]);
    });
    return () => {
      live = false;
    };
  }, [reload]);
  const submit = useCallback(async (draft: CustomMcpServerDraft) => {
    const configJson = customMcpConfigJson(draft);
    if (configJson == null) return;
    setSubmitError(null);
    try {
      await props.bridge.add({ name: draft.name.trim(), configJson });
      await reload();
      props.onChanged?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  }, [props, reload]);
  const remove = useCallback(async (serverId: string) => {
    setSubmitError(null);
    try {
      await props.bridge.remove(serverId);
      await reload();
      props.onChanged?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  }, [props, reload]);
  const copy = customMcpFormCopy(props.copy);
  return (
    <section className={`sand-custom-mcp ${SETUP_CARD}`} aria-label={copy.title}>
      <CustomMcpForm copy={props.copy} disabled={props.disabled} onCancel={() => {}} onSubmit={(draft) => { void submit(draft); }} submitError={submitError} />
      {servers == null ? null : servers.length === 0 ? null : (
        <ul className={`sand-custom-mcp-servers ${GRID}`}>
          {servers.map((server) => (
            <li className={`sand-custom-mcp-server ${ROW}`} data-server-id={server.id} key={server.serverIdentifier}>
              <span className={`sand-custom-mcp-server-name ${ROW_NAME}`}><bdi>{server.name}</bdi></span>
              <span className={`sand-custom-mcp-server-status ${ROW_SECONDARY}`}>{server.status}</span>
              {confirmingRemove === server.id ? (
                <span className="sand-custom-mcp-remove-confirm">
                  <button className={`sand-custom-mcp-remove ${BUTTON_SECONDARY}`} onClick={() => { setConfirmingRemove(null); void remove(server.id); }} type="button">{copy.removeServer}</button>
                  <button className={`sand-custom-mcp-cancel ${BUTTON_SECONDARY}`} onClick={() => setConfirmingRemove(null)} type="button">{copy.cancel}</button>
                </span>
              ) : (
                <button className={`sand-custom-mcp-remove ${BUTTON_SECONDARY}`} disabled={props.disabled} onClick={() => setConfirmingRemove(server.id)} type="button">{copy.removeServer}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
