import { z } from "zod";
import type { Local0721Backends } from "./local-backends-0721.js";

const text = z.string().max(16384);
const id = z.string().max(512);
const vaultId = z.string().min(1).max(256);
const vaultUpsertId = z.string().max(256);
const vaultTitle = z.string().max(200);
const vaultUsername = z.string().max(512);
const vaultNotes = z.string().max(2048);
const vaultSite = z.string().max(2048);
const vaultPassword = z.string().refine((value) => new TextEncoder().encode(value).byteLength <= 4096,
  "Vault password must be at most 4096 bytes");
const vaultAddress = z.object({ line1: z.string().max(256), line2: z.string().max(256),
  city: z.string().max(256), region: z.string().max(256), postalCode: z.string().max(256),
  country: z.string().max(256) }).strict();
const login = z.object({ title: vaultTitle, username: vaultUsername, password: vaultPassword,
  notes: vaultNotes, sites: z.array(vaultSite).max(10) }).strict();
const team = z.object({ teamId: id.min(1) }).strict();

export function createLocalBackendHandlers0721(get: () => Local0721Backends) {
  const cardPhotoReads = new Map<string, AbortController>();
  return {
    listGrokBotVaultCredentials: () => get().vault.listGrokBotVaultCredentials(),
    putGrokBotVaultCredential: (raw: unknown) => get().vault.putGrokBotVaultCredential(login.extend({ id: vaultUpsertId }).parse(raw)),
    createGrokBotVaultLogins: (raw: unknown) => get().vault.createGrokBotVaultLogins(
      z.object({ logins: z.array(login).max(1000) }).strict().parse(raw)),
    updateGrokBotVaultCard: (raw: unknown) => {
      const card = z.object({ id: vaultId, holderName: z.string().max(200),
        nickname: z.string().max(200).optional(), expiry: z.string().max(64),
        billingAddress: vaultAddress, billingAddressId: vaultId }).strict().parse(raw);
      const { nickname, ...base } = card;
      return get().vault.updateGrokBotVaultCard({ ...base,
        ...(nickname === undefined ? {} : { nickname }) });
    },
    putGrokBotVaultContact: (raw: unknown) => get().vault.putGrokBotVaultContact(
      z.object({ id: vaultUpsertId, title: vaultTitle,
        contact: vaultAddress.extend({ name: z.string().max(200), phone: z.string().max(64),
          email: z.string().max(320), defaultShipping: z.boolean().optional().default(false) }) }).strict().parse(raw)),
    createGrokBotVaultCard: (raw: unknown) => get().vault.createGrokBotVaultCard(
      z.object({ values: z.record(z.string(), z.string().max(4096)) }).strict().parse(raw)),
    deleteGrokBotVaultCredential: async (raw: unknown) => {
      await get().vault.deleteGrokBotVaultCredential(z.object({ id: vaultId }).strict().parse(raw).id);
      return {};
    },
    readGrokBotCardPhoto: async (raw: unknown) => {
      const args = z.object({ readId: z.string().min(1).max(512),
        photos: z.array(z.object({ image: z.instanceof(Uint8Array), mimeType: z.string() }).strict()).max(4) }).strict().parse(raw);
      const controller = new AbortController();
      cardPhotoReads.set(args.readId, controller);
      try {
        return await get().vault.readGrokBotCardPhoto({ photos: args.photos }, controller.signal);
      } finally {
        cardPhotoReads.delete(args.readId);
      }
    },
    cancelGrokBotCardPhotoRead: async (raw: unknown) => {
      const args = z.object({ readId: z.string().min(1).max(512) }).strict().parse(raw);
      cardPhotoReads.get(args.readId)?.abort();
      return {};
    },
    getTeamTailnet: (raw: unknown) => get().tailnet.getTeamTailnet(team.parse(raw)),
    updateTeamTailnet: (raw: unknown) => get().tailnet.updateTeamTailnet(team.extend({ enabled: z.boolean(),
      magicDnsSuffix: z.string().max(253).nullable().default(null), consent: z.boolean(),
      tags: z.array(z.string().max(128)).max(32).optional() }).parse(raw)),
    updateTeamTailnetCredential: (raw: unknown) => get().tailnet.updateTeamTailnetCredential(z.union([
      team.extend({ remove: z.literal(true) }),
      team.extend({ clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(16384), remove: z.literal(false).default(false) }),
    ]).parse(raw)),
    discoverTeamTailnetSuffix: (raw: unknown) => get().tailnet.discoverTeamTailnetSuffix(team.parse(raw)),
    connectTeamTailnet: (raw: unknown) => get().tailnet.connectTeamTailnet(team.parse(raw)),
  };
}
