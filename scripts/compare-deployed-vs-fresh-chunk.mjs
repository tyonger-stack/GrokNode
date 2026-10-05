// 对比「部署版」与「新包」里 D17 所用官方配方的存在性。
//
// ⚠️ 这脚本的第一版遍历是错的：`if(k&&typeof k==="object"){...return;}` 之后又落回
//    叶子分支，导致同一节点被数两次（renderer js 报成 482，实际 101），并连带让我
//    误判「部署版里没有 index-UbX-y3il.js、部署版被换掉了」。**部署版其实一直在。**
//    判据：自己数出来的文件数必须和另一个独立来源一致，否则结论作废。
import { readFileSync } from "node:fs";

function readChunk(asarPath, chunkPath) {
  const b = readFileSync(asarPath);
  const dataStart = 8 + b.readUInt32LE(4);
  const jsonLen = b.readUInt32LE(12);
  const h = JSON.parse(b.subarray(16, 16 + jsonLen).toString("utf8"));
  let n = h;
  for (const seg of chunkPath.split("/")) {
    if (!n.files || !n.files[seg]) return null;
    n = n.files[seg];
  }
  if (n.offset === undefined) return null;
  const at = Number(BigInt(dataStart) + BigInt(n.offset));
  return b.subarray(at, at + n.size).toString("utf8");
}

/** 列出某 asar 里 packed 的 renderer chunk 数 —— 用作遍历自检。 */
function countRendererChunks(asarPath) {
  const b = readFileSync(asarPath);
  const jsonLen = b.readUInt32LE(12);
  const h = JSON.parse(b.subarray(16, 16 + jsonLen).toString("utf8"));
  const out = [];
  const walk = (node, prefix) => {
    if (!node) return;
    const kids = node.files;
    if (kids && typeof kids === "object") {
      for (const k of Object.keys(kids)) walk(kids[k], prefix ? `${prefix}/${k}` : k);
      return; // ← 目录节点到此为止，不再落进叶子分支
    }
    if (prefix && prefix.startsWith("dist/renderer/assets/") && prefix.endsWith(".js") && node.offset !== undefined) {
      out.push(prefix);
    }
  };
  walk(h, "");
  return out;
}

const DEPLOYED = "/Applications/Grok Node.app/Contents/Resources/app.asar";
const FRESH = "dist/Grok Node.app/Contents/Resources/app.asar";
const CHUNK = "dist/renderer/assets/index-UbX-y3il.js";

// 自检：两份都必须是 101 个 chunk，且都含目标 chunk。不满足就不往下走。
const dCount = countRendererChunks(DEPLOYED);
const fCount = countRendererChunks(FRESH);
console.log(`部署版 renderer chunk: ${dCount.length} | 新包: ${fCount.length}`);
if (dCount.length !== 101 || fCount.length !== 101) {
  console.log("❌ 遍历自检失败（期望各 101）—— 下面的结论一律不作数");
  process.exit(1);
}
if (!dCount.some((p) => p.endsWith("index-UbX-y3il.js"))) {
  console.log("❌ 部署版缺目标 chunk —— 结论作废");
  process.exit(1);
}
console.log("✅ 遍历自检通过\n");

const off = readChunk(DEPLOYED, CHUNK);
const stg = readChunk(FRESH, CHUNK);
if (off == null || stg == null) {
  console.log("❌ 读不到目标 chunk");
  process.exit(1);
}
console.log(`部署版 chunk ${off.length} B | 新包 chunk ${stg.length} B\n`);

const RECIPES = {
  "FORM_SLOT (DETAIL_ACCOUNT_FORM_SLOT_CLASSES)": [
    "sand-1qughib", "sand-167g77z", "sand-z9dl7a", "sand-sag5q8",
  ],
  "FORM_INPUT (DETAIL_ACCOUNT_FORM_INPUT_CLASSES)": [
    "sand-5f5z56", "sand-193iq5w", "sand-1717udv", "sand-c342km",
    "sand-11wthnw", "sand-d4r4e8", "sand-12oo3zp", "sand-1t137rt",
  ],
  "SAVE (DETAIL_ACCOUNT_SAVE_CLASSES)": [
    "sand-1c4vz4f", "sand-2lah0s", "sand-1717udv", "sand-4b2ntj",
    "sand-7gh5u8", "sand-1ypdohk",
  ],
};

for (const [name, classes] of Object.entries(RECIPES)) {
  const missOff = classes.filter((c) => !off.includes(c));
  const missStg = classes.filter((c) => !stg.includes(c));
  console.log(`=== ${name} ===`);
  console.log(`  部署版缺: ${missOff.length ? missOff.join(", ") : "无"}`);
  console.log(`  新包缺  : ${missStg.length ? missStg.join(", ") : "无"}`);
}

// D17 特征串只应出现在新包里
console.log("\n=== D17 特征串 ===");
for (const needle of ["\\u65B0\\u8D26\\u6237\\u6807\\u7B7E", "account-edit-form"]) {
  const c = (s) => (s.split(needle).length - 1);
  console.log(`  ${needle}: 部署版 ${c(off)} 次 | 新包 ${c(stg)} 次`);
}
