#!/usr/bin/env python3
"""從公司檔案抽出費率的腳本大綱。目前不讀任何真實檔案。

之後 Show 提供檔案時，才補上真正的讀取：
1. 建議書 Excel：讀指定工作表，寫出每萬保費、解約金、身故給付與紅利情境。
2. 費率表 PDF：讀表格，寫出年期、性別、年齡對應的費率。
3. 用 verificationSamples 裡的年齡、性別、年期、保額逐格比對。對不上就停止，不覆寫現有 JSON。
4. 寫入 data/protection/<code>.json 或 data/savings/<code>.json，並更新 data/products.json 的版本與日期。

不要把第三方網站的費率或文案貼進這個檔案。
"""

from __future__ import annotations


def extract_workbook(path: str, code: str) -> dict:
    raise NotImplementedError(f"尚未實作。收到正式建議書後才讀 {path}（{code}）")


def extract_rate_pdf(path: str, code: str) -> dict:
    raise NotImplementedError(f"尚未實作。收到正式費率表後才讀 {path}（{code}）")


def verify_samples(product: dict, samples: list[dict]) -> None:
    raise NotImplementedError("尚未實作。樣本與計算結果不一致時應中止。")


if __name__ == "__main__":
    print("這是抽取程式的大綱，不會讀檔，也不會寫入費率。")
