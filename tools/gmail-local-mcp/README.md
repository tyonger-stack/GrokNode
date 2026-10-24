# Gmail local MCP

Gmail 的托管 MCP 端点属于 Google Workspace Developer Preview Program，普通 Google Cloud 项目调用时会返回：

    Access to this tool requires that your Google Cloud project (...) is enrolled in the Google Workspace Developer Preview Program.

本目录提供一个自建替代：在 Grok Node 的容器内运行一个只读 + 建草稿的 MCP HTTP 服务，使用标准 Gmail API 和现有的 OAuth Desktop client/refresh token。它不调用预览端点，也没有发送、删除、归档或改标签的工具。

## 工具

- `gmail_get_profile`
- `gmail_search_threads`
- `gmail_get_thread`
- `gmail_get_message`
- `gmail_list_labels`
- `gmail_list_drafts`
- `gmail_get_draft`
- `gmail_create_draft`

## 安全边界

- 只监听容器内 `127.0.0.1:8788`。
- 所有请求必须带 `Authorization: Bearer <token>`。
- 凭据文件从现有 `local-mcp-credentials` 复制，权限 `0600`。
- 没有 send / delete / trash / spam 工具；`gmail_create_draft` 只创建草稿。
- 卸载：从 app 的 `localMcpServers` 删除该条目，杀掉容器内进程，删除 `/home/box/sand-data/gmail-local-mcp/`。

## 测试

    node --test tools/gmail-local-mcp/server.test.mjs

测试使用本地 mock Gmail/OAuth 服务，不读取真实邮箱。沙箱内运行需要允许绑定 localhost。

## 安装

以下步骤会复制现有 OAuth 凭据并在容器内启动服务，执行前需要用户明确同意。

    docker exec grok-node-local-vm mkdir -p /home/box/sand-data/gmail-local-mcp
    docker cp tools/gmail-local-mcp/server.mjs grok-node-local-vm:/home/box/sand-data/gmail-local-mcp/server.mjs

复制凭据（先算出现有 Gmail 连接器的凭据文件名）：

    docker exec grok-node-local-vm node -e 'const fs=require("fs"),crypto=require("crypto"),path=require("path");const url="https://gmailmcp.googleapis.com/mcp/v1";const key=crypto.createHash("sha256").update(JSON.stringify([url,"default"])).digest("hex");const src="/home/box/sand-data/local-mcp-credentials/"+key+".json";const dir="/home/box/sand-data/gmail-local-mcp";fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.copyFileSync(src,path.join(dir,"credentials.json"));fs.chmodSync(path.join(dir,"credentials.json"),0o600);console.log("copied")'

生成 token 并启动：

    TOKEN=$(openssl rand -hex 32)
    docker exec -d -e GMAIL_MCP_TOKEN="$TOKEN" -e GMAIL_MCP_CREDENTIALS=/home/box/sand-data/gmail-local-mcp/credentials.json grok-node-local-vm node /home/box/sand-data/gmail-local-mcp/server.mjs
    docker exec grok-node-local-vm curl -sS http://127.0.0.1:8788/health

在 app 里添加远程 HTTP MCP：

- 名字：`Gmail (local API)`
- URL：`http://127.0.0.1:8788/mcp`
- header：`Authorization: Bearer <TOKEN>`

可以让 bot 调 `AddMcpServer`，也可以把条目写进 `localMcpServers` 后重启 MCP servers。添加完成后，宿主的 `local-http` list 应该显示 8 个工具。

## 注意

自建服务只解决 Google 预览端点这一层。宿主 agent 循环还必须包含 `GetMcpTools` / `CallMcpTool` 这对工具，bot 才能实际调用它；这需要部署 `host-runner-composition.ts` 的修复并重新打包 app。

如果不想自建，官方路径是申请 Google Workspace Developer Preview Program，把该 OAuth 项目加入计划后再重新授权 Gmail。
