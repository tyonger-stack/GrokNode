/**
 * Official Grok Bot's marketplace wording for the surfaces this build still renders from the
 * 0.66-era replica: the effective-plugins list and the custom-MCP form, plus the connect action
 * a marketplace row's trailing slot carries.
 *
 * ## Why these strings live here
 *
 * The live "连接应用" surface is upstream 0.18's own plugins implementation (see
 * `docs/MARKETPLACE-0758-PORT.md` and `docs/MARKETPLACE-0781-PORT.md`). Two panels inside it are
 * still Grok Node's own replica components — the effective-plugins list and the custom-MCP form —
 * and they used to render English titles ("Plugins in effect", "Custom MCP server") inside an
 * otherwise Chinese UI. Official 0.75.8 has no such English leftovers, so the wording is ported
 * from official.
 *
 * The connect wording is official 0.78.1's, and it is the one the renderer patch writes into the
 * plugins chunk; it is declared here too so the copy has a single place to read from.
 *
 * ## Every Chinese string below is official 0.75.8's own
 *
 * Taken from the official 0.75.8 zh-Hans locale table
 * (`rea-grokbot-0758/app/dist/renderer/assets/chunk-core-DtHSUFHD.js`), message id in `source`:
 *
 *   eQkgKV  已安装                          — the installed-plugins section title
 *   ZyWE2h  尚未安装任何插件。请在市场中查找插件。
 *   cO9+2L  停用                            — the disabled badge
 *   t/YqKh  移除                            — remove
 *   fo0VXg  卸载                            — uninstall
 *   JgMRiA  MCP 服务器                      — the MCP-servers area title
 *   6YtxFj  名称                            — the name field
 *   9rG25a  服务器 URL                      — the server-url field
 *   VPpyHp  HTTP 标头                       — the headers section
 *   m16xKo  添加                            — add
 *   7sMeHQ  键                              — the header key input
 *   wMHvYH  值                              — the header value input
 *   tfDRzk  保存                            — save
 *   dEgA5A  取消                            — cancel
 *   Ra3OR9  服务器名称不能为空              — the blank-name validation
 *   FGWsd4  连接失败                        — the failed-connection status
 *   D2AZQg  出错了，请重试。                — the generic error
 *
 * `cO9+2L` ("Disable" → 停用) is used for the disabled badge because official's `8yK/9X`
 * ("Disabled") has no plain zh-Hans entry in the official locale table.
 *
 * Fields with no official counterpart keep their English text and are listed in
 * `UNPORTED_CUSTOM_MCP_FIELDS`; nothing here is invented wording.
 *
 * ## The locale decision stays upstream's
 *
 * The renderer patch `scripts/lib/marketplace-official-wording-patch.mjs` publishes upstream's own
 * `RLocT` runtime (the one the i18n passes append) as `globalThis.__sandRLocT`, so the language
 * preference switches these strings exactly the way it switches the rest of the app. Without that
 * global the copy falls back to English — the components are never left half-localised.
 */

export interface OfficialWording {
  /** Official 0.75.8's English text (or upstream 0.18's own pair when they are identical). */
  readonly en: string;
  /** Official 0.75.8's zh-Hans text. */
  readonly zh: string;
  /** Where the wording comes from: an official message id, or a note about the upstream pair. */
  readonly source: string;
}

/** The runtime published by the renderer patch; upstream's own `RLocT(en, zh)`. */
export type LocaleRuntime = (en: string, zh: string) => string;

interface LocaleGlobal {
  __sandRLocT?: LocaleRuntime;
}

/** Resolve one string through upstream's locale runtime; English when the runtime is absent. */
export function officialText(en: string, zh: string): string {
  const runtime = (globalThis as LocaleGlobal).__sandRLocT;
  return typeof runtime === "function" ? runtime(en, zh) : en;
}

/** Resolve one official wording entry through upstream's locale runtime. */
export function officialWording(wording: OfficialWording): string {
  return officialText(wording.en, wording.zh);
}

