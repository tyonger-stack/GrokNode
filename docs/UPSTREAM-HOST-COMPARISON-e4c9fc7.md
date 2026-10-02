# 上游 e4c9fc7 RPC 参数 schema 全表 + 客户端回归

基线：`universal@sha256:`… git-sha `e4c9fc7`（built 2026-10-01T05:06:46Z，`sand-box-latest` 当前值）  
本地：`host-gateway-api.ts`（`createHostGatewayApi` 返回的 gateway API map）  
oracle：并排容器 `grok-bot-local-vm`，gateway `127.0.0.1:1341`，跑上游自带 host + 真实 zod 校验

## 1. schema 校验行为（实测）

| 场景 | 上游 e4c9fc7 | 本地 12c7367 |
|---|---|---|
| 缺必填字段 | **400** + 精确字段路径 | 接受，透传给 handler |
| 类型错误 | **400** + `must be X, got Y` | 接受 |
| 多余未知字段 | **接受**（非 strict，静默丢弃） | 接受 |
| 方法不存在 | 404 `unknown gateway method` | 404 |

**结论：升级的风险面只有「缺必填」和「类型错」两类；多传字段是安全的。**

## 2. 空参全量探测（203 个方法）

| | 400 校验失败 | 200 通过 | 500 |
|---|---|---|---|
| 全部 203 | 166 | 34 | 3 |
| 共有 103 | 79 | 24 | 0 |
| 新增 100 | 87 | 10 | 3 |

500 的 3 个属上游自身问题（空参触发 handler 内部异常），非契约问题。

## 3. 客户端回归结论（共有方法 ∩ 上游必填 = 54 个）

| 类别 | 数量 | 含义 |
|---|---|---|
| ✅ 兼容 | 27 | handler 显式读取了全部上游必填字段 |
| ⚠️ 真缺口 | 6 | 上游必填、我们 handler 不消费 |
| ？ 透传 | 21 | 整体转发 `args`，静态不可判定 |

### 3.1 ⚠️ 真缺口（6 个）

| 方法 | 上游必填 | 我们读 | 丢弃 |
|---|---|---|---|
| `createAgent` | kind, scope | clientNonce | **kind, scope** |
| `createGroup` | kind, memberAgentIds, name, scope | description, memberAgentIds, name | **kind, scope** |
| `dismissWidget` | agentId, entryId | agentId | **entryId** |
| `getAgentTranscriptPage` | id, limit, untilMs | id | **limit, untilMs** |
| `getAgentTranscriptTail` | id, limit | id | **limit** |
| `getListenerConnectUrl` | oauthRedirectUri, platform | platform | **oauthRedirectUri** |

值得注意的两类：

- **`createAgent` / `createGroup` 缺 `kind` + `scope`** —— 上游给 agent/group 加了「种类与作用域」维度（对应新增的 `SAND_GATEWAY_*_SCOPE` / 云端 agent 体系），我们这版没有这个概念。**这不只是参数问题，是功能代差。**
- **`getAgentTranscriptPage` 缺 `limit` + `untilMs`、`getAgentTranscriptTail` 缺 `limit`** —— 上游改成了分页游标式取转录，我们这版只按 `id` 取整段。

### 3.2 ？ 透传 args（21 个，静态不可判定）

这些 handler 把整个 `args` 转发给下层（如 `readAttachmentChunk: (args) => method(attachments,'readChunk')(args)`），
静态看不到消费哪些字段。**要定论只能实测**：把真实 payload 分别打到 1340（本地）和 1341（上游）比对。

