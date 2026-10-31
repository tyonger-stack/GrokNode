/**
 * Official 0.78.1's native marketplace entries, ported verbatim.
 *
 * ## What these are
 *
 * Official 0.78.1's "连接应用" catalogue carries two entries the marketplace RPC never returns:
 * 1Password and 邮箱. They are built client-side from official's own constants and merged into the
 * catalogue in memory — they are not server data:
 *
 *   `index.eager-app-D1juOWZp.js` :3 col ~153453 — `Zo=['onepassword','email']` (the native
 *   markers), `Qo='native:'`, `$o={onepassword:'1password',email:'email'}` (the name map),
 *   `ns(key) => 'native:'+key` (the id scheme), and `lRe` at :14 col ~152758 — the two entries'
 *   own fields.
 *
 * The factory `Vb(e,t,n)` emits
 * `{id:ns(t),name:$o[t],displayName:uRe(e,r.displayName),description:e(i),category:e(r.category),
 * categoryKey:r.categoryKey,categoryKeys:[r.categoryKey],...(websiteUrl),publisher:r.publisher,native:t}`,
 * with the description resolved through official's locale runtime. `DRe()` builds them with
 * `TRe() = is({onepassword:true, email:nd('grok_bot_agent_mail')})` and
 * `{onePasswordBrokered: nd('sand_new_1pass')}`.
 *
 * Both remote flags are ON on the live official 0.78.1 build (measured 2026-10-31 over CDP: the
 * 邮箱 row renders in 通信 and the 1Password detail page shows the brokered description), and this
 * reconstruction has no remote-config surface for either flag, so both are pinned to the measured
 * values: the email entry is present and the 1Password description is the brokered one.
 *
 * ## Every string below is official 0.78.1's own
 *
 * Taken from the official locale tables under official's own message ids:
 *
 *   hYe7bF  让 Grok Bot 使用你的 1Password 登录信息在它自己的电脑上登录网站。每个请求都由你在 1Password 中批准，Grok Bot 永远看不到这些值
 *           / Let Grok Bot sign in to sites on its computer with your 1Password logins. You approve
 *             each request in 1Password, and Grok Bot never sees the values   (brokered description)
 *   4CnYjv  通过服务账户与 Grok Bot 共享一个专用的 1Password 保管库…   (the plain description, superseded here by the brokered one)
 *   P+nzjE  密码管理器 / Password Managers                                   (1Password's category)
 *   O3oNi5  邮箱 / Email                                                      (the email entry's display name)
 *   uNYe1e  为 Grok Bot 提供专属域名下的邮箱地址。收到的邮件只会通过你设置的例行任务唤醒 Bot。
 *           / Give Grok Bot its own email address on a dedicated domain. Mail that arrives wakes
 *             a Bot only through a routine you set up.   (the email description)
 *   IzFMeN  收件箱与协作 / Inbox and Collaboration   (the email entry's category)
 *
 * `1Password` is a plain string in official's `lRe` (`Bb='1Password'`), not a message id, so it
 * never localizes. The email entry has no `websiteUrl` in official's constants, so it carries none
 * here either.
 *
 * ## Where they join the catalogue
 *
 * Official merges them in the renderer's marketplace model. This reconstruction's plugins view
 * reads the host catalogue directly over the preload bridge, so the desktop manager appends them
 * to `getCatalog`'s views — the single point every catalogue consumer (the browse page, the
 * search filter, the chip row) already flows through. The locale is resolved at each call from
 * the persisted language preference, so a preference flip re-localizes on the next catalogue read.
 *
 * The entries carry no `iconUrl`; official resolves their icons from the name through its own
 * brand-registry (`1password` → brand SVG, `email` → envelope glyph), which the renderer patch
 * reproduces for the rows it renders.
 */

import { resolveLocale, type LanguagePreference } from "../i18n/locale.js";

export interface NativeCatalogEntryLocale {
  /** The persisted language preference (`follow-system` resolves against the system tags). */
  readonly preference: LanguagePreference;
  /** The OS preferred languages, used only when the preference is `follow-system`. */
  readonly systemTags: readonly string[];
}

interface NativeEntryCopy {
  readonly description: string;
  readonly category: string;
}

const ONEPASSWORD_COPY: Record<"en" | "zh-CN", NativeEntryCopy> = {
  en: {
    description:
      "Let Grok Bot sign in to sites on its computer with your 1Password logins. You approve each request in 1Password, and Grok Bot never sees the values",
    category: "Password Managers",
  },
  "zh-CN": {
    description:
      "让 Grok Bot 使用你的 1Password 登录信息在它自己的电脑上登录网站。每个请求都由你在 1Password 中批准，Grok Bot 永远看不到这些值",
    category: "密码管理器",
  },
};

const EMAIL_COPY: Record<"en" | "zh-CN", NativeEntryCopy> = {
  en: {
    description:
      "Give Grok Bot its own email address on a dedicated domain. Mail that arrives wakes a Bot only through a routine you set up.",
    category: "Inbox and Collaboration",
  },
  "zh-CN": {
    description: "为 Grok Bot 提供专属域名下的邮箱地址。收到的邮件只会通过你设置的例行任务唤醒 Bot。",
    category: "收件箱与协作",
  },
};

/**
 * Official 0.78.1's two native entries, in the view shape the catalogue already returns.
 * The field set is `Vb`'s own output — no `pluginName`, `iconUrl`, `connectors` or `skills`,
 * exactly like official's.
 */
export function officialNativeCatalogEntries(deps: NativeCatalogEntryLocale): Record<string, unknown>[] {
  const locale = resolveLocale(deps.preference, deps.systemTags);
  const zh = locale === "zh-CN";
  const onepassword = ONEPASSWORD_COPY[locale];
  const email = EMAIL_COPY[locale];
  return [
    {
      id: "native:onepassword",
      name: "1password",
      displayName: "1Password",
      description: onepassword.description,
      category: onepassword.category,
      categoryKey: "LOGIN_AND_CREDENTIAL_MANAGEMENT",
      categoryKeys: ["LOGIN_AND_CREDENTIAL_MANAGEMENT"],
      websiteUrl: "https://1password.com",
      publisher: { name: "1password", displayName: "1Password", isUserOwned: false },
      native: "onepassword",
    },
    {
      id: "native:email",
      name: "email",
      displayName: zh ? "邮箱" : "Email",
      description: email.description,
      category: email.category,
      categoryKey: "INBOX_AND_COLLABORATION",
      categoryKeys: ["INBOX_AND_COLLABORATION"],
      publisher: { name: "grok-bot", displayName: "Grok Bot", isUserOwned: false },
      native: "email",
    },
  ];
}
