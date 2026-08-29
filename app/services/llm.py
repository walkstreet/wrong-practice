from __future__ import annotations

import json
import re
import uuid as uuid_mod
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import settings

SYSTEM_PROMPT = """你是一位资深英语教师，擅长句法分析与错题讲解。
请根据题目信息完成两项分析，并严格返回 JSON（不要 markdown 代码块，不要额外文字）。

## 题型分流（非常重要）
1. **单句语法 / 改错 / 短填空**：对考查句做成分分析；若题干含 2～3 个相关短句，可返回多句。
2. **长文填空 / 完形 / 多空段落**：禁止把整段材料当作 target_sentence。
   - 只抽取含空格/横线/考查点的完整句子（最多 3 句）做成分分析。
   - 整段材料仅用于做题分析的上下文，不要标成分。
3. **阅读理解**：成分分析只针对题干问句或直接相关的原文一句；长文本身不做成分标注。
4. 多句时用 **sentence_analyses** 数组；同时把第 1 句同步到 sentence_analysis 以兼容旧客户端。

## 分层结构（非常重要）
每句的 sentence_analysis 使用 **components** 两层结构：
- **第一层 components**：按主谓宾定状补划分（一个成分一块），每块有 role / role_label
- **第二层 tokens**：块内按单词切分，标注 pos / pos_label；若该词在短语内承担次成分（如主语中的定语），填 inner_role / inner_role_label

示例 target_sentence: "The beautiful boy is happy."
```json
"components": [
  {
    "role": "subject",
    "role_label": "主语",
    "is_clause": false,
    "tokens": [
      {"text": "The", "pos": "determiner", "pos_label": "限定词"},
      {"text": " ", "pos": "", "pos_label": ""},
      {"text": "beautiful", "pos": "adjective", "pos_label": "形容词", "inner_role": "attributive", "inner_role_label": "定语"},
      {"text": " ", "pos": "", "pos_label": ""},
      {"text": "boy", "pos": "noun", "pos_label": "名词", "is_head": true}
    ]
  },
  {
    "role": "predicate",
    "role_label": "谓语",
    "tokens": [{"text": "is", "pos": "verb", "pos_label": "动词", "is_head": true}]
  },
  {
    "role": "complement",
    "role_label": "表语",
    "tokens": [{"text": "happy", "pos": "adjective", "pos_label": "形容词", "is_head": true}]
  },
  {
    "role": "neutral",
    "role_label": "",
    "tokens": [{"text": ".", "pos": "", "pos_label": ""}]
  }
]
```

规则：
1. 每句的 target_sentence 与该句 components.tokens 的 text 按顺序拼接后逐字一致。
2. 主语/宾语等名词短语合并为**一个** component，内部再用 tokens 标词性。
3. 谓语、表语、状语等若只有一个词，也单独成 component。
4. **定语从句/状语从句/名词性从句**：必须整体作为一个 component，is_clause=true，role_label 写「定语从句」「状语从句」等，内部 tokens 标各词词性。不要把从句拆成多个 component。
5. 形容词/副词不是第一层 component，而是第二层 tokens 的 pos；若在主语短语内作定语，加 inner_role=attributive。
6. target_sentence 必须是**完整单句**（可含空格填空符号），不要塞入整段文章。

完整 JSON：
{
  "sentence_analyses": [
    {
      "target_sentence": "含考查点的完整单句",
      "focus": "blank_1",
      "components": [ ... ],
      "summary": "一句话概括本句考点（中文）"
    }
  ],
  "sentence_analysis": { "同上第 1 句，兼容字段" },
  "solving_analysis": {
    "correct_answer": "...",
    "correct_answer_text": "...",
    "wrong_answer": "...",
    "wrong_answer_text": "...",
    "explanation": "结合上下文的做题解析（中文）"
  }
}

注意：solving_analysis 只能包含以上 5 个字段，不要添加 question_type 等其他字段。

## 做题分析要求
- 必须结合题干、选项、正确答案、学生错选来判断，不要凭空猜测。
- 长文题要结合空前空后语境解释，不要只复述答案字母。
- correct_answer / correct_answer_text 必须与题目给出的正确答案一致。"""


class TokenSchema(BaseModel):
    text: str
    pos: str = ""
    pos_label: str = ""
    inner_role: str = ""
    inner_role_label: str = ""
    is_head: bool = False


class ComponentSchema(BaseModel):
    role: str
    role_label: str = ""
    is_clause: bool = False
    tokens: list[TokenSchema] = Field(min_length=1)


class HighlightSchema(BaseModel):
    text: str
    role: str
    role_label: str = ""
    pos: str = ""
    pos_label: str = ""
    group_id: str | None = None
    is_head: bool = False
    is_clause: bool = False


class SentenceAnalysisSchema(BaseModel):
    target_sentence: str = Field(min_length=1)
    components: list[ComponentSchema] = Field(min_length=1)
    highlights: list[HighlightSchema] | None = None
    summary: str = Field(min_length=1)
    focus: str | None = None


class SegmentSchema(BaseModel):
    text: str = Field(min_length=1)
    role: str
    role_label: str
    is_clause: bool = False


class ClauseSchema(BaseModel):
    clause_type: str
    clause_label: str
    segments: list[SegmentSchema] = Field(min_length=1)


class SolvingAnalysisSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    correct_answer: str = ""
    correct_answer_text: str = ""
    wrong_answer: str = ""
    wrong_answer_text: str = ""
    explanation: str = Field(min_length=1)


