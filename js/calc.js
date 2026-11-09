/**
 * 商品試算。費率表在 data/，這裡只做計算。
 * 保障型對齊「單位數 × 費率」後先四捨五入到小數一位，再乘繳別係數、再乘折扣。
 * 儲蓄型對齊建議書的年繳、折扣、解約金與含領回內部報酬率。
 */

import { lifeMultiple } from "./engine.js";

export function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

export function round1(value) {
  return Math.round(value * 10 + 1e-7) / 10;
}

export function ceilScaled(value, scale) {
  return Math.ceil(Math.round(value * scale) / scale);
}

function rnd(value, digits) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

/** 建議書折扣公式。只接受 IIF / AND / OR、比較和數字，不執行任意程式。 */
export function evalSheetFormula(expr, scope) {
  const s = String(expr ?? "0").trim().replaceAll("OP!S", "S");
  let i = 0;
  const skip = () => { while (s[i] === " ") i += 1; };
  function parseExpr() {
    const left = parseCompare();
    skip();
    if (s.startsWith("??", i)) {
      i += 2;
      const right = parseExpr();
      return left ?? right;
    }
    return left;
  }
  function parseCompare() {
    skip();
    if (s.startsWith("IIF", i) && !/[A-Za-z0-9_]/.test(s[i + 3] || "")) return parseCall("IIF");
    if (s.startsWith("AND", i) && !/[A-Za-z0-9_]/.test(s[i + 3] || "")) return parseCall("AND");
    if (s.startsWith("OR", i) && !/[A-Za-z0-9_]/.test(s[i + 2] || "")) return parseCall("OR");
    const left = parsePostfix();
    skip();
    const ops = ["!=", "==", ">=", "<=", ">", "<"];
    for (const op of ops) {
      if (!s.startsWith(op, i)) continue;
      i += op.length;
      const right = parsePostfix();
      if (op === "!=") return left != right;
      if (op === "==") return left == right;
      if (op === ">=") return left >= right;
      if (op === "<=") return left <= right;
      if (op === ">") return left > right;
      return left < right;
    }
    return left;
  }
  function parseCall(name) {
    i += name.length;
    skip();
    if (s[i] !== "(") throw new Error("折扣公式無法讀取");
    i += 1;
    const args = [];
    skip();
    if (s[i] !== ")") {
      args.push(parseExpr());
      skip();
      while (s[i] === ",") {
        i += 1;
        args.push(parseExpr());
        skip();
      }
    }
    if (s[i] !== ")") throw new Error("折扣公式無法讀取");
    i += 1;
    if (name === "IIF") return args[0] ? args[1] : (args.length > 2 ? args[2] : false);
    if (name === "AND") return args.every(Boolean);
    return args.some(Boolean);
  }
  function parsePostfix() {
    let value = parseAtom();
    skip();
    while (s[i] === "[") {
      i += 1;
      const key = parseExpr();
      skip();
      if (s[i] !== "]") throw new Error("折扣公式無法讀取");
      i += 1;
      value = value == null ? undefined : value[key];
      skip();
    }
    return value;
  }
  function parseAtom() {
    skip();
    if (s[i] === "(") {
      i += 1;
      const value = parseExpr();
      skip();
      if (s[i] !== ")") throw new Error("折扣公式無法讀取");
      i += 1;
      return value;
    }
    if (s[i] === "{") {
      i += 1;
      const object = {};
      skip();
      while (s[i] && s[i] !== "}") {
        const key = parseAtom();
        skip();
        if (s[i] !== ":") throw new Error("折扣公式無法讀取");
        i += 1;
        object[key] = parseExpr();
        skip();
        if (s[i] === ",") i += 1;
        skip();
      }
      if (s[i] !== "}") throw new Error("折扣公式無法讀取");
      i += 1;
      return object;
    }
    if (s[i] === "'" || s[i] === "\"") {
      const quote = s[i];
      i += 1;
      let out = "";
      while (i < s.length && s[i] !== quote) out += s[i++];
      i += 1;
      return out;
    }
    if (s[i] === "-" || (s[i] >= "0" && s[i] <= "9")) {
      const match = s.slice(i).match(/^-?\d+(\.\d+)?/);
      if (!match) throw new Error("折扣公式無法讀取");
      i += match[0].length;
      return Number(match[0]);
    }
    const match = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) throw new Error("折扣公式無法讀取");
    i += match[0].length;
    if (!Object.prototype.hasOwnProperty.call(scope, match[0])) throw new Error("折扣公式無法讀取");
    return scope[match[0]];
  }
  const value = parseExpr();
  skip();
  if (i !== s.length) throw new Error("折扣公式無法讀取");
  return value;
}

function exactRate(table, age) {
  if (!table || !Object.prototype.hasOwnProperty.call(table, String(age))) return null;
  return Number(table[String(age)]);
}

function modeFactor(product, mode) {
  const factors = product.modeFactors || { annual: 1 };
  const factor = factors[mode];
  if (factor == null) throw new Error("這個繳別沒有係數");
  return factor;
}

function assertAgeTerm(product, age, term) {
  const band = product.issueAges?.[String(term)];
  if (!band) throw new Error("沒有這個年期");
  if (age < band[0] || age > band[1]) throw new Error(`投保年齡要在 ${band[0]}–${band[1]} 歲`);
}

function assertSex(product, sex) {
  const allowed = product.sex || [1, 2];
  if (!allowed.includes(Number(sex))) throw new Error(Number(sex) === 1 ? "這個商品不開放男性" : "這個商品不開放女性");
}

function assertOccupation(product, occ) {
  const min = product.occupation?.min ?? 1;
  const max = product.occupation?.max ?? 6;
  if (occ < min || occ > max) throw new Error(`職業類別限 ${min}–${max} 類`);
}

function pickBand(table, age) {
  if (!Array.isArray(table)) return null;
  for (const [up, value] of table) {
    if (age <= up) return value;
  }
  return null;
}

