"use strict";

const assert = require("assert");
const {apiPost, executeTool, normalizeConfig} = require("../mcp-server.cjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickNotebook() {
  const data = await apiPost("/api/notebook/lsNotebooks", {});
  const notebooks = data.notebooks || [];
  return notebooks.find((notebook) => !notebook.closed && notebook.name === "备忘录") ||
    notebooks.find((notebook) => !notebook.closed);
}

async function run() {
  const notebook = await pickNotebook();
  assert.ok(notebook && notebook.id, "No open notebook available for write smoke test");

  const path = `/__codex_mcp_bridge_smoke_${Date.now()}.md`;
  const marker = `mcp bridge smoke ${Date.now()}`;
  const config = normalizeConfig({
    defaultNotebookPermission: "none",
    notebookPermissions: {[notebook.id]: "rwd"},
    tools: {
      systemInfo: true,
      listNotebooks: true,
      search: true,
      readDoc: true,
      createDoc: true,
      appendBlock: true,
      updateBlock: true,
      deleteBlock: true
    }
  });

  let createdId = "";
  let internalPath = "";
  try {
    const created = JSON.parse((await executeTool("siyuan_create_doc", {
      notebook: notebook.id,
      path,
      markdown: `# MCP Bridge Smoke\n\n${marker}`
    }, {config})).content[0].text);
    createdId = typeof created.id === "string" ? created.id : String(created.id || "");
    assert.ok(createdId, "create_doc did not return document id");
    internalPath = await apiPost("/api/filetree/getPathByID", {id: createdId});

    const read = JSON.parse((await executeTool("siyuan_read_doc", {id: createdId}, {config})).content[0].text);
    assert.ok(String(read.kramdown).includes(marker));

    const appended = JSON.parse((await executeTool("siyuan_append_block", {
      parentId: createdId,
      markdown: "Appended by MCP bridge smoke test."
    }, {config})).content[0].text);
    assert.equal(appended.notebook, notebook.id);
  } finally {
    if (createdId) {
      await apiPost("/api/filetree/removeDocByID", {id: createdId}).catch((error) => {
        console.error(`cleanup failed for ${createdId}:`, error);
        process.exitCode = 1;
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(250);
        const rows = await apiPost("/api/query/sql", {
          stmt: `select id from blocks where id='${createdId.replace(/'/g, "''")}' limit 1`
        });
        if (Array.isArray(rows) && rows.length === 0) {
          return;
        }
      }
      if (internalPath) {
        await apiPost("/api/filetree/removeDoc", {notebook: notebook.id, path: internalPath}).catch(() => {});
      }
      await sleep(500);
    }
  }
}

run().then(() => {
  console.log("live write smoke tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