class AiAnalysisResult(BaseModel):
    sentence_analyses: list[SentenceAnalysisSchema] = Field(min_length=1)
    sentence_analysis: SentenceAnalysisSchema
    solving_analysis: SolvingAnalysisSchema

    @model_validator(mode="before")
    @classmethod
    def coerce_sentence_analyses(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        payload = dict(data)
        analyses_raw = payload.get("sentence_analyses")
        single = payload.get("sentence_analysis")

        analyses: list[Any] = []
        if isinstance(analyses_raw, list) and analyses_raw:
            analyses = [item for item in analyses_raw if isinstance(item, dict)]
        elif isinstance(single, dict):
            analyses = [single]

        if not analyses:
            raise ValueError("缺少 sentence_analyses / sentence_analysis")

        # 最多保留 3 句，避免长文整段塞入
        analyses = analyses[:3]
        payload["sentence_analyses"] = analyses
        payload["sentence_analysis"] = analyses[0]
        return payload

    @model_validator(mode="after")
    def validate_components_cover_sentence(self) -> "AiAnalysisResult":
        for idx, analysis in enumerate(self.sentence_analyses):
            if _components_match_target(analysis.components, analysis.target_sentence):
                continue
            raise ValueError(
                f"第 {idx + 1} 句 components 与 target_sentence 不一致: "
                f"joined={_normalize_for_compare(_join_component_text(analysis.components))!r} "
                f"target={_normalize_for_compare(analysis.target_sentence)!r}"
            )
        return self


def _fallback_sentence_components(target: str) -> list[ComponentSchema]:
    return [
        ComponentSchema(
            role="neutral",
            role_label="",
            tokens=[TokenSchema(text=target or "（空）")],
        )
    ]


def _join_component_text(components: list[ComponentSchema]) -> str:
    return _normalize_sentence_text("".join(token.text for comp in components for token in comp.tokens))


def _repair_components_against_target(
    components: list[ComponentSchema], target: str
) -> list[ComponentSchema]:
    """按 target_sentence 补齐 AI 漏掉的空格/标点，避免拼接校验失败。"""
    if not components or not target:
        return components

    if _normalize_for_compare(_join_component_text(components)) == _normalize_for_compare(target):
        return components

    repaired = [comp.model_copy(deep=True) for comp in components]
    cursor = 0

    for comp in repaired:
        new_tokens: list[TokenSchema] = []
        for token in comp.tokens:
            text = token.text
            if not text:
                new_tokens.append(token)
                continue

            if text.isspace():
                while cursor < len(target) and target[cursor].isspace():
                    new_tokens.append(TokenSchema(text=target[cursor], pos="", pos_label=""))
                    cursor += 1
                continue

            while cursor < len(target) and target[cursor].isspace():
                new_tokens.append(TokenSchema(text=target[cursor], pos="", pos_label=""))
                cursor += 1

            if cursor + len(text) <= len(target) and target[cursor : cursor + len(text)] == text:
                new_tokens.append(token)
                cursor += len(text)
                continue

            core = text.strip()
            if not core:
                new_tokens.append(token)
                continue

            idx = target.find(core, cursor)
            if idx == -1:
                new_tokens.append(token)
                continue

            while cursor < idx:
                new_tokens.append(TokenSchema(text=target[cursor], pos="", pos_label=""))
                cursor += 1

            if text[: len(text) - len(core)]:
                leading = text[: len(text) - len(core)]
                new_tokens.append(TokenSchema(text=leading, pos="", pos_label=""))

            new_tokens.append(token.model_copy(update={"text": core}))
            cursor = idx + len(core)

            trailing = text[len(core) :]
            if trailing:
                new_tokens.append(TokenSchema(text=trailing, pos="", pos_label=""))

        comp.tokens = new_tokens

    if cursor < len(target):
        tail = target[cursor:]
        if repaired and repaired[-1].role == "neutral":
            repaired[-1].tokens.append(TokenSchema(text=tail, pos="", pos_label=""))
        else:
            repaired.append(
                ComponentSchema(
                    role="neutral",
                    role_label="",
                    tokens=[TokenSchema(text=tail, pos="", pos_label="")],
                )
            )

    return repaired


def _components_match_target(components: list[ComponentSchema], target: str) -> bool:
    joined = _normalize_for_compare(_join_component_text(components))
    normalized_target = _normalize_for_compare(target)
    if joined == normalized_target:
        return True
    # 内容一致但仅缺空格时，视为可修复/可接受
    return re.sub(r"\s+", "", joined) == re.sub(r"\s+", "", normalized_target)


_PHRASE_ROLES = {"subject", "predicate", "object", "complement"}
_MODIFIER_ROLES = {"attributive", "adverbial"}


def _component_role_from_group(items: list[HighlightSchema]) -> tuple[str, str, bool]:
    is_clause = any(item.is_clause for item in items)
    head = next((item for item in items if item.is_head), None)
    if head and head.role not in _MODIFIER_ROLES:
        return head.role, head.role_label or head.role, is_clause

    for preferred in ("subject", "predicate", "object", "complement", "adverbial", "attributive"):
        for item in items:
            if item.role == preferred:
                return item.role, item.role_label or preferred, is_clause

    first = items[0]
    return first.role, first.role_label or first.role, is_clause


def _is_clause_component(comp: ComponentSchema) -> bool:
    if comp.is_clause:
        return True
    label = comp.role_label or ""
    return "从句" in label


def _merge_clause_components(components: list[ComponentSchema]) -> list[ComponentSchema]:
    """将从句被拆散的多块合并为一个整体 component。"""
    merged: list[ComponentSchema] = []
    buffer: ComponentSchema | None = None

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer is not None:
            buffer.is_clause = True
            if buffer.role_label and "从句" not in buffer.role_label:
                buffer.role_label = f"{buffer.role_label}从句"
            elif not buffer.role_label:
                buffer.role_label = "从句"
            merged.append(buffer)
            buffer = None

    for comp in components:
        if buffer is not None:
            if comp.role == "neutral" or _is_clause_component(comp):
                buffer.tokens.extend(comp.tokens)
                if _is_clause_component(comp):
                    buffer.is_clause = True
                    if comp.role_label and "从句" in comp.role_label:
                        buffer.role_label = comp.role_label
                    elif comp.role_label and not buffer.role_label:
                        buffer.role_label = comp.role_label
                continue
            flush_buffer()

        if _is_clause_component(comp):
            buffer = comp.model_copy(deep=True)
            buffer.is_clause = True
            continue

        merged.append(comp)

    flush_buffer()
    return merged


def _clause_label_from_items(items: list[HighlightSchema]) -> str:
    for item in items:
        label = item.role_label or ""
        if "从句" in label:
            return label
    for item in items:
        if item.role == "adverbial":
            return "状语从句"
    return "定语从句"


def _highlights_to_components(highlights: list[HighlightSchema]) -> list[ComponentSchema]:
    if not highlights:
        return []

    components: list[ComponentSchema] = []
    index = 0
    total = len(highlights)

    while index < total:
        current = highlights[index]
        if current.role == "neutral":
            components.append(
                ComponentSchema(
                    role="neutral",
                    role_label="",
                    tokens=[TokenSchema(text=current.text)],
                )
            )
            index += 1
            continue

        if current.is_clause:
            clause_items: list[HighlightSchema] = []
            while index < total:
                item = highlights[index]
                if item.is_clause:
                    clause_items.append(item)
                    index += 1
                    continue
                if item.role == "neutral":
                    next_idx = index + 1
                    while next_idx < total and highlights[next_idx].role == "neutral":
                        next_idx += 1
                    if next_idx < total and highlights[next_idx].is_clause:
                        clause_items.append(item)
                        index += 1
                        continue
                    break
                break

            tokens: list[TokenSchema] = []
            for item in clause_items:
                inner_role = ""
                inner_role_label = ""
                if item.role in _MODIFIER_ROLES:
                    inner_role = item.role
                    inner_role_label = item.role_label
                tokens.append(
                    TokenSchema(
                        text=item.text,
                        pos=item.pos,
                        pos_label=item.pos_label,
                        inner_role=inner_role,
                        inner_role_label=inner_role_label,
                        is_head=item.is_head,
                    )
                )
            role = next((item.role for item in clause_items if item.role in _MODIFIER_ROLES), "attributive")
            components.append(
                ComponentSchema(
                    role=role,
                    role_label=_clause_label_from_items(clause_items),
                    is_clause=True,
                    tokens=tokens,
                )
            )
            continue

        group_id = current.group_id
        if group_id:
            group_items: list[HighlightSchema] = []
            while index < total:
                item = highlights[index]
                if item.role == "neutral":
                    next_non_neutral = index + 1
                    while next_non_neutral < total and highlights[next_non_neutral].role == "neutral":
                        next_non_neutral += 1
                    if next_non_neutral < total and highlights[next_non_neutral].group_id == group_id:
                        group_items.append(item)
                        index += 1
                        continue
                    break
                if item.group_id != group_id:
                    break
                group_items.append(item)
                index += 1

            role, role_label, is_clause = _component_role_from_group(
                [item for item in group_items if item.role != "neutral"]
            )
            tokens = []
            for item in group_items:
                if item.role == "neutral":
                    tokens.append(TokenSchema(text=item.text))
                    continue
                inner_role = ""
                inner_role_label = ""
                if item.role in _MODIFIER_ROLES and item.role != role:
                    inner_role = item.role
                    inner_role_label = item.role_label
                tokens.append(
                    TokenSchema(
                        text=item.text,
                        pos=item.pos,
                        pos_label=item.pos_label,
                        inner_role=inner_role,
                        inner_role_label=inner_role_label,
                        is_head=item.is_head,
                    )
                )
            components.append(
                ComponentSchema(role=role, role_label=role_label, is_clause=is_clause, tokens=tokens)
            )
            continue

        group_items = [current]
        index += 1
        while index < total and highlights[index].role != "neutral":
            item = highlights[index]
            if item.group_id or item.role != current.role:
                break
            group_items.append(item)
            index += 1

        for item in group_items:
            if item.role in _MODIFIER_ROLES and components and components[-1].role in _PHRASE_ROLES:
                components[-1].tokens.append(
                    TokenSchema(
                        text=item.text,
                        pos=item.pos,
                        pos_label=item.pos_label,
                        inner_role=item.role,
                        inner_role_label=item.role_label,
                        is_head=item.is_head,
                    )
                )
                continue

            components.append(
                ComponentSchema(
                    role=item.role,
                    role_label=item.role_label,
                    is_clause=item.is_clause,
                    tokens=[
                        TokenSchema(
                            text=item.text,
                            pos=item.pos,
                            pos_label=item.pos_label,
                            is_head=item.is_head,
                        )
                    ],
                )
            )

    return _merge_clause_components(components)


def _ensure_components(data: dict[str, Any]) -> dict[str, Any]:
    target = str(data.get("target_sentence") or "").strip()
    if not target:
        target = "（未提供分析句）"
        data["target_sentence"] = target

    if data.get("components"):
        components = [ComponentSchema.model_validate(item) for item in data["components"]]
        components = _merge_clause_components(components)
        components = _repair_components_against_target(components, target)
        if not _components_match_target(components, target):
            components = _fallback_sentence_components(target)
            summary = str(data.get("summary") or "").strip()
            note = "（成分对齐失败，仅展示原句）"
            data["summary"] = f"{summary} {note}".strip() if summary else note
        data["components"] = [comp.model_dump() for comp in components]
        return data

    highlights_raw = data.get("highlights") or []
    highlights = [HighlightSchema.model_validate(item) for item in highlights_raw]
    if not highlights:
        data["components"] = [comp.model_dump() for comp in _fallback_sentence_components(target)]
        if not str(data.get("summary") or "").strip():
            data["summary"] = "未返回成分结构，仅展示原句"
        return data

    components = _highlights_to_components(highlights)
    components = _repair_components_against_target(components, target)
    if not _components_match_target(components, target):
        components = _fallback_sentence_components(target)
    data["components"] = [comp.model_dump() for comp in components]
    return data


def _normalize_for_compare(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def _pick_nonempty_str(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _coerce_solving_analysis(
    data: Any,
    *,
    correct_answer_fallback: str,
    wrong_answer_fallback: str,
) -> dict[str, Any]:
    payload = data if isinstance(data, dict) else {}

    explanation = _pick_nonempty_str(
        payload,
        "explanation",
        "analysis",
        "reason",
        "why",
        "detail",
        "content",
        "description",
        "解析",
        "说明",
        "讲解",
    )
    if not explanation:
        ignored_keys = {
            "correct_answer",
            "correct_answer_text",
            "wrong_answer",
            "wrong_answer_text",
            "question_type",
            "question_type_name",
            "knowledge_tags",
            "knowledge_points",
        }
        extra_parts = [
            str(value).strip()
            for key, value in payload.items()
            if key not in ignored_keys and isinstance(value, str) and value.strip()
        ]
        explanation = "\n".join(extra_parts) if extra_parts else "（AI 未返回详细解析，请重新分析）"

    correct_answer = _pick_nonempty_str(
        payload, "correct_answer", "answer", "correct_option", "正确答案"
    ) or correct_answer_fallback
    correct_answer_text = _pick_nonempty_str(
        payload, "correct_answer_text", "answer_text", "correct_option_text", "正确答案内容"
    ) or correct_answer
    wrong_answer = _pick_nonempty_str(
        payload, "wrong_answer", "student_answer", "wrong_option", "错选", "学生错选"
    ) or wrong_answer_fallback
    wrong_answer_text = _pick_nonempty_str(
        payload, "wrong_answer_text", "student_answer_text", "wrong_option_text", "错选内容"
    ) or wrong_answer

    return {
        "correct_answer": correct_answer,
        "correct_answer_text": correct_answer_text,
        "wrong_answer": wrong_answer,
        "wrong_answer_text": wrong_answer_text,
        "explanation": explanation,
    }


def _normalize_sentence_analysis_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    sa = _coerce_legacy_sentence_analysis(raw)
    target = str(sa.get("target_sentence") or "").strip()
    # 拒绝把整段长文当作单句（粗略保护）
    if target.count(".") + target.count("!") + target.count("?") > 4 and len(target) > 280:
        # 尽量截取第一句
        m = re.search(r"(.+?[.!?])(\s|$)", target)
        if m:
            sa["target_sentence"] = m.group(1).strip()
            summary = str(sa.get("summary") or "").strip()
            note = "（已截取为首句，避免整段材料）"
            sa["summary"] = f"{summary} {note}".strip() if summary else note
    if not str(sa.get("summary") or "").strip():
        sa["summary"] = "句法要点见标注"
    focus = sa.get("focus")
    sa = _ensure_components(sa)
    if isinstance(focus, str) and focus.strip():
        sa["focus"] = focus.strip()
    elif "focus" in sa:
        sa.pop("focus", None)
    return sa


def _normalize_ai_payload(
    parsed: dict[str, Any],
    *,
    correct_answer_fallback: str,
    wrong_answer_fallback: str,
    preferred_targets: list[str] | None = None,
) -> dict[str, Any]:
    normalized = dict(parsed)

    analyses: list[dict[str, Any]] = []
    raw_list = normalized.get("sentence_analyses")
    if isinstance(raw_list, list):
        for item in raw_list:
            fixed = _normalize_sentence_analysis_item(item)
            if fixed:
                analyses.append(fixed)
    if not analyses and isinstance(normalized.get("sentence_analysis"), dict):
        fixed = _normalize_sentence_analysis_item(normalized["sentence_analysis"])
        if fixed:
            analyses.append(fixed)

    targets = [t.strip() for t in (preferred_targets or []) if t and t.strip()][:3]
    if targets:
        aligned: list[dict[str, Any]] = []
        for idx, target in enumerate(targets):
            source = analyses[idx] if idx < len(analyses) else None
            if source and _normalize_for_compare(source.get("target_sentence", "")) == _normalize_for_compare(
                target
            ):
                aligned.append(source)
                continue
            # 指定句优先：用用户句子覆盖 target，并尽量复用已有 components
            base = dict(source) if source else {}
            base["target_sentence"] = target
            base["focus"] = base.get("focus") or f"selected_{idx + 1}"
            if not str(base.get("summary") or "").strip():
                base["summary"] = f"指定分析句 {idx + 1}"
            fixed = _normalize_sentence_analysis_item(base)
            if fixed:
                aligned.append(fixed)
        analyses = aligned

    if not analyses:
        analyses.append(
            _normalize_sentence_analysis_item(
                {
                    "target_sentence": "（未能抽取考查句）",
                    "summary": "本题以做题分析为主，未返回可用的句子成分",
                    "components": [],
                }
            )
            or {
                "target_sentence": "（未能抽取考查句）",
                "summary": "本题以做题分析为主，未返回可用的句子成分",
                "components": [comp.model_dump() for comp in _fallback_sentence_components("（未能抽取考查句）")],
            }
        )

    analyses = analyses[:3]
    normalized["sentence_analyses"] = analyses
    normalized["sentence_analysis"] = analyses[0]

    solving = normalized.get("solving_analysis")
    if not isinstance(solving, dict):
        solving = {}

    # AI 有时把做题分析字段散落在根节点
    for key in (
        "explanation",
        "analysis",
        "reason",
        "correct_answer",
        "correct_answer_text",
        "wrong_answer",
        "wrong_answer_text",
    ):
        if key not in solving and key in normalized and isinstance(normalized[key], str):
            solving[key] = normalized[key]

    normalized["solving_analysis"] = _coerce_solving_analysis(
        solving,
        correct_answer_fallback=correct_answer_fallback,
        wrong_answer_fallback=wrong_answer_fallback,
    )
    return normalized


def _normalize_sentence_text(text: str) -> str:
    return text.replace("\u00a0", " ").strip()


def _join_highlight_text(highlights: list[HighlightSchema]) -> str:
    return _normalize_sentence_text("".join(item.text for item in highlights))


def _coerce_legacy_sentence_analysis(data: dict[str, Any]) -> dict[str, Any]:
    """兼容旧版 clauses 结构，转换为 highlights。"""
    if "highlights" in data and data["highlights"]:
        return data
    clauses = data.get("clauses")
    if not clauses:
        return data
    highlights: list[dict[str, Any]] = []
    for clause in clauses:
        segments = clause.get("segments") or []
        for idx, segment in enumerate(segments):
            if idx > 0 and highlights and not highlights[-1]["text"].endswith(" "):
                # 旧数据片段之间补空格，尽量保持句子连贯
                prev = highlights[-1]["text"]
                next_text = segment.get("text", "")
                if prev and next_text and not prev[-1].isspace() and not next_text[0].isspace():
                    highlights.append({"text": " ", "role": "neutral", "role_label": "", "is_clause": False})
            highlights.append(
                {
                    "text": segment.get("text", ""),
                    "role": segment.get("role", "neutral"),
                    "role_label": segment.get("role_label", ""),
                    "pos": segment.get("pos", ""),
                    "pos_label": segment.get("pos_label", ""),
                    "group_id": segment.get("group_id"),
                    "is_head": bool(segment.get("is_head", False)),
                    "is_clause": bool(segment.get("is_clause", False)),
                }
            )
    return {**data, "highlights": highlights}


def _strip_model_noise(raw: str) -> str:
    """去掉模型思考标签、杂讯，便于从混合输出里抽 JSON。"""
    text = (raw or "").strip()
    if not text:
        return ""
    # Qwen / 部分兼容接口会把思考过程包在 think 标签里
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?think>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<thinking>[\s\S]*?</thinking>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?thinking>", "", text, flags=re.IGNORECASE)
    return text.strip()


def _extract_json_payload(raw: str) -> dict[str, Any]:
    text = _strip_model_noise(raw)
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("JSON root must be an object")
    return parsed


def _format_options(options: list[Any]) -> str:
    if not options:
        return "（无选项）"
    lines: list[str] = []
    for idx, option in enumerate(options):
        if isinstance(option, list):
            lines.append(f"第{idx + 1}组: " + " | ".join(option))
        else:
            lines.append(str(option))
    return "\n".join(lines)


def _format_answers(answers: list[Any]) -> str:
    parts: list[str] = []
    for answer in answers:
        if answer is None:
            parts.append("（空）")
        elif isinstance(answer, list):
            parts.append(" / ".join(str(item) for item in answer))
        else:
            parts.append(str(answer))
    return "，".join(parts) if parts else "（无）"


def _is_long_passage_type(question_type_name: str) -> bool:
    name = question_type_name or ""
    keywords = ("完形", "阅读", "填空", "短文", "语篇", "cloze", "passage", "reading")
    lower = name.lower()
    return any(k.lower() in lower if k.isascii() else k in name for k in keywords)


def build_user_prompt(
    *,
    stem: str,
    options: list[Any],
    correct_answer: list[Any],
    wrong_answer: list[Any],
    question_type_name: str,
    knowledge_tag_names: list[str],
    note: str | None,
    focus_sentences: list[str] | None = None,
) -> str:
    tags = "、".join(knowledge_tag_names) if knowledge_tag_names else "（未标注）"
    focus = [s.strip() for s in (focus_sentences or []) if s and s.strip()][:3]

    if focus:
        focus_block = "\n".join(f"{idx + 1}. {sentence}" for idx, sentence in enumerate(focus))
        focus_hint = f"""请特别注意（用户已指定分析句）：
1. 成分分析必须且仅针对下列句子，sentence_analyses 与下列一一对应（最多 {len(focus)} 句）。
2. 每句的 target_sentence 必须与指定句一致（可保留空格符号），不要改写，不要分析整段材料。
3. 做题分析仍结合完整题干与答案；正确答案必须严格对应上方【正确答案】字段。
4. 必须使用 components + tokens 分层结构。

【指定分析句】
{focus_block}"""
    else:
        long_passage = _is_long_passage_type(question_type_name)
        focus_hint = (
            """请特别注意（长文/填空题）：
1. 禁止把整段材料写入 target_sentence。
2. 只抽取含空格/横线/考查点的完整单句，放入 sentence_analyses（最多 3 句）。
3. 做题分析要结合空前空后语境；正确答案必须严格对应上方【正确答案】字段。
4. 必须使用 components + tokens 分层结构。"""
            if long_passage
            else """请特别注意：
1. 若题干含空格/横线填空，请分析含考查点的完整句子；多句时用 sentence_analyses。
2. 做题分析中的正确答案必须严格对应上方【正确答案】字段。
3. 必须使用 components + tokens 分层结构，不要只返回扁平 highlights。"""
        )

    return f"""请分析以下英语错题。句子成分用 components 分层返回（第一层主谓宾定状补，第二层 tokens 标词性）。

【题型】{question_type_name}
【知识点】{tags}
【题干】
{stem}

【选项】
{_format_options(options)}

【正确答案】{_format_answers(correct_answer)}
【学生错选】{_format_answers(wrong_answer)}
【备注】{note or "（无）"}

{focus_hint}"""


async def analyze_wrong_question(
    *,
    stem: str,
    options: list[Any],
    correct_answer: list[Any],
    wrong_answer: list[Any],
    question_type_name: str,
    knowledge_tag_names: list[str],
    note: str | None,
    focus_sentences: list[str] | None = None,
) -> tuple[AiAnalysisResult, str]:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")

    focus = [s.strip() for s in (focus_sentences or []) if s and s.strip()][:3]
    user_prompt = build_user_prompt(
        stem=stem,
        options=options,
        correct_answer=correct_answer,
        wrong_answer=wrong_answer,
        question_type_name=question_type_name,
        knowledge_tag_names=knowledge_tag_names,
        note=note,
        focus_sentences=focus,
    )

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    parsed = _normalize_ai_payload(
        parsed,
        correct_answer_fallback=_format_answers(correct_answer),
        wrong_answer_fallback=_format_answers(wrong_answer),
        preferred_targets=focus or None,
    )
    result = AiAnalysisResult.model_validate(parsed)
    return result, settings.deepseek_model


def serialize_ai_analysis(
    result: AiAnalysisResult,
    *,
    analyzed_at: datetime,
    model: str,
) -> dict[str, Any]:
    analyses = [item.model_dump() for item in result.sentence_analyses]
    return {
        "sentence_analysis": analyses[0],
        "sentence_analyses": analyses,
        "solving_analysis": result.solving_analysis.model_dump(),
        "analyzed_at": analyzed_at.isoformat(),
        "model": model,
    }


WEAKNESS_SYSTEM_PROMPT = """你是资深英语学习教练，擅长根据错题统计诊断学习短板并给出可执行建议。
请严格返回 JSON（不要 markdown 代码块，不要额外文字）。

输出格式：
{
  "overall_summary": "用 2～4 句中文概括当前主要薄弱点与整体水平",
  "weak_areas": [
    {
      "name": "短板名称（如：一般过去时 / 定语从句 / 词义辨析）",
      "severity": "high|medium|low",
      "evidence": "结合错误率与题型/知识点的依据（中文）",
      "related_question_ids": [1, 2]
    }
  ],
  "gap_fill_suggestions": [
    "针对短板的补全建议（具体、可执行，中文）"
  ],
  "study_methods": [
    "学习方法建议（方法与节奏，中文）"
  ],
  "weekly_plan": [
    "第1天：……",
    "第2天：……"
  ]
}

要求：
1. weak_areas 按严重程度排序，通常 3～6 项；related_question_ids 必须来自输入列表。
2. gap_fill_suggestions、study_methods 各 3～6 条，避免空话。
3. weekly_plan 给出 5～7 天轻量计划即可。
4. 若数据不足，仍给出谨慎结论，并在 overall_summary 中说明局限。"""


class WeakAreaSchema(BaseModel):
    name: str = Field(min_length=1)
    severity: str = "medium"
    evidence: str = ""
    related_question_ids: list[int] = Field(default_factory=list)


class LearningWeaknessResult(BaseModel):
    overall_summary: str = Field(min_length=1)
    weak_areas: list[WeakAreaSchema] = Field(default_factory=list)
    gap_fill_suggestions: list[str] = Field(default_factory=list)
    study_methods: list[str] = Field(default_factory=list)
    weekly_plan: list[str] = Field(default_factory=list)


def _truncate_stem(stem: str, max_len: int = 180) -> str:
    text = re.sub(r"\s+", " ", (stem or "").strip())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def build_weakness_user_prompt(
    *,
    items: list[dict[str, Any]],
    username: str | None,
    scope_note: str,
) -> str:
    lines: list[str] = []
    for idx, item in enumerate(items, start=1):
        error_rate = item.get("error_rate")
        error_pct = f"{float(error_rate) * 100:.1f}%" if isinstance(error_rate, (int, float)) else "--"
        tags = "、".join(item.get("knowledge_tag_names") or []) or "（未标注）"
        qtype = item.get("question_type_name") or "（未知题型）"
        lines.append(
            f"{idx}. ID={item.get('wrong_question_id')} | 错误率 {error_pct} "
            f"| 作答 {item.get('total_attempts')} 次（对 {item.get('correct_attempts')}） "
            f"| 题型 {qtype} | 知识点 {tags}\n"
            f"   题干：{_truncate_stem(str(item.get('stem') or ''))}"
        )

    who = f"学习者「{username}」"
    return f"""请根据以下高错误率错题 Top {len(items)}，诊断{who}的英语学习短板，并给出补全建议与学习方法。

【分析范围】{scope_note}

【高错误率题目】
{chr(10).join(lines) if lines else "（无数据）"}

请输出 JSON。"""


def _coerce_str_list(value: Any) -> list[str]:
    """把模型返回的 list/str 统一成非空字符串列表。

    注意：若直接对 str 做 for 循环，会按「单字」拆开，前端再用「；」拼接后变成一字一顿。
    """
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if not isinstance(value, list):
        text = str(value).strip()
        return [text] if text else []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append(item.strip())
        elif isinstance(item, dict):
            text = item.get("text") or item.get("content") or item.get("title")
            if isinstance(text, str) and text.strip():
                result.append(text.strip())
        elif item is not None:
            text = str(item).strip()
            if text:
                result.append(text)
    return result


def _normalize_weakness_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    summary = _pick_nonempty_str(
        parsed, "overall_summary", "summary", "overview", "总评", "概述"
    ) or "（未能生成总评，请重试）"

    raw_areas = parsed.get("weak_areas") or parsed.get("weaknesses") or []
    areas: list[dict[str, Any]] = []
    if isinstance(raw_areas, list):
        for item in raw_areas:
            if not isinstance(item, dict):
                continue
            name = _pick_nonempty_str(item, "name", "title", "area", "短板")
            if not name:
                continue
            severity = str(item.get("severity") or "medium").strip().lower()
            if severity not in {"high", "medium", "low"}:
                severity = "medium"
            ids_raw = item.get("related_question_ids") or item.get("question_ids") or []
            related_ids: list[int] = []
            if isinstance(ids_raw, list):
                for qid in ids_raw:
                    if isinstance(qid, int):
                        related_ids.append(qid)
                    elif isinstance(qid, str) and qid.strip().isdigit():
                        related_ids.append(int(qid.strip()))
            areas.append(
                {
                    "name": name,
                    "severity": severity,
                    "evidence": _pick_nonempty_str(item, "evidence", "reason", "依据") or "",
                    "related_question_ids": related_ids[:10],
                }
            )

    return {
        "overall_summary": summary,
        "weak_areas": areas,
        "gap_fill_suggestions": _coerce_str_list(
            parsed.get("gap_fill_suggestions") or parsed.get("suggestions") or parsed.get("补全建议")
        ),
        "study_methods": _coerce_str_list(
            parsed.get("study_methods") or parsed.get("methods") or parsed.get("学习方法")
        ),
        "weekly_plan": _coerce_str_list(parsed.get("weekly_plan") or parsed.get("plan") or parsed.get("计划")),
    }


async def analyze_learning_weaknesses(
    *,
    items: list[dict[str, Any]],
    username: str | None = None,
    scope_note: str = "高错误率 Top 统计",
) -> tuple[LearningWeaknessResult, str]:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    if not items:
        raise RuntimeError("暂无高错误率题目数据，无法分析")

    user_prompt = build_weakness_user_prompt(
        items=items,
        username=username,
        scope_note=scope_note,
    )
    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": WEAKNESS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    normalized = _normalize_weakness_payload(parsed if isinstance(parsed, dict) else {})
    result = LearningWeaknessResult.model_validate(normalized)
    return result, settings.deepseek_model


KNOWLEDGE_LESSON_SYSTEM_PROMPT = """你是温暖、专业的中学英语私教。针对一个薄弱知识点，先讲清楚，再出一道**偏基础**的小测题。
请严格返回 JSON（不要 markdown 代码块，不要额外文字）。

输出格式：
{
  "knowledge_point": "知识点名称",
  "explanation": "用通俗中文讲解核心规则（2～5 句，尽量口语化）",
  "key_points": ["要点1", "要点2", "要点3"],
  "examples": [
    {
      "sentence": "英文例句（短、常用）",
      "translation": "中文翻译",
      "analysis": "一句中文说明该例句如何体现知识点"
    }
  ],
  "quiz": {
    "stem": "小测题干（短句，词汇简单，可含空格）",
    "options": ["A. xxx", "B. xxx", "C. xxx", "D. xxx"],
    "correct_answer": "B",
    "hint": "可选提示（中文，给一点线索）"
  }
}

要求：
1. examples 给 2～3 个，用日常短句，不要长难句。
2. quiz 必须是单选题，correct_answer 只写选项字母（如 A/B/C/D）。
3. **难度要偏基础、入门级**：一眼能上手；干扰项明显；避免偏难怪词、复杂从句、多重考点。
4. 题干与选项词汇控制在初中常见词；优先考查「规则是否记住」，而不是阅读能力。
5. 语气鼓励，讲解准确。"""


KNOWLEDGE_GRADE_SYSTEM_PROMPT = """你是一位情绪价值拉满、略带浮夸的中学英语教练。请批改学生作答，并给出**每次都不一样**的夸张鼓励/安慰。
请严格返回 JSON（不要 markdown 代码块）。

输出格式：
{
  "is_correct": true,
  "correct_answer": "B",
  "brief_explanation": "",
  "encouragement": "直接表扬或鼓励的文案（中文，浮夸、生动、有画面感，1～3 句）"
}

要求：
1. is_correct 必须根据标准答案准确判断（忽略大小写与前后空格）。
2. encouragement **必须每次重新创作**，禁止套话模板；要浮夸一点，像给朋友打气。
3. **不要写知识点解析、对错原因分析**；brief_explanation 固定为空字符串。
4. 答对：直接大力表扬（可夸张），肯定聪明/努力，可带一点点可爱的夸张比喻。
5. 答错：直接安慰鼓励「千万别放弃」，给情绪价值；可以说「错过也是成长剧情」之类，但不要假到离谱到侮辱智商；不要展开讲语法。
6. 不要用「加油」「继续努力」这种干巴巴结尾当全文；要有具体情绪。"""


class KnowledgeExampleSchema(BaseModel):
    sentence: str = ""
    translation: str = ""
    analysis: str = ""


class KnowledgeQuizSchema(BaseModel):
    stem: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)
    correct_answer: str = Field(min_length=1)
    hint: str = ""


class KnowledgeLessonResult(BaseModel):
    knowledge_point: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    key_points: list[str] = Field(default_factory=list)
    examples: list[KnowledgeExampleSchema] = Field(default_factory=list)
    quiz: KnowledgeQuizSchema
    model: str = ""


class KnowledgeGradeResult(BaseModel):
    is_correct: bool
    correct_answer: str
    brief_explanation: str = ""
    encouragement: str = Field(min_length=1)
    model: str = ""


def _normalize_knowledge_lesson(parsed: dict[str, Any], fallback_name: str) -> dict[str, Any]:
    quiz_raw = parsed.get("quiz") if isinstance(parsed.get("quiz"), dict) else {}
    options = quiz_raw.get("options") if isinstance(quiz_raw.get("options"), list) else []
    option_texts = [str(x).strip() for x in options if str(x).strip()]
    correct = str(quiz_raw.get("correct_answer") or "").strip() or "A"
    m = re.match(r"^([A-Da-d])\b", correct)
    if m:
        correct = m.group(1).upper()
    else:
        correct = correct[:1].upper() if correct else "A"

    examples_raw = parsed.get("examples") if isinstance(parsed.get("examples"), list) else []
    examples: list[dict[str, str]] = []
    for item in examples_raw:
        if not isinstance(item, dict):
            continue
        examples.append(
            {
                "sentence": str(item.get("sentence") or item.get("en") or "").strip(),
                "translation": str(item.get("translation") or item.get("zh") or "").strip(),
                "analysis": str(item.get("analysis") or "").strip(),
            }
        )

    key_points = _coerce_str_list(parsed.get("key_points") or parsed.get("要点"))
    return {
        "knowledge_point": _pick_nonempty_str(parsed, "knowledge_point", "name", "title") or fallback_name,
        "explanation": _pick_nonempty_str(parsed, "explanation", "content", "讲解")
        or "（暂未返回讲解，请重试）",
        "key_points": key_points,
        "examples": examples,
        "quiz": {
            "stem": _pick_nonempty_str(quiz_raw, "stem", "question") or "Please choose the best answer.",
            "options": option_texts or ["A. option1", "B. option2", "C. option3", "D. option4"],
            "correct_answer": correct,
            "hint": str(quiz_raw.get("hint") or "").strip(),
        },
    }


async def analyze_knowledge_point_lesson(
    *,
    knowledge_point: str,
    evidence: str | None = None,
    overall_summary: str | None = None,
) -> KnowledgeLessonResult:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    name = knowledge_point.strip()
    if not name:
        raise RuntimeError("知识点名称不能为空")

    user_prompt = f"""请针对以下英语薄弱知识点进行讲解，并出一道**偏基础、易上手**的单选小测题。

【知识点】{name}
【诊断依据】{evidence or "（无）"}
【学习者总评背景】{overall_summary or "（无）"}

注意：小测题要简单直接，让初学者也能较快做对；干扰项要明显。

请返回 JSON。"""

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": KNOWLEDGE_LESSON_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.45,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    normalized = _normalize_knowledge_lesson(parsed if isinstance(parsed, dict) else {}, name)
    return KnowledgeLessonResult.model_validate({**normalized, "model": settings.deepseek_model})


KNOWLEDGE_QUIZ_SYSTEM_PROMPT = """你是中学英语私教。针对一个薄弱知识点，只出一道**偏基础**的单选小测题。
请严格返回 JSON（不要 markdown 代码块，不要额外文字）。

输出格式：
{
  "stem": "小测题干（短句，词汇简单，可含空格）",
  "options": ["A. xxx", "B. xxx", "C. xxx", "D. xxx"],
  "correct_answer": "B",
  "hint": ""
}

要求：
1. 必须是单选题，correct_answer 只写选项字母（如 A/B/C/D）。
2. 难度偏基础、入门级；干扰项明显；避免偏难怪词、复杂从句、多重考点。
3. 题干与选项用初中常见词；优先考查「规则是否记住」。
4. 若提供了「已出过的题干」，必须换全新题干与选项，不要简单改词复用。
5. hint 固定返回空字符串。"""


def _normalize_knowledge_quiz(parsed: dict[str, Any]) -> dict[str, Any]:
    options = parsed.get("options") if isinstance(parsed.get("options"), list) else []
    option_texts = [str(x).strip() for x in options if str(x).strip()]
    correct = str(parsed.get("correct_answer") or "").strip() or "A"
    m = re.match(r"^([A-Da-d])\b", correct)
    if m:
        correct = m.group(1).upper()
    else:
        correct = correct[:1].upper() if correct else "A"
    return {
        "stem": _pick_nonempty_str(parsed, "stem", "question") or "Please choose the best answer.",
        "options": option_texts or ["A. option1", "B. option2", "C. option3", "D. option4"],
        "correct_answer": correct,
        "hint": "",
    }


async def generate_knowledge_point_quiz(
    *,
    knowledge_point: str,
    evidence: str | None = None,
    avoid_stems: list[str] | None = None,
) -> KnowledgeQuizSchema:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    name = knowledge_point.strip()
    if not name:
        raise RuntimeError("知识点名称不能为空")

    avoided = [s.strip() for s in (avoid_stems or []) if s and str(s).strip()]
    avoid_block = ""
    if avoided:
        lines = "\n".join(f"- {s}" for s in avoided[-8:])
        avoid_block = f"\n【已出过的题干（请换新题，不要雷同）】\n{lines}\n"

    user_prompt = f"""请针对以下英语薄弱知识点，再出一道**偏基础、易上手**的全新单选小测题。

【知识点】{name}
【诊断依据】{evidence or "（无）"}
{avoid_block}
注意：题干与选项要和已出过的题明显不同。

请返回 JSON。"""

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": KNOWLEDGE_QUIZ_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.75,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    normalized = _normalize_knowledge_quiz(parsed if isinstance(parsed, dict) else {})
    return KnowledgeQuizSchema.model_validate(normalized)


def _answers_match(user_answer: str, correct_answer: str, options: list[str]) -> bool:
    ua = user_answer.strip()
    ca = correct_answer.strip()
    if not ua:
        return False
    if ua.upper() == ca.upper():
        return True
    ua_letter = re.match(r"^([A-Da-d])\b", ua)
    ca_letter = re.match(r"^([A-Da-d])\b", ca)
    if ua_letter and ca_letter and ua_letter.group(1).upper() == ca_letter.group(1).upper():
        return True
    for opt in options:
        text = opt.strip()
        letter_m = re.match(r"^([A-Da-d])[\.\):、\s]+(.+)$", text)
        if letter_m and letter_m.group(1).upper() == ca.upper():
            if ua == text or ua == letter_m.group(2).strip() or ua.upper() == letter_m.group(1).upper():
                return True
    return False


async def grade_knowledge_point_quiz(
    *,
    knowledge_point: str,
    quiz_stem: str,
    options: list[str],
    correct_answer: str,
    user_answer: str,
) -> KnowledgeGradeResult:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")

    is_correct = _answers_match(user_answer, correct_answer, options)
    vibe = (
        "答对了，请直接用浮夸但真诚的语气大力夸奖，不要讲解析"
        if is_correct
        else "答错了，请直接用力安慰、给情绪价值，强调不要放弃；不要讲语法或对错原因"
    )
    user_prompt = f"""请批改并写出**本次专属**的浮夸鼓励/安慰文案（不要重复常见套话，不要写解析）。

【知识点】{knowledge_point}
【题干】{quiz_stem}
【选项】
{chr(10).join(options) if options else "（无）"}
【标准答案】{correct_answer}
【学生作答】{user_answer or "（空）"}
【系统预判】{"正确" if is_correct else "错误"}
【情绪方向】{vibe}

请返回 JSON。encouragement 要动态创作、略浮夸、有画面感；brief_explanation 请返回空字符串。"""

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": KNOWLEDGE_GRADE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.9,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    payload_dict = parsed if isinstance(parsed, dict) else {}

    encouragement = _pick_nonempty_str(payload_dict, "encouragement", "鼓励", "message")
    if not encouragement:
        encouragement = (
            "天呐这也太稳了！你这一下直接把知识点拿捏得死死的，英语星球的光都在你身上闪！再接再厉，下一题继续发光！"
            if is_correct
            else "嘿，错一次算什么！这只是成长副本里的小怪，你已经亮剑了。别放弃，整理一下再冲，你绝对能打过！"
        )
    ca = correct_answer.strip()
    ca_out = ca[:1].upper() if re.match(r"^[A-Da-d]", ca) else ca

    return KnowledgeGradeResult(
        is_correct=is_correct,
        correct_answer=ca_out,
        brief_explanation="",
        encouragement=encouragement,
        model=settings.deepseek_model,
    )


# 难度口径与 frontend/src/utils/difficulty.ts 保持一致。
EXTRACT_SYSTEM_PROMPT = """你是英语试卷视觉识别与结构化抽取助手。
请直接阅读题目图片，识别并拆分为错题列表，严格返回 JSON（不要 markdown 代码块，不要额外文字）。

输出格式：
{
  "raw_text": "图片中整理后的题目文字（尽量完整，保留填空横线）",
  "items": [
    {
      "stem": "题干全文（含材料/空格，空格用 _____ 表示）",
      "options": ["A.xxx", "B.xxx"] 或 [["A1","B1"],["A2","B2"]] 或 [],
      "correct_answer": ["B"] 或 ["has","been"],
      "wrong_answer": ["C"] 或 ["have","was"],
      "question_type_name": "必须从给定题型名称中选一个",
      "knowledge_tag_names": [],
      "difficulty": 1到5的整数或 null,
      "source": "来源猜测或 null",
      "note": "补充说明或 null",
      "confidence": 0到1的小数,
      "warnings": ["不确定处说明"]
    }
  ]
}

规则：
1. 一张图可能有多道题，每题一个 item；无关页眉页脚忽略。
2. options：单选一维数组；完形/阅读多小题用二维数组；填空无选项用 []。
3. correct_answer / wrong_answer：必须是数组。若图中看不出学生错答，wrong_answer 可填与正确答案不同的合理错例，并在 warnings 说明「错答为推断」；若完全无法判断，填 [""] 并在 warnings 说明。
4. question_type_name 只能从用户提供的题型目录中选择；不确定时选最接近的并写入 warnings。
5. knowledge_tag_names 固定返回空数组 []，知识点交给人工后续标注，不要猜测填写。
6. 保持英文原文，不要翻译题干；尽量保留填空横线与选项字母。
7. **题号忽略**：若题目前有明显序号（如 61. / 62、 / （3） / 第12题），stem 中不要写入该序号，从真正题干文字开始。
8. **难度 difficulty 必须给 1–5 整数**（题目完全看不清时才用 null）。评的是题目本身的认知负担，不是学生有没有做错。口径（英语试题，介于两档就低不就高）：
   - 1 入门：课标最常用词、单一考点、选项一眼可分、几乎不需上下文。
   - 2 基础：核心词汇/常见搭配、一个主要考点、读完题干即可、干扰弱。
   - 3 中等：需结合句意或短上下文、干扰有一定迷惑、可能含从句或短完形语境。
   - 4 较难：复合考点或较长语境、近义/形近干扰强、需排除或推断。
   - 5 挑战：多步推理、篇章主旨/态度、长难句或隐蔽易错点。
   判定顺序：材料长度与题型 → 考点是否复合 → 干扰强度。拿不准标 3，并在 warnings 写「难度为估计」。卷面若有星级/难易标记，换算到 1–5。"""


def _build_extract_user_text(
    *,
    question_types: list[dict[str, Any]],
    knowledge_tags: list[dict[str, Any]],
) -> str:
    type_lines = (
        "\n".join(f"- id={t['id']} category={t.get('category') or '其他'} name={t['name']}" for t in question_types)
        or "- （无）"
    )
    tag_lines = "\n".join(f"- id={t['id']} name={t['name']}" for t in knowledge_tags) or "- （无）"
    return f"""请识别下列英语试卷/错题图片，抽取为结构化错题列表。
注意：题目前若有明显题号/序号，请在 stem 中省略，不要保留。

【可选题型目录】
{type_lines}

【可选知识点目录】
{tag_lines}

请为每题按 1–5 难度口径填写 difficulty，然后返回 raw_text + items JSON。"""


def _strip_leading_question_number(stem: str) -> str:
    """去掉题干开头的明显题号，如 61. / 62、 / （3） / 第12题。"""
    text = (stem or "").strip()
    if not text:
        return text
    patterns = (
        r"^第\s*\d{1,3}\s*(?:题|小题)?\s*[.．、:：)）]?\s*",
        r"^[（(]\s*\d{1,3}\s*[)）]\s*",
        r"^\d{1,3}\s*[.．、:：)）]\s*",
    )
    for pattern in patterns:
        stripped = re.sub(pattern, "", text, count=1).strip()
        if stripped and stripped != text:
            return stripped
    return text


def _resolve_ids_from_names(
    item: dict[str, Any],
    *,
    type_by_name: dict[str, int],
    tag_by_name: dict[str, int],
) -> dict[str, Any]:
    warnings = _coerce_str_list(item.get("warnings"))

    type_name = str(item.get("question_type_name") or "").strip()
    question_type_id = item.get("question_type_id")
    if question_type_id is None and type_name:
        question_type_id = type_by_name.get(type_name)
        if question_type_id is None:
            for name, tid in type_by_name.items():
                if type_name in name or name in type_name:
                    question_type_id = tid
                    type_name = name
                    break
        if question_type_id is None:
            warnings.append(f"未能匹配题型「{type_name}」，请人工选择")

    tag_names = item.get("knowledge_tag_names") or []
    if not isinstance(tag_names, list):
        tag_names = []
    knowledge_tag_ids: list[int] = []
    for raw in tag_names:
        name = str(raw).strip()
        if not name:
            continue
        tid = tag_by_name.get(name)
        if tid is None:
            for n, i in tag_by_name.items():
                if name in n or n in name:
                    tid = i
                    break
        if tid is not None:
            if tid not in knowledge_tag_ids:
                knowledge_tag_ids.append(tid)
        else:
            warnings.append(f"未能匹配知识点「{name}」")

    existing_ids = item.get("knowledge_tag_ids")
    if isinstance(existing_ids, list):
        for tid in existing_ids:
            if isinstance(tid, int) and tid not in knowledge_tag_ids:
                knowledge_tag_ids.append(tid)

    options = item.get("options")
    if not isinstance(options, list):
        options = []

    correct = item.get("correct_answer")
    if not isinstance(correct, list) or not correct:
        correct = [""]
        warnings.append("正确答案缺失，请人工填写")

    wrong = item.get("wrong_answer")
    if not isinstance(wrong, list) or not wrong:
        wrong = [""]
        warnings.append("学生错答缺失，请人工填写")

    confidence = item.get("confidence")
    try:
        confidence_f = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence_f = None

    difficulty = item.get("difficulty")
    try:
        difficulty_i = int(difficulty) if difficulty is not None else None
        if difficulty_i is not None and not (1 <= difficulty_i <= 5):
            difficulty_i = None
    except (TypeError, ValueError):
        difficulty_i = None

    return {
        "stem": _strip_leading_question_number(str(item.get("stem") or "")),
        "options": options,
        "correct_answer": correct,
        "wrong_answer": wrong,
        "question_type_id": question_type_id if isinstance(question_type_id, int) else None,
        "question_type_name": type_name or None,
        "knowledge_tag_ids": knowledge_tag_ids,
        "knowledge_tag_names": [str(n) for n in tag_names if str(n).strip()],
        "difficulty": difficulty_i,
        "source": (str(item["source"]).strip() if item.get("source") else None) or None,
        "note": (str(item["note"]).strip() if item.get("note") else None) or None,
        "confidence": confidence_f,
        "warnings": warnings,
    }


def _vision_auth_headers() -> dict[str, str]:
    api_key = (settings.vision_api_key or settings.deepseek_api_key or "").strip()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _prepare_vision_image(raw: bytes, *, max_side: int = 1600, quality: int = 85) -> tuple[str, bytes]:
    """压缩过大图片，避免本地 VL 因超高分辨率超时/OOM。"""
    import io

    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RuntimeError("缺少依赖 pillow，请执行: pip install pillow") from exc

    with Image.open(io.BytesIO(raw)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")

        w, h = img.size
        longest = max(w, h)
        if longest > max_side:
            scale = max_side / float(longest)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return "image/jpeg", out.getvalue()


def _coerce_answer_list(value: Any) -> list[Any]:
    if value is None:
        return [""]
    if isinstance(value, list):
        return value if value else [""]
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else [""]
    return [str(value)]


def _coerce_options(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    cleaned: list[Any] = []
    for item in value:
        if isinstance(item, str):
            if item.strip():
                cleaned.append(item.strip())
        elif isinstance(item, list):
            group = [str(x).strip() for x in item if str(x).strip()]
            if group:
                cleaned.append(group)
        elif item is not None:
            cleaned.append(str(item))
    return cleaned


async def extract_questions_from_images(
    *,
    images: list[tuple[str, bytes]],
    question_types: list[dict[str, Any]],
    knowledge_tags: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str | None, str]:
    """用本地/兼容 OpenAI 的视觉大模型直接看图识别错题。

    images: [(mime_type, raw_bytes), ...]
    返回: (items, raw_text, model_name)
    """
    import base64

    if not images:
        raise ValueError("至少需要一张图片")

    base_url = (settings.vision_base_url or "").strip().rstrip("/")
    model = (settings.vision_model or "").strip()
    if not base_url or not model:
        raise RuntimeError(
            "未配置视觉模型。请在 .env 设置 VISION_BASE_URL / VISION_MODEL / VISION_API_KEY"
            "（千问示例：https://dashscope.aliyuncs.com/compatible-mode/v1 与 qwen3.7-flash）"
        )

    if not (settings.vision_api_key or settings.deepseek_api_key or "").strip():
        raise RuntimeError("未配置 VISION_API_KEY（或 DEEPSEEK_API_KEY 作为回退）")

    type_by_name = {str(t["name"]): int(t["id"]) for t in question_types}
    tag_by_name = {str(t["name"]): int(t["id"]) for t in knowledge_tags}

    # 知识点太多会撑爆 prompt；优先传带路径的名称，控制长度
    prompt_tags = knowledge_tags[:120]

    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": _build_extract_user_text(
                question_types=question_types,
                knowledge_tags=prompt_tags,
            ),
        }
    ]
    for _mime, raw in images:
        mime, prepared = _prepare_vision_image(raw)
        b64 = base64.b64encode(prepared).decode("ascii")
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        )

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
        # 千问混合思考模型：识题场景关闭思考，加快并稳定 JSON 输出
        "enable_thinking": False,
    }

    url = f"{base_url}/chat/completions"
    headers = _vision_auth_headers()

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.ConnectError as exc:
        raise RuntimeError(
            f"无法连接视觉服务 {base_url}，请检查网络或 VISION_BASE_URL 配置"
        ) from exc
    except httpx.TimeoutException as exc:
        raise RuntimeError("视觉模型识别超时，请缩小图片或稍后重试") from exc

    if response.status_code >= 400:
        detail = response.text[:800]
        raise RuntimeError(f"视觉模型识别失败 ({response.status_code}): {detail}")

    data = response.json()
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"视觉模型返回格式异常: {str(data)[:300]}") from exc

    content_text = message.get("content") or ""
    if isinstance(content_text, list):
        content_text = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content_text
        )

    try:
        parsed = _extract_json_payload(content_text)
    except Exception as exc:
        raise RuntimeError(f"视觉模型返回非 JSON，无法解析: {str(content_text)[:400]}") from exc

    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        if isinstance(parsed.get("stem"), str):
            raw_items = [parsed]
        else:
            raw_items = []

    items: list[dict[str, Any]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        raw_item = {
            **raw_item,
            "options": _coerce_options(raw_item.get("options")),
            "correct_answer": _coerce_answer_list(raw_item.get("correct_answer")),
            "wrong_answer": _coerce_answer_list(raw_item.get("wrong_answer")),
        }
        if isinstance(raw_item.get("knowledge_tag_names"), str):
            raw_item["knowledge_tag_names"] = [raw_item["knowledge_tag_names"]]
        normalized = _resolve_ids_from_names(raw_item, type_by_name=type_by_name, tag_by_name=tag_by_name)
        if not normalized["stem"]:
            continue
        # 识别阶段不预填知识点，避免误标；由人工或「AI 推荐」再选
        normalized["knowledge_tag_ids"] = []
        normalized["knowledge_tag_names"] = []
        normalized["local_id"] = str(uuid_mod.uuid4())
        items.append(normalized)

    raw_text = parsed.get("raw_text")
    raw_text_s = str(raw_text).strip() if raw_text else None
    return items, raw_text_s, model


TAG_SUGGEST_SYSTEM_PROMPT = """你是英语错题知识点标注助手。
根据题目内容，从给定知识点目录中选择最匹配的标签，严格返回 JSON（不要 markdown，不要额外文字）：

{
  "items": [
    {
      "name": "必须与目录中的 name 完全一致（含路径）",
      "confidence": 0到1的小数,
      "reason": "一句话说明为何选它"
    }
  ],
  "warnings": ["可选：不确定处说明"]
}

规则：
1. 只从目录中选，禁止自造标签名。
2. 优先选最具体的叶子知识点（例如「语法 / 时态语态 / 一般现在时」优于只选「语法」）。
3. 通常选 1～3 个；若题目跨多个考点可多选，但不要堆砌。
4. 若只能判断大类，可选一级/二级标签，并在 warnings 说明。"""


def _match_tag_id(name: str, tag_by_name: dict[str, int]) -> int | None:
    text = name.strip()
    if not text:
        return None
    if text in tag_by_name:
        return tag_by_name[text]
    # 允许只给末级名，或路径不完全一致时的模糊匹配
    leaf = text.split("/")[-1].strip()
    candidates = [(n, i) for n, i in tag_by_name.items() if n == leaf or n.endswith(f" / {leaf}")]
    if len(candidates) == 1:
        return candidates[0][1]
    for n, i in tag_by_name.items():
        if text in n or n in text:
            return i
    return None


async def suggest_knowledge_tags(
    *,
    stem: str,
    options: list[Any],
    correct_answer: list[Any],
    wrong_answer: list[Any],
    question_type_name: str | None,
    note: str | None,
    knowledge_tags: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], str]:
    """根据题目内容推荐知识点。返回 (items[{id,name,confidence,reason}], warnings, model)。"""
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    if not stem.strip():
        raise ValueError("题干不能为空")
    if not knowledge_tags:
        raise ValueError("知识点目录为空")

    tag_by_name = {str(t["name"]): int(t["id"]) for t in knowledge_tags}
    tag_lines = "\n".join(f"- id={t['id']} name={t['name']}" for t in knowledge_tags)
    user_prompt = f"""请为下列英语错题推荐知识点标签。

【题型】{question_type_name or "（未指定）"}
【题干】
{stem.strip()}

【选项】
{_format_options(options)}

【正确答案】{_format_answers(correct_answer)}
【学生错答】{_format_answers(wrong_answer)}
【备注】{note or "（无）"}

【知识点目录】
{tag_lines}

请返回 JSON。"""

    model = settings.deepseek_model.strip()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": TAG_SUGGEST_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"知识点推荐失败 ({response.status_code}): {response.text[:500]}")
        data = response.json()

    content_text = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content_text)
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        raw_items = []

    warnings = _coerce_str_list(parsed.get("warnings"))
    results: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        tid = _match_tag_id(name, tag_by_name)
        if tid is None:
            warnings.append(f"未能匹配知识点「{name}」")
            continue
        if tid in seen:
            continue
        seen.add(tid)
        conf = raw.get("confidence")
        try:
            conf_f = float(conf) if conf is not None else None
        except (TypeError, ValueError):
            conf_f = None
        reason = str(raw.get("reason") or "").strip() or None
        results.append(
            {
                "id": tid,
                "name": next((t["name"] for t in knowledge_tags if int(t["id"]) == tid), name),
                "confidence": conf_f,
                "reason": reason,
            }
        )

    if not results:
        warnings.append("未能推荐出可用知识点，请人工选择")
    return results, warnings, model


