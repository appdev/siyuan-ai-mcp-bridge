"use strict";

const assert = require("assert");
const {executeTool, normalizeConfig} = require("../mcp-server.cjs");

async function run() {
  const config = normalizeConfig({
    siyuanApiUrl: process.env.SIYUAN_API_URL || "http://127.0.0.1:6806",
    siyuanToken: process.env.SIYUAN_API_TOKEN || "",
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
  });

  const info = JSON.parse((await executeTool("siyuan_system_info", {}, {config})).content[0].text);
  assert.match(String(info.version), /^\d+\.\d+\.\d+/);

  const notebooks = JSON.parse((await executeTool("siyuan_list_notebooks", {}, {config})).content[0].text);
  assert.ok(Array.isArray(notebooks.notebooks));
  assert.ok(notebooks.notebooks.length > 0);

  await assert.rejects(
    () => executeTool("siyuan_create_doc", {
      notebook: notebooks.notebooks[0].id,
      path: "/__mcp_should_not_create.md",
      markdown: "should be denied"
    }, {config}),
    /Tool disabled/
  );
}

run().then(() => {
  console.log("live readonly tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
