import { fillVersion, loadJson, watchTables } from "./ui.js";
import {
  mortgageQuote,
  pfkAmountFromPremium,
  pfkCell,
  pfkPremiumFromAmount,
  pfkSchedule,
  portfolioPayout,
} from "./real-estate.js";

const catalog = await loadJson("/data/products.json");
fillVersion(catalog);

const fundFile = await loadJson("/data/real-estate/funds.json");
const pfkFile = await loadJson("/data/real-estate/pfk.json");
const funds = fundFile.funds;
const rates = fundFile.rates;
const meta = pfkFile.meta;
const grid = pfkFile.grid;

const $ = (id) => document.querySelector(id);
const num = (id) => Number($(id).value);
const whole = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString("zh-Hant") : "—");
const signed = (value) => `<td class="${value < 0 ? "up" : "down"}">${whole(value)}</td>`;
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

let rows = [
  { code: "NGB2", percent: 50 },
  { code: "ACB22", percent: 30 },
  { code: "JFP11", percent: 20 },
];
let portfolioMonthly = null;

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
  const usePortfolio = $("#usePortfolio").checked && portfolioMonthly != null;
  const quote = readMortgage(usePortfolio ? portfolioMonthly : null);
  const error = $("#loanError");
  if (quote.error) {
    error.hidden = false;
    error.textContent = quote.error;
    $("#loanTable").innerHTML = "";
    return;
  }
  error.hidden = true;
  const noGrace = quote.graceYears === 0;
  const year = Math.max(0, Math.round(quote.monthsPaid / 12));
  $("#loanTable").innerHTML = `<tr><th>項目</th><th>金額（元）</th></tr>
    <tr><td>寬限期內月付（只付息）</td><td>${noGrace ? "無寬限期" : whole(quote.interestOnly)}</td></tr>
    <tr><td>${noGrace ? "每月本利攤還" : "寬限期後月本利攤還"}</td><td>${whole(quote.payment)}</td></tr>
    <tr><td>每月配息（非保證）</td><td>${whole(quote.dividend)}</td></tr>
    <tr><td>寬限期內缺口</td>${noGrace ? "<td>—</td>" : signed(quote.graceGap)}</tr>
    <tr><td>${noGrace ? "每月缺口" : "寬限期後缺口"}</td>${signed(quote.paymentGap)}</tr>
    <tr><td>第 ${year} 年末剩餘本金</td><td>${whole(quote.remaining)}</td></tr>
    <tr><td>已攤還本金</td><td>${whole(quote.repaid)}</td></tr>
    <tr><td>剩餘本金占比</td><td>${(quote.remainingRatio * 100).toFixed(1)}%</td></tr>`;
}

function fundChoices(selected) {
  return funds.map((fund) => `<option value="${esc(fund.code)}"${fund.code === selected ? " selected" : ""}>${esc(fund.code)} ${esc(fund.shortName)}（${esc(fund.currency)}・${esc(fund.frequency || "—")}）</option>`).join("");
}

