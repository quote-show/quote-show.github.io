import assert from "node:assert/strict";
import { annualPayable, preferredSavingsMode, quoteProduct, savingsModes } from "../js/calc.js";
import { solveFace } from "../js/compare-solve.js";
import { loadSavings } from "./load-savings.mjs";

const fak = loadSavings("data/savings/FAK1.json");
const faz = loadSavings("data/savings/FAZ.json");
const id = "6|1|40";
const mode = preferredSavingsMode(fak, savingsModes(fak, id));
const input = { age: 40, sex: 1, term: 6, scenario: 2, declaredRate: fak.declDefault, mode };

for (const sum of [1, 7.96, 10, 40]) {
  const payable = annualPayable(fak, { ...input, sum });
  const quoted = quoteProduct(fak, { ...input, sum });
  assert.equal(payable, quoted.payable, `FAK1 ${sum} 年繳保費要和試算一致`);
}

const solved = solveFace(fak, input, 6000);
assert.equal(solved.sum, 7.96);
assert.equal(solved.payable, 5996);
const quoted = quoteProduct(fak, { ...input, sum: solved.sum });
assert.equal(Math.round(quoted.rows[4].X), 23178);
assert.equal(Math.round(quoted.rows[9].X), 41031);
assert.equal(Math.round(quoted.rows[14].X), 48857);

const other = solveFace(faz, {
  ...input,
  declaredRate: faz.declDefault,
  mode: preferredSavingsMode(faz, savingsModes(faz, id)),
}, 6000);
assert.equal(other.sum, 10.82);
assert.equal(other.payable, 5998);

assert.equal(solveFace(fak, input, 100).note, "保費不足最低投保額");
assert.equal(solveFace(fak, input, 200000).note, "超過保額上限");

console.log("compare premium tests ok");
