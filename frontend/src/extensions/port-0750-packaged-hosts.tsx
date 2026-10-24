import { useEffect, useState, type ReactNode } from "react";
import type { DesktopBridge, EffectivePlugin } from "../recovered/contracts/desktop-bridge";
import { PluginsPort0750Extras } from "../recovered/features/plugins/overlay/port-0750-extras";

function desktopBridge(): Pick<DesktopBridge, "agent" | "experiments" | "mcp"> | null {
  const desktop = (window as Window & { desktop?: Pick<DesktopBridge, "agent" | "experiments" | "mcp"> }).desktop;
  if (desktop?.agent == null || desktop.experiments == null || desktop.mcp == null) return null;
  return desktop;
}

/**
 * Settings → 通用 no longer mounts anything. The memory-import card that lived here was the
 * English 0.75 stopgap; the real import flow is its own Settings tab (memory-import entry),
 * and the vault "New card" trigger was a development entry. Both showed up at the bottom of
 * 通用. The export stays because the pinned settings chunk references it.
 */
export function RPort0750SettingsPack(): ReactNode {
  return null;
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
