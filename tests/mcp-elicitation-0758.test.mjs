import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalAutoReviewApproval } from "../scripts/lib/auto-review-renderer-patch.mjs";
import { EXTRA_I18N_FILES, patchExtraFile } from "../scripts/lib/extra-i18n-patch.mjs";
import {
  MCP_ELICITATION_STRINGS,
  MCP_ELICITATION_ANCHORS,
  OFFICIAL_EVIDENCE,
  mcpElicitationShouldCollapse,
  patchOriginalMcpElicitation0758,
  patchOriginalMcpElicitationDisclosureShell,
  projectMcpElicitationSummaryCopy,
} from "../scripts/lib/mcp-elicitation-0758-patch.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(repoRoot, "src/app/dist/renderer/assets/view-QqBtBG74.js");
const shellPath = path.join(repoRoot, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const bundle = await readFile(bundlePath, "utf8").catch(() => null);
const shell = await readFile(shellPath, "utf8").catch(() => null);
const bundleSkip = bundle == null || shell == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; pinned-bundle assertions skipped."
  : false;

function syntheticSource() {
  return [
    MCP_ELICITATION_ANCHORS.importBefore,
    "function RLocT(en,zh){return en}",
    "function RArSum(value){return value}",
    "function RArRuleNotice(value){return value}",
    "function me(t){const e=P.c(43);const m=I,v=a.command??RArSum(a.summary);let c,w,d,_;return null}",
  ].join("\n");
}

function functionSource(source, name) {
  const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find((item) => item.type === "FunctionDeclaration" && item.id.name === name);
  assert.ok(node, name + " must be a function declaration");
  return source.slice(node.start, node.end);
}

test("official 0.75.8 evidence pins and byte strings are retained", () => {
  assert.equal(OFFICIAL_EVIDENCE.minifiedBytes, 21368);
  assert.equal(OFFICIAL_EVIDENCE.minifiedSha256, "24f495f64fbe3d61e68451cab829f89732c3ed868b5b7859de22efffde1aee25");
  assert.equal(OFFICIAL_EVIDENCE.readableBytes, 29518);
  assert.equal(OFFICIAL_EVIDENCE.readableSha256, "1966261d22e996677be6e9fe363cb5e83e1ade6980a97af9e0688aa667ec7b2e");
  assert.deepEqual(
    MCP_ELICITATION_STRINGS.map(([en, zh, id]) => [en, zh, id]),
    [
      ["Allowed", "已允许", "joLIQz"],
      ["Denied", "已拒绝", "JsY1p5"],
      ["Expired", "已过期", "M1RnFv"],
      ["While running {toolName}", "运行 {toolName} 时", "6+2WKR"],
      ["View the full request", "查看完整请求", "5+TRII"],
      ["{connector} needs your confirmation", "{connector} 需要你确认", "HB0Zic"],
      ["Allow", "允许", "h7peZQ"],
      ["Deny", "拒绝", "cFCKYZ"],
      ["Your answer didn't go through. Check your connection and try again.", "你的回答未发送成功。请检查网络连接后重试。", "sSMHtl"],
    ],
  );
});

test("elicitation projection accepts an empty message and omits empty optional strings", () => {
  const summaryCopy = {
    kind: "mcp_elicitation",
    params: { message: "", serverDisplayName: "", toolName: "" },
  };
  assert.deepEqual(projectMcpElicitationSummaryCopy(summaryCopy), {
    kind: "mcp_elicitation",
    params: { message: "" },
  });
  assert.deepEqual(projectMcpElicitationSummaryCopy({
    kind: "mcp_elicitation",
    params: { message: "Continue?", serverDisplayName: "Calendar", toolName: "create_event" },
  }), {
    kind: "mcp_elicitation",
    params: { message: "Continue?", serverDisplayName: "Calendar", toolName: "create_event" },
  });
  assert.equal(projectMcpElicitationSummaryCopy({ kind: "mcp_elicitation", params: {} }), undefined);
  assert.equal(projectMcpElicitationSummaryCopy({ kind: "mcp", params: { message: "Continue?" } }), undefined);
});

test("official truncation boundaries are exactly 600 characters and 8 LF-delimited lines", () => {
  assert.equal(mcpElicitationShouldCollapse("a".repeat(600)), false);
  assert.equal(mcpElicitationShouldCollapse("a".repeat(601)), true);
  assert.equal(mcpElicitationShouldCollapse("a\n".repeat(7) + "a"), false);
  assert.equal(mcpElicitationShouldCollapse("a\n".repeat(8) + "a"), true);
  assert.equal(mcpElicitationShouldCollapse("a\r\n".repeat(7) + "a"), false, "CRLF is not normalized");
  assert.equal(mcpElicitationShouldCollapse("a\r\n".repeat(8) + "a"), true, "CRLF is not normalized");
  assert.equal(mcpElicitationShouldCollapse(null), false);
});

test("renderer patch injects the official surface with only Allow and Deny", () => {
  const patched = patchOriginalMcpElicitation0758(syntheticSource());
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RMcpElicitation0758(").length - 1, 1);
  assert.match(patched, /a\.summaryCopy\?\.kind==="mcp_elicitation"/);
  assert.match(patched, /function RMcpSummaryParams\(copy\)/);
  assert.match(patched, /RMcpLoc\("Allow","允许"\)/);
  assert.match(patched, /RMcpLoc\("Deny","拒绝"\)/);
  assert.match(patched, /message\.length>600\|\|message\.split\("\\n"\)\.length>8/);
  assert.match(patched, /isDetailCollapsed:!0/);
  assert.match(patched, /level:"body2",className:/);
  assert.match(patched, /n as RMcpText/);
  assert.match(patched, /C\.jsx\(RArIcon,\{name:"plug"\}\)/);
  assert.doesNotMatch(patched, /C\.jsx\(X,\{name:"plug"\}\)/);
  assert.match(patched, /C\.jsxs\(C\.Fragment,\{children:\[messageNode,toolNode\]\}\)/);
  assert.match(patched, /WebkitLineClamp:8,lineClamp:8/);
  assert.match(patched, /borderColor:"var\(--sand-border-default\)"/);
  const component = functionSource(patched, "RMcpElicitation0758");
  assert.doesNotMatch(component, /Always allow|Always Allow|Custom Rule|Custom rules/);
  assert.doesNotMatch(component, /onDisclosureToggle/);
  assert.doesNotMatch(patched, /elicitation\/create|window\.desktop\.invoke/);
  assert.throws(() => patchOriginalMcpElicitation0758(patched), /already applied/);
});

test("disclosure shell uses the supplied official label and preserves the stock fallback", () => {
  const source = 'function demo(J,u){return p.jsxs("button",{children:[p.jsx("span",{' + MCP_ELICITATION_ANCHORS.shellDisclosureBefore + ");}";
  const patched = patchOriginalMcpElicitationDisclosureShell(source);
  assert.ok(patched.includes(MCP_ELICITATION_ANCHORS.shellDisclosureAfter));
  assert.match(patched, /u\.label\?\?/);
  assert.match(patched, /Hide the/);
  assert.match(patched, /Show the/);
  assert.throws(() => patchOriginalMcpElicitationDisclosureShell(patched), /already applied/);
});

test("pinned 0.18 chunks accept the renderer and disclosure patches exactly once", { skip: bundleSkip }, () => {
  const i18nEntry = EXTRA_I18N_FILES.find((entry) => entry.file === "view-QqBtBG74.js");
  assert.ok(i18nEntry, "the pinned target chunk has an extra-i18n entry");
  const viewPatched = patchOriginalMcpElicitation0758(
    patchExtraFile(patchOriginalAutoReviewApproval(bundle), i18nEntry).patched,
  );
  const shellPatched = patchOriginalMcpElicitationDisclosureShell(shell);
  assert.equal(viewPatched.split("function RMcpElicitation0758(").length - 1, 1);
  assert.equal(shellPatched.split("u.label??").length - 1, 1);
  assert.doesNotThrow(() => parse(viewPatched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.doesNotThrow(() => parse(shellPatched, { ecmaVersion: "latest", sourceType: "module" }));
});

test("clean build runs elicitation after both i18n passes and before message-copy", async () => {
  const source = await readFile(path.join(repoRoot, "scripts/clean-build.mjs"), "utf8");
  const importAt = source.indexOf('import { applyMcpElicitation0758Patch } from "./lib/mcp-elicitation-0758-patch.mjs";');
  const mainI18nAt = source.indexOf("await applyOriginalRendererMainI18n({ stageRoot });");
  const extraI18nAt = source.indexOf("await applyOriginalRendererExtraI18n({ stageRoot });");
  const elicitationAt = source.indexOf("await applyMcpElicitation0758Patch({ stageRoot });");
  const messageCopyAt = source.indexOf("await applyMessageCopy0753Patch({ stageRoot });");
  assert.ok(importAt >= 0);
  assert.ok(mainI18nAt >= 0 && extraI18nAt > mainI18nAt);
  assert.ok(elicitationAt > extraI18nAt && messageCopyAt > elicitationAt);
});