/** Official 0.75.8's wording for the effective-plugins list (the replica's installed list). */
export const EFFECTIVE_PLUGINS_PANEL_WORDING = {
  title: { en: "Installed", zh: "已安装", source: "official eQkgKV" },
  emptyList: {
    en: "Nothing installed yet. Find plugins in the marketplace.",
    zh: "尚未安装任何插件。请在市场中查找插件。",
    source: "official ZyWE2h",
  },
  disabledBadge: { en: "Disabled", zh: "停用", source: "official cO9+2L" },
  removeAction: { en: "Remove", zh: "移除", source: "official t/YqKh" },
  uninstallAction: { en: "Uninstall", zh: "卸载", source: "official fo0VXg" },
} as const satisfies Record<string, OfficialWording>;

/** Official 0.75.8's wording for the custom-MCP form. */
export const CUSTOM_MCP_FORM_WORDING = {
  title: { en: "MCP Servers", zh: "MCP 服务器", source: "official JgMRiA" },
  nameLabel: { en: "Name", zh: "名称", source: "official 6YtxFj" },
  urlLabel: { en: "Server URL", zh: "服务器 URL", source: "official 9rG25a" },
  headersLabel: { en: "HTTP headers", zh: "HTTP 标头", source: "official VPpyHp" },
  addHeader: { en: "Add", zh: "添加", source: "official m16xKo" },
  headerKeyLabel: { en: "Key", zh: "键", source: "official 7sMeHQ" },
  headerValueLabel: { en: "Value", zh: "值", source: "official wMHvYH" },
  removeHeader: { en: "Remove", zh: "移除", source: "official t/YqKh" },
  save: { en: "Save", zh: "保存", source: "official tfDRzk" },
  cancel: { en: "Cancel", zh: "取消", source: "official dEgA5A" },
  removeServer: { en: "Remove", zh: "移除", source: "official t/YqKh" },
  requiredName: {
    en: "The server name cannot be blank",
    zh: "服务器名称不能为空",
    source: "official Ra3OR9",
  },
  testFailed: { en: "Connection failed", zh: "连接失败", source: "official FGWsd4" },
  genericError: {
    en: "Something went wrong. Try again.",
    zh: "出错了，请重试。",
    source: "official D2AZQg",
  },
} as const satisfies Record<string, OfficialWording>;

/**
 * Official 0.78.1's wording for a marketplace row's trailing action.
 *
 * Upstream 0.18 labels that action "Add" (添加) and shows an "Added" (已添加) badge once the plugin
 * is installed. Official 0.78.1 replaced both with the connect wording below, and it renders the
 * connected state as text with NO button at all.
 *
 * `connectNamed` is official's ICU template `["连接 ",["0"]]` — the plugin name fills the `{0}`
 * slot — so the pair below is the template's prefix and the name is appended by the caller.
 *
 * @evidence official 0.78.1 `rea-grokbot-0781/app/dist/renderer/assets/chunk-core-CXBwRBzw.js`
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the row's trailing action.
 */
export const MARKETPLACE_CONNECT_ACTION_WORDING = {
  connect: { en: "Connect", zh: "连接", source: "official iSLIjg" },
  connecting: { en: "Connecting…", zh: "正在连接…", source: "official JrFTcr" },
  connected: { en: "Connected", zh: "已连接", source: "official QHcLEN" },
  connectNamed: { en: "Connect ", zh: "连接 ", source: "official 5ZzgbQ" },
} as const satisfies Record<string, OfficialWording>;

/**
 * The custom-MCP fields official 0.75.8 has no message id for. They keep their English text
 * rather than getting invented Chinese.
 */
export const UNPORTED_CUSTOM_MCP_FIELDS = [
  "urlHint",
  "testConnection",
  "testing",
  "testOk",
  "invalidUrl",
  "nonHttpUrl",
  "credentialsInUrl",
] as const;
