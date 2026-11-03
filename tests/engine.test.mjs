import assert from "node:assert/strict";
import {
  insuranceAge,
  premium,
  waiverPremium,
  irr,
  paybackYear,
  lifeMultiple,
  lookupAgeRate,
} from "../js/engine.js";

assert.equal(insuranceAge("1990-01-15", "2026-07-14"), 36);
assert.equal(insuranceAge("1990-01-15", "2026-07-15"), 37);
assert.equal(insuranceAge("2000-03-01", "2026-08-31"), 26);
assert.equal(insuranceAge("2000-03-01", "2026-09-01"), 27);

const quote = premium({ units: 10, rate: 100, modeFactor: 0.5, discounts: [0.01, 0.01], cap: 0.015 });
assert.equal(quote.annual, 1000);
assert.equal(quote.modal, 500);
assert.equal(quote.discount, 0.015);
assert.equal(quote.payable, 493);

const waived = waiverPremium({ waivedAnnual: 20000, ratePer10k: 50, modeFactor: 1 });
assert.equal(waived.annual, 100);
assert.equal(waived.payable, 100);

const rate = irr([
  { t: 0, amount: -100 },
  { t: 1, amount: 110 },
]);
assert.ok(Math.abs(rate - 0.1) < 1e-6);

assert.equal(paybackYear([
  { year: 1, cumulativePremium: 100, cashValue: 80 },
  { year: 2, cumulativePremium: 200, cashValue: 210 },
]), 2);
assert.equal(paybackYear([{ year: 1, cumulativePremium: 100, cashValue: 90 }]), null);

assert.equal(lifeMultiple(300, 100), 3);
assert.equal(lifeMultiple(10, 0), null);

assert.equal(lookupAgeRate({ 20: 100, 40: 300 }, 30), 200);
assert.equal(lookupAgeRate({ 30: 120 }, 30), 120);

console.log("engine tests ok");