GENERATE_PRACTICE_SOURCE = "AI出题"

GENERATE_PRACTICE_SYSTEM_PROMPT = """你是资深中学英语命题教师。请按指定题型生成全新练习题，严格返回 JSON（不要 markdown 代码块，不要额外文字）。

输出格式：
{
  "items": [
    {
      "stem": "题干全文（含材料/空格，空格用 _____ 表示）",
      "options": ["A. xxx", "B. xxx", "C. xxx", "D. xxx"] 或 [["A1","B1"],["A2","B2"]] 或 [],
      "correct_answer": ["B"] 或 ["has","been"],
      "wrong_answer": ["C"] 或 ["have","was"],
      "knowledge_tag_names": ["必须与目录 name 完全一致"],
      "difficulty": 1到5的整数,
      "note": "命题说明或考点提示（中文，可空）",
      "warnings": ["不确定处说明"]
    }
  ]
}

规则：
1. 必须严格按用户指定的题型命题，不要换成其他题型。
2. 题目必须原创，不要照抄示例题；与「已出过的题干」明显不同。
3. options：单选一维数组（A/B/C/D）；完形/阅读多小题用二维数组；填空/改错/翻译等无选项用 []。
4. correct_answer / wrong_answer 必须是数组。wrong_answer 填典型错答（与正确答案不同），用于题库字段，不是学生真实错题。
5. knowledge_tag_names 只从给定目录中选 1～3 个，优先叶子知识点，禁止自造名称。
6. 保持英文原文题干；难度按 1 入门～5 挑战；中学常见词汇为主，避免偏难怪词。
7. 书面表达：stem 写写作要求，correct_answer 给范文或要点提纲，wrong_answer 给常见偏题写法。
8. 听力理解：用文字材料代替录音，stem 写「听下面材料（文本）」+ 短文本 + 问题。
9. 完形/阅读/七选五：材料宜短（约 80～180 词），小题 3～5 个即可。"""