function renderFunds() {
  $("#fundRows").innerHTML = rows.map((row, index) => `<div class="fund">
      <label>基金 ${index + 1}<select data-fund="${index}"><option value="">請選擇</option>${fundChoices(row.code)}</select></label>
      <div class="split">
        <label>比例（%）<input data-weight="${index}" type="number" min="0" max="100" step="0.1" value="${row.percent}"></label>
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
    rows: rows.map((row) => ({ code: row.code, percent: row.percent })),
    funds,
    rates,
  });
  portfolioMonthly = result.monthly;
  const body = result.lines.map((line) => {
    if (!line.fund) return `<tr><td colspan="5">${esc(line.missing || "請選擇基金")}</td></tr>`;
    const label = `${esc(line.fund.code)} ${esc(line.fund.shortName)}${line.fund.periods !== 12 ? `<small>（${esc(line.fund.frequency || "非月配")}・月平均）</small>` : ""}`;
    if (line.missing) return `<tr><td>${label}</td><td colspan="4">${esc(line.missing)}</td></tr>`;
    return `<tr><td>${label}</td><td>${whole(line.allocation)}</td><td>${line.fund.nav}</td><td>${line.units.toLocaleString("zh-Hant", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>${whole(line.monthly)}</td></tr>`;
  }).join("");
  const balanced = Math.abs(result.weight - 100) < 1e-6;
  $("#fundTable").innerHTML = `<tr><th>基金</th><th>分配（台幣）</th><th>淨值</th><th>單位數</th><th>每月配息（台幣）</th></tr>${body}
    <tr class="hl"><td>每月配息合計</td><td>${whole(num("#fundAmount") * result.weight / 100)}</td><td></td><td></td><td><b>${whole(result.monthly)}</b></td></tr>
    <tr><td>組合年化配息率（含係數，非保證）</td><td colspan="4">${result.yieldPercent == null ? "—" : `${result.yieldPercent.toFixed(2)}%`}</td></tr>`;
  $("#fundWeight").textContent = `比例合計 ${(+result.weight.toFixed(2)).toLocaleString("zh-Hant")}%${balanced ? "，已滿 100%" : "，尚未等於 100%"}`;
  $("#fundWeight").className = balanced ? "down" : "up";
  $("#portfolioNote").textContent = `目前組合每月配息合計 ${whole(result.monthly)} 元（非保證）。`;
  renderMortgage();
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
  const cell = pfkCell(grid, $("#policySex").value, $("#policyPay").value, num("#policyAge"));
  const info = $("#policyInfo");
  const hit = $("#policyHit");
  if (!cell) {
    $("#policyTable").innerHTML = "";
    $("#policyChart").innerHTML = "";
    info.innerHTML = `<span class="up">此年齡或繳費年期不在這份試算範圍（2 年期約 0–78 歲、躉繳 0–80 歲）。</span>`;
    hit.textContent = "";
    return;
  }
  const mode = $("#policyMode").value;
  let amount = num("#policyAmount");
  let premium = num("#policyPremium");
  if (mode === "prem") {
    amount = pfkAmountFromPremium(cell, premium, meta);
    if (Number.isFinite(amount)) $("#policyAmount").value = String(amount);
  } else {
    premium = pfkPremiumFromAmount(cell, amount, meta);
    if (Number.isFinite(premium)) $("#policyPremium").value = String(premium);
  }
  if (!Number.isFinite(amount) || !Number.isFinite(premium) || !(num("#policyYears") > num("#policyGrace"))) {
    $("#policyTable").innerHTML = "";
    $("#policyChart").innerHTML = "";
    info.textContent = "請輸入保額或保費，以及大於寬限期的房貸年期。";
    hit.textContent = "";
    return;
  }
  const fx = num("#policyFx");
  const unit = $("#policyUnit").value;
  const schedule = pfkSchedule({
    cell,
    scenario: $("#policyScenario").value,
    amountWan: amount,
    fx,
    unit,
    premiumUsd: premium,
    payYears: num("#policyPay"),
    age: num("#policyAge"),
    loan: readLoanCompare(),
  });
  const unitName = unit === "USD" ? "美元" : "台幣";
  const limits = [
    amount > cell.mx ? `保額超過此年齡上限 ${cell.mx} 萬美元。` : "",
    amount < 2 ? "保額低於下限 2 萬美元。" : "",
  ].filter(Boolean).join("");
  info.innerHTML = `單位：${unitName}（匯率 ${fx}）。保額 ${amount} 萬美元；每期保費 ${whole(premium)} 美元，約 ${whole(premium * fx)} 台幣，繳 ${$("#policyPay").value} 期。${limits ? `<span class="up">${esc(limits)}</span>` : ""}房貸以台幣估算，選美元時剩餘房貸除以匯率。紅利與解約總額為試算。`;
  hit.textContent = schedule.crossover
    ? `第 ${schedule.crossover} 年末起，這個情境的解約總額試算大於或等於剩餘房貸。預估值，不是保證。`
    : "表列年度內，解約總額試算還沒有達到剩餘房貸。";
  $("#policyTable").innerHTML = `<tr><th>年</th><th>年齡</th><th>累計保費</th><th>解約總額</th><th>身故總額</th><th>剩餘房貸</th><th>差額</th></tr>${schedule.rows.map((row) => `<tr class="${row.year === schedule.crossover ? "hl" : ""}"><td>${row.year}</td><td>${row.age}</td><td>${whole(row.paid)}</td><td>${whole(row.cash)}</td><td>${whole(row.cover)}</td><td>${whole(row.balance)}</td><td class="${row.gap < 0 ? "up" : "down"}">${whole(row.gap)}</td></tr>`).join("")}`;
  $("#policyChart").innerHTML = chartSvg(schedule.rows, schedule.crossover, unitName);
}

function chartSvg(points, crossover, unitName) {
  const width = 640;
  const height = 260;
  const pad = { left: 54, right: 12, top: 18, bottom: 32 };
  const max = Math.max(...points.flatMap((row) => [row.cash, row.balance]), 1);
  const x = (index) => pad.left + (points.length === 1 ? 0 : index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const path = (key) => points.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((part) => {
    const value = max * part;
    const yy = y(value);
    const label = value >= 10000 ? `${Math.round(value / 10000).toLocaleString("zh-Hant")}萬` : whole(value);
    return `<text x="${pad.left - 6}" y="${yy + 4}" text-anchor="end">${label}</text><line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />`;
  }).join("");
  const hit = crossover ? points.find((row) => row.year === crossover) : null;
  const marker = hit
    ? `<line class="hit" x1="${x(hit.year - 1)}" y1="${pad.top}" x2="${x(hit.year - 1)}" y2="${height - pad.bottom}" /><text class="hit" x="${x(hit.year - 1)}" y="${pad.top + 12}">第${hit.year}年</text>`
    : "";
  const labels = [1, 10, 20, 30, points.length].filter((year, index, list) => year <= points.length && list.indexOf(year) === index)
    .map((year) => `<text x="${x(year - 1)}" y="${height - 8}" text-anchor="middle">${year}</text>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="解約總額與剩餘房貸">
    ${ticks}${marker}
    <path class="cash" d="${path("cash")}" />
    <path class="loan" d="${path("balance")}" />
    ${labels}
    <text class="legend cash" x="${pad.left}" y="14">解約總額</text>
    <text class="legend loan" x="${pad.left + 78}" y="14">剩餘房貸</text>
    <text class="legend" x="${width - pad.right}" y="14" text-anchor="end">${esc(unitName)}</text>
  </svg>`;
}

function renderManual() {
  const pairs = [
    [15, num("#cash15"), num("#loan15")],
    [16, num("#cash16"), num("#loan16")],
  ];
  $("#manualTable").innerHTML = `<tr><th>時點</th><th>保價金</th><th>剩餘房貸</th><th>差額</th><th>狀態</th></tr>${pairs.map(([year, cash, loan]) => {
    const gap = cash - loan;
    const ok = Number.isFinite(cash) && Number.isFinite(loan) && cash >= loan;
    return `<tr class="${ok ? "hl" : ""}"><td>第 ${year} 年末</td><td>${whole(cash)}</td><td>${whole(loan)}</td>${signed(gap)}<td>${ok ? "保價金試算已達剩餘房貸" : "保價金試算尚未達到"}</td></tr>`;
  }).join("")}`;
}

function applyPreset(preset) {
  for (const [id, value] of Object.entries(preset)) $(id).value = value;
  renderPolicy();
}

$("#policyPresetTalk").addEventListener("click", () => applyPreset({
  "#policyAge": "60",
  "#policySex": "F",
  "#policyPay": "2",
  "#policyMode": "prem",
  "#policyFx": "32",
  "#policyPremium": String(Math.round(2063949 / 32)),
  "#policyLoan": "1000",
  "#policyRate": "2.6",
  "#policyYears": "30",
  "#policyGrace": "0",
  "#policyScenario": "M",
  "#policyUnit": "TWD",
}));
$("#policyPresetSheet").addEventListener("click", () => applyPreset({
  "#policyAge": "28",
  "#policySex": "M",
  "#policyPay": "1",
  "#policyMode": "amt",
  "#policyAmount": "28.9",
  "#policyLoan": "800",
  "#policyRate": "2.6",
  "#policyYears": "30",
  "#policyGrace": "3",
  "#policyScenario": "M",
  "#policyUnit": "TWD",
  "#policyFx": "32",
}));

$("#fundRows").addEventListener("change", (event) => {
  const select = event.target.closest("[data-fund]");
  if (!select) return;
  rows[Number(select.dataset.fund)].code = select.value;
  renderPortfolio();
});
$("#fundRows").addEventListener("input", (event) => {
  const field = event.target.closest("[data-weight]");
  if (!field) return;
  rows[Number(field.dataset.weight)].percent = Number(field.value) || 0;
  renderPortfolio();
});
$("#fundRows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  rows.splice(Number(button.dataset.remove), 1);
  if (!rows.length) rows = [{ code: "", percent: 100 }];
  renderFunds();
});
$("#fundAdd").addEventListener("click", () => {
  if (rows.length >= 10) return;
  rows.push({ code: "", percent: 0 });
  renderFunds();
});
$("#fundEven").addEventListener("click", () => {
  const count = rows.length;
  const base = Math.floor(1000 / count) / 10;
  rows.forEach((row, index) => {
    row.percent = index === count - 1 ? +(100 - base * (count - 1)).toFixed(1) : base;
  });
  renderFunds();
});

for (const id of ["#loanPrincipal", "#loanRate", "#loanYears", "#loanGrace", "#investWan", "#dividendRate", "#monthsPaid"]) {
  $(id).addEventListener("input", renderMortgage);
}
$("#usePortfolio").addEventListener("change", renderMortgage);
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

$("#usdRate").value = String(fundFile.fxUsdDefault || 32);
$("#policyFx").value = String(fundFile.fxUsdDefault || 32);
$("#fundFee").value = String(fundFile.feeDefault || 0.95);
$("#fundSource").textContent = `${fundFile.source} 可選 ${funds.length} 檔。匯率掛牌 ${fundFile.rateListedAt || "—"}。`;
$("#policySource").textContent = `${meta.note} 重算日期 ${meta.computed}。`;

renderFunds();
renderManual();
applyPreset({
  "#policyAge": "60",
  "#policySex": "F",
  "#policyPay": "2",
  "#policyMode": "prem",
  "#policyPremium": String(Math.round(2063949 / 32)),
  "#policyLoan": "1000",
  "#policyRate": "2.6",
  "#policyYears": "30",
  "#policyGrace": "0",
});
watchTables();
