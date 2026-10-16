import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PAIR_OWNED_STRINGS,
  SECTION_STRINGS,
  applyOriginalRendererComputerUpdate,
  assertComputerUpdateSectionShape,
  patchOriginalComputerUpdateSection,
} from "../scripts/lib/computer-update-renderer-patch.mjs";
import { applyOriginalRendererSelectionAddToPrompt } from "../scripts/lib/selection-add-to-prompt-renderer-patch.mjs";
import { applyOriginalRendererTeachSuccessPath } from "../scripts/lib/teach-success-path-renderer-patch.mjs";
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";
import {
  MAIN_I18N_061_PAIRS,
  MAIN_I18N_LOCAL_PAIRS,
  MAIN_I18N_PAIRS,
} from "../scripts/lib/main-i18n-patch.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The pinned 0.18 main chunk. gitignored, so it only exists after `npm run bootstrap`.
const ASSETS = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const BUNDLE = await readFile(path.join(ASSETS, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip =
  BUNDLE == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

const COMPONENT_ANCHOR = "function vKn(n){const e=he.c(53),";
const SECTION_ANCHOR = 'const cDn="Your computer is on the latest version"';
/** The pair table rewrites the span's first literal, so match on its head either way. */
const SECTION_HEAD = "const cDn=";

/**
 * The span the patch owns: the section's string constants through the end of its component.
 * The span's start literal belongs to a pair the i18n pass owns, so the patch never rewrites
 * it; the i18n pass does, which is why the head is matched by prefix.
 */
function sectionOf(source) {
  const from = source.indexOf(SECTION_HEAD);
  assert.ok(from > 0, "the section string constants are not in this chunk");
  const start = source.indexOf(COMPONENT_ANCHOR);
  assert.ok(start > from, "the section component is missing or moved before its constants");
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > 0, "the section component did not brace-balance");
  return source.slice(from, end);
}

async function stageAssetsRoot() {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "computer-update-section-"));
  const assets = path.join(stageRoot, "dist/renderer/assets");
  await mkdir(assets, { recursive: true });
  // The pass targets the main chunk by discovery anchor and its prerequisites validate
  // against the pinned stylesheet, so the stage needs this chunk and the CSS — not the
  // ~46 MB of the other chunks and images.
  await cp(path.join(ASSETS, "index-UbX-y3il.js"), path.join(assets, "index-UbX-y3il.js"));
  for (const name of await readdir(ASSETS)) {
    if (name.endsWith(".css")) await cp(path.join(ASSETS, name), path.join(assets, name));
  }
  return stageRoot;
}

test("the pinned chunk still carries every anchor the patch rewrites", { skip: bundleSkip }, () => {
  // Guards the fail-closed direction: if upstream ever moves one of these, the patch must
  // refuse to build rather than ship a half-translated section.
  for (const row of [...SECTION_STRINGS, ...PAIR_OWNED_STRINGS]) {
    assert.ok(
      sectionOf(BUNDLE).includes(row.before ?? row.literal),
      `anchor for ${row.id} (${row.what}) is no longer in the pinned chunk`,
    );
  }
  assert.ok(BUNDLE.includes("Restart Grok Bot after the computer is available again"));
});

test("the section renders official's up-to-date card, in Chinese, as Grok Node", { skip: bundleSkip }, () => {
  const patched = patchOriginalComputerUpdateSection(BUNDLE);
  assertComputerUpdateSectionShape(patched);
  const section = sectionOf(patched);

  // The layout decision: official's up-to-date branch, and the session-rebuild-block input
  // that would otherwise veto it.
  assert.ok(section.includes('let v="up-to-date";'), "the section must take the up-to-date branch");
  assert.ok(!section.includes("RAe({canUpdateBaseline:r"), "the upstream phase derivation must be gone");
  assert.ok(section.includes("l=!1,{isUpdateBoxPending:t,"), "isRebuildBlocked must be neutralised at its binding");
  assert.ok(
    !section.includes("isRebuildBlocked:l,"),
    "the runtime rebuild-block prop must not reach the layout decision any more",
  );
  // Upstream's own banner and row markup is what makes this pixel-level, not a redraw.
  assert.ok(section.includes('re("sand-settings-uptodate-banner"'), "the banner class set must survive");
  assert.ok(section.includes('name:"check-circle",size:14'), "the check-circle glyph must survive");
  assert.ok(section.includes('role:"status"'), "the banner must keep its role");
  assert.ok(section.includes('D=b==="up-to-date"&&!l?'), "the branch test must survive");

  // The strings the section renders itself, at official's zh-CN value.
  for (const [needle, what] of [
    ["更新你的 Bot 共用的电脑。你的文件和登录信息会保留，但已安装的应用和软件包会被移除。所有 Bot 会一起更新。", "shared-computer description"],
    ['"更新 Grok Node 的电脑"', "update title"],
    ['"重置 Grok Node 的电脑"', "reset title"],
    ['"Grok Node 的电脑"', "group title"],
    ['"正在重置…"', "in-flight reset label"],
    ['"重置"', "idle reset label"],
    ['"打开一个 Bot 以重置共享电脑"', "group-session reset notice"],
  ]) {
    assert.ok(section.includes(needle), `${what} is missing from the section`);
  }

  // The rename is total: this is a Grok Node section, so no Grok Bot string may survive —
  // including the two blocked notices the pinned inputs made unreachable.
  assert.ok(!/Grok Bot/.test(section), "a Grok Bot string survives in the section");
  assert.equal(
    (section.match(/Restart Grok Node after the computer is available again/g) ?? []).length,
    2,
    "both blocked-notice copies must be renamed",
  );
});

