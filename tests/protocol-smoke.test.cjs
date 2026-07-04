"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {spawn} = require("child_process");
const {encodeMessage} = require("../mcp-server.cjs");

function createResponseParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      assert.ok(match, `missing Content-Length in ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      onMessage(JSON.parse(body));
    }
  };
}

function waitFor(responses, id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = responses.find((response) => response.id === id);
      if (hit) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout waiting for response ${id}`));
      }
    }, 20);
  });
}

async function run() {
  const configPath = path.join(os.tmpdir(), `siyuan-ai-mcp-bridge-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    siyuanApiUrl: process.env.SIYUAN_API_URL || "http://127.0.0.1:6806",
    defaultNotebookPermission: "r",
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
  }));

  const child = spawn(process.execPath, [path.resolve(__dirname, "../mcp-server.cjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {...process.env, SIYUAN_MCP_BRIDGE_CONFIG: configPath}
  });
  const responses = [];
  child.stdout.on("data", createResponseParser((message) => responses.push(message)));
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write(encodeMessage({jsonrpc: "2.0", id: 1, method: "initialize", params: {}}));
  const init = await waitFor(responses, 1);
  assert.equal(init.result.serverInfo.name, "siyuan-ai-mcp-bridge");

  child.stdin.write(encodeMessage({jsonrpc: "2.0", id: 2, method: "tools/list", params: {}}));
  const list = await waitFor(responses, 2);
  assert.ok(list.result.tools.some((tool) => tool.name === "siyuan_list_notebooks"));

  child.stdin.write(encodeMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {name: "siyuan_system_info", arguments: {}}
  }));
  const call = await waitFor(responses, 3);
  assert.ok(call.result.content[0].text.includes("version"));

  child.kill();
  fs.unlinkSync(configPath);
  assert.equal(stderr, "");
}

run().then(() => {
  console.log("protocol smoke tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