```
appendConnectorCard                必填: agentId, connector, variant
completeMcpOAuth                   必填: code, state
getAgentThread                     必填: id, rootId
getAgentTranscriptWindow           必填: id, limit
listBoxMcpServers                  必填: serverIdentifiers
openAgentTail                      必填: id, limit
openAgentWindowed                  必填: id, limit
promptAcceptanceStatus             必填: accountSlot, clientNonce
publishSkill                       必填: teamId, workflowId
readAttachmentChunk                必填: length, offset, path
readAttachmentImage                必填: path
readAttachmentText                 必填: path
requestWebAuthnCeremony            必填: kind, optionsJson, origin
resolveAutoReviewApproval          必填: agentId, entryId, requestId, resolution
resyncPublishedSkill               必填: workflowId
setAgentNotificationsEnabled       必填: id, isEnabled
setBoxSecrets                      必填: secrets
startTeachRecording                必填: agentId, entryPoint
stopTeachRecording                 必填: agentId, save
unpublishSkill                     必填: workflowId
uploadAttachment                   必填: bytesBase64, filename
```

## 4. 上游新增 100 个方法的参数 schema

标记说明：`?` = optional；`enum(a|b|c)` = 枚举；`object` / `object[]` 未展开。

### MCP / 插件（15）

| 方法 | 参数 |
|---|---|
| `authenticateMcpServer` | serverId: string, accountKey: ?string, trigger: ?rpcLiteral("connector_card"), forceReauth: ?boolean, requestingAgentId: ?string, oauthRedirectUri: rpcOauthRedirectUri |
| `getEffectiveMcpPlugins` | — |
| `getMcpCatalog` | — |
| `getMcpPluginLogo` | url: string |
| `getMcpState` | — |
| `installMcpEntry` | entryId: string, values: ?variableValueRecord, hasTeamConfiguredVariables: ?boolean |
| `listMcpServerTools` | <complex>:  serverId: rpcString()  |
| `readMcpAppResource` | serverIdentifier: string, resourceUri: string, agentId: ?string |
| `removeMcpAccount` | serverId: string, accountKey: string |
| `removeMcpServer` | <complex>:  serverId: rpcString()  |
| `renameMcpAccount` | serverId: string, accountKey: string, newAccountKey: string |
| `setMcpCustomInstructions` | serverId: string, instructions: string |
| `toggleMcpToolDisabled` | serverId: string, toolName: string |
| `uninstallMcpPlugin` | pluginId: string |
| `updateMcpPluginInstall` | pluginId: string, values: variableValueRecord |

### Bot 模板 / 云端发布（15）

| 方法 | 参数 |
|---|---|
| `carryBoxSecretsToBot` | serverId: string, names: string[] |
| `confirmCloudAgentPublishProposal` | agentId: string, bcId: string, proposalId: string, slug: string, visibility: ?cloudAgentPublishVisibility, requireConfirmationForUpdates: ?boolean |
| `deleteBotTemplate` | shareId: string |
| `dismissCloudAgentPublishProposal` | agentId: string, bcId: string, proposalId: string |
| `ensureCloudAgentArtifacts` | agentId: string, bcId: string |
| `getBotTemplateExportPolicy` | — |
| `getBotTemplateForSourceAgent` | sourceAgentId: string |
| `getBotTemplateVersion` | shareId: string, version: number |
| `getCloudAgentConversation` | bcId: string |
| `getCloudAgentPublishProposals` | bcId: string |
| `listBotTemplates` | — |
| `publishBotTemplate` | shareId: string, version: number |
| `setBotTemplateVisibility` | shareId: string, visibility: union |
| `stopCloudAgent` | bcId: string |
| `updateCloudAgentPublishApp` | bcId: string, slug: string, apex: string, visibility: ?cloudAgentPublishVisibility, muteRedeployPrompts: ?boolean, requireConfirmationForUpdates: ?boolean |

### 凭据 / 浏览器自动化（11）

