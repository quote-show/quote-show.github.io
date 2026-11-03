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
  assert.doesNotMatch(html, />組合</);
}

const protection = fs.readFileSync("protection.html", "utf8");
assert.match(protection, /<title>保障型｜藝世錄報價工具<\/title>/);
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

const script = fs.readFileSync("js/app-protection.js", "utf8");
assert.match(script, /quoteProduct/);
assert.match(script, /quoteBundle/);
assert.match(script, /verificationSamples/);
assert.match(script, /role === "property"/);

console.log("page tests ok");
