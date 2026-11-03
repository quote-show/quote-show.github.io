/**
 * 把這一組主約、附約的給付，按條款上的算法改成選定的保額或日額，再依保障項目歸類。
 * 歸類方式與給付倍數取自各商品說明（DM、條款）。金額是條款上的給付，不是保證領回。
 */

const HAND = new Set(["XWS5", "HSV", "HSY", "SJR1", "SDG", "CLZ", "CLX", "CIA", "CIB", "OLA6"]);
const EXAMPLE = 100;

const CATEGORIES = ["住院", "手術", "重症癌症", "失能長照", "身故", "豁免", "其他保障"];

function money(value) {
  return Math.round(value).toLocaleString("zh-TW");
}

function scaleText(text, factor) {
  if (!text || factor === 1) return text || "";
  const num = (raw) => Number(String(raw).replace(/,/g, ""));
  const held = [];
  const keep = (value) => {
    held.push(value);
    return `\u0000${held.length - 1}\u0000`;
  };
  const body = (raw, unit) => {
    const scaled = num(raw) * factor;
    return unit === "萬" ? scaled.toLocaleString("zh-TW") : Math.round(scaled).toLocaleString("zh-TW");
  };
  const scaled = String(text)
    .replace(/([\d,]+(?:\.\d+)?)\s*([～~])\s*([\d,]+(?:\.\d+)?)\s*(萬|元)/g, (_, left, sep, right, unit) => keep(`${body(left, unit)} ${sep} ${body(right, unit)} ${unit}`))
    .replace(/([\d,]+(?:\.\d+)?)\s*(萬|元)/g, (_, raw, unit) => keep(`${body(raw, unit)} ${unit}`))
    .replace(/([\d,]+(?:\.\d+)?)(?=\s*×)/g, (raw) => keep(Math.round(num(raw) * factor).toLocaleString("zh-TW")));
  return scaled.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)]);
}

function amountOf(value) {
  const text = String(value || "");
  if (/US\$/.test(text)) return null;
  const match = text.replace(/,/g, "").match(/^\s*(?:NT\$|US\$)?\s*([\d.]+)\s*(萬)?\s*(元)?\s*$/);
  return match ? Number(match[1]) * (match[2] ? 10000 : 1) : null;
}

function classify(title, amount) {
  const text = `${title} ${amount}`;
  if (/免繳|豁免|觸發條件/.test(text)) return "豁免";
  if (/身故/.test(title)) return "身故";
  if (/長期照顧|長照|失智|失能|扶助|關懷金|每月給付|燒燙傷(?!中心)/.test(title)) return "失能長照";
  if (/癌|重大傷病|重大疾病|特定傷病|特定重大|放射線|化學治療|放化療|標靶|免疫|質子|粒子|基因檢測/.test(title) && !/住院|門診/.test(title) && /\d.*(元|萬)|US\$|^[\d,.]+$/.test(amount)) return "重症癌症";
  if (/住院/.test(title)) return "住院";
  if (/手術|植入|置換|支架|調節器|ECMO|移植|復位|縫合|骨折|醫材/.test(title)) return "手術";
  if (/病房|日額|醫療|療養|加護|燒燙傷中心|門診/.test(title)) return "住院";
  return "其他保障";
}

function faceAmount(item) {
  const unit = item.unitKind;
  if (unit === "wan" || unit === "usd") return (Number(item.sum) || 0) * 10000;
  return Number(item.sum) || 0;
}

function factorFor(item) {
  return (Number(item.sum) || EXAMPLE) / EXAMPLE;
}

function specialLines(item, age) {
  const code = item.code;
  const face = faceAmount(item);
  const paidIn = (item.annual || 0) * (Number(item.term) || 0);
  const lines = [];
  if (code === "XWS5") {
    lines.push({ category: "住院", text: `69 歲起每天 ${money(face * 0.003)}` });
    lines.push({ category: "身故", text: `至少 ${money(Math.max(face, paidIn))}`, total: Math.max(face, paidIn) });
    lines.push({ category: "豁免", text: "2～6 級失能免繳主約" });
    if (age >= 69) lines.push({ category: "住院日額", daily: face * 0.003 });
  }
  if (code === "OLA6") lines.push({ category: "身故", text: `第 4 年起 ${money(face)}`, total: face });
  if (code === "SDG") {
    lines.push({ category: "重症癌症", text: `重大傷病 ${money(face)}`, total: face, pick: "max" });
    lines.push({ category: "身故", text: `至少 ${money(Math.max(face, paidIn * 1.06))}`, total: Math.max(face, paidIn * 1.06) });
    lines.push({ category: "豁免", text: "意外 2～6 級失能免繳主約" });
  }
  if (code === "SJR1") lines.push({ category: "手術", text: `保額 ${money(item.sum)} × 1～90 倍＝${money(item.sum)}～${money(item.sum * 90)}` });
  return lines;
}

export function buildOverview({ age, sex, items, explains }) {
  const groups = Object.fromEntries(CATEGORIES.map((name) => [name, []]));
  const totals = { 身故: 0, 重症癌症: 0, 住院日額: 0 };
  const products = [];
  for (const item of items) {
    const explain = explains[item.code];
    const factor = factorFor(item);
    const cards = (explain?.cards || []).map((card) => ({
      title: card.title,
      amount: scaleText(card.amount, factor),
      line: scaleText(card.line, factor),
      note: scaleText(card.note, factor),
    }));
    products.push({ ...item, tagline: explain?.tagline || "", sources: explain?.sources || [], cards });
    if (HAND.has(item.code)) {
      for (const line of specialLines(item, age)) {
        groups[line.category === "住院日額" ? "住院" : line.category].push({ code: item.code, text: line.text || "" });
        if (line.category === "住院日額") totals.住院日額 += line.daily || 0;
        if (line.total) totals[line.category] += line.total;
      }
      continue;
    }
    const picked = { 身故: [], 重症癌症: [] };
    let placed = 0;
    for (const card of cards) {
      const category = classify(card.title, card.amount);
      const bucket = groups[category] ? category : "其他保障";
      groups[bucket].push({ code: item.code, text: `${card.title}：${card.amount}` });
      placed += 1;
      if (bucket === "身故" || bucket === "重症癌症") {
        const value = amountOf(card.amount);
        if (value != null) picked[bucket].push(value);
      }
    }
    if (picked.身故.length) totals.身故 += Math.min(...picked.身故);
    if (picked.重症癌症.length) totals.重症癌症 += Math.max(...picked.重症癌症);
    if (!placed && !explain) groups.其他保障.push({ code: item.code, text: item.name || "尚未收錄給付說明" });
  }
  const premium = items.reduce((sum, item) => sum + (Number(item.payable) || 0), 0);
  return { age, sex, groups, totals, products, premium, categories: CATEGORIES };
}
