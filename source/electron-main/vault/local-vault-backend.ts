import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecureStorageCodec } from "../secrets/secret-store.js";
import type {
  VaultAddress,
  VaultBatchCreateResult,
  VaultCardCreateInput,
  VaultCardPhoto,
  VaultCardPhotoRequest,
  VaultCardPhotoResult,
  VaultCardUpdateInput,
  VaultContactInput,
  VaultCredential,
  VaultCredentialReference,
  VaultLoginInput,
  VaultLoginValues,
  VaultSessionSnapshot,
  VaultTrustedCredential,
} from "../../shared/vault.js";
import {
  detectCardBrand,
  duplicateKeys,
  parseExpiry,
  planLogin,
  validateCardNumber,
  validateSecurityCode,
} from "./upstream-vault-parsers.generated.mjs";
import { parseRecognizedCard } from "./upstream-vault-parsers.generated.mjs";

const STORE_VERSION = 1;
const ACCOUNT_SCOPE_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const PHOTO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const BILLING_FIELDS = [
  ["billing_line1", "line1"],
  ["billing_line2", "line2"],
  ["billing_city", "city"],
  ["billing_region", "region"],
  ["billing_postal_code", "postalCode"],
  ["billing_country", "country"],
] as const;

export class VaultEncryptionUnavailableError extends Error {
  constructor() {
    super("OS encryption is unavailable for the local Vault");
    this.name = "VaultEncryptionUnavailableError";
  }
}

export class VaultInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultInvalidArgumentError";
  }
}

export class VaultNotFoundError extends Error {
  constructor(message = "Vault credential was not found") {
    super(message);
    this.name = "VaultNotFoundError";
  }
}

export class VaultStorageCorruptedError extends Error {
  constructor(message = "Local Vault store is malformed") {
    super(message);
    this.name = "VaultStorageCorruptedError";
  }
}

interface StoredVaultRecordBase {
  readonly id: string;
  readonly kind: "login" | "card" | "contact";
  readonly title: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

interface StoredLoginRecord extends StoredVaultRecordBase {
  readonly kind: "login";
  readonly username: string;
  readonly notes: string;
  readonly sites: readonly string[];
  readonly secretCiphertextBase64: string;
}

interface StoredCardRecord extends StoredVaultRecordBase {
  readonly kind: "card";
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly holderName: string;
  readonly nickname: string;
  readonly billingAddressId: string;
  readonly billingAddress: VaultAddress;
  readonly secretCiphertextBase64: string;
}

interface StoredContactRecord extends StoredVaultRecordBase {
  readonly kind: "contact";
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string;
  readonly email: string;
  readonly defaultShipping: boolean;
}

type StoredVaultRecord = StoredLoginRecord | StoredCardRecord | StoredContactRecord;
type AccountStore = Map<string, StoredVaultRecord>;
type VaultStore = Map<string, AccountStore>;

export interface CardTextRecognitionNative {
  recognize_text_async(image: Uint8Array): Promise<string[][] | null>;
}

export interface LocalVaultBackendOptions {
  readonly accountScope: string;
  readonly storePath: string;
  readonly codec: SecureStorageCodec;
  readonly cardsEnabled?: boolean;
  readonly now?: () => number;
  readonly loadCardPhotoNative?: () => CardTextRecognitionNative | undefined;
  readonly onChange?: () => Promise<void> | void;
}

const mutationTails = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: Record<string, unknown>, key: string, maxLength = 4096): string {
  const property = value[key];
  if (typeof property !== "string" || property.length > maxLength) {
    throw new VaultInvalidArgumentError(`Vault field ${key} must be a string`);
  }
  return property;
}

function optionalString(value: Record<string, unknown>, key: string, maxLength = 4096): string {
  const property = value[key];
  if (property === undefined) return "";
  return stringProperty(value, key, maxLength);
}

function stringArrayProperty(value: Record<string, unknown>, key: string, maxItems: number): readonly string[] {
  const property = value[key];
  if (!Array.isArray(property) || property.length > maxItems) {
    throw new VaultInvalidArgumentError(`Vault field ${key} must contain at most ${maxItems} strings`);
  }
  return property.map((item) => {
    if (typeof item !== "string" || item.length > 2048) {
      throw new VaultInvalidArgumentError(`Vault field ${key} must contain strings`);
    }
    return item;
  });
}


