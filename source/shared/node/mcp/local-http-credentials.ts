import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import { OAuthClientInformationSchema, OAuthClientInformationFullSchema, OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

const credentialsSchema = z.object({
  client: z.union([OAuthClientInformationFullSchema, OAuthClientInformationSchema]).optional(),
  tokens: OAuthTokensSchema.optional(),
});
export type LocalMcpCredentials = z.infer<typeof credentialsSchema>;

/** Owned by the VM host. Secrets never enter settings, tool results or the renderer. */
export class LocalHttpCredentials {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}

  private path(serverUrl: string, accountKey: string): string {
    const key = createHash("sha256").update(JSON.stringify([serverUrl, accountKey])).digest("hex");
    return join(this.directory, key + ".json");
  }

  async read(serverUrl: string, accountKey: string): Promise<LocalMcpCredentials> {
    await this.tail;
    return this.readFile(serverUrl, accountKey);
  }

  private async readFile(serverUrl: string, accountKey: string): Promise<LocalMcpCredentials> {
    try {
      return credentialsSchema.parse(JSON.parse(await readFile(this.path(serverUrl, accountKey), "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  async update(serverUrl: string, accountKey: string, change: (value: LocalMcpCredentials) => LocalMcpCredentials): Promise<void> {
    const operation = this.tail.then(async () => {
      const value = credentialsSchema.parse(change(await this.readFile(serverUrl, accountKey)));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const file = this.path(serverUrl, accountKey), temporary = file + "." + randomUUID() + ".tmp";
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    });
    this.tail = operation.then(() => undefined, () => undefined);
    await operation;
  }
}
