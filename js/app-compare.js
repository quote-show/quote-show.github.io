import { preferredSavingsMode, quoteProduct, savingsModes } from "./calc.js";
import { sameTerm, solveFace } from "./compare-solve.js";
import { fillVersion, loadJson, money, percent, watchTables } from "./ui.js";

const catalog = await loadJson("data/products.json");
const index = await loadJson("data/savings-index.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const slotCount = 4;
const byCode = new Map(index.map((item) => [item.code, item]));

function termList(code) {
  const info = byCode.get(code);
  if (!info) return "";
  return (info.bands || []).map((band) => info.payToAge ? `繳至${band.term}歲` : (Number(band.term) === 1 ? "躉繳" : `${band.term}年期`)).join("、");
}

function currencyName(code) {
  const currency = byCode.get(code)?.currency;
  if (currency === "TWD") return "台幣";
  if (currency === "AUD") return "AUD";
  if (currency === "USD") return "USD";
  return currency || "";
}
const metas = new Map();
const cache = new Map();
async function metaOf(code) {
  if (metas.has(code)) return metas.get(code);
  const meta = await loadJson(`data/savings/${code}.json`);
  metas.set(code, meta);
  return meta;
}
async function fileOf(code, term) {
  const meta = await metaOf(code);
  if (!meta.splitTables) return meta;
  const key = `${code}|${term}`;
  if (cache.has(key)) return cache.get(key);
  const tables = await loadJson(`data/savings/${code}/${term}.json`);
  const product = { ...meta, tables };
  cache.set(key, product);
  return product;
}

function fillTerms() {
  const select = document.querySelector("#term");
  const previous = select.value;
  const groups = new Map();
  for (const item of index) {
    for (const band of item.bands || []) {
      const payToAge = !!item.payToAge;
      const key = `${payToAge ? "age" : "year"}:${band.term}`;
      if (!groups.has(key)) groups.set(key, { term: Number(band.term), payToAge });
    }
  }
  const list = [...groups.values()].sort((a, b) => Number(a.payToAge) - Number(b.payToAge) || a.term - b.term);
  select.innerHTML = list.map((item) => {
    const label = item.payToAge ? `繳至 ${item.term} 歲` : (item.term === 1 ? "躉繳" : `${item.term} 年期`);
    return `<option value="${item.term}" data-pay="${item.payToAge ? "age" : "year"}">${label}</option>`;
  }).join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  else if ([...select.options].some((option) => option.value === "6")) select.value = "6";
}
fillTerms();

function chosenTerm() {
  const select = document.querySelector("#term");
  const option = select.selectedOptions[0];
  return { term: Number(select.value), payToAge: option?.dataset.pay === "age" };
}

function termText(entry) {
  if (!entry?.term) return "無此年期";
  if (entry.payToAge) return `繳至 ${entry.term} 歲`;
  return Number(entry.term) === 1 ? "躉繳" : `${entry.term} 年期`;
}
const missingLabel = "無此年齡/性別資料";

function matches(item, query) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return item.code.toLowerCase().includes(text) || item.name.toLowerCase().includes(text);
}

function slotValues(next) {
  if (next) return next;
  const selects = [...document.querySelectorAll("#slots select")];
  if (!selects.length) return [savings[0]?.code || "", savings[1]?.code || "", "", ""];
  return selects.map((select, index) => {
    if (select.value) return select.value;
    if (select.options.length) return "";
    if (index === 0) return savings[0]?.code || "";
    if (index === 1) return savings[1]?.code || "";
    return "";
  });
}

function fillSlots(next) {
  const query = document.querySelector("#find").value;
  const values = slotValues(next);
  const matched = savings.filter((item) => matches(item, query));
  [...document.querySelectorAll("#slots select")].forEach((select, index) => {
    const selected = values[index] || "";
    const chosen = savings.find((item) => item.code === selected);
    const list = chosen && !matched.some((item) => item.code === chosen.code) ? [chosen, ...matched] : matched;
    const empty = index === 0 ? "" : `<option value="">不比較</option>`;
    const body = list.map((item) => `<option value="${item.code}">${item.code} ${item.name}</option>`).join("");
    const none = list.length ? "" : `<option value="" disabled>沒有符合的商品</option>`;
    select.innerHTML = empty + body + none;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  });
  renderList();
}

