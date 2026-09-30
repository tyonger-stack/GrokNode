// Regression cover: choosing an avatar must actually take effect.
//
// Symptom this guards: picking a photo in Settings → 设置头像 / "Set avatar" wrote
// `avatar.png` into the agent directory but the UI never changed. The write path was
// fine; the summary that goes back to the renderer carried no avatar at all.
//
// Mechanism. `buildSummary` derives `avatarVersion` from an injected `readAvatar`
// callback and falls back to `null` when it is absent (session-summaries.ts:
// `avatarVersion: avatar?.version ?? null`). The renderer's lazy avatar loader keys its
// cache on exactly that field — it only re-fetches via `getAgentAvatar` when
// `avatarVersion` differs from the cached one (index-UbX-y3il.js, the `xe`/`Se` pair). So
// when `setAgentAvatarBytes` omitted `readAvatar`, the version stayed null, the renderer
// cache key never changed, and the new image was never requested.
//
// The candidate filename also matters: `readAvatarWithinDir(dir, candidate)` resolves
// nothing for an empty candidate, and the db's `avatarPath` is never set by the write
// path (only the clear branch touches it). The conventional file on disk — `avatar.png`,
// what `listConventionalAvatarFilenames` finds — is the only thing that can resolve.

import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: [
      'export { setAgentAvatarBytes } from "./source/host/extensions/session/session-mutations.ts";',
      'export { readAvatarWithinDir, listConventionalAvatarFilenames, invalidateAvatarDataUrlCache } from "./source/host/agents/agent-avatar.ts";',
      'export { readSummaryAvatar } from "./source/host/extensions/session/session-summaries.ts";',
    ].join("\n"),
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "error",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
  setAgentAvatarBytes,
  readAvatarWithinDir,
  listConventionalAvatarFilenames,
  invalidateAvatarDataUrlCache,
  readSummaryAvatar,
} = api;

/** A 1x1 transparent PNG — small, valid, and sniffs as image/png. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const withAgentDir = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "grok-node-avatar-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

/** Minimal MutationDb — this module only touches getSandProfile/setSandProfile. */
const makeDb = () => {
  const profile = { description: "", avatarPath: null };
  return {
    getSandProfile: () => ({ ...profile }),
    setSandProfile: (value) => {
      profile.description = value.description;
      profile.avatarPath = value.avatarPath;
      return true;
    },
    get: () => undefined,
    getTranscriptEntries: () => [],
    getUnreadState: () => ({
      lastActivityAt: 0,
      lastViewedAt: 0,
      isManuallyUnread: false,
      unreadCount: 0,
    }),
  };
};

const host = { memory: { agentHasContent: () => false } };

test("setting avatar bytes returns a summary carrying a data URL and a version", async (t) => {
  const agentDir = await withAgentDir(t);
  // buildSummary derives the dir from dirname(dbPath), so point dbPath inside agentDir.
  const dbPath = path.join(agentDir, "store.db");

  const summary = await setAgentAvatarBytes(
    host,
    makeDb(),
    dbPath,
    "agent-under-test",
    new Uint8Array(PNG_BYTES),
  );

  assert.ok(summary != null, "no summary was produced");
  const written = await stat(path.join(agentDir, "avatar.png"));
  assert.ok(written.size > 0, "avatar.png was not written");

  // The regression: version stayed null, so the renderer's cache key never changed.
  assert.notEqual(
    summary.avatarVersion,
    null,
    "summary.avatarVersion is null — the renderer will never re-fetch the new avatar",
  );
  assert.match(summary.avatarVersion, /^[0-9a-f]{16}$/, "version is not a content hash");
  assert.match(summary.avatarDataUrl, /^data:image\/png;base64,/, "no data URL came back");
});

test("clearing the avatar drops the version again", async (t) => {
  const agentDir = await withAgentDir(t);
  const dbPath = path.join(agentDir, "store.db");
  const db = makeDb();

  await setAgentAvatarBytes(host, db, dbPath, "agent-under-test", new Uint8Array(PNG_BYTES));
  const cleared = await setAgentAvatarBytes(host, db, dbPath, "agent-under-test", null);

  assert.equal(cleared.avatarVersion, null, "clearing left a stale avatar version");
  assert.equal(cleared.avatarDataUrl, null, "clearing left a stale data URL");
});

