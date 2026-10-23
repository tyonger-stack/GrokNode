import { useEffect, useState, type ReactNode } from "react";
import { createCoordinatorClient } from "../production/coordinator-client";
import type { CoordinatorPortBridge, DesktopBridge, EffectivePlugin } from "../recovered/contracts/desktop-bridge";
import { PluginsPort0750Extras } from "../recovered/features/plugins/overlay/port-0750-extras";
import { MemoryImportHost } from "../recovered/features/settings/overlay/memory-import-host";
import { VaultCardDialogHost } from "./vault-card-dialog-host";

function desktopBridge(): Pick<DesktopBridge, "agent" | "experiments" | "mcp"> | null {
  const desktop = (window as Window & { desktop?: Pick<DesktopBridge, "agent" | "experiments" | "mcp"> }).desktop;
  if (desktop?.agent == null || desktop.experiments == null || desktop.mcp == null) return null;
  return desktop;
}

function coordinatorFromWindow() {
  const port = (window as Window & { coordinatorPort?: CoordinatorPortBridge }).coordinatorPort;
  if (port == null || typeof port.claim !== "function") return null;
  return createCoordinatorClient(port);
}

export function RPort0750SettingsPack(): ReactNode {
  const [coordinator] = useState(coordinatorFromWindow);
  const bridge = desktopBridge();
  if (bridge == null) return null;
  return (
    <>
      <MemoryImportHost bridge={bridge} coordinator={coordinator} />
      <VaultCardDialogHost />
    </>
  );
}

export function RPort0750PluginsPack(): ReactNode {
  const bridge = desktopBridge();
  const [plugins, setPlugins] = useState<readonly EffectivePlugin[]>([]);
  useEffect(() => {
    if (bridge == null) return;
    let live = true;
    void bridge.mcp.effectivePlugins().then((listed) => {
      if (live) setPlugins(listed);
    }).catch(() => {
      if (live) setPlugins([]);
    });
    return () => { live = false; };
  }, [bridge]);
  if (bridge == null) return null;
  const reload = () => {
    void bridge.mcp.effectivePlugins().then(setPlugins).catch(() => setPlugins([]));
  };
  return (
    <PluginsPort0750Extras
      mcp={{
        list: () => bridge.mcp.list(),
        add: (request) => bridge.mcp.add(request),
        remove: (serverId) => bridge.mcp.remove(serverId),
      }}
      onChanged={reload}
      onRemovePlugin={async (pluginId) => {
        await bridge.mcp.uninstallPlugin(pluginId);
        reload();
      }}
      plugins={plugins}
    />
  );
}
