import { useEffect, useState, type ReactNode } from "react";
import type { DesktopBridge } from "../recovered/contracts/desktop-bridge";
import { PluginsPort0750Extras } from "../recovered/features/plugins/overlay/port-0750-extras";

function desktopBridge(): Pick<DesktopBridge, "agent" | "experiments" | "mcp"> | null {
  const desktop = (window as Window & { desktop?: Pick<DesktopBridge, "agent" | "experiments" | "mcp"> }).desktop;
  if (desktop?.agent == null || desktop.experiments == null || desktop.mcp == null) return null;
  return desktop;
}

/**
 * The settings host slot carries the repo's custom-MCP server form.
 *
 * It used to be empty: the memory-import card that lived here was the English 0.75 stopgap,
 * the real import flow is its own Settings tab, and the vault "New card" trigger was a
 * development entry. The form now lives here because official 0.78.1's "连接应用" dialog has
 * no custom-connector surface of its own — official keeps it on a page of its own
 * (`qLe/7o`, `chunk-user-custom-connector-M5UeTEiw.js`) — and parking the form inside the
 * dialog's second-level "管理插件和技能" page is exactly what made that page differ from
 * official's.
 */
export function RPort0750SettingsPack(): ReactNode {
  const bridge = desktopBridge();
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (bridge == null) return;
    let live = true;
    void bridge.mcp.list().then(() => {
      if (live) setRevision((value) => value + 1);
    }).catch(() => {
      if (live) setRevision((value) => value + 1);
    });
    return () => { live = false; };
  }, [bridge]);
  if (bridge == null) return null;
  return (
    <PluginsPort0750Extras
      mcp={{
        list: () => bridge.mcp.list(),
        add: (request) => bridge.mcp.add(request),
        remove: (serverId) => bridge.mcp.remove(serverId),
      }}
      onChanged={() => { setRevision((value) => value + 1); }}
    />
  );
}
