/**
 * Exposes upstream 0.18's own plugins-dialog opener to the injected renderer extension.
 *
 * ## Why
 *
 * Upstream 0.18 ships a genuine "连接应用" surface of its own: the sidebar pill's React
 * `onClick` is `() => Rme.open(Uf.plugins())`, where `uSe()` is the same call bound to the
 * `sand.openTools` command ("Customize", mod+shift+m). That surface is the same upstream
 * component official 0.75.8 ships, one generation earlier — the 0.18 baseline already contains
 * its whole class vocabulary (`sand-plugins-dialog`, `sand-plugins-layout`, `sand-plugins__yours`,
 * `sand-plugins__marketplace`, `sand-plugins__group`, `sand-plugins__show-all`,
 * `sand-plugins__grid`, `sand-plugins__status`).
 *
 * The sidebar PILL can reach that surface on its own (it is an upstream React node), but the
 * RAIL row is not mounted upstream — it is a node this build injects — so it needs a way to ask
 * upstream to open its own dialog.
 *
 * ## How
 *
 * Rather than re-implementing "open the plugins dialog" (which would be a rewrite of upstream
 * behaviour), this patch publishes upstream's own function on a global:
 *
 *     function uSe(){Rme.open(Uf.plugins())}   ->   + globalThis.__sandOpenUpstreamPlugins=uSe;
 *
 * `uSe` is a hoisted function declaration at module top level, so the assignment is valid at
 * module-init time. The injected extension then calls that global. If the anchor ever moves,
 * `replaceExactlyOnce` throws and the packaging fails closed rather than shipping a build whose
 * rail button silently opens nothing.
 *
 * @evidence upstream 0.18.0 `src/app/dist/renderer/assets/index-UbX-y3il.js`, byte 5493811 —
 *   `function uSe(){Rme.open(Uf.plugins())}` occurs exactly once in the registry chunk.
 * @evidence the same chunk binds it as the `sand.openTools` action:
 *   `{id:"sand.openTools",label:"Customize",hotkey:"mod+shift+m",isEnabledInContentEditable:!0,run:uSe}`
 */

const OPENER_BEFORE = "function uSe(){Rme.open(Uf.plugins())}";
const OPENER_AFTER = "function uSe(){Rme.open(Uf.plugins())}globalThis.__sandOpenUpstreamPlugins=uSe;";

/** The global the injected renderer extension calls to open upstream's own plugins dialog. */
export const UPSTREAM_PLUGINS_OPENER_GLOBAL = "__sandOpenUpstreamPlugins";

export function patchUpstreamPluginsDialogOpener(source) {
  const first = source.indexOf(OPENER_BEFORE);
  if (first < 0 || source.indexOf(OPENER_BEFORE, first + 1) >= 0) {
    throw new Error("Original renderer upstream plugins opener anchor is missing or ambiguous.");
  }
  return source.slice(0, first) + OPENER_AFTER + source.slice(first + OPENER_BEFORE.length);
}
