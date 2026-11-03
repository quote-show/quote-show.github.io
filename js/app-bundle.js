import { listRiders, modeName, quoteBundle } from "./bundle.js";
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
const sums = new Map(Object.entries(defaults));
const plans = new Map();
const terms = new Map();
let listKey = "";
let cartOpen = false;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function selectedSex() {
  return Number(document.querySelector('input[name="sex"]:checked').value);
}

function fillTerms() {
  const product = byCode[mainSelect.value];
  const select = document.querySelector("#term");
  const previous = select.value;
  const options = Object.keys(product.issueAges || {}).filter((term) => Number.isFinite(Number(term)));
  select.innerHTML = (options.length ? options : ["1"]).map((term) => `<option value="${term}">${term} 年</option>`).join("");
  if (options.includes(previous)) select.value = previous;
  const explain = explainIndex.has(product.code) ? `<a href="explain.html?code=${product.code}">解說</a>` : "";
  document.querySelector("#mainLink").innerHTML = explain;
}

function readPerson() {
  return {
    age: Number(document.querySelector("#age").value),
    sex: selectedSex(),
    occupation: Number(document.querySelector("#occ").value),
    parentAge: document.querySelector("#parentAge").value,
    main: mainSelect.value,
    chosen: [...chosen],
  };
}

function riderValue(item) {
  if (item.kind === "plan") return { plan: plans.get(item.code) || item.plans?.[0] || 1 };
  if (item.kind === "waiver") return {};
  const raw = sums.has(item.code) ? sums.get(item.code) : (defaults[item.code] ?? item.min ?? 1);
  const extra = {};
  if (item.terms?.length) extra.term = terms.get(item.code) || item.terms[0];
  return { sum: Number(raw), ...extra };
}

function readInput(menu) {
  const spec = document.querySelector("#spec").value;
  const person = readPerson();
  return {
    ...person,
    parentSex: 1,
    existingLife: Number(document.querySelector("#lifeEx").value || 0),
    spec: spec ? { on: true, id: spec, par: false } : { on: false },
    mode: document.querySelector("#mode").value,
    payDiscount: document.querySelector("#payDisc").checked,
    main: { code: person.main, term: Number(document.querySelector("#term").value), sum: Number(document.querySelector("#sum").value) },
    riders: menu.attachable.filter((item) => chosen.has(item.code)).map((item) => ({ code: item.code, ...riderValue(item) })),
  };
}

function rangeText(item) {
  if (item.kind === "waiver") return item.note || "投保金額依主約與附約年繳計算";
  if (item.kind === "plan") return `計畫 ${item.plans.join("、")}`;
  if (item.min == null || item.max == null) return item.note || "";
  const span = item.min === item.max ? `限 ${item.min.toLocaleString("zh-Hant")}` : `${item.min.toLocaleString("zh-Hant")}–${item.max.toLocaleString("zh-Hant")}`;
  return `${span} ${item.unit || ""}${item.note ? `｜${item.note}` : ""}`;
}

function controlHtml(item) {
  if (!chosen.has(item.code)) return "";
  const link = explainIndex.has(item.code) ? `<a href="explain.html?code=${item.code}">解說</a>` : "";
  if (item.kind === "waiver") return `<div class="rider-ctl"><span class="hint">投保金額自動計算</span>${link}<strong class="prem" data-prem="${item.code}"></strong></div>`;
  if (item.kind === "plan") {
    const current = plans.get(item.code) || item.plans[0];
    const options = item.plans.map((plan) => `<option value="${plan}" ${Number(current) === Number(plan) ? "selected" : ""}>計畫 ${plan}</option>`).join("");
    return `<div class="rider-ctl"><select data-plan="${item.code}">${options}</select>${link}<strong class="prem" data-prem="${item.code}"></strong></div>`;
  }
  const value = sums.has(item.code) ? sums.get(item.code) : (defaults[item.code] ?? item.min ?? "");
  const term = item.terms?.length
    ? `<select data-term="${item.code}">${item.terms.map((year) => `<option value="${year}" ${Number(terms.get(item.code) || item.terms[0]) === year ? "selected" : ""}>${year} 年</option>`).join("")}</select>`
    : "";
  return `<div class="rider-ctl">${term}<input data-sum="${item.code}" type="number" inputmode="decimal" step="${item.step || 1}" value="${esc(value)}"><span>${esc(item.unit || "")}</span>${link}<strong class="prem" data-prem="${item.code}"></strong></div>`;
}

function paintList(menu) {
  const groups = [];
  for (const item of menu.attachable) {
    let group = groups.find((entry) => entry.category === item.category);
    if (!group) groups.push(group = { category: item.category, items: [] });
    group.items.push(item);
  }
  document.querySelector("#rlist").innerHTML = groups.map((group) => {
    const rows = group.items.map((item) => {
      const on = chosen.has(item.code);
      return `<article class="rider${on ? " on" : ""}">
        <label class="pick"><input type="checkbox" data-pick="${item.code}" ${on ? "checked" : ""}><span><b>${esc(item.code)}</b>${esc(item.name)}<small>${esc(rangeText(item))}</small></span></label>
        ${controlHtml(item)}
      </article>`;
    }).join("");
    return `<h3 class="catbar">${esc(group.category)}</h3>${rows}`;
  }).join("") || `<p class="hint">這個主約目前沒有可附加的附約。</p>`;
  document.querySelector("#riderCount").textContent = `可勾 ${menu.attachable.length}`;
  document.querySelector("#rnolistcnt").textContent = `（${menu.blocked.length}）`;
  document.querySelector("#rnolist").hidden = menu.blocked.length === 0;
  document.querySelector("#rnl").innerHTML = menu.blocked.map((item) => `<p><b>${esc(item.code)}</b> ${esc(item.name)}<span class="why">${esc(item.why)}</span></p>`).join("");
  const main = byCode[mainSelect.value];
  document.querySelector("#rhint").textContent = main
    ? `已選主約 ${main.code}。可附加的附約直接勾選；勾了之後填保額或日額，保費會跟著變。不能附加的列在下方。`
    : "請先選主約。";
}

