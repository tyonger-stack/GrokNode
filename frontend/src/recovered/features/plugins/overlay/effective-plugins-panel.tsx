import type { ReactNode } from "react";
import type { EffectivePlugin } from "../../../contracts/desktop-bridge";
import { pluginInstallMode, pluginTeamPolicyActions, pluginTeamPolicyLabel } from "./model";

export interface EffectivePluginsPanelCopy {
  readonly title: string;
  readonly emptyList: string;
  readonly disabledBadge: string;
  readonly removeAction: string;
  readonly uninstallAction: string;
}

export const DEFAULT_EFFECTIVE_PLUGINS_PANEL_COPY: EffectivePluginsPanelCopy = {
  title: "Plugins in effect",
  emptyList: "No plugins in effect.",
  disabledBadge: "Off",
  removeAction: "Remove",
  uninstallAction: "Uninstall",
};

export function EffectivePluginsPanel(props: {
  readonly plugins: readonly EffectivePlugin[];
  readonly copy?: Partial<EffectivePluginsPanelCopy>;
  readonly onOpenPlugin?: (pluginId: string) => void;
  readonly onRemove?: (pluginId: string) => void;
}): ReactNode {
  const copy: EffectivePluginsPanelCopy = { ...DEFAULT_EFFECTIVE_PLUGINS_PANEL_COPY, ...props.copy };
  return (
    <section className="sand-effective-plugins-panel" aria-label={copy.title}>
      <h2 className="sand-effective-plugins-title">{copy.title}</h2>
      {props.plugins.length === 0 ? <p className="sand-effective-plugins-empty">{copy.emptyList}</p> : (
        <ul className="sand-effective-plugins-list">
          {props.plugins.map((plugin) => {
            const mode = pluginInstallMode(plugin);
            const policy = pluginTeamPolicyLabel(mode);
            const actions = pluginTeamPolicyActions(mode);
            const label = plugin.displayName !== "" ? plugin.displayName : plugin.name;
            return (
              <li className="sand-effective-plugins-row" data-plugin-id={plugin.pluginId} key={plugin.pluginId}>
                <button
                  className="sand-effective-plugins-open"
                  onClick={() => props.onOpenPlugin?.(plugin.pluginId)}
                  title={label}
                  type="button"
                >
                  <span className="sand-effective-plugins-name"><bdi>{label}</bdi></span>
                  {policy == null ? null : <span className="sand-effective-plugins-policy">{policy}</span>}
                  {plugin.isEnabled ? null : <span className="sand-effective-plugins-disabled">{copy.disabledBadge}</span>}
                </button>
                {props.onRemove == null || !plugin.isEnabled ? null : actions.length === 0 ? null : (
                  <button
                    onClick={() => props.onRemove?.(plugin.pluginId)}
                    title={actions.includes("uninstall") ? copy.uninstallAction : copy.removeAction}
                    type="button"
                  >
                    {actions.includes("uninstall") ? copy.uninstallAction : copy.removeAction}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