_LONG_FORM_TYPE_KEYWORDS = ("完形", "阅读", "七选五", "书面表达", "听力")


def _is_long_form_question_type(name: str) -> bool:
    text = name or ""
    return any(k in text for k in _LONG_FORM_TYPE_KEYWORDS)


def max_generate_count_for_type(question_type_name: str) -> int:
    return 4 if _is_long_form_question_type(question_type_name) else 10


def _format_example_questions(examples: list[dict[str, Any]]) -> str:
    if not examples:
        return "（题库暂无示例，请按该题型常规考法命题）"
    lines: list[str] = []
    for idx, item in enumerate(examples, start=1):
        lines.append(
            f"{idx}. 难度={item.get('difficulty') or '未标'}\n"
            f"   题干：{_truncate_stem(str(item.get('stem') or ''), 220)}\n"
            f"   选项：{_format_options(item.get('options') or [])}\n"
            f"   答案：{_format_answers(item.get('correct_answer') or [])}"
        )
    return "\n".join(lines)


async def _post_chat_json(
    *,
    system: str,
    user: str,
    temperature: float,
    timeout: float = 120.0,
) -> tuple[dict[str, Any], str]:
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")

    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"AI 出题失败 ({response.status_code}): {response.text[:500]}")
        data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = _extract_json_payload(content)
    if not isinstance(parsed, dict):
        raise RuntimeError("AI 出题返回格式异常")
    return parsed, settings.deepseek_model


