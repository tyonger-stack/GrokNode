# TokenHub 外部适配验收（2026-10-07）

依据：用户要求复制附件 GrokNode TokenHub 账户、API 地址、模型刷新、推理强度能力，并通过 API 地址实际测试；原 GrokNode 不改，默认模型为空。

| 验收 | 证据 |
| --- | --- |
| 原实现参考 | source/electron-preload/preload.ts 的 fetchEndpointModels/probeEffortSupport；source/shared/node/openrouter-proxy.ts 的推理档位和 none 策略，仅只读参考 |
| API 实际请求 | node-agent-tokenhub.test.mjs 使用本地真实 HTTP 测试服务，验证带密钥 /models、实际文本测试、连接成功后授权；错误密钥、拒绝参数、空响应均未登记成功 |
| 凭据 | API 不回显；磁盘密文不含 fixture secret；600 文件；不同 URL 不沿用旧密钥；错误消息脱敏 |
| 原生协议 | 真实安装的 opencodex Chat adapter → Responses SSE；函数调用与工具结果往返、随机 relay 鉴权 401 |
| 实际 Mac Harness | 私有固定版本 Codex 0.160.0 + 原 GrokNode 共享 Linux 执行端 + 本地模拟 Chat 上游；指定模型、密钥、low 档位确实到所选端点，turn completed |
| 网页 | 真实浏览器保存端点状态读取、模型拉取、支持档位、测试连接、授权当前模型均实际操作；连接与工具链状态分别标记 |
| 全部回归 | 99 项通过，0 失败，涵盖原模型、桌面、用户、配额、webhook 与新 TokenHub 测试 |
| 原服务更新 | 18770 当前地址为原 opencodex 127.0.0.1:10100/v1、协议 Responses、未保存第三方密钥；原 8 会话保留，服务默认仍 null |
| 原网页实际拉取 | 原 18770 从 opencodex 取得 54 个模型；测试下拉中禁用模型数为 0，gpt-6-luna 可选进行测试、未通过测试前不可授权；没有发送真实第三方推理 |

当前全局 Codex 在验收时已升为 0.160.1，固定版本检查阻止了初次启动；在项目 .lab 内单独安装 0.160.0 后验收通过，不改全局二进制。私有测试凭据与模拟端点不部署进原 18770 服务。

本轮没有用户提供的第三方模型 API 密钥，因此没有声称 Z.ai 或截图中其他远端模型服务已实测通过。测试脚本与原始请求观察保存于 .lab/tokenhub；返回图文、多媒体、平台托管工具与所有第三方模型能力仍须分别验证。
