import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Settings-surface runtime Chinese translation for the upstream 0.18 renderer.
//
// Evidence (all strings below are byte-sourced from the installed Grok Bot 0.58.0
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
];

export const SETTINGS_I18N_GAPS = [
  "Agent",
  "Auto-update when idle",
  "Canceling…",
  "Checking…",
  "Loading update status…",
  "Loading usage…",
  "Connecting to Grok Bot’s computer…",
  "Route egress through this desktop",
  "Allow Grok Bot to use a security key (such as a YubiKey) connected to your computer. You’ll be asked to approve each use.",
  "e.g. reply to emails for me",
  "unknown error",
  "available",
  "connected",
  "connecting",
  "unavailable",
  "up-to-date",
  "Couldn’t load usage.",
  "Couldn’t refresh usage — showing the last known values.",
  "Couldn’t cancel the trial. Try again.",
  "This ends your Grok Bot trial now and removes your remaining trial credits.",
  "Update access is managed by internal release-track policy.",
  "Open Statsig config",
];

const PA_ANCHOR = "function pa(){";

const RUNTIME_LINES = [
  "function RLocFromPref(pref){",
  "if(pref===\"zh-CN\")return \"zh-CN\";",
  "if(pref===\"en\")return \"en\";",
  "try{",
  "var tags=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];",
  "for(var i=0;i<tags.length;i++){var t=String(tags[i]||\"\").trim().toLowerCase();",
  "if(t===\"zh\"||t.indexOf(\"zh-\")===0)return \"zh-CN\";",
  "if(t===\"en\"||t.indexOf(\"en-\")===0)return \"en\";}",
  "}catch(_e){}",
  "return \"en\";}",
  "function RLocBoot(){try{var s=window.desktop&&window.desktop.language;var p=s&&s.initial&&s.initial.preference;return RLocFromPref(p);}catch(_e){}return \"en\";}",
  "function RLocT(en,zh){return RLocBoot()===\"zh-CN\"?zh:en;}",
  "try{(function(){var s=window.desktop&&window.desktop.language;if(!s||typeof s.onChanged!==\"function\")return;var boot=RLocBoot();s.onChanged(function(st){var loc=RLocFromPref(st&&st.preference);if(loc!==boot){try{location.reload();}catch(_e){}}});})();}catch(_e){}"
];

const RUNTIME_PRELUDE = RUNTIME_LINES.join("\n") + "\n";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceAllCounted(source, search, replacement, label) {
  const hits = source.split(search).length - 1;
  if (hits === 0) throw new Error("Settings i18n pair has no anchor in the renderer chunk: " + label);
  return { patched: source.split(search).join(replacement), hits };
}

export function patchOriginalSettingsI18n(source) {
  if (source.indexOf(PA_ANCHOR) < 0) throw new Error("Original renderer Settings anchor is missing.");
  let patched = PA_ANCHOR_REPLACEMENT(source);
  const applied = [];
  for (const [en, zh] of SETTINGS_I18N_PAIRS) {
    const search = JSON.stringify(en);
    const replacement = "(RLocT(" + JSON.stringify(en) + "," + JSON.stringify(zh) + "))";
    const result = replaceAllCounted(patched, search, replacement, en);
    patched = result.patched;
    applied.push({ en, hits: result.hits });
  }
  return { patched, applied };
}

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
  const { patched, applied } = patchOriginalSettingsI18n(candidate.source);
  await writeFile(candidate.target, patched);
  const totalReplacements = applied.reduce((sum, row) => sum + row.hits, 0);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-settings-i18n",
    chunks: [{
      role: "settings-panel",
      path: "dist/renderer/assets/" + candidate.name,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
      pairsApplied: applied.length,
      totalReplacements,
    }],
    features: ["settings-panel-chinese"],
    transformations: ["settings-i18n-prelude-insertion", "settings-i18n-literal-branches"],
    gaps: SETTINGS_I18N_GAPS,
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-settings-i18n-extension.json");
  await writeFile(provenancePath, JSON.stringify(record, null, 2) + "\n");
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
