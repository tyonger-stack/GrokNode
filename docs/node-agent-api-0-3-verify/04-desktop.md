# 04 桌面、应用与剪贴板

需求对应：条目 2（同一 bot 同一桌面）、条目 6（整桌面/单应用观看与操作，短期授权、明确接管交还）、条目 7（剪贴板只显式传递）。

## 实测

- POST desktop {mode:view}：201，display 6（与 GrokNode 分配一致），single_use true，server_enforced true，pauses_agent false。{} 空体默认 view（OpenAPI 标 default:view，文档行为一致）。
- 票据链路：GET /desktop/open?ticket=（无须 Authorization 头）→ 303 + HttpOnly SameSite=Strict nodeviewer cookie → GET /desktop/vnc.html 200（18KB noVNC 页）→ mandatory.json 200 view_only:true，直连本服务 socket 路径。
- 票据复用：401 ticket_invalid；过期票据（默认 60s）：401；无 cookie 直访 vnc：401。
- 未持控制租约时 POST clipboard 与 POST applications：403（先查租约后校验体，属显式接管门禁，符合条目 6/7）。
- GET clipboard：200；GET applications：200，3 个真实窗口。launch 正向有意跳过（会在用户盒子开 GUI），替代证据见 applications 回归测试。
- POST handback：200 released。POST handoff / resume：200（resume 35s，harness 重连成本）。
- 代码级：同 bot 单控制租约（desktop_busy 409）、桌面重分配 desktop_changed 409、viewer 15 分钟过期，均与文档描述一致。

## verdict

一致。桌面区分是交互归属（cookie/租约隔离），不是 Linux 安全隔离——与需求 6 的表述完全吻合。
