import { preferredSavingsMode, quoteProduct, quoteRpu, quoteWithdraw, savingsModes, sheetIrr } from "./calc.js";
import { fillVersion, isKeyYear, loadJson, money, percent, resolveAge, watchTables } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const picker = await loadJson("data/savings-index.json");
const kindName = { dividend: "分紅", "interest-sensitive": "利變", fixed: "固定利率" };
const currencyName = { TWD: "新臺幣", USD: "美元", AUD: "澳幣" };

function termLabel(term, payToAge) {
  if (payToAge) return `繳至 ${term} 歲`;
  return Number(term) === 1 ? "躉繳" : `${term} 年期`;
}

function matchesPicker(item) {
  const currency = document.querySelector("#qCur").value;
  const kind = document.querySelector("#qKind").value;
  const term = document.querySelector("#qTerm").value;
  const ageRaw = document.querySelector("#qAge").value;
  const query = document.querySelector("#qFind").value.trim().toLowerCase();
  const survivalOnly = document.querySelector("#qSurv").checked;
  if (currency === "other" && ["TWD", "USD", "AUD"].includes(item.currency)) return false;
  if (currency && currency !== "other" && item.currency !== currency) return false;
  if (kind === "annuity" && !item.annuity) return false;
  if (kind && kind !== "annuity" && (item.kind !== kind || item.annuity)) return false;
  if (survivalOnly && !item.survival && !item.annuity) return false;
  if (query && !`${item.code} ${item.name}`.toLowerCase().includes(query)) return false;
  const age = ageRaw === "" ? null : Number(ageRaw);
  const bands = term ? item.bands.filter((band) => String(band.term) === term) : item.bands;
  if (term && !bands.length) return false;
  if (age != null && !bands.some((band) => age >= band.min && age <= band.max)) return false;
  return true;
}

function renderQuick() {
  const terms = [...new Set(picker.flatMap((item) => item.bands.map((band) => band.term)))].sort((a, b) => a - b);
  const termSelect = document.querySelector("#qTerm");
  const current = termSelect.value;
  const labelFor = (term) => {
    const users = picker.filter((item) => item.bands.some((band) => band.term === term));
    return termLabel(term, users.length > 0 && users.every((item) => item.payToAge));
  };
  termSelect.innerHTML = `<option value="">不限</option>${terms.map((term) => `<option value="${term}">${labelFor(term)}</option>`).join("")}`;
  if (terms.map(String).includes(current)) termSelect.value = current;
  const found = picker.filter(matchesPicker);
  document.querySelector("#qCount").textContent = `${found.length} 項`;
  document.querySelector("#qList").innerHTML = found.map((item) => {
    const years = [...new Set(item.bands.map((band) => band.term))].sort((a, b) => a - b).map((term) => termLabel(term, item.payToAge)).join("、");
    const mark = item.annuity ? "年金" : item.survival ? "生存金" : "累積型";
    return `<button type="button" data-jump="${item.code}"><b>${item.code}</b> ${item.name}<small>${currencyName[item.currency] || item.currency} · ${item.annuity ? "年金" : kindName[item.kind] || item.kind} · ${years} · ${mark}</small></button>`;
  }).join("") || `<p class="tag">沒有符合的商品。</p>`;
}