| 方法 | 参数 |
|---|---|
| `acquireCredentialFillAgentHold` | holdId: string, toolName: string, windowIndex: ?number, waitMs: ?number, ttlMs: ?number |
| `awaitBrokeredCredentialAccessRequest` | agentId: string, accessRequestId: string, deadlineMs: number, entries: ?object[], entryId: string, website: string, reason: string |
| `createBrokeredCredentialAccessRequest` | agentId: string, goal: string, logins: object[], website: string, reason: string, keywords: ?string[], windowIndex: ?number |
| `deliverBrokeredCredentialSession` | connectionId: string, accessToken: string, integrationKey: string, accessTokenExpiresAtMs: number, grants: ?object[], entryId: string, reference: string, website: string, grantedAtMs: number |
| `exportGrokBotWorkingState` | agentId: string, maxClosureBytes: ?number, maxClosureBlobs: ?number, readBatchBlobs: ?number, putConcurrency: ?number, expectedServerId: ?string, trigger: ?workingStateExportTrigger |
| `fillBrokeredCredential` | agentId: string, entryId: string, siteHint: ?string, windowIndex: ?number |
| `fillBrowserCredential` | entryId: string, agentId: string, approvalMode: ?credentialApprovalMode, username: ?string, password: string, oneTimeCode: ?string, oneTimeCodeTicket: ?string, passwordStepTicket: ?string |
| `fillBrowserCredentialDirect` | agentId: ?string, item: object, targetSite: string, targetWebSocketDebuggerUrl: ?string, approvalMode: ?credentialApprovalMode, username: ?string, password: string, oneTimeCode: ?string, oneTimeCodeTicket: ?string, passwordStepTicket: ?string |
| `fillBrowserOneTimeCode` | item: object, targetSite: string, targetWebSocketDebuggerUrl: string, oneTimeCode: string |
| `fillBrowserPasswordStep` | item: object, targetSite: string, targetWebSocketDebuggerUrl: string, approvalMode: credentialApprovalMode, username: ?string, password: string, oneTimeCode: ?string, oneTimeCodeTicket: ?string |
| `getBrokeredCredentialStatus` | — |

### 语音通话（7）

| 方法 | 参数 |
|---|---|
| `getVoiceCall` | id: string, callId: string |
| `nudgeVoiceCall` | id: string, callId: string, request: string, spokenTurns: string[] |
| `previewVoice` | voiceId: string, greetingId: string |
| `readVoiceCallSentMessages` | <complex>:  id: rpcString()  |
| `recordVoiceCall` | record: object |
| `setAgentVoice` | id: string, voiceId: ?rpcNullable(rpcString()), voiceSpeed: ?number, voiceLanguage: ?string |
| `setVoiceCallPresence` | id: string, callId: string, isOnTheLine: boolean, acceptsOverheard: ?boolean |

### 草稿 / 用户表单（5）

| 方法 | 参数 |
|---|---|
| `discardDraft` | entryId: string, agentId: string, sessionId: ?string |
| `dismissUserForm` | entryId: string, mode: enum(dismissed|escalated), agentId: string, platform: ?clientPlatform |
| `sendDraft` | entryId: string, draft: draftPayload, agentId: string, sessionId: ?string |
| `setAgentDraftingDisabled` | id: string, isDisabled: boolean |
| `submitUserForm` | entryId: string, values: stringRecord, agentId: string, platform: ?clientPlatform |

### Cookie / WebAuthn（5）

| 方法 | 参数 |
|---|---|
| `awaitCookieOriginApproval` | requestId: string, waitMs: number |
| `cancelCookieOriginApproval` | requestId: string |
| `injectChromeCookies` | cookies: object[] |
| `requestCookieOriginApproval` | requestId: string, origins: cookieOriginRequestEntry[], agentId: ?string |
| `resolveVirtualCardApproval` | entryId: string, requestId: string, resolution: enum(approved|denied|failed|expired), agentId: string, spendRequestId: ?string, failureReason: ?string, paymentMethodId: ?string, attestation: ?object |

### 授权授予（6）

