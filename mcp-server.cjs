#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  FALLBACK_API_URL,
  normalizeApiUrl,
  uniqueApiUrls
} = require("./connection.cjs");

const PLUGIN_NAME = "siyuan-ai-mcp-bridge";
const CONFIG_API_PATH = `/data/storage/petal/${PLUGIN_NAME}/mcp-bridge-config.json`;
const DEFAULT_API_URL = normalizeApiUrl(process.env.SIYUAN_API_URL || FALLBACK_API_URL);
const DEFAULT_TOKEN = process.env.SIYUAN_API_TOKEN || "";

const PERMISSION_LEVELS = {none: 0, r: 1, rw: 2, rwd: 3};

const defaultConfig = {
  version: 1,
  siyuanApiUrl: DEFAULT_API_URL,
  siyuanToken: DEFAULT_TOKEN,
  defaultNotebookPermission: "r",
  notebookPermissions: {},
  tools: {
    systemInfo: true,
    listNotebooks: true,
    search: true,
    readDoc: true,
    createDoc: false,
    appendBlock: false,
    updateBlock: false,
    deleteBlock: false
  }
};

const toolDefinitions = [
  {
    name: "siyuan_system_info",
    description: "Read SiYuan version and current MCP bridge permission summary.",
    inputSchema: {type: "object", properties: {}, additionalProperties: false}
  },
  {
    name: "siyuan_list_notebooks",
    description: "List notebooks visible to the MCP bridge after notebook permissions are applied.",
    inputSchema: {type: "object", properties: {}, additionalProperties: false}
  },
  {
    name: "siyuan_search",
    description: "Search SiYuan blocks using full text search. Results are filtered by notebook permission when box metadata is available.",
    inputSchema: {
      type: "object",
      properties: {
        query: {type: "string"},
        limit: {type: "number", minimum: 1, maximum: 64}
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "siyuan_read_doc",
    description: "Read a document by block/document id as Markdown/Kramdown text.",
    inputSchema: {
      type: "object",
      properties: {
        id: {type: "string"}
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "siyuan_create_doc",
    description: "Create a document from Markdown in a notebook. Requires notebook rw permission and createDoc tool enabled.",
    inputSchema: {
      type: "object",
      properties: {
        notebook: {type: "string", description: "Notebook id."},
        path: {type: "string", description: "Document path, for example /AI/Test.md."},
        markdown: {type: "string"}
      },
      required: ["notebook", "path", "markdown"],
      additionalProperties: false
    }
  },
  {
    name: "siyuan_append_block",
    description: "Append Markdown after the last child of a parent block or document. Requires rw permission.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: {type: "string"},
        markdown: {type: "string"}
      },
      required: ["parentId", "markdown"],
      additionalProperties: false
    }
  },
  {
    name: "siyuan_update_block",
    description: "Replace one block with Markdown. Requires rw permission.",
    inputSchema: {
      type: "object",
      properties: {
        id: {type: "string"},
        markdown: {type: "string"}
      },
      required: ["id", "markdown"],
      additionalProperties: false
    }
  },
  {
    name: "siyuan_delete_block",
    description: "Delete one block. Requires notebook rwd permission and deleteBlock tool enabled.",
    inputSchema: {
      type: "object",
      properties: {
        id: {type: "string"}
      },
      required: ["id"],
      additionalProperties: false
    }
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const sourceTools = source.tools && typeof source.tools === "object" && !Array.isArray(source.tools) ? source.tools : {};
  const sourceNotebookPermissions = source.notebookPermissions &&
    typeof source.notebookPermissions === "object" &&
    !Array.isArray(source.notebookPermissions)
    ? source.notebookPermissions
    : {};
  const notebookPermissions = {};
  for (const [key, value] of Object.entries(sourceNotebookPermissions)) {
    if (Object.prototype.hasOwnProperty.call(PERMISSION_LEVELS, value)) {
      notebookPermissions[key] = value;
    }
  }
  return {
    ...clone(defaultConfig),
    ...source,
    version: 1,
    siyuanApiUrl: typeof source.siyuanApiUrl === "string" && source.siyuanApiUrl.trim()
      ? source.siyuanApiUrl.trim().replace(/\/+$/, "")
      : DEFAULT_API_URL,
    siyuanToken: typeof source.siyuanToken === "string" ? source.siyuanToken : DEFAULT_TOKEN,
    defaultNotebookPermission: Object.prototype.hasOwnProperty.call(PERMISSION_LEVELS, source.defaultNotebookPermission)
      ? source.defaultNotebookPermission
      : defaultConfig.defaultNotebookPermission,
    notebookPermissions,
    tools: {...defaultConfig.tools, ...sourceTools}
  };
}

function getToolFlagName(toolName) {
  return {
    siyuan_system_info: "systemInfo",
    siyuan_list_notebooks: "listNotebooks",
    siyuan_search: "search",
    siyuan_read_doc: "readDoc",
    siyuan_create_doc: "createDoc",
    siyuan_append_block: "appendBlock",
    siyuan_update_block: "updateBlock",
    siyuan_delete_block: "deleteBlock"
  }[toolName];
}

function permissionForNotebook(config, notebookId) {
  return config.notebookPermissions[notebookId] || config.defaultNotebookPermission || "none";
}

function hasNotebookPermission(config, notebookId, required) {
  const actual = PERMISSION_LEVELS[permissionForNotebook(config, notebookId)] || 0;
  return actual >= PERMISSION_LEVELS[required];
}

function assertToolEnabled(config, toolName) {
  const flag = getToolFlagName(toolName);
  if (!flag || config.tools[flag] !== true) {
    throw new Error(`Tool disabled by MCP bridge settings: ${toolName}`);
  }
}

function assertNotebookPermission(config, notebookId, required) {
  if (!hasNotebookPermission(config, notebookId, required)) {
    throw new Error(`Notebook permission denied: ${notebookId} requires ${required}, current ${permissionForNotebook(config, notebookId)}`);
  }
}

function getFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }
  throw new Error("This MCP server requires Node.js with global fetch support.");
}

function getRuntimeEnv(runtime = {}) {
  return runtime.env || process.env;
}

function getSiyuanPortFilePath(runtime = {}) {
  return runtime.portFilePath || path.join(os.homedir(), ".config", "siyuan", "port.json");
}

function isProcessAlive(pid, runtime = {}) {
  const check = runtime.isProcessAlive || ((value) => {
    try {
      process.kill(value, 0);
      return true;
    } catch (error) {
      return false;
    }
  });
  return check(pid);
}

function readPortFileApiUrls(runtime = {}) {
  const filePath = getSiyuanPortFilePath(runtime);
  const readFile = runtime.readFile || ((target) => fs.readFileSync(target, "utf8"));
  try {
    const raw = JSON.parse(readFile(filePath));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }
    return Object.entries(raw)
      .filter(([pid]) => Number.isInteger(Number(pid)) && isProcessAlive(Number(pid), runtime))
      .map(([, port]) => `http://127.0.0.1:${port}`);
  } catch (error) {
    return [];
  }
}

