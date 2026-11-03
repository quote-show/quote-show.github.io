import { attachableRiders, modeName, quoteBundle } from "./bundle.js";
import { insuranceAge } from "./engine.js";
import { fillVersion, loadJson, money } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const listed = catalog.products.filter((item) => item.type === "protection");
const byCode = {};
await Promise.all(listed.map(async (item) => {
  byCode[item.code] = await loadJson(`data/${item.file}`);
}));
const explainIndex = new Set((await loadJson("data/explain/index.json").catch(() => [])).map((item) => item.code));
const mains = listed.filter((item) => byCode[item.code].role === "main" || byCode[item.code].calc === "protection");
const mainSelect = document.querySelector("#main");
mainSelect.innerHTML = mains.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
if (mains.some((item) => item.code === "XWS5")) mainSelect.value = "XWS5";

const defaults = { ADG: 100, HJK: 1000, HKR5: 1000, SJR1: 1000, ADH: 20, SDL: 50, TMR: 10, ADM: 1000, LTU: 3000 };
const chosen = new Set(["ADG", "HJK"]);

function selectedSex() {
  return Number(document.querySelector('input[name="sex"]:checked').value);
}

function fillTerms() {
  const product = byCode[mainSelect.value];
  const terms = Object.keys(product.issueAges || {}).filter((term) => Number.isFinite(Number(term)));
  document.querySelector("#term").innerHTML = (terms.length ? terms : ["1"]).map((term) => `<option value="${term}">${term} 年</option>`).join("");
  const explain = explainIndex.has(product.code) ? `<a href="explain.html?code=${product.code}">解說</a>` : "";
  document.querySelector("#mainLink").innerHTML = explain;
  paintRiders();
}

function paintRiders() {
  const codes = attachableRiders(byCode, mainSelect.value);
  for (const code of [...chosen]) if (!codes.includes(code)) chosen.delete(code);
  const options = codes.filter((code) => !chosen.has(code)).map((code) => `<option value="${code}">${byCode[code].name}</option>`).join("");
  const rows = [...chosen].map((code) => {
    const item = byCode[code];
    const unit = item.unitKind === "day" ? "元／日" : item.calc === "waiver" ? "自動" : item.unitKind === "wan" ? "萬" : "";
    const value = document.querySelector(`[data-sum="${code}"]`)?.value || defaults[code] || (item.unitKind === "day" ? 1000 : 10);
    const link = explainIndex.has(code) ? `<a href="explain.html?code=${code}">解說</a>` : "";
    const sum = item.calc === "waiver" ? "投保金額自動計算" : `<input data-sum="${code}" type="number" value="${value}"> ${unit}`;
    return `<p><strong>${item.name}</strong> ${link} <button type="button" data-remove="${code}">移除</button><br>${sum}</p>`;
  }).join("");
  document.querySelector("#riders").innerHTML = `<label for="addRider">加上附約</label><select id="addRider"><option value="">選擇</option>${options}</select>${rows}`;
}

function readInput() {
  const spec = document.querySelector("#spec").value;
  return {
    age: Number(document.querySelector("#age").value),
    sex: selectedSex(),
    occupation: Number(document.querySelector("#occ").value),
    parentAge: document.querySelector("#parentAge").value,
    parentSex: 1,
    existingLife: Number(document.querySelector("#lifeEx").value || 0),
    spec: spec ? { on: true, id: spec, par: false } : { on: false },
    mode: document.querySelector("#mode").value,
    payDiscount: document.querySelector("#payDisc").checked,
    main: { code: mainSelect.value, term: Number(document.querySelector("#term").value), sum: Number(document.querySelector("#sum").value) },
    riders: [...chosen].map((code) => {
      const field = document.querySelector(`[data-sum="${code}"]`);
      return { code, sum: field ? Number(field.value) : (defaults[code] || 0) };
    }),
  };
}

function render() {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const input = readInput();
    const result = quoteBundle(byCode, input);
    document.querySelector("#lines").innerHTML = result.lines.map((line) => {
      if (line.error) return `<tr><td>${line.name || line.code}</td><td colspan="3">${line.error}</td></tr>`;
      return `<tr><td>${line.role} ${line.name}</td><td>${money(line.annual, line.currency)}</td><td>${money(line.payable, line.currency)}</td><td>${line.renewal == null ? "—" : money(line.renewal, line.currency)}</td></tr>`;
    }).join("");
    document.querySelector("#total").textContent = `本期合計 ${money(result.totalPayable, result.currency)}`;
    document.querySelector("#resultTag").textContent = `〔${modeName(result.mode)}〕`;
    document.querySelector("#rules").textContent = [
      result.covered ? `豁免投保金額 ${money(result.covered, "TWD")}（主約與附約年繳）` : "",
      `住院日額上限 ${result.medCap} 元（壽險累計 ${result.lifeWan} 萬）`,
      ...result.errors,
    ].filter(Boolean).join(" · ");
    document.querySelector("#result").hidden = false;
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
}

document.querySelector("#birth").addEventListener("change", () => {
  const birth = document.querySelector("#birth").value;
  if (!birth) return;
  document.querySelector("#age").value = String(insuranceAge(birth, new Date()));
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${document.querySelector("#age").value}〕`;
  render();
});
mainSelect.addEventListener("change", () => { fillTerms(); render(); });
document.querySelector("#riders").addEventListener("input", render);
document.querySelector("#riders").addEventListener("change", (event) => {
  if (event.target.id === "addRider" && event.target.value) {
    chosen.add(event.target.value);
    paintRiders();
  }
  render();
});
document.querySelector("#riders").addEventListener("click", (event) => {
  const code = event.target.dataset?.remove;
  if (!code) return;
  chosen.delete(code);
  paintRiders();
  render();
});
for (const id of ["age", "occ", "parentAge", "lifeEx", "spec", "term", "sum", "mode", "payDisc"]) {
  document.querySelector(`#${id}`).addEventListener("input", render);
  document.querySelector(`#${id}`).addEventListener("change", render);
}
document.querySelectorAll('input[name="sex"]').forEach((node) => node.addEventListener("change", render));
fillTerms();
render();
