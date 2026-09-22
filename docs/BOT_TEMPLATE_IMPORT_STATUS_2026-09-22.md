# Bot template import status — 2026-09-22

Current local changes are a preview foundation, not a complete five-section importer.

## Verified inputs

- Share URL: https://x.ai/bot/_jOdbfkB16zxu7MRcmReE
- Its HTML / Next Flight data contains id, botName, description, sharerName (null), color and shape. The description has 392 characters; OpenGraph truncates it.
- Official download endpoint observed from x.ai's public page redirects to Grok Bot 0.57.1 on this date. It was mounted read-only for protocol inspection; it is not a replacement build input.
- The desktop import path calls aiserver.v1.GrokBotService/GetGrokBotTemplateImportDetails with shareId. The response supplies template metadata, expectedActiveVersion, creatorDisplayName and blobGetUrl.
- The blob is a JSON recipe containing profile, memory, skills, routines, plugins, and optional gettingStarted. Instructions are recipe.profile.description, separate from the share summary.
- An unauthenticated JSON request to that exact endpoint returned HTTP 401, code unauthenticated. No credential was read or supplied.

## Current source behavior

The packaged renderer now has a real template preview dialog, using a narrowly scoped bridge and the existing trusted Main RPC. No Bot is created on opening or closing the preview. The preview supports the five detail tabs. The source currently shows that full details have not loaded and disables import when only the share summary is available. This final status correction has not yet been redeployed.

A recipe parser validates and retains all five sections and rejects a summary masquerading as a complete recipe. Download authorization and applying memory/skills/routines/plugin references to the local host remain unfinished, pending the user's choice of optional official authorization versus exported template files. Do not describe the feature as complete or treat absence from HTML as absence from the template. Do not hardcode data from screenshots.

## Approval bug evidence

Actual agent transcripts recorded: request_smart_mode_approval: Expected boolean, received string. The shell execution boundary now accepts only the exact strings true/false in addition to booleans; the model-facing schema remains boolean. An approval request still requires the user's decision. Five regression scenarios exercised both box and host shell paths, approval and denial, and rejection of other input types.

A live dedicated test conversation (审批回归测试) showed an approval card for pwd. Its recorded status became approved, then the agent reported /workspace and exit code 0. The existing 飞书管家 conversation also displayed Allowed once and a subsequent pending approval. No standing permission or Auto-review setting was disabled by this task.

## Build and workspace

The first candidate built, passed package signature/provenance verification, and was copied to /Applications/Grok Node.app. It contains the preliminary summary-only preview and the shell approval fix. It is not the final full-template implementation.

Another task was concurrently editing HTTP MCP support. Preserve those files and do not include them in this task's commits. Before final packaging, reconcile that work or build this task's recorded revision in isolation. All Git operations are local from the workspace root; no push was performed.
