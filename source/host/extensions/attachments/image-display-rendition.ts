import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { HeicDimensions, type ImageTransform } from "../../../shared/media/image-dimensions.js";
import { runVideoTool, withTranscodeSlot, FAILED_RESOLUTION_RETRY_MS } from "./video-playback-rendition.js";

export const DISPLAY_RENDITION_MAX_EDGE = 4096;
export const IMAGE_RENDITION_CACHE_LIMIT = 32;
const count = z.number().int().nonnegative();
const extent = z.number().int().positive();
const disposition = z.object({ default: z.number().optional() }).optional();
const probeSchema = z.object({
  streams: z.array(z.object({ index: count, codec_type: z.string().optional(), width: extent.optional(), height: extent.optional(), disposition })).default([]),
  stream_groups: z.array(z.object({ type: z.string().optional(), disposition,
    components: z.array(z.object({ coded_width: extent, coded_height: extent, width: extent, height: extent,
      horizontal_offset: count, vertical_offset: count,
      subcomponents: z.array(z.object({ stream_index: count, tile_horizontal_offset: count, tile_vertical_offset: count })).default([]),
    })).default([]),
  })).default([]),
});
export class ImageProbeUnrecognizedError extends Error { override name = "ImageProbeUnrecognizedError"; }
type Stream = { readonly streamIndex: number; readonly width: number; readonly height: number };
type Layout = { readonly kind: "stream"; readonly stream: Stream } | { readonly kind: "grid";
  readonly grid: { readonly width: number; readonly height: number; readonly x: number; readonly y: number;
    readonly tiles: readonly { readonly streamIndex: number; readonly x: number; readonly y: number }[] } };

export function parseImageProbe(json: string): Layout {
  const probe = probeSchema.parse(JSON.parse(json));
  const streams = probe.streams.flatMap(stream => stream.codec_type === "video" && stream.width !== undefined && stream.height !== undefined
    ? [{ streamIndex: stream.index, width: stream.width, height: stream.height, isDefault: stream.disposition?.default === 1 }] : []);
  const groups = probe.stream_groups.filter(group => group.type === "Tile Grid");
  const group = groups.find(candidate => candidate.disposition?.default === 1) ?? groups[0];
  if (group !== undefined) {
    const component = group.components[0];
    if (component === undefined || component.horizontal_offset + component.width > component.coded_width || component.vertical_offset + component.height > component.coded_height)
      throw new ImageProbeUnrecognizedError("Invalid HEIC tile grid bounds");
    const known = new Set(streams.map(stream => stream.streamIndex));
    if (component.subcomponents.length === 0 || component.subcomponents.some(tile => !known.has(tile.stream_index)))
      throw new ImageProbeUnrecognizedError("HEIC tile grid references missing streams");
    return { kind: "grid", grid: { width: component.width, height: component.height, x: component.horizontal_offset, y: component.vertical_offset,
      tiles: component.subcomponents.map(tile => ({ streamIndex: tile.stream_index, x: tile.tile_horizontal_offset, y: tile.tile_vertical_offset })) } };
  }
  const stream = streams.find(candidate => candidate.isDefault) ?? streams.reduce<(typeof streams)[number] | undefined>((largest, candidate) =>
    largest === undefined || candidate.width * candidate.height > largest.width * largest.height ? candidate : largest, undefined);
  if (stream === undefined) throw new ImageProbeUnrecognizedError("Image probe contains no video stream");
  return { kind: "stream", stream };
}

