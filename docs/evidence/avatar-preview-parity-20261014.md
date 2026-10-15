# 0.70.2 头像、休眠与按 Bot 预览隔离

正式版：`/Applications/Grok Bot.app`，Info.plist 版本 0.70.2。
ASAR SHA-256：`8dd7b6c4a58439d626a9a7b3766982b7c725db2bc1f6ff68a29fc1ec62ca4cf7`。
绘制来源：`index.eager-platform-DUN5VkaE.js`，SHA-256
`560912e771f4989101d04ad06dca024cd1c0513cbdcad122222d9a6bd1df1183`。
选择器来源：`chunk-agent-character-picker-CEuUTll_.js`，SHA-256
`b8c0d51d205d35048f63292026fb6446d5426218bcef53a4f009808ff31aeb6e`。
动画 CSS 来源：`index-Dve5Ol5U.css`，SHA-256
`7a1f78e57358cc7d1276d8fde21ab33376dd41af96a41c2ef30235c78183d3c1`。

## 实际依据

平台的 uN 明确列出 13 形状：blob、cloud、square、sparkle、clover、heart、flower、teardrop、tablet、wedge、house、star、hex。
lN 以 oi=5 分行。角色选择器 G 对 zf 调色板提供 11 个颜色；不能因另一个 Bw 列表过滤黑色而误减成 10 个。
2026-10-14 正式版实际头像编辑器 AX 也确认 13 个形状、11 个颜色，名称和 tooltip 为团块、云朵、方形、星芒、四叶草、爱心、花朵、水滴、药片、楔形、房子、星形、六边形。
选中依形状生成描边 mask，选择提交 commitCharacter({avatarShape}) / commitCharacter({avatarColor})，重置提交两个空字符串。

原绘制链：bI → wN(body 映射) → yN React 绘制器 → Yf 状态引擎 / Nx 表情状态 → Fh SVG。
wN 将 blob、flower、heart、star 分别映射为 sphere、starFlower、heartChubby、star6，其余保留形状名。
fl.sleeping 指定 sleepy；fl.waking 指定 surprised，1.6 秒后回 idle。
休眠头像 ink 使用 --sand-text-tertiary，呼吸和三个 z 使用原 CSS 2.4 秒关键帧。

## 旧资源缺陷与修复

修改前构建快照中 13 个 SVG 有 12 个含失效本地引用。重复轮廓为 square/flower/teardrop 和 sparkle/tablet/house/hex。
scripts/export-official-avatar-assets.mjs 从校验过的正式版产物按 AST 选择绘制依赖和原 yN；不执行应用 bootstrap 或 IPC。
生成 avatar-engine.mjs、三种状态 SVG、shape-map.json、13 个独立 SVG 和动画关键帧。
avatar-source.json 记录每个原声明的位置和源/派生哈希。新资源保留完整 defs、mask、href；39 个状态 SVG 的引用全部本地可解析，13 个轮廓各不相同。
shape-picker-patch 现使用原引擎绘制头像，保持原 updateAgent 保存和重置链，并修复重复 assets 路径。

## Node 自有行为

休眠状态以 agentId 为键，只停止该 Bot 的预览、缓存视图和隐藏的全屏视图。其他 Bot、可见交互电脑、容器和任务继续运行。
main/preload 三个休眠 IPC 必须携带 agentId；未提供 ID 拒绝，不能退化为全应用开关。
状态仅保存在进程内，应用重启预览恢复。头像通过原 roster 保存，与该休眠状态无关。
预览 frame 使用原 _bn 的 agentId，缓存挂载也带 owner context；异步回执以 Bot ID 和 revision 防止切 Bot 后覆盖新画面。

## 验证与限制

REA MCP 默认完整性检查发现 unpacked cursor_proclist.node 声明哈希与安装字节不一致；record-and-continue 后 MCP 连接关闭。
随后已安装 REA 6.4 CLI 对校验过的 renderer 子集完成静态分析，完整 Evidence 在工作区根 rea-grokbot-0702/avatar-reference-20261014-evidence.json。
Evidence ID：ev_22c66ab15180ccc1b8a3f6652b83f02184913d6d4231bde50ab276afa78e043f。
六个 JS 文件均解析成功。语义图因父结果预算为 partial；这不能证明运行时行为，也不能证明未找到的功能不存在。
独立 Acorn 锚点和实际纯绘制器执行补充了形状与表达式证据。

组合范围测试 44/44；实际休眠覆盖层测试对全部 13 个 Bot 形状核对 sleeping、waking、灰色 ink、z 关键帧、恢复和调用归属。

2026-10-15 统一包已安装到 /Applications/Grok Node.app，ASAR SHA-256 为
`90f5e9a4c4d42782050a8c41a0842ca154640428ed63f9e83c5b93f7f2515215`。
打包签名校验通过，101 个 renderer JavaScript 均通过 node --check，损坏的 RLocT 字符串为 0。
npm run check 为 1374/1374，无失败或跳过；frontend:build 成功，保留既有动态/静态 import 混用警告。

实机逐项选择保存了 13 种形状、11 种颜色，AX 选中值均为 1；选择器显示 5+5+3，中文 tooltip 与正式版一致。
星形/蓝色在退出、安装新包并重启后仍选中；随后重置回行业研报分析员原有的楔形/紫罗兰色。
工作管家的草稿 g 重启后仍在，没有发送；本轮额外出现的行业研报分析员草稿也保留。
截图位于工作区 .tmp-app-verify-20261013/qa/final-avatar-*-full.png，不入库。

实机 A 休眠释放两条 VNC 预览连接；B 正常预览，再将 B 休眠，恢复 A 后 B 仍保持休眠。
两 Bot 最终都已恢复。整个验证段 Docker 始终 running、paused=false，StartedAt 保持
2026-10-15T00:55:10.707917954Z，协调服务 health HTTP 200。
原 Open 交互电脑入口打开 noVNC sandInteractive=1，取得控制权后显示“你正在控制”；
一次鼠标点击启动器后出现空白终端，未输入或执行命令，随后关闭验证创建的终端和交互视图。
双击启动器被自动审批拒绝，没有执行；键盘送达未作真实桌面输入验证。

已知适配差异：旧 sd 的 burst ref 方法适配为原引擎 bounce，不声称复制旧粒子爆发效果。
电脑卡片的受控生产登记/数据库/RPC 测试与真实模型触发分开记录，见 conversation-computer-card-20261014.md。
