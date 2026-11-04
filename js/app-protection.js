import { listRiders, modeName, quoteBundle } from "./bundle.js";
import { quoteProduct, sumLimits } from "./calc.js";
import { insuranceAge } from "./engine.js";
import { fillVersion, loadJson, money, resolveAge, watchTables } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const listed = catalog.products.filter((item) => item.type === "protection");
const byCode = {};
await Promise.all(listed.map(async (item) => {
  byCode[item.code] = await loadJson(`data/${item.file}`);
}));
const explainIndex = new Set((await loadJson("data/explain/index.json").catch(() => [])).map((item) => item.code));
const params = new URLSearchParams(location.search);
const mainSelect = document.querySelector("#main");
const ageInput = document.querySelector("#age");
const defaults = { ADG: 100, HJK: 1000, HKR5: 1000, SJR1: 1000, ADH: 20, SDL: 50, TMR: 10, ADM: 1000, LTU: 3000 };
const initialCode = params.get("code");
const chosen = new Set(!initialCode || initialCode === "XWS5" ? ["ADG", "HJK"] : []);
const sums = new Map(Object.entries(defaults));
const plans = new Map();
const terms = new Map();
let listKey = "";
let cartOpen = false;
let jobs = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function selectedSex() {
  return Number(document.querySelector('input[name="sex"]:checked').value);
}

function currentProduct() {
  return byCode[mainSelect.value];
}

function isHost(product) {
  return product?.role === "main";
}

function roleLabel(product) {
  if (product.role === "waiver" || product.calc === "waiver") return "豁免";
  if (product.role === "property") return "產物";
  if (product.role === "rider") return "附約";
  return "主約";
}

function sumLabel(product) {
  const unit = { wan: "萬元", day: "元／日", h: "元", usd: product.role === "rider" ? "萬美元" : "美元", unit: "單位", plan: "計畫", waiver: "元", yuan: "元" };
  return product.calc === "waiver" ? "被豁免的年繳保費" : `保額（${unit[product.unitKind] || "元"}）`;
}

function paintOptions() {
  const query = document.querySelector("#find").value.trim().toLowerCase();
  const current = mainSelect.value;
  const match = (item) => {
    if (item.code === current) return true;
    if (!query) return true;
    const product = byCode[item.code];
    return `${item.code} ${item.name} ${product.category || ""} ${roleLabel(product)}`.toLowerCase().includes(query);
  };
  const groups = [
    ["主約", (product) => product.role === "main"],
    ["附約", (product) => product.role === "rider"],
    ["豁免", (product) => product.role === "waiver" || product.calc === "waiver"],
    ["產物", (product) => product.role === "property"],
  ];
  mainSelect.innerHTML = groups.map(([label, test]) => {
    const options = listed.filter((item) => test(byCode[item.code]) && match(item));
    if (!options.length) return "";
    return `<optgroup label="${label}">${options.map((item) => `<option value="${item.code}">${item.code} ${item.name}</option>`).join("")}</optgroup>`;
  }).join("");
  if ([...mainSelect.options].some((option) => option.value === current)) mainSelect.value = current;
}