function renderList() {
  const query = document.querySelector("#find").value;
  const picked = new Set(slotValues().filter(Boolean));
  const rows = savings.filter((item) => matches(item, query));
  document.querySelector("#count").textContent = `${rows.length} / ${savings.length} 檔`;
  const list = document.querySelector("#all");
  list.innerHTML = rows.map((item) => `<button type="button" class="entry" data-code="${item.code}" aria-pressed="${picked.has(item.code)}"><strong>${item.code}</strong> ${item.name}<p>${currencyName(item.code)} · ${termList(item.code)}</p></button>`).join("") || `<p class="demo">沒有符合的商品</p>`;
}

document.querySelector("#slots").innerHTML = Array.from({ length: slotCount }, (_, index) => `
  <div>
    <label for="p${index}">第 ${index + 1} 檔</label>
    <select id="p${index}"></select>
  </div>`).join("");
fillSlots();

document.querySelector("#all").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (!button) return;
  const code = button.dataset.code;
  const values = slotValues();
  if (values.includes(code)) {
    const index = values.indexOf(code);
    if (index > 0) values[index] = "";
    fillSlots(values);
    return;
  }
  const empty = values.findIndex((value) => !value);
  const error = document.querySelector("#error");
  if (empty < 0) {
    error.hidden = false;
    error.textContent = "最多同時比較 4 檔";
    return;
  }
  error.hidden = true;
  values[empty] = code;
  fillSlots(values);
});

function person() {
  const text = String(document.querySelector("#age").value).trim();
  const sex = Number(document.querySelector("#sex").value);
  if (!/^\d{1,3}$/.test(text)) return { error: "請輸入年齡" };
  const age = Number(text);
  if (age > 110) return { error: "請輸入年齡" };
  if (sex !== 1 && sex !== 2) return { error: "請選擇性別" };
  return { age, sex };
}

function allowedSex(product, sex) {
  return (product.sex || [1, 2]).map(Number).includes(sex);
}

function sumFor(product, age) {
  const limits = product.sumInsured || {};
  const min = Number(limits.min ?? 1);
  const ageMax = limits.byAge?.[String(age)];
  const max = ageMax == null ? Number(limits.max) : Math.min(Number(limits.max), Number(ageMax));
  const sample = product.verificationSamples?.[0]?.sum;
  let sum = Number.isFinite(Number(sample)) ? Number(sample) : min;
  if (sum < min) sum = min;
  if (Number.isFinite(max) && sum > max) sum = Math.min(max, Math.max(min, max));
  return sum;
}

function basis() {
  return document.querySelector("input[name='basis']:checked")?.value || "sum";
}

function syncBasis() {
  document.querySelector("#premiumBox").hidden = basis() !== "premium";
}