function parseStoredAddress(value: unknown): VaultAddress {
  if (!isRecord(value)) throw new VaultStorageCorruptedError("Vault card address is malformed");
  return {
    line1: stringProperty(value, "line1"),
    line2: stringProperty(value, "line2"),
    city: stringProperty(value, "city"),
    region: stringProperty(value, "region"),
    postalCode: stringProperty(value, "postalCode"),
    country: stringProperty(value, "country"),
  };
}

function parseStoredRecord(value: unknown): StoredVaultRecord {
  if (!isRecord(value)) throw new VaultStorageCorruptedError("Vault record is malformed");
  const id = stringProperty(value, "id", 256);
  const title = stringProperty(value, "title", 256);
  const createdAtMs = value.createdAtMs;
  const updatedAtMs = value.updatedAtMs;
  if (typeof createdAtMs !== "number" || !Number.isSafeInteger(createdAtMs) ||
      typeof updatedAtMs !== "number" || !Number.isSafeInteger(updatedAtMs)) {
    throw new VaultStorageCorruptedError("Vault record timestamps are malformed");
  }
  const base = { id, title, createdAtMs, updatedAtMs };
  if (value.kind === "login") {
    return {
      ...base,
      kind: "login",
      username: stringProperty(value, "username", 512),
      notes: stringProperty(value, "notes", 2048),
      sites: stringArrayProperty(value, "sites", 10),
      secretCiphertextBase64: stringProperty(value, "secretCiphertextBase64", 262144),
    };
  }
  if (value.kind === "card") {
    const expMonth = value.expMonth;
    const expYear = value.expYear;
    if (typeof expMonth !== "number" || !Number.isSafeInteger(expMonth) ||
        typeof expYear !== "number" || !Number.isSafeInteger(expYear)) {
      throw new VaultStorageCorruptedError("Vault card expiry is malformed");
    }
    return {
      ...base,
      kind: "card",
      brand: stringProperty(value, "brand", 64),
      last4: stringProperty(value, "last4", 4),
      expMonth,
      expYear,
      holderName: stringProperty(value, "holderName", 200),
      nickname: typeof value.nickname === "string" && value.nickname.length <= 200 ? value.nickname : "",
      billingAddressId: stringProperty(value, "billingAddressId", 256),
      billingAddress: parseStoredAddress(value.billingAddress),
      secretCiphertextBase64: stringProperty(value, "secretCiphertextBase64", 262144),
    };
  }
  if (value.kind === "contact") {
    const defaultShipping = value.defaultShipping;
    if (typeof defaultShipping !== "boolean") throw new VaultStorageCorruptedError("Vault contact shipping flag is malformed");
    return {
      ...base,
      kind: "contact",
      name: stringProperty(value, "name", 200),
      line1: stringProperty(value, "line1"),
      line2: stringProperty(value, "line2"),
      city: stringProperty(value, "city"),
      region: stringProperty(value, "region"),
      postalCode: stringProperty(value, "postalCode"),
      country: stringProperty(value, "country"),
      phone: stringProperty(value, "phone", 64),
      email: stringProperty(value, "email", 320),
      defaultShipping,
    };
  }
  throw new VaultStorageCorruptedError("Vault record kind is malformed");
}

function assertNoPlaintextSecretFields(value: unknown, seen = 0): void {
  if (seen > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoPlaintextSecretFields(item, seen + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, property] of Object.entries(record)) {
    if (key === "password" || key === "cc_number" || key === "cc_csc" || key === "number" || key === "securityCode") {
      throw new VaultStorageCorruptedError(`Local Vault store contains plaintext field ${key}`);
    }
    assertNoPlaintextSecretFields(property, seen + 1);
  }
}

