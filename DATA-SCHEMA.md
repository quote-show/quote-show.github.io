# 報價資料格式

每個商品一個 JSON。目錄在 `data/products.json`。保障型放 `data/protection/`，儲蓄型放 `data/savings/`。數字上線前必須來自公司正式檔案，並用 `verificationSamples` 對過。

示範檔的費率是整數，畫面上會標「示範資料，非真實費率」。

## 目錄 `data/products.json`

| 欄位 | 說明 |
| --- | --- |
| `version` | 這包資料的版本 |
| `updated` | `YYYY-MM-DD` |
| `products[]` | `code`、`name`、`type`（`protection` 或 `savings`）、`kind`（`dividend` 或 `interest-sensitive`，儲蓄型才有）、`currency`、`status`（`demo` / `active` / `stopped`）、`file` |

## 商品共通欄位

| 欄位 | 說明 |
| --- | --- |
| `code` | 代號，英文與數字 |
| `name` | 顯示名稱 |
| `currency` | `TWD` 或 `USD` |
| `type` | `protection` 或 `savings` |
| `status` | `demo`、`active`、`stopped`。已對過參考試算的商品是 `active`，頁面不標「示範資料」 |
| `launch` / `stop` | 上架日、停售日，停售日沒有就 `null` |
| `version` | 資料版本 |
| `updated` | 這份檔案的日期 |
| `unit` | 費率的單位保額。保障型示範是每 10000 元 |
| `sex` | 可投保性別，`1` 男、`2` 女 |
| `sources` | `site`（參考站）、`fetched`（抓取日）、`version`（費率版本或生效日）、`note` |
| `verificationSamples` | 至少 3 組年齡、性別、年期、保額，以及對過的年繳或解約金 |

## 保障型

| 欄位 | 說明 |
| --- | --- |
| `issueAges` | 年期對 `[最低年齡, 最高年齡]` |
| `sumInsured` | `min`、`max`、`step` |
| `occupation` | 職業類別 `min`、`max`，1 到 6 |
| `discounts.highSum` | `[[保額門檻, 折扣小數], …]`，達到門檻才適用最高那一階 |
| `discounts.pay` | 繳費方式折扣 |
| `discounts.cap` | 折扣合計上限 |
| `modeFactors` | `annual`、`semi`、`quarterly`、`monthly` |
| `rates` | 鍵是 `年期|性別`，值是年齡對每單位費率。缺的年齡用相鄰兩點直線內插 |
| `riders[]` | 可附加附約。含自己的 `unit`、`issueAges`、`occupation`、`sumInsured`、`rates`（鍵是性別） |
| `waiver` | `ratePer10k` 的鍵是 `年期|性別`，費率是每萬元被豁免年繳保費 |

保費：`round(單位數 × 費率)` 為年繳，再乘繳別係數後四捨五入，最後乘上 `(1 − min(折扣合計, 上限))`。

豁免：被豁免的主約與附約年繳保費合計 ÷ 10000 × 每萬費率。

## 儲蓄型

| 欄位 | 說明 |
| --- | --- |
| `kind` | `dividend` 或 `interest-sensitive` |
| `terms` | 年期對 `[最低年齡, 最高年齡]` |
| `premiumRates` | 鍵是 `年期|性別`，值是年齡對每單位年繳保費 |
| `perUnitByYear.cashValue` | 第 1 年起，每單位年末解約金 |
| `perUnitByYear.deathBenefit` | 第 1 年起，每單位身故給付 |
| `dividendPerUnit` | 分紅才有。`mid`、`low` 兩組，按年加進解約金與身故給付 |
| `pricingRate` / `declaredRate` | 利變才有。回饋用 `max(宣告利率 − 預定利率, 0) × 解約金`，這是骨架算法 |

可改輸入保額，或改輸入年繳保費（保額 = 保費 ÷ 每單位費率 × 單位）。

逐年表的內部報酬率：保費在年初，最後一年解約金在年末，先牛頓法，不收斂就二分法。回本年度是解約金第一次大於等於累計保費的年度。壽險倍數是身故給付 ÷ 累計保費。

## 已轉入的商品

`calc` 決定算法：`protection` 主約、`rider`／`plan`／`tmr`／`waiver` 附約與豁免、`band` 只有年齡帶保費、`savings` 儲蓄型逐年表。儲蓄型另有 `kind`：`dividend`、`interest-sensitive`、`fixed`。

`calc` 另外可以是 `fbo`（美利大運：前幾年增額繳清，其後儲存生息，宣告利率可改）或 `annuity`（即期年金月給付，附加費用與年金因子，宣告利率可改）。`band` 若有 `modeFactors`，年繳保費再乘繳別係數。停售商品的 `status` 是 `stopped`，`stop` 是停售日。

對不上或抽不完整的商品記在 `data/skipped.json`，不放進目錄。

## 抽取程式

`tools/extract_outline.py` 只寫步驟，不讀真實 Excel 或 PDF。`tools/import-reference.mjs` 會把已經下載的參考站費率轉成上面的 JSON，並用參考站自己的計算核對至少 3 組。對不上的不寫入。