export function sumLimits(product, age, occ) {
  const rule = product.sumRule || {};
  if (rule.grid) {
    const cell = rule.grid[`${age}|${occ}`];
    if (!cell) return { min: null, max: null, step: rule.step || 1 };
    return { min: cell[0], max: cell[1], step: rule.step || 1 };
  }
  if (rule.fixed) {
    const value = pickBand(rule.fixed, age);
    return { min: value, max: value, step: 1 };
  }
  let min = rule.minAge ? pickBand(rule.minAge, age) : rule.min;
  let max = null;
  if (rule.maxAll != null) max = rule.maxAll;
  else if (rule.maxOcc) max = rule.maxOcc[occ - 1];
  else if (rule.maxAge) max = pickBand(rule.maxAge, age);
  else if (rule.maxOccAge) max = pickBand(rule.maxOccAge, age)?.[occ - 1];
  return { min, max, step: rule.step ?? (product.unitKind === "day" || product.unitKind === "h" ? 100 : 1) };
}

function discountBp(product, sum) {
  let bp = 0;
  const discounts = product.discounts || {};
  if (discounts.pay) bp += Math.round(discounts.pay * 10000);
  const steps = discounts.highSum || [];
  for (const [door, rate] of steps) {
    if (sum >= door) {
      bp += Math.round(rate * 10000);
      break;
    }
  }
  const cap = Math.round((discounts.cap || 0) * 10000);
  return Math.min(bp, cap);
}

function applyModal(annual, factor, bp) {
  const modal = Math.round(annual * factor + 1e-7);
  const payable = Math.round(modal * (10000 - bp) / 10000 + 1e-7);
  return { modal, payable };
}

export function quoteProtection(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const occ = Number(input.occupation || input.occ || 1);
  const term = input.term;
  const sum = Number(input.sum);
  const mode = input.mode || "annual";
  const payDiscount = input.payDiscount !== false;
  assertAgeTerm(product, age, term);
  assertSex(product, sex);
  assertOccupation(product, occ);
  if (product.fixedUnits == null) {
    const limits = sumLimits(product, age, occ);
    if (limits.min == null || limits.max == null) throw new Error("這個年齡沒有保額上下限");
    if (!(sum >= limits.min - 1e-9)) throw new Error(`保額低於最低 ${limits.min}`);
    if (!(sum <= limits.max + 1e-9)) throw new Error(`保額超過上限 ${limits.max}`);
    const step = limits.step || 1;
    if (product.stepCheck !== false && Math.abs(Math.round(sum / step) * step - sum) > 1e-6) {
      throw new Error(`保額要以 ${step} 為單位`);
    }
  }
  const rateKey = `${term}|${sex}`;
  const rate = exactRate(product.rates?.[rateKey], age);
  if (rate == null) throw new Error("查無這個年齡的費率");
  const units = product.fixedUnits != null ? product.fixedUnits : sum / product.unitDivisor;
  const annual = round1(units * rate);
  const factor = modeFactor(product, mode);
  let bp = 0;
  if (payDiscount) bp = discountBp(product, sum);
  const priced = applyModal(annual, factor, bp);
  const out = {
    currency: product.currency || "TWD",
    rate,
    units,
    annual,
    modal: priced.modal,
    payable: priced.payable,
    discount: bp / 10000,
  };
  const next = exactRate(product.ratesNext?.[rateKey], age);
  if (next != null) {
    const annualNext = round1(units * next);
    out.payableNext = applyModal(annualNext, factor, bp).payable;
    out.nextFromYear = product.step2?.[String(term)] || null;
  }
  const renew = exactRate(product.ratesRenew?.[rateKey], age + 1);
  if (renew != null) out.payableRenew = applyModal(round1(units * renew), factor, bp).payable;
  return out;
}

export function quoteRider(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const occ = Number(input.occupation || input.occ || 1);
  const sum = Number(input.sum);
  const mode = input.mode || "annual";
  const payDiscount = input.payDiscount !== false && product.payDiscount !== false;
  assertSex(product, sex);
  assertOccupation(product, occ);
  if (product.issueAges) {
    const band = product.issueAges.any || product.issueAges[String(input.term)] || Object.values(product.issueAges)[0];
    if (band && (age < band[0] || age > band[1])) throw new Error(`投保年齡要在 ${band[0]}–${band[1]} 歲`);
  }
  if (product.calc === "plan") {
    const plans = product.sumRule?.planGrid?.[`${age}|${occ}`] || product.sumRule?.plans || [];
    if (plans.length && !plans.includes(Number(input.plan))) throw new Error("這個職業不能選這個計畫");
  } else if (product.calc !== "waiver") {
    const limits = sumLimits(product, age, occ);
    if (limits.min == null || limits.max == null) throw new Error("這個年齡沒有保額上下限");
    if (!(sum >= limits.min - 1e-9)) throw new Error(`保額低於最低 ${limits.min}`);
    if (!(sum <= limits.max + 1e-9)) throw new Error(`保額超過上限 ${limits.max}`);
  }
  let units;
  let rate;
  if (product.calc === "waiver") {
    const covered = Number(input.covered);
    if (!(covered > 0)) throw new Error("請填被豁免的年繳保費");
    units = covered / 10000;
    rate = riderRate(product, input, age);
  } else if (product.calc === "plan") {
    units = 1;
    rate = riderRate(product, input, age);
  } else if (product.calc === "tmr") {
    units = 1;
    const base = riderRate(product, input, age);
    const extra = product.addPerOcc?.[String(occ)];
    if (base == null || extra == null) throw new Error("查無費率");
    rate = base + extra * (sum - 3);
  } else {
    units = sum / product.unitDivisor;
    rate = riderRate(product, input, age);
  }
  if (rate == null) throw new Error("查無這個年齡的費率");
  const annual = round1(units * rate);
  const factor = modeFactor(product, mode);
  const bp = payDiscount ? 100 : 0;
  const priced = applyModal(annual, factor, bp);
  return {
    currency: product.currency || "TWD",
    rate,
    units,
    annual,
    modal: priced.modal,
    payable: priced.payable,
    discount: bp / 10000,
  };
}

function riderRate(product, input, age) {
  const parts = (product.rateKeys || ["sex"]).map((key) => {
    if (key === "sex") return input.sex;
    if (key === "occ") return input.occupation || input.occ;
    if (key === "plan") return input.plan;
    if (key === "term") return input.term;
    if (key === "yr") return "f";
    return "";
  });
  const table = product.rates?.[parts.join("|")];
  if (product.flat) return table == null ? null : Number(table);
  return exactRate(table, age);
}

