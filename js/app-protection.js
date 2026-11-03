import { insuranceAge, lookupAgeRate, premium, waiverPremium } from "./engine.js";
import { fillVersion, loadJson, money } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const products = {};
for (const item of catalog.products.filter((row) => row.type === "protection")) {
  products[item.code] = await loadJson(`data/${item.file}`);
}

const mainSelect = document.querySelector("#main");
mainSelect.innerHTML = Object.values(products).map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
const ageInput = document.querySelector("#age");
const birthInput = document.querySelector("#birth");

function selectedSex() {
  return Number(document.querySelector('input[name="sex"]:checked').value);
}

function syncAgeFromBirth() {
  if (!birthInput.value) return;
  ageInput.value = String(insuranceAge(birthInput.value, new Date()));
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
}

birthInput.addEventListener("change", syncAgeFromBirth);
document.querySelector("#ageMinus").addEventListener("click", () => { ageInput.value = String(Number(ageInput.value) - 1); });
document.querySelector("#agePlus").addEventListener("click", () => { ageInput.value = String(Number(ageInput.value) + 1); });
syncAgeFromBirth();

function currentProduct() {
  return products[mainSelect.value];
}

function fillTerms() {
  const product = currentProduct();
  document.querySelector("#term").innerHTML = Object.keys(product.issueAges).map((term) => `<option value="${term}">${term} 年期</option>`).join("");
  const limits = product.sumInsured;
  const sum = document.querySelector("#sum");
  sum.min = limits.min;
  sum.max = limits.max;
  sum.step = limits.step;
}

function fillRiders() {
  const product = currentProduct();
  const age = Number(ageInput.value);
  const occ = Number(document.querySelector("#occ").value);
  const box = document.querySelector("#riders");
  box.innerHTML = product.riders.map((rider) => {
    const [lo, hi] = rider.issueAges;
    const ok = age >= lo && age <= hi && occ >= rider.occupation.min && occ <= rider.occupation.max;
    return `<label><input type="checkbox" data-rider="${rider.code}" ${ok ? "" : "disabled"}> ${rider.name}${ok ? "" : "（此年齡或職業不可附加）"}</label>
      <input data-rider-sum="${rider.code}" type="number" value="${rider.sumInsured.min}" min="${rider.sumInsured.min}" max="${rider.sumInsured.max}" step="${rider.sumInsured.step}" ${ok ? "" : "disabled"}>`;
  }).join("");
}

mainSelect.addEventListener("change", () => { fillTerms(); fillRiders(); });
ageInput.addEventListener("change", fillRiders);
document.querySelector("#occ").addEventListener("change", fillRiders);
fillTerms();
fillRiders();

function highSumDiscount(product, sum) {
  const steps = product.discounts.highSum || [];
  const hit = steps.filter(([door]) => sum >= door).sort((a, b) => b[0] - a[0])[0];
  return hit ? hit[1] : 0;
}

document.querySelector("#calc").addEventListener("click", () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const product = currentProduct();
    const age = Number(ageInput.value);
    const sex = selectedSex();
    const term = document.querySelector("#term").value;
    const [lo, hi] = product.issueAges[term];
    if (age < lo || age > hi) throw new Error("保險年齡不在這個年期的範圍裡");
    const occ = Number(document.querySelector("#occ").value);
    if (occ < product.occupation.min || occ > product.occupation.max) throw new Error("這個職業類別不能投保");
    const sum = Number(document.querySelector("#sum").value);
    if (sum < product.sumInsured.min || sum > product.sumInsured.max || (sum - product.sumInsured.min) % product.sumInsured.step !== 0) {
      throw new Error("保額不在上下限或級距裡");
    }
    const mode = document.querySelector("#mode").value;
    const factor = product.modeFactors[mode];
    const rate = lookupAgeRate(product.rates[`${term}|${sex}`], age);
    if (rate == null) throw new Error("沒有這個條件的費率");
    const main = premium({
      units: sum / product.unit,
      rate,
      modeFactor: factor,
      discounts: [highSumDiscount(product, sum), product.discounts.pay],
      cap: product.discounts.cap,
    });
    const lines = [`<p>主約年繳 ${money(main.annual)}，本期 ${money(main.payable)}</p>`];
    let waivedAnnual = main.annual;
    let modalTotal = main.payable;
    for (const rider of product.riders) {
      const checked = document.querySelector(`[data-rider="${rider.code}"]`);
      if (!checked || !checked.checked) continue;
      const riderSum = Number(document.querySelector(`[data-rider-sum="${rider.code}"]`).value);
      const riderRate = lookupAgeRate(rider.rates[String(sex)], age);
      const part = premium({
        units: riderSum / rider.unit,
        rate: riderRate,
        modeFactor: factor,
        discounts: [product.discounts.pay],
        cap: product.discounts.cap,
      });
      waivedAnnual += part.annual;
      modalTotal += part.payable;
      lines.push(`<p>${rider.name} 本期 ${money(part.payable)}</p>`);
    }
    const waiverRate = product.waiver.ratePer10k[`${term}|${sex}`];
    const waiver = waiverPremium({ waivedAnnual, ratePer10k: waiverRate, modeFactor: factor });
    modalTotal += waiver.payable;
    lines.push(`<p>${product.waiver.name} 本期 ${money(waiver.payable)}</p>`);
    lines.push(`<p class="money">本期合計 ${money(modalTotal)}</p>`);
    document.querySelector("#lines").innerHTML = lines.join("");
    document.querySelector("#resultTag").textContent = `〔${mode === "annual" ? "年繳" : mode === "semi" ? "半年繳" : mode === "quarterly" ? "季繳" : "月繳"}〕`;
    document.querySelector("#result").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
