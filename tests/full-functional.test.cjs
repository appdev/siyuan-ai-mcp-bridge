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

function readText(result) {
  return result.content[0].text;
}

function readJson(result) {
  return JSON.parse(readText(result));
}

async function expectDenied(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    assert.match(error.message, pattern);
    return;
  }
  assert.fail(`Expected denial matching ${pattern}`);
}

async function queryFirstBlockByContent(content) {
  const escaped = String(content).replace(/'/g, "''");
  const rows = await apiPost("/api/query/sql", {
    stmt: `select id, box, content from blocks where content like '%${escaped}%' order by updated desc limit 1`
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function queryBlockById(id) {
  const rows = await apiPost("/api/query/sql", {
    stmt: `select id, box, content from blocks where id='${String(id).replace(/'/g, "''")}' limit 1`
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function waitForBlockById(id) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const block = await queryBlockById(id);
    if (block) {
      return block;
    }
    await sleep(300);
  }
  return null;
}

function firstOperationId(result) {
  const transaction = Array.isArray(result) ? result[0] : null;
  const operation = transaction && Array.isArray(transaction.doOperations) ? transaction.doOperations[0] : null;
  return operation && typeof operation.id === "string" ? operation.id : "";
}

async function waitUntilBlockMissing(id, attempts = 16) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(250);
    const rows = await apiPost("/api/query/sql", {
      stmt: `select id from blocks where id='${String(id).replace(/'/g, "''")}' limit 1`
    });
    if (Array.isArray(rows) && rows.length === 0) {
      return;
    }
  }
  assert.fail(`Block still exists after cleanup wait: ${id}`);
}

async function waitForSearchResult(query, config) {
  let lastSearch = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    lastSearch = readJson(await executeTool("siyuan_search", {query, limit: 4}, {config}));
    if (lastSearch.blocks.length >= 1) {
      return lastSearch;
    }
    await sleep(300);
  }
  return lastSearch;
}

async function cleanupDocument(id, notebook, internalPath) {
  if (!id) {
    return;
  }
  await apiPost("/api/filetree/removeDocByID", {id}).catch(() => {});
  try {
    await waitUntilBlockMissing(id);
  } catch (error) {
    if (internalPath) {
      await apiPost("/api/filetree/removeDoc", {notebook, path: internalPath}).catch(() => {});
      await waitUntilBlockMissing(id, 20);
      return;
    }
    throw error;
  }
}

async function run() {
  const notebook = await pickNotebook();
  assert.ok(notebook && notebook.id, "No open notebook available for full functional test");

  const stamp = Date.now();
  const docPath = `/__codex_mcp_bridge_full_${stamp}.md`;
  const title = `MCP Bridge Full ${stamp}`;
  const marker = `mcp bridge full marker ${stamp}`;
  const appendedMarker = `mcp bridge appended marker ${stamp}`;
  const updatedMarker = `mcp bridge updated marker ${stamp}`;
  let docId = "";
  let internalPath = "";

  const fullConfig = normalizeConfig({
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

  try {
    const info = readJson(await executeTool("siyuan_system_info", {}, {config: fullConfig}));
    assert.ok(info.version, "system info should include version");
    assert.equal(info.defaultNotebookPermission, "none");
    assert.ok(info.enabledTools.includes("deleteBlock"));

    const listed = readJson(await executeTool("siyuan_list_notebooks", {}, {config: fullConfig}));
    assert.ok(listed.notebooks.some((item) => item.id === notebook.id && item.permission === "rwd"));
    assert.ok(listed.notebooks.every((item) => item.permission !== "none"));

    const created = readJson(await executeTool("siyuan_create_doc", {
      notebook: notebook.id,
      path: docPath,
      markdown: `# ${title}\n\n${marker}`
    }, {config: fullConfig}));
    docId = String(created.id || "");
    assert.ok(docId, "create_doc should return document id");
    internalPath = await apiPost("/api/filetree/getPathByID", {id: docId});

    const readInitial = readJson(await executeTool("siyuan_read_doc", {id: docId}, {config: fullConfig}));
    assert.equal(readInitial.notebook, notebook.id);
    assert.ok(String(readInitial.kramdown).includes(marker));

    const search = await waitForSearchResult(marker, fullConfig);
    assert.equal(search.query, marker);
    assert.ok(search.blocks.length >= 1, "search should find the temporary document marker");

    const appended = readJson(await executeTool("siyuan_append_block", {
      parentId: docId,
      markdown: appendedMarker
    }, {config: fullConfig}));
    assert.equal(appended.notebook, notebook.id);

    const appendedId = firstOperationId(appended.result);
    assert.ok(appendedId, "append_block should return inserted block id");
    const appendedBlock = await waitForBlockById(appendedId) || await queryFirstBlockByContent(appendedMarker);
    assert.ok(appendedBlock && appendedBlock.id, "append_block should create a searchable child block");
    assert.equal(appendedBlock.box, notebook.id);

    const updated = readJson(await executeTool("siyuan_update_block", {
      id: appendedBlock.id,
      markdown: updatedMarker
    }, {config: fullConfig}));
    assert.equal(updated.notebook, notebook.id);

    const readUpdated = readJson(await executeTool("siyuan_read_doc", {id: docId}, {config: fullConfig}));
    assert.ok(String(readUpdated.kramdown).includes(updatedMarker));
    assert.ok(!String(readUpdated.kramdown).includes(appendedMarker));

    const deleted = readJson(await executeTool("siyuan_delete_block", {id: appendedBlock.id}, {config: fullConfig}));
    assert.equal(deleted.notebook, notebook.id);
    await waitUntilBlockMissing(appendedBlock.id);

    const hiddenConfig = normalizeConfig({
      ...fullConfig,
      notebookPermissions: {[notebook.id]: "none"}
    });
    const hiddenList = readJson(await executeTool("siyuan_list_notebooks", {}, {config: hiddenConfig}));
    assert.ok(!hiddenList.notebooks.some((item) => item.id === notebook.id), "none permission should hide notebook from list");
    await expectDenied(executeTool("siyuan_read_doc", {id: docId}, {config: hiddenConfig}), /requires r, current none/);

    const readOnlyConfig = normalizeConfig({
      ...fullConfig,
      notebookPermissions: {[notebook.id]: "r"}
    });
    await executeTool("siyuan_read_doc", {id: docId}, {config: readOnlyConfig});
    await expectDenied(executeTool("siyuan_append_block", {
      parentId: docId,
      markdown: "should be denied"
    }, {config: readOnlyConfig}), /requires rw, current r/);

    const writeConfig = normalizeConfig({
      ...fullConfig,
      notebookPermissions: {[notebook.id]: "rw"}
    });
    await expectDenied(executeTool("siyuan_delete_block", {id: docId}, {config: writeConfig}), /requires rwd, current rw/);

    const toolDisabledConfig = normalizeConfig({
      ...fullConfig,
      tools: {...fullConfig.tools, search: false}
    });
    await expectDenied(executeTool("siyuan_search", {query: marker}, {config: toolDisabledConfig}), /Tool disabled/);
  } finally {
    await cleanupDocument(docId, notebook.id, internalPath);
  }
}

run().then(() => {
  console.log("full functional tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
