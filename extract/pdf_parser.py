# -*- coding: utf-8 -*-
"""過去問（問題）PDFから 問/小問/passage/prompt/choices/type を抽出する。"""

import re
import unicodedata

import pdfplumber

FULLWIDTH_DIGITS = "０１２３４５６７８９"
HALFWIDTH_DIGITS = "0123456789"
DIGIT_CLASS = "[0-9" + FULLWIDTH_DIGITS + "]"

# 大問見出し: 行全体が「問」+ 1〜2桁数字のみ
MAJOR_HEADER_RE = re.compile(r"^問(" + DIGIT_CLASS + r"{1,2})\s*$", re.MULTILINE)

# 小問見出し: 「問」+ 数字 + （－|-） + 数字
SUB_HEADER_RE = re.compile(r"問(" + DIGIT_CLASS + r"{1,2})[－\-](" + DIGIT_CLASS + r")")

# 丸数字マーカー ①〜⑨
MARU_SUUJI_RE = re.compile(r"[①-⑨]")
MARU_SUUJI_SPLIT_RE = re.compile(r"([①-⑨][^①-⑨]*)")

# ページフッター（例: "— 1 —"）を除去
PAGE_FOOTER_RE = re.compile(r"^[—\-]\s*" + DIGIT_CLASS + r"+\s*[—\-]\s*$", re.MULTILINE)


def _to_int(digit_str):
    return int(unicodedata.normalize("NFKC", digit_str))


def _is_wide_char(ch):
    """全角/日本語文字とみなせるか（行折り返し時にスペースを入れないための判定）。"""
    if not ch:
        return False
    cp = ord(ch)
    return (
        0x3000 <= cp <= 0x30FF  # 全角記号・ひらがな・カタカナ
        or 0x4E00 <= cp <= 0x9FFF  # 漢字
        or 0xFF00 <= cp <= 0xFFEF  # 全角英数・記号
        or 0x2460 <= cp <= 0x24FF  # 丸数字等
        or cp == 0x3007  # 〇
    )


def _collapse_whitespace(text):
    # 行内の全角スペース(選択肢の桁揃え等)はまず単一の半角スペースへ。
    lines = [re.sub(r"[ \t　]+", " ", ln).strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln != ""]
    if not lines:
        return ""
    # 行またぎの折り返しは、両端が全角文字同士ならスペースを入れずに連結
    # （日本語プロパーの改行折り返しで語が分断されるのを防ぐ）。
    # 半角英数字が絡む場合（例: "Cash" / "Flow"）はスペースを入れて連結する。
    result = lines[0]
    for line in lines[1:]:
        if _is_wide_char(result[-1] if result else "") and _is_wide_char(line[0] if line else ""):
            result += line
        else:
            result += " " + line
    return result.strip()


def _normalize_choice_body(text):
    return unicodedata.normalize("NFKC", _collapse_whitespace(text))


def _split_choices(text):
    """マル数字マーカーで選択肢を分割する。マーカー自体はNFKC正規化しない。"""
    choices = []
    for chunk in MARU_SUUJI_SPLIT_RE.findall(text):
        marker = chunk[0]
        body = _normalize_choice_body(chunk[1:])
        choices.append(f"{marker} {body}" if body else marker)
    return choices


def _extract_full_text(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n".join(pages_text)
    full_text = PAGE_FOOTER_RE.sub("", full_text)
    return full_text


def parse_exam_pdf(pdf_path):
    """問題PDFを解析し、大問ごとの {questionNumber, passage, subQuestions} のリストを返す。"""
    full_text = _extract_full_text(pdf_path)

    major_matches = list(MAJOR_HEADER_RE.finditer(full_text))
    if not major_matches:
        raise ValueError(f"大問見出しが1件も見つかりませんでした: {pdf_path}")

    major_questions = []
    for i, m in enumerate(major_matches):
        question_number = _to_int(m.group(1))
        block_start = m.end()
        block_end = major_matches[i + 1].start() if i + 1 < len(major_matches) else len(full_text)
        block_text = full_text[block_start:block_end]

        sub_matches = list(SUB_HEADER_RE.finditer(block_text))
        if not sub_matches:
            raise ValueError(f"問{question_number}: 小問見出しが見つかりません ({pdf_path})")

        passage_raw = block_text[: sub_matches[0].start()]
        passage_joined = _collapse_whitespace(passage_raw)
        passage = unicodedata.normalize("NFKC", passage_joined) if passage_joined else None

        # 型判定は大問（問N）単位で行う。正誤判定型の設問文自体に丸数字の箇条書き
        # （例:「①〜、②〜、③〜の3つを重点事項としている」）が含まれることがあり、
        # 小問単位で丸数字の有無だけを見ると誤判定するため、大問の指示文
        # （「正しい場合は／には○、誤っている場合は×を選びなさい」）で一括判定する。
        block_is_true_false = "正しい場合" in passage_joined

        sub_questions = []
        for j, sm in enumerate(sub_matches):
            sub_number = _to_int(sm.group(2))
            expected_q = _to_int(sm.group(1))
            if expected_q != question_number:
                raise ValueError(
                    f"問{question_number}内の小問見出しの問番号が不一致: "
                    f"見出し='{sm.group(0)}' ({pdf_path})"
                )
            span_start = sm.end()
            span_end = sub_matches[j + 1].start() if j + 1 < len(sub_matches) else len(block_text)
            span_text = block_text[span_start:span_end]

            if block_is_true_false:
                prompt = unicodedata.normalize("NFKC", _collapse_whitespace(span_text))
                choices = ["〇 正しい", "× 誤り"]
                sub_type = "true_false"
            elif MARU_SUUJI_RE.search(span_text):
                marker_pos = MARU_SUUJI_RE.search(span_text).start()
                prompt = unicodedata.normalize("NFKC", _collapse_whitespace(span_text[:marker_pos]))
                choices = _split_choices(span_text[marker_pos:])
                sub_type = "fill_blank"
            else:
                raise ValueError(
                    f"問{question_number}-{sub_number}: 選択肢(丸数字)が見つからず、"
                    f"正誤判定型の指示文もありません ({pdf_path})"
                )

            sub_questions.append(
                {
                    "subNumber": sub_number,
                    "type": sub_type,
                    "prompt": prompt,
                    "choices": choices,
                }
            )

        if len(sub_questions) != 5:
            raise ValueError(
                f"問{question_number}: 小問数が5ではありません ({len(sub_questions)}件, {pdf_path})"
            )

        major_questions.append(
            {
                "questionNumber": question_number,
                "passage": passage,
                "subQuestions": sub_questions,
            }
        )

    if len(major_questions) != 30:
        raise ValueError(f"大問数が30ではありません ({len(major_questions)}件, {pdf_path})")

    return major_questions
