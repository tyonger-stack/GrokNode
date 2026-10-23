import { z } from "zod";
import type { Local0721Backends } from "./local-backends-0721.js";

const text = z.string().max(16384);
const id = z.string().max(512);
const address = z.object({ line1: text, line2: text, city: text, region: text, postalCode: text, country: text }).strict();
const login = z.object({ title: text, username: text, password: text, notes: text,
  sites: z.array(z.string().max(4096)).max(128) }).strict();
const team = z.object({ teamId: id.min(1) }).strict();

export function createLocalBackendHandlers0721(get: () => Local0721Backends) {
  const cardPhotoReads = new Map<string, AbortController>();
  return {
    listGrokBotVaultCredentials: () => get().vault.listGrokBotVaultCredentials(),
    putGrokBotVaultCredential: (raw: unknown) => get().vault.putGrokBotVaultCredential(login.extend({ id }).parse(raw)),
    createGrokBotVaultLogins: (raw: unknown) => get().vault.createGrokBotVaultLogins(
      z.object({ logins: z.array(login).max(10000) }).strict().parse(raw)),
    updateGrokBotVaultCard: (raw: unknown) => get().vault.updateGrokBotVaultCard(
      z.object({ id, holderName: text, expiry: text, billingAddress: address, billingAddressId: id }).strict().parse(raw)),
    putGrokBotVaultContact: (raw: unknown) => get().vault.putGrokBotVaultContact(
      z.object({ id, title: text, contact: address.extend({ name: text, phone: text, email: text, defaultShipping: z.boolean() }) }).strict().parse(raw)),
    createGrokBotVaultCard: (raw: unknown) => get().vault.createGrokBotVaultCard(
      z.object({ values: z.record(z.string(), text) }).strict().parse(raw)),
    deleteGrokBotVaultCredential: async (raw: unknown) => {
      await get().vault.deleteGrokBotVaultCredential(z.object({ id }).strict().parse(raw).id);
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
