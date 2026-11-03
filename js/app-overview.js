import { buildOverview } from "./overview.js";
import { fillVersion, loadJson, money } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const params = new URLSearchParams(location.search);
const age = Number(params.get("age") || 30);
const sex = Number(params.get("sex") || 1);
let raw = [];
try { raw = JSON.parse(params.get("bundle") || "[]"); } catch { raw = []; }
const body = document.querySelector("#body");
if (!raw.length) {
  body.innerHTML = `<p>還沒有組合。<a href="bundle.html">回組合估價</a></p>`;
} else {
  const explains = {};
  const products = {};
  await Promise.all(raw.map(async (item) => {
    try { explains[item.c] = await loadJson(`data/explain/${item.c}.json`); } catch { explains[item.c] = null; }
    try { products[item.c] = await loadJson(`data/protection/${item.c}.json`); } catch { products[item.c] = null; }
  }));
  const items = raw.map((item) => ({
    code: item.c,
    name: item.n || explains[item.c]?.name || products[item.c]?.name || item.c,
    role: item.h < 0 ? "主約" : "附約",
    sum: Number(item.s) || 0,
    term: Number(item.t) || 0,
    annual: Number(item.annual) || 0,
    payable: Number(item.y) || 0,
    unitKind: products[item.c]?.unitKind || "wan",
  }));
  const view = buildOverview({ age, sex, items, explains });
  const yuan = (value) => `${Math.round(Number(value) || 0).toLocaleString("zh-Hant")} 元`;
  const chips = items.map((item) => `<span class="chip">${item.role === "主約" ? "" : "└ "}${item.code}</span>`).join("");
  const groups = view.categories.map((name) => {
    const rows = view.groups[name];
    let total = "";
    if (name === "身故" && view.totals.身故) total = `<span class="sum">合計至少 ${yuan(view.totals.身故)}</span>`;
    if (name === "重症癌症" && view.totals.重症癌症) total = `<span class="sum">確診最高 ${yuan(view.totals.重症癌症)}</span>`;
    if (name === "住院" && view.totals.住院日額) total = `<span class="sum">日額每天合計 ${yuan(view.totals.住院日額)}</span>`;
    const list = rows.length
      ? `<ul>${rows.filter((row) => row.text).map((row) => `<li><span class="code">${row.code}</span>${row.text}</li>`).join("")}</ul>`
      : `<p class="sub">這組沒有這項保障</p>`;
    return `<section class="panel benefit"><header><h2>${name}</h2>${total}</header>${list}</section>`;
  }).join("");
  const premiumRows = items.map((item) => `<tr><td>${item.role} ${item.code}</td><td>${item.name}</td><td>${money(item.annual, "TWD")}</td><td>${money(item.payable, "TWD")}</td></tr>`).join("");
  const details = view.products.map((item) => {
    const cards = item.cards.map((card) => `<p><strong>${card.title}</strong> ${card.amount}<span class="sub">${card.line}${card.note ? `。${card.note}` : ""}</span></p>`).join("");
    const sources = item.sources.length ? `<p class="sub">出處：${item.sources.join("；")}</p>` : "";
    return `<section class="panel"><header><h2>${item.code}</h2><span class="sub">首年 ${money(item.payable, "TWD")}</span></header><p>${item.name}</p><p>${item.tagline}</p>${cards}${sources}<p><a href="explain.html?code=${item.code}">單獨看解說</a></p></section>`;
  }).join("");
  body.innerHTML = `
    <section class="panel">
      <header><h2>${age} 歲・${sex === 1 ? "男" : "女"}</h2><span class="tag">主約 ${items.filter((item) => item.role === "主約").length}・附約 ${items.filter((item) => item.role !== "主約").length}</span></header>
      <p class="money">首年實繳合計 ${money(view.premium, "TWD")}</p>
      <p class="sub">約每月 ${money(Math.round(view.premium / 12), "TWD")}</p>
      <div class="chips">${chips}</div>
      <p class="noprint"><a href="bundle.html">回組合修改</a> · <button type="button" class="ghost" id="print">列印</button></p>
    </section>
    <h2>保障總覽</h2>
    ${groups}
    <section class="panel"><header><h2>保費</h2></header><div class="scroll"><table><thead><tr><th></th><th>商品</th><th>年繳</th><th>首年實繳</th></tr></thead><tbody>${premiumRows}</tbody></table></div><p class="sub">首年實繳已計入繳費方式折扣。各商品解說裡的保費句子是未折扣的表定費率。</p></section>
    ${details}
    <p class="sub">給付金額依各商品條款或費率表，按這次選的保額、日額換算。同一事故通常擇一或依條款扣除已領金額，不是把每一列相加。實際給付以保單條款為準。</p>`;
  document.querySelector("#print").addEventListener("click", () => window.print());
}
