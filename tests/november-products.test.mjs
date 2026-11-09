import assert from "node:assert/strict";
import { quoteProduct, quoteRpu } from "../js/calc.js";
import { loadSavings } from "./load-savings.mjs";

const fpg = loadSavings("data/savings/FPG.json");
const fby = loadSavings("data/savings/FBY.json");

assert.equal(fpg.sources[0].site, "行動辦公室 商品專區");
assert.equal(fpg.sources[0].fetched, "2026-11-09");
assert.equal(fpg.version, "V1.0-1151106");
assert.equal(fby.sources[0].version, "V1.0-1151106");
assert.equal(fby.declDefault, 0.0435);
assert.equal(fby.declLabel, "115年10月");
assert.equal(fby.defaultMode, "PS");

function at(product, input, year) {
  const row = quoteProduct(product, input).rows[year - 1];
  return [row.W, row.X];
}

const mid = { age: 0, sex: 1, term: 5, sum: 25, scenario: 2, mode: "PUA" };
assert.deepEqual(at(fpg, mid, 1), [42500, 7175]);
assert.deepEqual(at(fpg, mid, 20), [801213, 128530]);
assert.deepEqual(at(fpg, { ...mid, scenario: 1 }, 10), [382224, 83461]);
assert.deepEqual(at(fpg, { ...mid, scenario: 1 }, 20), [415812, 101649]);
assert.equal(quoteRpu(fpg, { ...mid, rpuYear: 1 }).reducedSum, 27550);

const fbyMid = { age: 40, sex: 1, term: 3, sum: 20, declaredRate: 0.0435, mode: "PS" };
assert.deepEqual(at(fby, fbyMid, 1), [23251, 12409]);
assert.deepEqual(at(fby, fbyMid, 6), [218016, 61044]);
assert.deepEqual(at(fby, fbyMid, 7), [215277, 63884]);
assert.deepEqual(at(fby, fbyMid, 20), [196691, 102892]);
assert.equal(quoteRpu(fby, { ...fbyMid, rpuYear: 1 }).reducedSum, 47960);
assert.deepEqual(at(fby, { age: 55, sex: 2, term: 3, sum: 20, declaredRate: 0.0435, mode: "PS" }, 1), [29300, 16676]);
assert.deepEqual(at(fby, { age: 26, sex: 1, term: 3, sum: 15, declaredRate: 0.0435, mode: "PS" }, 20), [138887, 50428]);

console.log("november product checks passed");
