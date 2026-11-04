export const FOOT = "個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準";

export function money(value, currency) {
  const n = Number(value) || 0;
  const whole = Math.round(n);
  const body = Math.abs(n - whole) < 1e-6
    ? whole.toLocaleString("zh-Hant")
    : n.toLocaleString("zh-Hant", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === "USD") return `USD ${body}`;
  if (currency === "AUD") return `AUD ${body}`;
  return `NT$ ${body}`;
}

export function resolveAge(raw, min, max) {
  const text = String(raw ?? "").trim();
  if (text === "") return { error: "請輸入年齡" };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { error: "年齡必須是數字" };
  const notes = [];
  let age = parsed;
  if (!Number.isInteger(parsed)) {
    age = Math.trunc(parsed);
    notes.push(`年齡 ${text} 已調整為 ${age} 歲`);
  }
  if (min != null && max != null && (age < min || age > max)) {
    const next = Math.min(max, Math.max(min, age));
    notes.push(`投保年齡要在 ${min}–${max} 歲，已調整為 ${next} 歲`);
    age = next;
  }
  return { age, notes };
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

export function isKeyYear(row) {
  return row.t <= 10 || row.t % 5 === 0 || row.age % 10 === 0;
}

export function watchTables() {
  const bind = (node) => {
    if (node.dataset.swipe) return;
    node.dataset.swipe = "1";
    const hint = document.createElement("p");
    hint.className = "swipe-hint";
    hint.textContent = "左右滑動看更多欄";
    hint.hidden = true;
    node.before(hint);
    const update = () => {
      const overflow = node.scrollWidth > node.clientWidth + 8;
      const started = node.scrollLeft > 8;
      hint.hidden = !overflow || started;
      node.classList.toggle("can-swipe", overflow && !started);
    };
    node.addEventListener("scroll", update, { passive: true });
    requestAnimationFrame(update);
  };
  const scan = () => document.querySelectorAll(".scroll").forEach(bind);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}

export function fillVersion(catalog) {
  document.querySelectorAll("[data-version]").forEach((node) => {
    node.textContent = `${catalog.version} · ${catalog.updated}`;
  });
}