test("the three pair-owned strings stay upstream literals", { skip: bundleSkip }, () => {
  // The main-i18n pair table anchors its last hit for each of these inside this section, and
  // applyPair throws when a pair is left without an anchor. Wrapping them here would break
  // the build, so they are asserted instead of edited — each already resolves to official's
  // own value, which the composition test below proves end to end.
  const section = sectionOf(patchOriginalComputerUpdateSection(BUNDLE));
  for (const row of PAIR_OWNED_STRINGS) {
    assert.ok(section.includes(row.literal), `${row.id} (${row.what}) must stay the literal the pair anchors on`);
    assert.ok(!section.includes(row.resolvesTo), `${row.id} must not be hardcoded in the patch`);
  }
});

test("the reset action keeps its real handler and its real pending gate", { skip: bundleSkip }, () => {
  const section = sectionOf(patchOriginalComputerUpdateSection(BUNDLE));
  // The banner is what official shows when the computer is current; the reset row stays a
  // live control, disabled only by the runtime's own pending/can-reset state.
  assert.ok(section.includes("const F=!o||l||t||s"), "the reset disabled rule must survive");
  assert.ok(section.includes('sentiment:"danger"'), "the reset button must stay the danger variant");
  assert.ok(section.includes("z=()=>{O()}"), "the reset handler must stay wired");
  assert.ok(section.includes('const W=s?RLocT("Resetting…"'), "an in-flight reset must still read as in flight");
});

test("the patched chunk still parses as a module", { skip: bundleSkip }, async () => {
  // A JSX edit in a lazily imported settings view is invisible to every other gate: the
  // bracket-balance of a wrongly closed stub only surfaces when the view is imported, long
  // after a green build. Parse the real bytes instead of asserting on them as text.
  const dir = await mkdtemp(path.join(tmpdir(), "computer-update-syntax-"));
  const file = path.join(dir, "patched-chunk.mjs");
  await writeFile(file, patchOriginalComputerUpdateSection(BUNDLE));
  const { stdout } = await execFileAsync(process.execPath, ["--check", file]);
  assert.equal(stdout.trim(), "");
  await rm(dir, { recursive: true, force: true });
});

