import { fillVersion, loadJson, watchTables } from "./ui.js";
import {
  mortgageQuote,
  pfkAmountFromPremium,
  pfkCell,
  pfkPremiumFromAmount,
  pfkSchedule,
  portfolioPayout,
} from "./real-estate.js";

const STORE = "quote-show-estate";
const $ = (id) => document.querySelector(id);
const num = (id) => {
  const text = String($(id).value).replace(/,/g, "").trim();
  if (text === "") return NaN;
  return Number(text);
};
const whole = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString("zh-Hant") : "—");
const signed = (value) => `<td class="${Number.isFinite(value) ? (value < 0 ? "up" : "down") : ""}">${whole(value)}</td>`;
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

function showError(id, message) {
  const node = $(id);
  node.hidden = !message;
  node.textContent = message || "";
}

function grouped(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) : value;
  return rounded.toLocaleString("zh-Hant", { maximumFractionDigits: 4 });
}

function paintGrouped(id, value) {
  const node = $(id);
  if (document.activeElement === node) return;
  node.value = grouped(value);
}

let fundFile = { funds: [], rates: [], source: "", fxUsdDefault: 32, feeDefault: 0.95, rateListedAt: "" };
let pfkFile = { meta: { note: "", computed: "", discount_threshold_wan: 20, discount: 0.01 }, grid: {} };
let fundsReady = false;
let policyReady = false;
try {
  const catalog = await loadJson("/data/products.json");
  fillVersion(catalog);
} catch {
  /* 版號讀不到時，頁面其餘試算仍可用。 */
}
try {
  fundFile = await loadJson("/data/real-estate/funds.json");
  fundsReady = Array.isArray(fundFile.funds) && fundFile.funds.length > 0;
} catch {
  fundsReady = false;
}
try {
  pfkFile = await loadJson("/data/real-estate/pfk.json");
  policyReady = pfkFile.grid && Object.keys(pfkFile.grid).length > 0;
} catch {
  policyReady = false;
}

const funds = fundFile.funds || [];
const rates = fundFile.rates || [];
const fundByCode = new Map(funds.map((fund) => [fund.code, fund]));
const meta = pfkFile.meta;
const grid = pfkFile.grid || {};
const boot = [];
if (!fundsReady) boot.push("基金淨值與配息載入失敗。組合試算暫停，房貸仍可用配息率計算。請重新整理。");
if (!policyReady) boot.push("PFK 逐年資料載入失敗。請重新整理後再看解約總額。");
showError("#bootError", boot.join(""));

const defaultRows = () => [
  { code: "NGB2", percent: 50 },
  { code: "ACB22", percent: 30 },
  { code: "JFP11", percent: 20 },
];
let rows = defaultRows();
let portfolioMonthly = null;
let portfolioNote = "";
let hydrating = false;

function labelOf(code) {
  const fund = fundByCode.get(code);
  return fund ? `${fund.code} ${fund.shortName}` : "";
}

function matches(query) {
  const text = query.trim().toLowerCase();
  const pool = text
    ? funds.filter((fund) => `${fund.code} ${fund.shortName} ${fund.name || ""}`.toLowerCase().includes(text))
    : funds;
  return pool.slice(0, 12);
}

function readMortgage(monthlyDividend) {
  return mortgageQuote({
    principalWan: num("#loanPrincipal"),
    annualPercent: num("#loanRate"),
    years: num("#loanYears"),
    graceYears: num("#loanGrace"),
    investWan: num("#investWan"),
    dividendPercent: num("#dividendRate"),
    monthsPaid: num("#monthsPaid"),
    monthlyDividend,
  });
}

