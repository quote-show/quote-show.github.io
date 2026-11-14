import { fillVersion, loadJson } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const index = await loadJson("data/explain/index.json");
const code = new URLSearchParams(location.search).get("code");
const body = document.querySelector("#body");
const title = document.querySelector("#title");

if (!code) {
  title.textContent = "商品解說";
  const groups = new Map();
  for (const item of index) {
    const key = item.category || "其他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  body.innerHTML = [...groups].map(([name, items]) => `<section class="panel"><header><h2>${name}</h2></header>${items.map((item) => `<p><a href="explain.html?code=${item.code}">${item.name}</a> <span class="tag">${item.code}</span></p>`).join("")}</section>`).join("");
} else {
  try {
    const item = await loadJson(`data/explain/${code}.json`);
    title.textContent = item.name;
    document.title = `${item.name}｜報價工具`;
    const points = (item.points || []).map((line) => `<li>${line}</li>`).join("");
    const cards = (item.cards || []).map((card) => `<section class="panel"><header><h2>${card.title}</h2></header><p class="money">${card.amount}</p><p>${card.line}</p><p class="tag">${card.note}</p></section>`).join("");
    const sources = (item.sources || []).map((line) => `<li>${line}</li>`).join("");
    body.innerHTML = `
      <p>${item.tagline || ""}</p>
      <p class="tag">${item.example || ""} · <a href="protection.html?code=${item.code}">回保障型試算</a></p>
      ${points ? `<section class="panel"><header><h2>重點</h2></header><ul>${points}</ul></section>` : ""}
      ${cards}
      ${sources ? `<section class="panel"><header><h2>出處</h2></header><ul>${sources}</ul></section>` : ""}`;
  } catch {
    title.textContent = "還沒有這份解說";
    body.innerHTML = `<p>${code} 尚未收錄。 <a href="explain.html">看已收錄的商品</a></p>`;
  }
}
