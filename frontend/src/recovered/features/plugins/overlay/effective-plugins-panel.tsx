import type { ReactNode } from "react";
import type { EffectivePlugin } from "../../../contracts/desktop-bridge";
import { EFFECTIVE_PLUGINS_PANEL_WORDING, officialWording } from "../../../../i18n/official-marketplace-copy";
import { BUTTON_SECONDARY, GRID, ROW, ROW_BADGE, ROW_NAME, ROW_OPEN_COMPACT } from "./marketplace-recipes";
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
    // The dialog's own section title ("已安装") already sits directly above this panel, so the
    // panel carries no heading of its own — a second "已安装" title read as a duplicate. The
    // `aria-label` keeps the panel named for assistive technology.
    <section className="sand-effective-plugins-panel" aria-label={copy.title}>
      {props.plugins.length === 0 ? (
        <p className="sand-effective-plugins-empty sand-9f619 sand-dj266r sand-1yf7rl7 sand-at24cr sand-j3b58b sand-19aaqeu">
          {copy.emptyList}
        </p>
      ) : (
        <ul className={`sand-effective-plugins-list ${GRID}`}>
          {props.plugins.map((plugin) => {
            const mode = pluginInstallMode(plugin);
            const policy = pluginTeamPolicyLabel(mode);
            const actions = pluginTeamPolicyActions(mode);
            const label = plugin.displayName !== "" ? plugin.displayName : plugin.name;
            return (
              <li className={`sand-effective-plugins-row ${ROW}`} data-plugin-id={plugin.pluginId} key={plugin.pluginId}>
                <button
                  className={`sand-effective-plugins-open ${ROW_OPEN_COMPACT}`}
                  onClick={() => props.onOpenPlugin?.(plugin.pluginId)}
                  title={label}
                  type="button"
                >
                  <span className={`sand-effective-plugins-name ${ROW_NAME}`}><bdi>{label}</bdi></span>
                  {policy == null ? null : <span className={`sand-effective-plugins-policy ${ROW_BADGE}`}>{policy}</span>}
                  {plugin.isEnabled ? null : <span className={`sand-effective-plugins-disabled ${ROW_BADGE}`}>{copy.disabledBadge}</span>}
                </button>
                {props.onRemove == null || !plugin.isEnabled ? null : actions.length === 0 ? null : (
                  <button
                    className={`sand-effective-plugins-action ${BUTTON_SECONDARY}`}
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
