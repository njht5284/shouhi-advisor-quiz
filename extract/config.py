# -*- coding: utf-8 -*-
"""試験一覧と入出力パスの設定。"""

SOURCE_ROOT = r"D:\消費生活相談員資格"
XLSX_PATH = SOURCE_ROOT + r"\過去問\20260818_全12回分試験_正答解説データ_完全版.xlsx"

EXAM_LIST = [
    {"examId": "2023-10-14", "pdfPath": SOURCE_ROOT + r"\過去問\2023年度\2023年度消費生活アドバイザー第１次試験問題（10月14日）.pdf"},
    {"examId": "2023-10-15", "pdfPath": SOURCE_ROOT + r"\過去問\2023年度\2023年度消費生活アドバイザー第１次試験問題（10月15日）.pdf"},
    {"examId": "2023-10-21", "pdfPath": SOURCE_ROOT + r"\過去問\2023年度\2023年度消費生活アドバイザー第１次試験問題（10月21日）.pdf"},
    {"examId": "2023-10-22", "pdfPath": SOURCE_ROOT + r"\過去問\2023年度\2023年度消費生活アドバイザー第１次試験問題（10月22日）.pdf"},
    {"examId": "2024-10-12", "pdfPath": SOURCE_ROOT + r"\過去問\2024年度\2024年度消費生活アドバイザー第１次試験問題（10月12日）.pdf"},
    {"examId": "2024-10-13", "pdfPath": SOURCE_ROOT + r"\過去問\2024年度\2024年度消費生活アドバイザー第１次試験問題（10月13日）.pdf"},
    {"examId": "2024-10-19", "pdfPath": SOURCE_ROOT + r"\過去問\2024年度\2024年度消費生活アドバイザー第１次試験問題（10月19日）.pdf"},
    {"examId": "2024-10-20", "pdfPath": SOURCE_ROOT + r"\過去問\2024年度\2024年度消費生活アドバイザー第１次試験問題（10月20日）.pdf"},
    {"examId": "2025-10-04", "pdfPath": SOURCE_ROOT + r"\過去問\2025年度\2025年度消費生活アドバイザー第１次試験問題（10月4日）.pdf"},
    {"examId": "2025-10-05", "pdfPath": SOURCE_ROOT + r"\過去問\2025年度\2025年度消費生活アドバイザー第１次試験問題（10月5日）.pdf"},
    {"examId": "2025-10-11", "pdfPath": SOURCE_ROOT + r"\過去問\2025年度\2025年度消費生活アドバイザー第１次試験問題（10月11日）.pdf"},
    {"examId": "2025-10-12", "pdfPath": SOURCE_ROOT + r"\過去問\2025年度\2025年度消費生活アドバイザー第１次試験問題（10月12日）.pdf"},
]

# 試験実施日 -> 表示用の正式名称
EXAM_LABELS = {
    e["examId"]: e["examId"].replace("-", "年", 1).replace("-", "月") + "日実施"
    for e in EXAM_LIST
}