test("readAvatar resolves the conventional filename, not the db avatarPath", async (t) => {
  const agentDir = await withAgentDir(t);
  await writeFile(path.join(agentDir, "avatar.png"), PNG_BYTES);

  // This is exactly what the fixed readAvatar does: prefer the conventional file on disk.
  const name = listConventionalAvatarFilenames(agentDir)[0];
  assert.equal(name, "avatar.png", "conventional avatar file was not discovered");

  const avatar = await readAvatarWithinDir(agentDir, name);
  assert.ok(avatar != null, "readAvatarWithinDir could not read the avatar it just found");
  assert.match(avatar.dataUrl, /^data:image\/png;base64,/, "unexpected avatar data URL");
  assert.match(avatar.version, /^[0-9a-f]{16}$/, "avatar version is not a content hash");

  // An empty candidate resolves to nothing — the failure mode the fix routes around.
  assert.equal(
    await readAvatarWithinDir(agentDir, ""),
    null,
    "an empty candidate must not resolve, otherwise this regression is untestable",
  );
});

test("the version tracks content, so a second image is a different version", async (t) => {
  const agentDir = await withAgentDir(t);
  const file = path.join(agentDir, "avatar.png");

  await writeFile(file, PNG_BYTES);
  const first = await readAvatarWithinDir(agentDir, "avatar.png");

  // A different image: pad the PNG so the content hash must differ.
  await writeFile(file, Buffer.concat([PNG_BYTES, Buffer.from([0])]));
  invalidateAvatarDataUrlCache(agentDir);
  const second = await readAvatarWithinDir(agentDir, "avatar.png");

  assert.notEqual(first.version, second.version, "avatar version did not change with content");
});

test("mutating the fix away makes the version assertion fail", async (t) => {
  // Mutation guard: drop readAvatar from the call and the version must go null again.
  const agentDir = await withAgentDir(t);
  const dbPath = path.join(agentDir, "store.db");
  const mutated = await build({
    stdin: {
      contents: 'export { setAgentAvatarBytes } from "./source/host/extensions/session/session-mutations.ts";',
      resolveDir: root,
    },
    plugins: [
      {
        name: "strip-read-avatar",
        setup(b) {
          b.onLoad({ filter: /session-mutations\.ts$/ }, async (args) => {
            const { readFile } = await import("node:fs/promises");
            const text = await readFile(args.path, "utf8");
            return {
              // Drop the helper from the call so buildSummary gets no readAvatar, which is
              // exactly the reported defect.
              contents: text.replace(/,readAvatar: readSummaryAvatar/g, ""),
              loader: "ts",
            };
          });
        },
      },
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "error",
  });
  const broken = await import(
    `data:text/javascript;base64,${Buffer.from(mutated.outputFiles[0].text).toString("base64")}`
  );
  const summary = await broken.setAgentAvatarBytes(
    host,
    makeDb(),
    dbPath,
    "agent-under-test",
    new Uint8Array(PNG_BYTES),
  );
  assert.equal(
    summary.avatarVersion,
    null,
    "removing readAvatar should reintroduce the null version — if this fails the " +
      "mutation guard is not actually exercising the fix",
  );
});

test("every buildSummary call site injects readAvatar", async () => {
  // The original defect was one missing callback, but there were eight call sites across
  // four files and only the one behind 设置头像 had it. Any summary built without
  // readAvatar reports avatarVersion: null, and the renderer keys its avatar cache on
  // that field — so a single omission silently reintroduces "the avatar never updates".
  // This asserts the whole set, not the one that was reported broken.
  const { readFile } = await import("node:fs/promises");
  const files = [
    "source/host/extensions/session/session-roster.ts",
    "source/host/extensions/session/session-profile-files.ts",
    "source/host/extensions/session/agent-session.ts",
    "source/host/extensions/session/session-mutations.ts",
  ];
  let total = 0;
  let wired = 0;
  const missing = [];
  for (const rel of files) {
    const lines = (await readFile(path.join(root, rel), "utf8")).split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!/buildSummary\(\{/.test(lines[i])) continue;
      total += 1;
      const window = lines.slice(i, i + 14).join("\n");
      if (window.includes("readAvatar: readSummaryAvatar")) wired += 1;
      else missing.push(`${rel}:${i + 1}`);
    }
  }
  assert.ok(total >= 7, `expected at least 7 call sites, found ${total} — the test needs revisiting`);
  assert.deepEqual(missing, [], "buildSummary call sites without readAvatar");
  assert.equal(wired, total);
});

test("readSummaryAvatar prefers the file on disk over the db avatarPath", async (t) => {
  const agentDir = await withAgentDir(t);
  await writeFile(path.join(agentDir, "avatar.png"), PNG_BYTES);

  // legacyAvatarPath is null for any agent that gained a picture through the UI, because
  // the write path never sets that db field. The on-disk conventional name must win.
  const avatar = await readSummaryAvatar(agentDir, null);
  assert.ok(avatar != null, "readSummaryAvatar found nothing despite avatar.png being present");
  assert.match(avatar.version, /^[0-9a-f]{16}$/);

  const empty = await withAgentDir(t);
  assert.equal(await readSummaryAvatar(empty, null), null, "no-file case must stay null");
});
