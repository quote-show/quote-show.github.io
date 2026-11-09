export function monthlyRate(annualPercent) {
  return Number(annualPercent) / 100 / 12;
}

export function amortizingPayment(principal, annualPercent, years, graceYears) {
  const months = (Number(years) - Number(graceYears)) * 12;
  if (!(principal > 0) || !(months > 0)) return null;
  const rate = monthlyRate(annualPercent);
  if (rate === 0) return principal / months;
  return principal * rate / (1 - Math.pow(1 + rate, -months));
}

export function remainingPrincipal(monthsPaid, principal, annualPercent, years, graceYears) {
  const paid = Number(monthsPaid) || 0;
  const graceMonths = Number(graceYears) * 12;
  const total = (Number(years) - Number(graceYears)) * 12;
  const payment = amortizingPayment(principal, annualPercent, years, graceYears);
  if (payment == null) return null;
  if (paid <= graceMonths) return principal;
  const elapsed = paid - graceMonths;
  if (elapsed >= total) return 0;
  const rate = monthlyRate(annualPercent);
  if (rate === 0) return Math.max(0, principal - payment * elapsed);
  const grown = principal * Math.pow(1 + rate, elapsed);
  const paidDown = payment * ((Math.pow(1 + rate, elapsed) - 1) / rate);
  return Math.max(0, grown - paidDown);
}

export function mortgageQuote(input) {
  const principal = Number(input.principalWan) * 10000;
  const years = Number(input.years);
  const graceYears = Number(input.graceYears) || 0;
  const annualPercent = Number(input.annualPercent);
  if (!(principal > 0) || !(years > graceYears) || !Number.isFinite(annualPercent) || annualPercent < 0) {
    return { error: "請輸入貸款本金、利率，以及大於寬限期的年期" };
  }
  const payment = amortizingPayment(principal, annualPercent, years, graceYears);
  const interestOnly = principal * monthlyRate(annualPercent);
  const dividend = input.monthlyDividend != null && Number.isFinite(Number(input.monthlyDividend))
    ? Number(input.monthlyDividend)
    : Number(input.investWan) * 10000 * Number(input.dividendPercent) / 100 / 12;
  const monthsPaid = Number(input.monthsPaid) || 0;
  const remaining = remainingPrincipal(monthsPaid, principal, annualPercent, years, graceYears);
  return {
    principal,
    payment,
    interestOnly,
    dividend,
    graceGap: dividend - interestOnly,
    paymentGap: dividend - payment,
    remaining,
    repaid: principal - remaining,
    remainingRatio: remaining / principal,
    graceYears,
    monthsPaid,
  };
}

export function fxMid(rate) {
  if (!rate || !(rate.spotBuy > 0) || !(rate.spotSell > 0)) return null;
  return (rate.spotBuy + rate.spotSell) / 2 / (rate.unit || 1);
}

export function fundFx(currency, usdRate, rates) {
  if (currency === "TWD") return 1;
  if (currency === "USD") return Number(usdRate);
  const row = (rates || []).find((item) => item.code === currency);
  return fxMid(row);
}

export function fundPayout({ allocationTwd, fx, fee, nav, dividend, periods }) {
  if (!(fx > 0) || !(nav > 0)) return null;
  const units = Number(allocationTwd) / fx * Number(fee) / nav;
  const monthly = units * (Number(dividend) || 0) * (Number(periods) || 0) / 12 * fx;
  return { units, monthly };
}

export function portfolioPayout({ amountTwd, usdRate, fee, rows, funds, rates }) {
  let weight = 0;
  let monthly = 0;
  const lines = rows.map((row) => {
    const percent = Number(row.percent) || 0;
    weight += percent;
    const fund = (funds || []).find((item) => item.code === row.code);
    if (!fund) return { ...row, percent, missing: row.code ? "找不到基金" : "請選擇基金" };
    const fx = fundFx(fund.currency, usdRate, rates);
    const allocation = Number(amountTwd) * percent / 100;
    if (!(fx > 0)) return { ...row, percent, fund, allocation, missing: `缺 ${fund.currency} 匯率` };
    const payout = fundPayout({
      allocationTwd: allocation,
      fx,
      fee,
      nav: fund.nav,
      dividend: fund.dividend,
      periods: fund.periods,
    });
    monthly += payout.monthly;
    return { ...row, percent, fund, allocation, fx, ...payout };
  });
  const amount = Number(amountTwd) || 0;
  return {
    lines,
    weight,
    monthly,
    yieldPercent: amount > 0 ? monthly * 12 / amount * 100 : null,
  };
}

export function pfkCell(grid, sex, pay, age) {
  return grid?.[`${sex}${pay}_${Math.round(Number(age))}`] || null;
}

export function pfkRate(cell, amountWan, meta) {
  return Number(amountWan) >= meta.discount_threshold_wan ? cell.r : cell.r / (1 - meta.discount);
}

export function pfkAmountFromPremium(cell, premiumUsd, meta) {
  let amount = Number(premiumUsd) / cell.r;
  if (amount < meta.discount_threshold_wan) amount = Number(premiumUsd) / (cell.r / (1 - meta.discount));
  return +amount.toFixed(2);
}

export function pfkPremiumFromAmount(cell, amountWan, meta) {
  return Math.round(Number(amountWan) * pfkRate(cell, amountWan, meta));
}

export function pfkSchedule({ cell, scenario, amountWan, fx, unit, premiumUsd, payYears, age, loan }) {
  const key = scenario === "L" || scenario === "G" ? scenario : "M";
  const scale = unit === "USD" ? 1 : Number(fx);
  const loanScale = unit === "USD" ? Number(fx) : 1;
  const surrender = cell[`cv${key}`];
  const death = cell[`db${key}`];
  let crossover = 0;
  const rows = surrender.map((value, index) => {
    const year = index + 1;
    const paid = Number(premiumUsd) * Math.min(year, Number(payYears)) * scale;
    const cash = value * Number(amountWan) * scale;
    const cover = death[index] * Number(amountWan) * scale;
    const balance = remainingPrincipal(year * 12, loan.principal, loan.annualPercent, loan.years, loan.graceYears) / loanScale;
    const gap = cash - balance;
    if (!crossover && gap >= 0) crossover = year;
    return {
      year,
      age: Math.round(Number(age)) + year - 1,
      paid,
      cash,
      cover,
      balance,
      gap,
    };
  });
  return { rows, crossover };
}