function isNodeErrnoException(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function serializeRecord(record: StoredVaultRecord): Record<string, unknown> {
  const { ...result } = record;
  return result;
}

function credentialOf(record: StoredVaultRecord): VaultCredential {
  const common = {
    id: record.id,
    title: record.title,
    username: record.kind === "login" ? record.username : "",
    notes: record.kind === "login" ? record.notes : "",
    sites: record.kind === "login" ? [...record.sites] : [],
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
  if (record.kind === "card") {
    return { ...common, card: {
      brand: record.brand,
      last4: record.last4,
      expMonth: record.expMonth,
      expYear: record.expYear,
      holderName: record.holderName,
      nickname: record.nickname,
      billingAddressId: record.billingAddressId,
      billingAddress: record.billingAddress,
    } };
  }
  if (record.kind === "contact") {
    return { ...common, contact: {
      name: record.name,
      line1: record.line1,
      line2: record.line2,
      city: record.city,
      region: record.region,
      postalCode: record.postalCode,
      country: record.country,
      phone: record.phone,
      email: record.email,
      defaultShipping: record.defaultShipping,
    } };
  }
  return common;
}

function plannedResult(result: unknown): { readonly kind: "ready"; readonly login: VaultLoginValues } | {
  readonly kind: "duplicate" | "invalid";
  readonly message: string;
} {
  if (!isRecord(result) || !isRecord(result.preview) || !isRecord(result.preview.status)) {
    throw new VaultInvalidArgumentError("Upstream login planner returned an invalid result");
  }
  const status = result.preview.status;
  if (typeof status.kind !== "string") throw new VaultInvalidArgumentError("Upstream login planner status is malformed");
  if (isRecord(result.item) && isRecord(result.item.login) && status.kind === "ready") {
    const item = result.item.login;
    const sites = stringArrayProperty(item, "sites", 10);
    return {
      kind: "ready",
      login: {
        title: stringProperty(item, "title", 200),
        username: stringProperty(item, "username", 512),
        notes: stringProperty(item, "notes", 2048),
        sites,
        password: stringProperty(item, "password", 4096),
      },
    };
  }
  const problem = typeof status.problem === "string" ? status.problem : status.kind;
  return { kind: status.kind === "duplicate" ? "duplicate" : "invalid", message: problem };
}

function expiryOf(value: string, field: string): { readonly month: number; readonly year: number } {
  const parsed = parseExpiry(value);
  if (parsed === null) throw new VaultInvalidArgumentError(`Vault field ${field} must be a valid expiry`);
  return parsed;
}

function addressFromCardValues(values: Readonly<Record<string, string>>): VaultAddress {
  const address = {
    line1: values.billing_line1 ?? "",
    line2: values.billing_line2 ?? "",
    city: values.billing_city ?? "",
    region: values.billing_region ?? "",
    postalCode: values.billing_postal_code ?? "",
    country: values.billing_country ?? "",
  };
  for (const [field, value] of Object.entries(address)) {
    if (value.length > 256) throw new VaultInvalidArgumentError(`Vault card field ${field} is too long`);
  }
  return address;
}

function encryptedSecret(codec: SecureStorageCodec, value: Readonly<Record<string, string>>): string {
  return codec.encryptString(JSON.stringify(value)).toString("base64");
}

function decryptedSecret(codec: SecureStorageCodec, ciphertextBase64: string): Record<string, string> {
  const plaintext = codec.decryptString(Buffer.from(ciphertextBase64, "base64"));
  const parsed: unknown = JSON.parse(plaintext);
  if (!isRecord(parsed)) throw new VaultStorageCorruptedError("Vault secret payload is malformed");
  const result: Record<string, string> = {};
  for (const [key, property] of Object.entries(parsed)) {
    if (typeof property !== "string") throw new VaultStorageCorruptedError("Vault secret payload is malformed");
    result[key] = property;
  }
  return result;
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function validNativePhotoLines(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((lines) => Array.isArray(lines) && lines.every((line) => typeof line === "string"));
}

export class LocalVaultBackend {
  private readonly mutationTailKey: string;

  constructor(private readonly options: LocalVaultBackendOptions) {
    if (!ACCOUNT_SCOPE_PATTERN.test(options.accountScope)) {
      throw new VaultInvalidArgumentError("Vault account scope must be a 64-character lowercase SHA-256 hex value");
    }
    if (options.storePath.length === 0) throw new VaultInvalidArgumentError("Vault store path is required");
    this.assertEncryptedStorage();
    this.mutationTailKey = options.storePath;
  }

  list(): Promise<VaultCredential[]> {
    return this.withAccount(async (account) => [...account.values()].map(credentialOf));
  }

  async sessionSnapshot(): Promise<VaultSessionSnapshot> {
    const account = await this.loadAccount();
    const nowMs = this.nowMs();
    const records = [...account.values()].sort((left, right) => left.updatedAtMs - right.updatedAtMs);
    const logins: VaultSessionSnapshot["logins"][number][] = [];
    const contacts: VaultSessionSnapshot["contacts"][number][] = [];
    for (const record of records) {
      if (record.kind === "login") {
        const secret = decryptedSecret(this.options.codec, record.secretCiphertextBase64);
        if (secret.password === undefined) throw new VaultStorageCorruptedError("Vault login secret is malformed");
        logins.push({ id: record.id, title: record.title, username: record.username, notes: record.notes,
          sites: [...record.sites], password: secret.password, updatedAtMs: record.updatedAtMs });
      } else if (record.kind === "contact") {
        contacts.push({ id: record.id, title: record.title, name: record.name, line1: record.line1,
          line2: record.line2, city: record.city, region: record.region, postalCode: record.postalCode,
          country: record.country, phone: record.phone, email: record.email,
          defaultShipping: record.defaultShipping, updatedAtMs: record.updatedAtMs });
      }
    }
    return { version: 1, updatedAtMs: nowMs, logins, contacts };
  }

  async put(input: VaultLoginInput): Promise<VaultCredential> {
    return this.withAccount(async (account, nowMs) => {
      const id = this.upsertId(input.id);
      const existing = [...account.values()].filter((record): record is StoredLoginRecord =>
        record.kind === "login" && record.id !== id);
      const planned = this.planVaultLogin(input, existing, nowMs);
      if (planned.kind !== "ready") throw new VaultInvalidArgumentError(planned.message);
      const now = this.nowMs();
      const prior = account.get(id);
      if (prior !== undefined && prior.kind !== "login") throw new VaultInvalidArgumentError("Vault item kind cannot change");
      const createdAtMs = prior?.createdAtMs ?? now;
      const record: StoredLoginRecord = {
        id,
        kind: "login",
        title: planned.login.title,
        username: planned.login.username,
        notes: planned.login.notes,
        sites: planned.login.sites,
        createdAtMs,
        updatedAtMs: now,
        secretCiphertextBase64: encryptedSecret(this.options.codec, { password: planned.login.password }),
      };
      account.set(id, record);
      return credentialOf(record);
    });
  }

  createLogins(input: { readonly logins: readonly VaultLoginValues[] }): Promise<VaultBatchCreateResult[]> {
    if (!Array.isArray(input.logins)) throw new VaultInvalidArgumentError("Vault logins must be an array");
    return this.withAccount(async (account, nowMs) => {
      const existing = [...account.values()];
      const keys = duplicateKeys(existing.map(credentialOf));
      const context = { cardsEnabled: this.cardsEnabled(), now: new Date(nowMs), ...keys };
      const records: StoredLoginRecord[] = [];
      const results: VaultBatchCreateResult[] = input.logins.map((login, index) => {
        const planned = this.planPrevalidatedLogin(login, context);
        if (planned.kind !== "ready") return { kind: "refused", message: planned.message };
        const record: StoredLoginRecord = {
          id: randomUUID(),
          kind: "login",
          title: planned.login.title,
          username: planned.login.username,
          notes: planned.login.notes,
          sites: planned.login.sites,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          secretCiphertextBase64: encryptedSecret(this.options.codec, { password: planned.login.password }),
        };
        records.push(record);
        return { kind: "imported" };
      });
      for (const record of records) account.set(record.id, record);
      return results;
    });
  }

  updateCard(input: VaultCardUpdateInput): Promise<VaultCredential> {
    return this.withAccount(async (account, nowMs) => {
      const id = this.validId(input.id);
      const record = account.get(id);
      if (record === undefined || record.kind !== "card") throw new VaultNotFoundError("Vault card was not found");
      this.validateHolderName(input.holderName);
      const expiry = expiryOf(input.expiry, "expiry");
      this.assertNotExpired(expiry, nowMs);
      const updated: StoredCardRecord = { ...record, holderName: input.holderName, nickname: input.nickname ?? record.nickname, expMonth: expiry.month, expYear: expiry.year,
        billingAddress: this.validAddress(input.billingAddress), billingAddressId: this.validText(input.billingAddressId, 256),
        updatedAtMs: nowMs };
      account.set(id, updated);
      return credentialOf(updated);
    });
  }

  putContact(input: VaultContactInput): Promise<VaultCredential> {
    return this.withAccount(async (account, nowMs) => {
      const id = this.upsertId(input.id);
      const prior = account.get(id);
      if (prior !== undefined && prior.kind !== "contact") throw new VaultInvalidArgumentError("Vault item kind cannot change");
      const contact = input.contact;
      const record: StoredContactRecord = {
        id,
        kind: "contact",
        title: this.validText(input.title, 200),
        createdAtMs: prior?.createdAtMs ?? nowMs,
        updatedAtMs: nowMs,
        name: this.validText(contact.name, 200),
        line1: this.validText(contact.line1, 256),
        line2: this.validText(contact.line2, 256),
        city: this.validText(contact.city, 256),
        region: this.validText(contact.region, 256),
        postalCode: this.validText(contact.postalCode, 256),
        country: this.validText(contact.country, 256),
        phone: this.validText(contact.phone, 64),
        email: this.validText(contact.email, 320),
        defaultShipping: contact.defaultShipping,
      };
      account.set(id, record);
      return credentialOf(record);
    });
  }

  createCard(input: VaultCardCreateInput): Promise<VaultCredential> {
    return this.withAccount(async (account, nowMs) => {
      if (!this.cardsEnabled()) throw new VaultInvalidArgumentError("Vault cards are disabled");
      const values = this.cardValues(input.values);
      const number = (values.cc_number ?? "").replace(/[\s-]/gu, "");
      if (!validateCardNumber(number)) throw new VaultInvalidArgumentError("Vault card number is invalid");
      const expiry = expiryOf(values.cc_exp ?? "", "cc_exp");
      this.assertNotExpired(expiry, nowMs);
      const securityCode = values.cc_csc ?? "";
      if (securityCode.length > 0 && !validateSecurityCode({ securityCode, number })) {
        throw new VaultInvalidArgumentError("Vault card security code is invalid");
      }
      const holderName = values.cc_name ?? "";
      this.validateHolderName(holderName);
      const cardKeys = duplicateKeys([...account.values()].map(credentialOf)).cardKeys;
      const cardKey = `${number.slice(-4)}\n${expiry.month}\n${expiry.year}`;
      if (cardKeys.has(cardKey)) throw new VaultInvalidArgumentError("Vault card already exists");
      const now = nowMs;
      const secret = securityCode.length === 0 ? { number } : { number, securityCode };
      const record: StoredCardRecord = {
        id: randomUUID(),
        kind: "card",
        title: `Card ${number.slice(-4)}`,
        createdAtMs: now,
        updatedAtMs: now,
        brand: detectCardBrand(number) ?? "",
        last4: number.slice(-4),
        expMonth: expiry.month,
        expYear: expiry.year,
        holderName,
        nickname: "",
        billingAddressId: values.billingAddressId ?? "",
        billingAddress: addressFromCardValues(values),
        secretCiphertextBase64: encryptedSecret(this.options.codec, secret),
      };
      account.set(record.id, record);
      return credentialOf(record);
    });
  }

  remove(id: string): Promise<void> {
    return this.withAccount(async (account, nowMs) => {
      void nowMs;
      const validId = this.validId(id);
      if (!account.delete(validId)) throw new VaultNotFoundError();
    });
  }

  async readCardPhoto(request: VaultCardPhotoRequest, signal?: AbortSignal): Promise<VaultCardPhotoResult> {
    const photos = this.validPhotos(request);
    try {
      const loader = this.options.loadCardPhotoNative;
      if (loader === undefined) return { outcome: "unavailable" };
      const native = loader();
      if (native === undefined || typeof native.recognize_text_async !== "function") return { outcome: "unavailable" };
      const recognized: string[][][] = [];
      for (const photo of photos) {
        signal?.throwIfAborted();
        const result = await withAbortSignal(native.recognize_text_async(photo.image), signal);
        if (result === null) return { outcome: "invalid_photo" };
        if (!validNativePhotoLines(result)) return { outcome: "unavailable" };
        recognized.push(result);
      }
      signal?.throwIfAborted();
      const parsed = parseRecognizedCard(recognized);
      if (parsed.outcome === "not_found") return { outcome: "not_found" };
      if (parsed.securityCode === undefined) {
        return { outcome: "read", number: parsed.number, expMonth: parsed.expMonth, expYear: parsed.expYear, cardholderName: parsed.cardholderName };
      }
      return { outcome: "read", number: parsed.number, expMonth: parsed.expMonth, expYear: parsed.expYear, cardholderName: parsed.cardholderName, securityCode: parsed.securityCode };
    } finally {
      for (const photo of photos) photo.image.fill(0);
    }
  }

  credentialReferenceFor(id: string): VaultCredentialReference {
    const validId = this.validId(id);
    return `vault:v1:${this.options.accountScope}:${validId}` as VaultCredentialReference;
  }

  async readTrustedCredential(reference: VaultCredentialReference): Promise<VaultTrustedCredential> {
    const prefix = "vault:v1:";
    if (typeof reference !== "string" || !reference.startsWith(prefix)) {
      throw new VaultInvalidArgumentError("Vault credential reference is invalid");
    }
    const remainder = reference.slice(prefix.length);
    const separator = remainder.indexOf(":");
    if (separator !== 64) throw new VaultInvalidArgumentError("Vault credential reference is invalid");
    const accountScope = remainder.slice(0, separator);
    if (accountScope !== this.options.accountScope) throw new VaultNotFoundError("Vault credential belongs to another account");
    const id = remainder.slice(separator + 1);
    const record = (await this.loadAccount()).get(id);
    if (record === undefined) throw new VaultNotFoundError();
    if (record.kind === "contact") throw new VaultInvalidArgumentError("Vault contacts have no clear secret");
    const secret = decryptedSecret(this.options.codec, record.secretCiphertextBase64);
    if (record.kind === "login") {
      const password = secret.password;
      if (password === undefined) throw new VaultStorageCorruptedError("Vault login secret is malformed");
      return { kind: "login", username: record.username, password, sites: [...record.sites] };
    }
    const number = secret.number;
    if (number === undefined) throw new VaultStorageCorruptedError("Vault card secret is malformed");
    return secret.securityCode === undefined ? { kind: "card", number } : { kind: "card", number, securityCode: secret.securityCode };
  }

  private assertEncryptedStorage(): void {
    if (!this.options.codec.isEncryptionAvailable()) throw new VaultEncryptionUnavailableError();
  }

  private nowMs(): number {
    return this.options.now?.() ?? Date.now();
  }

  private cardsEnabled(): boolean {
    return this.options.cardsEnabled ?? true;
  }

  private validId(id: string): string {
    if (typeof id !== "string" || id.length === 0 || id.length > 256) {
      throw new VaultInvalidArgumentError("Vault id must be a non-empty string");
    }
    return id;
  }

  private upsertId(id: string): string {
    return typeof id === "string" && id.length === 0 ? randomUUID() : this.validId(id);
  }

  private validText(value: string, maxLength: number): string {
    if (typeof value !== "string" || value.length > maxLength) {
      throw new VaultInvalidArgumentError(`Vault value must be a string of at most ${maxLength} characters`);
    }
    return value;
  }

  private validAddress(address: VaultAddress): VaultAddress {
    return {
      line1: this.validText(address.line1, 256),
      line2: this.validText(address.line2, 256),
      city: this.validText(address.city, 256),
      region: this.validText(address.region, 256),
      postalCode: this.validText(address.postalCode, 256),
      country: this.validText(address.country, 256),
    };
  }

  private validateHolderName(value: string): void {
    this.validText(value, 200);
  }

  private assertNotExpired(expiry: { readonly month: number; readonly year: number }, nowMs: number): void {
    const now = new Date(nowMs);
    if (expiry.year * 12 + expiry.month - 1 < now.getFullYear() * 12 + now.getMonth()) {
      throw new VaultInvalidArgumentError("Vault card is expired");
    }
  }

  private planVaultLogin(input: VaultLoginInput, existing: readonly StoredVaultRecord[], nowMs: number):
  { readonly kind: "ready"; readonly login: VaultLoginValues } | { readonly kind: "duplicate" | "invalid"; readonly message: string } {
    const keys = duplicateKeys(existing.map(credentialOf));
    const context = { cardsEnabled: this.cardsEnabled(), now: new Date(nowMs), ...keys };
    return this.planPrevalidatedLogin(input, context);
  }

  private planPrevalidatedLogin(input: VaultLoginValues, context: {
    readonly cardsEnabled: boolean;
    readonly now: Date;
    readonly loginKeys: Set<string>;
    readonly cardKeys: Set<string>;
  }): { readonly kind: "ready"; readonly login: VaultLoginValues } | { readonly kind: "duplicate" | "invalid"; readonly message: string } {
    this.validText(input.title, 200);
    this.validText(input.username, 512);
    this.validText(input.notes, 2048);
    const sites = input.sites;
    if (!Array.isArray(sites) || sites.length > 10 || sites.some((site) => typeof site !== "string" || site.length > 2048)) {
      throw new VaultInvalidArgumentError("Vault sites must contain at most 10 strings");
    }
    if (typeof input.password !== "string" || new TextEncoder().encode(input.password).length > 4096) {
      throw new VaultInvalidArgumentError("Vault password must be a bounded string");
    }
    return plannedResult(planLogin(0, { id: "", title: input.title, username: input.username, notes: input.notes,
      sites: [...sites], password: input.password }, context));
  }

  private cardValues(input: Readonly<Record<string, string>>): Record<string, string> {
    if (!isRecord(input)) throw new VaultInvalidArgumentError("Vault card values must be an object");
    const allowed = new Set(["cc_number", "cc_exp", "cc_csc", "cc_name", "billingAddressId", ...BILLING_FIELDS.map(([key]) => key)]);
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!allowed.has(key) || typeof value !== "string") throw new VaultInvalidArgumentError(`Vault card field ${key} is invalid`);
      result[key] = value;
    }
    if (result.cc_number === undefined || result.cc_exp === undefined) {
      throw new VaultInvalidArgumentError("Vault card number and expiry are required");
    }
    return result;
  }

  private validPhotos(request: VaultCardPhotoRequest): readonly VaultCardPhoto[] {
    if (!isRecord(request) || !Array.isArray(request.photos) || request.photos.length === 0 || request.photos.length > MAX_PHOTOS) {
      throw new VaultInvalidArgumentError("Vault photo request must contain one to four photos");
    }
    let total = 0;
    for (const photo of request.photos) {
      if (!isRecord(photo) || !(photo.image instanceof Uint8Array) || typeof photo.mimeType !== "string" ||
          !PHOTO_MIME_TYPES.has(photo.mimeType) || photo.image.byteLength === 0) {
        throw new VaultInvalidArgumentError("Vault photo is invalid");
      }
      total += photo.image.byteLength;
    }
    if (total > MAX_PHOTO_BYTES) throw new VaultInvalidArgumentError("Vault photos exceed the size limit");
    return request.photos;
  }

  private async loadStore(): Promise<VaultStore> {
    let raw: string;
    try {
      raw = await readFile(this.options.storePath, "utf8");
    } catch (error) {
      if (isNodeErrnoException(error, "ENOENT")) return new Map();
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    assertNoPlaintextSecretFields(parsed);
    if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.accounts)) {
      throw new VaultStorageCorruptedError();
    }
    const result: VaultStore = new Map();
    for (const [accountScope, accountValue] of Object.entries(parsed.accounts)) {
      if (!ACCOUNT_SCOPE_PATTERN.test(accountScope) || !Array.isArray(accountValue)) throw new VaultStorageCorruptedError();
      const account: AccountStore = new Map();
      for (const recordValue of accountValue) {
        const record = parseStoredRecord(recordValue);
        if (account.has(record.id)) throw new VaultStorageCorruptedError("Vault store has duplicate ids");
        account.set(record.id, record);
      }
      result.set(accountScope, account);
    }
    await chmod(this.options.storePath, 0o600);
    return result;
  }

  private async writeStore(store: VaultStore): Promise<void> {
    const serialized = {
      version: STORE_VERSION,
      accounts: Object.fromEntries([...store].map(([accountScope, account]) => [accountScope,
        [...account.values()].map(serializeRecord)])),
    };
    const storePath = this.options.storePath;
    await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(serialized, null, 2), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, storePath);
      await chmod(storePath, 0o600);
    } finally {
      if (handle !== undefined) await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch((error: unknown) => {
        if (!isNodeErrnoException(error, "ENOENT")) throw error;
      });
    }
  }

  private async loadAccount(): Promise<AccountStore> {
    this.assertEncryptedStorage();
    const store = await this.loadStore();
    let account = store.get(this.options.accountScope);
    if (account === undefined) {
      account = new Map();
      store.set(this.options.accountScope, account);
    }
    return account;
  }

  private async withAccount<T>(update: (account: AccountStore, nowMs: number) => Promise<T> | T): Promise<T> {
    this.assertEncryptedStorage();
    const previousOperation = mutationTails.get(this.mutationTailKey) ?? Promise.resolve();
    const operation = previousOperation.then(async (): Promise<T> => {
      const nowMs = this.nowMs();
      const store = await this.loadStore();
      let account = store.get(this.options.accountScope);
      if (account === undefined) {
        account = new Map();
        store.set(this.options.accountScope, account);
      }
      const result = await update(account, nowMs);
      await this.writeStore(store);
      return result;
    });
    mutationTails.set(this.mutationTailKey, operation.then(() => undefined, () => undefined));
    return operation;
  }
}

