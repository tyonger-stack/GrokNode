# 03 项目与环境

需求对应：条目 3（数据按原始语义共享，不建私有卷）、条目 5（改代码/测试/审查/导出）、条目 8（备份恢复；进程按中断处理）。

## 实测

- GET project/diff：200，15KB，真实现场 diff。
- POST project/export：200 artifact 描述；GET artifacts/{id}/content：200 application/gzip 14KB。未知 artifact：404。
- POST project/import 数组形状：200 {imported:N}（单文件与多文件含子目录均验）；随后 diff 即见新文件；探针文件已清走并复查。
- import 缺 files（{}）：400 files array is required（M1 已修，复验通过）。
- import 同路径复写：409 import_conflict（M2 已修，复验通过；拒绝覆盖防丢数据）。
- POST environment/backup：201，backup_id，preserved 含 source/uncommitted_changes/conversation/logs，processes_restored false。
- POST environment/restore（刚取的 backup_id）：200 restored true，processes_restored false，与需求 8 一致。未知 backup_id：404 backup_not_found（M3 已修，复验通过）。
- POST environment/recreate：409 managed_by_grok_node，盒子生命周期归 GrokNode（需求原程序不变）。

## verdict

一致。M1-M3 三处状态码已按 07 修完并逐条复验；失败语义均为 fail-closed（拒绝、不丢数据、不回落 Mac）。