function renderSurvival(item, result) {
  const box = document.querySelector("#survOut");
  const paying = result.rows.filter((row) => row.surv > 0);
  if (!paying.length) {
    box.innerHTML = `<p>這張建議書沒有逐年生存金或年金。可在上面勾「只看有生存金或年金」改選。</p><p class="tag">試算。實際給付以正式建議書及保單條款為準。</p>`;
    return;
  }
  let total = 0;
  const schedule = paying.map((row) => {
    total += row.surv;
    return { ...row, total };
  });
  const first = schedule[0];
  const period = item.monthlySurvival
    ? `每月 ${money(first.surv / 12, item.currency)}，全年 ${money(first.surv, item.currency)}`
    : item.calc === "annuity"
      ? `當年年金 ${money(first.surv, item.currency)}`
      : `當年生存金 ${money(first.surv, item.currency)}`;
  const varied = schedule.some((row) => row.surv !== first.surv);
  const keyOnly = document.querySelector("#keyYears").checked;
  const rows = schedule.filter((row, index) => !keyOnly || isKeyYear(row) || index === schedule.length - 1);
  box.innerHTML = `<p>第 ${first.t} 年開始領回，保險年齡 ${first.age} 歲。${period}。${varied ? "之後各年金額依建議書生存金表，不一定相同。" : "這組條件下各年金額相同。"}</p>
    <p>累計領回到表上最後一列 ${money(schedule.at(-1).total, item.currency)}。試算。實際給付以正式建議書及保單條款為準。</p>
    <div class="scroll"><table><thead><tr><th>年度</th><th>年齡</th><th>${item.monthlySurvival ? "全年／每月" : item.calc === "annuity" ? "當年年金" : "當年生存金"}</th><th>累計領回</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.t}</td><td>${row.age}</td><td>${money(row.surv, item.currency)}${item.monthlySurvival ? `<br>${money(row.surv / 12, item.currency)}` : ""}</td><td>${money(row.total, item.currency)}</td></tr>`).join("")}</tbody></table></div>`;
}
const params = new URLSearchParams(location.search);
const initial = params.get("code") && savings.some((item) => item.code === params.get("code")) ? params.get("code") : savings[0].code;
const select = document.querySelector("#product");
select.innerHTML = savings.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
select.value = initial;
const cache = new Map();
const partCache = new Map();

async function metaOf(code) {
  if (!cache.has(code)) cache.set(code, loadJson(`data/savings/${code}.json`));
  return cache.get(code);
}

async function product() {
  const item = await metaOf(select.value);
  if (!item.splitTables) return item;
  const term = document.querySelector("#term").value || Object.keys(item.issueAges)[0];
  const key = `${item.code}|${term}`;
  if (!partCache.has(key)) partCache.set(key, loadJson(`data/savings/${item.code}/${term}.json`));
  return { ...item, tables: await partCache.get(key) };
}

async function fillTerms() {
  const item = await metaOf(select.value);
  const previousTerm = document.querySelector("#term").value;
  document.querySelector("#term").innerHTML = Object.keys(item.issueAges).map((term) => `<option value="${term}">${termLabel(term, item.payYears === "age")}</option>`).join("");
  if (Object.keys(item.issueAges).includes(previousTerm)) document.querySelector("#term").value = previousTerm;
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
    document.querySelector("label[for=term]").textContent = item.payYears === "age" ? "繳至" : "年期";
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

renderQuick();
for (const id of ["qCur", "qKind", "qTerm", "qAge", "qFind", "qSurv"]) {
  document.querySelector(`#${id}`).addEventListener("input", renderQuick);
  document.querySelector(`#${id}`).addEventListener("change", renderQuick);
}
document.querySelector("#qList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-jump]");
  if (!button) return;
  select.value = button.dataset.jump;
  select.dispatchEvent(new Event("change"));
  document.querySelector("#survBox").scrollIntoView({ block: "start" });
});

select.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("code", select.value);
  history.replaceState(null, "", url);
  fillTerms().then(() => runQuote());
});
await fillTerms();

let quoting = false;
let queued = false;
function clearQuote() {
  document.querySelector("#summary").hidden = true;
  document.querySelector("#tableWrap").hidden = true;
  document.querySelector("#rpuBox").hidden = true;
  document.querySelector("#drawBox").hidden = true;
  document.querySelector("#rows").innerHTML = "";
  document.querySelector("#headline").textContent = "";
  document.querySelector("#survOut").innerHTML = "";
  document.querySelector("#rpuOut").innerHTML = "";
}

function showNotes(notes) {
  const note = document.querySelector("#clampNote");
  note.hidden = notes.length === 0;
  note.textContent = notes.join("。");
}

