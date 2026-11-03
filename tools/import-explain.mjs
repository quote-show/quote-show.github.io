/** 把參考站商品解說收成純文字 JSON。不複製他們的版面。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = process.env.EXPLAIN_DIR || "/tmp/explain";
const out = path.resolve("data/explain");
fs.mkdirSync(out, { recursive: true });
const context = { console, Math, Date, Object, String, Number, JSON, Array, parseInt, parseFloat, isNaN, RegExp };
context.window = context;
context.globalThis = context;
context.EXPLAIN_TL = () => "";
vm.createContext(context);
for (const file of fs.readdirSync(source)) {
  if (!file.endsWith(".js") || ["explain.js", "bundle.js", "key30b3.js", "scalpel.js"].includes(file)) continue;
  vm.runInContext(fs.readFileSync(path.join(source, file), "utf8"), context, { filename: file });
}
const catalog = [];
for (const [code, item] of Object.entries(context.EXPLAIN || {})) {
  const ctx = { S: 1000000, age: 30, sex: item.sexOnly || 1, sum: 100, fm: (value) => String(Math.round(Number(value) || 0)), H: { rateMain: () => null }, payEnd: 50, tot: 0, annual: 0 };
  let points = [];
  let cards = [];
  try { points = item.key30 ? item.key30(ctx, {}) : []; } catch { points = []; }
  try { cards = item.cards ? item.cards(ctx) : []; } catch { cards = []; }
  const record = {
    code,
    name: item.name || code,
    category: item.cat || "",
    tagline: item.tagline || "",
    sources: item.src || [],
    example: "保額 100 萬、30 歲時的給付數字",
    points: (points || []).map((row) => Array.isArray(row) ? row[0] : String(row)),
    cards: (cards || []).filter((card) => card && (card.t || card.big)).map((card) => ({
      title: card.t || "",
      amount: card.big || "",
      line: card.line || "",
      note: card.sub || "",
    })),
  };
  fs.writeFileSync(path.join(out, `${code}.json`), JSON.stringify(record));
  catalog.push({ code, name: record.name, category: record.category });
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(catalog));
console.log(`explain ${catalog.length}`);
