// The "Grok Node 的电脑" (Grok Bot's Computer) section of Settings → 更新, ported onto the
// checksum-pinned 0.18 renderer chunk.
//
// WHAT THIS PATCH IS FOR
// Official Grok Bot shows this group in one of two shapes, chosen by
// `phase==="up-to-date" && !isRebuildBlocked`: the up-to-date card (primary-coloured
// "Update Grok Bot's Computer" title, the shared-computer sentence, and a blue
// check-circle banner reading "Your computer is on the latest version") or the updateable
// card (same title/description plus an Update button). 0.18 has byte-identical structure —
// `D=b==="up-to-date"&&!l?<banner card>:<JWe …variant:"card">` — so this patch does not
// draw anything new: it moves the existing 0.18 code down the branch official already
// takes, and localises the strings that branch renders.
//
// WHY GROK NODE IS ALWAYS UP TO DATE
// Grok Node runs the box from a digest-pinned image
// (source/electron-main/box/local-docker-host-connector.ts:25,
// LOCAL_DOCKER_BOX_IMAGE_DIGEST = public.ecr.aws/…/universal@sha256:f9dff5cd…). A digest
// cannot move, and `docker run` pulls only when the image is missing, so no newer image
// can ever be offered — "no update available" is a property of this build, not a guess.
//
// The two inputs upstream keys this decision on can therefore never report the truth
// here, which is why the branch is unreachable in stock 0.18 on this build:
//   * `isBoxUpToDate` is `imageUpdateAvailable === false` (WOn → `G=e===!1`). The image
//     probe is skipped outside the box: ForeverBoxService.refreshImageUpdateAvailable
//     returns `{outcome:"skipped"}` unless `isInBox()` (SAND_HOST_IN_BOX==="1"), and the
//     desktop host never sets it, so the flag stays `undefined` and `undefined===false`
//     is false.
//   * `isRebuildBlocked` comes from the computerRebuild actions store, and the rebuild
//     state machine can sit in a pending/locked state with no session-level policy behind
//     it — this build imposes no update/reset lockdown at all (main-edge routes
//     updateComputer through recreateComputer with preserveData:true, guarded by
//     tests/box-updates-section-restored.test.mjs).
// So the section is pinned to the up-to-date layout and `isRebuildBlocked` is neutralised
// at its single binding, which is the only place that decides all seven of its uses.
//
// WHAT IS NOT TOUCHED
// The banner component `mDn`, the row component `JWe`, the group `aDn`, the stylix class
// sets, the reset button's real pending wiring (`s` = isResetBoxPending) and the reset
// handler are all upstream bytes. A reset that is genuinely in flight still reads
// "正在重置…" and stays disabled, exactly as official does.
//
// TEXT PROVENANCE
// Simplified Chinese is byte-sourced from the installed official Grok Bot 0.66.0 macOS app
// (/Applications/Grok Bot.app, bundle com.anysphere.sand, CFBundleShortVersionString
// 0.66.0, read from app.asar on 2026-10-06). Each value below is the zh-CN catalog entry
// for the message id official renders at that position:
//   oxmHsP  Your computer is on the latest version   你的电脑已是最新版本
//   nlDFDE  Updates the computer your assistants…    更新你的 Bot 共用的电脑。你的文件和登录
//           share. Your files and logins stay, but    信息会保留，但已安装的应用和软件包会被
//           installed apps and packages are removed.  移除。所有 Bot 会一起更新。
//           All assistants update together.
//   nnJerG  Update Grok Bot's Computer                更新 Grok Bot 的电脑   → Grok Node
//   FB/gHq  Reset Grok Bot's Computer                 重置 Grok Bot 的电脑   → Grok Node
//   iXLVub  Grok Bot's Computer                       Grok Bot 的电脑        → Grok Node
//   OfhWJH  Reset                                    重置
//   xRPBky  Resetting…                               正在重置…
// The ids come from official's settings-key registry (dist/renderer/assets/
// index.eager-app-Cj5f8Gby.js, `"update-computer":{label:{id:"nnJerG"}}` etc.) and the
// Chinese from dist/renderer/assets/chunk-settings-B6jQVzG0.js. Nothing is authored.
//
// "Grok Node" is this build's product name, not official's: the user asked for the
// section to read as Grok Node throughout, so every "Grok Bot" in this group — title, both
// row labels, and the English side of both locales — says "Grok Node".
//
// LOCALIZATION, AND WHY THIS PATCH TOUCHES ONLY HALF OF THEM
// Strings go through `RLocT(en, zh)`, the runtime the main-i18n pass appends to this same
// chunk, so the section follows the app's language setting like official's id-based
// strings do (and reloads on a language flip, per that prelude's onChanged handler). This
// patch therefore has to land BEFORE the i18n passes in clean-build.mjs, and the pair
// matcher never matches a bare call argument, so the RLocT calls emitted here are left
// alone by the pass that runs after it.
//
// The other half of the section's strings is already localized by the main-i18n pair table,
// and that split is forced rather than preferred: `applyPair` throws when a pair finds no
// eligible anchor ("i18n pair has no anchor outside string spans"), so wrapping the last
// anchor of a pair would break the build. Measured on the pinned chunk with the passes that
// run ahead of main-i18n already applied, the pair replacement lands inside this section for
// the last time for exactly these three, so they stay upstream literals and the i18n pass
// keeps owning them — and each already yields official's own value:
//   oxmHsP  Your computer is on the latest version          你的电脑已是最新版本
//   FXpklv  Refresh Anyway                                 仍要刷新（仅 dev build）
//   yT3Jyn  Test the update flow even though …             即使电脑已是最新版本，也测试一遍更新流程
// Every other section pair — nnJerG, FB/gHq, iXLVub, OY2DWP, OfhWJH, xRPBky, xJKvbI — keeps
// anchors outside this section, so wrapping their copies here is safe and is what carries the
// rename. tests/computer-update-renderer-patch.test.mjs runs the real passes and asserts that
// no pair is left without an anchor.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Locates the target file, as the start of the span this patch owns. Present exactly once
 * in the pinned chunk; a chunk rename or a second copy both fail closed.
 *
 * The patch never rewrites this literal (it belongs to a pair the i18n pass owns — see
 * PAIR_OWNED_STRINGS), so one form identifies the span in both the pristine and the patched
 * chunk. The far end of the span is identified by COMPONENT_ANCHOR, which the patch only
 * edits *after* its own text and therefore leaves matchable in both states.
 */
