"""Build derived JSON for the official Fubon workbooks. Does not copy the workbooks."""

import json
import math
import os
from calendar import monthrange
from datetime import date
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
import formulas

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOADS = os.environ.get(
    "OFFICIAL_UPLOADS",
    "/home/ubuntu/.cursor/projects/workspace/uploads",
)
FETCHED = "2026-11-03"


def files():
    found = {}
    for name in os.listdir(UPLOADS):
        path = os.path.join(UPLOADS, name)
        if name.startswith("FBO") and name.endswith(".xlsx"):
            found["FBO"] = path
        elif name.startswith("SAZ") and name.endswith(".xlsx"):
            found["SAZ"] = path
        elif name.startswith("SBA") and name.endswith(".xlsx"):
            found["SBA"] = path
        elif name.startswith("SBC") and name.endswith(".xlsx"):
            found["SBC"] = path
    missing = [code for code in ("FBO", "SAZ", "SBA", "SBC") if code not in found]
    if missing:
        raise SystemExit(f"missing workbooks: {missing}")
    return found


def series(row, start, count=115):
    out = []
    for value in row[start:start + count]:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out.append(value)
        elif value is None:
            out.append(0)
        else:
            break
    while out and out[-1] == 0:
        out.pop()
    return out


def parse_fbo_key(key):
    if not isinstance(key, str) or len(key) != 9 or not key.startswith("FBO"):
        return None
    return int(key[3:5]), int(key[5:7]), int(key[7:9])


def load_fbo(path):
    book = load_workbook(path, data_only=True, read_only=True)
    sheet = book["PDATA"]
    buckets = {}
    rates = {}
    for index, row in enumerate(sheet.iter_rows(min_row=1, max_row=2260, values_only=True), 1):
        cells = list(row)
        if len(cells) < 20:
            continue
        rate_key = cells[9] if len(cells) > 10 else None
        parsed = parse_fbo_key(rate_key)
        if parsed and isinstance(cells[10], (int, float)):
            rates[parsed] = cells[10]
        key = cells[16] if len(cells) > 16 else None
        other = cells[133] if len(cells) > 133 else None
        parsed_key = parse_fbo_key(key)
        parsed_other = parse_fbo_key(other)
        if 3 <= index <= 448 and parsed_key:
            buckets.setdefault(parsed_key, {})["pa"] = series(cells, 17)
        elif 907 <= index <= 1353 and parsed_key:
            buckets.setdefault(parsed_key, {})["cv"] = series(cells, 17)
        elif 1360 <= index <= 1805 and parsed_key:
            buckets.setdefault(parsed_key, {})["pvfb"] = series(cells, 17)
            if parsed_other:
                buckets.setdefault(parsed_other, {})["pvfb0"] = series(cells, 134)
        elif 453 <= index <= 898 and parsed_other:
            buckets.setdefault(parsed_other, {})["die"] = series(cells, 134)
        elif 1809 <= index <= 2254 and parsed_key:
            buckets.setdefault(parsed_key, {})["die2"] = series(cells, 17)
            if parsed_other:
                buckets.setdefault(parsed_other, {})["pv"] = series(cells, 134)
    limits = {}
    op = book["OP"]
    for row in op.iter_rows(min_row=72, max_row=160, min_col=8, max_col=9, values_only=True):
        age, cap = row
        if isinstance(age, int) and isinstance(cap, (int, float)):
            limits[str(age)] = cap
    rate_sheet = book["RDATA"]
    declared = None
    label = None
    for row in rate_sheet.iter_rows(min_row=2, max_row=2, max_col=10, values_only=True):
        label = str(row[0]).strip()
        declared = row[8]
    book.close()
    same = 0
    tables = {"gp": {}, "cv": {}, "die": {}, "die2": {}, "pv": {}, "pvfb": {}}
    for key, rate in rates.items():
        block = buckets.get(key, {})
        needed = ("cv", "die", "die2", "pv", "pvfb")
        if any(not block.get(name) for name in needed):
            continue
        ident = f"{key[0]}|{key[1]}|{key[2]}"
        tables["gp"][ident] = rate
        for name in needed:
            tables[name][ident] = block[name]
        if block.get("pvfb0") == block.get("pvfb"):
            same += 1
        elif block.get("pvfb0"):
            tables.setdefault("pvfb0", {})[ident] = block["pvfb0"]
    print(f"FBO keys {len(tables['gp'])} pvfb0 same {same} declared {declared} {label} limits {len(limits)}")
    return tables, limits, declared, label