| 方法 | 参数 |
|---|---|
| `awaitMessagesGrants` | requestId: string, waitMs: number |
| `cancelMessagesGrants` | requestId: string |
| `requestMessagesGrants` | requestId: string, grants: union[] |
| `resolveConnectorGrant` | <complex>: connectorGrantArgs |
| `resolveMessagesGrants` | requestId: string |
| `storeSecret` | target: rpcUnion( rpcObject({ kind: rpcLiteral("box-env"), name: rpc, kind: rpcLiteral("channel-credential"), name: string, platform: string, field: string, value: string, agentId: string |

### 任务 / 附件 / 转录（5）

| 方法 | 参数 |
|---|---|
| `getAgentTasks` | agentId: string |
| `getAgentTodos` | <complex>:  id: rpcString()  |
| `markAgentTaskRead` | agentId: string, taskId: string, entryId: string |
| `transcribeAudio` | audioBase64: nonEmptyAudioBase64, mimeType: string, language: ?string |
| `uploadAttachmentChunk` | agentId: ?string, uploadId: string, filename: string, offset: number, totalSize: number, bytesBase64: string |

### 房间 / 成员（5）

| 方法 | 参数 |
|---|---|
| `cancelRoomMemberTurn` | nonce: string, reason: string |
| `clearGeneratedRoomNameStamps` | rooms: object[], id: string, generatedName: string |
| `deliverAgentMessage` | messageId: string, from: object, id: string, name: string, toAgentId: string, text: string |
| `deliverRoomMemberTurnResult` | roomId: string, nonce: string, memberAgentId: string, outcome: union, messages: string[], posts: ?object[], text: string, messageJson: ?string, error: ?string |
| `runRoomMemberTurn` | nonce: string, room: object, id: string, name: string, description: string, memberAgentId: string, peers: object[], newMessages: object[], isWindingDown: boolean, deadlineMs: number, parentRequestId: ?string, rootParentRequestId: ?string, attachments: ?object[], path: string, isAttachmentOnlyTurn: ?boolean, hiddenPrompt: ?string |

### 其他（10）

| 方法 | 参数 |
|---|---|
| `awaitBoxSecretsApplied` | — |
| `completeGithubConnect` | state: string, code: ?string, installationId: ?string, setupAction: ?string, error: ?string |
| `disconnectListenerPlatform` | platform: string |
| `generateAgentAvatarImage` | description: string |
| `getAgentNotificationAvatar` | <complex>:  id: rpcString()  |
| `getHarnessMigrationWindow` | — |
| `interruptAgentRun` | id: string, sessionId: ?string |
| `readMainAgentContext` | <complex>:  id: rpcString()  |
| `seedConversationName` | id: string, prompt: string |
| `voteFeedback` | agentId: string, entryId: string, action: union, categories: ?string[], comment: ?string |

### 未归类（16）

| 方法 | 参数 |
|---|---|
| `assignAgentToSidebarSection` | agentId: string, sectionId: string |
| `createAgentFromTemplate` | shareId: string, agentId: string, name: string, avatarShape: string, avatarColor: string, expectedActiveVersion: number, creatorContext: ?string, language: ?string, isAutomatic: ?boolean |
| `getNavigationTelemetryIdentity` | — |
| `getOpenCredentialRequest` | entryId: string, agentId: string |
| `getPauseState` | — |
| `listPromotableRooms` | — |
| `listSidebarSections` | — |
| `markAgentRequestEnded` | requestId: string |
| `markAgentRequestStarted` | requestId: string |
| `readVoiceCallAgentContext` | id: string |
| `reconcileAgentIdentity` | — |
| `releaseCredentialFillAgentHold` | holdId: string |
| `resolveCredentialBrowserTarget` | agentId: ?string, item: object, siteHint: string |
| `resolveCredentialRequest` | entryId: string, agentId: string, resolution: enum(denied|failed), detail: ?string |
| `setHttpProxyName` | name: rpcNullable(rpcString()) |
| `syncUserSecrets` | revision: string, generation: ?number, secrets: ?rpcRecord(rpcString()) |

## 5. 机器可读数据

结构化版本（供脚本消费）：

- `schemas_norm.json` — 203 个方法 → `{kind, args原文, 字段:类型}`
- `regression.json` / `final_regression.json` — 回归分类
- `probe_empty.json` — 203 个方法空参探测原始响应

原始数据在 `~/Documents/grokbot/.scratch-ecr/`。

