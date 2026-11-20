import { annualPayable } from "./calc.js";

const lowFace = "保費不足最低投保額";
const highFace = "超過保額上限";

export function faceStep(product) {
  const step = Number(product.sumInsured?.step);
  return step > 0 ? step : 0.01;
}

export function faceBounds(product, age) {
  const limits = product.sumInsured || {};
  const min = Number(limits.min);
  const ageMax = limits.byAge?.[String(age)];
  const max = ageMax == null ? Number(limits.max) : Math.min(Number(limits.max), Number(ageMax));
  return { min, max, step: faceStep(product) };
}

function sumAt(min, step, index) {
  return Math.round((min + index * step) * 1e6) / 1e6;
}

export function solveFace(product, input, budget) {
  if (product.calc === "annuity") return { note: "躉繳商品" };
  const { min, max, step } = faceBounds(product, input.age);
  if (!(max >= min) || !(step > 0)) return { note: "無此年齡/性別資料" };
  const count = Math.floor((max - min) / step + 1e-8);
  const base = {
    age: input.age,
    sex: input.sex,
    term: input.term,
    scenario: input.scenario ?? 2,
    declaredRate: input.declaredRate,
    mode: input.mode,
  };
  let best = null;
  let bestIndex = -1;
  for (let index = 0; index <= count; index += 1) {
    const sum = sumAt(min, step, index);
    let payable;
    try {
      payable = annualPayable(product, { ...base, sum });
    } catch (error) {
      if (bestIndex < 0 && index === 0) throw error;
      continue;
    }
    if (payable <= budget + 1e-6) {
      best = { sum, payable };
      bestIndex = index;
    }
  }
  if (!best) return { note: lowFace };
  if (bestIndex === count && best.payable < budget - 1e-6) return { note: highFace };
  return best;
}