export function quoteWaiver(product, input) {
  return quoteRider(product, input);
}

export function quoteBand(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const occ = Number(input.occupation || input.occ || 1);
  const plan = input.plan || product.plans?.[0]?.name;
  const band = (product.issueAges?.plans || []).find((item) => item.name === plan);
  if (band && (age < band.min || age > band.max)) throw new Error(`這個計畫的投保年齡是 ${band.min}–${band.max} 歲`);
  if (product.occupation) assertOccupation(product, occ);
  if (product.sex) assertSex(product, sex);
  const specific = product.premiums?.[`${plan}|${age}|${sex}|${occ}`];
  const shared = product.premiums?.[`${plan}|${age}|${sex}`];
  const value = specific ?? shared;
  if (value == null) throw new Error("這個年齡、性別或職業沒有印好的保費");
  if (product.modeFactors) {
    const priced = applyModal(value, modeFactor(product, input.mode || "annual"), 0);
    return { currency: product.currency || "TWD", annual: value, modal: priced.modal, payable: priced.payable, rate: value, discount: 0 };
  }
  return { currency: product.currency || "TWD", annual: value, modal: value, payable: value, rate: value, discount: 0 };
}

function tableId(term, sex, age) {
  return `${term}|${sex}|${age}`;
}

export function savingsModes(product, id) {
  if (product.calc === "fbo" || product.calc === "annuity") return product.modes || ["PS"];
  const tables = product.tables || {};
  if (product.isr) return product.isrModes || ["PS", "PC", "PUA"];
  if (product.hand) return ["PUA"];
  if (product.puaOnly && tables.pvfb?.[id] && tables.pvfb0?.[id] && tables.die2?.[id]) return ["PUA"];
  const modes = [];
  if (tables.pvfb?.[id] && tables.pvfb0?.[id] && tables.die2?.[id]) modes.push("PUA");
  modes.push("SAVE", "CASH");
  return modes;
}

export function preferredSavingsMode(product, modes) {
  if (product.defaultMode && modes.includes(product.defaultMode)) return product.defaultMode;
  const cash = product.isr ? "PC" : "CASH";
  const prefer = product.srv ? (modes.includes(cash) ? cash : "PUA") : "PUA";
  return modes.includes(prefer) ? prefer : modes[0];
}

function savingsDiscounts(product, term, sum, m1, m2) {
  if (product.handDiscount) return handDiscount(product.handDiscount, term, sum, m1, m2);
  const formulas = product.discountFormulas;
  if (!formulas) return [0, 0];
  const scope = { term: Number(term), S: Number(sum), m1: m1 || "", m2: m2 || "" };
  const high = Number(evalSheetFormula(formulas.high, scope)) || 0;
  const cap = Number(evalSheetFormula(formulas.cap, scope)) || 0;
  const first = Number(evalSheetFormula(formulas.methods?.[m1] || "0", scope)) || 0;
  const renewal = Number(evalSheetFormula(formulas.methods?.[m2] || "0", scope)) || 0;
  return [Math.min(rnd(high + first, 6), cap), Math.min(rnd(high + renewal, 6), cap)];
}

function handDiscount(rule, term, sum, m1, m2) {
  const termNumber = Number(term);
  const tiers = (rule.high || []).find((item) => item.term == null || Number(item.term) === termNumber) || { tiers: [] };
  let high = 0;
  for (const [door, rate] of tiers.tiers || []) {
    if (sum >= door) {
      high = rate;
      break;
    }
  }
  const capRow = (rule.caps || []).find((item) => item.term == null || Number(item.term) === termNumber);
  const cap = capRow ? capRow.value : 0;
  const transfer = "金融機構轉帳";
  const remit = rule.remit || "匯款";
  const zero = (rule.zeroTerms || []).map(Number).includes(termNumber);
  const first = zero ? 0 : ((m1 === transfer || (m1 === remit && m2 === transfer)) ? 0.01 : 0);
  const renewal = zero ? 0 : (m2 === transfer ? 0.01 : 0);
  return [Math.min(high + first, cap), Math.min(high + renewal, cap)];
}

function rawPremium(product, sum, rate) {
  if (product.premRound === "tenth-down") return Math.floor(Math.round(sum * rate * 10) / 10);
  if (product.premRound === "usd-floor") return Math.floor(roundHalfUp(sum * rate * 10) / 10 + 1e-9);
  if (product.premRound === "down") return Math.floor(Math.round(sum * rate * 1e6) / 1e6);
  return roundHalfUp(sum * rate);
}

export function sheetIrr(rows, horizon, monthly) {
  const periods = monthly ? 12 : 1;
  const flows = [];
  for (let i = 0; i < horizon; i += 1) {
    const row = rows[i];
    flows.push([i * periods, -(row.py || 0)]);
    const survival = row.surv || 0;
    if (survival) {
      if (monthly) {
        for (let month = 1; month <= 12; month += 1) flows.push([i * 12 + month, survival / 12]);
      } else flows.push([i + 1, survival]);
    }
    const cash = i < horizon - 1 ? (row.cash || 0) : 0;
    if (cash) flows.push([(i + 1) * periods, cash]);
  }
  flows.push([horizon * periods, rows[horizon - 1].X]);
  const npv = (rate) => flows.reduce((sum, [time, amount]) => sum + amount / (1 + rate) ** time, 0);
  let lo = -0.99;
  let hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  const annual = (lo + hi) / 2;
  return monthly ? (1 + annual) ** 12 - 1 : annual;
}

function finishSavings(product, raw, first, renewal, d1, d2, rate, rows) {
  let received = 0;
  let payback = null;
  const total = rows.reduce((sum, row) => sum + (row.py || 0), 0);
  rows.forEach((row) => {
    received += (row.surv || 0) + (row.cash || 0);
    row.got = received;
    if (payback == null && total > 0 && received >= total) payback = row.t;
  });
  const year = Math.min(10, rows.length);
  return {
    currency: product.currency || "TWD",
    rate,
    annual: raw,
    payable: first,
    renewal,
    discount: d1,
    renewalDiscount: d2,
    rows,
    paybackYear: payback,
    irr: rows.length ? sheetIrr(rows, rows.length, product.monthlySurvival) : null,
    irr10: rows.length >= year ? sheetIrr(rows, year, product.monthlySurvival) : null,
    multiple10: rows.length ? lifeMultiple(rows[year - 1].W, rows[year - 1].cum) : null,
  };
}

