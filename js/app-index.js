import { fillVersion, loadJson } from "./ui.js";

const catalog = await loadJson("data/products.json");
fillVersion(catalog);
const list = document.querySelector("#list");
const kindName = { protection: "保障型", savings: "儲蓄型", dividend: "分紅", "interest-sensitive": "利變" };
list.innerHTML = catalog.products.map((item) => {
  const href = item.type === "protection" ? "protection.html" : `savings.html?code=${encodeURIComponent(item.code)}`;
  const kind = item.kind ? ` · ${kindName[item.kind]}` : "";
  return `<a class="entry" href="${href}"><h2>${item.name}</h2><p>${kindName[item.type]}${kind} · ${item.currency} · ${item.code}</p></a>`;
}).join("");
