"use strict";

const {spawnSync} = require("child_process");
const path = require("path");

const tests = [
  "unit.test.cjs",
  "live-readonly.test.cjs",
  "live-write-smoke.test.cjs",
  "full-functional.test.cjs",
  "protocol-smoke.test.cjs"
];

for (const test of tests) {
  const file = path.join(__dirname, test);
  const result = spawnSync(process.execPath, [file], {stdio: "inherit"});
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("all tests passed");