function renderMortgage() {
  const usePortfolio = $("#usePortfolio").checked && fundsReady;
  const quote = readMortgage(usePortfolio ? portfolioMonthly : null);
  if (quote.error) {
    showError("#loanError", quote.error);
    $("#loanNote").textContent = "";
    $("#loanKpis").innerHTML = "";
    $("#loanTable").innerHTML = "";
    return;
  }
  showError("#loanError", "");
  const notes = [...(quote.notes || [])];
  if (usePortfolio && portfolioNote) notes.push(portfolioNote);
  $("#loanNote").textContent = notes.join("。");
  const noGrace = quote.graceYears === 0;
  const year = Math.max(0, Math.round(quote.monthsPaid / 12));
  $("#loanKpis").innerHTML = `<div><span>${noGrace ? "每月本利攤還" : "寬限後月付"}</span><b>${whole(quote.payment)}</b></div>
    <div><span>每月配息（非保證）</span><b>${whole(quote.dividend)}</b></div>
    <div><span>${noGrace ? "每月缺口" : "寬限後缺口"}</span><b class="${quote.paymentGap < 0 ? "up" : "down"}">${whole(quote.paymentGap)}</b></div>`;
  $("#loanTable").innerHTML = `<tr><th>項目</th><th>金額（元）</th></tr>
    <tr><td>寬限期內月付（只付息）</td><td>${noGrace ? "無寬限期" : whole(quote.interestOnly)}</td></tr>
    <tr><td>${noGrace ? "每月本利攤還" : "寬限期後月本利攤還"}</td><td class="money">${whole(quote.payment)}</td></tr>
    <tr><td>每月配息（非保證）</td><td class="money">${whole(quote.dividend)}</td></tr>
    <tr><td>寬限期內缺口</td>${noGrace ? "<td>—</td>" : signed(quote.graceGap)}</tr>
    <tr><td>${noGrace ? "每月缺口" : "寬限期後缺口"}</td>${signed(quote.paymentGap)}</tr>
    <tr><td>第 ${year} 年末剩餘本金</td><td class="money">${whole(quote.remaining)}</td></tr>
    <tr><td>已攤還本金</td><td>${whole(quote.repaid)}</td></tr>
    <tr><td>剩餘本金占比</td><td>${(quote.remainingRatio * 100).toFixed(1)}%</td></tr>`;
}

function showMatches(index, query) {
  const host = document.querySelector(`[data-matches="${index}"]`);
  if (!host) return;
  const found = matches(query);
  host.hidden = false;
  host.innerHTML = found.length
    ? found.map((fund) => `<button type="button" data-pick="${esc(fund.code)}" data-row="${index}">${esc(fund.code)} ${esc(fund.shortName)}<small>${esc(fund.currency)}・${esc(fund.frequency || "—")}・淨值 ${fund.nav}</small></button>`).join("")
    : `<p class="demo">沒有符合的基金。</p>`;
}

function renderFunds() {
  if (!rows.length) {
    $("#fundRows").innerHTML = `<p class="demo">目前沒有基金。請按「新增基金」。</p>`;
    renderPortfolio();
    return;
  }
  $("#fundRows").innerHTML = rows.map((row, index) => `<div class="fund">
      <div class="finder">
        <label>基金 ${index + 1}<input data-search="${index}" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="輸入代碼或名稱" value="${esc(labelOf(row.code))}"></label>
        <div class="matches" data-matches="${index}" hidden></div>
      </div>
      <div class="split">
        <label>比例（%）<input data-weight="${index}" type="text" inputmode="decimal" value="${row.percent}"></label>
        <button type="button" class="ghost" data-remove="${index}">刪除</button>
      </div>
    </div>`).join("");
  $("#fundAdd").disabled = rows.length >= 10;
  renderPortfolio();
}

