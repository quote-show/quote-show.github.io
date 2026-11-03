import { quoteProduct, sumLimits } from "./calc.js";
import { insuranceAge } from "./engine.js";
import { fillVersion, loadJson, money } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const protection = catalog.products.filter((item) => item.type === "protection");
const params = new URLSearchParams(location.search);
const initial = params.get("code");
const select = document.querySelector("#main");
select.innerHTML = protection.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
if (initial && protection.some((item) => item.code === initial)) select.value = initial;

const cache = new Map();
async function product() {
  const code = select.value;
  if (!cache.has(code)) cache.set(code, loadJson(`data/protection/${code}.json`));
  return cache.get(code);
}

const ageInput = document.querySelector("#age");
const birthInput = document.querySelector("#birth");
let jobs = [];

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

function sumLabel(item) {
  const unit = { wan: "萬元", day: "元／日", h: "元", usd: item.role === "rider" ? "萬美元" : "美元", unit: "單位", plan: "計畫", waiver: "元", yuan: "元" };
  return item.calc === "waiver" ? "被豁免的年繳保費" : `保額（${unit[item.unitKind] || "元"}）`;
}

async function fillTerms() {
  const item = await product();
  const demo = document.querySelector("#demo");
  if (item.status === "stopped") {
    demo.hidden = false;
    demo.textContent = item.stop === "2021-01-01" ? "停售（110/01/01）" : `停售${item.stop ? `（${item.stop}）` : ""}`;
  } else if (item.status === "demo") {
    demo.hidden = false;
    demo.textContent = "示範資料，非真實費率";
  } else {
    demo.hidden = true;
  }
  document.querySelector("#payDisc").parentElement.hidden = item.calc === "band" && !item.discounts?.pay;
  const source = item.sources?.[0];
  document.querySelector("#sourceNote").textContent = source ? `${source.version || item.code} · ${source.fetched}` : "";
  const termLabel = document.querySelector("label[for=term]");
  if (item.calc === "band") {
    termLabel.textContent = "計畫";
    document.querySelector("#term").innerHTML = (item.plans || []).map((name) => `<option value="${name}">${name}</option>`).join("");
  } else {
    termLabel.textContent = "年期";
    const terms = Object.keys(item.issueAges || {}).filter((term) => Number.isFinite(Number(term)));
    document.querySelector("#term").innerHTML = (terms.length ? terms : ["1"]).map((term) => `<option value="${term}">${term} 年期</option>`).join("");
  }
  document.querySelector("#sumLabel").textContent = sumLabel(item);
  const sample = item.verificationSamples?.[0];
  if (sample && !document.querySelector("#sum").dataset.touched) ageInput.value = sample.age;
  const age = Number(ageInput.value);
  const limits = item.calc === "waiver" ? { min: 1, max: 5000000, step: 1 } : sumLimits(item, age, Number(document.querySelector("#occ").value));
  const sum = document.querySelector("#sum");
  if (limits.min != null) sum.min = limits.min;
  if (limits.max != null) sum.max = limits.max;
  sum.step = limits.step || 1;
  const rules = [item.rule, item.note, item.cover].filter(Boolean);
  document.querySelector("#rules").innerHTML = rules.map((line) => `<p>${line}</p>`).join("")
    || "<p>費率表已收錄。核保仍以正式投保規則為準。</p>";
  const sexAllowed = item.sex || [1, 2];
  document.querySelectorAll('input[name="sex"]').forEach((input) => {
    input.disabled = !sexAllowed.includes(Number(input.value));
    if (input.disabled && input.checked) {
      const other = document.querySelector(`input[name="sex"][value="${sexAllowed[0]}"]`);
      if (other) other.checked = true;
    }
  });
  if (sample && !document.querySelector("#sum").dataset.touched) {
    ageInput.value = sample.age;
    const sex = document.querySelector(`input[name="sex"][value="${sample.sex}"]`);
    if (sex && !sex.disabled) sex.checked = true;
    const preset = item.calc === "band" ? sample.plan : sample.term;
    if ([...document.querySelector("#term").options].some((option) => option.value === String(preset))) {
      document.querySelector("#term").value = String(preset);
    }
    document.querySelector("#occ").value = String(sample.occupation || 1);
    document.querySelector("#sum").value = item.calc === "waiver" ? sample.covered : sample.sum;
    document.querySelector("#ageTag").textContent = `〔保險年齡 ${sample.age}〕`;
  }
}

select.addEventListener("change", () => {
  document.querySelector("#sum").dataset.touched = "";
  const url = new URL(location.href);
  url.searchParams.set("code", select.value);
  history.replaceState(null, "", url);
  fillTerms();
});
document.querySelector("#sum").addEventListener("input", (event) => { event.target.dataset.touched = "1"; });
ageInput.addEventListener("change", fillTerms);
document.querySelector("#occ").addEventListener("change", fillTerms);
await fillTerms();

loadJson("data/occupation.json").then((rows) => { jobs = rows; }).catch(() => { jobs = []; });
document.querySelector("#job").addEventListener("input", (event) => {
  const query = event.target.value.trim();
  const box = document.querySelector("#jobs");
  if (!query) { box.innerHTML = ""; return; }
  const found = jobs.filter((item) => `${item.job}${item.category}${item.subcategory}`.includes(query)).slice(0, 8);
  box.innerHTML = found.map((item) => `<button type="button" class="ghost" data-class="${item.class}" data-job="${item.job}">${item.job} · ${item.class || "—"}類</button>`).join("");
});
document.querySelector("#jobs").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const occ = document.querySelector("#occ");
  if ([...occ.options].some((option) => option.value === button.dataset.class)) occ.value = button.dataset.class;
  document.querySelector("#job").value = button.dataset.job;
  document.querySelector("#jobs").innerHTML = "";
});

document.querySelector("#calc").addEventListener("click", async () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const item = await product();
    const result = quoteProduct(item, {
      age: Number(ageInput.value),
      sex: selectedSex(),
      occupation: Number(document.querySelector("#occ").value),
      term: document.querySelector("#term").value,
      sum: Number(document.querySelector("#sum").value),
      covered: Number(document.querySelector("#sum").value),
      plan: item.calc === "band" ? document.querySelector("#term").value : 1,
      mode: document.querySelector("#mode").value,
      payDiscount: document.querySelector("#payDisc").checked,
    });
    const lines = [
      `<p>年繳 ${money(result.annual, result.currency)}，本期 ${money(result.payable, result.currency)}</p>`,
    ];
    if (result.payableNext != null) lines.push(`<p>第 ${result.nextFromYear || "後"} 年起本期 ${money(result.payableNext, result.currency)}</p>`);
    if (result.payableRenew != null) lines.push(`<p>次年續保參考 ${money(result.payableRenew, result.currency)}</p>`);
    lines.push(`<p class="money">本期合計 ${money(result.payable, result.currency)}</p>`);
    document.querySelector("#lines").innerHTML = lines.join("");
    const mode = document.querySelector("#mode").selectedOptions[0].textContent;
    document.querySelector("#resultTag").textContent = `〔${mode}〕`;
    document.querySelector("#result").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
