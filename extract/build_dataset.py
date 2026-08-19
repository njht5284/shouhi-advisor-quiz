# -*- coding: utf-8 -*-
"""CLI: 過去問データセットを生成する。

  python build_dataset.py --exam 2023-10-14   # パイロット: 1試験分のみ
  python build_dataset.py --all                # 本番: 全12試験分
"""

import argparse
import json
import os
import sys

from config import EXAM_LIST, XLSX_PATH
from merge import merge_exam

EXTRACT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(EXTRACT_DIR)
PILOT_OUTPUT_DIR = os.path.join(EXTRACT_DIR, "pilot_output")
DATA_DIR = os.path.join(PROJECT_DIR, "data")


def _build_categories_registry(all_records):
    registry = {}
    for exam in all_records:
        for mq in exam["records"]:
            for sq in mq["subQuestions"]:
                cid = sq["categoryId"]
                entry = registry.setdefault(
                    cid,
                    {
                        "categoryId": cid,
                        "label": sq["categoryLabel"],
                        "needsSupplement": False,
                        "questionCount": 0,
                        "rawVariants": set(),
                    },
                )
                entry["questionCount"] += 1
                entry["rawVariants"].add(sq["categoryRaw"])
                if sq["needsSupplement"]:
                    entry["needsSupplement"] = True
    out = []
    for entry in sorted(registry.values(), key=lambda e: e["categoryId"]):
        entry["rawVariants"] = sorted(entry["rawVariants"])
        out.append(entry)
    return out


def run(exam_ids, output_path, warnings_path):
    all_records = []
    all_warnings = []

    for exam in EXAM_LIST:
        if exam["examId"] not in exam_ids:
            continue
        print(f"処理中: {exam['examId']} ...")
        records, warnings = merge_exam(exam["examId"], exam["pdfPath"], XLSX_PATH, exam["examId"])
        total_sub = sum(len(mq["subQuestions"]) for mq in records)
        print(f"  -> 大問{len(records)}件, 小問{total_sub}件, 警告{len(warnings)}件")
        all_records.append({"examId": exam["examId"], "records": records})
        all_warnings.extend(warnings)

    questions_json = [
        {"examId": exam["examId"], "questions": exam["records"]} for exam in all_records
    ]
    categories_json = _build_categories_registry(all_records)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(questions_json, f, ensure_ascii=False, indent=2)

    categories_path = os.path.join(os.path.dirname(output_path), "categories.json")
    with open(categories_path, "w", encoding="utf-8") as f:
        json.dump(categories_json, f, ensure_ascii=False, indent=2)

    with open(warnings_path, "w", encoding="utf-8") as f:
        if all_warnings:
            f.write("\n".join(all_warnings))
        else:
            f.write("(警告なし)")

    hard_warnings = [w for w in all_warnings if "[参考]" not in w]
    soft_warnings = [w for w in all_warnings if "[参考]" in w]

    total_sub_all = sum(len(mq["subQuestions"]) for exam in all_records for mq in exam["records"])
    print(
        f"\n完了: 試験{len(all_records)}件, 小問合計{total_sub_all}件, "
        f"警告合計{len(all_warnings)}件（要確認{len(hard_warnings)}件 / 参考{len(soft_warnings)}件）"
    )
    print(f"出力: {output_path}")
    print(f"分野: {categories_path}")
    print(f"警告ログ: {warnings_path}")
    return len(hard_warnings)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--exam", help="単一試験のみ処理（パイロット用）例: 2023-10-14")
    group.add_argument("--all", action="store_true", help="全12試験を処理")
    args = parser.parse_args()

    if args.exam:
        exam_ids = {args.exam}
        output_path = os.path.join(PILOT_OUTPUT_DIR, f"{args.exam}.json")
        warnings_path = os.path.join(PILOT_OUTPUT_DIR, f"{args.exam}_warnings.txt")
    else:
        exam_ids = {e["examId"] for e in EXAM_LIST}
        output_path = os.path.join(DATA_DIR, "questions.json")
        warnings_path = os.path.join(EXTRACT_DIR, "validation_report.txt")

    warning_count = run(exam_ids, output_path, warnings_path)
    if warning_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
