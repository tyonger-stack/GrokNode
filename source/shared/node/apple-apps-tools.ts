/**
 * Apple 本地应用工具面契约 —— 逐字移植自 Grok Bot 0.75.8 local-exec-daemon。
 *
 * 上游锚点：rea-grokbot-0758/apple/evidence.json（36 锚点组，从 pinned asar
 * 7d6fe1a4…779 提取）。tests/apple-apps-tools.test.mjs 逐项对照该 evidence
 * 断言本模块与上游字节一致；改这里必须先过那组测试。
 *
 * 证据分工：域表/权限键/超时/错误码来自 main.cjs 常量（domain-probe-map、
 * bundle-table、permission-keys-*、sidecar-timeouts、sidecar-error-codes）；
 * op 参数面来自 est()/Vnt() 分发与 zod 联合（apple-events-op-dispatch、
 * messages-op-union）；TCC 修复文案来自 jge()（tcc-remediation-copy）。
 */

export const APPLE_APP_DOMAINS = ["reminders", "calendar", "contacts", "notes", "mail"] as const;
export type AppleAppDomain = (typeof APPLE_APP_DOMAINS)[number];

export const APPLE_PERMISSION_STATES = ["ready", "needs_permission", "denied", "unavailable"] as const;
export type ApplePermissionState = (typeof APPLE_PERMISSION_STATES)[number];

export interface AppleDomainPermission {
  /** TCC 探针权限键；messages 与 location 不走这张表。 */
  readonly probe: string;
  /** 探针通过后仍需连带授予的权限键。 */
  readonly others: readonly string[];
  readonly bundleId: string;
}

export const APPLE_DOMAIN_PERMISSIONS: Readonly<Record<AppleAppDomain, AppleDomainPermission>> = Object.freeze({
  reminders: { probe: "ios_read_reminders", others: ["ios_write_reminders"], bundleId: "com.apple.reminders.device-tool" },
  calendar: { probe: "mobile_read_calendar", others: ["mobile_write_calendar"], bundleId: "com.apple.iCal.device-tool" },
  contacts: { probe: "mobile_read_contacts", others: [], bundleId: "com.apple.AddressBook.device-tool" },
  notes: { probe: "mac_read_notes", others: ["mac_write_notes"], bundleId: "com.apple.Notes.device-tool" },
  mail: { probe: "mac_read_mail", others: ["mac_draft_mail"], bundleId: "com.apple.mail.device-tool" },
});

/** est() 分发键 = TCC 权限键，不是 proto 工具名。 */
export const APPLE_TOOL_KEYS = [
  "ios_read_reminders", "ios_write_reminders",
  "mobile_read_calendar", "mobile_write_calendar", "mobile_read_contacts",
  "mac_read_notes", "mac_write_notes", "mac_read_mail", "mac_draft_mail",
  "device_get_location",
] as const;
export type AppleToolKey = (typeof APPLE_TOOL_KEYS)[number];

export const APPLE_NOTES_MAX_CHARS = 20_000;
export const APPLE_READ_LIMIT_DEFAULT = 100;
export const APPLE_READ_LIMIT_MAX = 500;
export const APPLE_CONTACTS_LIMIT_DEFAULT = 10;
export const APPLE_CONTACTS_LIMIT_MAX = 50;

/** 上游 _D.limitOf / yD.limitOf：非数或非有限取默认，否则夹到 [1, max] 取整。 */
export function clampAppleLimit(value: unknown, fallback: number, max: number): number {
  return typeof value !== "number" || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(1, Math.floor(value)));
}

export function clampAppleReadLimit(value: unknown): number {
  return clampAppleLimit(value, APPLE_READ_LIMIT_DEFAULT, APPLE_READ_LIMIT_MAX);
}

export function clampAppleContactsLimit(value: unknown): number {
  return clampAppleLimit(value, APPLE_CONTACTS_LIMIT_DEFAULT, APPLE_CONTACTS_LIMIT_MAX);
}
/** calendar 读窗：默认 7 天，上限 31 天，两端各留 1 天 padding。 */
export const APPLE_CALENDAR_WINDOW_DEFAULT_MS = 10_080 * 60 * 1_000;
export const APPLE_CALENDAR_WINDOW_MAX_MS = 744 * 60 * 60 * 1_000;
export const APPLE_CALENDAR_WINDOW_PADDING_MS = 1_440 * 60 * 1_000;

/** Sidecar RPC 超时（毫秒）：短探测 10s，常规调用 75s，location 100s。 */
export const APPLE_SIDECAR_TIMEOUT_SHORT_MS = 10_000;
export const APPLE_SIDECAR_TIMEOUT_CALL_MS = 75_000;
export const APPLE_SIDECAR_TIMEOUT_LOCATION_MS = 100_000;
export const APPLE_SIDECAR_LAUNCH_WINDOW_MS = 8_000;
export const APPLE_SIDECAR_LAUNCH_POLL_MS = 200;

export const APPLE_SIDECAR_ERROR_CODES = [
  "sidecar_missing", "sidecar_not_running", "sidecar_unreachable", "sidecar_closed",
  "sidecar_timeout", "sidecar_cancelled", "sidecar_invalid_state", "sidecar_invalid_reply",
  "location_denied", "location_services_off", "location_authorization_timeout", "location_timeout",
] as const;
export type AppleSidecarErrorCode = (typeof APPLE_SIDECAR_ERROR_CODES)[number];

