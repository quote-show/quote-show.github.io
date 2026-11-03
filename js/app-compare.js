import { preferredSavingsMode, quoteProduct, savingsModes } from "./calc.js";
import { fillVersion, loadJson, money, percent } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const cache = new Map();
async function fileOf(code) {
  if (!cache.has(code)) cache.set(code, loadJson(`data/savings/${code}.json`));
  return cache.get(code);
}
const options = savings.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
document.querySelector("#slots").innerHTML = [0, 1, 2].map((index) => `
  <div>
    <label for="p${index}">第 ${index + 1} 欄</label>
    <select id="p${index}">${index === 2 ? `<option value="">不比較</option>` : ""}${options}</select>
  </div>`).join("");
if (savings[1]) document.querySelector("#p1").value = savings[1].code;

document.querySelector("#run").addEventListener("click", async () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const picked = [0, 1, 2].map((index) => document.querySelector(`#p${index}`).value).filter(Boolean);
    const results = [];
    for (const code of picked) {
      const item = await fileOf(code);
      const term = Number(Object.keys(item.issueAges)[0]);
      const sample = item.verificationSamples?.[0];
      const age = sample?.age ?? 30;
      const sex = sample?.sex ?? 1;
      const useTerm = sample?.term ?? term;
      const sum = sample?.sum ?? item.sumInsured.min;
      const id = `${useTerm}|${sex}|${age}`;
      const result = quoteProduct(item, {
        age,
        sex,
        term: useTerm,
        sum,
        scenario: sample?.scenario ?? 2,
        declaredRate: item.declDefault,
        mode: preferredSavingsMode(item, savingsModes(item, id)),
      });
      const row = result.rows[Math.min(9, result.rows.length - 1)];
      results.push({ item, result, row });
    }
    [0, 1, 2].forEach((index) => {
      document.querySelector(`#h${index}`).textContent = results[index] ? results[index].item.name : "";
    });
    document.querySelector("#body").innerHTML = `
      <tr><td>首期</td>${results.map((item) => `<td>${money(item.result.payable, item.item.currency)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>第10年解約</td>${results.map((item) => `<td>${money(item.row.X, item.item.currency)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>含領回報酬率</td>${results.map((item) => `<td>${percent(item.result.irr10)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>壽險倍數</td>${results.map((item) => `<td>${item.row.cum ? (item.row.W / item.row.cum).toFixed(2) : "—"}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>`;
    document.querySelector("#out").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
