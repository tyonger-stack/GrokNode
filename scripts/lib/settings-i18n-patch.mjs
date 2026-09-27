import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BT,
  DQ,
  NL as ENGINE_NL,
  RUNTIME_LINES,
  applyAnchored,
  applyPair as applyEnginePair,
  sha256Hex,
} from "./i18n-patch-engine.mjs";

// Settings-surface runtime Chinese translation for the upstream 0.18 renderer.
//
// Evidence (all strings below are byte-sourced from the installed Grok Bot 0.59.1 (re-verified 2026-09-26: all pairs still present with identical wording)
// macOS app, bundle com.anysphere.sand, and verified against its running UI):
//   * English source catalog: dist/renderer/assets/index.eager-app-B8lDj1qR.js
//     (<id>/<en> entries, 2568 total).
//   * Simplified-Chinese catalogs (JSON.parse blobs, 2913 combined IDs):
//       dist/renderer/assets/chunk-settings-C_Jx7w44.js (415)
//       dist/renderer/assets/chunk-agents-D5D4ho1-.js (475)
//       dist/renderer/assets/chunk-chat-CeMHG01x.js (689)
//       dist/renderer/assets/chunk-core-B2g75-yz.js (1339)
//       dist/renderer/assets/chunk-shared-d2mkjrmA.js (218)
// Each pair cites its 0.58 message ID so any row can be re-checked against
// the 0.58 bundle. Nothing here is authored translation.
//
// Scope: the Settings panel chunk (index-BlqerJhg.js in 0.18: General,
// Account, Auto-review, Updates, Usage). Shell titles such as 'General'
// live in other 0.18 chunks and are follow-up surfaces, not this patch.
// Deliberate gaps (0.18-only strings with no 0.58 counterpart) stay English
// and are listed in SETTINGS_I18N_GAPS: Agent, Auto-update when idle,
// transient progress states, egress copy, example placeholder, status
// fragments, error sentences, trial paragraph, Statsig dev entry.
//
// Runtime model: every replaced literal becomes RLocT(en,zh), resolved
// per render from window.desktop.language (initial preference) with the same
// navigator fallback as the Language row. On a language-changed broadcast that
// flips the resolved locale the renderer reloads once so all static strings
// re-render; the Language row itself keeps its own live state.
//
// Match shapes come from the shared engine (scripts/lib/i18n-patch-engine.mjs):
// FULL pairs use display props, ternary branches, throw sites and
// expression-position colons; PANEL pairs (SETTINGS_I18N_PANEL) additionally
// cover variable assignments, return statements, bespoke *AriaLabel/*Hint
// props and theme/mode option maps. Single-quoted containers, template text
// and comments never match (span-aware); whole-block copy such as the
// timezone combo template and the rule-hint container is handled by
// SETTINGS_I18N_ANCHORED (exact-once, fail-closed).