function projectStandard(product, input, id, mode, first, renewal) {
  const tables = product.tables;
  const term = Number(input.term);
  const age = Number(input.age);
  const scenario = Number(input.scenario ?? 2);
  const include = scenario ? 1 : 0;
  const bonusId = `${id}|${scenario || 1}`;
  const round = product.rup ? (value) => ceilScaled(value, 1e6) : roundHalfUp;
  const years = product.fixedYears || Math.max(1, product.maxAge - age + 1);
  const payYears = product.payYears === "age" ? term - age : term;
  const bonus = include ? tables.bonu?.[bonusId] : null;
  const bonusDeath = include ? tables.bonuDie?.[bonusId] : null;
  const bonusCash = include ? tables.bonuCv?.[bonusId] : null;
  const survival = tables.srv?.[id];
  const accountRate = product.accRate || 0;
  const grow = product.accUp
    ? (value) => Math.ceil(Math.round(value * 1e4) / 1e4)
    : roundHalfUp;
  let paidUp = 0;
  let saved = 0;
  const rows = [];
  for (let year = 1; year <= years; year += 1) {
    const deathUnit = tables.die[id][year - 1];
    const cashUnit = tables.cv[id][year - 1];
    const sum = Number(input.sum);
    const death = round(deathUnit * sum);
    const cash = round(cashUnit * sum);
    const per = include && bonus ? bonus[year - 1] : 0;
    let dividend = include ? round(sum * per) : 0;
    if (include && year > 1 && product.puaK && mode === "PUA") dividend += round(paidUp / 1e4 * per);
    const price = mode === "PUA" ? (tables.pvfb[id][year] || 0) : 0;
    if (mode === "PUA" && year < years && price) {
      paidUp += product.mDiv ? roundHalfUp(dividend / (price / 1e4)) : roundHalfUp(dividend / price);
    }
    const extra = year === years && product.finalExtra && mode === "PUA" ? dividend : 0;
    const addedDeath = mode === "PUA" ? round(paidUp / 1e4 * tables.die2[id][year - 1]) + extra : 0;
    const addedCash = mode === "PUA" ? round(paidUp / 1e4 * tables.pvfb0[id][year]) + extra : 0;
    const terminalDeath = bonusDeath ? round(include * sum * bonusDeath[year - 1]) : 0;
    const terminalCash = bonusCash ? round(include * sum * bonusCash[year - 1]) : 0;
    const baseSurvival = survival ? round(survival[year - 1] * sum) : 0;
    const addedSurvival = survival && mode === "PUA" ? round(survival[year - 1] * paidUp / 1e4) : 0;
    if (mode === "SAVE") saved = year > 1 ? grow(saved * (1 + rnd(accountRate / 12, 10)) ** 12 + dividend) : dividend;
    const held = mode === "CASH" ? dividend : (mode === "SAVE" ? saved : 0);
    const premium = year <= payYears ? (year === 1 ? first : renewal) : 0;
    const previous = rows.length ? rows[rows.length - 1].cum : 0;
    rows.push({
      t: year,
      age: age + year - 1,
      py: premium,
      cum: previous + premium,
      W: death + addedDeath + terminalDeath + held,
      X: cash + addedCash + terminalCash + held,
      b: cash,
      e: terminalCash,
      y: addedCash,
      c: held,
      surv: baseSurvival + addedSurvival,
      cash: mode === "CASH" ? dividend : 0,
      K: dividend,
    });
  }
  return rows;
}

function projectHand(product, input, id, first, renewal) {
  const tables = product.tables;
  const term = Number(input.term);
  const age = Number(input.age);
  const sum = Number(input.sum);
  const scenario = Number(input.scenario ?? 2);
  const include = scenario > 0 ? 1 : 0;
  const bonusId = `${id}|${scenario > 0 ? scenario : 1}`;
  const round = (value) => ceilScaled(value, 1e9);
  const years = product.maxAge - age + 1;
  const bonus = tables.bonu[bonusId];
  const bonusDeath = tables.bonuDie[bonusId];
  const bonusCash = tables.bonuCv[bonusId];
  let paidUp = 0;
  const rows = [];
  for (let year = 1; year <= years; year += 1) {
    const death = round(tables.die[id][year - 1] * sum);
    const cash = round(tables.cv[id][year - 1] * sum);
    const per = include ? bonus[year - 1] : 0;
    const dividend = include ? round(sum * per) + (year > 1 ? round(paidUp / 1e4 * per) : 0) : 0;
    const price = tables.pvfb[id][year];
    if (year < years && price) paidUp += roundHalfUp(dividend / (price / 1e4));
    const extra = year === years ? dividend : 0;
    const addedDeath = round(paidUp / 1e4 * tables.die2[id][year - 1]) + extra;
    const addedCash = round(paidUp / 1e4 * tables.pvfb0[id][year]) + extra;
    const terminalDeath = round(include * sum * bonusDeath[year - 1]);
    const terminalCash = round(include * sum * bonusCash[year - 1]);
    const premium = year <= term ? (year === 1 ? first : renewal) : 0;
    const previous = rows.length ? rows[rows.length - 1].cum : 0;
    rows.push({
      t: year,
      age: age + year - 1,
      py: premium,
      cum: previous + premium,
      W: death + addedDeath + terminalDeath,
      X: cash + addedCash + terminalCash,
      b: cash,
      e: terminalCash,
      y: addedCash,
      c: 0,
      surv: 0,
      cash: 0,
      K: dividend,
    });
  }
  return rows;
}

