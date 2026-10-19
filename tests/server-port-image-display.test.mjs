import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({ stdin: { resolveDir: new URL("..", import.meta.url).pathname,
  contents: 'export * from "./source/host/extensions/attachments/image-display-rendition.ts"; export * from "./source/shared/media/image-dimensions.ts";' },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const probe = JSON.stringify({ streams: [{ index: 0, codec_type: "video", width: 8000, height: 4000 }] });

test("HEIC layout selects the primary stream, bounds tile references and fits the display edge", () => {
  const layout = m.parseImageProbe(probe);
  assert.equal(m.displayFilterGraph(layout, { quarterTurns: 1, mirrorAxis: "vertical" }), "[0:0]scale=4096:2048,transpose=cclock,hflip[out]");
  const grid = m.parseImageProbe(JSON.stringify({ streams: [{ index: 1, codec_type: "video", width: 512, height: 512 }],
    stream_groups: [{ type: "Tile Grid", components: [{ coded_width: 512, coded_height: 512, width: 500, height: 400,
      horizontal_offset: 2, vertical_offset: 3, subcomponents: [{ stream_index: 1, tile_horizontal_offset: 0, tile_vertical_offset: 0 }] }] }] }));
  assert.equal(m.displayFilterGraph(grid, null), "[0:1]crop=500:400:2:3[out]");
  assert.throws(() => m.parseImageProbe('{"streams":[]}'), m.ImageProbeUnrecognizedError);
  assert.throws(() => m.parseImageProbe(JSON.stringify({ streams: [], stream_groups: [{ type: "Tile Grid", components: [] }] })), m.ImageProbeUnrecognizedError);
});

test("concurrent identical images share conversion and eviction waits for its reader", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "image-display-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { started = resolve; });
  let probes = 0, conversions = 0;
  const cache = m.createImageDisplayCache({ directory: dir, maxEntries: 1,
    run: async (command, args) => {
      if (command === "ffprobe") { probes++; return probe; }
      conversions++;
      if (conversions === 1) { started(); await waiting; }
      await writeFile(args.at(-1), Buffer.from("JPEG-RESULT"));
      return "";
    } });
  const first = cache.read(Buffer.from("one"), "image/heic");
  const duplicate = cache.read(Buffer.from("one"), "image/heic");
  await firstStarted;
  const second = await cache.read(Buffer.from("two"), "image/heif");
  release();
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(Buffer.from(a).toString(), "JPEG-RESULT");
  assert.deepEqual(a, b); assert.deepEqual(a, second);
  assert.equal(probes, 2); assert.equal(conversions, 2);
  await cache.dispose();
  assert.deepEqual(await readdir(dir), []);
});

test("failed conversion backs off and ordinary images never invoke external tools", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "image-failure-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0, now = 0;
  const cache = m.createImageDisplayCache({ directory: dir, now: () => now, run: async () => {
    calls++; throw Object.assign(new Error("unsupported codec"), { code: 1 });
  } });
  assert.equal(await cache.read(Buffer.from("png"), "image/png"), null);
  assert.equal(calls, 0);
  for (let index = 0; index < 2; index++) assert.equal(await cache.read(Buffer.from("bad"), "image/heic"), null);
  assert.equal(calls, 1);
  now = 30_001;
  assert.equal(await cache.read(Buffer.from("bad"), "image/heic"), null);
  assert.equal(calls, 2);
  await cache.dispose();
});

test("HEIC transforms follow primary item associations instead of a thumbnail's properties", () => {
  const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
  const box = (tag, ...parts) => { const content = Buffer.concat(parts); return Buffer.concat([u32(content.length + 8), Buffer.from(tag), content]); };
  const ispe = box("ispe", u32(0), u32(80), u32(40));
  const file = axis => Buffer.concat([box("ftyp", Buffer.from("heic"), u32(0)),
    box("meta", u32(0), box("pitm", u32(0), Buffer.from([0, 1])),
      box("iprp", box("ipco", ispe, box("irot", Buffer.from([1])), box("imir", Buffer.from([axis])), box("imir", Buffer.from([1 - axis]))),
        box("ipma", u32(0), u32(1), Buffer.from([0, 1, 3, 1, 2, 3]))))]);
  assert.deepEqual(m.HeicDimensions.readTransform(file(0)), { quarterTurns: 1, mirrorAxis: "vertical" });
  assert.deepEqual(m.HeicDimensions.readTransform(file(1)), { quarterTurns: 1, mirrorAxis: "horizontal" });
  assert.deepEqual(m.HeicDimensions.read(file(0)), { width: 40, height: 80 });
});