function paintCart(result, input) {
  const riders = result.lines.filter((line) => line.role !== "主約" && !line.error).length;
  const monthly = Math.round((result.totalPayable || 0) / 12);
  document.querySelector("#cartsum").innerHTML = `首年實繳合計・主約 1・附約 ${riders}<b>${money(result.totalPayable, result.currency)}</b><span class="hint">約每月 ${money(monthly, result.currency)}${result.errors.length ? `｜${result.errors.length} 項未計入` : ""}</span>`;
  const rows = result.lines.map((line) => {
    if (line.error) return `<tr><td>${esc(line.role || "")} ${esc(line.code)}</td><td colspan="3">${esc(line.error)}</td></tr>`;
    return `<tr><td>${esc(line.role)} ${esc(line.name)}</td><td>${money(line.annual, line.currency)}</td><td>${money(line.payable, line.currency)}</td><td>${line.renewal == null ? "—" : money(line.renewal, line.currency)}</td></tr>`;
  }).join("");
  document.querySelector("#cartbody").innerHTML = `<p class="hint">〔${modeName(result.mode)}〕</p><div class="scroll"><table><thead><tr><th>項目</th><th>年繳</th><th>本期</th><th>次年</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  for (const line of result.lines) {
    const node = document.querySelector(`[data-prem="${line.code}"]`);
    if (!node) continue;
    node.textContent = line.error || money(line.payable, line.currency);
  }
  const payload = result.lines.filter((line) => !line.error).map((line) => {
    const picked = line.role === "主約" ? input.main : input.riders.find((item) => item.code === line.code);
    return { c: line.code, s: picked?.sum || picked?.plan || 0, t: picked?.term || input.main.term, n: line.name, h: line.role === "主約" ? -1 : 0, y: Math.round(line.payable), annual: line.annual };
  });
  document.querySelector("#overview").href = `overview.html?age=${input.age}&sex=${input.sex}&bundle=${encodeURIComponent(JSON.stringify(payload))}`;
  document.querySelector("#rules").textContent = [
    result.covered ? `豁免投保金額 ${money(result.covered, "TWD")}（主約與附約年繳）` : "",
    `住院日額上限 ${result.medCap} 元（壽險累計 ${result.lifeWan} 萬）`,
    ...result.errors,
  ].filter(Boolean).join(" · ");
}

function render() {
  const error = document.querySelector("#error");
  error.hidden = true;
  try {
    const menu = listRiders(byCode, readPerson());
    for (const item of [...chosen]) {
      if (!menu.attachable.some((row) => row.code === item)) chosen.delete(item);
    }
    const nextMenu = listRiders(byCode, readPerson());
    const key = nextMenu.attachable.map((item) => `${item.code}:${chosen.has(item.code) ? 1 : 0}`).join(",")
      + `|${nextMenu.blocked.map((item) => `${item.code}:${item.why}`).join(",")}`;
    if (key !== listKey) {
      paintList(nextMenu);
      listKey = key;
    }
    const input = readInput(nextMenu);
    paintCart(quoteBundle(byCode, input), input);
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
document.querySelector("#rlist").addEventListener("input", (event) => {
  if (!event.target.dataset.sum) return;
  sums.set(event.target.dataset.sum, event.target.value);
  render();
});
document.querySelector("#rlist").addEventListener("change", (event) => {
  const code = event.target.dataset.pick;
  if (code) {
    if (event.target.checked) chosen.add(code);
    else chosen.delete(code);
    render();
    return;
  }
  if (event.target.dataset.plan) plans.set(event.target.dataset.plan, Number(event.target.value));
  if (event.target.dataset.term) terms.set(event.target.dataset.term, Number(event.target.value));
  render();
});
document.querySelector("#cartopen").addEventListener("click", () => {
  cartOpen = !cartOpen;
  document.querySelector("#cartbody").hidden = !cartOpen;
  document.querySelector("#cartopen").textContent = cartOpen ? "明細 ▼" : "明細 ▲";
  document.querySelector("#cartopen").setAttribute("aria-expanded", cartOpen ? "true" : "false");
  document.body.style.paddingBottom = cartOpen ? "52vh" : "";
});
for (const id of ["age", "occ", "parentAge", "lifeEx", "spec", "term", "sum", "mode", "payDisc"]) {
  document.querySelector(`#${id}`).addEventListener("input", render);
  document.querySelector(`#${id}`).addEventListener("change", render);
}
document.querySelectorAll('input[name="sex"]').forEach((node) => node.addEventListener("change", render));
fillTerms();
render();