function projectInterest(product, input, id, mode, first, renewal) {
  const tables = product.tables;
  let sum = Number(input.sum);
  const age = Number(input.age);
  const term = Number(input.term);
  const declared = Number(input.declaredRate ?? product.declDefault);
  const assumed = Number(product.assumed?.[String(input.term)] ?? product.assumed ?? 0);
  const roundUp = (value) => ceilScaled(value, 1e9);
  const round10 = (value) => Math.ceil(Math.round(value * 1e13) / 1e3) / 1e10;
  const roundTen = (value) => Math.round(value * 1e10) / 1e10;
  const spread = (year) => Math.max(0, rnd(rnd(Math.max(declared, assumed), 4) - assumed, 5));
  const years = product.maxAge - age + 1;
  const survival = tables.srv?.[id];
  const payYears = product.payYears === "age" ? term - age : term;
  const juvenileAge = product.p4a ?? 16;
  const lock = mode === "PUA" ? years : Math.max(juvenileAge - age, product.p4m ?? 6);
  const asOf = product.asOf || "2026-11-03";
  const [year0, month0, day0] = asOf.split("-").map(Number);
  const origin = new Date(Date.UTC(year0, month0 - 1, day0));
  const dayMs = 864e5;
  const monthLength = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const anchor = (offset) => {
    const cursor = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + offset, 1));
    const length = monthLength(cursor.getUTCFullYear(), cursor.getUTCMonth());
    return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(origin.getUTCDate(), length)));
  };
  const monthRates = (offset) => {
    const point = anchor(offset);
    const start = new Date(Date.UTC(point.getUTCFullYear(), point.getUTCMonth(), 1));
    const end = new Date(Date.UTC(point.getUTCFullYear(), point.getUTCMonth() + 1, 0));
    const before = start < origin ? 0 : Math.round((point - start) / dayMs);
    const after = Math.round((end - point) / dayMs) + 1;
    const rate = declared;
    return [roundTen(rate * before / 365), roundTen(rate * after / 365), roundTen(rate * (before + after) / 365)];
  };
  const trim = (value) => {
    const digits = String(Math.floor(Math.abs(value))).length;
    const places = digits <= 5 ? 10 : 15 - digits;
    return Math.floor(Math.round(value * 10 ** places * 1e3) / 1e3) / 10 ** places;
  };
  const taiwan = !!product.kRound;
  const accountDigits = product.accDig || 10;
  const roundAccount = (value) => Math.round(value * 10 ** accountDigits) / 10 ** accountDigits;
  const juvenileDigits = product.juvDig || 10;
  const roundJuvenile = (value) => Math.round(value * 10 ** juvenileDigits) / 10 ** juvenileDigits;
  const lift = taiwan ? roundHalfUp : (value) => ceilScaled(value, 1e6);
  let paidUp = 0;
  let balance = 0;
  let previousFraction = 0;
  let saved = 0;
  let offsetPremium = 0;
  let offsetNext = 0;
  let offsetUsed = 0;
  let juvenileAccount = 0;
  let accountTotal = 0;
  const rows = [];
  const rpu = input.rpu;
  const payLimit = rpu ? Math.min(payYears, rpu.n) : payYears;
  for (let year = 1; year <= years; year += 1) {
    if (rpu && year > rpu.n) {
      sum = 0;
      if (year === rpu.n + 1) paidUp += rpu.Sp;
    }
    const valueRound = product.isrUp === false ? roundHalfUp : roundUp;
    const death = valueRound(tables.die[id][year - 1] * sum);
    const cash = valueRound(tables.cv[id][year - 1] * sum);
    const reserve = rnd(tables.pv[id][year - 1] * sum, 10);
    const diff = spread(year);
    const price = tables.pvfb[id][year] || 0;
    const rawA = taiwan ? roundHalfUp(reserve * diff) : round10(reserve * diff);
    const rawB = year > 1
    ? (taiwan ? roundHalfUp(roundHalfUp(rnd(paidUp / 1e4 * price, 3) * diff)) : round10(rnd(paidUp / 1e4 * price, 3) * diff))
    : 0;
    const shareA = taiwan ? rawA : roundUp(rawA);
    const shareB = taiwan ? rawB : roundUp(rawB);
    const share = shareA + shareB;
    const late = year > lock;
    const attained = age + year - 1;
    let juvenileDeath = null;
    let juvenileCash = null;
    if (attained < juvenileAge) {
      const offset = year < payYears ? Math.min(rawA, renewal) : 0;
      let shown = 0;
      for (let month = 1; month <= 12; month += 1) {
        const [before, after, whole] = monthRates(12 * (year - 1) + month);
        const credit = month === 12 ? rawA : 0;
        const deduct = month === 12 ? offset : 0;
        shown = roundJuvenile(balance * (1 + before)) + credit;
        const piece = roundJuvenile((credit - deduct) * (1 + after));
        balance = piece + roundJuvenile(balance * (1 + whole));
      }
      juvenileAccount = juvenileAccount + shareA - Math.ceil(offsetPremium);
      offsetPremium = offset;
      offsetNext = offset;
      const stillPaying = year < term && attained < juvenileAge - 1;
      juvenileDeath = stillPaying ? 0 : juvenileAccount;
      juvenileCash = stillPaying ? 0 : lift(shown);
      if (attained === juvenileAge - 1 && price) {
        paidUp += roundHalfUp(lift(shown) / (price / 1e4));
        juvenileCash = null;
      }
    } else if (!late && attained < product.maxAge && price) {
      paidUp += roundHalfUp(share / (price / 1e4));
    }
    if (late && mode === "PS") {
      let monthSum = 0;
      for (let month = 1; month <= 12; month += 1) {
        const [before, after, whole] = monthRates(12 * (year - 1) + month);
        const incoming = month === 12 ? rawA + rawB : 0;
        const interest = month === 12 ? roundAccount((saved + previousFraction) * before) : 0;
        const box = trim(incoming + saved + interest + previousFraction);
        monthSum += previousFraction;
        const fraction = roundAccount(box * (month === 12 ? after : whole));
        if (month === 12) {
          const booked = taiwan ? roundHalfUp(interest + monthSum) : ceilScaled(interest + monthSum, 1e9);
          accountTotal = share + booked + accountTotal;
        }
        saved = box;
        previousFraction = fraction;
      }
    }
    const extra = year === years ? share : 0;
    let addedDeath = valueRound((product.dieRound ? roundHalfUp : roundUp)(tables.die2[id][year - 1] * paidUp / 1e4)) + (late ? 0 : extra);
    let addedCash = valueRound(rnd(paidUp / 1e4 * tables.pvfb0[id][year], 3)) + (late ? 0 : extra);
    if (juvenileDeath != null) addedDeath = juvenileDeath;
    if (juvenileCash != null) addedCash = juvenileCash;
    else if (rpu && year > rpu.n) {
      const reserveUnit = tables.pv[id][year - 1];
      const cashUnit = tables.cv[id][year - 1];
      const ratio = reserveUnit > 0 ? Math.min(1, cashUnit / reserveUnit) : 1;
      if (ratio < 1) addedCash -= valueRound(rpu.Sp / 1e4 * (tables.pvfb0[id][year] || 0) * (1 - ratio));
    }
    const baseSurvival = survival ? roundUp(survival[year - 1] * sum) : 0;
    const addedSurvival = survival ? roundUp(survival[year - 1] * paidUp / 1e4) : 0;
    const cashOut = late && mode === "PC" ? share : 0;
    const account = late && mode === "PS" ? accountTotal : 0;
    const premium = (year <= payLimit) ? (year === 1 ? first : renewal) - (year > 1 && age + year - 2 < 16 ? offsetUsed : 0) : 0;
    const previous = rows.length ? rows[rows.length - 1].cum : 0;
    offsetUsed = offsetNext;
    offsetNext = 0;
    rows.push({
      t: year,
      age: attained,
      py: premium,
      cum: previous + premium,
      W: death + addedDeath + account + cashOut,
      X: cash + addedCash + account + cashOut,
      b: cash,
      e: 0,
      y: addedCash,
      c: account + cashOut,
      surv: baseSurvival + addedSurvival,
      cash: cashOut,
      K: share,
    });
  }
  return rows;
}

