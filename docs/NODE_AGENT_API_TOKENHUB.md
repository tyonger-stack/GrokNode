# TokenHub 账户、端点与模型

更新：2026-10-07。本页与本分支的 TokenHub 实现和 OpenAPI 同步，完整接口见 [主手册](NODE_AGENT_API_0_3.md)。

Node Agent API 参考 GrokNode 本地实现的 fetchEndpointModels、probeEffortSupport 与 openrouter-proxy 的推理强度处理，提供独立的账户和 API 端点设置。没有修改原 GrokNode 程序、登录、凭据、bot 管理或盒子。

## 网页操作

1. 用 Node Agent API 访问密钥连接工作台，以 owner 身份展开“管理员模型设置”。
2. 点击“TokenHub 账户与端点”。API 地址填模型 API 根地址，例如 `https://api.z.ai/api/coding/paas/v4`，协议选 Chat Completions；opencodex 通常选 Responses。
3. 保存地址后输入该模型服务的 API 密钥，点击保存。换到不同地址会清除当前密钥引用，避免误发送旧服务的凭据。
4. 点击“重新拉取”：服务端在 Mac 请求 `{API地址}/models`，网页只收到模型与能力列表。
5. 从模型下拉选择任何已拉取模型。推理强度显示目录已知或实测通过的档位；未知档位可以在测试输入框单独验证。空档位表示端点默认，不发送推理字段。
6. 点击“测试连接”：向 `/chat/completions` 或 `/responses` 发起一个最多 64 输出 token 的真实文本请求。会消耗上游额度；失败、空文本、非 2xx 不会登记成功。
7. 成功后显示“连接已验证”，点击“授权当前模型”。新会话可选该模型；服务默认仍保持原设置，包括 null。

“灰色”现在表示当前端点尚未完成连接测试或工具链验收，不是该模型不可用。所有已拉取模型都能在 TokenHub 测试下拉中选择。连接成功只证明 API 和所选参数能返回文本，不冒充改文件、测试、审批、取消全链路验收；管理员可另登记实际工具链证据。

## 密钥与会话边界

模型密钥通过 AES-256-GCM 加密存于 Mac 的 API state/tokenhub.json；加密密钥在同目录 tokenhub.master.key，目录 700、文件 600。网页只能看到 key_saved，不会回显；密钥不会进入 Linux 执行进程。该加密保护文件静态内容，不是防御同一 Mac 用户同时读取两个文件的安全边界。原 ChatGPT/opencodex/GrokNode 密钥不自动复制到 TokenHub。

改变 API 地址、协议或密钥建立一个新的端点版本，连接测试记录重新开始。旧版本保留，已有会话继续使用创建时的端点版本、模型和推理强度，直到管理员另行处置这些历史凭据；不静默把旧会话转到另一个模型服务。

管理员设置服务和 bot 默认；普通用户只在获准范围内创建会话，不可管理端点和密钥。无需把 gpt-6.1-sol 设为默认。直接创建新会话时可带 `reasoning_effort`，只接受目录广告或当前端点实测通过的值。

## 协议适配与依赖

Codex 0.160 使用 Responses。Mac 本地 TokenHub relay 复用已安装 `@bitkyc08/opencodex` 的 Chat adapter、Responses parser 与 SSE bridge，转发文本、推理、函数调用与工具结果；Codex Harness 仍管理模型回合、工具循环、审批与取消。连接 TokenHub 不替换 GrokNode 的模型循环。

TokenHub relay 需要 Bun 与 opencodex 安装，当前验收为 Bun 1.4.2、opencodex 2.78.0。默认读取 `~/.bun/bin/bun` 和 `~/.npm-global/lib/node_modules/@bitkyc08/opencodex`；未安装时返回明确的适配器不可用错误。CI 在隔离 runner 安装这两个固定版本，真实流式函数调用/工具结果回归不跳过。该依赖只用于 API 协议适配，不改变原 GrokNode 程序或当前 Mac 的全局版本。

relay 只监听 127.0.0.1，具有随机 capability token，真实模型密钥通过私有 stdin 输入。版本变动后应重跑 tokenhub 回归。原 Codex 0.160.0 严格检查保留；API 启动支持 `--codex-bin` 指定固定版本，本机全局更新不自动改变项目支持范围。

无思考按 GrokNode 已有契约处理：Flash 模型发送 low；MiniMax M3 发送 thinking.type=disabled；其他未知 Chat 模型拒绝猜测关闭思考的参数，使用端点默认或单独支持的档位。HTTPS 与本机 HTTP 根地址可保存，禁止 URL 内的凭据、query、fragment；不跟随 HTTP 重定向。图片、音频、托管搜索及完整第三方协议兼容性没有通过本轮验收，不声称全部支持。

## API

| 方法与路径 | owner 操作 |
| --- | --- |
| GET /v1/settings/tokenhub | 地址、协议、key_saved、模型与测试记录；无密钥 |
| PATCH /v1/settings/tokenhub | base_url / wire_api(chat 或 responses) / api_key(write-only)；建立新版本 |
| POST /v1/settings/tokenhub/models | 从当前端点实际拉取模型 |
| POST /v1/settings/tokenhub/test | {model,reasoning_effort:null或字符串}；只有成功文本响应才通过 |

设置与测试参数的完整 schema 见 [OpenAPI](../tools/node-agent-api/openapi.json)。[验收记录](node-agent-api-0-3-verify/10-tokenhub.md)区分本地模拟上游、真实 Harness 和尚未提供凭据的第三方服务。
