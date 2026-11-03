import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quoteProduct } from "../js/calc.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/products.json"), "utf8"));
let checks = 0;
const mismatches = [];

function actual(result, key) {
  if (key === "annual") return result.annual;
  if (key === "payable") return result.payable;
  if (key === "renewal") return result.renewal;
  const row = result.rows[Math.min(9, result.rows.length - 1)];
  if (key === "surrender10") return row.X;
  if (key === "death10") return row.W;
  return result[key];
}

for (const item of catalog.products) {
  const product = JSON.parse(fs.readFileSync(path.join(root, "data", item.file), "utf8"));
  const samples = product.verificationSamples || [];
  if (samples.length < 3) {
    mismatches.push(`${item.code} 少於 3 組樣本`);
    continue;
  }
  for (const sample of samples) {
    let result;
    try {
      result = quoteProduct(product, sample);
    } catch (error) {
      mismatches.push(`${item.code} ${error.message}`);
      continue;
    }
    for (const [key, expect] of Object.entries(sample.expect)) {
      checks += 1;
      const got = actual(result, key);
      if (typeof expect === "number" && typeof got === "number" && Math.abs(got - expect) < 1e-6) continue;
      mismatches.push(`${item.code} ${key} 預期 ${expect} 得到 ${got}`);
    }
  }
}

if (mismatches.length) {
  console.error(mismatches.slice(0, 30).join("\n"));
  console.error(`ported tests failed: ${mismatches.length} mismatches, ${checks} numeric checks`);
  process.exit(1);
}
assert.ok(checks > 0);
console.log(`ported tests ok (${catalog.products.length} products, ${checks} checks)`);