export function createLocalVaultBackend(options: LocalVaultBackendOptions): {
  readonly listGrokBotVaultCredentials: () => Promise<VaultCredential[]>;
  readonly putGrokBotVaultCredential: (input: VaultLoginInput) => Promise<VaultCredential>;
  readonly createGrokBotVaultLogins: (input: { readonly logins: readonly VaultLoginValues[] }) => Promise<VaultBatchCreateResult[]>;
  readonly updateGrokBotVaultCard: (input: VaultCardUpdateInput) => Promise<VaultCredential>;
  readonly putGrokBotVaultContact: (input: VaultContactInput) => Promise<VaultCredential>;
  readonly createGrokBotVaultCard: (input: VaultCardCreateInput) => Promise<VaultCredential>;
  readonly deleteGrokBotVaultCredential: (id: string) => Promise<void>;
  readonly readCardPhoto: (request: VaultCardPhotoRequest, signal?: AbortSignal) => Promise<VaultCardPhotoResult>;
  readonly readGrokBotCardPhoto: (request: VaultCardPhotoRequest, signal?: AbortSignal) => Promise<VaultCardPhotoResult>;
  readonly credentialReferenceFor: (id: string) => VaultCredentialReference;
  readonly readTrustedCredential: (reference: VaultCredentialReference) => Promise<VaultTrustedCredential>;
  readonly sessionSnapshot: () => Promise<VaultSessionSnapshot>;
} {
  const backend = new LocalVaultBackend(options);
  const changed = async <T>(operation: Promise<T>): Promise<T> => {
    const result = await operation;
    try { void Promise.resolve(options.onChange?.()).catch(() => undefined); } catch {}
    return result;
  };
  return {
    listGrokBotVaultCredentials: () => backend.list(),
    putGrokBotVaultCredential: (input) => changed(backend.put(input)),
    createGrokBotVaultLogins: (input) => changed(backend.createLogins(input)),
    updateGrokBotVaultCard: (input) => changed(backend.updateCard(input)),
    putGrokBotVaultContact: (input) => changed(backend.putContact(input)),
    createGrokBotVaultCard: (input) => changed(backend.createCard(input)),
    deleteGrokBotVaultCredential: (id) => changed(backend.remove(id)),
    readCardPhoto: (request, signal) => backend.readCardPhoto(request, signal),
    readGrokBotCardPhoto: (request, signal) => backend.readCardPhoto(request, signal),
    credentialReferenceFor: (id) => backend.credentialReferenceFor(id),
    readTrustedCredential: (reference) => backend.readTrustedCredential(reference),
    sessionSnapshot: () => backend.sessionSnapshot(),
  };
}