const SECTION_ANCHOR = 'const cDn="Your computer is on the latest version"';

/** The component that renders the group. Its prop names make this prefix unique. */
const COMPONENT_ANCHOR = "function vKn(n){const e=he.c(53),";

/**
 * `isRebuildBlocked` is rebound to a constant at its one binding site. Official reads the
 * same prop in seven places inside this component (two blocked-notice branches, the
 * up-to-date branch test, and four `disabled` computations), so rebinding once is both the
 * smallest edit and the only one that cannot leave a use behind. The original prop keeps a
 * name that says it is deliberately unused.
 */
const BINDING_BEFORE = "function vKn(n){const e=he.c(53),{isUpdateBoxPending:t,";
const BINDING_AFTER = "function vKn(n){const e=he.c(53),l=!1,{isUpdateBoxPending:t,";

const REBUILD_BLOCK_PROP_BEFORE = "isRebuildBlocked:l,isBoxUpToDate:c,isDevBuild:u,";
const REBUILD_BLOCK_PROP_AFTER = "isRebuildBlocked:grokNodeNoSessionRebuildLock,isBoxUpToDate:c,isDevBuild:u,";

/**
 * The phase memo. Upstream derives it from the four props; with a digest-pinned image the
 * answer is "up-to-date" for every input, so the derivation is replaced by the constant it
 * would return. The props stay destructured (they are read by nothing else, and leaving
 * them in place keeps the diff to the expression that decides the layout).
 */
const PHASE_BEFORE =
  "let v;e[0]!==r||e[1]!==i||e[2]!==c||e[3]!==h?(v=RAe({canUpdateBaseline:r,canUpdateBox:i,isBoxUpToDate:c,isUpdateQueued:h}),e[0]=r,e[1]=i,e[2]=c,e[3]=h,e[4]=v):v=e[4];";
const PHASE_AFTER = 'let v="up-to-date";';

