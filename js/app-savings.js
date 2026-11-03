import { preferredSavingsMode, quoteProduct, savingsModes } from "./calc.js";
import { fillVersion, loadJson, money, percent } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const params = new URLSearchParams(location.search);
const initial = params.get("code") && savings.some((item) => item.code === params.get("code")) ? params.get("code") : savings[0].code;
const select = document.querySelector("#product");
select.innerHTML = savings.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
select.value = initial;
const cache = new Map();

async function product() {
  const code = select.value;
  if (!cache.has(code)) cache.set(code, loadJson(`data/savings/${code}.json`));
  return cache.get(code);
}

async function fillTerms() {
  const item = await product();
  document.querySelector("#term").innerHTML = Object.keys(item.issueAges).map((term) => `<option>${term}</option>`).join("");
  document.querySelector("#codeTag").textContent = `〔${item.code}〕`;
  document.querySelector("#pageTitle").textContent = item.name;
  document.querySelector("#demo").hidden = item.status !== "demo";
  const source = item.sources?.[0];
  document.querySelector("#sourceNote").textContent = source ? `${source.note || source.version || ""} · ${source.fetched}` : "";
  document.querySelector("#scenarioBox").hidden = item.kind !== "dividend";
  document.querySelector("#declaredBox").hidden = !item.isr;
  const declaredLabel = document.querySelector("#declaredLabel");
  declaredLabel.textContent = item.declLabel
    ? `假設宣告利率（檔案 ${item.declLabel} 為 ${item.declDefault}）`
    : "宣告利率（小數，例如 0.03）";
  if (item.declDefault != null) document.querySelector("#declared").value = String(item.declDefault);
  document.querySelector("#sumLabel").textContent = item.sumLabel || "保額";
  const modeBox = document.querySelector("#modeBox");
  const payMode = document.querySelector("#payMode");
  if (item.calc === "fbo") {
    const names = { PS: "儲存生息", PUA: "購買增額繳清" };
    payMode.innerHTML = (item.modes || ["PS"]).map((mode) => `<option value="${mode}">${names[mode] || mode}</option>`).join("");
    payMode.value = item.defaultMode || "PS";
    modeBox.hidden = false;
  } else {
    modeBox.hidden = true;
  }
  if (item.calc === "annuity") {
    document.querySelector("label[for=term]").textContent = "繳費";
    document.querySelector("#term").innerHTML = `<option value="1">躉繳</option>`;
  } else {
    document.querySelector("label[for=term]").textContent = "年期";
  }
  const sample = item.verificationSamples?.[0];
  if (sample) {
    document.querySelector("#age").value = sample.age;
    document.querySelector("#sex").value = String(sample.sex);
    document.querySelector("#term").value = String(sample.term);
    document.querySelector("#sum").value = sample.sum;
    if (sample.scenario) document.querySelector("#scenario").value = Number(sample.scenario) === 1 ? "low" : "mid";
  }
  const sum = document.querySelector("#sum");
  sum.min = item.sumInsured.min;
  sum.max = item.sumInsured.max;
  sum.step = item.sumInsured.step || 1;
}

select.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("code", select.value);
  history.replaceState(null, "", url);
  fillTerms();
});
await fillTerms();

document.querySelector("#calc").addEventListener("click", async () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const item = await product();
    const scenario = document.querySelector("#scenario").value === "low" ? 1 : document.querySelector("#scenario").value === "mid" ? 2 : Number(document.querySelector("#scenario").value || 2);
    const result = quoteProduct(item, {
      age: Number(document.querySelector("#age").value),
      sex: Number(document.querySelector("#sex").value),
      term: Number(document.querySelector("#term").value),
      sum: Number(document.querySelector("#sum").value),
      scenario,
      declaredRate: Number(document.querySelector("#declared").value),
      mode: item.calc === "fbo"
        ? document.querySelector("#payMode").value
        : preferredSavingsMode(item, savingsModes(item, `${document.querySelector("#term").value}|${document.querySelector("#sex").value}|${document.querySelector("#age").value}`)),
    });
    const yearTen = result.rows[Math.min(9, result.rows.length - 1)];
    if (item.calc === "annuity") {
      document.querySelector("#headline").innerHTML = `躉繳 ${money(result.payable, item.currency)} · 首月年金 ${money(result.firstPayment, item.currency)} · 第 ${yearTen.t} 年累計年金 ${money(yearTen.X, item.currency)} · 含領回內部報酬率 ${percent(result.irr10)}`;
      document.querySelector("#tableHead").innerHTML = "<tr><th>年度</th><th>保費</th><th>累計</th><th>當年年金</th><th>累計年金</th></tr>";
      document.querySelector("#rows").innerHTML = result.rows.map((row) => `<tr><td>${row.t}</td><td>${money(row.py, item.currency)}</td><td>${money(row.cum, item.currency)}</td><td>${money(row.surv, item.currency)}</td><td>${money(row.X, item.currency)}</td></tr>`).join("");
    } else {
      document.querySelector("#headline").innerHTML = `首期實繳 ${money(result.payable, item.currency)} · 第 ${yearTen.t} 年解約 ${money(yearTen.X, item.currency)} · 含領回內部報酬率 ${percent(result.irr10)} · 領回超過保費 ${result.paybackYear ?? "—"}`;
      document.querySelector("#tableHead").innerHTML = "<tr><th>年度</th><th>保費</th><th>累計</th><th>解約金</th><th>身故</th><th>倍數</th></tr>";
      document.querySelector("#rows").innerHTML = result.rows.map((row) => `<tr><td>${row.t}</td><td>${money(row.py, item.currency)}</td><td>${money(row.cum, item.currency)}</td><td>${money(row.X, item.currency)}</td><td>${money(row.W, item.currency)}</td><td>${row.cum ? (row.W / row.cum).toFixed(2) : "—"}</td></tr>`).join("");
    }
    document.querySelector("#summary").hidden = false;
    document.querySelector("#summaryTag").textContent = item.calc === "annuity" ? "〔即期年金〕" : item.kind === "dividend" ? "〔分紅〕" : item.isr ? "〔利變〕" : "〔固定〕";
    document.querySelector("#tableWrap").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
