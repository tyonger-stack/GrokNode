# Feature：本地 computer use（sand_enable_local_cua）移植

Playbook 步骤（verbatim）：
- [x] how over the affected subsystem.（sidecar=MCP stdio helper；desktop admin 通道=service.json+unix socket；daemon=per-conversation 会话+14 工具表；host=local-exec bridge/userComputers 缝隙；0.18 基线通道俱在）
- [ ] architect for parallel design exploration.（单 owner 串行，见 checkpoint 第 4 条）
- [x] Write the throughput checkpoint as four todo items.（见下）
- [ ] Delegate code-writing to a subagent.（配额受限，主会话自持 diff，评审分离由独立测试与证据承担）
- [ ] Verify on the matching surface.
- [ ] Rebase into small, ordered commits.
- [ ] If the design is contested, interrogate before shipping. skip: 用户已明确拍板必做
- [ ] Run Opening a PR.（本仓库惯例为工作树交付+用户验收，无 PR 流程）

## Throughput checkpoint

- **Blocking first steps**：U1 sidecar 供应（提取+签名保持+打包）先行，验证官方签名 helper 能原样进包并被 execFile；U2 用 fake helper 验证 MCP 会话协议，再碰真 helper。
- **Independent workstreams**：U1(scripts/打包)、U5(desktop RPC/权限)、U6(renderer 设置面板) 文件不相交可并行；U2(daemon 会话)→U3(bridge 帧)→U4(host 工具) 严格串行（同一通道契约）。
- **Shared mutable state**：跨进程共享仅 local-computer-use-gate.json（desktop 写/daemon 读，官方原样语义）与 helper service.json（helper 写/desktop+daemon 读）。不新增共享写者。
- **Smallest safe decomposition**：daemon 会话↔bridge 帧↔host 工具是一条契约链，拆给多 worker 会互相阻塞，单 owner（主会话）串行；U1/U5/U6 可各自独立验收。

## 实施单元

- [x] U1 sidecar provisioning 信任边界：Grok Node 构建只接受 `GROK_NODE_SIDECAR_APP`，不读 `GROK_BOT_SIDECAR_APP`，也不读 `/Applications/Grok Bot.app`。完整验签（codesign --deep --strict、Team ID DCNK4UB866、Developer ID、spctl）后 ditto 原样复制并写 sidecar-manifest.json；打包时把 helper 移出 app，ad-hoc 深签外壳，放回后只刷新外层 seal，再分别验签。见 `scripts/lib/computer-use-sidecar-0721.mjs`。没有来源构建失败。helper 包内文件名仍是签名的一部分，不能改名。
- [ ] U1 首启 provision：官方原子安装到 `~/.grokbot/computer-use/`（main-core.cjs:327822，`.install-` 暂存 + 字节比对 + rename，main-app.cjs:2729281）。Grok Node 数据根是 `~/.groknode`，这一步还没做。
- [ ] U2 daemon computer 会话模块：source/local-exec-daemon/computer-use/*（m3e 语义 TS 重建：--mcp-stdio --conversation-id、initialize 2025-06-18、超时 2min/idle 10min/lease/cancel/oneCallAtATime、退出文案逐字、Noe/YR/Mpr 表逐字）+ fake-helper 单测
- [ ] U3 bridge 帧扩展：daemon provider announcedTools/call 接 local-exec bridge 帧协议
- [ ] U4 host 工具接线：userDesktopTools/deviceLocalTools 适配 + 权限卡片（withDeviceToolPermissionCards 语义）+ auto-review computer 模式复用
- [ ] U5 desktop main：Pq/Cde/Pct admin 通道（service.json+unix socket+launch）、readComputerUsePermissions 等 4 RPC、gate 写、dseditgroup admin 检查、allowed apps 存储
- [ ] U6 renderer：设置面板本地 CUA 开关+权限状态卡（复用 local-teams 面板模式）
- [ ] U7 候选包+真机 QA：TCC 授权（Accessibility/Screen Recording）、真实 computer_screenshot/computer_apps 走通、沙箱外验证

## 关键证据锚点

- helper 身份：/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app（co.anysphere.grok-bot-computer-use，TeamID DCNK4UB866，universal，6.4MB，LSUIElement，权限用途描述齐全）
- MCP 会话：daemon main.cjs:2957755（m3e 类，spawn --mcp-stdio --conversation-id，initialize protocolVersion wpr="2025-06-18"，idle gpr=10min，请求超时 Tnt=2min）
- 工具表：daemon main.cjs Noe（14 工具）+ YR（app/free/resolve 目标类型）+ Mpr（token 校验表）+ announcedTools/call@2948611
- desktop admin：main-app.cjs:2730610 Pq（service.json→rpcSocketPath unix socket JSON-RPC；ENOENT 时 launch+轮询）、Cde=permissions/status、Pct=permissions/open-settings、L0n=[accessibility,screenRecording]、Oct=两者齐为可用
- gate：sand_enable_local_cua（main-app.cjs:2736946）；daemon local-computer-use-gate.json（main.cjs:1949994 常量区）
- host 适配：host-main.cjs:30715972 userDesktopToolsForHost（host.deviceLocalTools+withDeviceToolPermissionCards，no_device 拒答）
- Grok Node 缝隙：source/host/extensions/local-exec/（bridge/provider 帧协议）+ host-runner-composition.ts:974,1382（localExec.userComputers）
