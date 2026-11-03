import { projectSavings } from "./engine.js";
import { fillVersion, loadJson, money, percent } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const savings = catalog.products.filter((item) => item.type === "savings");
const files = {};
for (const item of savings) files[item.code] = await loadJson(`data/${item.file}`);
const options = savings.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
document.querySelector("#slots").innerHTML = [0, 1, 2].map((index) => `
  <div>
    <label for="p${index}">第 ${index + 1} 欄</label>
    <select id="p${index}">${index === 2 ? `<option value="">不比較</option>` : ""}${options}</select>
  </div>`).join("");
if (savings[1]) document.querySelector("#p1").value = savings[1].code;

document.querySelector("#run").addEventListener("click", () => {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const picked = [0, 1, 2].map((index) => document.querySelector(`#p${index}`).value).filter(Boolean);
    const results = picked.map((code) => {
      const item = files[code];
      const term = Number(Object.keys(item.terms)[0]);
      const result = projectSavings(item, {
        age: 30,
        sex: 1,
        term,
        sum: item.currency === "USD" ? 20000 : 100000,
        scenario: "mid",
        declaredRate: item.declaredRate,
      });
      const row = result.rows[Math.min(9, result.rows.length - 1)];
      return { item, result, row };
    });
    [0, 1, 2].forEach((index) => {
      document.querySelector(`#h${index}`).textContent = results[index] ? results[index].item.name : "";
    });
    const cell = (index, text) => (results[index] ? text : "");
    document.querySelector("#body").innerHTML = `
      <tr><td>年繳</td>${results.map((item) => `<td>${money(item.result.annual, item.item.currency)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>回本年度</td>${results.map((item) => `<td>${item.result.paybackYear ?? "—"}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>內部報酬率</td>${results.map((item) => `<td>${percent(item.result.irr)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>
      <tr><td>壽險倍數</td>${results.map((item) => `<td>${item.row.multiple == null ? "—" : item.row.multiple.toFixed(2)}</td>`).join("")}${"<td></td>".repeat(3 - results.length)}</tr>`;
    document.querySelector("#out").hidden = false;
    void cell;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
});
