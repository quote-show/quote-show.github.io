# 藝世錄報價

Show 的個人保險快速試算站。純靜態檔案，GitHub Pages 從 `main` 的根目錄發布：<https://quote-show.github.io/>

每一頁都有 `<meta name="robots" content="noindex,nofollow">`，根目錄的 `robots.txt` 是 `Disallow: /`。這是個人試算工具，不對搜尋引擎公開。

頁尾固定這句：「個人試算工具，實際保費、核保與給付以公司正式建議書及保單條款為準。」示範商品另外標「示範資料，非真實費率」。目前三個商品的數字都是整數假資料，不是任何公司的費率。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `index.html` | 首頁：進入保障型、儲蓄型，並列出目錄 |
| `protection.html` | 保障型：年齡、性別、職業、主約、附約、豁免、繳別 |
| `savings.html` | 儲蓄型：逐年解約金、身故給付、內部報酬率、回本年度 |
| `compare.html` | 儲蓄型並排比較，最多三欄 |
| `css/quote.css` | 藝世錄配色（米白、奶茶、古董金）、手機優先卡片、隊徽浮水印 |
| `js/engine.js` | 純計算：保險年齡、保費、豁免、內部報酬率、儲蓄型逐年表 |
| `js/ui.js` | 金額格式、讀 JSON、頁尾版本 |
| `js/app-*.js` | 各頁面 |
| `data/products.json` | 商品目錄 |
| `data/protection/` | 保障型，一商品一檔 |
| `data/savings/` | 儲蓄型，一商品一檔 |
| `assets/logo.png` | 隊徽。頁首圓章，以及卡片上淡化的浮水印 |
| `assets/fonts/NotoSerifTC-600.ttf` | 標題用的襯線字子集（藝世錄等字） |
| `DATA-SCHEMA.md` | 欄位說明 |
| `tools/extract_outline.py` | 從建議書 Excel、費率表 PDF 抽資料的步驟大綱，尚未讀真實檔案 |
| `tests/engine.test.mjs` | 引擎測試 |
| `robots.txt` | 全站不給爬蟲 |

字體其餘字重仍從 Google Fonts 載入 Noto Sans TC 與 Noto Serif TC。圖片與樣式都在這個倉庫裡，不連到其他網站。

## 新增一個商品

1. 讀 `DATA-SCHEMA.md`。依類型新增 `data/protection/<代號>.json` 或 `data/savings/<代號>.json`。
2. 在 `data/products.json` 的 `products` 加一筆。`file` 是相對於 `data/` 的路徑，例如 `protection/HJI.json`。`type` 用 `protection` 或 `savings`。儲蓄型再填 `kind`：`dividend` 或 `interest-sensitive`。
3. 費率、解約金、身故給付必須來自公司正式建議書或費率表。`sources` 寫檔名，`verificationSamples` 寫用來對帳的年齡、性別、年期、保額與預期年繳保費。
4. 正式檔還沒逐格對上之前，`status` 維持 `demo`。畫面上的「示範資料，非真實費率」不要拿掉。
5. `tools/extract_outline.py` 只列出抽取順序：讀 Excel 或 PDF、用樣本比對、對不上就停止、不要覆寫現有 JSON。收到正式檔之後才補實作。不要把別的網站的費率或文案貼進來。
6. 在倉庫根目錄執行 `npm test`（或 `node tests/engine.test.mjs`）。引擎規則有改的話，測試要一起更新。
7. 推上 `main`。Pages 已設定為從 `main` 根目錄發布，推上去就會更新 <https://quote-show.github.io/>。

首頁的商品清單讀的是 `data/products.json`，不用改 HTML。保障型下拉選單、儲蓄型商品與比較頁的欄位也是從這份目錄來的。
