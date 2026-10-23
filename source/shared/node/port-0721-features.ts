const LOCAL_FEATURES = new Set([
  "sand_enable_visualizations", "sand_desktop_mount",
  "sand_menubar_tray", "sand_notifications_enable_card", "sand_permissions_panel",
  "sand_enable_local_cua",
  "grok_bot_library_pins", "grok_bot_vault", "grok_bot_vault_cards", "grok_bot_vault_card_scan_on_device",
  "grok_bot_library_hover_cards",
  "grok_bot_memory_import",
  "sand_enable_pele_diagrams",
]);

export function resolveLocal0721Feature(name: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  if (!LOCAL_FEATURES.has(name)) return undefined;
  for (const pair of env.SAND_FEATURE_GATE_OVERRIDES?.split(",") ?? []) {
    const [key, value] = pair.split("=", 2).map((part) => part.trim());
    if (key === name) return value === "1" || value === "true" || value === "on";
  }
  return env.GROK_NODE_0721_FEATURES !== "0";
}

export function local0721FeatureSnapshot(env: NodeJS.ProcessEnv = process.env): Readonly<Record<string, boolean>> {
  return Object.freeze(Object.fromEntries([...LOCAL_FEATURES].map((name) => [name, resolveLocal0721Feature(name, env) === true])));
}
