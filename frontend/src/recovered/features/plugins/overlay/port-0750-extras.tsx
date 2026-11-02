import { useState, type ReactNode } from "react";
import { CustomMcpFormHost, type CustomMcpHostBridge } from "../../../../extensions/custom-mcp-form-host";

/**
 * The repo's custom-MCP server form.
 *
 * Official 0.78.1 has no such form on the "连接应用" dialog's second-level "管理插件和技能"
 * page, and it has no custom-connector entry point in the personal dialog at all — official
 * keeps the connector form on a page of its own (`custom-plugin`, message id `qLe/7o`,
 * `chunk-user-custom-connector-M5UeTEiw.js`). The 0.75.0 wave therefore had nowhere official
 * matched, and parked the form inside the dialog's Installed section.
 *
 * That parking spot is what made the reconstruction's second-level page differ from official's.
 * The form is a reconstruction feature, not an official one, so it lives on a reconstruction
 * surface instead: the settings host slot (`RPort0750SettingsPack`), which already exists for
 * repo-owned cards and is not an official-parity surface.
 *
 * The repo's "已安装 / 卸载" list (`EffectivePluginsPanel`) goes away with it. Official's
 * manage page has no such list, and the uninstall action itself is not lost: the plugin
 * **detail** page upstream already ships carries 卸载.
 */
export function PluginsPort0750Extras(props: {
  readonly mcp: CustomMcpHostBridge;
  readonly onChanged?: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sand-plugins-port-0750">
      {error == null ? null : <p role="alert">{error}</p>}
      <CustomMcpFormHost
        bridge={props.mcp}
        onChanged={() => {
          setError(null);
          props.onChanged?.();
        }}
      />
    </div>
  );
}