function budgetOf() {
  const text = String(document.querySelector("#premium").value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return { error: "請輸入年繳保費" };
  return { premium: Number(text), currency: document.querySelector("#currency").value };
}

function faceText(sum) {
  const text = Number(sum).toLocaleString("zh-Hant", { maximumFractionDigits: 2 });
  return `${text} 萬`;
}

function shown(entry, read) {
  if (entry.missing) return missingLabel;
  if (entry.note) return entry.note;
  return read(entry);
}

function surrender(entry, year) {
  if (entry.item?.calc === "annuity") return "無資料";
  const row = entry.result?.rows?.[year - 1];
  if (!row || !Number.isFinite(Number(row.X))) return "無資料";
  return money(row.X, entry.item.currency);
}

let generation = 0;

async function compare() {
  const token = ++generation;
  const error = document.querySelector("#error");
  error.hidden = true;
  const who = person();
  if (token !== generation) return;
  if (who.error) {
    error.hidden = false;
    error.textContent = who.error;
    return;
  }
  const modeName = basis();
  const budget = modeName === "premium" ? budgetOf() : null;
  if (budget?.error) {
    error.hidden = false;
    error.textContent = budget.error;
    return;
  }
  const picked = Array.from({ length: slotCount }, (_, index) => document.querySelector(`#p${index}`).value).filter(Boolean);
  const chosen = chosenTerm();
  const results = [];
  for (const code of picked) {
    if (token !== generation) return;
    const preview = await metaOf(code);
    if (!sameTerm(preview, chosen.term, chosen.payToAge)) {
      results.push({ item: preview, note: "無此年期" });
      continue;
    }
    const band = preview.issueAges[String(chosen.term)];
    if (!allowedSex(preview, who.sex) || who.age < Number(band[0]) || who.age > Number(band[1])) {
      results.push({ item: preview, term: chosen.term, payToAge: chosen.payToAge, missing: true });
      continue;
    }
    const term = chosen.term;
    try {
      const item = await fileOf(code, term);
      const id = `${term}|${who.sex}|${who.age}`;
      if (item.tables && item.tables.gp && item.tables.gp[id] == null && item.tables.die?.[id] == null && item.calc === "savings") {
        results.push({ item, term, payToAge: chosen.payToAge, missing: true });
        continue;
      }
      const scenario = item.verificationSamples?.[0]?.scenario ?? 2;
      const mode = preferredSavingsMode(item, savingsModes(item, id));
      let sum = sumFor(item, who.age);
      if (modeName === "premium") {
        if ((item.currency || "TWD") !== budget.currency) {
          results.push({ item, term, payToAge: chosen.payToAge, note: "幣別不同" });
          continue;
        }
        const solved = solveFace(item, {
          age: who.age,
          sex: who.sex,
          term,
          scenario,
          declaredRate: item.declDefault,
          mode,
        }, budget.premium);
        if (solved.note) {
          results.push({ item, term, payToAge: chosen.payToAge, note: solved.note });
          continue;
        }
        sum = solved.sum;
      }
      const result = quoteProduct(item, {
        age: who.age,
        sex: who.sex,
        term,
        sum,
        scenario,
        declaredRate: item.declDefault,
        mode,
      });
      results.push({ item, result, sum, term, payToAge: chosen.payToAge });
    } catch (reason) {
      const text = String(reason.message || "");
      if (/年期/.test(text)) results.push({ item: preview, note: "無此年期" });
      else if (/年齡|性別|費率/.test(text)) results.push({ item: preview, term, payToAge: chosen.payToAge, missing: true });
      else if (/最低|上限|不足/.test(text)) results.push({ item: preview, term, payToAge: chosen.payToAge, note: text });
      else results.push({ item: preview, term, payToAge: chosen.payToAge, missing: true, detail: text });
    }
  }
  if (token !== generation) return;
  const heads = document.querySelector("#heads");
  heads.replaceChildren();
  const headRow = document.createElement("tr");
  headRow.append(document.createElement("th"));
  results.forEach((entry) => {
    const head = document.createElement("th");
    head.title = entry.item.name;
    head.append(document.createTextNode(entry.item.code), document.createElement("br"), document.createTextNode(termText(entry)));
    headRow.append(head);
  });
  heads.append(headRow);
  const cell = (entry, read) => `<td>${shown(entry, read)}</td>`;
  const row = (label, read) => `<tr><td>${label}</td>${results.map((item) => cell(item, read)).join("")}</tr>`;
  const termRow = `<tr><td>繳費年期</td>${results.map((item) => `<td>${termText(item)}</td>`).join("")}</tr>`;
  document.querySelector("#body").innerHTML = [
    termRow,
    row("保額", (entry) => faceText(entry.sum)),
    row("首期", (entry) => money(entry.result.payable, entry.item.currency)),
    row("第5年解約", (entry) => surrender(entry, 5)),
    row("第10年解約", (entry) => surrender(entry, 10)),
    row("第15年解約", (entry) => surrender(entry, 15)),
    row("含領回報酬率", (entry) => entry.result.rows.length >= 10 ? percent(entry.result.irr10) : "無資料"),
    row("壽險倍數", (entry) => {
      const year = entry.result.rows[9];
      return year?.cum ? (year.W / year.cum).toFixed(2) : "無資料";
    }),
  ].join("");
  document.querySelector("#cards").innerHTML = results.map((entry) => {
    const line = (label, read) => `${label} ${shown(entry, read)}`;
    return `<article class="entry"><h2>${entry.item.code} ${termText(entry)}</h2><p>${[
      line("保額", (item) => faceText(item.sum)),
      line("首期", (item) => money(item.result.payable, item.item.currency)),
      line("第5年解約", (item) => surrender(item, 5)),
      line("第10年解約", (item) => surrender(item, 10)),
      line("第15年解約", (item) => surrender(item, 15)),
    ].join("<br>")}</p></article>`;
  }).join("");
  document.querySelector("#out").hidden = false;
  watchTables();
}

function rerun() {
  compare().catch((reason) => {
    document.querySelector("#error").hidden = false;
    document.querySelector("#error").textContent = reason.message;
  });
}

document.querySelector("#find").addEventListener("input", fillSlots);
document.querySelector("#run").addEventListener("click", rerun);
for (const id of ["#age", "#sex", "#premium", "#currency", "#term"]) {
  document.querySelector(id).addEventListener("change", () => { if (!document.querySelector("#out").hidden) rerun(); });
}
document.querySelector("#age").addEventListener("input", () => { if (!document.querySelector("#out").hidden) rerun(); });
document.querySelector("#basis").addEventListener("change", () => {
  syncBasis();
  if (!document.querySelector("#out").hidden) rerun();
});
syncBasis();
watchTables();
