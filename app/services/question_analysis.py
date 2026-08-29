from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.services import llm as llm_service

logger = logging.getLogger(__name__)


def _question_type_name(db: Session, item: models.WrongQuestion) -> str:
    question_type = db.get(models.QuestionType, item.question_type_id)
    return question_type.name if question_type else str(item.question_type_id)


def _knowledge_tag_names(db: Session, item: models.WrongQuestion) -> list[str]:
    tag_ids = [link.knowledge_tag_id for link in item.tags]
    if not tag_ids:
        return []
    tags = db.query(models.KnowledgeTag).filter(models.KnowledgeTag.id.in_(tag_ids)).all()
    name_by_id = {tag.id: tag.name for tag in tags}
    return [name_by_id.get(tag_id, str(tag_id)) for tag_id in tag_ids]


async def persist_question_ai_analysis(
    db: Session,
    question_id: int,
    *,
    focus_sentences: list[str] | None = None,
    skip_if_present: bool = False,
) -> models.WrongQuestion:
    item = db.get(models.WrongQuestion, question_id)
    if not item or item.deleted:
        raise LookupError("题目不存在")
    if skip_if_present and item.ai_analysis:
        return item

    result, model = await llm_service.analyze_wrong_question(
        stem=item.stem,
        options=item.options,
        correct_answer=item.correct_answer,
        wrong_answer=item.wrong_answer,
        question_type_name=_question_type_name(db, item),
        knowledge_tag_names=_knowledge_tag_names(db, item),
        note=item.note,
        focus_sentences=focus_sentences,
    )
    analyzed_at = datetime.utcnow()
    item.ai_analysis = llm_service.serialize_ai_analysis(result, analyzed_at=analyzed_at, model=model)
    item.ai_analyzed_at = analyzed_at
    item.ai_model = model
    db.commit()
    db.refresh(item)
    return item


async def run_question_analyses(question_ids: list[int]) -> None:
    for question_id in question_ids:
        db = SessionLocal()
        try:
            await persist_question_ai_analysis(db, question_id, skip_if_present=True)
        except Exception:
            logger.exception("入库后自动分析失败 question_id=%s", question_id)
            db.rollback()
        finally:
            db.close()


def schedule_question_analysis(background_tasks, question_ids: list[int]) -> None:
    ids = [int(question_id) for question_id in question_ids if question_id]
    if not ids:
        return
    background_tasks.add_task(run_question_analyses, ids)
