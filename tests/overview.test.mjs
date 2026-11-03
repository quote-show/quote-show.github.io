import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildOverview } from "../js/overview.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const explain = (code) => JSON.parse(fs.readFileSync(path.join(root, "data/explain", `${code}.json`), "utf8"));
const product = (code) => JSON.parse(fs.readFileSync(path.join(root, "data/protection", `${code}.json`), "utf8"));

const items = [
  { code: "XWS5", name: "新平準終身壽險", role: "主約", sum: 100, term: 20, annual: 34500, payable: 34155, unitKind: "wan" },
  { code: "ADG", name: product("ADG").name, role: "附約", sum: 100, term: 1, annual: 980, payable: 970, unitKind: "wan" },
  { code: "HJK", name: product("HJK").name, role: "附約", sum: 1000, term: 1, annual: 1900, payable: 1881, unitKind: "day" },
];
const view = buildOverview({
  age: 30,
  sex: 1,
  items,
  explains: { XWS5: explain("XWS5"), ADG: explain("ADG"), HJK: explain("HJK") },
});

assert.equal(view.premium, 37006);
assert.equal(view.totals.身故, 2000000);
assert.ok(view.groups.住院.some((row) => row.code === "XWS5" && row.text.includes("3,000")));
assert.ok(view.groups.住院.some((row) => row.code === "HJK" && row.text.includes("1,000")));
assert.ok(view.groups.住院.some((row) => row.code === "HJK" && row.text.includes("500")));
assert.ok(view.groups.失能長照.some((row) => row.text.includes("50,000") && row.text.includes("1,000,000")));
assert.ok(view.groups.失能長照.some((row) => row.text.includes("400,000")));
assert.ok(view.groups.身故.some((row) => row.code === "XWS5" && row.text.includes("1,000,000")));
assert.ok(view.groups.身故.some((row) => row.code === "ADG" && row.text.includes("3,000,000")));
assert.ok(view.groups.豁免.some((row) => row.text.includes("2～6 級失能")));
assert.equal(view.groups.手術.length, 0);
assert.ok(view.groups.其他保障.some((row) => row.text.includes("1.1")));
assert.ok(view.groups.其他保障.some((row) => row.text.includes("2,000,000")));
const hjk = view.products.find((item) => item.code === "HJK");
assert.ok(hjk.cards.some((card) => card.title === "住院醫療" && card.line.includes("第 31 天") && card.line.includes("2,000")));

const half = buildOverview({
  age: 40,
  sex: 1,
  items: [{ code: "ADG", name: "享安寶", role: "附約", sum: 50, term: 1, annual: 500, payable: 495, unitKind: "wan" }],
  explains: { ADG: explain("ADG") },
});
assert.ok(half.groups.失能長照.some((row) => row.text.includes("25,000") && row.text.includes("500,000")));
assert.ok(half.groups.失能長照.some((row) => row.text.includes("200,000")));
assert.equal(half.totals.身故, 500000);

console.log("overview tests ok");