/**
 * Section strings the main-i18n pair table already localizes, and which this patch must
 * therefore leave alone: their pair replacement lands inside the section for the last time
 * here, so wrapping them would leave the pair without an anchor and fail the build. The
 * value each one already resolves to is official's own, so nothing is lost — they are
 * asserted rather than edited.
 */
export const PAIR_OWNED_STRINGS = Object.freeze([
  {
    id: "oxmHsP",
    what: "up-to-date banner text",
    literal: 'cDn="Your computer is on the latest version"',
    resolvesTo: "你的电脑已是最新版本",
  },
  {
    id: "FXpklv",
    what: "dev-build refresh label",
    literal: 'children:"Refresh Anyway"',
    resolvesTo: "仍要刷新",
  },
  {
    id: "yT3Jyn",
    what: "dev-build refresh tooltip",
    literal: 'title:"Test the update flow even though the computer is already up to date"',
    resolvesTo: "即使电脑已是最新版本，也测试一遍更新流程",
  },
]);

/**
 * Every other string the section renders, with the official message id each one stands for.
 * `count` is how many occurrences the anchor must have inside the section, so a chunk that
 * grew or lost a copy of one of them fails closed instead of half-translating.
 *
 * Two of these — the busy/queued notices and the dev-build refresh control — sit in branches
 * the pinned phase has made unreachable. They cost nothing to carry, and localizing them
 * keeps the section free of raw English UI strings, so "the section renders Chinese" stays
 * checkable by reading the section rather than by reasoning about which branch runs.
 */
export const SECTION_STRINGS = Object.freeze([
  {
    id: "GUemL5",
    what: "busy-override notice (unreachable once the phase is pinned)",
    before: 'uDn="An agent is working. Updating now will interrupt it."',
    after:
      'uDn=RLocT("An agent is working. Updating now will interrupt it.","有 Bot 正在工作。更新会在安全点将它暂停，并在新电脑上恢复运行，可能需要多花几分钟。")',
  },
  {
    id: "cugI1r",
    what: "queued notice (unreachable once the phase is pinned)",
    before: 'dDn="Update queued. It runs as soon as every agent is done."',
    after: 'dDn=RLocT("Update queued. It runs as soon as every agent is done.","有 Bot 正在工作。等所有 Bot 完成后即可更新。")',
  },
  {
    id: "nlDFDE",
    what: "shared-computer description (banner and update row share it)",
    before:
      '_We="Updates the computer your assistants share. Your files and logins stay. All assistants update together."',
    after:
      '_We=RLocT("Updates the computer your assistants share. Your files and logins stay, but installed apps and packages are removed. All assistants update together.","更新你的 Bot 共用的电脑。你的文件和登录信息会保留，但已安装的应用和软件包会被移除。所有 Bot 会一起更新。")',
  },
  {
    id: "nnJerG",
    what: "up-to-date card title",
    before: 'children:"Update Grok Bot\'s Computer"',
    after: 'children:RLocT("Update Grok Node\'s Computer","更新 Grok Node 的电脑")',
  },
  {
    id: "nnJerG",
    what: "updateable-row label (the branch the pinned phase no longer takes)",
    before: 'label:"Update Grok Bot\'s Computer"',
    after: 'label:RLocT("Update Grok Node\'s Computer","更新 Grok Node 的电脑")',
  },
  {
    id: "FB/gHq",
    what: "reset-row label",
    before: 'label:"Reset Grok Bot\'s Computer"',
    after: 'label:RLocT("Reset Grok Node\'s Computer","重置 Grok Node 的电脑")',
  },
  {
    id: "iXLVub",
    what: "group title",
    before: 'title:"Grok Bot\'s Computer"',
    after: 'title:RLocT("Grok Node\'s Computer","Grok Node 的电脑")',
  },
  {
    id: "OfhWJH/xRPBky",
    what: "reset button label, idle and in-flight",
    before: 'const W=s?"Resetting…":"Reset";',
    after: 'const W=s?RLocT("Resetting…","正在重置…"):RLocT("Reset","重置");',
  },
  {
    id: "J8tdjR",
    what: "reset-row notice when the session is a group (the one notice in this section that is still reachable after the phase is pinned)",
    before: 'p.jsx(qX,{children:"Open an agent to reset the shared computer"})',
    after: 'p.jsx(qX,{children:RLocT("Open an agent to reset the shared computer","打开一个 Bot 以重置共享电脑")})',
  },
]);

