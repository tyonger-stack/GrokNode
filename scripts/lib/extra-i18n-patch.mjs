import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Extra-surface runtime Chinese translation for the upstream 0.18 renderer.
//
// Evidence: same 0.58 sources as the Settings/main patches (eager-app EN
// catalog + five zh-CN locale chunks; per-pair 0.58 message IDs cited).
// Covers 14 lazy chunks: plugin marketplace, cloud-agent/PR views, email +
// slack composers, auto-review approval dialog, question dialog, connector
// status/auth cards, computer views, secrets save, hidden-bots, scroll pane,
// canvas code-copy. index-DwRDwDik.js is deliberately excluded: its catalog
// hits are syntax-grammar keyword lists, not UI copy.
//
// Each file entry carries discovery anchors (all must match exactly one stage
// file), its pair table with audited modes, and its gap list. Engine and
// runtime model are shared with the main patch; preludes are file-local.

export const EXTRA_I18N_FILES = [
  {
    file: "view-B5Ug8wEm.js",
    anchors: ["view-B5Ug8wEm"],
    pairs: [
      ["Accounts", "账户", "bPwFdf", "FULL"],
      ["Add", "添加", "m16xKo", "FULL"],
      ["Add a description first", "请先添加描述", "lz2dGc", "FULL"],
      ["Added manually", "手动添加", "hO1TWp", "FULL"],
      ["All", "全部", "N40H+G", "FULL"],
      ["All team members can view", "所有团队成员可查看", "Z8YJXX", "FULL"],
      ["Already authenticated", "已完成身份验证", "JYlWRx", "FULL"],
      ["Authenticate", "身份验证", "OX6vme", "FULL"],
      ["Authorize", "授权", "yIVrHZ", "FULL"],
      ["Cancel", "取消", "dEgA5A", "PROP"],
      ["Close", "关闭", "yz7wBu", "FULL"],
      ["Complete GitHub auth to sync installed plugins", "完成 GitHub 身份验证以同步已安装的插件", "NRJNSR", "FULL"],
      ["Confirm Remove", "确认移除", "tIBXVv", "FULL"],
      ["Created locally", "本地创建", "bA96vw", "FULL"],
      ["Default", "默认", "ovBPCi", "FULL"],
      ["Description", "描述", "Nu4oKW", "FULL"],
      ["Details", "详情", "URmyfc", "FULL"],
      ["Edit Values", "编辑值", "kDCdbL", "FULL"],
      ["Enable", "启用", "PaQ3df", "FULL"],
      ["Installed", "已安装", "eQkgKV", "FULL"],
      ["Instructions", "指令", "NxHkkp", "FULL"],
      ["It is how teammates know when to use this skill", "队友会据此了解何时使用这项技能", "cX+3Oq", "FULL"],
      ["Label this account, e.g. work or personal", "为此账户添加标签，例如“工作”或“个人”", "mwTfIH", "FULL"],
      ["Marketplace", "市场", "Zt5PUS", "FULL"],
      ["Name", "名称", "6YtxFj", "FULL"],
      ["New account label", "新账户标签", "R2hekE", "FULL"],
      ["No private skills yet. Ask your Bot to create one for you.", "还没有私有技能。让你的 Bot 为你创建一个吧。", "W0GRSo", "FULL"],
      ["No team is available to publish to.", "没有可发布到的团队。", "jqXlJu", "FULL"],
      ["Opened the OAuth flow in your browser. Return here once it completes.", "已在浏览器中打开 OAuth 流程。完成后请回到这里。", "Ea8un6", "FULL"],
      ["Plugin content needs GitHub authentication", "插件内容需要 GitHub 身份验证", "q0LYU5", "FULL"],
      ["Plugins", "插件", "ohUJJM", "FULL"],
      ["Private", "私密", "zwBp5t", "FULL"],
      ["Public", "公开", "7d1a0d", "FULL"],
      ["Publish", "发布", "EEYbdt", "FULL"],
      ["Publish to", "发布到", "VmT3pr", "FULL"],
      ["Published", "已发布", "u3wRF+", "FULL"],
      ["Pushes your latest edits to the team's copy", "将你的最新编辑推送到团队副本", "eFMPR0", "FULL"],
      ["Remove", "移除", "t/YqKh", "FULL"],
      ["Reopen", "重新打开", "M7SqjM", "FULL"],
      ["Required. Describe when to use this skill.", "必填。描述何时使用这项技能。", "5ijqLV", "FULL"],
      ["Retry", "重试", "6gRgw8", "FULL"],
      ["Save", "保存", "tfDRzk", "FULL"],
      ["Save Values", "保存值", "NQPY4Z", "FULL"],
      ["Search plugins", "搜索插件", "S4qZX0", "FULL"],
      ["Server is not configured", "服务器未配置", "E0z8bW", "FULL"],
      ["Setup", "配置", "RDjuBN", "FULL"],
      ["Setup Values", "配置值", "mrRDVU", "FULL"],
      ["Skill", "技能", "OZJeTZ", "FULL"],
      ["Skill publishing", "技能发布", "rYZrJD", "FULL"],
      ["Skills", "技能", "PCSkw2", "FULL"],
      ["Sync", "同步", "Nu4DdT", "FULL"],
      ["Team", "团队", "KM6m8p", "FULL"],
      ["The marketplace isn't available right now. Check back later.", "市场暂时不可用。请稍后再来看看。", "EuTQUZ", "FULL"],
      ["Type", "类型", "+zy2Nq", "FULL"],
      ["Uninstall", "卸载", "fo0VXg", "FULL"],
      ["Unpublish", "取消发布", "4DLZUa", "FULL"],
      ["Your team", "你的团队", "vhSOwR", "FULL"],
    ],
    gaps: [
      ["Copied", "zero-pattern-hit"],
      ["Copy link", "zero-pattern-hit"],
      ["Results", "zero-pattern-hit"],
      ["Shared with your team", "zero-pattern-hit"],
      ["Source", "zero-pattern-hit"],
      ["Sets up git credentials on Grok Bot's computer so installed plugins can be fetched.", "zero-pattern-hit"],
      ["Managed by Cursor", "zero-pattern-hit"],
      ["Copy failed", "zero-pattern-hit"],
      ["Add Another Account", "zero-pattern-hit"],
      ["Featured", "zero-pattern-hit"],
      ["View Source", "zero-pattern-hit"],
      ["Plugin Setup", "zero-pattern-hit"],
      ["URL", "identity-noop"],
      ["HTTP", "identity-noop"],
      ["Added by your team", "zero-pattern-hit"],
      ["Synced", "zero-pattern-hit"],
      ["Private skill", "zero-pattern-hit"],
      ["SSE", "identity-noop"],
      ["Transport", "zero-pattern-hit"],
      ["Added", "zero-pattern-hit"],
      ["Managed by your team", "zero-pattern-hit"],
      ["Command", "zero-pattern-hit"],
      ["Tools", "zero-pattern-hit"],
    ],
  },
  {
    file: "view-CizPQWLy.js",
    anchors: ["view-CizPQWLy"],
    pairs: [
      ["Creating", "创建中", "E9bKSA", "FULL"],
      ["Cursor cloud agent", "Cursor 云端智能体", "jozt9B", "FULL"],
      ["Done", "完成", "DPfwMq", "PROP"],
      ["Error", "错误", "SlfejT", "FULL"],
      ["Expired", "已过期", "M1RnFv", "FULL"],
      ["Open the pull request", "打开拉取请求", "mD5//r", "FULL"],
      ["Open this cloud agent in Cursor", "在 Cursor 中打开此云端智能体", "T1AZp3", "FULL"],
      ["Running", "运行中", "RiQMUh", "FULL"],
      ["Status unavailable", "状态不可用", "PS2Itk", "FULL"],
    ],
    gaps: [
      ["Open in Cursor", "zero-pattern-hit"],
      ["View PR", "zero-pattern-hit"],
    ],
  },
  {
    file: "view-ClhdNXKM.js",
    anchors: ["view-ClhdNXKM"],
    pairs: [
      ["Discard", "丢弃", "+zYUxF", "FULL"],
      ["From", "发件人", "ejVYRQ", "FULL"],
      ["Message", "消息", "xDAtGP", "FULL"],
      ["New email", "新邮件", "xqAzrN", "FULL"],
      ["Ready to send", "待发送", "zovxVp", "FULL"],
      ["Send email", "发送邮件", "65dxv8", "FULL"],
      ["Sent", "已发送", "h69WC6", "FULL"],
      ["Show less", "收起", "6lGV3K", "FULL"],
      ["Show more", "展开", "fMPkxb", "FULL"],
      ["Subject", "主题", "UJmAAK", "FULL"],
      ["To", "收件人", "/jQctM", "FULL"],
      ["Write a message", "输入消息", "eWlz27", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "view-DyaeCHiE.js",
    anchors: ["view-DyaeCHiE"],
    pairs: [
      ["Discard", "丢弃", "+zYUxF", "FULL"],
      ["Message", "消息", "xDAtGP", "FULL"],
      ["New message", "新消息", "mTBAsF", "FULL"],
      ["Ready to send", "待发送", "zovxVp", "FULL"],
      ["Send message", "发送消息", "pi1oME", "FULL"],
      ["Sent", "已发送", "h69WC6", "FULL"],
      ["Show less", "收起", "6lGV3K", "FULL"],
      ["Show more", "展开", "fMPkxb", "FULL"],
      ["Slack message", "Slack 消息", "bCu1pq", "FULL"],
      ["Thread", "线程", "e66y2Z", "FULL"],
      ["To", "收件人", "/jQctM", "FULL"],
      ["Workspace", "工作区", "pmUArF", "FULL"],
      ["Write a message", "输入消息", "eWlz27", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "view-QqBtBG74.js",
    anchors: ["view-QqBtBG74"],
    pairs: [
      ["Allow once", "允许一次", "pFfO26", "FULL"],
      ["Allowed once", "已允许一次", "gk2v4K", "FULL"],
      ["Always allow", "始终允许", "NoKBgy", "FULL"],
      ["Always allowed", "已设为始终允许", "gBhy/k", "FULL"],
      ["Denied", "已拒绝", "JsY1p5", "FULL"],
      ["Deny", "拒绝", "cFCKYZ", "FULL"],
      ["Expired", "已过期", "M1RnFv", "FULL"],
      ["Status unavailable", "状态不可用", "PS2Itk", "FULL"],
    ],
    gaps: [
      ["Auto-review approval", "zero-pattern-hit"],
      ["A rule always allowing this was added to your Auto-review settings", "zero-pattern-hit"],
      ["Run a command on your local computer", "zero-pattern-hit"],
      ["Run a command on Grok Bot's computer", "zero-pattern-hit"],
      ["Runs on Grok Bot's computer", "zero-pattern-hit"],
    ],
  },
  {
    file: "view-CIFdOvCz.js",
    anchors: ["view-CIFdOvCz"],
    pairs: [
      ["Custom answer", "自定义回答", "dN9Fia", "FULL"],
      ["Dismiss question", "忽略问题", "i+D6RG", "FULL"],
      ["Dismiss without answering", "不回答直接忽略", "ZNqNak", "FULL"],
      ["Dismissed", "已忽略", "J6hrEy", "FULL"],
      ["Selected", "已选择", "ylXj1N", "FULL"],
      ["Submit", "提交", "hQRttt", "FULL"],
      ["Type your own answer", "输入你自己的回答", "ovrcCJ", "FULL"],
    ],
    gaps: [
      ["Your answer", "zero-pattern-hit"],
    ],
  },
  {
    file: "view-3mdFcnEj.js",
    anchors: ["view-3mdFcnEj"],
    pairs: [
      ["Checking connection status", "正在检查连接状态", "QwpUXp", "FULL"],
      ["Connect", "连接", "iSLIjg", "FULL"],
      ["Connected", "已连接", "QHcLEN", "FULL"],
    ],
    gaps: [
      ["GitHub", "identity-noop"],
      ["Slack", "identity-noop"],
    ],
  },
  {
    file: "view-D0otXpJy.js",
    anchors: ["view-D0otXpJy"],
    pairs: [
      ["About", "关于", "uyJsf6", "FULL"],
      ["Close details", "关闭详情", "n5fb8M", "FULL"],
      ["Open chat", "打开聊天", "6I7cJR", "FULL"],
      ["Retry", "重试", "6gRgw8", "FULL"],
      ["Waiting for you", "等待你回复", "N6oHir", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "view-BKPMMMAd.js",
    anchors: ["view-BKPMMMAd"],
    pairs: [
      ["Answered", "已回答", "GqCA/t", "FULL"],
      ["Computer", "电脑", "9lzViG", "PROP"],
      ["Done", "完成", "DPfwMq", "PROP"],
      ["Skipped", "已跳过", "9NyAH9", "FULL"],
      ["Status unavailable", "状态不可用", "PS2Itk", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "view-HYU0bFxa.js",
    anchors: ["view-HYU0bFxa"],
    pairs: [
      ["Save securely", "安全保存", "fMfdG0", "FULL"],
      ["Saved", "已保存", "idD8Ev", "FULL"],
      ["Saved securely and kept private.", "已安全保存并保持私密。", "ekIGlI", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "view-Cbx1-ckK.js",
    anchors: ["view-Cbx1-ckK"],
    pairs: [
      ["Hidden Bots", "已隐藏的 Bot", "JuesWZ", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "connector-card-BOH-l7tH.js",
    anchors: ["Account label"],
    pairs: [
      ["Account label", "账户标签", "XHpefl", "FULL"],
      ["Add another account", "添加另一个账户", "O5JHbm", "FULL"],
      ["Added", "已添加", "hp8OtS", "FULL"],
      ["Authorization didn't finish. Click to retry.", "授权未完成。点击重试。", "0FVrvJ", "FULL"],
      ["Authorize", "授权", "yIVrHZ", "FULL"],
      ["Browse more", "浏览更多", "Lrv2Lo", "FULL"],
      ["Connected", "已连接", "QHcLEN", "FULL"],
      ["Reopen", "重新打开", "M7SqjM", "FULL"],
      ["Retry", "重试", "6gRgw8", "FULL"],
      ["Team", "团队", "KM6m8p", "FULL"],
    ],
    gaps: [
      ["Add", "zero-pattern-hit"],
      ["Manage", "zero-pattern-hit"],
    ],
  },
  {
    file: "scroll-pane-CvNuGyd2.js",
    anchors: ["headingId:c,onBack"],
    pairs: [
      ["Back", "返回", "iH8pgl", "FULL"],
    ],
    gaps: [
    ],
  },
  {
    file: "index-CTzZF058.js",
    anchors: ["canvases", "\"Copy code\""],
    pairs: [
      ["Copied", "已复制", "6V3Ea3", "FULL"],
      ["Copy code", "复制代码", "NmPNJJ", "FULL"],
    ],
    gaps: [
    ],
  },
];


const DISPLAY_PROPS = [
  "aria-label", "confirmLabel", "cancelLabel", "pendingLabel", "idleLabel",
  "submitLabel", "subtitle", "description", "children", "label", "title",
  "content", "placeholder", "text", "header", "caption", "message",
];

const NL = String.fromCharCode(10);

const RUNTIME_LINES = [
  'function RLocFromPref(pref){',
  'if(pref==="zh-CN")return "zh-CN";',
  'if(pref==="en")return "en";',
  'try{',
  'var tags=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];',
  'for(var i=0;i<tags.length;i++){var t=String(tags[i]||"").trim().toLowerCase();',
  'if(t==="zh"||t.indexOf("zh-")===0)return "zh-CN";',
  'if(t==="en"||t.indexOf("en-")===0)return "en";}',
  '}catch(_e){}',
  'return "en";}',
  'function RLocBoot(){try{var s=window.desktop&&window.desktop.language;var p=s&&s.initial&&s.initial.preference;return RLocFromPref(p);}catch(_e){}return "en";}',
  'function RLocT(en,zh){return RLocBoot()==="zh-CN"?zh:en;}',
  'try{(function(){var s=window.desktop&&window.desktop.language;if(!s||typeof s.onChanged!=="function")return;var boot=RLocBoot();s.onChanged(function(st){var loc=RLocFromPref(st&&st.preference);if(loc!==boot){try{location.reload();}catch(_e){}}});})();}catch(_e){}'
];

const RUNTIME_PRELUDE = NL + RUNTIME_LINES.join(NL) + NL;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isIdentifierChar(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$";
}

function replaceAllCounted(source, search, replacement) {
  const hits = source.split(search).length - 1;
  return { patched: source.split(search).join(replacement), hits };
}

function applyPair(source, en, zh, mode) {
  const search = JSON.stringify(en);
  const replacement = "(RLocT(" + JSON.stringify(en) + "," + JSON.stringify(zh) + "))";
  let patched = source;
  let hits = 0;
  const take = (result) => { patched = result.patched; hits += result.hits; };
  for (const prop of DISPLAY_PROPS) {
    if (mode === "PROP" || mode === "PROP_COLON" || mode === "FULL") {
      take(replaceAllCounted(patched, prop + ":" + search, prop + ":" + replacement));
    }
  }
  if (mode === "FULL") {
    take(replaceAllCounted(patched, "?" + search, "?" + replacement));
    take(replaceAllCounted(patched, "Error(" + search, "Error(" + replacement));
    take(replaceAllCounted(patched, "oTe(" + search, "oTe(" + replacement));
  }
  if (mode === "FULL" || mode === "PROP_COLON") {
    let cursor = 0;
    let out = "";
    let colonHits = 0;
    const needle = ":" + search;
    while (true) {
      const idx = patched.indexOf(needle, cursor);
      if (idx < 0) break;
      const prev = idx > 0 ? patched[idx - 1] : "";
      if (!isIdentifierChar(prev)) {
        out += patched.slice(cursor, idx) + ":" + replacement;
        colonHits += 1;
      } else {
        out += patched.slice(cursor, idx + needle.length);
      }
      cursor = idx + needle.length;
    }
    out += patched.slice(cursor);
    patched = out;
    hits += colonHits;
  }
  if (hits === 0) throw new Error("Extra i18n pair has no anchor in the renderer chunk: " + en);
  return { patched, hits };
}

export function patchExtraFile(source, entry) {
  let patched = source + RUNTIME_PRELUDE;
  const applied = [];
  for (const [en, zh, id, mode] of entry.pairs) {
    const result = applyPair(patched, en, zh, mode);
    patched = result.patched;
    applied.push({ en, id, mode, hits: result.hits });
  }
  return { patched, applied };
}

export async function applyOriginalRendererExtraI18n({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const names = await readdir(assetsRoot);
  const chunks = [];
  for (const entry of EXTRA_I18N_FILES) {
    // The entry name IS the target chunk's file name, but a minified chunk never contains its own
    // file name — only the chunk that imports it does. Matching on `anchors` alone therefore
    // selected the importer (index-*.js) and applied the pairs to the wrong file, which then failed
    // closed on the first pair whose copy lives in the real target (e.g. `children:"Accounts"` in
    // view-B5Ug8wEm.js). Resolve by file name first and keep the anchor scan as the fallback: both
    // paths still fail closed when the chunk is missing or ambiguous.
    const candidates = [];
    if (names.includes(entry.file)) {
      const target = path.join(assetsRoot, entry.file);
      candidates.push({ name: entry.file, target, source: await readFile(target, "utf8") });
    } else {
      for (const name of names) {
        if (!name.endsWith(".js")) continue;
        const target = path.join(assetsRoot, name);
        const source = await readFile(target, "utf8");
        if (entry.anchors.every((anchor) => source.includes(anchor))) {
          candidates.push({ name, target, source });
        }
      }
    }
    if (candidates.length !== 1) {
      throw new Error("Expected one chunk for extra-i18n entry " + entry.file + ", found " + candidates.length + ".");
    }
    const candidate = candidates[0];
    const { patched, applied } = patchExtraFile(candidate.source, entry);
    await writeFile(candidate.target, patched);
    chunks.push({
      role: "extra-surface",
      expectedFile: entry.file,
      path: "dist/renderer/assets/" + candidate.name,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
      pairsApplied: applied.length,
      totalReplacements: applied.reduce((sum, row) => sum + row.hits, 0),
    });
  }
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-extra-i18n",
    chunks,
    features: ["extra-surfaces-chinese"],
    transformations: ["extra-i18n-prelude-append", "extra-i18n-pattern-branches"],
    gaps: EXTRA_I18N_FILES.map((entry) => ({ file: entry.file, gaps: entry.gaps })),
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-extra-i18n-extension.json");
  await writeFile(provenancePath, JSON.stringify(record, null, 2) + NL);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
