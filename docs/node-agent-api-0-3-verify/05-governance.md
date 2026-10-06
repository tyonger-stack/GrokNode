# 05 治理：密钥、用户、配额、webhook

需求对应：条目 9（多用户、权限、轮换、配额、审计、签名 webhook、trace/usage）。

## 实测

- POST /v1/keys（sessions.read + 单 bot + 600s）：201；rotate：201 新密钥；delete：200；非法 scope / 空体：400。
- POST /v1/users：201；GET /v1/users：200 列表；disable：200；空名：400。
- GET /v1/usage：200 四组配额数字随调用推进（回归测试另有并发/zero-quota 覆盖）。
- POST /v1/webhooks（127.0.0.1:9/hook）：201 含 signingKey；内网元数据地址：400（SSRF 拦截）；dispatch 无到期：200 空数组；未知 delivery：404；rotate：200。
- 审计与持久化由 governance 回归测试覆盖（并发准入、SIGKILL 恢复、损坏 fail-closed）。

## verdict

一致。bot 范围限制只控接口访问，不声称文件系统隔离——与需求 9 的边界表述吻合。