/**
 * The two copies of the session-rebuild-blocked notice. Upstream renders the same sentence
 * once under the update row and once under the reset row, and the two `pinned phase` inputs
 * have made both unreachable — but the string is the only remaining "Grok Bot" text in the
 * section, and a future chunk that stops pinning `l` would put it back on screen, so both
 * copies are renamed here too. `count: 2` keeps the edit fail-closed: one copy means a
 * layout change this patch was not written against, three means an ambiguity.
 */
const BLOCKED_NOTICE_BEFORE =
  'children:"Further computer updates and resets are disabled for this session. Restart Grok Bot after the computer is available again."';
const BLOCKED_NOTICE_AFTER =
  'children:RLocT("Further computer updates and resets are disabled for this session. Restart Grok Node after the computer is available again.","本次会话已停用后续的电脑更新和重置。等电脑恢复可用后，请重启 Grok Node。")';

function replaceExactly(source, before, after, label, count = 1) {
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  let hits = 0;
  for (let at = first; at >= 0 && source.indexOf(before, at) >= 0; ) {
    at = source.indexOf(before, at + 1);
    if (at >= 0) hits += 1;
  }
  if (hits + 1 !== count) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.split(before).join(after);
}

/** Brace-balanced body of the section component, so no edit can land in a neighbour. */
function sectionComponent(source) {
  const start = source.indexOf(COMPONENT_ANCHOR);
  if (start < 0 || source.indexOf(COMPONENT_ANCHOR, start + 1) >= 0) {
    throw new Error("Original renderer computer-section component anchor is missing or ambiguous.");
  }
  let depth = 0;
  const bodyStart = source.indexOf("{", start);
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Original renderer computer-section component did not brace-balance.");
}

/**
 * The span this patch owns: the section's string constants, its banner component and the
 * section component. Everything the patch edits has to fall inside it.
 */
function sectionRegion(source) {
  const from = source.indexOf(SECTION_ANCHOR);
  if (from < 0 || source.indexOf(SECTION_ANCHOR, from + 1) >= 0) {
    throw new Error("Original renderer computer-section string anchor is missing or ambiguous.");
  }
  const component = sectionComponent(source);
  const componentStart = source.indexOf(component);
  if (componentStart < from) {
    throw new Error("Original renderer computer-section strings no longer precede their component.");
  }
  return { from, to: componentStart + component.length };
}

export function patchOriginalComputerUpdateSection(source) {
  const { from, to } = sectionRegion(source);
  let region = source.slice(from, to);
  for (const [before, after, label] of [
    [BINDING_BEFORE, BINDING_AFTER, "computer-section prop binding"],
    [REBUILD_BLOCK_PROP_BEFORE, REBUILD_BLOCK_PROP_AFTER, "isRebuildBlocked binding"],
    [PHASE_BEFORE, PHASE_AFTER, "computer-section phase derivation"],
  ]) {
    region = replaceExactly(region, before, after, label);
  }
  for (const row of SECTION_STRINGS) {
    region = replaceExactly(region, row.before, row.after, `${row.id} (${row.what})`);
  }
  region = replaceExactly(region, BLOCKED_NOTICE_BEFORE, BLOCKED_NOTICE_AFTER, "OY2DWP (session-rebuild-blocked notice)", 2);
  return source.slice(0, from) + region + source.slice(to);
}

/**
 * Assert the outcome rather than the edit: the section must take official's up-to-date
 * branch, must keep rendering upstream's own banner and row components with their original
 * class sets, must carry no remaining "Grok Bot" string, and must still wire the real
 * reset handler and the real pending label.
 */
