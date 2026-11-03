export const FOOT = "個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準";

export function money(value, currency) {
  const n = Math.round(Number(value) || 0);
  const body = n.toLocaleString("zh-Hant");
  return currency === "USD" ? `USD ${body}` : `NT$ ${body}`;
}

export function percent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("讀不到資料");
  return response.json();
}

export function sexName(sex) {
  return Number(sex) === 2 ? "女" : "男";
}

export function fillVersion(catalog) {
  document.querySelectorAll("[data-version]").forEach((node) => {
    node.textContent = `${catalog.version} · ${catalog.updated}`;
  });
}
