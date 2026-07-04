# 思源 AI MCP 桥接

这个插件提供一个本地 MCP stdio 服务，让外部 AI 客户端可以通过思源内核 HTTP API 操作思源笔记。

服务默认保持保守：

- 笔记本级权限：`none`、`r`、`rw`、`rwd`；
- 工具级开关：系统信息、列出笔记本、搜索、读取、写入和删除；
- 默认配置为只读；
- 删除类工具必须同时开启工具权限，并且目标笔记本权限为 `rwd`。

## MCP 客户端配置

在思源中打开插件设置面板，复制自动生成的 MCP 客户端配置即可。插件会根据安装位置自动生成 `mcp-server.cjs` 的本地路径，不需要手动填写。

生成的配置结构类似：

```json
{
  "mcpServers": {
    "siyuan-ai-mcp-bridge": {
      "command": "node",
      "args": [
        "<思源 data>/plugins/siyuan-ai-mcp-bridge/mcp-server.cjs"
      ],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "<你的本机思源 API Token>"
      }
    }
  }
}
```

这里的 Token 是思源内核 API Token，不是 OpenAI 或 Claude Key。它只用于本机 MCP 客户端访问思源内核，不要提交到仓库。

## 工具

- `siyuan_system_info`
- `siyuan_list_notebooks`
- `siyuan_search`
- `siyuan_read_doc`
- `siyuan_create_doc`
- `siyuan_append_block`
- `siyuan_update_block`
- `siyuan_delete_block`

## 权限等级

- `none`：对 AI 隐藏。
- `r`：只允许读取和搜索。
- `rw`：允许创建和编辑。
- `rwd`：允许创建、编辑和删除。

设置保存在思源插件存储中：

```text
/data/storage/petal/siyuan-ai-mcp-bridge/mcp-bridge-config.json
```

## 开发

运行测试：

```bash
npm test
```

生成思源集市 Release 包：

```bash
npm run package
```

脚本会在当前目录生成 `package.zip`。将该文件上传到 GitHub Release 后，再向思源集市提交仓库信息。
