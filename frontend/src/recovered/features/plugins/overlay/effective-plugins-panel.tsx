import type { ReactNode } from "react";
import type { EffectivePlugin } from "../../../contracts/desktop-bridge";
import { EFFECTIVE_PLUGINS_PANEL_WORDING, officialWording } from "../../../../i18n/official-marketplace-copy";
import { pluginInstallMode, pluginTeamPolicyActions, pluginTeamPolicyLabel } from "./model";

export interface EffectivePluginsPanelCopy {
  readonly title: string;
  readonly emptyList: string;
  readonly disabledBadge: string;
  readonly removeAction: string;
  readonly uninstallAction: string;
}

/**
 * Official 0.75.8's wording for this panel — the English side is official's too
 * ("Installed", not the 0.66-era "Plugins in effect"). The Chinese side is resolved at
 * render time through upstream's own locale runtime, so the language preference still
 * switches it. See `frontend/src/i18n/official-marketplace-copy.ts` for the message ids.
 */
export const DEFAULT_EFFECTIVE_PLUGINS_PANEL_COPY: EffectivePluginsPanelCopy = {
  title: EFFECTIVE_PLUGINS_PANEL_WORDING.title.en,
  emptyList: EFFECTIVE_PLUGINS_PANEL_WORDING.emptyList.en,
  disabledBadge: EFFECTIVE_PLUGINS_PANEL_WORDING.disabledBadge.en,
  removeAction: EFFECTIVE_PLUGINS_PANEL_WORDING.removeAction.en,
  uninstallAction: EFFECTIVE_PLUGINS_PANEL_WORDING.uninstallAction.en,
};

export function effectivePluginsPanelCopy(override?: Partial<EffectivePluginsPanelCopy>): EffectivePluginsPanelCopy {
  return {
    title: officialWording(EFFECTIVE_PLUGINS_PANEL_WORDING.title),
    emptyList: officialWording(EFFECTIVE_PLUGINS_PANEL_WORDING.emptyList),
    disabledBadge: officialWording(EFFECTIVE_PLUGINS_PANEL_WORDING.disabledBadge),
    removeAction: officialWording(EFFECTIVE_PLUGINS_PANEL_WORDING.removeAction),
    uninstallAction: officialWording(EFFECTIVE_PLUGINS_PANEL_WORDING.uninstallAction),
    ...override,
  };
}

export function EffectivePluginsPanel(props: {
  readonly plugins: readonly EffectivePlugin[];
  readonly copy?: Partial<EffectivePluginsPanelCopy>;
  readonly onOpenPlugin?: (pluginId: string) => void;
  readonly onRemove?: (pluginId: string) => void;
}): ReactNode {
  const copy: EffectivePluginsPanelCopy = effectivePluginsPanelCopy(props.copy);
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