function getApiUrlCandidates(runtime = {}) {
  const env = getRuntimeEnv(runtime);
  return uniqueApiUrls([
    runtime.apiUrl,
    env.SIYUAN_API_URL,
    ...readPortFileApiUrls(runtime),
    FALLBACK_API_URL
  ]);
}

async function apiPost(path, payload = {}, runtime = {}) {
  const config = runtime.config || defaultConfig;
  const fetchImpl = runtime.fetch || getFetch();
  const baseUrl = normalizeApiUrl(runtime.apiUrl || config.siyuanApiUrl || DEFAULT_API_URL);
  const token = runtime.token || config.siyuanToken || DEFAULT_TOKEN;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Token ${token}`} : {})
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`SiYuan API returned invalid JSON for ${path}: ${text.slice(0, 200)}`);
  }
  if (!response.ok || data.code !== 0) {
    throw new Error(`SiYuan API ${path} failed: HTTP ${response.status}, code ${data.code}, msg ${data.msg || ""}`);
  }
  return data.data;
}

async function apiGetFile(path, runtime = {}) {
  const config = runtime.config || defaultConfig;
  const fetchImpl = runtime.fetch || getFetch();
  const baseUrl = normalizeApiUrl(runtime.apiUrl || config.siyuanApiUrl || DEFAULT_API_URL);
  const token = runtime.token || config.siyuanToken || DEFAULT_TOKEN;
  const response = await fetchImpl(`${baseUrl}/api/file/getFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Token ${token}`} : {})
    },
    body: JSON.stringify({path})
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SiYuan API /api/file/getFile failed: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }
  if (!text.trim()) {
    throw new Error(`SiYuan file is empty or missing: ${path}`);
  }
  return text;
}

async function loadConfig(runtime = {}) {
  if (runtime.config) {
    return normalizeConfig(runtime.config);
  }
  const env = getRuntimeEnv(runtime);
  if (env.SIYUAN_MCP_BRIDGE_CONFIG) {
    return normalizeConfig(JSON.parse(fs.readFileSync(env.SIYUAN_MCP_BRIDGE_CONFIG, "utf8")));
  }
  const candidates = getApiUrlCandidates(runtime);
  let lastError = null;
  for (const apiUrl of candidates) {
    const bootstrap = normalizeConfig({
      siyuanApiUrl: apiUrl,
      siyuanToken: env.SIYUAN_API_TOKEN || DEFAULT_TOKEN
    });
    try {
      const raw = await apiGetFile(CONFIG_API_PATH, {config: bootstrap, fetch: runtime.fetch});
      return normalizeConfig({
        ...JSON.parse(raw),
        siyuanApiUrl: apiUrl
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (env.SIYUAN_MCP_BRIDGE_STRICT_CONFIG === "1" && lastError) {
    throw lastError;
  }
  return normalizeConfig({
    siyuanApiUrl: candidates[0] || DEFAULT_API_URL,
    siyuanToken: env.SIYUAN_API_TOKEN || DEFAULT_TOKEN
  });
}

async function queryBlockBox(id, runtime) {
  const rows = await apiPost("/api/query/sql", {
    stmt: `select id, box, path, hpath, type from blocks where id = '${String(id).replace(/'/g, "''")}' limit 1`
  }, runtime);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.box) {
    throw new Error(`Cannot resolve notebook for block: ${id}`);
  }
  return row.box;
}

