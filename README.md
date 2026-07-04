# SiYuan AI MCP Bridge

This plugin provides a small local MCP stdio server so external AI clients can operate SiYuan through the official Kernel HTTP API.

The server is intentionally conservative:

- notebook-level permissions: `none`, `r`, `rw`, `rwd`;
- tool-level switches for system info, notebook listing, search, read, write, and delete;
- default configuration is read-only;
- destructive tools require both tool permission and notebook `rwd` permission.

## MCP Client Configuration

Use the settings dialog in SiYuan to copy the generated configuration. The plugin automatically generates the local path to `mcp-server.cjs` after installation, so you do not need to type it manually.

The generated config has this shape:

```json
{
  "mcpServers": {
    "siyuan-ai-mcp-bridge": {
      "command": "node",
      "args": [
        "<SiYuan data>/plugins/siyuan-ai-mcp-bridge/mcp-server.cjs"
      ],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "<your local SiYuan API token>"
      }
    }
  }
}
```

The server defaults to `http://127.0.0.1:6806`. The token shown in the settings dialog is your local SiYuan Kernel API token. It is not an OpenAI or Claude key, and it should not be committed to a repository.

## Tools

- `siyuan_system_info`
- `siyuan_list_notebooks`
- `siyuan_search`
- `siyuan_read_doc`
- `siyuan_create_doc`
- `siyuan_append_block`
- `siyuan_update_block`
- `siyuan_delete_block`

## Permission Levels

- `none`: hidden from AI.
- `r`: read/search only.
- `rw`: create and edit allowed.
- `rwd`: create, edit, and delete allowed.

Settings are stored in SiYuan plugin storage at:

```text
/data/storage/petal/siyuan-ai-mcp-bridge/mcp-bridge-config.json
```

## Development

Run the test suite:

```bash
npm test
```

Build the SiYuan Bazaar release package:

```bash
npm run package
```

The package script creates `package.zip` in this directory. Upload that file to a GitHub Release before submitting the repository to the SiYuan Bazaar.
