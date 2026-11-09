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

function finite(value) {
  return Number.isFinite(value);
}

export function mortgageQuote(input) {
  const principalWan = Number(input.principalWan);
  const years = Number(input.years);
  const graceYears = Number(input.graceYears);
  const annualPercent = Number(input.annualPercent);
  const monthsPaid = Number(input.monthsPaid);
  if (![principalWan, years, graceYears, annualPercent, monthsPaid].every(finite)) {
    return { error: "請輸入貸款本金、利率、年期、寬限期與已繳期數" };
  }
  if (principalWan <= 0) return { error: "貸款本金要大於 0" };
  if (annualPercent < 0 || annualPercent > 100) return { error: "貸款利率請填 0–100%" };
  if (years <= 0) return { error: "貸款年期要大於 0" };
  if (graceYears < 0) return { error: "寬限期不可為負" };
  if (graceYears >= years) return { error: "寬限期要小於貸款年期。寬限期內只付息，之後才攤還本金" };
  if (monthsPaid < 0) return { error: "已繳期數不可為負" };
  const principal = principalWan * 10000;
  const payment = amortizingPayment(principal, annualPercent, years, graceYears);
  const interestOnly = principal * monthlyRate(annualPercent);
  if (payment == null || !finite(payment) || !finite(interestOnly)) return { error: "這組貸款數字無法計算，請改小年期或利率" };
  let dividend;
  if (input.monthlyDividend != null) {
    dividend = Number(input.monthlyDividend);
    if (!finite(dividend)) return { error: "基金組合的每月配息還不能用，請先修正下方組合" };
  } else {
    const investWan = Number(input.investWan);
    const dividendPercent = Number(input.dividendPercent);
    if (!finite(investWan) || !finite(dividendPercent)) return { error: "請輸入投資金額與年化配息率" };
    if (investWan < 0) return { error: "投資金額不可為負" };
    if (dividendPercent < 0) return { error: "年化配息率不可為負" };
    dividend = investWan * 10000 * dividendPercent / 100 / 12;
  }
  if (!finite(dividend)) return { error: "配息無法計算" };
  const totalMonths = years * 12;
  const notes = [];
  if (monthsPaid > totalMonths) notes.push("已繳期數超過貸款總月數，剩餘本金以 0 計算");
  const remaining = remainingPrincipal(monthsPaid, principal, annualPercent, years, graceYears);
  if (!finite(remaining)) return { error: "剩餘本金無法計算" };
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
    notes,
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
  const amount = Number(amountTwd);
  const feeN = Number(fee);
  const usd = Number(usdRate);
  const empty = { lines: [], weight: 0, monthly: 0, yieldPercent: null, notes: [] };
  if (!finite(amount) || amount < 0) return { ...empty, error: "總投資金額要大於或等於 0" };
  if (!finite(feeN) || feeN < 0 || feeN > 1.5) return { ...empty, error: "費用係數請填 0–1.5" };
  if (!finite(usd) || usd <= 0) return { ...empty, error: "美元匯率要大於 0" };
  if (!rows?.length) return { ...empty, notes: ["請新增至少一檔基金"] };
  let weight = 0;
  let monthly = 0;
  const byCode = funds instanceof Map ? funds : new Map((funds || []).map((item) => [item.code, item]));
  const lines = rows.map((row) => {
    const percent = Number(row.percent);
    if (!finite(percent)) return { ...row, percent: 0, missing: "請輸入比例" };
    if (percent < 0) return { ...row, percent, missing: "比例不可為負" };
    weight += percent;
    const fund = byCode.get(row.code);
    if (!fund) return { ...row, percent, missing: row.code ? "找不到基金" : "請選擇基金" };
    const fx = fundFx(fund.currency, usd, rates);
    const allocation = amount * percent / 100;
    if (!(fx > 0)) return { ...row, percent, fund, allocation, missing: `缺 ${fund.currency} 匯率` };
    const payout = fundPayout({
      allocationTwd: allocation,
      fx,
      fee: feeN,
      nav: fund.nav,
      dividend: fund.dividend,
      periods: fund.periods,
    });
    if (!payout || !finite(payout.monthly) || !finite(payout.units)) {
      return { ...row, percent, fund, allocation, missing: "這檔淨值或配息無法計算" };
    }
    monthly += payout.monthly;
    return { ...row, percent, fund, allocation, fx, ...payout };
  });
  const notes = [];
  if (Math.abs(weight - 100) >= 1e-6) notes.push(`比例合計 ${+weight.toFixed(2)}%，尚未等於 100%。合計只含已填的比例`);
  return {
    lines,
    weight,
    monthly,
    yieldPercent: amount > 0 ? monthly * 12 / amount * 100 : null,
    notes,
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
  const rate = Number(fx);
  if (!finite(rate) || rate <= 0) return { error: "美元匯率要大於 0", rows: [], crossover: 0 };
  const amount = Number(amountWan);
  const premium = Number(premiumUsd);
  if (!finite(amount) || amount <= 0) return { error: "保額要大於 0", rows: [], crossover: 0 };
  if (!finite(premium) || premium < 0) return { error: "每期保費不可為負", rows: [], crossover: 0 };
  if (!(Number(loan.principal) > 0)) return { error: "比較用的房貸本金要大於 0", rows: [], crossover: 0 };
  if (!finite(Number(loan.annualPercent)) || Number(loan.annualPercent) < 0 || Number(loan.annualPercent) > 100) {
    return { error: "請輸入 0–100% 的房貸利率", rows: [], crossover: 0 };
  }
  if (!(Number(loan.years) > Number(loan.graceYears)) || Number(loan.graceYears) < 0) {
    return { error: "房貸年期要大於寬限期", rows: [], crossover: 0 };
  }
  const key = scenario === "L" || scenario === "G" ? scenario : "M";
  const scale = unit === "USD" ? 1 : rate;
  const loanScale = unit === "USD" ? rate : 1;
  const surrender = cell[`cv${key}`] || [];
  const death = cell[`db${key}`] || [];
  let crossover = 0;
  const rows = [];
  for (let index = 0; index < surrender.length; index += 1) {
    const year = index + 1;
    const balance = remainingPrincipal(year * 12, loan.principal, loan.annualPercent, loan.years, loan.graceYears);
    if (balance == null || !finite(balance)) return { error: "房貸年期要大於寬限期", rows: [], crossover: 0 };
    const paid = premium * Math.min(year, Number(payYears)) * scale;
    const cash = surrender[index] * amount * scale;
    const cover = death[index] * amount * scale;
    const shownBalance = balance / loanScale;
    const gap = cash - shownBalance;
    if (![paid, cash, cover, shownBalance, gap].every(finite)) return { error: "這組數字無法換算", rows: [], crossover: 0 };
    if (!crossover && gap >= 0) crossover = year;
    rows.push({
      year,
      age: Math.round(Number(age)) + year - 1,
      paid,
      cash,
      cover,
      balance: shownBalance,
      gap,
    });
  }
  return { rows, crossover };
}