async function runQuote() {
  if (quoting) {
    queued = true;
    return;
  }
  quoting = true;
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const item = await metaOf(select.value);
    const term = document.querySelector("#term").value || Object.keys(item.issueAges)[0];
    const band = item.issueAges[String(term)];
    const resolved = resolveAge(document.querySelector("#age").value, band?.[0], band?.[1]);
    if (resolved.error) {
      clearQuote();
      showNotes([]);
      throw new Error(resolved.error);
    }
    if (String(document.querySelector("#age").value).trim() !== String(resolved.age)) {
      document.querySelector("#age").value = String(resolved.age);
    }
    showNotes(resolved.notes);
    const sumText = String(document.querySelector("#sum").value).trim();
    if (sumText === "" || !Number.isFinite(Number(sumText))) {
      clearQuote();
      throw new Error("請輸入保額");
    }
    const priced = await product();
    const scenario = document.querySelector("#scenario").value === "low" ? 1 : document.querySelector("#scenario").value === "mid" ? 2 : Number(document.querySelector("#scenario").value || 2);
    const modeId = `${document.querySelector("#term").value}|${document.querySelector("#sex").value}|${resolved.age}`;
    const input = {
      age: resolved.age,
      sex: Number(document.querySelector("#sex").value),
      term: Number(document.querySelector("#term").value),
      sum: Number(document.querySelector("#sum").value),
      scenario,
      declaredRate: Number(document.querySelector("#declared").value),
      mode: priced.calc === "fbo"
        ? document.querySelector("#payMode").value
        : preferredSavingsMode(priced, savingsModes(priced, modeId)),
    };
    const result = quoteProduct(priced, input);
    const yearTen = result.rows[Math.min(9, result.rows.length - 1)];
    const keyOnly = document.querySelector("#keyYears").checked;
    const showParts = document.querySelector("#showParts").checked;
    const visible = result.rows.filter((row) => !keyOnly || isKeyYear(row));
    const parts = partColumns(result.rows);
    document.querySelector("#partsLabel").hidden = parts.length < 2;
    document.querySelector("#yearScroll").classList.toggle("parts", showParts && parts.length > 1);
    document.querySelector("#partsNote").hidden = !(showParts && parts.length > 1);
    document.querySelector("#partsNote").textContent = "B＝保證解約金。E＝終期紅利（解約，預估）。Y＝增額繳清的解約金（預估）。C＝現金給付或儲存生息。四欄相加為解約總額。試算，以正式建議書為準。";
    const jump = document.querySelector("#jumpYear");
    const previousJump = jump.value;
    jump.innerHTML = visible.map((row) => `<option value="${row.t}">第 ${row.t} 年（${row.age} 歲）</option>`).join("");
    if (visible.some((row) => String(row.t) === previousJump)) jump.value = previousJump;
    if (item.calc === "annuity") {
      document.querySelector("#headline").innerHTML = `躉繳 ${money(result.payable, item.currency)} · 首月年金 ${money(result.firstPayment, item.currency)} · 第 ${yearTen.t} 年累計年金 ${money(yearTen.X, item.currency)} · 含領回內部報酬率 ${percent(result.irr10)}`;
      document.querySelector("#tableHead").innerHTML = "<tr><th>年度（年齡）</th><th>保費</th><th>累計保費</th><th>當年年金</th><th>累計年金</th></tr>";
      document.querySelector("#rows").innerHTML = visible.map((row) => `<tr class="${row.t % 5 === 0 || row.age % 10 === 0 ? "hl" : ""}" data-t="${row.t}"><td>${row.t}（${row.age}）</td><td>${money(row.py, item.currency)}</td><td>${money(row.cum, item.currency)}</td><td>${money(row.surv, item.currency)}</td><td>${money(row.X, item.currency)}</td></tr>`).join("");
    } else {
      document.querySelector("#headline").innerHTML = `首期實繳 ${money(result.payable, item.currency)} · 第 ${yearTen.t} 年解約 ${money(yearTen.X, item.currency)} · 含領回內部報酬率 ${percent(result.irr10)} · 領回超過保費 ${result.paybackYear ?? "—"}`;
      const partHead = parts.map((part) => `<th class="part">${part.label}</th>`).join("");
      const hasSurv = result.rows.some((row) => row.surv > 0);
      document.querySelector("#tableHead").innerHTML = `<tr><th>年度<br>年齡</th><th>年度保費</th><th>累計保費</th><th>身故</th><th>解約總額</th>${partHead}${hasSurv ? "<th>生存金</th><th>累計領回</th>" : ""}<th>壽險倍數</th><th>試算 IRR</th></tr>`;
      document.querySelector("#rows").innerHTML = visible.map((row) => {
        const irr = sheetIrr(result.rows, row.t, item.monthlySurvival);
        const partCells = parts.map((part) => `<td class="part">${money(row[part.key] || 0, item.currency)}</td>`).join("");
        const survCells = hasSurv ? `<td>${money(row.surv || 0, item.currency)}</td><td>${money(row.got || 0, item.currency)}</td>` : "";
        return `<tr class="${row.t % 5 === 0 || row.age % 10 === 0 ? "hl" : ""}" data-t="${row.t}"><td>${row.t}（${row.age}）</td><td>${money(row.py, item.currency)}</td><td>${money(row.cum, item.currency)}</td><td>${money(row.W, item.currency)}</td><td>${money(row.X, item.currency)}</td>${partCells}${survCells}<td>${row.cum ? (row.W / row.cum).toFixed(2) : "—"}</td><td>${percent(irr)}</td></tr>`;
      }).join("");
    }
    document.querySelector("#summary").hidden = false;
    document.querySelector("#summaryTag").textContent = item.calc === "annuity" ? "〔即期年金〕" : item.kind === "dividend" ? "〔分紅〕" : item.isr ? "〔利變〕" : "〔固定〕";
    document.querySelector("#tableWrap").hidden = false;
    renderSurvival(priced, result);
    renderRpu(priced, input, result);
    renderDraw(priced, result, input);
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
    clearQuote();
    document.querySelector("#survOut").innerHTML = `<p>${reason.message}</p>`;
  } finally {
    quoting = false;
    if (queued) {
      queued = false;
      runQuote();
    }
  }
}

