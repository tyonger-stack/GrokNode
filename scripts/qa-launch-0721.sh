#!/bin/zsh
# 0.72.1 候选包隔离验收启动器。
# 独立 userData(/tmp) + 无效 gateway 地址：不触碰生产配置、不操作 Docker 容器。
# 需要完整 Bot 数据时,先退出已安装的 Grok Node,再删掉 SAND_HOST_GATEWAY_URL 一行重启。
cd "$(dirname "$0")/.."
mkdir -p /tmp/grok-node-0721-qa
export SAND_USER_DATA_DIR=/tmp/grok-node-0721-qa/userdata
export SAND_HOST_GATEWAY_URL=http://127.0.0.1:9
exec "./dist/Grok Node.app/Contents/MacOS/Grok Bot" --remote-debugging-port=9333
