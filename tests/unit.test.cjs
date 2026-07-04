"use strict";

const assert = require("assert");
const {
  createFrameParser,
  defaultConfig,
  encodeMessage,
  executeTool,
  handleRequest,
  hasNotebookPermission,
  loadConfig,
  normalizeConfig,
  permissionForNotebook,
  toolDefinitions
} = require("../mcp-server.cjs");

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {"Content-Type": "application/json"}
  });
}

async function run() {
  const config = normalizeConfig({
    defaultNotebookPermission: "rw",
    notebookPermissions: {
      nb1: "none",
      nb2: "rwd",
      bad: "owner"
    },
    tools: {
      createDoc: true
    }
  });

  assert.equal(config.version, 1);
  assert.equal(config.defaultNotebookPermission, "rw");
  assert.equal(permissionForNotebook(config, "nb1"), "none");
  assert.equal(permissionForNotebook(config, "nb2"), "rwd");
  assert.equal(permissionForNotebook(config, "missing"), "rw");
  assert.equal(config.notebookPermissions.bad, undefined);
  assert.equal(hasNotebookPermission(config, "nb2", "rwd"), true);
  assert.equal(hasNotebookPermission(config, "nb1", "r"), false);

  const init = await handleRequest({jsonrpc: "2.0", id: 1, method: "initialize", params: {}});
  assert.equal(init.result.serverInfo.name, "siyuan-ai-mcp-bridge");

  const listed = await handleRequest({jsonrpc: "2.0", id: 2, method: "tools/list"});
  assert.ok(listed.result.tools.length >= 8);
  assert.ok(toolDefinitions.some((tool) => tool.name === "siyuan_read_doc"));

  const parsed = [];
  const parse = createFrameParser((message) => parsed.push(message));
  const encoded = encodeMessage({jsonrpc: "2.0", id: 3, method: "ping"});
  parse(encoded.slice(0, 10));
  parse(encoded.slice(10));
  assert.deepEqual(parsed, [{jsonrpc: "2.0", id: 3, method: "ping"}]);

  const mockFetch = async (url) => {
    if (String(url).endsWith("/api/notebook/lsNotebooks")) {
      return jsonResponse({
        code: 0,
        msg: "",
        data: {
          notebooks: [
            {id: "nb1", name: "hidden", closed: false},
            {id: "nb2", name: "allowed", closed: false}
          ]
        }
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const listResult = await executeTool("siyuan_list_notebooks", {}, {
    config,
    fetch: mockFetch
  });
  const listJson = JSON.parse(listResult.content[0].text);
  assert.deepEqual(listJson.notebooks.map((notebook) => notebook.id), ["nb2"]);

  const loaded = await loadConfig({
    fetch: async (url) => {
      assert.ok(String(url).endsWith("/api/file/getFile"));
      return new Response(JSON.stringify({
        defaultNotebookPermission: "none",
        tools: {systemInfo: true}
      }), {status: 200});
    }
  });
  assert.equal(loaded.defaultNotebookPermission, "none");
  assert.equal(loaded.tools.systemInfo, true);

  await assert.rejects(
    () => executeTool("siyuan_create_doc", {notebook: "nb1", path: "/x.md", markdown: "x"}, {
      config: {...config, tools: {...defaultConfig.tools, createDoc: true}},
      fetch: mockFetch
    }),
    /permission denied/i
  );
}

run().then(() => {
  console.log("unit tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
