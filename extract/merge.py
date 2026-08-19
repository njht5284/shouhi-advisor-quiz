# -*- coding: utf-8 -*-
"""1試験分について PDF抽出結果とExcelをマージし、正答の突き合わせ検証を行う。"""

import unicodedata

from categories import needs_supplement, normalize_category
from excel_loader import load_answer_sheet
from pdf_parser import parse_exam_pdf


def _compare_normalize(s):
    s = (s or "").replace("○", "〇").replace("✕", "×").replace("☓", "×")
    return unicodedata.normalize("NFKC", s).strip()


def _marker(s):
    s = (s or "").strip()
    return s[0] if s else None


def merge_exam(exam_id, pdf_path, xlsx_path, sheet_name):
    major_questions = parse_exam_pdf(pdf_path)
    excel_data = load_answer_sheet(xlsx_path, sheet_name)

    warnings = []
    records = []

    for mq in major_questions:
        out_subs = []
        for sq in mq["subQuestions"]:
            key = (mq["questionNumber"], sq["subNumber"])
            excel_row = excel_data.get(key)
            if excel_row is None:
                warnings.append(
                    f"[{exam_id}] 問{mq['questionNumber']}-{sq['subNumber']}: Excelに該当行がありません"
                )
                continue

            correct_answer = excel_row["correctAnswer"]
            normalized_correct = _compare_normalize(correct_answer)
            normalized_choices = [_compare_normalize(c) for c in sq["choices"]]

            # 正答の特定は「マーカー（①②③④ / 〇×）が一致する選択肢」を正とする。
            # PDFの選択肢とExcelの正答文言は、丸数字や〇×の記号は必ず一致するが、
            # 本文側は表記ゆれ（補足の括弧書き追加・要約・語順違い等）があり得るため、
            # 本文の完全一致は必須としない。
            correct_marker = _marker(correct_answer)
            marker_matches = [i for i, c in enumerate(sq["choices"]) if _marker(c) == correct_marker]

            if len(marker_matches) == 1:
                final_correct_answer = sq["choices"][marker_matches[0]]
                chosen_normalized = normalized_choices[marker_matches[0]]
                text_matches = (
                    chosen_normalized == normalized_correct
                    or normalized_correct.startswith(chosen_normalized)
                    or chosen_normalized.startswith(normalized_correct)
                )
                if not text_matches:
                    warnings.append(
                        f"[{exam_id}] 問{mq['questionNumber']}-{sq['subNumber']}: "
                        f"[参考]マーカーは一致するが本文表現が異なる "
                        f"(Excel正答='{correct_answer}', 選択肢='{final_correct_answer}') — 要目視確認"
                    )
            else:
                warnings.append(
                    f"[{exam_id}] 問{mq['questionNumber']}-{sq['subNumber']}: 正答マーカー不一致 "
                    f"(Excel正答='{correct_answer}', 抽出選択肢={sq['choices']}, マーカー一致数={len(marker_matches)})"
                )
                final_correct_answer = correct_answer

            category_id, label, parent_code, unmapped = normalize_category(excel_row["categoryRaw"])
            if unmapped:
                warnings.append(
                    f"[{exam_id}] 問{mq['questionNumber']}-{sq['subNumber']}: "
                    f"未分類の分野文字列 '{excel_row['categoryRaw']}'"
                )
            category_id = category_id or "未分類"
            supplement = needs_supplement(excel_row["categoryRaw"], category_id)

            out_subs.append(
                {
                    "subNumber": sq["subNumber"],
                    "type": sq["type"],
                    "prompt": sq["prompt"],
                    "choices": sq["choices"],
                    "correctAnswer": final_correct_answer,
                    "explanation": excel_row["explanation"],
                    "categoryId": category_id,
                    "categoryLabel": label,
                    "categoryRaw": excel_row["categoryRaw"],
                    "needsSupplement": supplement,
                }
            )

        records.append(
            {
                "questionNumber": mq["questionNumber"],
                "passage": mq["passage"],
                "subQuestions": out_subs,
            }
        )

    return records, warnings
