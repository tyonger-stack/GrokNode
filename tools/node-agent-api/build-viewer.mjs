import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function buildViewer({ novncRoot, outputDirectory = path.resolve(import.meta.dirname, '../../.lab/node-agent-viewer') }) {
  const root = await realpath(novncRoot);
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof metadata.version !== 'string') throw new Error('Missing noVNC package version');
  const source = await readFile(path.join(root, 'core/rfb.js'), 'utf8');
  if (!source.includes('_framebufferUpdate()') || !source.includes('_handleRect()')) throw new Error('Unsupported noVNC first-frame observer seam');
  const result = await build({ entryPoints: [path.join(import.meta.dirname, 'web/viewer.js')], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true, legalComments: 'inline',
    plugins: [{ name: 'local-novnc', setup(builder) { builder.onResolve({ filter: /^@novnc\/core\/rfb\.js$/ }, () => ({ path: path.join(root, 'core/rfb.js') })); } }],
  });
  const body = result.outputFiles[0].contents;
  const manifest = { schema: 1, file: 'viewer-' + createHash('sha256').update(body).digest('hex') + '.js', novncVersion: metadata.version, bytes: body.length, inputFiles: Object.keys(result.metafile.inputs).length };
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(outputDirectory, manifest.file), body, { mode: 0o600 });
  const pending = path.join(outputDirectory, 'manifest-' + process.pid + '.json');
  await writeFile(pending, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await rename(pending, path.join(outputDirectory, 'manifest.json'));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'novnc-root': { type: 'string' }, output: { type: 'string' } } });
  if (!values['novnc-root']) throw new Error('Usage: build-viewer.mjs --novnc-root DIRECTORY [--output DIRECTORY]');
  console.log(JSON.stringify(await buildViewer({ novncRoot: values['novnc-root'], ...(values.output ? { outputDirectory: path.resolve(values.output) } : {}) })));
}
