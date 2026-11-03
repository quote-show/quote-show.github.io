import { preferredSavingsMode, quoteProduct, quoteRpu, quoteWithdraw, savingsModes } from "./calc.js";
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
  fillTerms().then(() => runQuote());
});
await fillTerms();

let quoting = false;
async function runQuote() {
  if (quoting) return;
  quoting = true;
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const item = await product();
    const scenario = document.querySelector("#scenario").value === "low" ? 1 : document.querySelector("#scenario").value === "mid" ? 2 : Number(document.querySelector("#scenario").value || 2);
    const input = {
      age: Number(document.querySelector("#age").value),
      sex: Number(document.querySelector("#sex").value),
      term: Number(document.querySelector("#term").value),
      sum: Number(document.querySelector("#sum").value),
      scenario,
      declaredRate: Number(document.querySelector("#declared").value),
      mode: item.calc === "fbo"
        ? document.querySelector("#payMode").value
        : preferredSavingsMode(item, savingsModes(item, `${document.querySelector("#term").value}|${document.querySelector("#sex").value}|${document.querySelector("#age").value}`)),
    };
    const result = quoteProduct(item, input);
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
    renderRpu(item, input, result);
    renderDraw(item, result, input);
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
    document.querySelector("#rpuBox").hidden = true;
    document.querySelector("#drawBox").hidden = true;
  } finally {
    quoting = false;
  }
}

function renderRpu(item, input, result) {
  const box = document.querySelector("#rpuBox");
  const pack = item.rpu?.keys?.[`${input.term}|${input.sex}|${input.age}`];
  const years = pack?.PA?.map((value, index) => value > 0 ? index + 1 : 0).filter(Boolean) || [];
  if (!years.length) { box.hidden = true; return; }
  const select = document.querySelector("#rpuYear");
  const previous = select.value;
  select.innerHTML = years.map((year) => `<option value="${year}">第 ${year} 年末</option>`).join("");
  if (years.map(String).includes(previous)) select.value = previous;
  box.hidden = false;
  const reduced = quoteRpu(item, { ...input, rpuYear: Number(select.value) });
  const face = money(input.sum * 10000, item.currency);
  const lines = [`<p>減額繳清保額 ${money(reduced.reducedSum, item.currency)}，原保額 ${face}</p>`];
  if (reduced.sumOnly) {
    lines.push("<p>這一年只列減額後保額。辦理後各年的解約金與身故，建議書沒有另給因子。</p>");
  } else {
    const shown = reduced.rows.filter((row) => row.t <= reduced.year + 8 || row.t % 5 === 0 || row.t === reduced.rows.length);
    lines.push(`<div class="scroll"><table><thead><tr><th>年度</th><th>繼續繳解約</th><th>減額解約</th><th>繼續繳身故</th><th>減額身故</th></tr></thead><tbody>${shown.map((row) => {
      const base = result.rows[row.t - 1];
      return `<tr><td>${row.t}</td><td>${money(base.X, item.currency)}</td><td>${money(row.X, item.currency)}</td><td>${money(base.W, item.currency)}</td><td>${money(row.W, item.currency)}</td></tr>`;
    }).join("")}</tbody></table></div>`);
  }
  document.querySelector("#rpuOut").innerHTML = lines.join("");
}

function renderDraw(item, result, input) {
  const box = document.querySelector("#drawBox");
  box.hidden = !item.withdrawal;
  if (!item.withdrawal) return;
  const from = Number(document.querySelector("#drawFrom").value);
  const to = Number(document.querySelector("#drawTo").value);
  const amount = Number(document.querySelector("#drawAmt").value);
  const planned = {};
  for (const row of result.rows) {
    if (row.age >= from && row.age <= to && row.t > Number(input.term)) planned[row.t] = amount;
  }
  const drawn = quoteWithdraw(result.rows, planned);
  const shown = drawn.rows.filter((row) => row.w || row.t <= 5 || row.t % 5 === 0);
  document.querySelector("#drawOut").innerHTML = `<p>累計提領 ${money(drawn.rows.at(-1).cw, item.currency)}${drawn.shortfall ? `，第 ${drawn.shortfall} 年超過解約金` : ""}</p><div class="scroll"><table><thead><tr><th>年度</th><th>提領</th><th>提領後解約</th><th>提領後身故</th></tr></thead><tbody>${shown.map((row) => `<tr><td>${row.t}</td><td>${money(row.w, item.currency)}</td><td>${money(row.X, item.currency)}</td><td>${money(row.W, item.currency)}</td></tr>`).join("")}</tbody></table></div>`;
}

document.querySelector("#calc").addEventListener("click", runQuote);
for (const id of ["age", "sex", "term", "sum", "scenario", "declared", "payMode", "rpuYear", "drawFrom", "drawTo", "drawAmt"]) {
  const node = document.querySelector(`#${id}`);
  if (!node) continue;
  node.addEventListener("input", runQuote);
  node.addEventListener("change", runQuote);
}
runQuote();
