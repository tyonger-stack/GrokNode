# 调查：Grok Node vs Grok Bot 0.72.1 剩余移植面

- [x] Route through the how skill. For motivation questions, also route through the why skill.（调查型请求，走 Investigation playbook；无动机类问题，skip why）
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`
- [x] Produce a recommendation with a tradeoffs table.（FEATURE-GAP-0721.md）
- [ ] Apply the unslop skill to the reply.（final 回复时执行）
- [x] 读已有 REPORT-0712-to-0721.md 与 0721 证据目录，避免重复分析
- [x] preload RPC 方法表 diff（360 vs 182），逐项分类
- [x] host 工具表 diff（gateway-tool-delta.json toolEnumEntriesAdded）
- [x] renderer 功能面核查（权限面板/页面标注归入 P1/P2；扫描以 RPC+工具 diff 为准，skip 独立 chunk 全扫描：与 REPORT-0712-to-0721 重复）
- [x] 深挖高价值候选（Chrome cookies/Messages/computer-use sidecar/Mail-Notes 实现体定位）
- [x] 写 FEATURE-GAP-0721.md 推荐报告