function configureProduct(resetValue, useSample = false) {
  const product = currentProduct();
  const termSelect = document.querySelector("#term");
  const termLabel = document.querySelector("label[for=term]");
  const sumWrap = document.querySelector("#sumWrap");
  const planWrap = document.querySelector("#planWrap");
  const previous = termSelect.value;
  if (product.calc === "band") {
    termLabel.textContent = "計畫";
    termSelect.innerHTML = (product.plans || []).map((name) => `<option value="${name}">${name}</option>`).join("");
    if (!resetValue && [...termSelect.options].some((option) => option.value === previous)) termSelect.value = previous;
    sumWrap.hidden = true;
    planWrap.hidden = true;
  } else {
    termLabel.textContent = "年期";
    const years = Object.keys(product.issueAges || {}).filter((term) => Number.isFinite(Number(term)));
    termSelect.innerHTML = (years.length ? years : ["1"]).map((term) => `<option value="${term}">${term} 年</option>`).join("");
    if (!resetValue && years.includes(previous)) termSelect.value = previous;
    sumWrap.hidden = false;
    const age = Number(ageInput.value);
    const occupation = Number(document.querySelector("#occ").value);
    const limits = product.calc === "waiver" ? { min: 1, max: 5000000, step: 1 } : sumLimits(product, age, occupation);
    const sum = document.querySelector("#sum");
    if (limits.min != null) sum.min = String(limits.min);
    if (limits.max != null) sum.max = String(limits.max);
    sum.step = String(limits.step || 1);
    document.querySelector("#sumLabel").textContent = sumLabel(product);
    if (product.calc === "plan") {
      planWrap.hidden = false;
      const planList = product.sumRule?.planGrid?.[`${age}|${occupation}`] || product.sumRule?.plans || [1];
      const planSelect = document.querySelector("#plan");
      const kept = planSelect.value;
      planSelect.innerHTML = planList.map((plan) => `<option value="${plan}">計畫 ${plan}</option>`).join("");
      if (planList.map(String).includes(kept)) planSelect.value = kept;
    } else {
      planWrap.hidden = true;
    }
  }
  document.querySelector("#payDisc").parentElement.hidden = product.calc === "band" && !product.discounts?.pay;
  const demo = document.querySelector("#demo");
  if (product.status === "stopped") {
    demo.hidden = false;
    demo.textContent = product.stop === "2021-01-01" ? "停售（110/01/01）" : `停售${product.stop ? `（${product.stop}）` : ""}`;
  } else if (product.status === "demo") {
    demo.hidden = false;
    demo.textContent = "示範資料，非真實費率";
  } else {
    demo.hidden = true;
  }
  const source = product.sources?.[0];
  document.querySelector("#sourceNote").textContent = source ? `${source.version || product.code} · ${source.fetched}` : "";
  const notes = [product.rule, product.note, product.cover].filter(Boolean);
  document.querySelector("#productNotes").innerHTML = notes.length
    ? notes.map((line) => `<p>${esc(line)}</p>`).join("")
    : `<p class="hint">費率表已收錄。核保仍以正式投保規則為準。</p>`;
  const explain = explainIndex.has(product.code) ? `<a href="explain.html?code=${encodeURIComponent(product.code)}">商品解說</a>` : "";
  document.querySelector("#mainLink").innerHTML = explain;
  const explainBox = document.querySelector("#explain");
  if (explainIndex.has(product.code)) {
    loadJson(`data/explain/${product.code}.json`).then((page) => {
      if (mainSelect.value !== product.code) return;
      explainBox.innerHTML = `<p>${esc(page.tagline || "")}</p><p><a href="explain.html?code=${encodeURIComponent(product.code)}">商品解說</a></p>`;
    }).catch(() => { explainBox.innerHTML = ""; });
  } else {
    explainBox.innerHTML = "";
  }
  const allowed = product.sex || [1, 2];
  document.querySelectorAll('input[name="sex"]').forEach((input) => {
    input.disabled = !allowed.includes(Number(input.value));
    if (input.disabled && input.checked) {
      const other = document.querySelector(`input[name="sex"][value="${allowed[0]}"]`);
      if (other) other.checked = true;
    }
  });
  document.querySelector("#riderBox").hidden = !isHost(product);
  if (resetValue) applyOpeningValue(product, useSample);
  if (product.calc !== "band") {
    const age = Number(ageInput.value);
    const occupation = Number(document.querySelector("#occ").value);
    const limits = product.calc === "waiver" ? { min: 1, max: 5000000, step: 1 } : sumLimits(product, age, occupation);
    const sum = document.querySelector("#sum");
    if (limits.min != null) sum.min = String(limits.min);
    if (limits.max != null) sum.max = String(limits.max);
    sum.step = String(limits.step || 1);
  }
}

