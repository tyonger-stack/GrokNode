# Node Agent API 后台运行与排障

更新：2026-10-07。API 是 Mac 上的独立进程，网页只是客户端。`npm run node-agent-api` 在前台运行；终端关闭或临时工具会话结束后，服务可能退出。本机已改用用户级 LaunchAgent，登录后启动、退出后重启，并保存 stdout/stderr。

[返回主手册](NODE_AGENT_API_0_3.md) · [网页工作台](http://127.0.0.1:18770/ui/) · [运行说明](../tools/node-agent-api/README.md)

后台配置不改变 GrokNode 程序或容器生命周期。GrokNode 盒子不可用时，上游操作仍明确失败；API 保活不会启动、替换或重启它。

## 配置之前

确认 Node 26.5.x、固定版本 Codex 0.160.0，以及 API 依赖已安装。保留正在使用的 `--state` 和 `--runtime-state` 绝对路径；换成新目录会创建另一份密钥和状态，旧会话不会自动搬过去。

先结束或取消 API 正在执行的回合，再优雅停止前台 API。检查 18770 没有旧实例监听，避免两个服务争用端口或状态。`--recover true` 只回收已死亡进程留下的锁；锁属于活进程时拒绝启动，不手动删除锁。

## 新建用户后台服务

在实际 API 仓库根目录运行以下配置示例。Node 与 Codex 必须解析到支持的固定版本；不在 PATH 时，把对应变量改为绝对路径。已有服务使用不同状态目录时，把两个状态变量改成原目录。

```sh
export NODE_AGENT_REPO="$PWD"
export NODE_AGENT_NODE="$(command -v node)"
export NODE_AGENT_CODEX="$(command -v codex)"
export NODE_AGENT_STATE="$NODE_AGENT_REPO/.lab/node-agent-shared"
export NODE_AGENT_RUNTIME_STATE="$NODE_AGENT_REPO/.lab/shared-runtime"
"$NODE_AGENT_NODE" --version
"$NODE_AGENT_CODEX" --version
```

以下程序生成 `~/Library/LaunchAgents/com.groknode.node-agent-api.plist`。它拒绝覆盖已存在的配置，密钥不写入 plist。

```python
import os
import pathlib
import plistlib

repo = pathlib.Path(os.environ['NODE_AGENT_REPO']).resolve()
node = str(pathlib.Path(os.environ['NODE_AGENT_NODE']).resolve(strict=True))
codex = str(pathlib.Path(os.environ['NODE_AGENT_CODEX']).resolve(strict=True))
state = str(pathlib.Path(os.environ['NODE_AGENT_STATE']).resolve())
runtime = str(pathlib.Path(os.environ['NODE_AGENT_RUNTIME_STATE']).resolve())
logs = repo / '.lab' / 'node-agent-service'
logs.mkdir(parents=True, exist_ok=True, mode=0o700)
logs.chmod(0o700)
target = pathlib.Path.home() / 'Library/LaunchAgents/com.groknode.node-agent-api.plist'
target.parent.mkdir(parents=True, exist_ok=True)
config = {
    'Label': 'com.groknode.node-agent-api',
    'ProgramArguments': [node, str(repo / 'tools/node-agent-api/cli.mjs'),
                         '--recover', 'true', '--port', '18770',
                         '--state', state, '--runtime-state', runtime,
                         '--codex-bin', codex],
    'WorkingDirectory': str(repo),
    'EnvironmentVariables': {
        'PATH': ':'.join([str(pathlib.Path(node).parent), '/usr/local/bin',
                          '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])
    },
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 10,
    'ExitTimeOut': 30,
    'ProcessType': 'Background',
    'Umask': 0o077,
    'StandardOutPath': str(logs / 'stdout.log'),
    'StandardErrorPath': str(logs / 'stderr.log'),
}
with target.open('xb') as handle:
    target.chmod(0o600)
    plistlib.dump(config, handle)
print(target)
```

将 Python 代码保存为临时配置脚本并用 `python3` 运行，再校验与加载：

```sh
plutil -lint "$HOME/Library/LaunchAgents/com.groknode.node-agent-api.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.groknode.node-agent-api.plist"
launchctl print "gui/$(id -u)/com.groknode.node-agent-api"
curl --fail --max-time 5 http://127.0.0.1:18770/health
```

后台进程不依赖当前聊天或终端。`KeepAlive` 只保活 API；应用进程内存不恢复，API 会话与文件仍按原保全策略恢复。本机已有部署的路径和日志位置以 `launchctl print` 的 `arguments`、`stdout path`、`stderr path` 为准，不以本文示例的新目录替代。

## 停止与重启

VNC 第一阶段改动和测试记录见 [连接预热与查看器复用](NODE_AGENT_VNC_PHASE_ONE.md)。内嵌查看器产物需在 API 重载前构建；保留正在使用的状态目录和密钥。

2026-10-07的网页会话与VNC性能改动已通过现有LaunchAgent重载生效，保留原状态目录、密钥及13个已有会话。更新后刷新网页并重新点击观看；详细结果与尚未达到的预算见[性能验证](NODE_AGENT_API_PERFORMANCE.md)。

先结束或取消当前 API 回合。停止本次后台实例：

```sh
launchctl bootout "gui/$(id -u)/com.groknode.node-agent-api"
```

再次运行前面的 `bootstrap` 启动，保持原状态目录即可续接已有会话。plist 仍保留时，下次登录会自动加载；若需禁止下次自动启动，使用 `launchctl disable "gui/$(id -u)/com.groknode.node-agent-api"`，以后可用 `launchctl enable` 恢复。不要用普通 `kill` 作为停止方式，保活配置会重新拉起进程。

## 服务打不开

```sh
lsof -nP -iTCP:18770 -sTCP:LISTEN
curl --fail --max-time 5 http://127.0.0.1:18770/health
launchctl print "gui/$(id -u)/com.groknode.node-agent-api"
```

- **端口没有监听**：检查 LaunchAgent 是否存在、进程是否运行、`last exit code` 和配置中的 stdout/stderr 文件。前台实例退出且没有后台服务时，浏览器无法连接。
- **反复退出**：从 stderr 检查可执行文件、依赖、目录权限、端口占用和服务锁。确认原锁所属进程已死亡后使用 `--recover true`，不覆盖活实例。
- **health 为 200，bot/工具失败**：检查原 GrokNode 盒子、gateway、Mac 模型代理和对应授权。health 只证明 API 在响应。
- **更新后网页提示还是旧版或查看器超时**：Chrome 按 ⌘⇧R，重新输入 API 访问密钥、选择已有会话，再点击观看或接管。桌面 ticket/cookie 会因服务重启失效，需要重新签发；刷新网页不删除持久会话。
- **应用中文标题乱码**：更新 API 到包含 UTF-8 标题读取修复的实现，点击刷新应用。不要在浏览器猜测转码。

2026-10-07 的实际恢复检查确认 `/health`、`/ui/` 与原密钥认证均成功，已有会话仍可读取。没有通过重启 Mac 验证登录自动启动；该行为来自 LaunchAgent 配置，不能当成已经完成的重启验收。进程此前退出的具体触发原因没有退出日志，不把临时会话生命周期猜测成已证实的崩溃原因。