function toMcpText(value) {
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
    }]
  };
}

function limitNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function executeTool(name, args = {}, runtime = {}) {
  const config = await loadConfig(runtime);
  const nextRuntime = {...runtime, config};
  assertToolEnabled(config, name);

  if (name === "siyuan_system_info") {
    const version = await apiPost("/api/system/version", {}, nextRuntime);
    return toMcpText({
      version,
      defaultNotebookPermission: config.defaultNotebookPermission,
      enabledTools: Object.entries(config.tools).filter(([, enabled]) => enabled).map(([tool]) => tool)
    });
  }

  if (name === "siyuan_list_notebooks") {
    const data = await apiPost("/api/notebook/lsNotebooks", {}, nextRuntime);
    const notebooks = (data.notebooks || [])
      .filter((notebook) => permissionForNotebook(config, notebook.id) !== "none")
      .map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        closed: Boolean(notebook.closed),
        permission: permissionForNotebook(config, notebook.id)
      }));
    return toMcpText({notebooks});
  }

  if (name === "siyuan_search") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new Error("query is required");
    }
    const limit = limitNumber(args.limit, 16, 1, 64);
    const pattern = `%${escapeSqlString(query)}%`;
    const rows = await apiPost("/api/query/sql", {
      stmt: [
        "select id, root_id, box, path, hpath, type, content, markdown, updated",
        "from blocks",
        `where (content like '${pattern}' or markdown like '${pattern}' or hpath like '${pattern}')`,
        "order by updated desc",
        `limit ${limit * 4}`
      ].join(" ")
    }, nextRuntime);
    const blocks = (Array.isArray(rows) ? rows : [])
      .filter((block) => !block.box || permissionForNotebook(config, block.box) !== "none")
      .slice(0, limit);
    return toMcpText({query, blocks});
  }

  if (name === "siyuan_read_doc") {
    const id = String(args.id || "").trim();
    if (!id) {
      throw new Error("id is required");
    }
    const notebookId = await queryBlockBox(id, nextRuntime);
    assertNotebookPermission(config, notebookId, "r");
    const data = await apiPost("/api/block/getBlockKramdown", {id}, nextRuntime);
    return toMcpText({id, notebook: notebookId, kramdown: data.kramdown || data});
  }

  if (name === "siyuan_create_doc") {
    const notebook = String(args.notebook || "").trim();
    const path = String(args.path || "").trim();
    const markdown = typeof args.markdown === "string" ? args.markdown : "";
    if (!notebook || !path) {
      throw new Error("notebook and path are required");
    }
    assertNotebookPermission(config, notebook, "rw");
    const data = await apiPost("/api/filetree/createDocWithMd", {notebook, path, markdown}, nextRuntime);
    return toMcpText({notebook, path, id: data});
  }

  if (name === "siyuan_append_block") {
    const parentID = String(args.parentId || "").trim();
    const data = typeof args.markdown === "string" ? args.markdown : "";
    if (!parentID || !data) {
      throw new Error("parentId and markdown are required");
    }
    const notebookId = await queryBlockBox(parentID, nextRuntime);
    assertNotebookPermission(config, notebookId, "rw");
    const result = await apiPost("/api/block/appendBlock", {dataType: "markdown", data, parentID}, nextRuntime);
    return toMcpText({parentId: parentID, notebook: notebookId, result});
  }

  if (name === "siyuan_update_block") {
    const id = String(args.id || "").trim();
    const data = typeof args.markdown === "string" ? args.markdown : "";
    if (!id || !data) {
      throw new Error("id and markdown are required");
    }
    const notebookId = await queryBlockBox(id, nextRuntime);
    assertNotebookPermission(config, notebookId, "rw");
    const result = await apiPost("/api/block/updateBlock", {dataType: "markdown", data, id}, nextRuntime);
    return toMcpText({id, notebook: notebookId, result});
  }

  if (name === "siyuan_delete_block") {
    const id = String(args.id || "").trim();
    if (!id) {
      throw new Error("id is required");
    }
    const notebookId = await queryBlockBox(id, nextRuntime);
    assertNotebookPermission(config, notebookId, "rwd");
    const result = await apiPost("/api/block/deleteBlock", {id}, nextRuntime);
    return toMcpText({id, notebook: notebookId, result});
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(message, runtime = {}) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {tools: {}},
        serverInfo: {name: PLUGIN_NAME, version: "0.1.1"}
      }
    };
  }
  if (message.method === "notifications/initialized") {
    return null;
  }
  if (message.method === "ping") {
    return {jsonrpc: "2.0", id: message.id, result: {}};
  }
  if (message.method === "tools/list") {
    return {jsonrpc: "2.0", id: message.id, result: {tools: toolDefinitions}};
  }
  if (message.method === "tools/call") {
    try {
      const result = await executeTool(message.params && message.params.name, message.params && message.params.arguments || {}, runtime);
      return {jsonrpc: "2.0", id: message.id, result};
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          isError: true,
          content: [{type: "text", text: error instanceof Error ? error.message : String(error)}]
        }
      };
    }
  }
  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {code: -32601, message: `Method not found: ${message.method}`}
    };
  }
  return null;
}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body
  ]);
}

function createFrameParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new Error("Missing Content-Length header");
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) {
        return;
      }
      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      onMessage(JSON.parse(body));
    }
  };
}

function startStdioServer(runtime = {}) {
  const write = runtime.write || ((message) => process.stdout.write(encodeMessage(message)));
  const parser = createFrameParser(async (message) => {
    try {
      const response = await handleRequest(message, runtime);
      if (response) {
        write(response);
      }
    } catch (error) {
      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        write({
          jsonrpc: "2.0",
          id: message.id,
          error: {code: -32603, message: error instanceof Error ? error.message : String(error)}
        });
      }
    }
  });
  process.stdin.on("data", parser);
}

module.exports = {
  CONFIG_API_PATH,
  DEFAULT_API_URL,
  PERMISSION_LEVELS,
  apiGetFile,
  apiPost,
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
};

if (require.main === module) {
  startStdioServer();
}