function renderPortfolio() {
  const result = portfolioPayout({
    amountTwd: num("#fundAmount"),
    usdRate: num("#usdRate"),
    fee: num("#fundFee"),
    rows,
    funds: fundByCode,
    rates,
  });
  if (result.error) {
    portfolioMonthly = null;
    portfolioNote = "";
    showError("#fundError", result.error);
    $("#fundTable").innerHTML = "";
    $("#fundWeight").textContent = "";
    $("#portfolioNote").textContent = "";
    renderMortgage();
    remember();
    return;
  }
  showError("#fundError", "");
  portfolioMonthly = result.monthly;
  portfolioNote = result.notes.join("。");
  const body = result.lines.map((line) => {
    if (!line.fund) return `<tr><td colspan="5">${esc(line.missing || "請選擇基金")}</td></tr>`;
    const label = `${esc(line.fund.code)} ${esc(line.fund.shortName)}${line.fund.periods !== 12 ? `<small>（${esc(line.fund.frequency || "非月配")}・月平均）</small>` : ""}`;
    if (line.missing) return `<tr><td>${label}</td><td colspan="4">${esc(line.missing)}</td></tr>`;
    return `<tr><td>${label}</td><td>${whole(line.allocation)}</td><td>${line.fund.nav}</td><td>${line.units.toLocaleString("zh-Hant", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td class="money">${whole(line.monthly)}</td></tr>`;
  }).join("");
  const balanced = Math.abs(result.weight - 100) < 1e-6;
  $("#fundTable").innerHTML = `<tr><th>基金</th><th>分配（台幣）</th><th>淨值</th><th>單位數</th><th>每月配息（台幣）</th></tr>${body}
    <tr class="hl"><td>每月配息合計</td><td>${whole(num("#fundAmount") * result.weight / 100)}</td><td></td><td></td><td class="money"><b>${whole(result.monthly)}</b></td></tr>
    <tr><td>組合年化配息率（含係數，非保證）</td><td colspan="4">${result.yieldPercent == null || !Number.isFinite(result.yieldPercent) ? "—" : `${result.yieldPercent.toFixed(2)}%`}</td></tr>`;
  $("#fundWeight").textContent = balanced ? "比例合計 100%" : `比例合計 ${(+result.weight.toFixed(2)).toLocaleString("zh-Hant")}%，尚未等於 100%`;
  $("#fundWeight").className = balanced ? "down" : "up";
  $("#portfolioNote").textContent = `目前組合每月配息合計 ${whole(result.monthly)} 元（非保證）。${portfolioNote}`;
  renderMortgage();
  remember();
}

function readLoanCompare() {
  return {
    principal: num("#policyLoan") * 10000,
    annualPercent: num("#policyRate"),
    years: num("#policyYears"),
    graceYears: num("#policyGrace"),
  };
}

function renderPolicy() {
  const info = $("#policyInfo");
  const hit = $("#policyHit");
  if (!policyReady) {
    $("#policyTable").innerHTML = "";
    $("#policyChart").innerHTML = "";
    info.textContent = "PFK 逐年資料還沒載入，無法換算。";
    hit.hidden = true;
    return;
  }
  const cell = pfkCell(grid, $("#policySex").value, $("#policyPay").value, num("#policyAge"));
  if (!cell) {
    $("#policyTable").innerHTML = "";
    $("#policyChart").innerHTML = "";
    info.innerHTML = `<span class="up">此年齡或繳費年期不在這份試算範圍（2 年期約 0–78 歲、躉繳 0–80 歲）。</span>`;
    hit.hidden = true;
    return;
  }
  const mode = $("#policyMode").value;
  let amount = num("#policyAmount");
  let premium = num("#policyPremium");
  if (mode === "prem") {
    if (Number.isFinite(premium) && premium >= 0) {
      amount = pfkAmountFromPremium(cell, premium, meta);
      if (Number.isFinite(amount) && document.activeElement !== $("#policyAmount")) $("#policyAmount").value = String(amount);
    }
  } else if (Number.isFinite(amount) && amount > 0) {
    premium = pfkPremiumFromAmount(cell, amount, meta);
    paintGrouped("#policyPremium", premium);
  }
  const schedule = pfkSchedule({
    cell,
    scenario: $("#policyScenario").value,
    amountWan: amount,
    fx: num("#policyFx"),
    unit: $("#policyUnit").value,
    premiumUsd: premium,
    payYears: num("#policyPay"),
    age: num("#policyAge"),
    loan: readLoanCompare(),
  });
  if (schedule.error) {
    $("#policyTable").innerHTML = "";
    $("#policyChart").innerHTML = "";
    info.textContent = schedule.error;
    hit.hidden = true;
    remember();
    return;
  }
  const fx = num("#policyFx");
  const unitName = $("#policyUnit").value === "USD" ? "美元" : "台幣";
  const limits = [
    amount > cell.mx ? `保額超過此年齡上限 ${cell.mx} 萬美元。` : "",
    amount < 2 ? "保額低於下限 2 萬美元。" : "",
  ].filter(Boolean).join("");
  info.innerHTML = `單位：${unitName}（匯率 ${fx}）。保額 ${amount} 萬美元；每期保費 ${whole(premium)} 美元，約 ${whole(premium * fx)} 台幣，繳 ${$("#policyPay").value} 期。${limits ? `<span class="up">${esc(limits)}</span>` : ""}房貸以台幣估算，選美元時剩餘房貸除以匯率。紅利與解約總額為試算，不是保證。`;
  hit.hidden = false;
  hit.textContent = schedule.crossover
    ? `第 ${schedule.crossover} 年末起，這個情境的解約總額試算大於或等於剩餘房貸。預估值，不是保證。`
    : "表列年度內，解約總額試算還沒有達到剩餘房貸。";
  $("#policyTable").innerHTML = `<tr><th>年</th><th>年齡</th><th>累計保費</th><th>解約總額</th><th>身故總額</th><th>剩餘房貸</th><th>差額</th></tr>${schedule.rows.map((row) => `<tr class="${row.year === schedule.crossover ? "hl" : ""}"><td>${row.year}</td><td>${row.age}</td><td>${whole(row.paid)}</td><td class="money">${whole(row.cash)}</td><td>${whole(row.cover)}</td><td class="money">${whole(row.balance)}</td><td class="${row.gap < 0 ? "up" : "down"}">${whole(row.gap)}</td></tr>`).join("")}`;
  $("#policyChart").innerHTML = chartSvg(schedule.rows, schedule.crossover, unitName);
  remember();
}