function applyOpeningValue(product, useSample) {
  const sample = useSample ? product.verificationSamples?.[0] : null;
  const sum = document.querySelector("#sum");
  if (sample) {
    ageInput.value = String(sample.age);
    const sex = document.querySelector(`input[name="sex"][value="${sample.sex}"]`);
    if (sex && !sex.disabled) sex.checked = true;
    if (sample.occupation) document.querySelector("#occ").value = String(sample.occupation);
    const preset = product.calc === "band" ? sample.plan : sample.term;
    if (preset != null && [...document.querySelector("#term").options].some((option) => option.value === String(preset))) {
      document.querySelector("#term").value = String(preset);
    }
    sum.value = String(product.calc === "waiver" ? sample.covered : sample.sum);
  } else if (product.calc !== "band") {
    const limits = product.calc === "waiver"
      ? { min: 10000 }
      : sumLimits(product, Number(ageInput.value), Number(document.querySelector("#occ").value));
    const wanDefault = product.unitKind === "wan" && (limits.min == null || limits.min <= 100) && (limits.max == null || limits.max >= 100) ? 100 : null;
    const fallback = defaults[product.code] ?? wanDefault ?? limits.min ?? (product.unitKind === "day" ? 1000 : 100);
    sum.value = String(fallback);
  }
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
}

function readPerson() {
  return {
    age: Number(ageInput.value),
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
    main: { code: person.main, term: Number(document.querySelector("#term").value) || document.querySelector("#term").value, sum: Number(document.querySelector("#sum").value) },
    riders: menu.attachable.filter((item) => chosen.has(item.code)).map((item) => ({ code: item.code, ...riderValue(item) })),
  };
}

function singleInput(mode) {
  const product = currentProduct();
  const term = document.querySelector("#term").value;
  const sum = Number(document.querySelector("#sum").value);
  const parent = document.querySelector("#parentAge").value;
  const useParent = (product.code === "WPA" || product.code === "WPF1") && parent !== "";
  return {
    age: useParent ? Number(parent) : Number(ageInput.value),
    sex: selectedSex(),
    occupation: Number(document.querySelector("#occ").value),
    term,
    sum,
    covered: sum,
    plan: product.calc === "band" ? term : Number(document.querySelector("#plan").value || 1),
    mode: mode || document.querySelector("#mode").value,
    payDiscount: document.querySelector("#payDisc").checked,
    parentAge: document.querySelector("#parentAge").value,
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
  }).join("") || `<p class="hint">這個主約目前沒有可附加的附約。不勾附約也會即時算出主約保費。</p>`;
  document.querySelector("#riderCount").textContent = `可勾 ${menu.attachable.length}`;
  document.querySelector("#rnolistcnt").textContent = `（${menu.blocked.length}）`;
  document.querySelector("#rnolist").hidden = menu.blocked.length === 0;
  document.querySelector("#rnl").innerHTML = menu.blocked.map((item) => `<p><b>${esc(item.code)}</b> ${esc(item.name)}<span class="why">${esc(item.why)}</span></p>`).join("");
  const main = currentProduct();
  document.querySelector("#rhint").textContent = `已選主約 ${main.code}。可附加的附約直接勾選；不勾也會算出這一張主約。不能附加的列在下方。`;
}

