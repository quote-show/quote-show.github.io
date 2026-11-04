import assert from "node:assert/strict";
import fs from "node:fs";
import { quoteProduct } from "../js/calc.js";
import { loadSavings } from "./load-savings.mjs";

const load = (code) => loadSavings(`data/savings/${code}.json`);

// 對照 quote-yt 各商品頁 SRV 表（每萬元因子）。第 1 年尚無增額繳清，領回＝因子 × 保額。
const cases = [
  { code: "XMP", key: "2|1|30", factors: [144, 288, 288], sum: 20, year1: 2880 },
  { code: "PAC", key: "6|1|30", factors: [17, 34, 51], sum: 20, year1: 340 },
  { code: "PAK", key: "2|1|30", factors: [2640, 5520, 5436], sum: 2, year1: 5280 },
];

for (const item of cases) {
  const product = load(item.code);
  const factors = product.tables.srv[item.key].slice(0, item.factors.length);
  assert.deepEqual(factors, item.factors, `${item.code} 生存金因子`);
  const quote = quoteProduct(product, { age: 30, sex: 1, term: Number(item.key.split("|")[0]), sum: item.sum, scenario: 2, mode: product.monthlySurvival ? "PUA" : "CASH" });
  assert.equal(quote.rows[0].surv, item.year1, `${item.code} 第 1 年領回`);
  assert.equal(quote.rows[0].age, 30);
}

const deferred = quoteProduct(load("PF55"), { age: 40, sex: 1, term: 6, sum: 10, scenario: 2 });
const first = deferred.rows.find((row) => row.surv > 0);
assert.equal(first.t, 15);
assert.equal(first.age, 54);

const index = JSON.parse(fs.readFileSync("data/savings-index.json", "utf8"));
assert.equal(index.filter((item) => item.survival).length, 47);
assert.equal(index.filter((item) => item.annuity).length, 5);
assert.ok(index.some((item) => item.code === "XMP" && item.survival));
assert.ok(index.some((item) => item.code === "FAK1" && !item.survival && !item.annuity));

console.log("survival tests ok");
