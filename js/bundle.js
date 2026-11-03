/**
 * 主約加附約一起估。附加關係、可附加額度、醫療日額與手術累計上限，對齊參考試算的規則。
 * 每一列保費仍用這個站自己的費率計算。
 */

import { quoteProduct } from "./calc.js";

const MODES = ["annual", "semi", "quarterly", "monthly"];
const MODE_NAME = { annual: "年繳", semi: "半年繳", quarterly: "季繳", monthly: "月繳" };
const WAIVERS = ["WP", "WPA", "WPF1", "WPH"];
const PARENT = new Set(["WPA", "WPF1"]);
const ONE_YEAR = new Set(["HJK", "ADM", "HSV", "HSY", "HSW", "SDL", "UCR", "ADH", "ADG", "TMR", "ADN"]);
const MED_DAY = ["HJK", "HKR5", "HLR2"];
const CANCER_RIDER = ["CWR4", "PCC5", "CMR", "CNR", "HSW"];
const CANCER_MAIN = ["CIA", "CIB", "CLX", "CLZ", "CLQ"];
const CAPCO = { XWS5: 1, OLA6: 1, XDY: 1, AJC1: 1, AJI: 1, CLX: 1, CLZ: 1, CIA: 1, CIB: 1, SDP: 1, SDG: 1, SDH: 1, SDN: 1, SDJ: 1, SDKA: 1, SWB5: 1, LTP: 1, HTB: 1, XDN2: 70, LTS: 100, LTQ: 100, LTT: 100 };
const LIFECO = { XWS5: 1, OLA6: 1, XDY: 1, LTS: 100, SDG: 1, SDP: 1, SDH: 1, SDJ: 1, SDKA: 1, SWB5: 1, SWD1: 1, SWW: 1 };
const SURG = { SIE: 1, SJR1: 1 };
const LTC_WHOLE = ["LTS", "LTQ"];

export function modeName(mode) {
  return MODE_NAME[mode] || mode;
}

function describe(product) {
  const code = product.code;
  const text = `${product.category || ""} ${product.cover || ""} ${product.note || ""}`;
  return {
    code,
    name: product.name,
    whole: /終身/.test(text),
    cancer: /防癌|癌/.test(product.category || ""),
    ci: /重疾|重大傷病/.test(product.category || ""),
    acc: /傷害/.test(product.category || ""),
    fx: product.currency === "USD" || /^FD/.test(code),
    noRider: /不可附加附約/.test(product.note || "") ? "此主約不可附加附約" : code === "SDKA" ? "SDKA 僅可附加 AOR、CLR" : false,
  };
}

export function riderOnMain(code, main) {
  if (!main) return { ok: false, why: "請先選主約" };
  if (main.noRider) return { ok: false, why: `${main.code}：${main.noRider}` };
  if (["SDH", "SDN", "SDP"].includes(main.code) && !["ADG", "ADH", "TMR", "XTY", "CMR", "CNR", "HTA"].includes(code)) {
    return { ok: false, why: `${main.code} 僅可附加 ADG、ADH、TMR、XTY、CMR、CNR、HTA` };
  }
  if (main.cancer && CANCER_RIDER.includes(code)) return { ok: false, why: `${main.code} 不得附加防癌險附約` };
  const foreignRider = /^FD[EFG]$/.test(code);
  if (foreignRider && !main.fx) return { ok: false, why: "僅可附加同幣別外幣壽險主約" };
  if (foreignRider && main.code === "FDC") return { ok: false, why: "FDC 不可附加附約" };
  if (!foreignRider && main.fx) return { ok: false, why: "外幣主約只能附加同幣別外幣附約" };
  if (code === "HLR2") return main.code === "HIY1" ? { ok: true } : { ok: false, why: "限附加於 HIY1" };
  if (code === "ADN") return main.code === "LTP" ? { ok: true } : { ok: false, why: "限附加於 LTP" };
  if (code === "CWR4" || code === "PCC5") return main.whole && !main.cancer ? { ok: true } : { ok: false, why: "僅可附加終身型主約（不含癌症險）" };
  if (code === "SDL") return main.whole && !main.ci ? { ok: true } : { ok: false, why: "僅可附加終身型主約（不含重大傷病）" };
  if (code === "SWZ") return !main.ci && !main.cancer ? { ok: true } : { ok: false, why: "不可附加重疾、重大傷病或癌症主約" };
  if (code === "LTU") return main.whole || main.code === "HAC" || /^HAC/.test(main.code) ? { ok: true } : { ok: false, why: "需保障期間不短於 LTU 的主約" };
  if (code === "ADG") return !main.acc || ["AJC1", "AJI"].includes(main.code) ? { ok: true } : { ok: false, why: "不得附加於傷害險主約（AJC1、AJI 除外）" };
  if (WAIVERS.includes(code)) return { ok: true };
  return { ok: true };
}

