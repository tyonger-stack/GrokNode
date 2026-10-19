export function slackProfileField(profile: string, field: RegExp): string | undefined {
  const value = field.exec(profile)?.[1]?.trim();
  return value ? value : undefined;
}
export function slackPartnerDisplayName(profile: string): string | undefined {
  return slackProfileField(profile, /^Display Name:\s*(.+)$/m)
    ?? slackProfileField(profile, /^[^\n(]*\(([^)\n]+)\)/)
    ?? slackProfileField(profile, /^Real Name:\s*(.+)$/m);
}
export function resolveSlackToLabel(facts: {
  readonly headerName: string;
  readonly channelId: string;
  readonly messages: string;
  readonly profile: string;
  readonly partnerProfile: string;
}): string {
  const { headerName, channelId, messages, profile, partnerProfile } = facts;
  if (headerName !== "DM" && !/^DM\s*\(/.test(headerName) && headerName !== channelId && !/^[CDG][A-Z0-9]{8,}$/i.test(headerName)) return headerName;
  const partnerName = slackPartnerDisplayName(partnerProfile);
  if (partnerName) return partnerName;
  const selfEmail = slackProfileField(profile, /^Email:\s*(\S+@\S+)$/m)?.toLowerCase();
  const selfNames = [/^Display Name:\s*(.+)$/m, /^Real Name:\s*(.+)$/m, /^Username:\s*(.+)$/m, /^[^\n(]*\(([^)\n]+)\)/]
    .map(field => slackProfileField(profile, field)?.toLowerCase()).filter(value => value != null);
  for (const line of messages.split("\n")) {
    if (line.trim().startsWith("Channel:")) continue;
    const person = /^([^<>]+?)\s*<([^\s<>]+@[^\s<>]+)>:/.exec(line.trim());
    const name = person?.[1]?.trim() ?? /^([^:<>]+):/.exec(line.trim())?.[1]?.trim();
    if (name && person?.[2]?.toLowerCase() !== selfEmail && !selfNames.includes(name.toLowerCase())) return name;
  }
  return headerName === "DM" ? `DM (${channelId})` : headerName;
}