function modeTable(run) {
  const rows = ["annual", "semi", "quarterly", "monthly"].map((mode) => {
    try {
      const priced = run(mode);
      const annual = priced.totalAnnual ?? priced.annual;
      const payable = priced.totalPayable ?? priced.payable;
      return `<tr><td>${modeName(mode)}</td><td>${money(annual, priced.currency)}</td><td>${money(payable, priced.currency)}</td></tr>`;
    } catch (error) {
      return `<tr><td>${modeName(mode)}</td><td colspan="2">${esc(error.message)}</td></tr>`;
    }
  }).join("");
  return `<h3 class="catbar">繳別</h3><div class="scroll"><table><thead><tr><th>繳別</th><th>年繳</th><th>本期</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function paintCart(result, input, runMode) {
  const riders = result.lines.filter((line) => line.role !== "主約" && !line.error).length;
  const monthly = Math.round((result.totalPayable || 0) / 12);
  const host = isHost(currentProduct());
  const head = host ? `主約 1・附約 ${riders}` : roleLabel(currentProduct());
  document.querySelector("#cartsum").innerHTML = `首年實繳合計・${head}<b>${money(result.totalPayable, result.currency)}</b><span class="hint">約每月 ${money(monthly, result.currency)}${result.errors?.length ? `｜${result.errors.length} 項未計入` : ""}</span>`;
  const rows = result.lines.map((line) => {
    if (line.error) return `<tr><td>${esc(line.role || "")} ${esc(line.code)}</td><td colspan="3">${esc(line.error)}</td></tr>`;
    return `<tr><td>${esc(line.role)} ${esc(line.name)}</td><td>${money(line.annual, line.currency)}</td><td>${money(line.payable, line.currency)}</td><td>${line.renewal == null ? "—" : money(line.renewal, line.currency)}</td></tr>`;
  }).join("");
  const extra = result.payableNext != null ? `<p class="hint">第 ${result.nextFromYear || "後"} 年起本期 ${money(result.payableNext, result.currency)}</p>` : "";
  document.querySelector("#cartbody").innerHTML = `<p class="hint">〔${modeName(result.mode)}〕</p><div class="scroll"><table><thead><tr><th>項目</th><th>年繳</th><th>本期</th><th>次年</th></tr></thead><tbody>${rows}</tbody></table></div>${extra}${modeTable(runMode)}`;
  for (const line of result.lines) {
    const node = document.querySelector(`[data-prem="${line.code}"]`);
    if (!node) continue;
    node.textContent = line.error || money(line.payable, line.currency);
  }
  const payload = result.lines.filter((line) => !line.error).map((line) => {
    const picked = line.code === input.main?.code ? input.main : (input.riders || []).find((item) => item.code === line.code);
    return { c: line.code, s: picked?.sum || picked?.plan || 0, t: picked?.term || input.main?.term || 0, n: line.name, h: line.role === "主約" ? -1 : 0, y: Math.round(line.payable), annual: line.annual };
  });
  document.querySelector("#overview").href = payload.length
    ? `overview.html?age=${input.age}&sex=${input.sex}&bundle=${encodeURIComponent(JSON.stringify(payload))}`
    : "overview.html";
  const bits = [
    result.covered ? `豁免投保金額 ${money(result.covered, "TWD")}（主約與附約年繳）` : "",
    result.medCap != null ? `住院日額上限 ${result.medCap} 元（壽險累計 ${result.lifeWan} 萬）` : "",
    ...(result.errors || []),
  ].filter(Boolean);
  document.querySelector("#rules").textContent = bits.join(" · ");
  const renew = result.lines.find((line) => line.renewal != null);
  document.querySelector("#solo").textContent = `年繳 ${money(result.totalAnnual ?? result.lines[0]?.annual, result.currency)}，本期 ${money(result.totalPayable, result.currency)}${renew ? `，次年 ${money(renew.renewal, result.currency)}` : ""}`;
}

function ageBand(product) {
  const term = document.querySelector("#term").value;
  const ages = product.issueAges || {};
  if (product.calc === "band") {
    const plan = (ages.plans || []).find((item) => item.name === term);
    return plan ? [plan.min, plan.max] : null;
  }
  const band = ages[String(term)] || ages.any || Object.values(ages).find((value) => Array.isArray(value) && value.length >= 2);
  return band || null;
}

function clearProtection() {
  document.querySelector("#solo").textContent = "";
  document.querySelector("#cartsum").textContent = "無法試算";
  document.querySelector("#cartbody").innerHTML = "";
  document.querySelector("#rules").textContent = "";
}

function render() {
  const error = document.querySelector("#error");
  const note = document.querySelector("#clampNote");
  error.hidden = true;
  const product = currentProduct();
  const band = ageBand(product);
  const resolved = resolveAge(document.querySelector("#age").value, band?.[0], band?.[1]);
  if (resolved.error) {
    error.hidden = false;
    error.textContent = resolved.error;
    note.hidden = true;
    clearProtection();
    return;
  }
  if (String(document.querySelector("#age").value).trim() !== String(resolved.age)) {
    document.querySelector("#age").value = String(resolved.age);
  }
  note.hidden = resolved.notes.length === 0;
  note.textContent = resolved.notes.join("。");
  if (!document.querySelector("#sumWrap").hidden) {
    const sumText = String(document.querySelector("#sum").value).trim();
    if (sumText === "" || !Number.isFinite(Number(sumText))) {
      error.hidden = false;
      error.textContent = "請輸入保額";
      clearProtection();
      return;
    }
  }
  try {
    if (!isHost(product)) {
      const input = singleInput();
      const priced = quoteProduct(product, input);
      const line = {
        role: roleLabel(product),
        code: product.code,
        name: product.name,
        annual: priced.annual,
        payable: priced.payable,
        renewal: priced.payableRenew ?? null,
        currency: priced.currency,
      };
      paintCart({
        lines: [line],
        totalPayable: priced.payable,
        totalAnnual: priced.annual,
        currency: priced.currency,
        errors: [],
        mode: input.mode,
        payableNext: priced.payableNext,
        nextFromYear: priced.nextFromYear,
      }, { age: input.age, sex: input.sex, main: { code: product.code, term: input.term, sum: input.sum, plan: input.plan }, riders: [] }, (mode) => quoteProduct(product, singleInput(mode)));
      return;
    }
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
    const result = quoteBundle(byCode, input);
    paintCart(result, input, (mode) => quoteBundle(byCode, { ...input, mode }));
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
    clearProtection();
  }
}

function rememberProduct() {
  const url = new URL(location.href);
  url.searchParams.set("code", mainSelect.value);
  history.replaceState(null, "", url);
}

function syncAgeFromBirth() {
  const birth = document.querySelector("#birth").value;
  if (!birth) return;
  ageInput.value = String(insuranceAge(birth, new Date()));
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
}

paintOptions();
if (initialCode && byCode[initialCode]) mainSelect.value = initialCode;
else if (byCode.XWS5) mainSelect.value = "XWS5";
if (!initialCode) syncAgeFromBirth();
configureProduct(true, Boolean(initialCode));

document.querySelector("#find").addEventListener("input", () => {
  const current = mainSelect.value;
  paintOptions();
  if (mainSelect.value !== current) {
    listKey = "";
    configureProduct(true, true);
    rememberProduct();
    render();
  }
});
document.querySelector("#birth").addEventListener("change", () => {
  syncAgeFromBirth();
  configureProduct(false);
  render();
});
document.querySelector("#ageMinus").addEventListener("click", () => {
  ageInput.value = String(Number(ageInput.value) - 1);
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
  configureProduct(false);
  render();
});
document.querySelector("#agePlus").addEventListener("click", () => {
  ageInput.value = String(Number(ageInput.value) + 1);
  document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
  configureProduct(false);
  render();
});
mainSelect.addEventListener("change", () => {
  listKey = "";
  configureProduct(true, true);
  rememberProduct();
  render();
});
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
loadJson("data/occupation.json").then((rows) => { jobs = rows; }).catch(() => { jobs = []; });
document.querySelector("#job").addEventListener("input", (event) => {
  const query = event.target.value.trim();
  const box = document.querySelector("#jobs");
  if (!query) { box.innerHTML = ""; return; }
  const found = jobs.filter((item) => `${item.job}${item.category}${item.subcategory}`.includes(query)).slice(0, 8);
  box.innerHTML = found.map((item) => `<button type="button" class="ghost" data-class="${item.class}" data-job="${item.job}">${item.job} · ${item.class || "—"}類</button>`).join("");
});
document.querySelector("#jobs").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const occ = document.querySelector("#occ");
  if ([...occ.options].some((option) => option.value === button.dataset.class)) occ.value = button.dataset.class;
  document.querySelector("#job").value = button.dataset.job;
  document.querySelector("#jobs").innerHTML = "";
  configureProduct(false);
  render();
});
for (const id of ["age", "occ", "parentAge", "lifeEx", "spec", "term", "plan", "sum", "mode", "payDisc"]) {
  document.querySelector(`#${id}`).addEventListener("input", () => {
    if (id === "age") document.querySelector("#ageTag").textContent = `〔保險年齡 ${ageInput.value}〕`;
    if (id === "age" || id === "occ") configureProduct(false);
    render();
  });
  document.querySelector(`#${id}`).addEventListener("change", () => {
    if (id === "age" || id === "occ") configureProduct(false);
    render();
  });
}
document.querySelectorAll('input[name="sex"]').forEach((node) => node.addEventListener("change", render));
watchTables();
render();