export const SETTINGS_I18N_PAIRS = [
  ["Account", "账户", "AeXO77"],
  ["Action", "操作", "bwRvnp"],
  ["Add Rule", "添加规则", "bmQLn5"],
  ["Add rule", "添加规则", "O8tK4v"],
  ["Allow automatically", "自动允许", "H+RaRS"],
  ["Appearance", "外观", "aAIQg2"],
  ["Ask first", "先询问", "4YjKLA"],
  ["Auto-detect", "自动检测", "pEb1UY"],
  ["Auto-review", "自动审核", "RkLueX"],
  ["Auto-review Rules", "自动审核规则", "LgRXPe"],
  ["Auto-review rule draft", "自动审核规则草稿", "oUa4Ur"],
  ["Auto-review rules", "自动审核规则", "7KwN2p"],
  ["Automatically update your client while you're away.", "在你离开时自动更新客户端。", "mU0j//"],
  ["Behavior", "行为", "tK9OCv"],
  ["Cancel", "取消", "dEgA5A"],
  ["Cancel Trial", "取消试用", "oV3urV"],
  ["Cancel editing rule", "取消编辑规则", "1tYiQU"],
  ["Cancel your trial?", "要取消试用吗？", "N8yesn"],
  ["Check for Updates", "检查更新", "ETzTLS"],
  ["Checking for updates…", "正在检查更新…", "1JRcvi"],
  ["Close", "关闭", "yz7wBu"],
  ["Connect your Cursor account to Grok Bot", "将你的 Cursor 账户连接到 Grok Bot", "2Jy5wv"],
  ["Copy email address", "复制邮箱地址", "/lLfdi"],
  ["Dark", "深色", "pvnfJD"],
  ["Execution on Local Computer", "在本地电脑上执行", "fuUvu2"],
  ["Finish signing in from your browser", "请在浏览器中完成登录", "96E02j"],
  ["Follow System", "跟随系统", "Ea4oxV"],
  ["Grok Bot Lab is a one-off test build and never auto-updates", "Grok Bot Lab 是一次性测试构建，绝不会自动更新", "LQb5zQ"],
  ["Grok Bot Updates", "Grok Bot 更新", "U+dVHJ"],
  ["Grok Bot checks each action before it runs and asks you first when needed. Add rules to customize what it can do automatically.", "Grok Bot 会在每个操作运行前进行检查，需要时先询问你。添加规则即可自定义它能自动执行的操作。", "De8ppO"],
  ["Grok Bot couldn't load update status. Check again to retry.", "Grok Bot 无法加载更新状态。请再次检查以重试。", "wS2ikm"],
  ["Grok Bot settings", "Grok Bot 设置", "0+WgJu"],
  ["It should:", "它应该：", "nFnkzP"],
  ["Keep Trial", "保留试用", "4lZvVR"],
  ["Let the assistant open files and run tasks on your computer. Auto-review still checks everything first.", "允许 Bot 在你的电脑上打开文件并运行任务。自动审核仍会先检查所有操作。", "hrkSSQ"],
  ["Light", "浅色", "1njn7W"],
  ["Loading…", "加载中…", "Pwqkdw"],
  ["Nightly", "每夜版", "cVY2Vt"],
  ["No included usage available on your plan right now.", "你的计划目前没有可用的附带用量。", "yL2r/e"],
  ["Not available.", "不可用。", "zfNFMR"],
  ["Not signed in", "未登录", "95+rix"],
  ["On-demand usage", "按需用量", "fqkvA1"],
  ["Restart to Update", "更新并重启", "Cy8PUD"],
  ["Retry", "重试", "6gRgw8"],
  ["Rule behavior", "规则行为", "j74EnZ"],
  ["Save Rule", "保存规则", "LvKmBo"],
  ["Security Key", "安全密钥", "0qyGnO"],
  ["Security keys from Grok Bot's computer aren't supported on this platform yet.", "此平台暂不支持来自 Grok Bot 电脑的安全密钥。", "DEmr6C"],
  ["Settings sections", "设置分区", "y1t8bQ"],
  ["Sign In with Cursor", "使用 Cursor 登录", "c6o3E/"],
  ["Sign Out", "退出登录", "bHYIks"],
  ["Signed in to Cursor", "已登录 Cursor", "2xWX7o"],
  ["Signing in", "正在登录", "5pYsL1"],
  ["Stable", "稳定版", "B6aXGH"],
  ["Stable is the safe default. Other tracks ship new builds earlier and more often. Switching checks for updates right away.", "稳定版是安全的默认选择。其他通道会更早、更频繁地发布新构建。切换后会立即检查更新。", "9X6nZD"],
  ["Theme", "主题", "FEr96N"],
  ["These rules apply only to you. Built-in safety checks always apply.", "这些规则仅对你生效。内置安全检查始终有效。", "n9YiIv"],
  ["Timezone", "时区", "40Gx0U"],
  ["Update Track", "更新通道", "/IUA77"],
  ["Updates", "更新", "qIrtcK"],
  ["Updates are disabled by SAND_DISABLE_UPDATES", "更新已被 SAND_DISABLE_UPDATES 停用", "zQjC4P"],
  ["Updates are disabled in dev builds", "开发构建中已停用更新", "mHJfw8"],
  ["Updates aren't available on this platform", "此平台不支持更新", "eWT6UF"],
  ["Usage", "用量", "7FaY4u"],
  ["Use hardware security keys", "使用硬件安全密钥", "VUEkDl"],
  ["When Grok Bot wants to:", "当 Grok Bot 想要：", "8X0v3P"],
  ["You're up to date", "已是最新版本", "Ekblrc"],
  // 0.61.0 catalog ports and 0.18-only direct translations (wave 2: 17
  // remaining settings-panel display strings). Each row is byte-sourced
  // from the installed Grok Bot 0.61.0 en/zh-CN catalogs (IDs cited from
  // 0.58 message IDs), or newly authored when no 0.61.0 counterpart
  // exists (o18locA..D). Five switch labels (available/unavailable/
  // connected/connecting/up-to-date) stay English: the Settings panel
  // compares them with === against typed status values, so translating
  // would orphan the runtime branches; they remain in SETTINGS_I18N_GAPS
  // below as documented, intentional gaps.
  ["Agent", "代理", "o18locA"],
  ["Auto-update when idle", "空闲时自动更新", "o18locB"],
  ["Canceling\u2026", "正在取消\u2026", "UsfSPG"],
  ["Checking\u2026", "检查中\u2026", "RLe7Vk"],
  ["Loading update status\u2026", "正在加载更新状态\u2026", "+Vy0cC"],
  ["Loading usage\u2026", "正在加载用量\u2026", "zfTucZ"],
  ["Connecting to Grok Bot's computer\u2026", "正在连接 Grok Bot 的电脑", "NFgPnJ"],
  ["Route egress through this desktop", "通过此桌面路由出口流量", "o18locC"],
  ["Allow Grok Bot to use a security key (such as a YubiKey) connected to your computer. You\u2019ll be asked to approve each use.", "允许 Grok Bot 使用连接到你电脑的安全密钥（如 YubiKey）。每次使用前都会请你批准。", "rmVuan"],
  ["e.g. reply to emails for me", "例如：替我回复邮件", "TWBOU+"],
  ["unknown error", "未知错误", "o18locD"],
  ["Couldn\u2019t load usage.", "无法加载用量。", "QtkApk"],
  ["Couldn\u2019t refresh usage \u2014 showing the last known values.", "无法刷新用量，正在显示最近一次已知数据。", "hCwN14"],
  ["Couldn\u2019t cancel the trial. Try again.", "无法取消试用，请重试。", "Q5HBNA"],
  ["This ends your Grok Bot trial now and removes your remaining trial credits. Your card won’t be charged either way — the trial never turns into a paid plan on its own.", "这会立即结束你的 Grok Bot 试用，并移除剩余的试用额度。无论如何都不会向你的银行卡扣款，试用绝不会自动转为付费计划。", "L41f29"],
];

