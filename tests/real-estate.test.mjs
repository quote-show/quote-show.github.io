import assert from "node:assert/strict";
import fs from "node:fs";
import {
  amortizingPayment,
  fundPayout,
  mortgageQuote,
  pfkAmountFromPremium,
  pfkCell,
  pfkSchedule,
  portfolioPayout,
  remainingPrincipal,
} from "../js/real-estate.js";

const loan = 1000 * 10000;
const payment = amortizingPayment(loan, 2.6, 30, 0);
assert.equal(Math.round(payment), 40034);
for (const [year, balance] of [[15, 5961811], [16, 5632505], [20, 4226322]]) {
  assert.equal(Math.round(remainingPrincipal(year * 12, loan, 2.6, 30, 0)), balance);
}
const brief = mortgageQuote({
  principalWan: 1000,
  annualPercent: 2.6,
  years: 30,
  graceYears: 0,
  investWan: 600,
  dividendPercent: 10.68,
  monthsPaid: 192,
});
assert.equal(Math.round(brief.payment), 40034);
assert.equal(Math.round(brief.dividend), 53400);
assert.equal(Math.round(brief.paymentGap), 13366);
assert.equal(Math.round(brief.remaining), 5632505);
assert.equal(Math.round(mortgageQuote({ ...brief && {
  principalWan: 1000, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 600, dividendPercent: 10.68, monthsPaid: 180,
} }).remaining), 5961811);

for (const [input, text] of [
  [{ principalWan: NaN, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 0, dividendPercent: 0, monthsPaid: 0 }, "請輸入"],
  [{ principalWan: 0, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 0, dividendPercent: 0, monthsPaid: 0 }, "大於 0"],
  [{ principalWan: -1, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 0, dividendPercent: 0, monthsPaid: 0 }, "大於 0"],
  [{ principalWan: 1000, annualPercent: 2.6, years: 30, graceYears: 30, investWan: 0, dividendPercent: 0, monthsPaid: 0 }, "寬限期"],
  [{ principalWan: 1000, annualPercent: 2.6, years: 30, graceYears: -1, investWan: 0, dividendPercent: 0, monthsPaid: 0 }, "不可為負"],
  [{ principalWan: 1000, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 0, dividendPercent: 0, monthsPaid: -5 }, "已繳期數"],
]) {
  const result = mortgageQuote(input);
  assert.match(result.error, new RegExp(text));
  assert.equal(Object.values(result).some((value) => value === Infinity || Number.isNaN(value)), false);
}
const past = mortgageQuote({
  principalWan: 1000, annualPercent: 2.6, years: 30, graceYears: 0, investWan: 0, dividendPercent: 0, monthsPaid: 999,
});
assert.equal(past.remaining, 0);
assert.match(past.notes.join(""), /超過/);

const quote = mortgageQuote({
  principalWan: 800,
  annualPercent: 2.6,
  years: 30,
  graceYears: 3,
  investWan: 300,
  dividendPercent: 10.68,
  monthsPaid: 180,
});
assert.equal(Math.round(quote.interestOnly), 17333);
assert.equal(Math.round(quote.payment), 34389);
assert.equal(Math.round(quote.dividend), 26700);
assert.ok(quote.paymentGap < 0);
assert.equal(Math.round(quote.remaining), 5121238);
assert.equal(mortgageQuote({
  principalWan: 800,
  annualPercent: 2.6,
  years: 30,
  graceYears: 3,
  investWan: 300,
  dividendPercent: 10.68,
  monthsPaid: 12,
}).remaining, 800 * 10000);

const funds = JSON.parse(fs.readFileSync("data/real-estate/funds.json", "utf8"));
const portfolio = portfolioPayout({
  amountTwd: 6000000,
  usdRate: 32,
  fee: 0.95,
  rows: [
    { code: "NGB2", percent: 50 },
    { code: "ACB22", percent: 30 },
    { code: "JFP11", percent: 20 },
  ],
  funds: funds.funds,
  rates: funds.rates,
});
assert.equal(Math.round(portfolio.monthly), 71987);
assert.equal(portfolio.lines[0].units.toFixed(2), "2501.05");
const one = fundPayout({ allocationTwd: 3000000, fx: 32, fee: 0.95, nav: 35.61, dividend: 0.59, periods: 12 });
assert.equal(Math.round(one.monthly), 47220);
const badWeight = portfolioPayout({
  amountTwd: 6000000, usdRate: 32, fee: 0.95,
  rows: [{ code: "NGB2", percent: 40 }],
  funds: funds.funds, rates: funds.rates,
});
assert.match(badWeight.notes.join(""), /100/);
assert.equal(Number.isFinite(badWeight.monthly), true);
const negative = portfolioPayout({
  amountTwd: -1, usdRate: 0, fee: -1,
  rows: [],
  funds: funds.funds, rates: funds.rates,
});
assert.match(negative.error, /總投資金額/);
assert.equal(negative.monthly, 0);
const cleared = portfolioPayout({
  amountTwd: 6000000, usdRate: 32, fee: 0.95, rows: [], funds: funds.funds, rates: funds.rates,
});
assert.equal(cleared.monthly, 0);
assert.match(cleared.notes.join(""), /至少一檔/);

const pfk = JSON.parse(fs.readFileSync("data/real-estate/pfk.json", "utf8"));
const cell = pfkCell(pfk.grid, "F", 2, 60);
const premium = Math.round(2063949 / 32);
const amount = pfkAmountFromPremium(cell, premium, pfk.meta);
assert.equal(premium, 64498);
assert.equal(amount, 25.19);
const badRate = pfkSchedule({
  cell, scenario: "M", amountWan: amount, fx: 0, unit: "USD", premiumUsd: premium, payYears: 2, age: 60,
  loan: { principal: loan, annualPercent: 2.6, years: 30, graceYears: 0 },
});
assert.match(badRate.error, /匯率/);
assert.equal(badRate.rows.length, 0);
const schedule = pfkSchedule({
  cell,
  scenario: "M",
  amountWan: amount,
  fx: 32,
  unit: "TWD",
  premiumUsd: premium,
  payYears: 2,
  age: 60,
  loan: { principal: loan, annualPercent: 2.6, years: 30, graceYears: 0 },
});
assert.equal(schedule.crossover, 16);
assert.equal(Math.round(schedule.rows[14].cash), 5763109);
assert.equal(Math.round(schedule.rows[14].balance), 5961811);
assert.equal(Math.round(schedule.rows[15].cash), 5961727);
assert.equal(Math.round(schedule.rows[15].balance), 5632505);

const sheet = pfkCell(pfk.grid, "M", 1, 28);
const sheetSchedule = pfkSchedule({
  cell: sheet,
  scenario: "M",
  amountWan: 28.9,
  fx: 32,
  unit: "TWD",
  premiumUsd: 55333,
  payYears: 1,
  age: 28,
  loan: { principal: 800 * 10000, annualPercent: 2.6, years: 30, graceYears: 3 },
});
assert.equal(sheetSchedule.crossover, 21);

const page = fs.readFileSync("real-estate/index.html", "utf8");
assert.match(page, /noindex,nofollow/);
assert.match(page, /配息不保證/);
assert.match(page, /紅利不保證/);
assert.match(page, /不是投資建議/);
assert.match(page, /正式建議書/);
assert.doesNotMatch(page, /09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-\d{7}/);

console.log("real-estate checks passed");
