# -*- coding: utf-8 -*-
"""分野／該当講義資料の生文字列を categoryId / label に正規化する。"""

import re

# 講義資料コード -> 講義タイトル（ファイル名から抽出）
LECTURE_TITLES = {
    "A-01": "国家試験の概要と出題傾向",
    "A-04": "日産協過去問解説・補足説明１",
    "A-05": "日産協過去問解説・補足説明２",
    "A-06": "消費者問題と消費者政策",
    "A-07": "社会保障制度",
    "A-08": "経済一般",
    "A-09": "企業経営",
    "A-10": "論文の基本",
    "B-01": "消費者政策の基本法制と消費者行政",
    "B-02": "民法１",
    "B-03": "民法２",
    "B-04": "消費者契約法",
    "B-05": "特定商取引法の基礎(1)",
    "B-06": "特定商取引法の基礎(2)",
    "B-07": "特定商取引法の基礎(3)",
    "B-08": "割賦販売法と資金決済法",
    "B-09": "金融商品と関連法制の基礎知識",
    "B-10": "貸金業法と多重債務の救済",
    "B-11": "情報通信",
    "B-12": "表示と広告に関する法律",
    "B-13": "製品安全",
    "B-14": "住宅の知識",
    "B-15": "食生活",
}

NO_LECTURE_CODE = "講義資料に該当箇所なし"

# 生文字列の先頭コードを抽出する正規表現（複合コードを単一コードより先に判定）
_CODE_RE = re.compile(
    r"^(?:"
    r"(?P<range>[AB]-\d{2}[〜～][AB]-\d{2})"
    r"|(?P<combo>[AB]-\d{2}/[AB]-\d{2})"
    r"|(?P<single>[AB]-\d{2})"
    r"|(?P<groupA>グループA)"
    r"|(?P<none>" + NO_LECTURE_CODE + r")"
    r")"
)


def _label_for_code(code):
    if "〜" in code or "～" in code:
        sep = "〜" if "〜" in code else "～"
        a, b = code.split(sep)
        return f"{code}　{LECTURE_TITLES.get(a, a)}〜{LECTURE_TITLES.get(b, b)}"
    if "/" in code:
        a, b = code.split("/")
        return f"{code}　{LECTURE_TITLES.get(a, a)}・{LECTURE_TITLES.get(b, b)}"
    if code in LECTURE_TITLES:
        return f"{code}　{LECTURE_TITLES[code]}"
    return code


def normalize_category(raw):
    """raw文字列(分野／該当講義資料列)から (categoryId, label, parentCode, unmapped) を返す。

    needsSupplement はここでは判定しない（呼び出し側で raw 全体から都度判定する）。
    """
    raw = (raw or "").strip()
    m = _CODE_RE.match(raw)
    if not m:
        return None, raw, None, True  # unmapped

    if m.group("range") or m.group("combo") or m.group("single"):
        code = m.group("range") or m.group("combo") or m.group("single")
        return code, _label_for_code(code), None, False

    if m.group("groupA"):
        rest = raw[m.end():].strip()
        sub_match = re.match(r"^（(.+)）$", rest)
        if sub_match:
            category_id = f"グループA（{sub_match.group(1)}）"
            return category_id, category_id, "グループA", False
        return "グループA", "グループA（全般）", None, False

    if m.group("none"):
        return NO_LECTURE_CODE, "該当講義資料なし", None, False

    return None, raw, None, True


def needs_supplement(raw, category_id):
    raw = raw or ""
    return category_id == NO_LECTURE_CODE or "要補完" in raw
