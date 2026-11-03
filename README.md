# 藝世錄報價工具

Show 的個人保險快速試算站。純靜態檔案，GitHub Pages 從 `main` 的根目錄發布：<https://quote-show.github.io/>

每一頁都有 `<meta name="robots" content="noindex,nofollow">`，根目錄的 `robots.txt` 是 `Disallow: /`。

頁尾固定這句：「個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準。」

費率在 2026-11-03 從同公司同事的兩個參考工具轉入，改成這個站自己的 JSON 和計算，沒有沿用對方的頁面或識別。美利大運、即期年金和金安心改從商品專區的建議書與費率表抽出，原始 Excel、PDF 不進這個公開倉庫。每個商品檔的 `sources` 寫了來源、抓取日和費率版本。抽不完整的列在 `data/skipped.json`。已核對的商品是 `active`。金安心（MGD2）自 110/01/01 停售，目錄標停售。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `index.html` | 首頁與商品目錄 |
| `protection.html` | 保障型：主約、附約、豁免、產險年齡帶 |
| `bundle.html` | 主約加多個附約、豁免的合計 |
| `explain.html` | 商品解說（條款與費率表上的給付） |
| `waiver.html` | WP、WPA、WPF1、WPH 的差異 |
| `savings.html` | 儲蓄型：逐年解約金、身故給付、含領回內部報酬率 |
| `compare.html` | 儲蓄型並排，最多三欄 |
| `css/quote.css` | 藝世錄配色與手機卡片 |
| `js/engine.js` | 保險年齡、內部報酬率 |
| `js/calc.js` | 保障型保費與儲蓄型逐年表 |
| `data/products.json` | 目錄 |
| `data/protection/` | 保障型，一商品一檔 |
| `data/savings/` | 儲蓄型，一商品一檔 |
| `data/occupation.json` | 職業分類 |
| `data/fx.json` | 抓取當日的臺銀即期賣出匯率 |
| `DATA-SCHEMA.md` | 欄位說明 |
| `tests/engine.test.mjs` | 引擎骨架測試 |
| `tests/ported.test.mjs` | 每個商品至少 3 組對帳 |

## 新增一個商品

1. 讀 `DATA-SCHEMA.md`。新增 `data/protection/<代號>.json` 或 `data/savings/<代號>.json`。
2. 在 `data/products.json` 加一筆。`file` 相對 `data/`，例如 `protection/HJI.json`。
3. `sources` 寫來源、日期和費率版本。`verificationSamples` 放至少 3 組對過的結果。
4. 還沒對上之前把 `status` 留成 `demo`。頁面只在 `demo` 時顯示「示範資料，非真實費率」。
5. 在倉庫根目錄執行 `npm test`。
6. 推上 `main`。Pages 會從根目錄更新網站。

首頁、保障型和儲蓄型的選單都讀 `data/products.json`，不用改 HTML。
