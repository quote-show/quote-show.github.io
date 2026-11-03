/**
 * 藝世錄報價引擎。純函式，不讀檔、不碰 DOM。
 * 數字與捨入是骨架規則，正式商品上線前要對公司建議書逐格核對。
 */

export function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 保險年齡：滿歲；距上次生日已滿 6 個月則加 1 歲。 */
export function insuranceAge(birth, asOf) {
  const b = toDate(birth);
  const a = toDate(asOf);
  let years = a.getFullYear() - b.getFullYear();
  let months = a.getMonth() - b.getMonth();
  let days = a.getDate() - b.getDate();
  if (days < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (months >= 6) years += 1;
  return years;
}

export function roundTo(value, digits = 0) {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
}

/**
 * 保費 = 單位數 × 費率 × 繳別係數，再扣折扣，折扣合計不超過上限。
 * discounts 是小數，例如 0.01 代表 1%。
 */
export function premium({ units, rate, modeFactor = 1, discounts = [], cap = Infinity }) {
  const annual = roundTo(units * rate, 0);
  const modal = roundTo(annual * modeFactor, 0);
  const asked = discounts.reduce((sum, item) => sum + Number(item || 0), 0);
  const discount = Math.min(asked, cap);
  const payable = roundTo(modal * (1 - discount), 0);
  return { annual, modal, discount, payable };
}

/** 豁免保費：被豁免的年繳保費合計 ÷ 10000 × 每萬費率，再乘繳別係數。 */
export function waiverPremium({ waivedAnnual, ratePer10k, modeFactor = 1 }) {
  const annual = roundTo((waivedAnnual / 10000) * ratePer10k, 0);
  const modal = roundTo(annual * modeFactor, 1);
  const payable = roundTo(modal, 0);
  return { annual, modal, payable };
}

export function lookupAgeRate(byAge, age) {
  const table = byAge || {};
  const keys = Object.keys(table).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  if (!keys.length) return null;
  if (Object.prototype.hasOwnProperty.call(table, String(age))) return Number(table[String(age)]);
  const lo = [...keys].reverse().find((key) => key < age);
  const hi = keys.find((key) => key > age);
  if (lo == null || hi == null) return null;
  const span = hi - lo;
  const t = (age - lo) / span;
  return Number(table[String(lo)]) + (Number(table[String(hi)]) - Number(table[String(lo)])) * t;
}

function npv(rate, flows) {
  return flows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** flow.t, 0);
}

function dNpv(rate, flows) {
  return flows.reduce((sum, flow) => sum + (-flow.t * flow.amount) / (1 + rate) ** (flow.t + 1), 0);
}

/** 內部報酬率。先試牛頓法，不收斂就用二分法。flows 為 {t, amount}，t 以年計。 */
export function irr(flows, options = {}) {
  const lo0 = options.lo ?? -0.9;
  const hi0 = options.hi ?? 5;
  const tol = options.tol ?? 1e-8;
  let guess = options.guess ?? 0.05;
  for (let i = 0; i < 20; i += 1) {
    const value = npv(guess, flows);
    const slope = dNpv(guess, flows);
    if (!Number.isFinite(value) || !Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = guess - value / slope;
    if (next <= lo0 || next >= hi0) break;
    if (Math.abs(next - guess) < tol) return next;
    guess = next;
  }
  let lo = lo0;
  let hi = hi0;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (Math.abs(fMid) < tol || hi - lo < tol) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** 解約金（加已領金額）第一次大於等於累計保費的年度。 */
export function paybackYear(rows) {
  for (const row of rows) {
    const back = Number(row.cashValue || 0) + Number(row.payouts || 0);
    if (row.cumulativePremium > 0 && back / row.cumulativePremium >= 1) return row.year;
  }
  return null;
}

/** 壽險倍數 = 身故給付 ÷ 累計實繳保費。 */
export function lifeMultiple(deathBenefit, cumulativePremium) {
  if (!cumulativePremium) return null;
  return deathBenefit / cumulativePremium;
}

function rateKey(term, sex) {
  return `${term}|${sex}`;
}

export function projectSavings(product, input) {
  const term = Number(input.term);
  const sex = Number(input.sex);
  const age = Number(input.age);
  const key = rateKey(term, sex);
  const perUnit = lookupAgeRate(product.premiumRates?.[key], age);
  if (perUnit == null) throw new Error("此年齡、性別或年期沒有示範費率");
  const unit = product.unit || 10000;
  let units;
  if (input.sum) units = Number(input.sum) / unit;
  else units = Number(input.premium) / perUnit;
  const annual = roundTo(units * perUnit, 0);
  const years = product.years || product.perUnitByYear.cashValue.length;
  const rows = [];
  let cumulative = 0;
  for (let year = 1; year <= years; year += 1) {
    const paid = year <= term ? annual : 0;
    cumulative += paid;
    let cash = product.perUnitByYear.cashValue[year - 1] * units;
    let death = product.perUnitByYear.deathBenefit[year - 1] * units;
    if (product.kind === "dividend") {
      const scenario = input.scenario || "mid";
      const extra = (product.dividendPerUnit?.[scenario]?.[year - 1] || 0) * units;
      cash += extra;
      death += extra;
    }
    if (product.kind === "interest-sensitive") {
      const declared = Number(input.declaredRate ?? product.declaredRate);
      const spread = Math.max(0, declared - Number(product.pricingRate || 0));
      const extra = cash * spread;
      cash += extra;
      death += extra;
    }
    rows.push({
      year,
      age: age + year,
      premium: paid,
      cumulativePremium: cumulative,
      cashValue: roundTo(cash, 0),
      deathBenefit: roundTo(death, 0),
      multiple: lifeMultiple(death, cumulative),
    });
  }
  const flows = [];
  rows.forEach((row) => {
    if (row.premium) flows.push({ t: row.year - 1, amount: -row.premium });
  });
  const last = rows[rows.length - 1];
  if (last) flows.push({ t: last.year, amount: last.cashValue });
  return {
    annual,
    units,
    paybackYear: paybackYear(rows),
    irr: irr(flows),
    rows,
  };
}