def r10(value):
    return math.floor(value * 1e10 + 0.5) / 1e10


def cu(value):
    return math.ceil(value - 1e-9)


def up10(value):
    return math.ceil(round(value * 1e13) / 1e3 - 1e-8) / 1e10


def r3(value):
    return math.floor(value * 1000 + 0.5) / 1000


def round_down(value, places):
    scale = 10 ** places
    return math.floor(value * scale + 1e-8) / scale


def project_fbo(tables, age, sex, term, sum_wan, declared, mode="PS"):
    ident = f"{term}|{sex}|{age}"
    pricing = {2: 0.015, 6: 0.0225, 8: 0.0225}[term]
    diff = max(0, round(round(max(declared, pricing), 4) - pricing, 5))
    cv, die, die2 = tables["cv"][ident], tables["die"][ident], tables["die2"][ident]
    pv, pvfb = tables["pv"][ident], tables["pvfb"][ident]
    pvfb0 = tables.get("pvfb0", {}).get(ident, pvfb)
    years = 110 - age + 1
    lock = years if mode == "PUA" else max(16 - age, 6)
    paid = 0
    box = 0.0
    fraction = 0.0
    history = []
    balance = 0
    anchor = date(2026, 10, 1)
    rows = []
    for year in range(1, years + 1):
        part = up10(pv[year - 1] * sum_wan * diff)
        extra = 0 if year == 1 else up10(r3(paid / 1e4 * pvfb[year]) * diff)
        feedback = cu(part) if year == 1 else cu(part) + cu(extra)
        if year <= lock and pvfb[year]:
            paid += math.floor(feedback / (pvfb[year] / 1e4) + 0.5)
        death_add = cu(die2[year - 1] * paid / 1e4)
        cash_add = cu(r3(paid / 1e4 * pvfb0[year]))
        base_death = cu(die[year - 1] * sum_wan)
        base_cash = cu(cv[year - 1] * sum_wan)
        booked = 0
        for month in range(12):
            index = (year - 1) * 12 + month
            cursor = date(anchor.year + (anchor.month - 1 + index) // 12, (anchor.month - 1 + index) % 12 + 1, 1)
            dim = monthrange(cursor.year, cursor.month)[1]
            rate = r10(declared * dim / 365)
            incoming = (part + extra) if month == 11 and year > lock and mode == "PS" else 0
            raw = box + fraction + incoming
            digits = len(str(int(abs(raw)))) if abs(raw) >= 1 else 1
            places = 10 if digits <= 5 else max(0, 15 - digits)
            box = round_down(raw, places)
            if month == 11 and year > lock and mode == "PS":
                booked = cu(sum(history[-12:])) if history else 0
            fraction = r10(box * rate)
            history.append(fraction)
        if year > lock and mode == "PS":
            balance += feedback + booked
        rows.append({
            "K": feedback,
            "N": paid,
            "store": balance if mode == "PS" else 0,
            "W": base_death + death_add + (balance if mode == "PS" else 0),
            "X": base_cash + cash_add + (balance if mode == "PS" else 0),
        })
    return rows


def excel_round(value, digits):
    model = formulas.ExcelModel().loads(_round_book(value, digits)).finish().calculate()
    for key, item in model.items():
        if str(key).endswith("A3"):
            return float(item.value[0][0])
    raise RuntimeError("formula engine missed the rounded cell")


_BOOKS = {}


def _round_book(value, digits):
    # Cached per digits so the engine compiles once, then values are passed directly below.
    return _BOOKS[digits]


def build_round_books():
    for digits in (0, 2, 7, 10):
        book = Workbook()
        sheet = book.active
        sheet.title = "C"
        sheet["A1"] = 0
        sheet["A2"] = digits
        sheet["A3"] = "=ROUND(A1,A2)"
        path = f"/tmp/round-{digits}.xlsx"
        book.save(path)
        _BOOKS[digits] = path


def annuity_payments(premium, loading, load_digits, factor, declared, pricing, show_digits, count):
    """Excel ROUND / power formulas, evaluated by the formulas engine."""
    book = Workbook()
    sheet = book.active
    sheet.title = "C"
    sheet["A1"] = premium
    sheet["A2"] = loading
    sheet["A3"] = f"=ROUND(A1*A2,{load_digits})"
    sheet["A4"] = "=A1-A3"
    sheet["A5"] = factor
    sheet["A6"] = declared
    sheet["A7"] = pricing
    sheet["A8"] = "=ROUND(((1+A6)/(1+A7))^(1/12),7)"
    sheet["A9"] = "=A4/A5"
    sheet["B1"] = f"=ROUND(A9*A8,{2})"
    for month in range(2, count + 1):
        sheet.cell(month, 2, f"=ROUND(B{month - 1}*$A$8,2)")
    path = "/tmp/annuity-case.xlsx"
    book.save(path)
    model = formulas.ExcelModel().loads(path).finish().calculate()
    values = []
    for month in range(1, count + 1):
        cell = model[f"'[annuity-case.xlsx]C'!B{month}"]
        pay = float(cell.value[0][0])
        if show_digits == 0:
            pay = float(round(pay))
        values.append(pay)
    return values


def scan_inputs(path):
    book = load_workbook(path, data_only=True, read_only=True)
    page = book["輸入頁"]
    found = {}
    for row in page.iter_rows(max_row=45, max_col=16, values_only=False):
        for cell in row:
            if not hasattr(cell, "column") or not isinstance(cell.value, str):
                continue
            if any(word in cell.value for word in ("繳費金額", "保險年齡", "性別", "年金給付", "宣告")):
                found[cell.coordinate] = cell.value
    calc = book["年金計算"]
    cached = {}
    for row in calc.iter_rows(min_row=1, max_row=16, max_col=13, values_only=False):
        for cell in row:
            if not hasattr(cell, "column") or cell.value is None:
                continue
            letter = get_column_letter(cell.column)
            if letter in list("ABCDEFKL"):
                cached[f"{letter}{cell.row}"] = cell.value
    book.close()
    formula_book = load_workbook(path, data_only=False, read_only=True)
    formulas_map = {}
    calc = formula_book["年金計算"]
    for row in calc.iter_rows(min_row=1, max_row=15, max_col=12, values_only=False):
        for cell in row:
            if not hasattr(cell, "column"):
                continue
            letter = get_column_letter(cell.column)
            if letter in ("E", "L", "C") and isinstance(cell.value, str) and cell.value.startswith("="):
                formulas_map[f"{letter}{cell.row}"] = cell.value
    op = formula_book["OP"]
    op_values = {}
    for row in op.iter_rows(min_row=15, max_row=75, max_col=10, values_only=False):
        label = row[1].value if hasattr(row[1], "value") else None
        value = row[2].value if hasattr(row[2], "value") else None
        if isinstance(label, str):
            op_values[label] = value
    rate = formula_book["RDATA"]
    meta = {}
    for row in rate.iter_rows(min_row=1, max_row=2, max_col=10, values_only=True):
        meta["row"] = row
    formula_book.close()
    return cached, formulas_map, op_values, meta


def factor_map(path, code):
    book = load_workbook(path, data_only=True, read_only=True)
    sheet = book["年金因子"]
    factors = {}
    ages = set()
    for row in sheet.iter_rows(min_row=6, max_row=2000, max_col=11, values_only=True):
        if not row or row[0] != code:
            continue
        sex = row[1]
        age = row[2]
        mode = row[8]
        factor = row[10]
        if mode != "M" or not isinstance(factor, (int, float)):
            continue
        if sex in ("M", "F"):
            sex = 1 if sex == "M" else 2
        factors[f"{age}|{sex}|M"] = factor
        ages.add(age)
    book.close()
    return factors, (min(ages), max(ages) if ages else None)


def show_digits(formula):
    if formula and ",0)" in formula.replace(" ", ""):
        return 0
    return 2


def load_digits(formula):
    if formula and ",0)" in formula.replace(" ", ""):
        return 0
    return 2


def build_annuity(code, path, source_name, currency, version, name, note):
    factors, age_band = factor_map(path, code)
    cached, formula_map, _op, meta = scan_inputs(path)
    pricing = None
    declared = None
    loading = None
    book = load_workbook(path, data_only=True, read_only=True)
    op = book["OP"]
    values = {}
    for row in op.iter_rows(min_row=15, max_row=75, min_col=9, max_col=9, values_only=False):
        for cell in row:
            if hasattr(cell, "column"):
                values[f"I{cell.row}"] = cell.value
    rate = book["RDATA"]
    label = None
    for row in rate.iter_rows(min_row=2, max_row=2, max_col=9, values_only=True):
        label = str(row[0]).strip()
        declared = row[8]
    pricing = values.get("I18")
    loading = values.get("I21")
    book.close()
    load_d = load_digits(formula_map.get("E3"))
    show_d = show_digits(formula_map.get("L15"))
    print(code, "factors", len(factors), "ages", age_band, "decl", declared, label, "price", pricing, "load", loading, "digits", load_d, show_d)
    print("  cache", {k: cached.get(k) for k in ("E1", "E2", "E3", "C3", "C8", "C9", "C13", "F10", "K15", "K16", "L15", "L16", "C2", "C4")})
    return {
        "factors": factors,
        "ages": age_band,
        "declared": declared,
        "label": label,
        "pricing": pricing,
        "loading": loading,
        "loadDigits": load_d,
        "showDigits": show_d,
        "currency": currency,
        "version": version,
        "name": name,
        "note": note,
        "source": source_name,
    }


def excel_round_py(value, digits):
    scale = 10 ** digits
    return math.floor(abs(value) * scale + 0.5) / scale * (1 if value >= 0 else -1)


def annuity_stream(premium, loading, load_digits, factor, declared, pricing, show_digits, count):
    charge = excel_round_py(premium * loading, load_digits)
    net = premium - charge
    adjust = excel_round_py(((1 + declared) / (1 + pricing)) ** (1 / 12), 7)
    pay = excel_round_py(net / factor * adjust, 2)
    shown = []
    for _ in range(count):
        shown.append(excel_round_py(pay, show_digits))
        pay = excel_round_py(pay * adjust, 2)
    return shown


def annuity_samples(info, code, minimum, load_digits, show_digits, pay_years):
    defaults = {
        "SAZ": (16, 2, 60000, 138.87, 139.05),
        "SBA": (49, 1, 2000000, 5444, 5447),
        "SBC1": (7, 2, 30000, 188.96, 189.2),
    }
    declared = info["declared"]
    pricing = info["pricing"]
    if code in defaults:
        age, sex, premium, first, second = defaults[code]
        factor = info["factors"][f"{age}|{sex}|M"]
        stream = annuity_stream(premium, info["loading"], load_digits, factor, declared, pricing, show_digits, 12)
        if (stream[0], stream[1]) != (first, second):
            raise SystemExit(f"{code} cache mismatch {stream[:2]} != {(first, second)}")
        engine = annuity_payments(premium, info["loading"], load_digits, factor, declared, pricing, show_digits, 2)
        if engine != stream[:2]:
            raise SystemExit(f"{code} formula engine {engine} != {stream[:2]}")
        cases = [(age, sex, premium, declared)]
    else:
        cases = []
    extras = {
        "SAZ": [(40, 1, 100000, declared), (60, 2, 80000, 0.035)],
        "SBA": [(30, 2, 3000000, declared), (70, 1, 5000000, 0.03)],
        "SBC1": [(40, 1, 50000, declared), (60, 2, 100000, 0.035)],
        "SBC2": [(7, 2, 30000, declared), (40, 1, 50000, declared), (60, 2, 80000, 0.03)],
        "SBC3": [(7, 2, 30000, declared), (25, 1, 40000, declared), (55, 2, 90000, 0.045)],
    }
    cases.extend(extras[code])
    samples = []
    years = pay_years or 10
    horizon = min(10, years)
    for age, sex, premium, rate in cases[:3]:
        factor = info["factors"].get(f"{age}|{sex}|M")
        if factor is None:
            raise SystemExit(f"{code} missing factor {age}|{sex}")
        count = horizon * 12
        stream = annuity_stream(premium, info["loading"], load_digits, factor, rate, pricing, show_digits, count)
        samples.append({
            "age": age, "sex": sex, "term": 1, "sum": premium, "declaredRate": rate, "mode": "M",
            "expect": {
                "payable": premium,
                "renewal": 0,
                "firstPayment": stream[0],
                "month2": stream[1],
                "surrender10": round(sum(stream), 2),
            },
        })
    return samples


def write_mgd2():
    bands = [
        (15, 24, [1127, 2250, 4502]),
        (25, 34, [2081, 4158, 8319]),
        (35, 39, [2689, 5381, 10760]),
        (40, 44, [4285, 8568, 17135]),
        (45, 49, [6320, 12639, 25381]),
        (50, 54, [9622, 19242, 38486]),
        (55, 59, [13370, 26743, 53489]),
        (60, 64, [19016, 38030, 76064]),
        (65, 70, [30191, 60383, 120763]),
    ]
    plans = ["計畫一", "計畫二", "計畫三"]
    premiums = {}
    for start, end, rates in bands:
        for age in range(start, end + 1):
            for sex in (1, 2):
                for plan, rate in zip(plans, rates):
                    premiums[f"{plan}|{age}|{sex}"] = rate
    product = {
        "code": "MGD2",
        "name": "富邦人壽金安心健康一年定期保險",
        "currency": "TWD",
        "type": "protection",
        "status": "stopped",
        "category": "健康險",
        "role": "main",
        "calc": "band",
        "version": "1050101",
        "updated": FETCHED,
        "launch": None,
        "stop": "2021-01-01",
        "unitKind": "plan",
        "sex": [1, 2],
        "occupation": {"min": 1, "max": 4},
        "plans": plans,
        "issueAges": {"plans": [{"name": plan, "min": 15, "max": 70} for plan in plans]},
        "modeFactors": {"annual": 1, "semi": 0.52, "quarterly": 0.262, "monthly": 0.088},
        "premiums": premiums,
        "benefits": ["計畫一：壽險 50 萬、重大疾病 50 萬", "計畫二：壽險 100 萬、重大疾病 100 萬", "計畫三：壽險 200 萬、重大疾病 200 萬"],
        "rule": "停售。新契約投保年齡 15 足歲至 60 歲，費率表列到 70 歲供續保參考。職業限 1–4 類，費率不分性別與職業。不得附加附約。",
        "note": "年繳保費依費率表的年齡帶。半年、季、月繳乘投保規則的繳別係數後四捨五入。",
        "cover": "一年，可續保至 70 歲",
        "sources": [{
            "site": "富邦人壽商品專區",
            "fetched": FETCHED,
            "version": "費率表；投保規則 105.01.01",
            "note": "停售日 110/01/01。年繳數字直接讀自費率表。",
        }],
        "verificationSamples": [
            {"age": 15, "sex": 1, "occupation": 1, "plan": "計畫一", "mode": "annual", "expect": {"annual": 1127, "payable": 1127}},
            {"age": 35, "sex": 2, "occupation": 2, "plan": "計畫二", "mode": "annual", "expect": {"annual": 5381, "payable": 5381}},
            {"age": 60, "sex": 1, "occupation": 4, "plan": "計畫三", "mode": "annual", "expect": {"annual": 76064, "payable": 76064}},
            {"age": 70, "sex": 2, "occupation": 1, "plan": "計畫一", "mode": "annual", "expect": {"annual": 30191, "payable": 30191}},
        ],
    }
    os.makedirs(os.path.join(ROOT, "data/protection"), exist_ok=True)
    with open(os.path.join(ROOT, "data/protection/MGD2.json"), "w", encoding="utf-8") as handle:
        json.dump(product, handle, ensure_ascii=False, separators=(",", ":"))


def update_catalog(rows):
    path = os.path.join(ROOT, "data/products.json")
    catalog = json.load(open(path, encoding="utf-8"))
    codes = {row["code"] for row in rows}
    catalog["products"] = [item for item in catalog["products"] if item["code"] not in codes]
    catalog["products"].extend(rows)
    catalog["updated"] = FETCHED
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_skipped():
    rows = [
        {"code": "QNY", "name": "青年好Young", "reason": "Show 指定略過。DM 沒有印好的保費，頁面標另計"},
        {"code": "DAA", "name": "喜轉年年遞延年金", "reason": "試算表是既有保單轉入遞延年金（原保單日、轉換日、年金開始年齡連動），給付不是獨立的新契約公式，不另估"},
        {"code": "SAU", "name": "金滿富利利變年金甲型", "reason": "彈性繳帳戶含部分提領與額外保費的月迴圈，工作簿沒有可分離的封閉公式，不估"},
        {"code": "UWA2", "name": "金好運萬能終身壽險", "reason": "萬能壽險按月扣危險保費與費用，帳戶依週月日計息，這份試算沒有逐月對上快取值，不估"},
    ]
    with open(os.path.join(ROOT, "data/skipped.json"), "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main():
    paths = files()
    fbo_tables, limits, declared, label = load_fbo(paths["FBO"])
    rows = project_fbo(fbo_tables, 39, 1, 2, 10, 0.0435, "PS")
    gold = {
        1: (316, 1276, 0),
        7: (877, 16580, 877),
        10: (898, 16580, 3793),
        12: (911, 16580, 5994),
    }
    for year, (feedback, paid, store) in gold.items():
        got = rows[year - 1]
        if (got["K"], got["N"], got["store"]) != (feedback, paid, store):
            raise SystemExit(f"FBO cache mismatch year {year}: {got}")
    print("FBO default cache matched", rows[9]["W"], rows[9]["X"])
    os.makedirs(os.path.join(ROOT, "data/savings"), exist_ok=True)
    product = {
        "code": "FBO",
        "name": "富邦人壽美利大運外幣利率變動型終身壽險",
        "currency": "USD",
        "type": "savings",
        "status": "active",
        "kind": "interest-sensitive",
        "calc": "fbo",
        "version": "V1.6-1150901",
        "updated": FETCHED,
        "issueAges": {"2": [16, 74], "6": [16, 74], "8": [16, 72]},
        "sex": [1, 2],
        "sumInsured": {"min": 1, "max": 200, "step": 0.1, "byAge": {age: limits[age] for age in limits if int(age) >= 16}},
        "maxAge": 110,
        "lockYears": 6,
        "lockAge": 16,
        "modes": ["PS", "PUA"],
        "defaultMode": "PS",
        "method1": "匯款",
        "method2": "金融機構轉帳",
        "handDiscount": {
            "remit": "匯款",
            "high": [
                {"term": 2, "tiers": [[25, 0.01], [15, 0.005]]},
                {"tiers": [[60, 0.03], [50, 0.02], [20, 0.01]]},
            ],
            "caps": [{"term": 2, "value": 0.02}, {"value": 0.04}],
        },
        "pricing": {"2": 0.015, "6": 0.0225, "8": 0.0225},
        "declDefault": declared,
        "declLabel": label,
        "quoteDate": "2026-09-01",
        "policyMonth": "2026-10-01",
        "sumLabel": "保額（萬美元）",
        "isr": True,
        "tables": fbo_tables,
        "sources": [{
            "site": "富邦人壽商品專區",
            "fetched": FETCHED,
            "version": "建議書 V1.6-1150901",
            "note": f"宣告利率 {declared:.2%}（{label}，試算日 2026-09-01）。未滿 16 歲的保費抵繳不在這支試算。",
        }],
        "rule": "第 1 到第 6 保單年度的增值回饋只購買增額繳清；其後預設儲存生息。宣告利率可改，預定利率隨年期固定。",
        "verificationSamples": [],
    }
    # Three cases. Year-10 values for the saved illustration are the workbook cache.
    product["verificationSamples"].append({
        "age": 39, "sex": 1, "term": 2, "sum": 10, "declaredRate": 0.0435, "mode": "PS",
        "expect": {"payable": 14652, "renewal": 14652, "surrender10": rows[9]["X"], "death10": rows[9]["W"], "feedback1": 316, "store7": 877, "store10": 3793},
    })
    for case in (
        {"age": 30, "sex": 2, "term": 6, "sum": 20, "declaredRate": 0.0435, "mode": "PS"},
        {"age": 50, "sex": 1, "term": 8, "sum": 15, "declaredRate": 0.04, "mode": "PUA"},
    ):
        projected = project_fbo(fbo_tables, case["age"], case["sex"], case["term"], case["sum"], case["declaredRate"], case["mode"])
        case = dict(case)
        case["expect"] = {
            "surrender10": projected[9]["X"],
            "death10": projected[9]["W"],
            "feedback1": projected[0]["K"],
            "store10": projected[9]["store"],
        }
        product["verificationSamples"].append(case)
    with open(os.path.join(ROOT, "data/savings/FBO.json"), "w", encoding="utf-8") as handle:
        json.dump(product, handle, ensure_ascii=False, separators=(",", ":"))
    print("wrote FBO", os.path.getsize(os.path.join(ROOT, "data/savings/FBO.json")))
    specs = [
        ("SAZ", "SAZ", "USD", "V1.6-1150901", "富邦人壽享美鑫外幣利率變動型即期年金保險（乙型）", "月給付。附加費用率 5.5%，預定利率 2.5%。"),
        ("SBA", "SBA", "TWD", "V1.5-1140826", "富邦人壽鑫樂悠利率變動型即期年金保險（乙型）", "月給付。附加費用率 5.5%，預定利率 2.0%。"),
        ("SBC1", "SBC", "USD", "V1.2-1150901", "富邦人壽鑫享外幣利率變動型即期年金保險（乙型，15 年保證）", "SBC1，月給付。保證期間 10 年，年金給付期間 15 年的費率因子。"),
        ("SBC2", "SBC", "USD", "V1.2-1150901", "富邦人壽鑫享外幣利率變動型即期年金保險（乙型，20 年保證）", "SBC2，月給付。保證期間 15 年。"),
        ("SBC3", "SBC", "USD", "V1.2-1150901", "富邦人壽鑫享外幣利率變動型即期年金保險（乙型，25 年保證）", "SBC3，月給付。保證期間 20 年。"),
    ]
    # Fix names after reading guarantee from workbook if needed. Keep the labels above as the product names used on the proposal.
    limits = {
        "SAZ": (60000, 3000000, 2, 2, None, "5.5% 附加費用，預定利率 2.5%，月給付至保險年齡 110 歲。"),
        "SBA": (1800000, 90000000, 0, 0, None, "5.5% 附加費用，預定利率 2.0%，月給付至保險年齡 110 歲。保證期間 30 年已含在年金因子。"),
        "SBC1": (30000, 3000000, 2, 2, 15, "保險期間 15 年、保證期間 10 年。5.5% 附加費用，預定利率 2.5%，只給付 15 年。"),
        "SBC2": (30000, 3000000, 2, 2, 20, "保險期間 20 年、保證期間 15 年。5.5% 附加費用，預定利率 2.5%。"),
        "SBC3": (30000, 3000000, 2, 2, 25, "保險期間 25 年、保證期間 20 年。5.5% 附加費用，預定利率 2.5%。"),
    }
    catalog_rows = []
    for code, file_code, currency, version, name, _note in specs:
        info = build_annuity(code, paths[file_code], file_code, currency, version, name, limits[code][5])
        minimum, maximum, load_digits, show_digits, pay_years, note = limits[code]
        samples = annuity_samples(info, code, minimum, load_digits, show_digits, pay_years)
        product = {
            "code": code,
            "name": name,
            "currency": currency,
            "type": "savings",
            "status": "active",
            "kind": "interest-sensitive",
            "calc": "annuity",
            "version": version,
            "updated": FETCHED,
            "issueAges": {"1": list(info["ages"])},
            "sex": [1, 2],
            "sumInsured": {"min": minimum, "max": maximum, "step": 1},
            "sumLabel": "躉繳保費",
            "payYears": pay_years,
            "maxAge": 110,
            "loading": info["loading"],
            "loadDigits": load_digits,
            "showDigits": show_digits,
            "pricingRate": info["pricing"],
            "declDefault": info["declared"],
            "declLabel": info["label"],
            "defaultMode": "M",
            "modes": ["M"],
            "isr": True,
            "factors": info["factors"],
            "rule": note + "費率表只有月給付年金因子。",
            "sources": [{
                "site": "富邦人壽商品專區",
                "fetched": FETCHED,
                "version": f"試算表 {version}",
                "note": f"宣告利率 {info['declared']:.2%}（{info['label']}）",
            }],
            "verificationSamples": samples,
        }
        with open(os.path.join(ROOT, f"data/savings/{code}.json"), "w", encoding="utf-8") as handle:
            json.dump(product, handle, ensure_ascii=False, separators=(",", ":"))
        catalog_rows.append({
            "code": code, "name": name, "type": "savings", "kind": "interest-sensitive",
            "currency": currency, "status": "active", "file": f"savings/{code}.json",
        })
        print("wrote", code, "sample", samples[0]["expect"])
    write_mgd2()
    catalog_rows.append({
        "code": "MGD2", "name": "富邦人壽金安心健康一年定期保險", "type": "protection",
        "role": "main", "category": "健康險", "currency": "TWD", "status": "stopped",
        "file": "protection/MGD2.json",
    })
    catalog_rows.insert(0, {
        "code": "FBO", "name": "富邦人壽美利大運外幣利率變動型終身壽險", "type": "savings",
        "kind": "interest-sensitive", "currency": "USD", "status": "active", "file": "savings/FBO.json",
    })
    update_catalog(catalog_rows)
    write_skipped()


if __name__ == "__main__":
    main()
