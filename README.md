# 思源 AI MCP 桥接

让 AI 工具在你授权的范围内使用思源笔记。

思源 AI MCP 桥接把思源变成一个可被 AI 客户端安全访问的本地知识库。你可以把笔记本、文档和搜索能力交给外部 AI 使用，同时保留清晰的权限边界：默认只读，需要写入或删除时再手动开启。

## 适合谁

- 希望 AI 帮你查找、整理和总结思源笔记。
- 希望在 Claude、Codex、Cursor 等支持 MCP 的工具里使用自己的思源知识库。
- 希望外部 AI 可以读取部分笔记，但不希望默认拥有写入或删除能力。
- 希望按笔记本区分权限，例如公开资料只读、工作笔记禁止访问、实验笔记允许写入。

## 核心能力

- 一键复制 MCP 客户端配置，减少手动配置成本。
- 自动读取本机思源 API Token，不需要用户手动查找。
- 默认只读，外部 AI 只能读取和搜索。
- 支持按笔记本设置权限：隐藏、只读、读写、读写删除。
- 支持按功能开关工具：搜索、读取、创建、追加、更新、删除。
- 写入和删除需要同时满足工具权限与笔记本权限，避免误操作。

## 使用方式

1. 在思源集市安装并启用插件。
2. 点击顶部栏的「思源 AI MCP 桥接」按钮。
3. 在「连接配置」中复制 MCP 客户端配置。
4. 将配置粘贴到支持 MCP 的 AI 工具中。
5. 在「笔记权限」和「功能权限」里按需调整授权范围。

默认配置已经适合安全试用：AI 可以读取和搜索，但不能创建、修改或删除内容。

## 权限说明

笔记权限控制 AI 能接触哪些笔记本：

- `none`：隐藏，AI 看不到这个笔记本。
- `r`：只读，AI 可以搜索和读取。
- `rw`：读写，AI 可以创建和编辑。
- `rwd`：读写删除，AI 可以删除内容。

功能权限控制 AI 能调用哪些动作。即使打开了写入或删除工具，也仍然需要目标笔记本具备对应权限。

## 关于 Token

插件设置里显示的 Token 是思源内核 API Token，只用于本机 MCP 客户端连接思源。它不是 OpenAI、Claude 或其他 AI 平台的 Key。

请不要把 Token 发布到仓库、截图或公共对话中。

## English

SiYuan AI MCP Bridge lets external MCP clients use your SiYuan notes within permissions you control.

It is designed for people who want AI tools to search, read, summarize, and optionally write SiYuan notes without giving every tool full access by default.

Key features:

- Copy-ready MCP client configuration.
- Automatic local SiYuan API token detection.
- Read-only by default.
- Notebook-level permissions: hidden, read-only, read-write, and read-write-delete.
- Tool-level switches for search, read, create, append, update, and delete.
- Write and delete actions require both tool permission and notebook permission.

Start with the default read-only mode, then enable write or delete access only for notebooks you trust.
