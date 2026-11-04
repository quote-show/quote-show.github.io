/**
 * 把參考站的費率表轉成這個站的 JSON。
 * 參考檔要先放在 /tmp/ref（或 REFERENCE_DIR）。這個檔不內嵌對方的程式。
 * 用法：node tools/import-reference.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { quoteProduct, sumLimits } from "../js/calc.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ref = process.env.REFERENCE_DIR || "/tmp/ref";
const fetched = "2026-11-03";
const outProtection = path.join(root, "data/protection");
const outSavings = path.join(root, "data/savings");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function sourceNote(site, version, extra) {
  return {
    site,
    fetched,
    version: version || null,
    note: extra || (version ? `費率版本 ${version}` : "頁面未標版本"),
  };
}

function loadBaojia() {
  const context = vm.createContext({ window: {}, console });
  for (const name of ["data.js", "data_life.js", "data_mains.js", "catalog.js", "riders_rates.js", "app.js"]) {
    vm.runInContext(read(path.join(ref, "baojia", name)), context, { filename: name });
  }
  return context.window;
}

function ratesMap(row) {
  if (!row) return null;
  const [start, list] = row;
  const out = {};
  list.forEach((value, index) => { out[String(start + index)] = value; });
  return out;
}

function sumRuleFrom(product) {
  const rule = { step: product.step };
  if (product.fixed?.age) rule.fixed = product.fixed.age;
  else {
    if (product.min?.age) rule.minAge = product.min.age;
    else rule.min = product.min ?? 0;
    const max = product.max || {};
    if (max.all != null) rule.maxAll = max.all;
    else if (max.occ) rule.maxOcc = max.occ;
    else if (max.age) rule.maxAge = max.age;
    else if (max.occage) rule.maxOccAge = max.occage;
  }
  if (product.unit === "day" || product.unit === "h") rule.step = rule.step || 100;
  if (rule.step == null) rule.step = 1;
  return rule;
}

function modeFactors(product) {
  const table = product.mf || {};
  return {
    annual: table["年繳"] ?? 1,
    semi: table["半年繳"] ?? 0.52,
    quarterly: table["季繳"] ?? 0.262,
    monthly: table["月繳"] ?? 0.088,
  };
}

function baseProduct(product, code, name) {
  return {
    code,
    name,
    currency: product.cur === "USD" ? "USD" : "TWD",
    type: "protection",
    status: "active",
    category: product.cat || "",
    role: "main",
    calc: product.unit === "unit" ? "protection" : "protection",
    version: product.ver || null,
    updated: fetched,
    unitKind: product.unit || "wan",
    unitDivisor: product.unit === "day" || product.unit === "h" ? 100 : product.unit === "usd" ? 10000 : (product.per || 1),
    fixedUnits: product.unit === "unit" ? 1 : null,
    issueAges: product.terms,
    sex: product.sex ? [product.sex] : [1, 2],
    occupation: { min: 1, max: product.occMax || 6 },
    sumRule: sumRuleFrom(product),
    stepCheck: !product.free,
    discounts: { pay: product.pay || 0, cap: product.cap || 0, highSum: product.hi || [] },
    modeFactors: modeFactors(product),
    benefits: product.ben || [],
    rule: product.rule || "",
    cover: product.cover || "",
    note: product.note || "",
    sources: [sourceNote("baojia-fyc.pages.dev", product.ver, product.ver ? `費率版本 ${product.ver}` : "參考站主約費率")],
  };
}

function splitRates(block, code) {
  const rates = {};
  const ratesNext = {};
  const ratesRenew = {};
  for (const [key, row] of Object.entries(block || {})) {
    const parts = key.split("|");
    if (parts[0] !== code) continue;
    const term = parts[1];
    const sex = parts[2];
    const flag = parts[3];
    const mapped = ratesMap(row);
    const id = `${term}|${sex}`;
    if (flag === "2") ratesNext[id] = mapped;
    else if (flag === "R") ratesRenew[id] = mapped;
    else rates[id] = mapped;
  }
  return { rates, ratesNext, ratesRenew };
}

function sampleInputs(product) {
  const terms = Object.keys(product.issueAges || {}).filter((term) => Number.isFinite(Number(term)));
  const sexes = product.sex || [1, 2];
  const picks = [];
  for (const term of terms) {
    const [lo, hi] = product.issueAges[term];
    const ages = [...new Set([lo, Math.round((Number(lo) + Number(hi)) / 2), hi])];
    for (const sex of sexes) {
      for (const age of ages) {
        const occ = 1;
        let sums = [1];
        if (product.fixedUnits == null) {
          const limits = sumLimits(product, age, occ);
          if (limits.min == null || limits.max == null) continue;
          const step = limits.step || 1;
          const mid = Math.round(((limits.min + Math.min(limits.max, limits.min * 4)) / 2) / step) * step;
          sums = [...new Set([limits.min, Math.min(limits.max, Math.max(limits.min, mid))])];
        }
        for (const sum of sums) {
          picks.push({ age, sex, occupation: occ, term: Number(term), sum, mode: "annual", payDiscount: true });
          if (picks.length >= 8) return picks;
        }
      }
    }
  }
  return picks;
}

function sameNumber(left, right) {
  if (left == null && right == null) return true;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 1e-6;
  return left === right;
}

function protectOne(engine, product, fileCode, displayName, rateCode, terms) {
  const built = baseProduct({ ...product, terms }, fileCode, displayName);
  const packed = splitRates(engine.RATES[product.code] || engine.RATES[rateCode] || {}, rateCode);
  if (!Object.keys(packed.rates).length) return { skip: "沒有費率表" };
  built.rates = packed.rates;
  if (Object.keys(packed.ratesNext).length) built.ratesNext = packed.ratesNext;
  if (Object.keys(packed.ratesRenew).length) built.ratesRenew = packed.ratesRenew;
  if (product.step2) built.step2 = product.step2;
  const cases = [];
  const mismatches = [];
  for (const input of sampleInputs(built)) {
    const theirs = engine.QuoteEngine.quote(product.plans ? { ...product, code: product.code } : product, {
      age: input.age,
      sex: input.sex,
      occ: input.occupation,
      term: Number(input.term),
      sum: input.sum,
      mode: "年繳",
      payDisc: true,
      plan: rateCode,
    });
    if (theirs.errs) continue;
    let ours;
    try { ours = quoteProduct(built, input); } catch (error) { mismatches.push(`${input.age}/${input.sex}/${input.term}: ${error.message}`); continue; }
    const fields = [
      ["annual", theirs.annual, ours.annual],
      ["payable", theirs.paid, ours.payable],
    ];
    const bad = fields.filter(([, a, b]) => !sameNumber(a, b));
    if (bad.length) mismatches.push(`${input.age}歲 ${input.sex === 1 ? "男" : "女"} ${input.term}年 ${input.sum}: ${bad.map(([name, a, b]) => `${name} 參考 ${a}／本站 ${b}`).join("；")}`);
    else cases.push({ ...input, expect: { annual: theirs.annual, payable: theirs.paid } });
    if (cases.length >= 3) break;
  }
  if (cases.length < 3) return { skip: mismatches[0] || "找不到三組對得上的試算" , mismatches };
  if (mismatches.length) return { skip: "有對不上的試算", mismatches };
  built.verificationSamples = cases;
  return { product: built };
}

function riderProducts(engine) {
  const catalog = engine.CATALOG || [];
  const rates = engine.RIDER_RATES || {};
  const config = engine.QuoteEngine.RCFG;
  const made = [];
  const skipped = [];
  for (const [code, block] of Object.entries(rates)) {
    const info = catalog.find((item) => item.code === code) || {};
    const rule = config[code];
    if (!rule) {
      skipped.push({ code, reason: "沒有保額規則，不猜" });
      continue;
    }
    const calc = rule.u === "waiver" ? "waiver" : rule.u === "plan" ? "plan" : rule.tmr ? "tmr" : "rider";
    const product = {
      code,
      name: info.name || code,
      currency: rule.u === "usd" ? "USD" : "TWD",
      type: "protection",
      status: "active",
      category: info.cat || "",
      role: info.kind || (calc === "waiver" ? "waiver" : "rider"),
      calc,
      version: null,
      updated: fetched,
      unitKind: rule.u,
      unitDivisor: rule.u === "day" ? 100 : rule.u === "yuan" ? rule.per : rule.u === "usd" ? 1 : rule.u === "unit" ? 1 : (rule.per || 1),
      sex: info.sex ? [info.sex] : [1, 2],
      occupation: { min: 1, max: 6 },
      rateKeys: block.kf,
      flat: !!block.flat,
      payDiscount: !["FDE", "FDF"].includes(code),
      modeFactors: rule.mf
        ? { annual: rule.mf["年繳"], semi: rule.mf["半年繳"], quarterly: rule.mf["季繳"], monthly: rule.mf["月繳"] }
        : { annual: 1, semi: 0.52, quarterly: 0.262, monthly: 0.088 },
      benefits: info.ben || [],
      rule: info.rule || "",
      note: info.note || info.attach || "",
      sources: [sourceNote("baojia-fyc.pages.dev", null, block.src ? `費率表 ${block.src.split("/").pop()}` : "參考站附約費率")],
      rates: {},
    };
    for (const [key, row] of Object.entries(block.t || {})) {
      product.rates[key] = block.flat ? row[1][0] : ratesMap(row);
    }
    if (rule.min) {
      const grid = {};
      for (let age = 0; age <= 90; age += 1) {
        for (let occ = 1; occ <= 6; occ += 1) {
          try { grid[`${age}|${occ}`] = [rule.min(age, occ, "年繳"), rule.max(age, occ, "年繳")]; } catch { /* 這個組合沒有上下限 */ }
        }
      }
      product.sumRule = { grid, step: rule.step || (rule.u === "day" ? 100 : 1) };
    }
    if (rule.plans) {
      const planGrid = {};
      for (let age = 0; age <= 90; age += 1) {
        for (let occ = 1; occ <= 6; occ += 1) planGrid[`${age}|${occ}`] = rule.plans(age, occ);
      }
      product.sumRule = { ...(product.sumRule || {}), planGrid, plans: [1, 2, 3] };
    }
    if (rule.terms) {
      const terms = {};
      const list = rule.terms(30) || [];
      for (const term of list) terms[term] = info.ages?.[0] ? [info.ages[0].a, info.ages[0].b] : [0, 90];
      product.issueAges = terms;
    } else if (info.ages?.[0]) {
      product.issueAges = { any: [info.ages[0].a, info.ages[0].b] };
    }
    if (rule.tmr) product.addPerOcc = block.add;
    const cases = [];
    const mismatches = [];
    const ages = [30, 40, 50];
    for (const age of ages) {
      for (const sex of product.sex) {
        const numericTerms = Object.keys(product.rates || {}).map((key) => key.split("|")[product.rateKeys.indexOf("term")]).filter((term) => /^\d+$/.test(term));
        const input = {
          age,
          sex,
          occupation: 1,
          term: Number(numericTerms[0] || 20),
          sum: product.sumRule?.grid?.[`${age}|1`]?.[0] ?? 1,
          plan: (product.sumRule?.planGrid?.[`${age}|1`] || [1])[0],
          covered: 30000 + age * 1000,
          mode: "annual",
          payDiscount: product.payDiscount !== false,
        };
        const theirs = engine.QuoteEngine.rQuote(code, {
          age, sex, occ: 1, term: input.term, sum: input.sum, plan: input.plan, mode: "年繳",
          payDisc: input.payDiscount, covered: input.covered,
        });
        if (theirs.errs) continue;
        let ours;
        try { ours = quoteProduct(product, input); } catch (error) { mismatches.push(error.message); continue; }
        if (!sameNumber(theirs.annual, ours.annual) || !sameNumber(theirs.paid, ours.payable)) {
          mismatches.push(`${code} ${age}歲 參考年繳 ${theirs.annual}／實繳 ${theirs.paid}，本站 ${ours.annual}／${ours.payable}`);
        } else cases.push({ ...input, expect: { annual: theirs.annual, payable: theirs.paid } });
        if (cases.length >= 3) break;
      }
      if (cases.length >= 3) break;
    }
    if (cases.length < 3 || mismatches.length) {
      skipped.push({ code, name: product.name, reason: mismatches[0] || "對不到三組附約試算" });
      continue;
    }
    product.verificationSamples = cases;
    made.push(product);
  }
  return { made, skipped };
}