export interface AppleSidecarDescriptor {
  readonly variant: "prod" | "lab" | "dev";
  readonly appName: string;
  readonly bundleId: string;
  readonly appSupportDir: string;
  readonly executable: string;
}

/** 上游 Z5；env GROK_BOT_SIDECAR_APP 按 .app 名匹配，未命中回落 dev。 */
export const APPLE_SIDECAR_DESCRIPTORS: Readonly<Record<AppleSidecarDescriptor["variant"], AppleSidecarDescriptor>> = Object.freeze({
  prod: { variant: "prod", appName: "Grok Bot Computer Use", bundleId: "co.anysphere.grok-bot-computer-use", appSupportDir: "grok-bot-computer-use", executable: "CUGrokBotService" },
  lab: { variant: "lab", appName: "Grok Bot Lab Computer Use", bundleId: "co.anysphere.grok-bot-lab-computer-use", appSupportDir: "grok-bot-lab-computer-use", executable: "CUGrokBotLabService" },
  dev: { variant: "dev", appName: "Grok Bot Dev Computer Use", bundleId: "co.anysphere.grok-bot-dev-computer-use", appSupportDir: "grok-bot-dev-computer-use", executable: "CUGrokBotDevService" },
});

/** 上游 tst 显示名表（jge() 文案用它，不从 bundleId 推导）。 */
export const APPLE_DOMAIN_DISPLAY_NAMES: Readonly<Record<AppleAppDomain, string>> = Object.freeze({
  reminders: "Reminders", calendar: "Calendar", contacts: "Contacts", notes: "Notes", mail: "Mail",
});

/** apple-events/run 的 op 面：{app, op, args}，args 键为 undefined 的丢弃。 */
export type AppleEventsOp =
  | { readonly app: "notes"; readonly op: "get"; readonly args: { readonly id: string; readonly maxChars: number } }
  | { readonly app: "notes"; readonly op: "search"; readonly args: { readonly query?: string; readonly folder?: string; readonly limit?: number } }
  | { readonly app: "notes"; readonly op: "append"; readonly args: { readonly id: string; readonly currentTitle: string; readonly body: string } }
  | { readonly app: "notes"; readonly op: "create"; readonly args: { readonly title: string; readonly body: string; readonly folder?: string } }
  | { readonly app: "mail"; readonly op: "get"; readonly args: { readonly id: string; readonly maxChars: number } }
  | { readonly app: "mail"; readonly op: "search"; readonly args: { readonly query?: string; readonly mailbox?: string; readonly unreadOnly?: boolean; readonly days?: number; readonly limit?: number } }
  | { readonly app: "mail"; readonly op: "draft"; readonly args: { readonly replyToId?: string; readonly to?: readonly string[]; readonly cc?: readonly string[]; readonly subject?: string; readonly body: string } };

/** Messages op 联合（messages-op 帧，独立 consent 流，本轮只定契约不接执行）。 */
export type AppleMessagesOp =
  | { readonly kind: "find-chats"; readonly displayName?: string; readonly handle?: string; readonly limit?: number }
  | { readonly kind: "items"; readonly chatGuid?: string; readonly limit?: number; readonly before?: { readonly date: string; readonly id: number } }
  | { readonly kind: "search"; readonly needle: string; readonly limit?: number; readonly before?: { readonly date: string; readonly id: number } }
  | { readonly kind: "activity"; readonly since: string; readonly until?: string }
  | { readonly kind: "send"; readonly text: string; readonly service?: "iMessage" | "SMS" | "auto"; readonly to?: string }
  | { readonly kind: "send"; readonly text: string; readonly service?: "iMessage" | "SMS" | "auto"; readonly chatId?: string }
  | { readonly kind: "check-permissions" }
  | { readonly kind: "fetch-attachment"; readonly messageGuid: string; readonly attachmentGuid: string }
  | { readonly kind: "find-contacts"; readonly query: string };

/** TCC 引导文案（上游 jge()， appName 指向 sidecar）。 */
export function appleTccRemediation(domain: AppleAppDomain, appName = APPLE_SIDECAR_DESCRIPTORS.prod.appName): string {
  const app = APPLE_DOMAIN_DISPLAY_NAMES[domain];
  switch (domain) {
    case "notes":
    case "mail":
      return `Grok Bot isn't allowed to control ${app} on this Mac. Turn on ${app} under ${appName} in System Settings > Privacy & Security > Automation.`;
    case "calendar":
      return `Calendar access for ${appName} is off or adds events only on this Mac. Give it Full Access in System Settings > Privacy & Security > Calendars.`;
    case "reminders":
      return `Reminders access for ${appName} is off on this Mac. Give it Full Access in System Settings > Privacy & Security > Reminders.`;
    case "contacts":
      return `Contacts access for ${appName} is off on this Mac. Turn it on in System Settings > Privacy & Security > Contacts.`;
  }
}

/** 权限键 → 域（上游 Ant 映射，probe 与 others 都算）。 */
export function appleDomainForPermissionKey(key: string): AppleAppDomain | undefined {
  for (const domain of APPLE_APP_DOMAINS) {
    const p = APPLE_DOMAIN_PERMISSIONS[domain];
    if (p.probe === key || p.others.includes(key)) return domain;
  }
  return undefined;
}
