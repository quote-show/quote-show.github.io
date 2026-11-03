import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { listRiders, personEligible, quoteBundle } from "../js/bundle.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ref = process.env.REFERENCE_DIR || "/tmp/ref/baojia";
const context = { console, Math, Date, Object, String, Number, JSON, Array, parseInt, isNaN, RegExp };
context.window = context;
context.window.__ENGINE_ONLY = true;
context.window.PRODUCTS = [];
vm.createContext(context);
for (const file of ["data.js", "data_life.js", "data_mains.js", "catalog.js", "riders_rates.js", "app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ref, file), "utf8"), context, { filename: file });
}
const engine = context.QuoteEngine;
const products = context.PRODUCTS;
const modeMap = { annual: "年繳", semi: "半年繳", quarterly: "季繳", monthly: "月繳" };

function load(code) {
  return JSON.parse(fs.readFileSync(path.join(root, "data/protection", `${code}.json`), "utf8"));
}

function reference(combo) {
  const main = products.find((item) => item.code === combo.main.code);
  const mainQuote = engine.quote(main, {
    age: combo.age, sex: combo.sex, occ: combo.occupation, term: combo.main.term, sum: combo.main.sum,
    mode: modeMap[combo.mode], payDisc: combo.payDiscount !== false,
  });
  const lines = [{ code: combo.main.code, annual: mainQuote.annual, paid: mainQuote.paid }];
  let covered = mainQuote.annual;
  for (const rider of combo.riders || []) {
    if (["WP", "WPA", "WPF1", "WPH"].includes(rider.code)) continue;
    const quote = engine.rQuote(rider.code, {
      age: combo.age, sex: combo.sex, occ: combo.occupation, term: rider.term || combo.main.term,
      sum: rider.sum, plan: rider.plan, mode: modeMap[combo.mode], payDisc: combo.payDiscount !== false,
    });
    if (quote.errs) throw new Error(`${rider.code} ${quote.errs.join("；")}`);
    lines.push({ code: rider.code, annual: quote.annual, paid: quote.paid });
    if (quote.cur !== "USD") covered += quote.annual;
  }
  covered = Math.round(covered * 10) / 10;
  for (const rider of combo.riders || []) {
    if (!["WP", "WPA", "WPF1", "WPH"].includes(rider.code)) continue;
    const quote = engine.rQuote(rider.code, {
      age: rider.code === "WPA" || rider.code === "WPF1" ? combo.parentAge : combo.age,
      sex: rider.code === "WPA" || rider.code === "WPF1" ? (combo.parentSex || combo.sex) : combo.sex,
      occ: combo.occupation, term: combo.main.term, covered,
      mode: modeMap[combo.mode], payDisc: combo.payDiscount !== false,
    });
    if (quote.errs) throw new Error(`${rider.code} ${quote.errs.join("；")}`);
    lines.push({ code: rider.code, annual: quote.annual, paid: quote.paid, covered });
  }
  return { lines, total: lines.reduce((sum, line) => sum + line.paid, 0), covered };
}

const combos = [
  { age: 30, sex: 1, occupation: 1, mode: "annual", payDiscount: true, main: { code: "XWS5", term: 20, sum: 100 }, riders: [{ code: "ADG", sum: 100 }, { code: "HJK", sum: 1000 }, { code: "WP" }] },
  { age: 40, sex: 2, occupation: 1, mode: "annual", payDiscount: true, main: { code: "XWS5", term: 20, sum: 50 }, riders: [{ code: "SDL", sum: 50 }] },
  { age: 35, sex: 1, occupation: 2, mode: "semi", payDiscount: true, main: { code: "OLA6", term: 20, sum: 30 }, riders: [{ code: "ADH", sum: 20 }] },
  { age: 25, sex: 1, occupation: 1, mode: "monthly", payDiscount: false, main: { code: "XWS5", term: 20, sum: 20 }, riders: [{ code: "HJK", sum: 2000 }] },
  { age: 45, sex: 1, occupation: 1, mode: "annual", payDiscount: true, main: { code: "SDG", term: 20, sum: 100 }, riders: [{ code: "ADG", sum: 100 }, { code: "TMR", sum: 10 }] },
  { age: 10, sex: 2, occupation: 1, mode: "quarterly", payDiscount: true, parentAge: 40, parentSex: 1, main: { code: "XWS5", term: 20, sum: 100 }, riders: [{ code: "ADG", sum: 50 }, { code: "WPA" }] },
];

const byCode = {};
for (const combo of combos) {
  byCode[combo.main.code] = load(combo.main.code);
  for (const rider of combo.riders) byCode[rider.code] = load(rider.code);
}

for (const combo of combos) {
  const expected = reference(combo);
  const actual = quoteBundle(byCode, combo);
  assert.equal(actual.errors.length, 0, `${combo.main.code} ${actual.errors.join("；")}`);
  assert.equal(actual.lines.length, expected.lines.length);
  expected.lines.forEach((line, index) => {
    assert.equal(actual.lines[index].code, line.code);
    assert.equal(actual.lines[index].annual, line.annual, `${line.code} 年繳`);
    assert.equal(actual.lines[index].payable, line.paid, `${line.code} 本期`);
  });
  assert.equal(actual.totalPayable, expected.total, "合計");
  if (expected.covered) assert.equal(actual.covered, expected.covered);
}

const blocked = quoteBundle(
  { XWS5: load("XWS5"), HLR2: load("HLR2") },
  { age: 30, sex: 1, occupation: 1, mode: "annual", main: { code: "XWS5", term: 20, sum: 100 }, riders: [{ code: "HLR2", sum: 1000, term: 20 }] },
);
assert.ok(blocked.lines.some((line) => line.code === "HLR2" && line.error));

const catalog = {};
for (const file of fs.readdirSync(path.join(root, "data/protection"))) {
  if (!file.endsWith(".json")) continue;
  const product = JSON.parse(fs.readFileSync(path.join(root, "data/protection", file), "utf8"));
  catalog[product.code] = product;
}
const person = { age: 30, sex: 1, occupation: 1, parentAge: "", main: "XWS5", chosen: ["ADG"] };
const menu = listRiders(catalog, person);
assert.ok(menu.attachable.some((item) => item.code === "ADG" && item.kind === "sum"));
assert.ok(menu.attachable.some((item) => item.code === "HJK" && item.unit === "元／日"));
assert.ok(menu.attachable.some((item) => item.code === "TMR"), "勾了 ADG 才可勾 TMR");
assert.ok(menu.attachable.some((item) => item.category && menu.attachable.filter((row) => row.category === item.category).length >= 1));
const categories = menu.attachable.map((item) => item.category);
assert.deepEqual(categories, [...categories].sort((a, b) => a.localeCompare(b, "zh-Hant")));
assert.ok(menu.blocked.some((item) => item.code === "HLR2" && item.why.includes("HIY1")));
assert.ok(menu.blocked.some((item) => item.code === "CMR" && item.why.includes("SDG")));
const withoutAdg = listRiders(catalog, { ...person, chosen: [] });
assert.ok(withoutAdg.blocked.some((item) => item.code === "TMR" && item.why.includes("ADG")));
const older = listRiders(catalog, { ...person, age: 75, chosen: [] });
assert.ok(older.blocked.some((item) => item.code === "HJK" && item.why.includes("投保年齡")));
const parent = listRiders(catalog, { ...person, age: 10, parentAge: 70, chosen: [] });
assert.ok(parent.blocked.some((item) => item.code === "WPA" && item.why.includes("要保人")));
assert.equal(personEligible(load("CLZ"), { age: 30, sex: 2, occupation: 1 }).why, "男性專屬商品");
const paired = listRiders(catalog, { ...person, chosen: ["CWR4"] });
assert.ok(paired.attachable.some((item) => item.code === "CMR"));

console.log(`bundle tests ok (${combos.length} combinations)`);