export function quoteSavings(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const term = input.term;
  const sum = Number(input.sum);
  assertAgeTerm(product, age, term);
  assertSex(product, sex);
  const limits = product.sumInsured || {};
  const ageMax = limits.byAge?.[String(age)];
  const max = ageMax == null ? limits.max : Math.min(limits.max, ageMax);
  if (!(sum >= limits.min && sum <= max)) throw new Error(`保額要在 ${limits.min}–${max} 萬`);
  const id = tableId(term, sex, age);
  if (product.tables?.gp?.[id] == null || product.tables?.die?.[id] == null) throw new Error("查無這個年齡的費率");
  const m1 = input.method1 || product.method1;
  const m2 = input.method2 || product.method2;
  const [d1, d2] = savingsDiscounts(product, term, sum, m1, m2);
  const rate = product.tables.gp[id];
  const raw = rawPremium(product, sum, rate);
  const first = roundHalfUp(raw * (1 - d1));
  const renewal = roundHalfUp(raw * (1 - d2));
  const modes = savingsModes(product, id);
  const mode = modes.includes(input.mode) ? input.mode : preferredSavingsMode(product, modes);
  let rows;
  if (product.isr) rows = projectInterest(product, input, id, mode, first, renewal);
  else if (product.hand) rows = projectHand(product, input, id, first, renewal);
  else rows = projectStandard(product, input, id, mode, first, renewal);
  const result = finishSavings(product, raw, first, renewal, d1, d2, rate, rows);
  result.mode = mode;
  result.modes = modes;
  return result;
}

function excelRound(value, digits) {
  const scale = 10 ** digits;
  return Math.floor(Math.abs(value) * scale + 0.5) / scale * Math.sign(value || 1);
}

function up10(value) {
  return Math.ceil(Math.round(value * 1e13) / 1e3 - 1e-8) / 1e10;
}

function r3(value) {
  return Math.floor(value * 1000 + 0.5) / 1000;
}

function r10(value) {
  return Math.floor(value * 1e10 + 0.5) / 1e10;
}

