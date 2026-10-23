import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { VisualizationFragment, VisualizationReadArgs } from "../../../shared/visualization.js";
import { findSystemErrno } from "../../../shared/system-errno.js";
import { VISUALIZATION_FRAGMENT_MAX_BYTES } from "../../runner/tools/visualize-tool.js";

export interface VisualizationPagesLocation {
  readonly agentId: string;
  readonly agentDir: string;
}

export function createVisualizationPages({ agentId, agentDir }: VisualizationPagesLocation) {
  if (agentId.trim().length === 0 || !isAbsolute(agentDir)) {
    throw new TypeError("Visualization storage requires an agent identity and absolute agent directory.");
  }
  async function directory(create: boolean): Promise<string> {
    if ((await lstat(agentDir)).isSymbolicLink()) throw new Error("Visualization agent directory is a symbolic link.");
    const root = await realpath(agentDir);
    const dir = join(root, "visualizations");
    if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(dir) !== dir) {
      throw new Error("Visualization storage directory is not a real directory.");
    }
    return dir;
  }
  async function readHash(dir: string, sha256: string): Promise<string> {
    const handle = await open(join(dir, `${sha256}.html`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > VISUALIZATION_FRAGMENT_MAX_BYTES) throw new Error("Invalid visualization fragment file.");
      const bytes = Buffer.alloc(VISUALIZATION_FRAGMENT_MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const content = bytes.subarray(0, length);
      if (length > VISUALIZATION_FRAGMENT_MAX_BYTES || createHash("sha256").update(content).digest("hex") !== sha256) {
        throw new Error("Visualization fragment hash mismatch.");
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } finally {
      await handle.close();
    }
  }
  return {
    async save(html: string): Promise<{ sha256: string }> {
      const bytes = Buffer.from(html, "utf8");
      if (html.trim().length === 0 || bytes.length > VISUALIZATION_FRAGMENT_MAX_BYTES) throw new TypeError("Invalid visualization fragment size.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const dir = await directory(true);
      const temporary = join(dir, `.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        try {
          await link(temporary, join(dir, `${sha256}.html`));
        } catch (error) {
          if (findSystemErrno(error) !== "EEXIST") throw error;
        }
        await readHash(dir, sha256);
      } finally {
        await unlink(temporary);
      }
      return { sha256 };
    },
    async read(args: VisualizationReadArgs): Promise<VisualizationFragment | null> {
      if (args.agentId !== agentId || typeof args.entryId !== "string" || args.entryId.trim().length === 0
        || typeof args.documentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(args.documentSha256)) {
        throw new TypeError("Invalid visualization read identity or hash.");
      }
      try {
        return { html: await readHash(await directory(false), args.documentSha256) };
      } catch (error) {
        if (findSystemErrno(error) === "ENOENT") return null;
        throw error;
      }
    },
  };
}

