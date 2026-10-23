import { useState, type ReactNode } from "react";
import { CustomMcpFormHost, type CustomMcpHostBridge } from "../../../../extensions/custom-mcp-form-host";
import type { EffectivePlugin } from "../../../contracts/desktop-bridge";
import { EffectivePluginsPanel } from "./effective-plugins-panel";

export function PluginsPort0750Extras(props: {
  readonly plugins: readonly EffectivePlugin[];
  readonly mcp: CustomMcpHostBridge;
  readonly onRemovePlugin: (pluginId: string) => Promise<void> | void;
  readonly onChanged?: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sand-plugins-port-0750">
      {error == null ? null : <p role="alert">{error}</p>}
      <EffectivePluginsPanel
        onRemove={(pluginId) => {
          setError(null);
          void Promise.resolve(props.onRemovePlugin(pluginId)).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
          });
        }}
        plugins={props.plugins}
      />
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