def _normalize_generated_practice_item(
    raw: dict[str, Any],
    *,
    question_type_id: int,
    question_type_name: str,
    type_by_name: dict[str, int],
    tag_by_name: dict[str, int],
) -> dict[str, Any] | None:
    payload = {
        **raw,
        "options": _coerce_options(raw.get("options")),
        "correct_answer": _coerce_answer_list(raw.get("correct_answer")),
        "wrong_answer": _coerce_answer_list(raw.get("wrong_answer")),
        "question_type_id": question_type_id,
        "question_type_name": question_type_name,
    }
    if isinstance(payload.get("knowledge_tag_names"), str):
        payload["knowledge_tag_names"] = [payload["knowledge_tag_names"]]
    normalized = _resolve_ids_from_names(payload, type_by_name=type_by_name, tag_by_name=tag_by_name)
    if not normalized["stem"]:
        return None
    normalized["question_type_id"] = question_type_id
    normalized["question_type_name"] = question_type_name
    normalized["source"] = GENERATE_PRACTICE_SOURCE
    normalized["selected"] = True
    normalized["local_id"] = str(uuid_mod.uuid4())
    if not normalized.get("wrong_answer") or normalized["wrong_answer"] == [""]:
        normalized["wrong_answer"] = ["（典型错答待补）"]
        normalized["warnings"] = list(normalized.get("warnings") or []) + ["典型错答为占位，请人工核对"]
    return normalized


