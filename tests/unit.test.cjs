"use strict";

const assert = require("assert");
const {
  apiUrlFromLocation,
  detectSiyuanConnection,
  getBrowserApiUrlCandidates,
  selectLocalServerAddr
} = require("../connection.cjs");
const {
  createFrameParser,
  defaultConfig,
  encodeMessage,
  executeTool,
  getApiUrlCandidates,
  handleRequest,
  hasNotebookPermission,
  loadConfig,
  normalizeConfig,
  permissionForNotebook,
  readPortFileApiUrls,
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
  assert.equal(apiUrlFromLocation({hostname: "127.0.0.1", port: "61234"}), "http://127.0.0.1:61234");
  assert.equal(selectLocalServerAddr([
    "http://192.168.0.240:61234",
    "http://127.0.0.1:61234"
  ]), "http://127.0.0.1:61234");
  assert.deepEqual(getBrowserApiUrlCandidates({
    siyuanApiUrl: "http://127.0.0.1:6806"
  }, {hostname: "127.0.0.1", port: "61234"}).slice(0, 2), [
    "http://127.0.0.1:61234",
    "http://127.0.0.1:6806"
  ]);

  const detectedConnection = await detectSiyuanConnection({
    config: {siyuanApiUrl: "http://127.0.0.1:6806", siyuanToken: ""},
    location: {hostname: "127.0.0.1", port: "61234"},
    fetch: async (url) => {
      assert.ok(String(url).startsWith("http://127.0.0.1:61234/"));
      return jsonResponse({
        code: 0,
        msg: "",
        data: {
          conf: {
            serverAddrs: ["http://192.168.0.240:61234", "http://127.0.0.1:61234"],
            api: {token: "token-from-current-port"}
          }
        }
      });
    }
  });
  assert.equal(detectedConnection.apiUrl, "http://127.0.0.1:61234");
  assert.equal(detectedConnection.token, "token-from-current-port");

  const portFileUrls = readPortFileApiUrls({
    portFilePath: "/tmp/siyuan-port.json",
    readFile: () => JSON.stringify({"111": "6806", "222": "61234"}),
    isProcessAlive: (pid) => pid === 222
  });
  assert.deepEqual(portFileUrls, ["http://127.0.0.1:61234"]);
  assert.deepEqual(getApiUrlCandidates({
    env: {SIYUAN_API_URL: "http://127.0.0.1:6806"},
    portFilePath: "/tmp/siyuan-port.json",
    readFile: () => JSON.stringify({"222": "61234"}),
    isProcessAlive: (pid) => pid === 222
  }).slice(0, 2), [
    "http://127.0.0.1:6806",
    "http://127.0.0.1:61234"
  ]);

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

  const triedConfigUrls = [];
  const loadedFromChangedPort = await loadConfig({
    env: {SIYUAN_API_URL: "http://127.0.0.1:6806"},
    portFilePath: "/tmp/siyuan-port.json",
    readFile: () => JSON.stringify({"222": "61234"}),
    isProcessAlive: (pid) => pid === 222,
    fetch: async (url) => {
      triedConfigUrls.push(String(url));
      if (String(url).startsWith("http://127.0.0.1:6806/")) {
        return new Response("missing", {status: 404});
      }
      assert.ok(String(url).startsWith("http://127.0.0.1:61234/"));
      return new Response(JSON.stringify({
        siyuanApiUrl: "http://127.0.0.1:6806",
        defaultNotebookPermission: "rwd"
      }), {status: 200});
    }
  });
  assert.equal(loadedFromChangedPort.siyuanApiUrl, "http://127.0.0.1:61234");
  assert.equal(loadedFromChangedPort.defaultNotebookPermission, "rwd");
  assert.deepEqual(triedConfigUrls.map((url) => new URL(url).port), ["6806", "61234"]);

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