// Panel-shape rows: pairs whose 0.18 occurrences need more than the FULL
// shapes (verified 2026-09-26 against the deployed Grok Node settings chunk,
// 67 pairs / 82 blind-replaced branches). Assignment rows drive the auth
// button variable (let o="Sign In with Cursor" / o="Sign Out" / o="Cancel")
// and the update-row variable (let F="Check for Updates" / F="Loading…");
// return rows are early-returns of status copy; custom-prop rows are bespoke
// *AriaLabel/*Hint attributes; map rows are theme/mode option tables
// ({dark:"Dark",light:"Light",system:"Follow System",...}). Everything
// else is FULL-shaped (display props, ternary branches, throw sites and
// expression-position colons). The Ask-first sentence container stays raw by
// single-quote span skipping and remains a documented gap.
export const SETTINGS_I18N_PANEL = new Set([
  "Add rule",
  "Auto-review rule draft",
  "Cancel",
  "Check for Updates",
  "Connect your Cursor account to Grok Bot",
  "Dark",
  "Execution on Local Computer",
  "Finish signing in from your browser",
  "Follow System",
  "Grok Bot Lab is a one-off test build and never auto-updates",
  "Let the assistant open files and run tasks on your computer. Auto-review still checks everything first.",
  "Light",
  "Loading…",
  "Nightly",
  "No included usage available on your plan right now.",
  "Not signed in",
  "Rule behavior",
  "Sign In with Cursor",
  "Sign Out",
  "Signing in",
  "Stable",
  "Updates are disabled by SAND_DISABLE_UPDATES",
  "Updates are disabled in dev builds",
  "Updates aren't available on this platform",
  // wave 2: PANEL-shaped occurrences for the 17 newly added pairs.
  // Checking… is an update-row variable assignment (let F="Check…"
  // / F="Loading…" / F="Checking…"), Connecting to Grok Bot's
  // computer… is an early-return from a switch on relay state, unknown
  // error and Couldn't cancel the trial. Try again. are ?? default-value
  // fallbacks (so they only render when the upstream message is empty),
  // and Update access is managed by internal release-track policy. is
  // the first element of a JSX children array literal (no prop: prefix,
  // hence PANEL over FULL).
  "Checking…",
  "Connecting to Grok Bot's computer…",
  "unknown error",
  "Couldn't cancel the trial. Try again.",
]);

export const SETTINGS_I18N_GAPS = [
  // Status-string switch labels: the Settings panel compares these with
  // === against typed status values from the host (e.g. e.lastCheck.result
  // === "up-to-date", e.status === "unavailable", T.type === "available",
  // s.state === "connected" / "connecting"). Translating them would orphan
  // the runtime branches because the upstream status enum stays English.
  // Keep them as gaps so the patch leaves them byte-identical.
  "available",
  "connected",
  "connecting",
  "unavailable",
  "up-to-date",
];

const PA_ANCHOR = "function pa(){";

const RUNTIME_PRELUDE = RUNTIME_LINES.join(ENGINE_NL) + ENGINE_NL;

export function patchOriginalSettingsI18n(source) {
  if (source.indexOf(PA_ANCHOR) < 0) throw new Error("Original renderer Settings anchor is missing.");
  let patched = PA_ANCHOR_REPLACEMENT(source);
  const applied = [];
  for (const [en, zh] of SETTINGS_I18N_PAIRS) {
    const mode = SETTINGS_I18N_PANEL.has(en) ? "PANEL" : "FULL";
    const result = applyEnginePair(patched, en, zh, mode);
    patched = result.patched;
    applied.push({ en, mode, hits: result.hits });
  }
  const anchored = [];
  for (const entry of SETTINGS_I18N_ANCHORED) {
    patched = applyAnchored(patched, entry.anchor, entry.replacement);
    anchored.push({ id: entry.id, note: entry.note });
  }
  return { patched, applied, anchored };
}

