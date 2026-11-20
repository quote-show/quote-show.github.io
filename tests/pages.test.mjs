import assert from "node:assert/strict";
import fs from "node:fs";

const pages = ["index.html", "protection.html", "savings.html", "compare.html", "explain.html", "waiver.html", "overview.html"];
for (const file of pages) {
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /href="bundle\.html"/, `${file} 不應再把組合當獨立頁`);
  assert.match(html, /href="protection\.html"/);
  assert.match(html, />保障型</);
  assert.match(html, />儲蓄型</);
  assert.match(html, />比較</);
  assert.match(html, /href="real-estate\/"/);
  assert.doesNotMatch(html, />組合</);
}

const estate = fs.readFileSync("real-estate/index.html", "utf8");
assert.match(estate, /noindex,nofollow/);
assert.match(estate, /房產活化試算/);
assert.match(estate, /個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準/);

const protection = fs.readFileSync("protection.html", "utf8");
assert.match(protection, /<title>保障型｜報價工具<\/title>/);
assert.match(protection, /<h1>保障型<\/h1>/);
assert.match(protection, /id="find"/);
assert.match(protection, /id="job"/);
assert.match(protection, /id="rnolist"/);
assert.match(protection, /id="cartopen"/);
assert.match(protection, /豁免附約比較/);
assert.match(protection, /商品解說/);
assert.match(protection, /js\/app-protection\.js/);

const redirect = fs.readFileSync("bundle.html", "utf8");
assert.match(redirect, /location\.replace/);
assert.match(redirect, /protection\.html/);
assert.match(redirect, /location\.search/);
assert.match(redirect, /noindex,nofollow/);

const compare = fs.readFileSync("compare.html", "utf8");
assert.match(compare, /<title>儲蓄型比較｜報價工具<\/title>/);
assert.match(compare, /id="find"/);
assert.match(compare, /id="age"/);
assert.match(compare, /id="sex"/);
assert.match(compare, /個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準/);
assert.doesNotMatch(compare, /<img/);

const compareScript = fs.readFileSync("js/app-compare.js", "utf8");
assert.match(compareScript, /toLowerCase\(\)\.includes/);
assert.match(compareScript, /無此年齡\/性別資料/);
assert.match(compareScript, /dataset\.name\.toLowerCase\(\)\.includes/);
assert.match(compareScript, /第5年解約/);
assert.match(compareScript, /第15年解約/);
assert.match(compareScript, /無資料/);
assert.match(compare, /同保額比較/);
assert.match(compare, /同保費比較/);
assert.match(compare, /id="premium"/);
assert.match(compare, /id="currency"/);
assert.match(compare, /id="term"/);
assert.match(compare, /繳費年期/);
assert.match(compare, /全部商品/);
assert.match(compare, /id="all"/);
assert.match(compare, /最多四檔/);
assert.match(compareScript, /slotCount = 4/);
assert.match(compareScript, /無此年期/);
assert.match(compareScript, /sameTerm/);

const script = fs.readFileSync("js/app-protection.js", "utf8");
assert.match(script, /quoteProduct/);
assert.match(script, /quoteBundle/);
assert.match(script, /verificationSamples/);
assert.match(script, /role === "property"/);

console.log("page tests ok");
