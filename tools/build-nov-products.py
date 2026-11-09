"""Derive FPG and FBY savings JSON from the official proposal workbooks.

The workbooks stay outside the repo. This writes only the factor tables and rules.
"""

import json
import os
from copy import deepcopy

from openpyxl import load_workbook

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOADS = os.environ.get("OFFICIAL_UPLOADS", "/home/ubuntu/.cursor/projects/workspace/uploads")
FETCHED = "2026-11-09"
SOURCE = "行動辦公室 商品專區"


def load(name):
    for entry in os.listdir(UPLOADS):
        if entry.startswith(name) and entry.endswith(".xlsx"):
            return load_workbook(os.path.join(UPLOADS, entry), read_only=True, data_only=False)
    raise SystemExit(f"missing {name}")


def term_of(code):
    return int(str(code)[-2:])


def ident(code, sex, age):
    return f"{term_of(code)}|{int(sex)}|{int(age)}"


def numbers(row, start, width):
    out = []
    for value in row[start - 1:start - 1 + width]:
        if isinstance(value, bool) or value is None:
            out.append(0)
        elif isinstance(value, (int, float)):
            out.append(value)
        else:
            break
    return out


def pad(values, age, extra=2):
    need = 110 - int(age) + extra
    if len(values) < need:
        values = values + [0] * (need - len(values))
    return values[:need]


def scan(sheet, min_row, max_row, code_col, sex_col, age_col, value_start, width, scenario_col=None):
    found = {}
    for row in sheet.iter_rows(min_row=min_row, max_row=max_row, max_col=value_start + width, values_only=True):
        code = row[code_col - 1]
        if not isinstance(code, str) or not code[:3].isalpha():
            continue
        sex = row[sex_col - 1]
        age = row[age_col - 1]
        if not isinstance(sex, (int, float)) or not isinstance(age, (int, float)):
            continue
        key = ident(code, sex, age)
        values = pad(numbers(row, value_start, width), age)
        if scenario_col:
            scenario = int(row[scenario_col - 1])
            found.setdefault(key, {})[scenario] = values
        else:
            found[key] = values
    return found


def scalar(sheet, min_row, max_row):
    found = {}
    for row in sheet.iter_rows(min_row=min_row, max_row=max_row, min_col=2, max_col=11, values_only=True):
        code, _, _, _, sex, _, age, _, rate = row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[9]
        if isinstance(code, str) and isinstance(rate, (int, float)) and isinstance(sex, (int, float)):
            found[ident(code, sex, age)] = rate
    return found


def flatten(grouped):
    out = {}
    for key, scenarios in grouped.items():
        for scenario, row in scenarios.items():
            out[f"{key}|{scenario}"] = row
    return out


def nonzero(table):
    return any(any(value for value in row) for row in table.values()) if table and not isinstance(next(iter(table.values())), dict) else False


def bands(keys):
    ages = {}
    for key in keys:
        term, _sex, age = key.split("|")
        lo, hi = ages.get(term, (int(age), int(age)))
        ages[term] = (min(lo, int(age)), max(hi, int(age)))
    return {term: [lo, hi] for term, (lo, hi) in sorted(ages.items(), key=lambda item: int(item[0]))}


def split_write(meta, tables, folder):
    os.makedirs(folder, exist_ok=True)
    terms = {}
    for bucket, rows in tables.items():
        for key, value in rows.items():
            term = key.split("|")[0]
            terms.setdefault(term, {}).setdefault(bucket, {})[key] = value
    for term, part in terms.items():
        with open(os.path.join(folder, f"{term}.json"), "w", encoding="utf-8") as handle:
            json.dump(part, handle, ensure_ascii=False, separators=(",", ":"))
    meta["splitTables"] = True
    return meta


def base(code, name, kind, bands_map, limits, sources_note, extra):
    product = {
        "code": code,
        "name": name,
        "currency": "USD",
        "type": "savings",
        "status": "active",
        "kind": kind,
        "calc": "savings",
        "version": "V1.0-1151106",
        "updated": FETCHED,
        "issueAges": bands_map,
        "sex": [1, 2],
        "sumInsured": limits,
        "maxAge": 110,
        "fixedYears": None,
        "premRound": "usd-floor",
        "payYears": "term",
        "monthlySurvival": False,
        "p4a": None,
        "p4m": None,
        "assumed": None,
        "declDefault": None,
        "declLabel": None,
        "kRound": False,
        "dieRound": False,
        "isrUp": True,
        "hand": False,
        "asOf": FETCHED,
        "sources": [{
            "site": SOURCE,
            "fetched": FETCHED,
            "version": "V1.0-1151106",
            "note": sources_note,
        }],
    }
    product.update(extra)
    return product