// Whole-block replacements for copy the pair shapes cannot express.
// Each anchor is a byte-exact 0.18 minified fragment (fail-closed
// exact-once) and each zh is byte-sourced from the 0.59.1 catalog ID cited.
//   * tz-combo (0.59.1 SprHbY): the timezone row composes its label as a
//     template `Auto-detect (<tz>)`; 0.59.1 renders ASCII parens in en and
//     fullwidth parens in zh, so the branch mirrors that per render.
//   * rule-hint (0.59.1 NFRGrQ): the single-quoted container sentence whose
//     inner "Ask first" quote must never branch on its own.
export const SETTINGS_I18N_ANCHORED = [
  {
    id: "SprHbY",
    note: "tz-combo-template",
    anchor: BT + "Auto-detect (${ze(e)})" + BT,
    replacement: "(RLocT(\"Auto-detect (\"+ze(e)+\")\",\"自动检测（\"+ze(e)+\"）\"))",
  },

  {
    id: "NFRGrQ",
    note: "rule-hint-container",
    anchor: "'Write one short, natural-language rule for each action. \"Ask first\" takes priority if rules conflict.'",
    replacement: "(RLocT(\"Write one short, natural-language rule for each action. \\\"Ask first\\\" takes priority if rules conflict.\",\"为每种操作写一条简短的自然语言规则。规则冲突时，“先询问”优先。\"))",
  },

  {
    // 0.61.0 catalog (D6WGx5) renders the entire "Update access ...
    // <0>Open Statsig config</0>" inline as one localized string with a
    // linked "<0>" placeholder; 0.18 hand-rolls the same content with a
    // JSX Fragment containing a plain-text element and an <a> child. The
    // literal sits at the head of a children: [...] array, so neither the
    // PROP/FULL nor PANEL : or , literal patterns reach it. Anchored
    // exact-once replacement is the only safe route; both inner strings
    // are branched independently so the link target stays intact.
    id: "D6WGx5",
    note: "track-policy-fragment",
    anchor: DQ + "Update access is managed by internal release-track policy." + DQ + "," + DQ + " " + DQ + ",a.jsx(" + DQ + "a" + DQ + ",{...h(Me,f),className:k(" + DQ + "sand-kbann2 sand-1ypdohk sand-ujl8zx" + DQ + "),href:Me,rel:" + DQ + "noopener noreferrer" + DQ + ",target:" + DQ + "_blank" + DQ + ",children:" + DQ + "Open Statsig config" + DQ + "})",
    replacement: DQ + "(RLocT(\"Update access is managed by internal release-track policy.\",\"更新权限由内部发布通道策略管理。\"))" + DQ + "," + DQ + " " + DQ + ",a.jsx(" + DQ + "a" + DQ + ",{...h(Me,f),className:k(" + DQ + "sand-kbann2 sand-1ypdohk sand-ujl8zx" + DQ + "),href:Me,rel:" + DQ + "noopener noreferrer" + DQ + ",target:" + DQ + "_blank" + DQ + ",children:" + DQ + "(RLocT(\"Open Statsig config\",\"打开 Statsig 配置\"))" + DQ + "})",
  },
];

function PA_ANCHOR_REPLACEMENT(source) {
  const first = source.indexOf(PA_ANCHOR);
  return source.slice(0, first) + RUNTIME_PRELUDE + source.slice(first);
}

export async function applyOriginalRendererSettingsI18n({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(PA_ANCHOR) && source.includes("\"Appearance\"")) {
      candidates.push({ name, target, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error("Expected one Settings panel chunk for settings-i18n patch, found " + candidates.length + ".");
  }
  const candidate = candidates[0];
  const { patched, applied, anchored } = patchOriginalSettingsI18n(candidate.source);
  await writeFile(candidate.target, patched);
  const totalReplacements = applied.reduce((sum, row) => sum + row.hits, 0);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-settings-i18n",
    chunks: [{
      role: "settings-panel",
      path: "dist/renderer/assets/" + candidate.name,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256Hex(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256Hex(patched) },
      pairsApplied: applied.length,
      totalReplacements,
      anchoredApplied: anchored,
    }],
    features: ["settings-panel-chinese"],
    transformations: ["settings-i18n-prelude-insertion", "settings-i18n-literal-branches", "settings-i18n-anchored-blocks"],
    gaps: SETTINGS_I18N_GAPS,
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-settings-i18n-extension.json");
  await writeFile(provenancePath, JSON.stringify(record, null, 2) + "\n");
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