test("it strips no pair's last anchor, and edits nothing outside the section", { skip: bundleSkip }, () => {
  // The invariant the i18n pass depends on, checked directly instead of by running all ~400
  // pairs over 5.8 MB (which costs a minute and would be re-proved by every package run).
  // applyPair throws on zero hits, so a pair that lost its last anchor here would break the
  // build; and because the patch only rewrites the section span, no other pair can be
  // affected at all.
  const patched = patchOriginalComputerUpdateSection(BUNDLE);
  const { from, to } = (() => {
    const head = BUNDLE.indexOf(SECTION_HEAD);
    const component = BUNDLE.indexOf(COMPONENT_ANCHOR);
    let depth = 0;
    let end = -1;
    for (let i = BUNDLE.indexOf("{", component); i < BUNDLE.length; i += 1) {
      if (BUNDLE[i] === "{") depth += 1;
      else if (BUNDLE[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    return { from: head, to: end };
  })();
  // The patch rewrites bytes, so offsets shift: compare the untouched prefix and suffix
  // instead. If either moved, the patch edited outside the span it declares it owns, and a
  // pair anchored out there could have lost its anchor without this test noticing.
  const head = BUNDLE.slice(0, from);
  const tail = BUNDLE.slice(to);
  assert.ok(patched.startsWith(head), "the patch rewrote bytes before the section span");
  assert.ok(patched.endsWith(tail), "the patch rewrote bytes after the section span");
  const rewritten = patched.slice(head.length, patched.length - tail.length);
  assert.ok(rewritten.startsWith(SECTION_HEAD), "the rewritten span is not the section");
  assert.ok(
    rewritten.includes('title:RLocT("Grok Node\'s Computer","Grok Node 的电脑")'),
    "the rewritten span is not the section this patch knows",
  );

  // Every literal the section shares with a pair: the ones this patch wraps, and the three
  // it deliberately leaves as the pair's last anchor.
  const table = new Map();
  for (const [en, zh, id, mode] of MAIN_I18N_PAIRS) table.set(en, { zh, id, mode });
  for (const [en, zh, id, mode] of MAIN_I18N_061_PAIRS) table.set(en, { zh, id, mode });
  for (const [en, zh, mode] of MAIN_I18N_LOCAL_PAIRS) table.set(en, { zh, id: "local", mode });
  const shared = new Set([
    ...SECTION_STRINGS.map((row) => row.before.match(/[:=]"((?:[^"\\]|\\.)*)"/)?.[1]).filter(Boolean),
    ...PAIR_OWNED_STRINGS.map((row) => row.literal.match(/="((?:[^"\\]|\\.)*)"/)?.[1]).filter(Boolean),
    'Further computer updates and resets are disabled for this session. Restart Grok Bot after the computer is available again.',
  ]);
  assert.ok(shared.size >= 8, `expected the section to share literals with pairs, found ${shared.size}`);

  for (const en of shared) {
    const row = table.get(en);
    if (row == null) continue;
    // The wrapped copies are already localized by this patch, so the pair has to find its
    // remaining anchors among the bytes the patch did not touch.
    const result = applyPair(patched, en, row.zh, row.mode);
    assert.ok(result.hits > 0, `the patch left the ${row.id} pair with no anchor — the i18n pass would fail`);
  }

  // The three pair-owned strings must keep resolving to official's own value, and this
  // patch's own RLocT calls must be inert to the matcher.
  for (const row of PAIR_OWNED_STRINGS) {
    const en = row.literal.match(/"((?:[^"\\]|\\.)*)"/)[1];
    const pair = table.get(en);
    assert.ok(pair != null, `${row.id} is documented as pair-owned but is not in the table`);
    const localized = applyPair(patched, en, pair.zh, pair.mode).patched;
    assert.ok(localized.includes(pair.zh), `${row.id} no longer resolves to ${pair.zh}`);
    assert.equal(pair.zh, row.resolvesTo, `${row.id} must resolve to official's own value`);
  }
  assert.ok(!/RLocT\(RLocT/.test(sectionOf(patched)), "an RLocT call must not be nested");
});

test("reverting any single transform turns the assertion red", { skip: bundleSkip }, () => {
  const patched = patchOriginalComputerUpdateSection(BUNDLE);
  const section = sectionOf(patched);
  const mutants = [
    ["phase pin", 'let v="up-to-date";', "let v;", /phase/],
    ["rebuild-block neutralisation", "l=!1,{isUpdateBoxPending:t,", "{isUpdateBoxPending:t,", /isRebuildBlocked/],
    ["group title", 'title:RLocT("Grok Node\'s Computer","Grok Node 的电脑")', 'title:"Grok Node\'s Computer"', /iXLVub/],
    ["banner anchor", SECTION_ANCHOR, 'cDn=RLocT("x","y")', /oxmHsP|computer-section string anchor/],
    ["reset label", 'const W=s?RLocT("Resetting…","正在重置…"):RLocT("Reset","重置");', 'const W=s?"Resetting…":"Reset";', /OfhWJH/],
  ];
  for (const [what, before, after, expected] of mutants) {
    assert.ok(section.includes(before), `mutant anchor for ${what} is not in the section`);
    assert.throws(
      () => assertComputerUpdateSectionShape(patched.replace(before, after)),
      expected,
      `reverting ${what} must fail the shape assertion`,
    );
  }
});