function partColumns(rows) {
  return [
    ["b", "B 解約金"],
    ["e", "E 終期紅利"],
    ["y", "Y 增額繳清"],
    ["c", "C 現金／儲存"],
  ].filter(([key]) => rows.some((row) => row[key])).map(([key, label]) => ({ key, label }));
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
    const keyOnly = document.querySelector("#rpuKey").checked;
    const showParts = document.querySelector("#showParts").checked;
    const parts = showParts ? partColumns(reduced.rows) : [];
    const shown = reduced.rows.filter((row) => !keyOnly || isKeyYear(row) || row.t === reduced.year);
    const partHead = parts.map((part) => `<th>${part.label}</th>`).join("");
    lines.push(`<div class="scroll"><table><thead><tr><th>年度（年齡）</th><th>繼續繳解約</th><th>減額解約</th><th>繼續繳身故</th><th>減額身故</th>${partHead}</tr></thead><tbody>${shown.map((row) => {
      const base = result.rows[row.t - 1];
      const partCells = parts.map((part) => `<td>${money(row[part.key] || 0, item.currency)}</td>`).join("");
      return `<tr class="${row.t % 5 === 0 || row.age % 10 === 0 ? "hl" : ""}"><td>${row.t}（${row.age}）</td><td>${money(base.X, item.currency)}</td><td>${money(row.X, item.currency)}</td><td>${money(base.W, item.currency)}</td><td>${money(row.W, item.currency)}</td>${partCells}</tr>`;
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
for (const id of ["age", "sex", "term", "sum", "scenario", "declared", "payMode", "rpuYear", "drawFrom", "drawTo", "drawAmt", "keyYears", "showParts", "rpuKey"]) {
  const node = document.querySelector(`#${id}`);
  if (!node) continue;
  node.addEventListener("input", runQuote);
  node.addEventListener("change", runQuote);
}
document.querySelector("#jumpYear").addEventListener("change", () => {
  const row = document.querySelector(`#rows tr[data-t="${document.querySelector("#jumpYear").value}"]`);
  row?.scrollIntoView({ block: "center", inline: "nearest" });
});
watchTables();
runQuote();
