# 交还控制后继续观看（2026-10-07）

用户要求点击“交还控制”后进入观看状态，而不是空黑区域。旧网页交还成功后调用 desktop.replaceChildren() 删除 iframe，真实浏览器复现 framePresent:false 与“可重新点击观看”。

修复：复用串行桌面切换函数，先调用原 POST handback 释放控制，再打开新 view 授权和查看器。交还中禁用桌面切换按钮，结束后显示“控制已交还，当前为只读观看”；不删除并留下空容器。若观看重连失败，明确说明控制已经交还并允许手动观看重试，不恢复控制权限。会话切换/取消保留原 AbortError 行为。

真实浏览器在测试 bot A 的 display 6 上完成接管→交还，iframe 仍存在，标题“机器人桌面 · 观看”，noVNC_connected，canvas 1280×800。实际 GET /desktop/mandatory.json 返回 view_only:true。服务器的只读键盘、指针、剪贴板过滤既有回归保持绿色。没有输入桌面应用或执行模型任务。

全部 API 回归 101 通过，0 失败。更新真实 Chromium 契约场景，要求交还后 iframe 为观看且发出 handback 和 view 请求；该场景默认是 opt-in，不能把默认回归数量当成浏览器自动化执行的证据，本轮浏览器证据来自真实手动自动化操作。

原 18770 验收发现额外的查看器加载超时：Codex 适配器为每个 noVNC JS 模块重复 runtime.status，涉及 bot/桌面查询，资源单项约 2.8 秒。共享运行时改为按容器 ID 缓存静态资源与并发请求，容器 ID 改变失效；每次仍检查容器可用，viewer cookie、归属和控制租约检查保持原逻辑。错误读取会移除缓存以便下次重试，路径越界仍 404。

新增 node-agent-viewer-assets.test.mjs 覆盖缓存并发合并、容器换代、失败重试与安全路径；全部 API 回归现为 102 通过。原 18770 从接管到交还实测：首次接管约 15.2 秒完成连接，交还后 iframe 标题为“机器人桌面 · 观看”，noVNC_connected，mandatory.view_only:true，画面继续显示。主服务保留原状态；未重启共享盒子。