test("a chunk that lost or duplicated an anchor fails closed instead of half-patching", { skip: bundleSkip }, () => {
  const cases = [
    ["the section component", COMPONENT_ANCHOR],
    ["the section string constants", SECTION_ANCHOR],
  ];
  for (const [what, anchor] of cases) {
    assert.throws(
      () => patchOriginalComputerUpdateSection(BUNDLE.replace(anchor, "function unrelated(){}")),
      /missing or ambiguous/,
      `a chunk without ${what} must fail closed`,
    );
  }
  // A duplicated anchor is equally refused: that is the signature of a chunk that gained a
  // second copy of the section, where a single-target rewrite would only fix one of them.
  assert.throws(
    () => patchOriginalComputerUpdateSection(BUNDLE + BUNDLE.slice(BUNDLE.indexOf(SECTION_ANCHOR))),
    /missing or ambiguous/,
  );
});

test("applying the patch to a staged chunk records provenance", { skip: bundleSkip }, async () => {
  const stageRoot = await stageAssetsRoot();
  const record = await applyOriginalRendererComputerUpdate({ stageRoot });
  assert.equal(record.mode, "original-renderer-computer-update-section");
  assert.equal(record.chunks.length, 1);
  assert.equal(record.chunks[0].role, "computer-update-section");
  assert.notEqual(record.chunks[0].original.sha256, record.chunks[0].patched.sha256);
  assert.ok(record.provenanceBytes > 0);
  // The record has to name the inputs this build pins, so the override is auditable from
  // the package alone.
  assert.deepEqual(record.chunks[0].pinnedInputs, ["phase", "isRebuildBlocked"]);
  assert.equal(record.chunks[0].localizedStrings.length, SECTION_STRINGS.length);

  const written = await readFile(path.join(stageRoot, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  assertComputerUpdateSectionShape(written);
  const provenance = JSON.parse(
    await readFile(path.join(stageRoot, "dist/renderer-computer-update-section-extension.json"), "utf8"),
  );
  assert.equal(provenance.schemaVersion, 1);
  await rm(stageRoot, { recursive: true, force: true });
});

test("a second application fails closed instead of double-patching", { skip: bundleSkip }, async () => {
  const stageRoot = await stageAssetsRoot();
  await applyOriginalRendererComputerUpdate({ stageRoot });
  await assert.rejects(
    () => applyOriginalRendererComputerUpdate({ stageRoot }),
    /missing or ambiguous/,
    "re-running the pass must refuse rather than rewrite the section twice",
  );
  await rm(stageRoot, { recursive: true, force: true });
});

test("clean-build runs it with the renderer extensions, before the i18n passes", async () => {
  const source = await readFile(path.join(REPO_ROOT, "scripts/clean-build.mjs"), "utf8");
  const importIndex = source.indexOf('from "./lib/computer-update-renderer-patch.mjs"');
  assert.ok(importIndex > 0, "clean-build does not import the computer-update section patch");
  const callIndex = source.indexOf("await applyOriginalRendererComputerUpdate({ stageRoot });");
  assert.ok(callIndex > 0, "clean-build never calls the computer-update section patch");
  for (const [label, marker] of [
    ["settings-i18n", "await applyOriginalRendererSettingsI18n({ stageRoot });"],
    ["main-i18n", "await applyOriginalRendererMainI18n({ stageRoot });"],
    ["extra-i18n", "await applyOriginalRendererExtraI18n({ stageRoot });"],
  ]) {
    const i18nIndex = source.indexOf(marker);
    assert.ok(callIndex < i18nIndex, `the patch emits RLocT calls, so it must run before the ${label} pass`);
  }
  // It also has to land after the passes whose literals the main-i18n pair table matches,
  // because those pairs are the reason three of the section's strings stay unedited.
  for (const [label, marker] of [
    ["selection-add-to-prompt", "await applyOriginalRendererSelectionAddToPrompt({ stageRoot });"],
    ["teach-success-path", "await applyOriginalRendererTeachSuccessPath({ stageRoot });"],
  ]) {
    const prerequisite = source.indexOf(marker);
    assert.ok(prerequisite > 0 && prerequisite < callIndex, `the patch must run after the ${label} pass`);
  }
});

test("the pinned-digest invariant the section relies on stays in the source", async () => {
  // The whole justification for the up-to-date card is that this build cannot be offered a
  // newer image. If that pin ever became a moving tag, the section would be claiming a
  // state the build cannot guarantee, and this guard is what would say so.
  const connector = await readFile(
    path.join(REPO_ROOT, "source/electron-main/box/local-docker-host-connector.ts"),
    "utf8",
  );
  const pin = /LOCAL_DOCKER_BOX_IMAGE_DIGEST = "([^"]+)"/.exec(connector);
  assert.ok(pin != null, "the local-docker box image pin is gone");
  assert.match(pin[1], /@sha256:[0-9a-f]{64}$/, "the box image must stay pinned by digest, not by tag");
});
