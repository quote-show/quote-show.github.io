import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quoteProduct } from "../js/calc.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const fbo = load("data/savings/FBO.json");
const saved = quoteProduct(fbo, { age: 39, sex: 1, term: 2, sum: 10, declaredRate: 0.0435, mode: "PS" });
assert.equal(saved.payable, 14652);
assert.equal(saved.feedback1, 316);
assert.equal(saved.rows[0].N, 1276);
assert.equal(saved.store7, 877);
assert.equal(saved.store10, 3793);
assert.equal(saved.rows[9].W, 109578);
assert.equal(saved.rows[9].X, 35270);

const saz = load("data/savings/SAZ.json");
const sazQuote = quoteProduct(saz, { age: 16, sex: 2, term: 1, sum: 60000, declaredRate: 0.041 });
assert.equal(sazQuote.firstPayment, 138.87);
assert.equal(sazQuote.month2, 139.05);
assert.equal(sazQuote.loadingAmount, 3300);

const sba = load("data/savings/SBA.json");
const sbaQuote = quoteProduct(sba, { age: 49, sex: 1, term: 1, sum: 2000000, declaredRate: 0.026 });
assert.equal(sbaQuote.firstPayment, 5444);
assert.equal(sbaQuote.month2, 5447);
assert.equal(sbaQuote.loadingAmount, 110000);

const sbc = load("data/savings/SBC1.json");
const sbcQuote = quoteProduct(sbc, { age: 7, sex: 2, term: 1, sum: 30000, declaredRate: 0.041 });
assert.equal(sbcQuote.firstPayment, 188.96);
assert.equal(sbcQuote.month2, 189.2);
assert.equal(sbcQuote.rows.length, 15);

const mgd = load("data/protection/MGD2.json");
assert.equal(mgd.status, "stopped");
assert.equal(mgd.stop, "2021-01-01");
assert.equal(quoteProduct(mgd, { age: 24, sex: 1, occupation: 1, plan: "計畫一", mode: "annual" }).payable, 1127);
assert.equal(quoteProduct(mgd, { age: 25, sex: 2, occupation: 4, plan: "計畫三", mode: "annual" }).payable, 8319);
assert.equal(quoteProduct(mgd, { age: 15, sex: 1, occupation: 1, plan: "計畫一", mode: "semi" }).payable, 586);
assert.throws(() => quoteProduct(mgd, { age: 30, sex: 1, occupation: 5, plan: "計畫一", mode: "annual" }));

const skipped = load("data/skipped.json").map((item) => item.code);
for (const code of ["QNY", "DAA", "SAU", "UWA2"]) assert.ok(skipped.includes(code));
for (const code of ["FBO", "SAZ", "SBA", "SBC1", "SBC2", "SBC3", "JAX"]) assert.equal(skipped.includes(code), false);

console.log("official tests ok");