def build_fpg(book):
    sheet = book["PDATA"]
    gp = scalar(sheet, 3, 400)
    cv = scan(sheet, 640, 947, 25, 26, 27, 29, 120)
    die = scan(sheet, 326, 633, 142, 143, 144, 146, 120)
    pvfb = scan(sheet, 952, 1260, 25, 26, 27, 29, 120)
    die2 = scan(sheet, 1264, 1572, 25, 26, 27, 29, 120)
    pvfb0 = scan(sheet, 952, 1260, 142, 143, 144, 146, 120)
    srv = scan(sheet, 3, 120, 142, 143, 144, 146, 120)
    pa = scan(sheet, 3, 310, 25, 26, 27, 29, 40)
    bonu = scan(sheet, 1578, 2193, 25, 26, 27, 30, 120, scenario_col=28)
    bonu_die = scan(sheet, 2198, 2813, 25, 26, 27, 30, 120, scenario_col=28)
    bonu_cv = scan(sheet, 2198, 2813, 143, 144, 145, 148, 120, scenario_col=146)
    print("FPG counts", len(gp), len(cv), len(die), len(pvfb), len(die2), len(pvfb0), len(srv), len(pa), len(bonu), len(bonu_die), len(bonu_cv))
    tables = {
        "gp": gp,
        "cv": cv,
        "die": die,
        "die2": die2,
        "pvfb": pvfb,
        "pvfb0": pvfb0,
        "bonu": flatten(bonu),
        "bonuDie": flatten(bonu_die),
        "bonuCv": flatten(bonu_cv),
    }
    if nonzero(srv):
        tables["srv"] = srv
        print("FPG has survival values")
    rpu = {
        "expRate": 0,
        "saOnly": True,
        "scale": False,
        "rnd": "up",
        "calc": False,
        "keys": {key: {"PA": row[:8]} for key, row in pa.items()},
    }
    by_age = {str(age): 30 if age < 16 else 600 for age in range(0, 77)}
    product = base(
        "FPG",
        "富邦人壽紅運心傳外幣分紅終身壽險",
        "dividend",
        bands(gp),
        {"min": 2, "max": 600, "byAge": by_age},
        "紅運心傳建議書 V1.0-1151106，生效 115/11/06。紅利非保證。",
        {
            "rup": True,
            "puaK": True,
            "mDiv": True,
            "finalExtra": True,
            "accRate": 0.02,
            "accUp": True,
            "srv": False,
            "isr": False,
            "isrModes": None,
            "puaOnly": False,
            "method1": "金融機構轉帳",
            "method2": "金融機構轉帳",
            "discountFormulas": {
                "high": "IIF(AND(S>=10,term==3),0.01,IIF(AND(S>=15,term==5),0.01,0))",
                "cap": "0.02",
                "methods": {
                    "金融機構轉帳": "IIF(term==1,0,0.01)",
                    "外幣匯款": "IIF(term==1,0,IIF(m2=='金融機構轉帳',0.01,0))",
                    "匯款": "IIF(term==1,0,IIF(m2=='金融機構轉帳',0.01,0))",
                    "富邦信用卡": "0",
                    "一般信用卡": "0",
                    "自行繳費": "0",
                    "支票": "0",
                },
            },
            "rpu": rpu,
        },
    )
    return split_write(product, tables, os.path.join(ROOT, "data/savings/FPG"))


