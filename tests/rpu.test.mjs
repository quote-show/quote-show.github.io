import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quoteRpu } from "../js/calc.js";
import { loadSavings } from "./load-savings.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const checks = JSON.parse(fs.readFileSync(path.join(root, "data/rpu-checks.json"), "utf8"));
assert.ok(checks.length >= 9, "減額繳清至少要涵蓋三種商品、各三組");
const byCode = {};
for (const check of checks) byCode[check.code] = (byCode[check.code] || 0) + 1;
for (const code of ["PFZA", "FBQ", "XMP"]) assert.ok(byCode[code] >= 3, code);

for (const check of checks) {
  const product = loadSavings(path.join(root, "data/savings", `${check.code}.json`));
  const result = quoteRpu(product, check);
  assert.equal(result.reducedSum, check.expect.reducedSum, `${check.code} 減額保額`);
  if (check.expect.sumOnly) {
    assert.equal(result.sumOnly, true);
    continue;
  }
  const row = result.rows[check.expect.at - 1];
  assert.equal(row.W, check.expect.death, `${check.code} 身故`);
  assert.equal(row.X, check.expect.surrender, `${check.code} 解約`);
}

const fbo = loadSavings(path.join(root, "data/savings/FBO.json"));
const fboResult = quoteRpu(fbo, { age: 39, sex: 1, term: 2, sum: 10, rpuYear: 1, declaredRate: 0.0435, mode: "PS" });
assert.equal(fboResult.reducedSum, 40610);

console.log(`rpu tests ok (${checks.length} reference cases)`);