export function displayFilterGraph(layout: Layout, transform: ImageTransform | null): string {
  const filters: string[] = [];
  let input: string;
  let width: number;
  let height: number;
  switch (layout.kind) {
    case "grid": {
      const grid = layout.grid;
      input = grid.tiles.map(tile => `[0:${tile.streamIndex}]`).join("");
      if (grid.tiles.length > 1) filters.push(`xstack=inputs=${grid.tiles.length}:layout=${grid.tiles.map(tile => `${tile.x}_${tile.y}`).join("|")}:fill=black`);
      filters.push(`crop=${grid.width}:${grid.height}:${grid.x}:${grid.y}`);
      width = grid.width; height = grid.height;
      break;
    }
    case "stream": input = `[0:${layout.stream.streamIndex}]`; width = layout.stream.width; height = layout.stream.height; break;
    default: { const unreachable: never = layout; return unreachable; }
  }
  const scale = Math.min(1, DISPLAY_RENDITION_MAX_EDGE / Math.max(width, height));
  if (scale < 1) filters.push(`scale=${Math.max(1, Math.round(width * scale))}:${Math.max(1, Math.round(height * scale))}`);
  switch (transform?.quarterTurns) {
    case 1: filters.push("transpose=cclock"); break;
    case 2: filters.push("hflip", "vflip"); break;
    case 3: filters.push("transpose=clock"); break;
  }
  if (transform?.mirrorAxis === "vertical") filters.push("hflip");
  if (transform?.mirrorAxis === "horizontal") filters.push("vflip");
  return `${input}${filters.length === 0 ? "null" : filters.join(",")}[out]`;
}

interface CacheEntry {
  readonly path: string;
  readonly ready: Promise<string | null>;
  readers: number;
  evicted: boolean;
  retryAfter?: number;
}
export function createImageDisplayCache(options: {
  readonly directory?: string;
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly run?: (command: string, args: readonly string[]) => Promise<string>;
} = {}) {
  const directory = options.directory ?? join(tmpdir(), `sand-image-display-${process.pid}`);
  const run = options.run ?? runVideoTool;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  const cleanup = async (entry: CacheEntry) => {
    if (!entry.evicted || entry.readers > 0) return;
    await entry.ready.then(() => undefined, () => undefined);
    if (entry.readers === 0) await fs.rm(entry.path, { force: true });
  };
  async function convert(bytes: Uint8Array, input: string, output: string): Promise<string | null> {
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(input, bytes, { flag: "wx", mode: 0o600 });
      const layout = parseImageProbe(await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_stream_groups", "-of", "json", input]));
      const graph = displayFilterGraph(layout, HeicDimensions.readTransform(bytes.subarray(0, 1024 * 1024)));
      await withTranscodeSlot(() => run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file", "-noautorotate", "-i", input,
        "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "2", output]));
      const info = await fs.stat(output);
      return info.isFile() && info.size > 0 ? output : null;
    } catch (error) {
      if (error instanceof ImageProbeUnrecognizedError || error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && "code" in error) return null;
      throw error;
    } finally {
      await fs.rm(input, { force: true });
    }
  }
  return {
    async read(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
      if (mime !== "image/heic" && mime !== "image/heif") return null;
      const key = createHash("sha256").update(bytes).update(mime).digest("hex");
      let entry = entries.get(key);
      if (entry !== undefined && entry.retryAfter !== undefined && now() >= entry.retryAfter) {
        entries.delete(key); entry.evicted = true; await cleanup(entry); entry = undefined;
      }
      if (entry === undefined) {
        const output = join(directory, `${key}.${randomUUID()}.jpg`);
        const created: CacheEntry = { path: output, ready: convert(bytes, `${output}.heic`, output), readers: 0, evicted: false };
        entry = created; entries.set(key, created);
        void created.ready.then(result => { if (result === null) created.retryAfter = now() + FAILED_RESOLUTION_RETRY_MS; }, () => { entries.delete(key); created.evicted = true; });
      } else { entries.delete(key); entries.set(key, entry); }
      entry.readers += 1;
      const limit = Math.max(1, options.maxEntries ?? IMAGE_RENDITION_CACHE_LIMIT);
      while (entries.size > limit) {
        const first = entries.entries().next().value;
        if (first === undefined) break;
        entries.delete(first[0]); first[1].evicted = true;
        void cleanup(first[1]).catch(error => console.warn("[sand:image-display] eviction failed", error instanceof Error ? error.name : "UnknownError"));
      }
      try { const resolved = await entry.ready; return resolved === null ? null : await fs.readFile(resolved); }
      finally { entry.readers -= 1; await cleanup(entry); }
    },
    async dispose() {
      const pending = [...entries.values()]; entries.clear();
      for (const entry of pending) entry.evicted = true;
      await Promise.all(pending.map(cleanup));
    },
  };
}
export const imageDisplayCache = createImageDisplayCache();