def build_fby(book):
    sheet = book["PDATA"]
    gp = scalar(sheet, 3, 200)
    cv = scan(sheet, 256, 375, 14, 15, 16, 18, 120)
    die = scan(sheet, 131, 250, 141, 142, 143, 145, 120)
    # Purchase factors start with year 0 so index `year` is that policy year.
    pvfb = scan(sheet, 381, 500, 14, 15, 16, 18, 120)
    die2 = scan(sheet, 505, 624, 14, 15, 16, 18, 120)
    pvfb0 = scan(sheet, 381, 500, 141, 142, 143, 145, 120)
    pv = scan(sheet, 505, 624, 141, 142, 143, 145, 120)
    srv = scan(sheet, 3, 118, 141, 142, 143, 145, 80)
    pa = scan(sheet, 3, 122, 14, 15, 16, 18, 20)
    print("FBY counts", len(gp), len(cv), len(die), len(pvfb), len(die2), len(pvfb0), len(pv), len(srv), len(pa))
    tables = {"gp": gp, "cv": cv, "die": die, "die2": die2, "pvfb": pvfb, "pvfb0": pvfb0, "pv": pv}
    if nonzero(srv):
        tables["srv"] = srv
        print("FBY has survival values")
    by_age = {}
    for age in range(18, 78):
        by_age[str(age)] = 100 if age < 51 else 150 if age < 61 else 200
    product = base(
        "FBY",
        "富邦人壽永裕一生外幣利率變動型終身壽險",
        "interest-sensitive",
        bands(gp),
        {"min": 10, "max": 200, "byAge": by_age},
        "永裕一生建議書 V1.0-1151106，生效 115/11/06。宣告利率 115年10月 4.35%，可改。",
        {
            "rup": False,
            "puaK": False,
            "mDiv": False,
            "finalExtra": True,
            "accRate": 0,
            "accUp": False,
            "srv": False,
            "isr": True,
            "isrModes": ["PS", "PC", "PUA"],
            "defaultMode": "PS",
            "puaOnly": False,
            "p4a": 16,
            "p4m": 6,
            "assumed": 0.0175,
            "declDefault": 0.0435,
            "declLabel": "115年10月",
            "method1": "金融機構轉帳",
            "method2": "自行繳費",
            "discountFormulas": {
                "high": "0",
                "cap": "0.02",
                "methods": {
                    "金融機構轉帳": "IIF(term==1,0,0.01)",
                    "外幣匯款": "IIF(term==1,0,IIF(m2=='金融機構轉帳',0.01,0))",
                    "匯款": "IIF(term==1,0,IIF(m2=='金融機構轉帳',0.01,0))",
                    "富邦信用卡": "0",
                    "一般信用卡": "0",
                    "自行繳費": "0",
                    "支票": "0",
                },
            },
            "rpu": {
                "expRate": 0,
                "saOnly": True,
                "scale": False,
                "rnd": "up",
                "calc": False,
                "keys": {key: {"PA": row[:6]} for key, row in pa.items()},
            },
        },
    )
    return split_write(product, tables, os.path.join(ROOT, "data/savings/FBY"))


def main():
    fpg_book = load("FPG")
    fpg = build_fpg(fpg_book)
    fpg_book.close()
    fby_book = load("FBY")
    fby = build_fby(fby_book)
    fby_book.close()
    for product in (fpg, fby):
        # rpu keys are large; keep them on the meta file so the page can offer 減額繳清 without loading every term twice.
        path = os.path.join(ROOT, "data/savings", f"{product['code']}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(product, handle, ensure_ascii=False, separators=(",", ":"))
        print("wrote", path, "ages", product["issueAges"])
    catalog_path = os.path.join(ROOT, "data/products.json")
    catalog = json.loads(open(catalog_path, encoding="utf-8").read())
    catalog["products"] = [item for item in catalog["products"] if item["code"] not in ("FPG", "FBY")]
    for product, kind in ((fpg, "dividend"), (fby, "interest-sensitive")):
        catalog["products"].append({
            "code": product["code"],
            "name": product["name"],
            "type": "savings",
            "kind": kind,
            "currency": "USD",
            "status": "active",
            "file": f"savings/{product['code']}.json",
        })
    catalog["products"].sort(key=lambda item: item["code"])
    catalog["updated"] = FETCHED
    with open(catalog_path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    index_path = os.path.join(ROOT, "data/savings-index.json")
    index = json.loads(open(index_path, encoding="utf-8").read())
    index = [item for item in index if item["code"] not in ("FPG", "FBY")]
    for product, kind in ((fpg, "dividend"), (fby, "interest-sensitive")):
        index.append({
            "code": product["code"],
            "name": product["name"].replace("富邦人壽", ""),
            "currency": "USD",
            "kind": kind,
            "calc": "savings",
            "bands": [{"term": int(term), "min": band[0], "max": band[1]} for term, band in product["issueAges"].items()],
            "survival": False,
            "annuity": False,
            "monthly": False,
            "payToAge": False,
        })
    index.sort(key=lambda item: item["code"])
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
