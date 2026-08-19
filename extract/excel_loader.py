# -*- coding: utf-8 -*-
"""正答・解説Excelから (問,小問) キーで 正答/解説/分野 を読み込む。"""

import openpyxl


def load_answer_sheet(xlsx_path, sheet_name):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[sheet_name]

    result = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        q, sub, _summary, correct_answer, explanation, category_raw = row[:6]
        if q is None or sub is None:
            continue
        result[(int(q), int(sub))] = {
            "correctAnswer": (correct_answer or "").strip(),
            "explanation": (explanation or "").strip(),
            "categoryRaw": (category_raw or "").strip(),
        }
    return result
