"""任务型阅读：一篇材料 + Task 1 简答 + Task 2 续写，按一题存储。"""

from __future__ import annotations

import re
from typing import Any

TASK_READING_TYPE_NAME = "任务型阅读"
WRITING_ATTEMPT_MIN_WORDS = 12
WRITING_ATTEMPT_MIN_CHARS = 40

_TASK_READING_STEM_RE = re.compile(
    r"complete the tasks|根据短文内容完成任务|\bTask\s*[12]\b|读后续写",
    re.IGNORECASE,
)
_TASK_HEAD_RE = re.compile(r"^\s*Task\s*[12]\b", re.IGNORECASE)
_TASK1_RE = re.compile(r"Task\s*1\b|complete the tasks|根据短文内容完成任务", re.IGNORECASE)
_TASK2_RE = re.compile(
    r"(?:^|\n)\s*Task\s*2\b|Write a short continuation|续写|读后续写",
    re.IGNORECASE,
)
_NUMBERED_ITEM_RE = re.compile(
    r"(?:^|\n)\s*(?:\(?\s*)(\d{1,2})\s*[.．、:：)）]\s+\S",
)
_PASSAGE_HINT_RE = re.compile(
    r"Read the passage|根据短文|complete the tasks|\bTask\s*1\b",
    re.IGNORECASE,
)


def is_task_reading_type(question_type_name: str | None) -> bool:
    return "任务型" in (question_type_name or "")


def is_task_reading_stem(stem: str | None) -> bool:
    return bool(_TASK_READING_STEM_RE.search(stem or ""))


def is_task_reading(stem: str | None, question_type_name: str | None = None) -> bool:
    return is_task_reading_type(question_type_name) or is_task_reading_stem(stem)


_NUMBERED_HEAD_RE = re.compile(r"^\d{1,2}\s*[.．、:：)）]\s+\S")
_TASK_CONTINUE_RE = re.compile(
    r"^(?:Imagine|Write a short continuation|Answer the questions)\b",
    re.IGNORECASE,
)


def looks_like_task_fragment(stem: str | None) -> bool:
    """True only for Task 续页，不含普通阅读小题（如 1. What is the main idea）。"""
    text = (stem or "").strip()
    if not text:
        return False
    if _TASK_HEAD_RE.match(text) or _TASK_CONTINUE_RE.match(text):
        return True
    return False


def looks_like_numbered_subquestion(stem: str | None) -> bool:
    text = (stem or "").strip()
    return bool(text) and bool(_NUMBERED_HEAD_RE.match(text)) and len(text) < 800


def looks_like_task_passage(stem: str | None) -> bool:
    text = stem or ""
    return bool(_PASSAGE_HINT_RE.search(text)) or is_task_reading_stem(text)


def _unwrap_answers(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        current = value
        while isinstance(current, list) and len(current) == 1 and isinstance(current[0], list):
            current = current[0]
        return current if isinstance(current, list) else [current]
    return [value]


def _numbered_items(text: str) -> list[int]:
    return [int(match.group(1)) for match in _NUMBERED_ITEM_RE.finditer(text or "")]


def _task_body(stem: str) -> str:
    match = _TASK1_RE.search(stem or "")
    return stem[match.start() :] if match else (stem or "")


def _split_task2(stem: str) -> tuple[str, str | None]:
    match = _TASK2_RE.search(stem or "")
    if not match:
        return stem or "", None
    return (stem or "")[: match.start()], (stem or "")[match.start() :]


def _pad_kinds(short_count: int, writing_count: int, slot_count: int) -> list[str]:
    short_count = max(0, short_count)
    writing_count = max(0, writing_count)
    kinds = ["short"] * short_count + ["writing"] * writing_count
    if slot_count <= 0:
        return kinds
    if len(kinds) < slot_count:
        missing = slot_count - len(kinds)
        if writing_count:
            kinds.extend(["writing"] * missing)
        else:
            kinds.extend(["short"] * missing)
    return kinds[:slot_count] if slot_count else kinds


def infer_open_slots(
    stem: str | None,
    correct_answer: Any = None,
    question_type_name: str | None = None,
) -> tuple[int, list[str]]:
    """Return (slot_count, kinds) for a task-reading item. kinds are 'short' | 'writing'."""
    answers = _unwrap_answers(correct_answer)
    filled = [
        item
        for item in answers
        if not (item is None or (isinstance(item, str) and not str(item).strip()))
    ]
    answer_count = len(filled)

    body = _task_body(stem or "")
    before, after = _split_task2(body)
    before_nums = _numbered_items(before)
    after_nums = _numbered_items(after or "")
    has_writing = after is not None or is_task_reading_type(question_type_name)

    short_from_stem = max(before_nums) if before_nums else 0
    writing_from_stem = len(set(after_nums)) if after_nums else (1 if has_writing and short_from_stem else 0)
    stem_count = short_from_stem + writing_from_stem
    slot_count = max(stem_count, answer_count, 1 if is_task_reading(stem, question_type_name) else 0)
    if slot_count <= 0:
        return 0, []

    if has_writing:
        if short_from_stem and short_from_stem < slot_count:
            writing_count = slot_count - short_from_stem
            kinds = _pad_kinds(short_from_stem, writing_count, slot_count)
        elif writing_from_stem:
            kinds = _pad_kinds(max(slot_count - writing_from_stem, 0), writing_from_stem, slot_count)
        elif slot_count > 1:
            kinds = _pad_kinds(slot_count - 1, 1, slot_count)
        else:
            kinds = ["writing"]
    else:
        kinds = ["short"] * slot_count
    return slot_count, kinds


def writing_attempted(value: Any) -> bool:
    current = value
    while isinstance(current, list) and len(current) == 1:
        current = current[0]
    if current is None:
        return False
    text = str(current).strip()
    if not text:
        return False
    words = re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)?", text)
    if len(words) >= WRITING_ATTEMPT_MIN_WORDS:
        return True
    return len(text) >= WRITING_ATTEMPT_MIN_CHARS