async def generate_practice_questions(
    *,
    question_type_id: int,
    question_type_name: str,
    question_type_description: str | None,
    count: int,
    knowledge_tags: list[dict[str, Any]],
    example_questions: list[dict[str, Any]] | None = None,
    avoid_stems: list[str] | None = None,
    assignment_title: str | None = None,
) -> tuple[list[dict[str, Any]], str, list[str]]:
    """按题型生成练习题草稿，供教师确认后入库。"""
    wanted = max(1, min(int(count), max_generate_count_for_type(question_type_name)))
    type_by_name = {question_type_name: question_type_id}
    tag_by_name = {str(t["name"]): int(t["id"]) for t in knowledge_tags}
    prompt_tags = knowledge_tags[:120]
    tag_lines = "\n".join(f"- id={t['id']} name={t['name']}" for t in prompt_tags) or "- （无）"
    avoided = [s.strip() for s in (avoid_stems or []) if s and str(s).strip()]
    avoid_block = ""
    if avoided:
        avoid_block = "【已出过的题干（请换新题）】\n" + "\n".join(f"- {_truncate_stem(s, 160)}" for s in avoided[-12:])

    user_prompt = f"""请生成 {wanted} 道中学英语练习题。

【指定题型】{question_type_name}
【题型说明】{question_type_description or "（无）"}
【任务标题】{assignment_title or "（无）"}
【数量】{wanted}

【题库示例（仅作风格参考，禁止照抄）】
{_format_example_questions(example_questions or [])}

{avoid_block}

【知识点目录】
{tag_lines}

请返回 JSON。"""

    parsed, model = await _post_chat_json(
        system=GENERATE_PRACTICE_SYSTEM_PROMPT,
        user=user_prompt,
        temperature=0.65,
        timeout=120.0,
    )
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        raw_items = [parsed] if isinstance(parsed.get("stem"), str) else []

    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_stems: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        normalized = _normalize_generated_practice_item(
            raw,
            question_type_id=question_type_id,
            question_type_name=question_type_name,
            type_by_name=type_by_name,
            tag_by_name=tag_by_name,
        )
        if not normalized:
            continue
        key = _normalize_for_compare(normalized["stem"])
        if key in seen_stems:
            continue
        seen_stems.add(key)
        items.append(normalized)
        if len(items) >= wanted:
            break

    if not items:
        raise RuntimeError("AI 未能生成可用题目，请稍后重试")
    if len(items) < wanted:
        warnings.append(f"计划生成 {wanted} 题，实际得到 {len(items)} 题，请核对后决定是否入库")
    return items, model, warnings


