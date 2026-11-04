import assert from "node:assert/strict";
import { quoteProduct } from "../js/calc.js";
import { resolveAge } from "../js/ui.js";
import { loadSavings } from "./load-savings.mjs";

assert.equal(resolveAge("", 0, 74).error, "請輸入年齡");
assert.equal(resolveAge("abc", 0, 74).error, "年齡必須是數字");
assert.deepEqual(resolveAge("30.5", 0, 74), { age: 30, notes: ["年齡 30.5 已調整為 30 歲"] });
assert.deepEqual(resolveAge("150", 0, 74), { age: 74, notes: ["投保年齡要在 0–74 歲，已調整為 74 歲"] });
assert.deepEqual(resolveAge("-1", 0, 74), { age: 0, notes: ["投保年齡要在 0–74 歲，已調整為 0 歲"] });

const pfa = loadSavings("data/savings/PFA.json");
assert.equal(pfa.sumInsured.max, 600);
const pfaQuote = quoteProduct(pfa, { age: 40, sex: 1, term: 6, sum: 10, mode: "PUA" });
assert.ok(pfaQuote.rows.length > 0);

const pfj = loadSavings("data/savings/PFJ.json");
assert.equal(pfj.sumInsured.max, 300);

const fbn = loadSavings("data/savings/FBN.json");
assert.equal(fbn.currency, "AUD");

const fpc = loadSavings("data/savings/FPC.json");
assert.equal(fpc.currency, "USD");
assert.deepEqual(Object.keys(fpc.issueAges), ["1"]);

function year(product, input, t) {
  const row = quoteProduct(product, input).rows.find((item) => item.t === t);
  return [row.W, row.X];
}

const base = { sex: 1, term: 1, sum: 10, mode: "PUA" };
assert.deepEqual(year(fpc, { ...base, age: 40, scenario: 2 }, 1), [50000, 21690]);
assert.deepEqual(year(fpc, { ...base, age: 40, scenario: 2 }, 10), [118644, 35022]);
assert.deepEqual(year(fpc, { ...base, age: 40, scenario: 2 }, 20), [124286, 51250]);
assert.deepEqual(year(fpc, { ...base, age: 40, scenario: 1 }, 10), [101048, 29319]);
assert.deepEqual(year(fpc, { ...base, age: 40, scenario: 3 }, 10), [89620, 25600]);
assert.deepEqual(year(fpc, { ...base, age: 30, scenario: 2 }, 10), [118053, 24732]);
assert.deepEqual(year(fpc, { age: 40, sex: 2, term: 1, sum: 10, mode: "PUA", scenario: 2 }, 10), [117230, 27697]);
assert.deepEqual(year(fpc, { age: 40, sex: 2, term: 1, sum: 10, mode: "PUA", scenario: 2 }, 20), [120642, 41368]);

console.log("audit checks passed");