function capOf(product, sum) {
  const code = product.code;
  if (/^HAC[123]$/.test(code)) {
    const wan = { HAC1: 10, HAC2: 20, HAC3: 30 }[code];
    return { wan, text: `${code} 可附加額度 ${wan} 萬` };
  }
  if (!(sum > 0)) return null;
  if (product.unitKind === "day" && /醫療/.test(product.category || "") && code !== "SWI") {
    return { wan: sum * 100 / 10000, text: `${code} 日額 ${sum} 元 ×100` };
  }
  if (code === "SIE") return { wan: sum * 100 / 10000, text: `SIE ${sum} 元 ×100` };
  if (product.unitKind === "wan" && code in CAPCO) {
    return { wan: Math.round(sum * CAPCO[code] * 100) / 100, text: `${code} ${sum} 萬${CAPCO[code] !== 1 ? ` ×${CAPCO[code]}` : ""}` };
  }
  return null;
}

function capLimit(code, cap, hostCode) {
  if (!cap) return null;
  if (code === "ADH") return { max: Math.floor(cap.wan * 5 + 1e-9), why: `可附加額度 5 倍（${cap.text}）` };
  if (code === "SDL") return { max: Math.max(50, Math.floor(cap.wan + 1e-9)), why: `超過 50 萬須不大於可附加額度（${cap.text}）` };
  if (code === "LTU") {
    return LTC_WHOLE.includes(hostCode)
      ? { max: Math.floor(cap.wan / 100 * 10000 * 2 + 1e-9), why: `長照終身主約保額 2 倍` }
      : { max: Math.floor(cap.wan * 10000 / 10 / 1000 + 1e-9) * 1000, why: `保額 ×10 須不大於可附加額度（${cap.text}）` };
  }
  return null;
}

function lifeWan(product, sum, existing) {
  const factor = LIFECO[product.code];
  const fromMain = factor ? sum * factor : (/壽險/.test(product.category || "") && product.unitKind === "wan" ? sum : 0);
  return fromMain + (Number(existing) || 0);
}

function medRiderCap(life) {
  return life < 30 ? 4000 : life <= 100 ? 5000 : life <= 200 ? 6000 : 8000;
}

function specCap(spec, age, life) {
  if (!spec?.on || !spec.id) return null;
  if (spec.id === "kid") {
    if (spec.par) return { rider: 4000, total: 6000, label: "孩童／學生（比照父母或兄弟姊妹保單）" };
    if (age <= 5) return { rider: 4000, total: 4000, label: "孩童／學生 0–5 歲" };
    if (life <= 200) return { rider: 4000, total: 6000, label: "孩童／學生 6 歲以上、壽險 200 萬以內" };
    return { rider: 6000, total: 6000, label: "孩童／學生 6 歲以上、壽險超過 200 萬" };
  }
  if (life <= 200) return { rider: 4000, total: 4000, label: "家管、退休、無業或待業，壽險 200 萬以內" };
  return { rider: 6000, total: 6000, label: "家管、退休、無業或待業，壽險超過 200 萬" };
}

