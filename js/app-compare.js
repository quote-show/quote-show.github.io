import { preferredSavingsMode, quoteProduct, savingsModes } from "./calc.js";
import { fillVersion, loadJson, money, percent, watchTables } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const cache = new Map();
async function fileOf(code, term) {
  const key = `${code}|${term ?? ""}`;
  if (cache.has(key)) return cache.get(key);
  const meta = await loadJson(`data/savings/${code}.json`);
  if (!meta.splitTables) {
    cache.set(key, meta);
    return meta;
  }
  const useTerm = term || Object.keys(meta.issueAges)[0];
  const tables = await loadJson(`data/savings/${code}/${useTerm}.json`);
  const product = { ...meta, tables };
  cache.set(`${code}|${useTerm}`, product);
  return product;
}
const missingLabel = "無此年齡/性別資料";

function matches(item, query) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return item.code.toLowerCase().includes(text) || item.name.toLowerCase().includes(text);
}

function fillSlots() {
  const query = document.querySelector("#find").value;
  [0, 1, 2].forEach((index) => {
    const select = document.querySelector(`#p${index}`);
    const selected = select?.value || (index === 0 ? savings[0]?.code : index === 1 ? savings[1]?.code : "");
    const matched = savings.filter((item) => matches(item, query));
    const chosen = savings.find((item) => item.code === selected);
    const list = chosen && !matched.some((item) => item.code === chosen.code) ? [chosen, ...matched] : matched;
    const empty = index === 2 ? `<option value="">不比較</option>` : "";
    const body = list.map((item) => `<option value="${item.code}">${item.code} ${item.name}</option>`).join("");
    const none = list.length ? "" : `<option value="" disabled>沒有符合的商品</option>`;
    if (!select) return;
    select.innerHTML = empty + body + none;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  });
}

document.querySelector("#slots").innerHTML = [0, 1, 2].map((index) => `
  <div>
    <label for="p${index}">第 ${index + 1} 欄</label>
    <select id="p${index}"></select>
  </div>`).join("");
fillSlots();

function person() {
  const text = String(document.querySelector("#age").value).trim();
  const sex = Number(document.querySelector("#sex").value);
  if (!/^\d{1,3}$/.test(text)) return { error: "請輸入年齡" };
  const age = Number(text);
  if (age > 110) return { error: "請輸入年齡" };
  if (sex !== 1 && sex !== 2) return { error: "請選擇性別" };
  return { age, sex };
}

function termFor(product, age) {
  const ages = product.issueAges || {};
  const fits = (term) => {
    const band = ages[term];
    return Array.isArray(band) && age >= Number(band[0]) && age <= Number(band[1]);
  };
  const sampleTerm = product.verificationSamples?.[0]?.term;
  if (sampleTerm != null && fits(String(sampleTerm))) return Number(sampleTerm);
  const found = Object.keys(ages).find((term) => fits(term));
  return found == null ? null : Number(found);
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
  const picked = [0, 1, 2].map((index) => document.querySelector(`#p${index}`).value).filter(Boolean);
  const results = [];
  for (const code of picked) {
    if (token !== generation) return;
    const preview = await fileOf(code);
    const term = termFor(preview, who.age);
    if (!allowedSex(preview, who.sex) || term == null) {
      results.push({ item: preview, missing: true });
      continue;
    }
    try {
      const item = await fileOf(code, term);
      const id = `${term}|${who.sex}|${who.age}`;
      if (item.tables && item.tables.gp && item.tables.gp[id] == null && item.tables.die?.[id] == null && item.calc === "savings") {
        results.push({ item, missing: true });
        continue;
      }
      const result = quoteProduct(item, {
        age: who.age,
        sex: who.sex,
        term,
        sum: sumFor(item, who.age),
        scenario: item.verificationSamples?.[0]?.scenario ?? 2,
        declaredRate: item.declDefault,
        mode: preferredSavingsMode(item, savingsModes(item, id)),
      });
      const row = result.rows[Math.min(9, result.rows.length - 1)];
      results.push({ item, result, row });
    } catch (reason) {
      const text = String(reason.message || "");
      if (/年齡|性別|費率|年期/.test(text)) results.push({ item: preview, missing: true });
      else results.push({ item: preview, missing: true, detail: text });
    }
  }
  if (token !== generation) return;
  [0, 1, 2].forEach((index) => {
    const entry = results[index];
    const head = document.querySelector(`#h${index}`);
    head.textContent = entry ? entry.item.code : "";
    head.title = entry ? entry.item.name : "";
  });
  const cell = (entry, read) => `<td>${entry?.missing ? missingLabel : read(entry)}</td>`;
  const valueLabel = results.every((item) => item.item?.calc === "annuity") ? "第10年累計年金" : results.some((item) => item.item?.calc === "annuity") ? "第10年價值" : "第10年解約";
  const pad = "<td></td>".repeat(Math.max(0, 3 - results.length));
  document.querySelector("#body").innerHTML = `
    <tr><td>首期</td>${results.map((item) => cell(item, (entry) => money(entry.result.payable, entry.item.currency))).join("")}${pad}</tr>
    <tr><td>${valueLabel}</td>${results.map((item) => cell(item, (entry) => money(entry.row.X, entry.item.currency))).join("")}${pad}</tr>
    <tr><td>含領回報酬率</td>${results.map((item) => cell(item, (entry) => percent(entry.result.irr10))).join("")}${pad}</tr>
    <tr><td>壽險倍數</td>${results.map((item) => cell(item, (entry) => entry.row?.cum ? (entry.row.W / entry.row.cum).toFixed(2) : "—")).join("")}${pad}</tr>`;
  document.querySelector("#out").hidden = false;
  watchTables();
}

document.querySelector("#find").addEventListener("input", fillSlots);
document.querySelector("#run").addEventListener("click", () => { compare().catch((reason) => { document.querySelector("#error").hidden = false; document.querySelector("#error").textContent = reason.message; }); });
for (const id of ["#age", "#sex"]) {
  document.querySelector(id).addEventListener("change", () => { if (!document.querySelector("#out").hidden) compare(); });
  document.querySelector(id).addEventListener("input", () => { if (!document.querySelector("#out").hidden) compare(); });
}
watchTables();
