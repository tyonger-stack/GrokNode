#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const libraryDir = join(repoRoot, "source", "host", "extensions", "library");

async function loadCatalogModule() {
  const bundled = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(join(libraryDir, "catalog.ts"))};`,
      resolveDir: repoRoot,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "error",
  });
  const text = bundled.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
}

async function loadServiceModule() {
  const bundled = await build({
    stdin: {
      contents: [
        `export * from ${JSON.stringify(join(libraryDir, "extension.ts"))};`,
        `export * from ${JSON.stringify(join(libraryDir, "http-server.ts"))};`,
      ].join("\n"),
      resolveDir: repoRoot,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["undici"],
    write: false,
    logLevel: "error",
  });
  mkdirSync(join(repoRoot, "node_modules", ".cache"), { recursive: true });
  const file = join(repoRoot, "node_modules", ".cache", `library-service-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, bundled.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {
      // Best-effort cache cleanup; the bundle holds source, never credentials.
    }
  }
}

function usage() {
  return [
    "Usage: cli.mjs --data-root DIR --origin https://host[:port] <command> [options]",
    "Commands:",
    "  provision [--account-id ID] [--out FILE]",
    "  member add|remove --account A --principal P --team T",
    "  agent add|remove --account A --principal P --agent G",
    "  store register --account A --principal P --store S [--team T]",
    "  store set-team --account A --principal P --store S [--team T]",
    "  status",
    "  serve --host H --port N --key-file KF --cert-file CF",
  ].join("\n");
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Flag ${token} requires a value.`);
      flags[token.slice(2)] = value;
      i += 1;
    } else positional.push(token);
  }
  return { flags, positional };
}

function required(flags, name) {
  const value = flags[name];
  if (value === undefined || value === "") throw new Error(`Missing required --${name}.`);
  return value;
}

function writeSecretFile(target, text) {
  let existing = null;
  try {
    existing = lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing !== null) {
    if (existing.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${target}`);
    if (!existing.isFile()) throw new Error(`Refusing to overwrite non-file: ${target}`);
  }
  const temporary = join(dirname(target), `.${basename(target)}.tmp-${process.pid}`);
  let descriptor = -1;
  try {
    descriptor = openSync(temporary, "w", 0o600);
    fchmodSync(descriptor, 0o600);
    const bytes = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = -1;
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } finally {
    if (descriptor !== -1) {
      try {
        closeSync(descriptor);
      } catch {
        // Descriptor close is best-effort; the temp file removal below matters.
      }
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort temp cleanup.
      }
    }
  }
}

function checkOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid --origin ${origin}; expected an https origin.`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`Invalid --origin ${origin}; expected an https origin.`);
  }
  return url.origin;
}

function contextFor(catalog, origin, accountId, principalId) {
  return {
    principal: { accountId, principalId, teamIds: [] },
    providerOrigin: origin,
    signal: AbortSignal.timeout(5000),
  };
}

async function main() {
  if (process.argv.slice(2).some((token) => token === "--help" || token === "-h")) {
    console.log(usage());
    return;
  }
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const dataRoot = required(flags, "data-root");
  const origin = checkOrigin(required(flags, "origin"));
  const command = positional[0];
  if (command === undefined) throw new Error(usage());
  if (command === "serve") {
    const host = flags.host ?? "127.0.0.1";
    const port = Number(flags.port ?? "");
    const keyFile = required(flags, "key-file");
    const certFile = required(flags, "cert-file");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port; expected 1-65535.");
    const serviceModule = await loadServiceModule();
    const service = serviceModule.createLibraryHostService({ dataRoot, providerOrigin: origin });
    const server = await serviceModule.startLibraryHttpServer({
      service,
      providerOrigin: origin,
      host,
      port,
      tls: { key: readFileSync(keyFile), cert: readFileSync(certFile) },
    });
    console.log(JSON.stringify({ origin: server.origin, host: server.host, port: server.port }));
    const stop = async () => {
      await server.close();
      service.dispose();
      process.exit(0);
    };
    process.once("SIGTERM", () => void stop());
    process.once("SIGINT", () => void stop());
    await new Promise(() => undefined);
    return;
  }
  const catalogModule = await loadCatalogModule();
  const catalog = new catalogModule.LibraryCatalog({ dataRoot, providerOrigin: origin });
  try {
    if (command === "provision") {
      const created = flags["account-id"] === undefined
        ? catalog.identity.createLocalPrincipal()
        : catalog.identity.createLocalPrincipal(flags["account-id"]);
      const record = { accountId: created.accountId, principalId: created.principalId, credential: created.credential };
      if (flags.out !== undefined) {
        writeSecretFile(flags.out, `${JSON.stringify(record, null, 2)}\n`);
        console.log(JSON.stringify({ accountId: created.accountId, principalId: created.principalId, out: flags.out }));
      } else {
        console.log(JSON.stringify(record));
      }
      return;
    }
    if (command === "member" || command === "agent") {
      const action = positional[1];
      if (action !== "add" && action !== "remove") throw new Error(`Usage: ${command} add|remove ...`);
      const accountId = required(flags, "account");
      const principalId = required(flags, "principal");
      const enabled = action === "add";
      if (command === "member") catalog.identity.assignTeam({ accountId, principalId, teamId: required(flags, "team") }, enabled);
      else catalog.identity.assignAgent({ accountId, principalId, agentId: required(flags, "agent") }, enabled);
      console.log(JSON.stringify({ ok: true, command, action, accountId, principalId }));
      return;
    }
    if (command === "store") {
      const action = positional[1];
      const accountId = required(flags, "account");
      const principalId = required(flags, "principal");
      const storeId = required(flags, "store");
      const teamId = flags.team ?? null;
      if (action === "register") {
        catalog.identity.registerStore({ accountId, principalId, storeId, teamId });
        console.log(JSON.stringify({ ok: true, store: storeId, team: teamId }));
        return;
      }
      if (action === "set-team") {
        catalog.identity.setStoreTeam(contextFor(catalog, origin, accountId, principalId), storeId, teamId);
        console.log(JSON.stringify({ ok: true, store: storeId, team: teamId }));
        return;
      }
      throw new Error("Usage: store register|set-team ...");
    }
    if (command === "status") {
      console.log(JSON.stringify({ origin, ...readStatusCounts(dataRoot) }));
      return;
    }
    throw new Error(usage());
  } finally {
    catalog.close();
  }
}

function readStatusCounts(dataRoot) {
  const file = join(dataRoot, "library", "catalog.db");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      principals: count("principals"),
      credentials: count("credentials"),
      teams: count("teams"),
      stores: count("stores"),
      agents: count("agents"),
      objects: count("objects"),
      outbox: count("outbox"),
      external_touches: count("external_touches"),
    };
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`library-service: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