function lineOf(product, role, quote, extra = {}) {
  return {
    role,
    code: product.code,
    name: product.name,
    annual: quote.annual,
    payable: quote.payable,
    renewal: extra.renewal ?? quote.payableRenew ?? null,
    currency: quote.currency || product.currency || "TWD",
    error: null,
    ...extra,
  };
}

function renewalQuote(product, input) {
  if (!ONE_YEAR.has(product.code)) return null;
  try {
    return quoteProduct(product, { ...input, age: Number(input.age) + 1 }).payable;
  } catch {
    return null;
  }
}

export function quoteBundle(byCode, input) {
  const mode = MODES.includes(input.mode) ? input.mode : "annual";
  const payDiscount = input.payDiscount !== false;
  const mainProduct = byCode[input.main?.code];
  if (!mainProduct) throw new Error("請選擇主約");
  const mainInfo = describe(mainProduct);
  const person = {
    age: Number(input.age),
    sex: Number(input.sex),
    occupation: Number(input.occupation || 1),
    mode,
    payDiscount,
    term: input.main.term,
    sum: Number(input.main.sum),
    plan: input.main.plan,
  };
  const lines = [];
  const errors = [];
  let mainQuote;
  try {
    mainQuote = quoteProduct(mainProduct, person);
    lines.push(lineOf(mainProduct, "主約", mainQuote));
  } catch (error) {
    return { lines: [{ role: "主約", code: mainProduct.code, name: mainProduct.name, error: error.message }], errors: [error.message], totalPayable: 0, totalAnnual: 0, currency: "TWD" };
  }
  const cap = capOf(mainProduct, person.sum);
  const hostSum = mainProduct.unitKind === "day" ? person.sum : null;
  let covered = mainProduct.currency === "USD" ? 0 : mainQuote.annual;
  const dayRiders = [];
  const surgItems = [];
  if (SURG[mainProduct.code]) surgItems.push([mainProduct.code, person.sum * SURG[mainProduct.code]]);
  for (const rider of input.riders || []) {
    const product = byCode[rider.code];
    if (!product || WAIVERS.includes(rider.code)) continue;
    const allow = riderOnMain(rider.code, mainInfo);
    if (!allow.ok) {
      lines.push({ role: "附約", code: rider.code, name: product?.name || rider.code, error: allow.why });
      errors.push(allow.why);
      continue;
    }
    const limit = capLimit(rider.code, cap, mainProduct.code);
    if (limit && Number(rider.sum) > limit.max + 1e-9) {
      const why = `${rider.code} ${limit.why}，上限 ${limit.max}`;
      lines.push({ role: "附約", code: rider.code, name: product.name, error: why });
      errors.push(why);
      continue;
    }
    if (rider.code === "TMR") {
      const adg = (input.riders || []).find((item) => item.code === "ADG");
      if (!adg) {
        lines.push({ role: "附約", code: "TMR", name: product.name, error: "TMR 須與 ADG 附加在同一主約" });
        errors.push("TMR 須與 ADG 附加在同一主約");
        continue;
      }
      if (Number(rider.sum) > adg.sum * 0.1 + 1e-9) {
        lines.push({ role: "附約", code: "TMR", name: product.name, error: "TMR 須不大於 ADG 保額的 10%" });
        errors.push("TMR 須不大於 ADG 保額的 10%");
        continue;
      }
    }
    try {
      const quote = quoteProduct(product, {
        ...person,
        term: rider.term || person.term,
        sum: Number(rider.sum),
        plan: rider.plan || 1,
        hostSum,
      });
      const renewal = renewalQuote(product, { ...person, term: rider.term || person.term, sum: Number(rider.sum), plan: rider.plan || 1 });
      lines.push(lineOf(product, "附約", quote, { renewal }));
      if (quote.currency !== "USD") covered += quote.annual;
      if (MED_DAY.includes(rider.code)) dayRiders.push([rider.code, Number(rider.sum)]);
      if (SURG[rider.code]) surgItems.push([rider.code, Number(rider.sum) * SURG[rider.code]]);
    } catch (error) {
      lines.push({ role: "附約", code: rider.code, name: product.name, error: error.message });
      errors.push(error.message);
    }
  }
  covered = Math.round(covered * 10) / 10;
  for (const rider of input.riders || []) {
    if (!WAIVERS.includes(rider.code)) continue;
    const product = byCode[rider.code];
    if (!product) continue;
    if (PARENT.has(rider.code) && (input.parentAge == null || input.parentAge === "")) {
      lines.push({ role: "豁免", code: rider.code, name: product.name, error: "請填要保人年齡" });
      errors.push("請填要保人年齡");
      continue;
    }
    if (mainProduct.currency === "USD") {
      lines.push({ role: "豁免", code: rider.code, name: product.name, error: "美元主約不適用台幣豁免附約" });
      errors.push("美元主約不適用台幣豁免附約");
      continue;
    }
    const term = Number(person.term);
    if (rider.code === "WP" && ![10, 15, 20, 25, 30].includes(term)) {
      lines.push({ role: "豁免", code: rider.code, name: product.name, error: "WP 費率只收主約繳費 10、15、20、25、30 年" });
      errors.push("WP 年期不符");
      continue;
    }
    if (rider.code !== "WP" && !(term >= 3 && term <= 30)) {
      lines.push({ role: "豁免", code: rider.code, name: product.name, error: `${rider.code} 限主約繳費 3–30 年` });
      errors.push(`${rider.code} 年期不符`);
      continue;
    }
    try {
      const quote = quoteProduct(product, {
        age: PARENT.has(rider.code) ? Number(input.parentAge) : person.age,
        sex: PARENT.has(rider.code) ? Number(input.parentSex || 1) : person.sex,
        occupation: person.occupation,
        term,
        covered,
        mode,
        payDiscount,
      });
      lines.push(lineOf(product, "豁免", quote, { covered }));
    } catch (error) {
      lines.push({ role: "豁免", code: rider.code, name: product.name, error: error.message });
      errors.push(error.message);
    }
  }
  const life = lifeWan(mainProduct, person.sum, input.existingLife);
  const spec = specCap(input.spec, person.age, life);
  const riderCap = spec ? Math.min(medRiderCap(life), spec.rider) : medRiderCap(life);
  const dayTotal = dayRiders.reduce((sum, item) => sum + item[1], 0);
  if (dayTotal > riderCap) errors.push(`住院醫療日額累計 ${dayTotal} 元，超過上限 ${riderCap} 元`);
  const surgMax = life > 200 && person.occupation <= 2 ? 4000 : 3000;
  const surgTotal = surgItems.reduce((sum, item) => sum + item[1], 0);
  if (surgTotal > surgMax) errors.push(`手術醫療險累計 ${surgTotal} 元，超過上限 ${surgMax} 元`);
  if (CANCER_MAIN.includes(mainProduct.code) && person.sum > 500) errors.push("保額型癌症險累計最高 500 萬");
  const priced = lines.filter((line) => line.payable != null && !line.error);
  return {
    lines,
    errors,
    covered,
    lifeWan: life,
    medCap: riderCap,
    currency: mainQuote.currency || "TWD",
    totalAnnual: priced.reduce((sum, line) => sum + (line.currency === "USD" ? 0 : line.annual), 0),
    totalPayable: priced.reduce((sum, line) => sum + (line.currency === "USD" ? 0 : line.payable), 0),
    mode,
  };
}

export function attachableRiders(byCode, mainCode) {
  const main = byCode[mainCode];
  if (!main) return [];
  const info = describe(main);
  return Object.values(byCode)
    .filter((product) => product.role === "rider" || product.role === "waiver" || product.calc === "waiver")
    .filter((product) => riderOnMain(product.code, info).ok)
    .map((product) => product.code);
}
