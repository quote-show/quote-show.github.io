import { projectSavings } from "./engine.js";
import { fillVersion, loadJson, money, percent } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const files = {};
for (const item of savings) files[item.code] = await loadJson(`data/${item.file}`);

const params = new URLSearchParams(location.search);
const initial = params.get("code") && files[params.get("code")] ? params.get("code") : savings[0].code;
const select = document.querySelector("#product");
select.innerHTML = savings.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
select.value = initial;

function product() {
  return files[select.value];
}

function fillTerms() {
  const item = product();
  document.querySelector("#term").innerHTML = Object.keys(item.terms).map((term) => `<option>${term}</option>`).join("");
  document.querySelector("#codeTag").textContent = `〔${item.code}〕`;
  document.querySelector("#pageTitle").textContent = item.name;
  document.querySelector("#scenarioBox").hidden = item.kind !== "dividend";
  document.querySelector("#declaredBox").hidden = item.kind !== "interest-sensitive";
  if (item.declaredRate) document.querySelector("#declared").value = String(item.declaredRate);
  const sum = document.querySelector("#sum");
  sum.min = item.sumInsured.min;
  sum.max = item.sumInsured.max;
  sum.step = item.sumInsured.step;
}

select.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("code", select.value);
  history.replaceState(null, "", url);
  fillTerms();
});
fillTerms();

document.querySelector("#calc").addEventListener("click", () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const item = product();
    const result = projectSavings(item, {
      age: Number(document.querySelector("#age").value),
      sex: Number(document.querySelector("#sex").value),
      term: Number(document.querySelector("#term").value),
      sum: Number(document.querySelector("#sum").value),
      scenario: document.querySelector("#scenario").value,
      declaredRate: Number(document.querySelector("#declared").value),
    });
    const yearTen = result.rows[Math.min(9, result.rows.length - 1)];
    document.querySelector("#headline").innerHTML = `年繳 ${money(result.annual, item.currency)} · 回本年度 ${result.paybackYear ?? "—"} · 內部報酬率 ${percent(result.irr)} · 第 ${yearTen.year} 年壽險倍數 ${yearTen.multiple == null ? "—" : yearTen.multiple.toFixed(2)}`;
    document.querySelector("#summary").hidden = false;
    document.querySelector("#summaryTag").textContent = item.kind === "dividend" ? "〔分紅〕" : "〔利變〕";
    document.querySelector("#rows").innerHTML = result.rows.map((row) => `<tr><td>${row.year}</td><td>${money(row.premium, item.currency)}</td><td>${money(row.cumulativePremium, item.currency)}</td><td>${money(row.cashValue, item.currency)}</td><td>${money(row.deathBenefit, item.currency)}</td><td>${row.multiple == null ? "—" : row.multiple.toFixed(2)}</td></tr>`).join("");
    document.querySelector("#tableWrap").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