function braceSlice(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function loadStandard(html) {
  const eng = braceSlice(html, "const ENG=");
  const product = braceSlice(html, "const P=");
  if (!eng || !product) return null;
  const context = { Math, Date, String, Number, Object, JSON };
  vm.createContext(context);
  vm.runInContext("const IIF=(c,a,b)=>c?a:(b===undefined?false:b),AND=(...a)=>a.every(Boolean),OR=(...a)=>a.some(Boolean),RND=(x,d)=>Math.round(x*10**d)/10**d;\n" + eng.replace("const ENG=", "ENG="), context);
  vm.runInContext(product.replace("const P=", "P="), context);
  return { ENG: context.ENG, P: context.P };
}

function loadHand(html) {
  const start = html.indexOf("const D=");
  const end = html.indexOf("function run(");
  if (start < 0 || end < 0) return null;
  const element = () => ({
    innerHTML: "",
    value: "",
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    options: [],
  });
  const context = {
    Math, Date, String, Number, Object,
    document: { getElementById: () => element() },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.D=D; this.C=C; this.quote=quote; this.keyOf=keyOf;`, context);
  return context;
}

function compressTables(data, code, keyOf) {
  const tables = { gp: {}, cv: {}, die: {}, die2: {}, pvfb: {}, pvfb0: {}, srv: {}, pv: {}, bonu: {}, bonuDie: {}, bonuCv: {} };
  const seen = new Set();
  for (const raw of Object.keys(data.GP || {})) {
    if (!raw.startsWith(code)) continue;
    seen.add(raw);
  }
  return { tables, keys: [...seen] };
}

function remember(tables, id, data, raw, scenario) {
  const put = (bucket, key, value) => { if (value != null) bucket[key] = value; };
  put(tables.gp, id, data.GP?.[raw]);
  put(tables.cv, id, data.CV?.[raw]);
  put(tables.die, id, data.DIE?.[raw]);
  put(tables.die2, id, data._DIE2?.[raw]);
  put(tables.pvfb, id, data.PVFB?.[raw]);
  put(tables.pvfb0, id, data.PVFB0?.[raw]);
  put(tables.srv, id, data.SRV?.[raw]);
  put(tables.pv, id, data.PV?.[raw]);
  if (scenario) {
    put(tables.bonu, `${id}|${scenario}`, data.BONU?.[raw + scenario]);
    put(tables.bonuDie, `${id}|${scenario}`, data.BONUDIE?.[raw + scenario]);
    put(tables.bonuCv, `${id}|${scenario}`, data.BONUCV?.[raw + scenario]);
  }
}

function ceilingSum(smin, smax, maxf) {
  const values = maxf ? Object.values(maxf).map(Number).filter((value) => Number.isFinite(value)) : [];
  const top = values.length ? Math.max(...values) : null;
  if (smax == null) return top ?? smin;
  if (top != null && Number(smax) === Number(smin) && top > Number(smax)) return top;
  return smax;
}

function buildSavings(meta, data, keyOf, hand) {
  const terms = meta.terms || meta.ages || {};
  const tables = { gp: {}, cv: {}, die: {}, die2: {}, pvfb: {}, pvfb0: {}, srv: {}, pv: {}, bonu: {}, bonuDie: {}, bonuCv: {} };
  for (const term of Object.keys(terms)) {
    const [lo, hi] = terms[term];
    for (const sex of [1, 2]) {
      for (let age = lo; age <= hi; age += 1) {
        const raw = keyOf(sex, age, Number(term));
        if (data.GP?.[raw] == null) continue;
        const id = `${term}|${sex}|${age}`;
        remember(tables, id, data, raw, null);
        for (const scenario of [1, 2]) remember(tables, id, data, raw, scenario);
      }
    }
  }
  const currency = meta.cur === "USD" ? "USD" : "TWD";
  const product = {
    code: meta.code,
    name: meta.name,
    currency,
    type: "savings",
    status: "active",
    kind: meta.isr ? "interest-sensitive" : (meta.dividend === "分紅" || meta.dividend === "dividend" ? "dividend" : (data.BONU ? "dividend" : "fixed")),
    calc: "savings",
    version: meta.ver || null,
    updated: fetched,
    issueAges: Object.fromEntries(Object.entries(terms).map(([term, band]) => [term, [band[0], band[1]]])),
    sex: [1, 2],
    sumInsured: {
      min: meta.smin,
      max: ceilingSum(meta.smin, meta.smax, meta.maxf),
      byAge: meta.maxf || null,
    },
    maxAge: meta.maxAge || (hand ? 110 : 95),
    fixedYears: meta.fixedYears || null,
    premRound: hand ? "tenth-down" : (meta.premRoundDown ? "down" : "half-up"),
    rup: !!meta.rup,
    puaK: !!meta.puaK,
    mDiv: !!meta.mDiv,
    finalExtra: !!meta.finalExtra,
    payYears: meta.payYears || "term",
    accRate: meta.accRate || 0,
    accUp: !!meta.accUp,
    srv: !!meta.srv,
    isr: !!meta.isr,
    isrModes: meta.isrModes || null,
    puaOnly: ["FPD", "FPE", "PAJ", "PAK", "PALA", "PALB", "PALC", "PAN", "PF55", "PF60", "PF65", "PFNA", "PFNB", "PFNC", "PFO", "PFVA", "PFVB", "PFVC", "PFVD", "PFWA", "PFWB", "PFWC", "PFWD", "PFWE", "PFWF", "PFZA", "PFZB"].includes(meta.code),
    monthlySurvival: meta.code === "PAK",
    p4a: meta.p4a ?? null,
    p4m: meta.p4m ?? null,
    assumed: meta.assumed ?? null,
    declDefault: meta.declDef ?? meta.declIllus ?? null,
    kRound: !!meta.kRound,
    dieRound: !!meta.dieRound,
    isrUp: meta.isrUp !== false,
    hand: !!hand,
    method1: meta.m1 || (hand ? null : null),
    method2: meta.m2 || null,
    asOf: "2026-11-03",
    tables,
    sources: [sourceNote("quote-yt.pages.dev", meta.ver, meta.declLab ? `費率版本 ${meta.ver || ""}，宣告 ${meta.declLab}` : `費率版本 ${meta.ver || "未標"}`)],
  };
  if (meta.js_hf) {
    product.discountFormulas = { high: meta.js_hf, cap: meta.js_cap || "0", methods: meta.js_meth || {} };
  }
  if (!product.kind) product.kind = "fixed";
  if (product.kind === "fixed" && Object.keys(tables.bonu).length) product.kind = "dividend";
  return product;
}

function savingsCases(product, reference) {
  const terms = Object.keys(product.issueAges);
  const picks = [];
  const sexes = [1, 2];
  const agesFor = (term) => {
    const [lo, hi] = product.issueAges[term];
    return [...new Set([Math.max(lo, 30), Math.max(lo, 35), Math.min(hi, 40), Math.min(hi, 45), Math.min(hi, 50), Math.min(hi, Math.max(lo, 60))])].filter((age) => age >= lo && age <= hi);
  };
  for (const term of terms) {
    for (const sex of sexes) {
      for (const age of agesFor(term)) {
        const cap = product.sumInsured.byAge?.[String(age)];
        const max = cap == null ? product.sumInsured.max : Math.min(product.sumInsured.max, cap);
        const sum = Math.min(max, Math.max(product.sumInsured.min, product.sumInsured.min * 2));
        picks.push({ age, sex, term: Number(term), sum, scenario: product.isr ? undefined : 2, declaredRate: product.declDefault, mode: null });
        if (picks.length >= 18) return picks;
      }
    }
  }
  return picks;
}

function compareSavings(product, reference, input) {
  const id = `${input.term}|${input.sex}|${input.age}`;
  const modes = product.hand ? ["PUA"] : null;
  let theirs;
  if (product.hand) {
    theirs = reference.quote(input.sex, input.age, Number(input.term), input.sum, 2, product.method1, product.method2);
  } else {
    const modeList = reference.ENG.modes(reference.P.meta, reference.P.data, reference.ENG.key(reference.P.meta, input.sex, input.age, Number(input.term)));
    const prefer = product.srv ? (product.isr ? "PC" : "CASH") : "PUA";
    const mode = modeList.includes(prefer) ? prefer : modeList[0];
    input.mode = mode;
    const scenario = product.isr ? Number(product.declDefault) : 2;
    const prem = reference.ENG.prem(reference.P.meta, reference.P.data, input.sex, input.age, Number(input.term), input.sum, product.method1, product.method2);
    if (!prem) return { error: "參考站沒有這組費率" };
    reference.P.meta.eff = product.asOf;
    const quoted = reference.ENG.quote(reference.P.meta, reference.P.data, input.sex, input.age, Number(input.term), input.sum, scenario, mode, prem.p1, prem.p2);
    theirs = { ...quoted, p: prem.raw, p1: prem.p1, p2: prem.p2, rate: prem.rate };
    input.scenario = product.isr ? undefined : scenario;
    input.declaredRate = product.declDefault;
  }
  if (!theirs) return { error: "參考站沒有這組費率" };
  const ours = quoteProduct(product, input);
  const row = Math.min(10, theirs.rows.length) - 1;
  const checks = [
    ["payable", theirs.p1, ours.payable],
    ["renewal", theirs.p2, ours.renewal],
    ["surrender10", theirs.rows[row].X, ours.rows[row].X],
    ["death10", theirs.rows[row].W, ours.rows[row].W],
  ];
  const bad = checks.filter(([, a, b]) => !sameNumber(a, b));
  if (bad.length) return { error: bad.map(([name, a, b]) => `${name} 參考 ${a}／本站 ${b}`).join("；") };
  return {
    sample: {
      ...input,
      expect: {
        payable: theirs.p1,
        renewal: theirs.p2,
        surrender10: theirs.rows[row].X,
        death10: theirs.rows[row].W,
      },
    },
  };
}

function main() {
  fs.rmSync(outProtection, { recursive: true, force: true });
  fs.rmSync(outSavings, { recursive: true, force: true });
  fs.mkdirSync(outProtection, { recursive: true });
  fs.mkdirSync(outSavings, { recursive: true });
  const skipped = [];
  const catalog = [];
  const windowRef = loadBaojia();
  const protection = [];
  for (const product of windowRef.PRODUCTS) {
    if (product.plans) {
      for (const plan of ["HAC1", "HAC2", "HAC3", "HAD1", "HAD2", "HAD3"]) {
        const terms = plan.startsWith("HAD") ? product.terms80 : product.terms;
        const named = `${product.name}（${plan}）`;
        const result = protectOne(windowRef, { ...product, code: product.code }, plan, named, plan, terms);
        if (result.product) protection.push(result.product);
        else skipped.push({ code: plan, name: named, reason: result.skip, detail: result.mismatches });
      }
      continue;
    }
    const result = protectOne(windowRef, product, product.code, product.name, product.code, product.terms);
    if (result.product) protection.push(result.product);
    else skipped.push({ code: product.code, name: product.name, reason: result.skip, detail: result.mismatches });
  }
  const riders = riderProducts(windowRef);
  skipped.push(...riders.skipped);
  const property = propertyProducts();
  skipped.push(...property.skipped);
  for (const product of [...protection, ...riders.made, ...property.made]) {
    writeJson(path.join(outProtection, `${product.code}.json`), product);
    catalog.push({
      code: product.code,
      name: product.name,
      type: "protection",
      role: product.role,
      category: product.category,
      currency: product.currency,
      status: "active",
      file: `protection/${product.code}.json`,
    });
  }

  const pages = fs.readdirSync(path.join(ref, "quoteyt/pages")).filter((name) => name.endsWith(".html"));
  const staticNames = new Set(["DAA.html", "SAU.html", "SAZ.html", "SBA.html", "SBC1.html", "SBC2.html", "SBC3.html", "UWA2.html"]);
  for (const page of staticNames) skipped.push({ code: page.replace(".html", ""), reason: "只有固定範例，沒有可改條件的費率表" });
  for (const page of pages) {
    if (staticNames.has(page)) continue;
    const html = read(path.join(ref, "quoteyt/pages", page));
    const code = page.replace(".html", "");
    try {
      if (html.includes("const ENG=") && html.includes("const P=")) {
        const loaded = loadStandard(html);
        const meta = loaded.P.meta;
        meta.code = meta.code || code;
        loaded.ENG._D = loaded.P.data;
        const keyOf = (sex, age, term) => loaded.ENG.key(meta, sex, age, term);
        const product = buildSavings(meta, loaded.P.data, keyOf, false);
        product.method1 = meta.m1;
        product.method2 = meta.m2;
        if (meta.dividend === "利變" || meta.isr) product.kind = "interest-sensitive";
        else if (meta.dividend) product.kind = meta.dividend === "分紅" ? "dividend" : "fixed";
        const samples = [];
        const problems = [];
        for (const input of savingsCases(product)) {
          input.mode = null;
          try {
            const compared = compareSavings(product, loaded, input);
            if (compared.error) problems.push(compared.error);
            else samples.push(compared.sample);
          } catch (error) {
            problems.push(error.message);
          }
          if (samples.length >= 3) break;
        }
        if (samples.length < 3) {
          skipped.push({ code, name: meta.name, reason: problems[0] || "儲蓄型對不到三組", detail: problems.slice(0, 4) });
          continue;
        }
        product.verificationSamples = samples.slice(0, 3);
        writeJson(path.join(outSavings, `${product.code}.json`), product);
        catalog.push({
          code: product.code, name: product.name, type: "savings", kind: product.kind,
          currency: product.currency, status: "active", file: `savings/${product.code}.json`,
        });
      } else if (html.includes("const D=") && html.includes("function quote")) {
        const quoteBody = html.slice(html.indexOf("function quote"), html.indexOf("function run("));
        if (quoteBody.includes("$('decl')") || quoteBody.includes('$("decl")')) {
          skipped.push({ code, reason: "手寫利變頁的宣告利率綁在頁面輸入，沒有獨立利率表，不估" });
          continue;
        }
        const hand = loadHand(html);
        const meta = {
          code: hand.C.code,
          name: (html.match(/<title>([^<]+)/) || [null, hand.C.code])[1].replace(/ 快速報價$/, ""),
          ver: null,
          cur: hand.C.cur || (html.includes("美元") ? "USD" : "TWD"),
          terms: Object.fromEntries(Object.entries(hand.C.ages).map(([term, band]) => [term, band])),
          smin: hand.C.smin,
          smax: ceilingSum(hand.C.smin, hand.C.smax, hand.C.maxf),
          maxf: hand.C.maxf || null,
          m1: hand.C.m1?.includes("金融機構轉帳") ? "金融機構轉帳" : hand.C.m1?.[0],
          m2: hand.C.m2?.includes("金融機構轉帳") ? "金融機構轉帳" : hand.C.m2?.[0],
          dividend: "分紅",
          maxAge: 110,
        };
        const product = buildSavings(meta, hand.D, hand.keyOf, true);
        product.method1 = meta.m1;
        product.method2 = meta.m2;
        product.handDiscount = handRule(hand.C.code);
        if (!product.handDiscount) {
          skipped.push({ code, reason: "手寫頁的折扣規則沒有完整對應，不猜" });
          continue;
        }
        const samples = [];
        const problems = [];
        for (const input of savingsCases(product)) {
          try {
            const compared = compareSavings(product, hand, input);
            if (compared.error) problems.push(compared.error);
            else samples.push(compared.sample);
          } catch (error) {
            problems.push(error.message);
          }
          if (samples.length >= 3) break;
        }
        if (samples.length < 3) {
          skipped.push({ code, name: meta.name, reason: problems[0] || "手寫頁對不到", detail: problems.slice(0, 4) });
          continue;
        }
        product.verificationSamples = samples.slice(0, 3);
        writeJson(path.join(outSavings, `${product.code}.json`), product);
        catalog.push({
          code: product.code, name: product.name, type: "savings", kind: product.kind,
          currency: product.currency, status: "active", file: `savings/${product.code}.json`,
        });
      } else skipped.push({ code, reason: "頁面沒有可抽出的費率表" });
    } catch (error) {
      skipped.push({ code, reason: error.message });
    }
    if (catalog.length % 10 === 0) console.log("progress", catalog.length, page);
  }

  const occ = read(path.join(ref, "baojia/occupation_class.csv")).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = occ.shift().split(",");
  const jobs = occ.map((line) => {
    const cells = line.split(",");
    return {
      code: cells[0],
      category: (cells[1] || "").replace(/^\d+\s*/, ""),
      subcategory: (cells[2] || "").replace(/^\d+\s*/, ""),
      job: cells[3] || "",
      class: (cells[4] || "").trim(),
      note: cells.slice(5).join(",").trim(),
    };
  }).filter((item) => item.job);
  writeJson(path.join(root, "data/occupation.json"), jobs);
  fs.copyFileSync(path.join(ref, "quoteyt/fx.json"), path.join(root, "data/fx.json"));
  fs.writeFileSync(path.join(root, "data/products.json"), JSON.stringify({ version: fetched, updated: fetched, products: catalog }, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "data/skipped.json"), JSON.stringify(skipped, null, 2) + "\n");
  const protectionCount = catalog.filter((item) => item.type === "protection" && item.role === "main").length;
  const riderCount = catalog.filter((item) => item.type === "protection" && item.role !== "main").length;
  const savingsCount = catalog.filter((item) => item.type === "savings").length;
  console.log(JSON.stringify({ protectionCount, riderCount, savingsCount, skipped: skipped.length }, null, 2));
  console.log(skipped.slice(0, 30));
}

function propertyProducts() {
  const element = () => null;
  const context = {
    window: {},
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: element, addEventListener() {}, querySelectorAll: () => [] },
  };
  vm.createContext(context);
  vm.runInContext(read(path.join(ref, "baojia/pc.js")), context);
  const made = [];
  const skippedLocal = [];
  for (const item of context.window.PCQ.list) {
    const premiums = {};
    const plans = [];
    let hits = 0;
    for (const plan of item.plans) {
      plans.push({ name: plan.k, min: plan.a?.[0] ?? 0, max: plan.a?.[1] ?? 99 });
      for (let age = plan.a?.[0] ?? 0; age <= (plan.a?.[1] ?? 0); age += 1) {
        for (const sex of [1, 2]) {
          const values = {};
          for (const occ of [1, 2, 3, 4, 5, 6]) {
            try { values[occ] = plan.pr(age, sex, occ); } catch { values[occ] = null; }
          }
          const present = Object.values(values).filter((value) => value != null);
          if (!present.length) continue;
          if (present.length === 6 && new Set(present).size === 1) premiums[`${plan.k}|${age}|${sex}`] = present[0];
          else {
            for (const occ of [1, 2, 3, 4, 5, 6]) {
              if (values[occ] != null) premiums[`${plan.k}|${age}|${sex}|${occ}`] = values[occ];
            }
          }
          hits += 1;
        }
      }
    }
    if (!hits) {
      skippedLocal.push({ code: item.id, name: item.n, reason: "DM 沒有印好的保費，頁面標另計" });
      continue;
    }
    const product = {
      code: item.id,
      name: item.n,
      currency: "TWD",
      type: "protection",
      status: "active",
      category: item.t,
      role: "property",
      calc: "band",
      version: null,
      updated: fetched,
      unitKind: "plan",
      sex: [1, 2],
      occupation: { min: 1, max: 6 },
      plans: plans.map((plan) => plan.name),
      issueAges: { plans },
      premiums,
      benefits: item.b || [],
      rule: item.age || "",
      note: "保費只用 DM 印好的數字。沒印的組合不估算。",
      sources: [sourceNote("baojia-fyc.pages.dev", null, item.src || "產險 DM 年齡帶保費")],
    };
    const cases = [];
    for (const [key, value] of Object.entries(premiums)) {
      const [plan, age, sex, occ] = key.split("|");
      const input = { age: Number(age), sex: Number(sex), occupation: Number(occ || 1), plan, mode: "annual" };
      const ours = quoteProduct(product, input);
      if (ours.payable !== value) {
        skippedLocal.push({ code: item.id, reason: `DM ${value} 與試算 ${ours.payable} 不同` });
        cases.length = 0;
        break;
      }
      cases.push({ ...input, expect: { payable: value, annual: value } });
      if (cases.length >= 3) break;
    }
    if (cases.length < 3) {
      if (!skippedLocal.some((row) => row.code === item.id)) skippedLocal.push({ code: item.id, name: item.n, reason: "印製保費不足三組" });
      continue;
    }
    product.verificationSamples = cases;
    made.push(product);
  }
  return { made, skipped: skippedLocal };
}

function handRule(code) {
  if (code === "PFK") return { high: [{ tiers: [[20, 0.01]] }], caps: [{ term: 1, value: 0.01 }, { value: 0.02 }], zeroTerms: [1], remit: "匯款" };
  if (code === "PFA") return { high: [{ term: 3, tiers: [[10, 0.01]] }, { tiers: [[15, 0.01]] }], caps: [{ value: 0.02 }], zeroTerms: [], remit: "外幣匯款" };
  if (code === "PFJ") return { high: [{ tiers: [[15, 0.01]] }], caps: [{ value: 0.02 }], zeroTerms: [], remit: "外幣匯款" };
  if (code === "FBO") return {
    high: [{ term: 2, tiers: [[25, 0.01], [15, 0.005]] }, { tiers: [[60, 0.03], [50, 0.02], [20, 0.01]] }],
    caps: [{ term: 2, value: 0.02 }, { value: 0.04 }],
    zeroTerms: [],
    remit: "匯款",
  };
  return null;
}

main();