function chartSvg(points, crossover, unitName) {
  const finitePoints = points.filter((row) => [row.cash, row.balance].every(Number.isFinite));
  if (finitePoints.length < 2) return "";
  const width = 640;
  const height = 260;
  const pad = { left: 54, right: 12, top: 18, bottom: 32 };
  const max = Math.max(...finitePoints.flatMap((row) => [row.cash, row.balance]), 1);
  const x = (index) => pad.left + index / (finitePoints.length - 1) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const path = (key) => finitePoints.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((part) => {
    const value = max * part;
    const yy = y(value);
    const label = value >= 10000 ? `${Math.round(value / 10000).toLocaleString("zh-Hant")}萬` : whole(value);
    return `<text x="${pad.left - 6}" y="${yy + 4}" text-anchor="end">${label}</text><line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />`;
  }).join("");
  const hit = crossover ? finitePoints.find((row) => row.year === crossover) : null;
  const marker = hit
    ? `<line class="hit" x1="${x(hit.year - 1)}" y1="${pad.top}" x2="${x(hit.year - 1)}" y2="${height - pad.bottom}" /><text class="hit" x="${Math.min(x(hit.year - 1), width - 70)}" y="${pad.top + 12}">第${hit.year}年</text>`
    : "";
  const labels = [1, 10, 20, 30, finitePoints.length].filter((year, index, list) => year <= finitePoints.length && list.indexOf(year) === index)
    .map((year) => `<text x="${x(year - 1)}" y="${height - 8}" text-anchor="middle">${year}</text>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="解約總額與剩餘房貸">
    ${ticks}${marker}
    <path class="cash" d="${path("cash")}" />
    <path class="loan" d="${path("balance")}" />
    ${labels}
    <text class="legend" x="${pad.left}" y="14">解約總額</text>
    <text class="legend" x="${pad.left + 72}" y="14">剩餘房貸</text>
    <text class="legend" x="${width - pad.right}" y="14" text-anchor="end">${esc(unitName)}</text>
  </svg>`;
}

function renderManual() {
  const pairs = [
    [15, num("#cash15"), num("#loan15")],
    [16, num("#cash16"), num("#loan16")],
  ];
  $("#manualTable").innerHTML = `<tr><th>時點</th><th>保價金</th><th>剩餘房貸</th><th>差額</th><th>狀態</th></tr>${pairs.map(([year, cash, loan]) => {
    if (![cash, loan].every(Number.isFinite)) {
      return `<tr><td>第 ${year} 年末</td><td colspan="4">請輸入 0 以上的金額</td></tr>`;
    }
    if (cash < 0 || loan < 0) {
      return `<tr><td>第 ${year} 年末</td><td colspan="4">金額不可為負</td></tr>`;
    }
    const gap = cash - loan;
    const ok = cash >= loan;
    return `<tr class="${ok ? "hl" : ""}"><td>第 ${year} 年末</td><td class="money">${whole(cash)}</td><td class="money">${whole(loan)}</td>${signed(gap)}<td>${ok ? "保價金試算已達剩餘房貸" : "保價金試算尚未達到"}</td></tr>`;
  }).join("")}`;
  remember();
}

function fieldBag(ids) {
  return Object.fromEntries(ids.map((id) => [id, $(id).value]));
}

function remember() {
  if (hydrating) return;
  try {
    localStorage.setItem(STORE, JSON.stringify({
      rows,
      usePortfolio: $("#usePortfolio").checked,
      fields: fieldBag(["#loanPrincipal", "#loanRate", "#loanYears", "#loanGrace", "#investWan", "#dividendRate", "#monthsPaid", "#fundAmount", "#usdRate", "#fundFee", "#policyAge", "#policySex", "#policyPay", "#policyMode", "#policyAmount", "#policyPremium", "#policyScenario", "#policyFx", "#policyUnit", "#policyLoan", "#policyRate", "#policyYears", "#policyGrace", "#cash15", "#cash16", "#loan15", "#loan16"]),
    }));
  } catch {
    /* 瀏覽器不讓寫入時，這次輸入只留在畫面上。 */
  }
}

function applyFields(fields) {
  for (const [id, value] of Object.entries(fields || {})) {
    if ($(id)) $(id).value = value;
  }
}

const talkPreset = {
  "#policyAge": "60",
  "#policySex": "F",
  "#policyPay": "2",
  "#policyMode": "prem",
  "#policyFx": "32",
  "#policyPremium": grouped(Math.round(2063949 / 32)),
  "#policyLoan": grouped(1000),
  "#policyRate": "2.6",
  "#policyYears": "30",
  "#policyGrace": "0",
  "#policyScenario": "M",
  "#policyUnit": "TWD",
};

function applyPreset(preset) {
  applyFields(preset);
  renderPolicy();
}

function resetAll() {
  hydrating = true;
  try { localStorage.removeItem(STORE); } catch { /* 清不掉也不影響畫面重設。 */ }
  applyFields({
    "#loanPrincipal": "800",
    "#loanRate": "2.6",
    "#loanYears": "30",
    "#loanGrace": "3",
    "#investWan": "300",
    "#dividendRate": "10.68",
    "#monthsPaid": "180",
    "#fundAmount": grouped(6000000),
    "#usdRate": String(fundFile.fxUsdDefault || 32),
    "#fundFee": String(fundFile.feeDefault || 0.95),
    "#cash15": grouped(5762435),
    "#cash16": grouped(5960959),
    "#loan15": grouped(5961811),
    "#loan16": grouped(5632505),
    ...talkPreset,
  });
  $("#usePortfolio").checked = false;
  rows = defaultRows();
  hydrating = false;
  renderFunds();
  renderManual();
  renderPolicy();
}

$("#policyPresetTalk").addEventListener("click", () => applyPreset(talkPreset));
$("#policyPresetSheet").addEventListener("click", () => applyPreset({
  "#policyAge": "28",
  "#policySex": "M",
  "#policyPay": "1",
  "#policyMode": "amt",
  "#policyAmount": "28.9",
  "#policyLoan": grouped(800),
  "#policyRate": "2.6",
  "#policyYears": "30",
  "#policyGrace": "3",
  "#policyScenario": "M",
  "#policyUnit": "TWD",
  "#policyFx": "32",
}));
$("#resetAll").addEventListener("click", resetAll);

$("#fundRows").addEventListener("input", (event) => {
  const search = event.target.closest("[data-search]");
  if (search) {
    showMatches(Number(search.dataset.search), search.value);
    return;
  }
  const field = event.target.closest("[data-weight]");
  if (!field) return;
  const raw = String(field.value).replace(/,/g, "").trim();
  rows[Number(field.dataset.weight)].percent = raw === "" ? NaN : Number(raw);
  renderPortfolio();
});
$("#fundRows").addEventListener("focusin", (event) => {
  const search = event.target.closest("[data-search]");
  if (!search) return;
  const index = Number(search.dataset.search);
  search.value = rows[index].code || "";
  search.select();
  showMatches(index, search.value);
});
$("#fundRows").addEventListener("focusout", (event) => {
  const search = event.target.closest("[data-search]");
  if (!search) return;
  const index = Number(search.dataset.search);
  setTimeout(() => {
    const typed = search.value.trim().toUpperCase();
    if (fundByCode.has(typed)) rows[index].code = typed;
    if (document.activeElement === search) return;
    search.value = labelOf(rows[index].code);
    const list = document.querySelector(`[data-matches="${index}"]`);
    if (list) list.hidden = true;
    renderPortfolio();
  }, 180);
});
$("#fundRows").addEventListener("click", (event) => {
  const pick = event.target.closest("[data-pick]");
  if (pick) {
    const index = Number(pick.dataset.row);
    rows[index].code = pick.dataset.pick;
    const search = document.querySelector(`[data-search="${index}"]`);
    if (search) search.value = labelOf(rows[index].code);
    pick.closest(".matches").hidden = true;
    renderPortfolio();
    return;
  }
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  rows.splice(Number(button.dataset.remove), 1);
  renderFunds();
});
$("#fundAdd").addEventListener("click", () => {
  if (rows.length >= 10) return;
  rows.push({ code: "", percent: 0 });
  renderFunds();
});
$("#fundEven").addEventListener("click", () => {
  if (!rows.length) return;
  const count = rows.length;
  const base = Math.floor(1000 / count) / 10;
  rows.forEach((row, index) => {
    row.percent = index === count - 1 ? +(100 - base * (count - 1)).toFixed(1) : base;
  });
  renderFunds();
});

for (const id of ["#loanPrincipal", "#loanRate", "#loanYears", "#loanGrace", "#investWan", "#dividendRate", "#monthsPaid"]) {
  $(id).addEventListener("input", () => { renderMortgage(); remember(); });
}
$("#usePortfolio").addEventListener("change", () => { renderMortgage(); remember(); });
for (const id of ["#fundAmount", "#usdRate", "#fundFee"]) $(id).addEventListener("input", renderPortfolio);
for (const id of ["#policyAge", "#policySex", "#policyPay", "#policyMode", "#policyScenario", "#policyUnit"]) {
  $(id).addEventListener("change", renderPolicy);
  $(id).addEventListener("input", renderPolicy);
}
$("#policyAmount").addEventListener("input", () => {
  $("#policyMode").value = "amt";
  renderPolicy();
});
$("#policyPremium").addEventListener("input", () => {
  $("#policyMode").value = "prem";
  renderPolicy();
});
for (const id of ["#policyFx", "#policyLoan", "#policyRate", "#policyYears", "#policyGrace"]) {
  $(id).addEventListener("input", renderPolicy);
}
for (const id of ["#cash15", "#cash16", "#loan15", "#loan16"]) $(id).addEventListener("input", renderManual);
for (const node of document.querySelectorAll("[data-group]")) {
  node.addEventListener("blur", () => {
    const value = Number(String(node.value).replace(/,/g, "").trim());
    if (Number.isFinite(value) && Math.abs(value) >= 1000) node.value = grouped(value);
  });
}

$("#usdRate").value = String(fundFile.fxUsdDefault || 32);
$("#policyFx").value = String(fundFile.fxUsdDefault || 32);
$("#fundFee").value = String(fundFile.feeDefault || 0.95);
$("#fundSource").textContent = fundsReady
  ? `${fundFile.source} 可選 ${funds.length} 檔，輸入代碼或名稱即可搜尋。匯率掛牌 ${fundFile.rateListedAt || "—"}。`
  : "基金資料沒有載入。";
$("#policySource").textContent = policyReady ? `${meta.note || ""} 重算日期 ${meta.computed || "—"}。` : "";

hydrating = true;
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved?.fields) {
    applyFields(saved.fields);
    if (Array.isArray(saved.rows)) rows = saved.rows.filter((row) => row && typeof row.code === "string").slice(0, 10);
    $("#usePortfolio").checked = Boolean(saved.usePortfolio);
  }
} catch {
  /* 舊的暫存壞掉時，用頁面上的預設值。 */
}
hydrating = false;
renderFunds();
renderManual();
renderPolicy();
watchTables();
