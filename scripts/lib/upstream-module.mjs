import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { parse } from "acorn";
import { build } from "esbuild";
import { extractUpstreamDeclarations } from "./upstream-declarations.mjs";

export async function bundleUpstreamModule({ archive, entry, exports: requested, platform = "browser" }) {
  const sources = new Map();
  const demands = new Map([[entry, new Set(requested)]]);
  const output = new Map();
  const pending = [entry];
  while (pending.length > 0) {
    const relative = pending.shift();
    const source = sources.get(relative) ?? archive.read(relative).toString("utf8");
    sources.set(relative, source);
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const names = new Map();
    for (const node of ast.body) {
      if (node.type !== "ExportNamedDeclaration") continue;
      if (node.source) throw new Error(`Upstream re-export requires an explicit binding: ${relative}`);
      for (const specifier of node.specifiers) names.set(specifier.exported.name ?? specifier.exported.value, specifier.local.name);
    }
    const exports = {};
    for (const name of demands.get(relative)) {
      const local = names.get(name);
      if (!local) throw new Error(`Missing upstream export ${name} in ${relative}`);
      exports[name] = local;
    }
    const extracted = extractUpstreamDeclarations({ code: source, exports, strict: true });
    output.set(relative, extracted);
    const selected = parse(extracted.code, { ecmaVersion: "latest", sourceType: "module" });
    for (const node of selected.body) {
      if (node.type !== "ImportDeclaration") continue;
      if (!node.source.value.startsWith(".")) throw new Error(`Unexpected upstream module import: ${node.source.value}`);
      const dependency = path.posix.join(path.posix.dirname(relative), node.source.value);
      const demanded = demands.get(dependency) ?? new Set();
      let changed = false;
      for (const specifier of node.specifiers) {
        if (specifier.type !== "ImportSpecifier") throw new Error(`Unsupported upstream import shape in ${relative}`);
        const imported = specifier.imported.name ?? specifier.imported.value;
        if (!demanded.has(imported)) { demanded.add(imported); changed = true; }
      }
      demands.set(dependency, demanded);
      if (changed && !pending.includes(dependency)) pending.push(dependency);
    }
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-upstream-module-"));
  try {
    for (const [relative, extracted] of output) {
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, extracted.code);
    }
    const result = await build({ entryPoints: [path.join(root, entry)], bundle: true,
      write: false, format: "esm", platform, target: "es2022", legalComments: "none", logLevel: "silent" });
    return { code: result.outputFiles[0].text, modules: [...output].map(([relative, extracted]) => ({
      path: relative, inputSha256: extracted.inputSha256, ranges: extracted.provenance,
      exports: [...demands.get(relative)],
    })) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