export function assertComputerUpdateSectionShape(patched) {
  const { from, to } = sectionRegion(patched);
  const region = patched.slice(from, to);
  const problems = [];
  if (!region.includes('let v="up-to-date";')) {
    problems.push("the phase is no longer pinned to up-to-date");
  }
  if (region.includes(PHASE_BEFORE)) {
    problems.push("the upstream phase derivation is still reachable");
  }
  if (!region.includes("l=!1,")) {
    problems.push("isRebuildBlocked is not neutralised at its binding");
  }
  if (region.includes("isRebuildBlocked:l,")) {
    problems.push("the runtime isRebuildBlocked prop is still bound to the layout decision");
  }
  for (const row of SECTION_STRINGS) {
    if (region.includes(row.before)) {
      problems.push(`${row.id} (${row.what}) is still an untranslated literal`);
    }
    if (!region.includes(row.after)) {
      problems.push(`${row.id} (${row.what}) is missing its localized form`);
    }
  }
  if (region.includes(BLOCKED_NOTICE_BEFORE)) {
    problems.push("OY2DWP (session-rebuild-blocked notice) is still an untranslated literal");
  }
  if (!region.includes(BLOCKED_NOTICE_AFTER)) {
    problems.push("OY2DWP (session-rebuild-blocked notice) is missing its localized form");
  }
  if (/Grok Bot/.test(region)) {
    problems.push("a Grok Bot string survives in the section");
  }
  // The three strings the i18n pass owns must survive as literals. Wrapping them would strip
  // the pair of its last anchor and fail the build, so this asserts they are still upstream
  // bytes — a future "the section should not hold English" cleanup has to go through the
  // pair table instead of through this patch.
  for (const row of PAIR_OWNED_STRINGS) {
    if (!region.includes(row.literal)) {
      problems.push(`${row.id} (${row.what}) is no longer the literal the i18n pair anchors on`);
    }
    if (region.includes(row.resolvesTo)) {
      problems.push(`${row.id} (${row.what}) was hardcoded here; the pair owns that translation`);
    }
  }
  // The parts that must stay upstream bytes: the banner markup, both row layouts, the
  // group's own component, the reset handler and its pending gate.
  for (const keep of [
    're("sand-settings-uptodate-banner"',
    'p.jsx(bt,{"aria-hidden":!0,name:"check-circle",size:14})',
    'D=b==="up-to-date"&&!l?',
    "p.jsx(JWe,{description:\"Start fresh if the computer gets stuck. It's rebuilt from your last saved snapshot, so very recent changes may be lost.\",divided:!0",
    'sentiment:"danger"',
    "const F=!o||l||t||s",
    "p.jsxs(aDn,",
  ]) {
    if (!region.includes(keep)) problems.push(`upstream bytes lost: ${keep}`);
  }
  if (problems.length > 0) {
    throw new Error(`Computer-update section patch did not produce the expected section — ${problems.join("; ")}`);
  }
  return { strings: SECTION_STRINGS.length, pairOwned: PAIR_OWNED_STRINGS.length };
}

export async function applyOriginalRendererComputerUpdate({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one original renderer chunk for the computer-update section patch, found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  const patched = patchOriginalComputerUpdateSection(candidate.source);
  assertComputerUpdateSectionShape(patched);
  // The whole point of the section is that it mounts: a JSX edit that only shows up when
  // the settings view is lazily imported is invisible to every other gate, so check the
  // banner markup this patch depends on is still inside the span it rewrote.
  const { from, to } = sectionRegion(patched);
  if (!patched.slice(from, to).includes('role:"status"')) {
    throw new Error("Computer-update section patch could not find the up-to-date banner it must preserve.");
  }
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-computer-update-section",
    chunks: [
      {
        role: "computer-update-section",
        path: `dist/renderer/assets/${candidate.name}`,
        original: {
          bytes: Buffer.byteLength(candidate.source),
          sha256: createHash("sha256").update(candidate.source).digest("hex"),
        },
        patched: {
          bytes: Buffer.byteLength(patched),
          sha256: createHash("sha256").update(patched).digest("hex"),
        },
        localizedStrings: SECTION_STRINGS.map((row) => ({ id: row.id, what: row.what })),
        pinnedInputs: ["phase", "isRebuildBlocked"],
      },
    ],
    features: ["computer-update-section-up-to-date", "computer-update-section-grok-node-identity"],
    transformations: [
      "computer-section-phase-pinned-up-to-date",
      "computer-section-session-rebuild-block-neutralized",
      "computer-section-official-zh-strings",
      "computer-section-grok-node-rename",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-computer-update-section-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