function roundDownPlaces(value, places) {
  const scale = 10 ** places;
  return Math.floor(value * scale + 1e-8) / scale;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quoteFbo(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const term = Number(input.term);
  const sum = Number(input.sum);
  const declared = Number(input.declaredRate ?? product.declDefault);
  const mode = product.modes?.includes(input.mode) ? input.mode : (product.defaultMode || "PS");
  assertAgeTerm(product, age, term);
  assertSex(product, sex);
  const limits = product.sumInsured || {};
  const cap = limits.byAge?.[String(age)] ?? limits.max;
  if (!(sum >= limits.min && sum <= cap)) throw new Error(`保額要在 ${limits.min}–${cap} 萬`);
  const id = tableId(term, sex, age);
  const tables = product.tables;
  if (tables.gp?.[id] == null || tables.pv?.[id] == null) throw new Error("查無這個年齡的費率");
  const pricing = Number(product.pricing[String(term)]);
  const diff = Math.max(0, excelRound(excelRound(Math.max(declared, pricing), 4) - pricing, 5));
  const [d1, d2] = handDiscount(product.handDiscount, term, sum, input.method1 || product.method1, input.method2 || product.method2);
  const raw = excelRound(sum * tables.gp[id], 1);
  const modal = Math.floor(raw + 1e-9);
  const first = Math.round(modal * (1 - d1));
  const renewal = Math.round(modal * (1 - d2));
  const cv = tables.cv[id];
  const die = tables.die[id];
  const die2 = tables.die2[id];
  const pv = tables.pv[id];
  const pvfb = tables.pvfb[id];
  const pvfb0 = tables.pvfb0?.[id] || pvfb;
  const years = product.maxAge - age + 1;
  const lock = mode === "PUA" ? years : Math.max(product.lockAge - age, product.lockYears);
  const anchor = (product.policyMonth || "2026-10-01").split("-").map(Number);
  let paid = 0;
  let box = 0;
  let fraction = 0;
  let balance = 0;
  const history = [];
  const rows = [];
  const rpu = input.rpu;
  let face = sum;
  const payLimit = rpu ? Math.min(term, rpu.n) : term;
  for (let year = 1; year <= years; year += 1) {
    if (rpu && year > rpu.n) {
      face = 0;
      if (year === rpu.n + 1) paid += rpu.Sp;
    }
    const part = up10(pv[year - 1] * face * diff);
    const extra = year === 1 ? 0 : up10(r3(paid / 1e4 * pvfb[year]) * diff);
    const feedback = year === 1 ? Math.ceil(part - 1e-9) : Math.ceil(part - 1e-9) + Math.ceil(extra - 1e-9);
    if (year <= lock && pvfb[year]) paid += Math.floor(feedback / (pvfb[year] / 1e4) + 0.5);
    let deathAdd = Math.ceil(die2[year - 1] * paid / 1e4 - 1e-9);
    let cashAdd = Math.ceil(r3(paid / 1e4 * pvfb0[year]) - 1e-9);
    if (rpu && year > rpu.n) {
      const reserveUnit = pv[year - 1];
      const cashUnit = cv[year - 1];
      const ratio = reserveUnit > 0 ? Math.min(1, cashUnit / reserveUnit) : 1;
      if (ratio < 1) cashAdd -= Math.ceil(r3(rpu.Sp / 1e4 * pvfb0[year] * (1 - ratio)) - 1e-9);
    }
    const baseDeath = Math.ceil(die[year - 1] * face - 1e-9);
    const baseCash = Math.ceil(cv[year - 1] * face - 1e-9);
    let booked = 0;
    for (let month = 0; month < 12; month += 1) {
      const index = (year - 1) * 12 + month;
      const monthIndex = anchor[1] - 1 + index;
      const yearNumber = anchor[0] + Math.floor(monthIndex / 12);
      const monthNumber = monthIndex % 12 + 1;
      const rate = r10(declared * daysInMonth(yearNumber, monthNumber) / 365);
      const incoming = month === 11 && year > lock && mode === "PS" ? part + extra : 0;
      const raw = box + fraction + incoming;
      const digits = Math.abs(raw) >= 1 ? String(Math.floor(Math.abs(raw))).length : 1;
      box = roundDownPlaces(raw, digits <= 5 ? 10 : Math.max(0, 15 - digits));
      if (month === 11 && year > lock && mode === "PS") booked = Math.ceil((history.slice(-12).reduce((sum, item) => sum + item, 0)) - 1e-9);
      fraction = r10(box * rate);
      history.push(fraction);
    }
    if (year > lock && mode === "PS") balance += feedback + booked;
    const store = mode === "PS" ? balance : 0;
    const previous = rows.length ? rows[rows.length - 1].cum : 0;
    const premium = year <= payLimit ? (year === 1 ? first : renewal) : 0;
    rows.push({
      t: year,
      age: age + year - 1,
      py: premium,
      cum: previous + premium,
      W: baseDeath + deathAdd + store,
      X: baseCash + cashAdd + store,
      b: baseCash,
      e: 0,
      y: cashAdd,
      c: store,
      surv: 0,
      cash: 0,
      K: feedback,
      N: paid,
      store,
    });
  }
  const result = finishSavings(product, modal, first, renewal, d1, d2, tables.gp[id], rows);
  result.mode = mode;
  result.declaredRate = declared;
  result.feedback1 = rows[0].K;
  result.store7 = rows[6]?.store ?? null;
  result.store10 = rows[9]?.store ?? null;
  return result;
}

export function quoteAnnuity(product, input) {
  const age = Number(input.age);
  const sex = Number(input.sex);
  const term = input.term ?? 1;
  const premium = Number(input.sum);
  const declared = Number(input.declaredRate ?? product.declDefault);
  assertAgeTerm(product, age, term);
  assertSex(product, sex);
  const limits = product.sumInsured || {};
  if (!(premium >= limits.min && premium <= limits.max)) throw new Error(`躉繳保費要在 ${limits.min}–${limits.max}`);
  const factor = product.factors?.[`${age}|${sex}|M`];
  if (factor == null) throw new Error("查無這個年齡的年金因子");
  const charge = excelRound(premium * product.loading, product.loadDigits);
  const net = premium - charge;
  const adjust = excelRound(((1 + declared) / (1 + product.pricingRate)) ** (1 / 12), 7);
  let pay = excelRound(net / factor * adjust, 2);
  const years = product.payYears || Math.max(1, product.maxAge - age + 1);
  const rows = [];
  let running = 0;
  for (let year = 1; year <= years; year += 1) {
    let annuity = 0;
    for (let month = 0; month < 12; month += 1) {
      const shown = excelRound(pay, product.showDigits);
      annuity = excelRound(annuity + shown, product.showDigits);
      pay = excelRound(pay * adjust, 2);
    }
    running = excelRound(running + annuity, product.showDigits);
    const previous = rows.length ? rows[rows.length - 1].cum : 0;
    rows.push({
      t: year,
      age: age + year - 1,
      py: year === 1 ? premium : 0,
      cum: previous + (year === 1 ? premium : 0),
      W: 0,
      X: 0,
      surv: annuity,
      cash: 0,
      K: 0,
    });
  }
  const bare = rows.map((row) => ({ ...row }));
  const result = finishSavings(product, premium, premium, 0, 0, 0, factor, bare);
  let total = 0;
  result.rows.forEach((row) => {
    total = excelRound(total + row.surv, product.showDigits);
    row.X = total;
  });
  result.firstPayment = excelRound(excelRound(net / factor * adjust, 2), product.showDigits);
  result.month2 = (() => {
    const first = excelRound(net / factor * adjust, 2);
    return excelRound(excelRound(first * adjust, 2), product.showDigits);
  })();
  result.declaredRate = declared;
  result.loadingAmount = charge;
  result.net = net;
  result.mode = "M";
  return result;
}

function reducedFace(pa, sum, rnd) {
  if (!(pa > 0)) return 0;
  if (rnd === "round") return Math.floor(Math.round(pa * sum * 1e9) / 1e9 + 0.5);
  if (rnd === "raw") return Math.round(pa * sum * 1e6) / 1e6;
  return Math.ceil(Math.round(pa * sum * 1e9) / 1e9);
}

function rpuRatio(product, id, year, term) {
  const pack = product.rpu?.keys?.[id];
  if (year < (Number(term) || 1) && pack?.PV?.[year - 1] > 0) return Math.min(1, pack.CV[year - 1] / pack.PV[year - 1]);
  const point = Math.max(year, Number(term) || 1);
  const cash = product.tables?.cv?.[id]?.[point - 1];
  const reserve = product.tables?.pvfb0?.[id]?.[point];
  return cash > 0 && reserve > 0 ? Math.min(1, cash / reserve) : 1;
}

function projectReduced(product, input, id, yearN, reduced, continued) {
  const tables = product.tables;
  const scenario = Number(input.scenario ?? 2);
  const include = scenario ? 1 : 0;
  const bonusId = `${id}|${scenario || 1}`;
  const round = product.rup ? (value) => ceilScaled(value, 1e6) : roundHalfUp;
  const age = Number(input.age);
  const term = Number(input.term);
  const sum = Number(input.sum);
  const years = product.fixedYears || Math.max(1, product.maxAge - age + 1);
  const payYears = product.payYears === "age" ? term - age : term;
  const bonus = include ? tables.bonu?.[bonusId] : null;
  const bonusDeath = include ? tables.bonuDie?.[bonusId] : null;
  const bonusCash = include ? tables.bonuCv?.[bonusId] : null;
  const survival = tables.srv?.[id];
  let paidUp = 0;
  let cum = 0;
  const rows = [];
  for (let year = 1; year <= years; year += 1) {
    const converted = year > yearN;
    const unit = converted ? reduced / 1e4 : sum;
    const per = include && bonus ? bonus[year - 1] : 0;
    const death = converted ? round(unit * (tables.die2[id][year - 1] || 0)) : round(tables.die[id][year - 1] * sum);
    const cash = converted
      ? round(unit * (tables.pvfb0[id][year] || 0) * rpuRatio(product, id, year, term))
      : round(tables.cv[id][year - 1] * sum);
    let dividend = include ? round(unit * per) : 0;
    if (include && year > 1 && product.puaK) dividend += round(paidUp / 1e4 * per);
    const price = tables.pvfb?.[id]?.[year] || 0;
    if (year < years && price) paidUp += product.mDiv ? roundHalfUp(dividend / (price / 1e4)) : roundHalfUp(dividend / price);
    const extra = year === years && product.finalExtra ? dividend : 0;
    const addedDeath = round(paidUp / 1e4 * (tables.die2?.[id]?.[year - 1] || 0)) + extra;
    const addedCash = round(paidUp / 1e4 * (tables.pvfb0?.[id]?.[year] || 0)) + extra;
    const terminalDeath = bonusDeath ? round(include * unit * bonusDeath[year - 1]) : 0;
    const terminalCash = bonusCash ? round(include * unit * bonusCash[year - 1]) : 0;
    const baseSurvival = survival ? round(survival[year - 1] * unit) : 0;
    const addedSurvival = survival ? round(survival[year - 1] * paidUp / 1e4) : 0;
    const premium = !converted && year <= payYears ? (year === 1 ? continued.payable : continued.renewal) : 0;
    cum += premium;
    rows.push({
      t: year,
      age: age + year - 1,
      py: premium,
      cum,
      W: death + addedDeath + terminalDeath,
      X: cash + addedCash + terminalCash,
      b: cash,
      e: terminalCash,
      y: addedCash,
      c: 0,
      surv: baseSurvival + addedSurvival,
      cash: 0,
      K: dividend,
      base: converted ? reduced : sum * 10000,
      pua: paidUp,
    });
  }
  return rows;
}

export function quoteRpu(product, input) {
  const year = Number(input.rpuYear);
  const age = Number(input.age);
  const sex = Number(input.sex);
  const term = Number(input.term);
  const sum = Number(input.sum);
  const id = `${term}|${sex}|${age}`;
  const pack = product.rpu?.keys?.[id];
  if (!pack?.PA?.length) throw new Error("這個條件沒有減額繳清");
  const factor = pack.PA[year - 1];
  if (!(factor > 0)) throw new Error("這一年不能辦減額繳清");
  const reducedSum = reducedFace(factor, sum, product.rpu.rnd);
  const plain = { ...input, rpu: undefined, rpuYear: undefined };
  const continued = quoteProduct(product, plain);
  const payYears = product.payYears === "age" ? term - age : term;
  const juvenile = (product.isr || product.calc === "fbo") && age + year < (product.p4a ?? product.lockAge ?? 16);
  const scaleAtEnd = product.rpu.saOnly && product.rpu.scale && year >= payYears - 1;
  const sumOnly = (product.rpu.saOnly && !scaleAtEnd) || juvenile || !product.tables?.die2?.[id];
  if (sumOnly) return { reducedSum, year, sumOnly: true, continued, rows: null };
  let rows;
  if (scaleAtEnd) {
    const scale = reducedSum / (sum * 1e4);
    let cum = 0;
    rows = continued.rows.map((row) => {
      const converted = row.t > year;
      const factor = converted ? scale : 1;
      const py = converted ? 0 : row.py;
      cum += py;
      const scaled = (value) => Math.round((value || 0) * factor);
      return { ...row, py, cum, W: scaled(row.W), X: scaled(row.X), b: scaled(row.b), e: scaled(row.e), y: scaled(row.y), c: scaled(row.c), surv: scaled(row.surv), cash: scaled(row.cash), K: scaled(row.K), base: converted ? reducedSum : sum * 1e4 };
    });
  } else if (product.isr || product.calc === "fbo") {
    rows = quoteProduct(product, { ...plain, rpu: { n: year, Sp: reducedSum } }).rows;
  } else {
    rows = projectReduced(product, plain, id, year, reducedSum, continued);
  }
  return { reducedSum, year, sumOnly: false, continued, rows };
}

export function quoteWithdraw(rows, planned) {
  let factor = 1;
  let taken = 0;
  let shortfall = null;
  const out = rows.map((row) => {
    const surrender = row.X * factor;
    const wanted = planned[row.t] || 0;
    const draw = Math.min(wanted, Math.max(0, surrender));
    if (wanted > surrender + 0.5 && shortfall == null) shortfall = row.t;
    if (draw > 0) factor *= surrender > 0 ? 1 - draw / surrender : 0;
    taken += draw;
    return { ...row, w: draw, cw: taken, X: row.X * factor, W: row.W * factor, m: factor };
  });
  return { rows: out, shortfall };
}

export function quoteProduct(product, input) {
  if (product.calc === "fbo") return quoteFbo(product, input);
  if (product.calc === "annuity") return quoteAnnuity(product, input);
  if (product.calc === "savings") return quoteSavings(product, input);
  if (product.calc === "band") return quoteBand(product, input);
  if (product.calc === "rider" || product.calc === "plan" || product.calc === "tmr" || product.calc === "waiver") {
    return quoteRider(product, input);
  }
  return quoteProtection(product, input);
}
