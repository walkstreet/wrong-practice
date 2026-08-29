from datetime import datetime
import re
from typing import Any

from sqlalchemy import Float, case, delete, exists, func, select, union_all
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.permissions import (
    can_access_assignment,
    can_access_managed_user,
    can_delete_role,
    coerce_role,
    is_superadmin,
)

_OPTION_WITH_PREFIX_RE = re.compile(r"^([A-Za-z0-9]{1,3})[\.\):、\s]+(.+)$")


def _parse_option_text(option: str) -> tuple[str | None, str]:
    text = option.strip()
    matched = _OPTION_WITH_PREFIX_RE.match(text)
    if matched:
        return matched.group(1).upper(), matched.group(2).strip()
    return None, text


def _answer_text_to_real(option_candidates: list[str], answer: str) -> str:
    raw = answer.strip()
    upper_raw = raw.upper()
    for option in option_candidates:
        token, content = _parse_option_text(option)
        if raw == option.strip() or raw == content:
            return content
        if token and upper_raw == token:
            return content
    return raw


def _normalize_answer_value_with_options(option_candidates: list[str], value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return _answer_text_to_real(option_candidates, value)
    if isinstance(value, list):
        return [_normalize_answer_value_with_options(option_candidates, item) for item in value]
    return value


def _normalize_answers_for_storage(options: Any, answers: list[Any]) -> list[Any]:
    if not isinstance(options, list) or len(options) == 0:
        return [_normalize_answer_item(item) for item in answers]
    if all(isinstance(group, list) for group in options):
        result: list[Any] = []
        for idx, answer in enumerate(answers):
            group = options[idx] if idx < len(options) and isinstance(options[idx], list) else []
            candidates = [item for item in group if isinstance(item, str)]
            if candidates:
                result.append(_normalize_answer_value_with_options(candidates, answer))
            else:
                result.append(_normalize_answer_item(answer))
        return result
    candidates = [item for item in options if isinstance(item, str)]
    return [_normalize_answer_value_with_options(candidates, item) for item in answers]


def create_wrong_question(
    db: Session,
    payload: schemas.WrongQuestionCreate | schemas.WrongQuestionBase,
    *,
    created_by: int | None = None,
) -> models.WrongQuestion:
    normalized_correct_answer = _normalize_answers_for_storage(payload.options, payload.correct_answer)
    normalized_wrong_answer = _normalize_answers_for_storage(payload.options, payload.wrong_answer)
    question = models.WrongQuestion(
        stem=payload.stem,
        options=payload.options,
        correct_answer=normalized_correct_answer,
        wrong_answer=normalized_wrong_answer,
        question_type_id=payload.question_type_id,
        difficulty=payload.difficulty,
        source=payload.source,
        note=payload.note,
        wrong_at=payload.wrong_at,
        review_status=payload.review_status,
        external_trace_id=payload.external_trace_id,
        ocr_raw_text=payload.ocr_raw_text,
        ocr_payload=payload.ocr_payload,
        ingest_source=getattr(payload, "ingest_source", models.IngestSource.manual),
        created_by=created_by,
    )
    db.add(question)
    db.flush()

    for tag_id in payload.knowledge_tag_ids:
        db.add(
            models.WrongQuestionKnowledgeTag(
                wrong_question_id=question.id,
                knowledge_tag_id=tag_id,
            )
        )

    db.commit()
    db.refresh(question)
    return question


def create_wrong_questions_batch(
    db: Session,
    items: list[schemas.WrongQuestionCreate],
    *,
    created_by: int | None = None,
) -> list[models.WrongQuestion]:
    created: list[models.WrongQuestion] = []
    for payload in items:
        normalized_correct_answer = _normalize_answers_for_storage(payload.options, payload.correct_answer)
        normalized_wrong_answer = _normalize_answers_for_storage(payload.options, payload.wrong_answer)
        question = models.WrongQuestion(
            stem=payload.stem,
            options=payload.options,
            correct_answer=normalized_correct_answer,
            wrong_answer=normalized_wrong_answer,
            question_type_id=payload.question_type_id,
            difficulty=payload.difficulty,
            source=payload.source,
            note=payload.note,
            wrong_at=payload.wrong_at,
            review_status=payload.review_status,
            external_trace_id=payload.external_trace_id,
            ocr_raw_text=payload.ocr_raw_text,
            ocr_payload=payload.ocr_payload,
            ingest_source=payload.ingest_source,
            created_by=created_by,
        )
        db.add(question)
        db.flush()

        for tag_id in payload.knowledge_tag_ids:
            db.add(
                models.WrongQuestionKnowledgeTag(
                    wrong_question_id=question.id,
                    knowledge_tag_id=tag_id,
                )
            )
        created.append(question)

    db.commit()
    for question in created:
        db.refresh(question)
    return created


def get_wrong_question(db: Session, question_id: int) -> models.WrongQuestion | None:
    return db.get(models.WrongQuestion, question_id)


ACTIVITY_ACTION_LABELS = {
    "question.create": "录入题目",
    "question.update": "编辑题目",
    "question.delete": "删除题目",
    "question.restore": "还原题目",
    "question.purge": "彻底删除题目",
    "recycle.empty": "清空回收站",
    "question.claim.request": "申请查看题库",
    "question.claim.approve": "批准题库申请",
    "question.claim.reject": "驳回题库申请",
    "user.password.reset": "重置密码",
    "user.activate": "启用账号",
    "user.deactivate": "停用账号",
}


def _stem_snippet(stem: str | None, limit: int = 40) -> str:
    text = (stem or "").replace("\n", " ").strip()
    return text if len(text) <= limit else f"{text[:limit]}…"


def _usernames_by_ids(db: Session, user_ids: set[int]) -> dict[int, str]:
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return {}
    rows = db.execute(select(models.User.id, models.User.username).where(models.User.id.in_(ids))).all()
    return {row[0]: row[1] for row in rows}


def _question_attempts_subquery():
    return union_all(
        select(
            models.UserAnswer.wrong_question_id.label("wrong_question_id"),
            models.UserAnswer.is_correct.label("is_correct"),
        ),
        select(
            models.PracticeRecord.wrong_question_id.label("wrong_question_id"),
            models.PracticeRecord.is_correct.label("is_correct"),
        ),
    ).subquery("question_attempts")


def _question_attempt_stats_subquery():
    attempts = _question_attempts_subquery()
    return (
        select(
            attempts.c.wrong_question_id,
            func.count().label("total_attempts"),
            func.sum(case((attempts.c.is_correct.is_(True), 1), else_=0)).label("correct_attempts"),
        )
        .group_by(attempts.c.wrong_question_id)
        .subquery("question_attempt_stats")
    )


def classify_error_rate(total_attempts: int, correct_attempts: int) -> tuple[float | None, schemas.ErrorRateLevel | None]:
    if total_attempts <= 0:
        return None, None
    error_rate = round(1 - (correct_attempts / total_attempts), 4)
    if error_rate >= 0.75:
        return error_rate, schemas.ErrorRateLevel.high
    if error_rate >= 0.50:
        return error_rate, schemas.ErrorRateLevel.medium
    return error_rate, schemas.ErrorRateLevel.low


def _attempt_stats_by_question_ids(db: Session, ids: set[int]) -> dict[int, tuple[int, int]]:
    if not ids:
        return {}
    attempts = _question_attempts_subquery()
    rows = db.execute(
        select(
            attempts.c.wrong_question_id,
            func.count().label("total_attempts"),
            func.sum(case((attempts.c.is_correct.is_(True), 1), else_=0)).label("correct_attempts"),
        )
        .where(attempts.c.wrong_question_id.in_(ids))
        .group_by(attempts.c.wrong_question_id)
    ).all()
    return {int(row.wrong_question_id): (int(row.total_attempts or 0), int(row.correct_attempts or 0)) for row in rows}


def serialize_wrong_question(
    question: models.WrongQuestion,
    *,
    created_by_username: str | None = None,
    total_attempts: int = 0,
    correct_attempts: int = 0,
) -> schemas.WrongQuestionOut:
    normalized_correct_answer = _normalize_answers_for_storage(question.options, question.correct_answer)
    normalized_wrong_answer = _normalize_answers_for_storage(question.options, question.wrong_answer)
    error_rate, error_level = classify_error_rate(total_attempts, correct_attempts)
    return schemas.WrongQuestionOut(
        id=question.id,
        stem=question.stem,
        options=question.options,
        correct_answer=normalized_correct_answer,
        wrong_answer=normalized_wrong_answer,
        question_type_id=question.question_type_id,
        knowledge_tag_ids=[link.knowledge_tag_id for link in question.tags],
        difficulty=question.difficulty,
        source=question.source,
        ingest_source=question.ingest_source,
        external_trace_id=question.external_trace_id,
        note=question.note,
        wrong_at=question.wrong_at,
        review_status=question.review_status,
        ai_analysis=question.ai_analysis,
        ai_analyzed_at=question.ai_analyzed_at,
        ai_model=question.ai_model,
        created_at=question.created_at,
        updated_at=question.updated_at,
        deleted_at=question.deleted_at,
        created_by=question.created_by,
        created_by_username=created_by_username,
        total_attempts=total_attempts,
        error_rate=error_rate,
        error_rate_level=error_level,
    )


def serialize_wrong_questions(
    db: Session, items: list[models.WrongQuestion], actor=None
) -> list[schemas.WrongQuestionOut]:
    usernames = _usernames_by_ids(db, {item.created_by for item in items if item.created_by})
    stats = _attempt_stats_by_question_ids(db, {item.id for item in items})
    return [
        serialize_wrong_question(
            item,
            created_by_username=usernames.get(item.created_by) if item.created_by else None,
            total_attempts=stats.get(item.id, (0, 0))[0],
            correct_attempts=stats.get(item.id, (0, 0))[1],
        )
        for item in items
    ]


def list_wrong_questions(
    db: Session,
    *,
    page: int,
    page_size: int,
    question_id: int | None = None,
    question_type_id: int | None = None,
    knowledge_tag_id: int | None = None,
    review_status: models.ReviewStatus | None = None,
    error_rate_level: schemas.ErrorRateLevel | None = None,
    difficulty: int | None = None,
    keyword: str | None = None,
    deleted: bool = False,
    actor=None,
    owner_only: bool | None = None,
) -> tuple[int, list[models.WrongQuestion]]:
    stmt = select(models.WrongQuestion).where(models.WrongQuestion.deleted.is_(deleted))
    restrict_owner = owner_only
    if restrict_owner is None:
        restrict_owner = actor is not None and not is_superadmin(actor.role)
    if restrict_owner and actor is not None and not is_superadmin(actor.role):
        stmt = stmt.where(models.WrongQuestion.created_by == actor.id)

    if question_id is not None:
        stmt = stmt.where(models.WrongQuestion.id == question_id)
    if question_type_id:
        stmt = stmt.where(models.WrongQuestion.question_type_id == question_type_id)
    if review_status:
        stmt = stmt.where(models.WrongQuestion.review_status == review_status)
    if difficulty is not None:
        stmt = stmt.where(models.WrongQuestion.difficulty == difficulty)
    if keyword:
        stmt = stmt.where(models.WrongQuestion.stem.ilike(f"%{keyword}%"))
    if knowledge_tag_id:
        stmt = stmt.join(models.WrongQuestion.tags).where(
            models.WrongQuestionKnowledgeTag.knowledge_tag_id == knowledge_tag_id
        )
    if error_rate_level:
        stats = _question_attempt_stats_subquery()
        error_expr = 1 - (
            stats.c.correct_attempts.cast(Float) / func.nullif(stats.c.total_attempts, 0).cast(Float)
        )
        stmt = stmt.join(stats, stats.c.wrong_question_id == models.WrongQuestion.id)
        if error_rate_level == schemas.ErrorRateLevel.high:
            stmt = stmt.where(error_expr >= 0.75)
        elif error_rate_level == schemas.ErrorRateLevel.medium:
            stmt = stmt.where(error_expr >= 0.50, error_expr < 0.75)
        else:
            stmt = stmt.where(error_expr < 0.50)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0

    order_by = (
        models.WrongQuestion.deleted_at.desc().nulls_last()
        if deleted
        else models.WrongQuestion.created_at.desc()
    )
    stmt = stmt.order_by(order_by).offset((page - 1) * page_size).limit(page_size)
    items = list(db.scalars(stmt).all())
    return total, items


def _purge_wrong_question_relations(db: Session, question_id: int) -> None:
    db.execute(
        delete(models.WrongQuestionKnowledgeTag).where(
            models.WrongQuestionKnowledgeTag.wrong_question_id == question_id
        )
    )
    db.execute(
        delete(models.PracticeRecord).where(models.PracticeRecord.wrong_question_id == question_id)
    )
    db.execute(delete(models.UserAnswer).where(models.UserAnswer.wrong_question_id == question_id))
    db.execute(
        delete(models.AssignmentQuestion).where(
            models.AssignmentQuestion.wrong_question_id == question_id
        )
    )


def permanently_delete_wrong_question(db: Session, question_id: int) -> bool:
    """彻底删除回收站中的错题及其关联数据。"""
    item = get_wrong_question(db, question_id)
    if not item or not item.deleted:
        return False
    _purge_wrong_question_relations(db, question_id)
    db.delete(item)
    db.commit()
    return True


def empty_recycle_bin(db: Session, actor=None) -> int:
    """清空回收站：彻底删除已软删错题。教师只清自己的。"""
    stmt = select(models.WrongQuestion.id).where(models.WrongQuestion.deleted.is_(True))
    if actor is not None and not is_superadmin(actor.role):
        stmt = stmt.where(models.WrongQuestion.created_by == actor.id)
    ids = list(db.scalars(stmt).all())
    for question_id in ids:
        _purge_wrong_question_relations(db, question_id)
        item = db.get(models.WrongQuestion, question_id)
        if item:
            db.delete(item)
    db.commit()
    return len(ids)


def write_activity_log(
    db: Session,
    *,
    actor,
    action: str,
    resource_type: str,
    summary: str,
    resource_id: int | None = None,
    extra: dict | None = None,
    commit: bool = False,
) -> models.ActivityLog:
    log = models.ActivityLog(
        actor_id=getattr(actor, "id", None),
        actor_username=getattr(actor, "username", None),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        summary=summary[:500],
        extra=extra,
    )
    db.add(log)
    if commit:
        db.commit()
        db.refresh(log)
    return log


def serialize_activity_log(log: models.ActivityLog) -> schemas.ActivityLogOut:
    return schemas.ActivityLogOut(
        id=log.id,
        actor_id=log.actor_id,
        actor_username=log.actor_username,
        action=log.action,
        action_label=ACTIVITY_ACTION_LABELS.get(log.action, log.action),
        resource_type=log.resource_type,
        resource_id=log.resource_id,
        summary=log.summary,
        extra=log.extra,
        created_at=log.created_at,
    )


def list_activity_logs(
    db: Session,
    *,
    page: int,
    page_size: int,
    action: str | None = None,
    actor_username: str | None = None,
) -> tuple[int, list[models.ActivityLog]]:
    stmt = select(models.ActivityLog)
    if action:
        stmt = stmt.where(models.ActivityLog.action == action)
    if actor_username:
        stmt = stmt.where(models.ActivityLog.actor_username.ilike(f"%{actor_username.strip()}%"))
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0
    items = list(
        db.scalars(
            stmt.order_by(models.ActivityLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return total, items


def has_bank_view_access(db: Session, actor) -> bool:
    if actor is None:
        return False
    if is_superadmin(actor.role):
        return True
    return (
        db.scalar(
            select(models.QuestionClaimRequest.id).where(
                models.QuestionClaimRequest.requester_id == actor.id,
                models.QuestionClaimRequest.status == models.ClaimRequestStatus.approved,
            )
        )
        is not None
    )


def latest_bank_request(db: Session, actor) -> models.QuestionClaimRequest | None:
    if actor is None:
        return None
    return db.scalar(
        select(models.QuestionClaimRequest)
        .where(models.QuestionClaimRequest.requester_id == actor.id)
        .order_by(models.QuestionClaimRequest.created_at.desc())
    )


def bank_access_for_user(db: Session, actor) -> dict:
    if is_superadmin(actor.role):
        return {"can_view_question_bank": True, "bank_request_status": None}
    latest = latest_bank_request(db, actor)
    return {
        "can_view_question_bank": has_bank_view_access(db, actor),
        "bank_request_status": models.ClaimRequestStatus(latest.status) if latest else None,
    }


def serialize_claim_request(db: Session, item: models.QuestionClaimRequest) -> schemas.QuestionClaimOut:
    names = _usernames_by_ids(db, {item.requester_id, item.reviewer_id} if item.reviewer_id else {item.requester_id})
    return schemas.QuestionClaimOut(
        id=item.id,
        requester_id=item.requester_id,
        requester_username=names.get(item.requester_id, str(item.requester_id)),
        status=models.ClaimRequestStatus(item.status),
        reason=item.reason,
        reviewer_id=item.reviewer_id,
        reviewer_username=names.get(item.reviewer_id) if item.reviewer_id else None,
        review_note=item.review_note,
        created_at=item.created_at,
        reviewed_at=item.reviewed_at,
    )


def get_claim_request(db: Session, request_id: int) -> models.QuestionClaimRequest | None:
    return db.get(models.QuestionClaimRequest, request_id)


def list_claim_requests(
    db: Session,
    *,
    page: int,
    page_size: int,
    status: models.ClaimRequestStatus | None = None,
) -> tuple[int, list[models.QuestionClaimRequest]]:
    stmt = select(models.QuestionClaimRequest)
    if status:
        stmt = stmt.where(models.QuestionClaimRequest.status == status)
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0
    items = list(
        db.scalars(
            stmt.order_by(models.QuestionClaimRequest.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return total, items


def create_question_claim(
    db: Session, *, actor, reason: str | None
) -> models.QuestionClaimRequest:
    if has_bank_view_access(db, actor):
        latest = latest_bank_request(db, actor)
        if latest and latest.status == models.ClaimRequestStatus.approved:
            return latest
    pending = db.scalar(
        select(models.QuestionClaimRequest).where(
            models.QuestionClaimRequest.requester_id == actor.id,
            models.QuestionClaimRequest.status == models.ClaimRequestStatus.pending,
        )
    )
    if pending:
        return pending
    item = models.QuestionClaimRequest(
        requester_id=actor.id,
        status=models.ClaimRequestStatus.pending,
        reason=(reason or "").strip() or None,
    )
    db.add(item)
    write_activity_log(
        db,
        actor=actor,
        action="question.claim.request",
        resource_type="question_bank",
        resource_id=actor.id,
        summary=f"{actor.username} 申请查看全量错题",
        extra={"reason": item.reason},
    )
    db.commit()
    db.refresh(item)
    return item


def review_question_claim(
    db: Session,
    item: models.QuestionClaimRequest,
    *,
    reviewer,
    approved: bool,
    review_note: str | None,
) -> models.QuestionClaimRequest:
    now = datetime.utcnow()
    item.status = models.ClaimRequestStatus.approved if approved else models.ClaimRequestStatus.rejected
    item.reviewer_id = reviewer.id
    item.review_note = (review_note or "").strip() or None
    item.reviewed_at = now
    requester_name = _usernames_by_ids(db, {item.requester_id}).get(item.requester_id, str(item.requester_id))
    extra: dict = {"request_id": item.id, "requester_id": item.requester_id}

    if approved:
        write_activity_log(
            db,
            actor=reviewer,
            action="question.claim.approve",
            resource_type="question_bank",
            resource_id=item.requester_id,
            summary=f"{reviewer.username} 批准 {requester_name} 查看全量错题",
            extra=extra,
        )
    else:
        write_activity_log(
            db,
            actor=reviewer,
            action="question.claim.reject",
            resource_type="question_bank",
            resource_id=item.requester_id,
            summary=f"{reviewer.username} 驳回了 {requester_name} 的题库申请",
            extra=extra,
        )
    db.commit()
    db.refresh(item)
    return item


def update_wrong_question(db: Session, question: models.WrongQuestion, payload: schemas.WrongQuestionUpdate) -> models.WrongQuestion:
    updates = payload.model_dump(exclude_unset=True)
    knowledge_tag_ids = updates.pop("knowledge_tag_ids", None)
    next_options = updates.get("options", question.options)
    if "correct_answer" in updates:
        updates["correct_answer"] = _normalize_answers_for_storage(next_options, updates["correct_answer"])
    elif "options" in updates:
        updates["correct_answer"] = _normalize_answers_for_storage(next_options, question.correct_answer)
    if "wrong_answer" in updates:
        updates["wrong_answer"] = _normalize_answers_for_storage(next_options, updates["wrong_answer"])
    elif "options" in updates:
        updates["wrong_answer"] = _normalize_answers_for_storage(next_options, question.wrong_answer)

    for field, value in updates.items():
        setattr(question, field, value)

    if knowledge_tag_ids is not None:
        db.query(models.WrongQuestionKnowledgeTag).filter(
            models.WrongQuestionKnowledgeTag.wrong_question_id == question.id
        ).delete()
        for tag_id in knowledge_tag_ids:
            db.add(
                models.WrongQuestionKnowledgeTag(
                    wrong_question_id=question.id,
                    knowledge_tag_id=tag_id,
                )
            )

    db.commit()
    db.refresh(question)
    return question


def create_practice_record(db: Session, payload: schemas.PracticeRecordIn) -> models.PracticeRecord:
    record_kwargs = {
        "wrong_question_id": payload.wrong_question_id,
        "generated_question": payload.generated_question,
        "is_correct": payload.is_correct,
    }
    if payload.answered_at is not None:
        record_kwargs["answered_at"] = payload.answered_at

    record = models.PracticeRecord(**record_kwargs)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def count_practice_records(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(models.PracticeRecord)) or 0)


def list_practice_records(
    db: Session,
    *,
    page: int,
    page_size: int,
    wrong_question_id: int | None = None,
) -> tuple[int, list[models.PracticeRecord]]:
    stmt = select(models.PracticeRecord).join(models.WrongQuestion)
    if wrong_question_id:
        stmt = stmt.where(models.PracticeRecord.wrong_question_id == wrong_question_id)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = int(db.scalar(count_stmt) or 0)

    stmt = (
        stmt.order_by(models.PracticeRecord.answered_at.desc(), models.PracticeRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return total, list(db.scalars(stmt).all())


def _username_ilike_pattern(raw: str) -> str:
    escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def list_learner_practice_records(
    db: Session,
    *,
    page: int,
    page_size: int,
    wrong_question_id: int | None = None,
    username: str | None = None,
    actor=None,
) -> tuple[int, list[schemas.LearnerPracticeRecordOut]]:
    answered_questions_subq = (
        select(func.count(models.UserAnswer.id))
        .where(
            models.UserAnswer.assignment_id == models.UserAssignment.assignment_id,
            models.UserAnswer.user_id == models.UserAssignment.user_id,
        )
        .correlate(models.UserAssignment)
        .scalar_subquery()
    )
    correct_questions_subq = (
        select(func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0)))
        .where(
            models.UserAnswer.assignment_id == models.UserAssignment.assignment_id,
            models.UserAnswer.user_id == models.UserAssignment.user_id,
        )
        .correlate(models.UserAssignment)
        .scalar_subquery()
    )
    stmt = (
        select(
            models.UserAssignment,
            models.User.username,
            models.User.display_name,
            answered_questions_subq.label("answered_questions"),
            correct_questions_subq.label("correct_questions"),
        )
        .join(models.User, models.User.id == models.UserAssignment.user_id)
        .where(
            models.UserAssignment.status.in_(
                [models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded]
            )
        )
    )
    if wrong_question_id:
        stmt = stmt.where(
            exists(
                select(1).where(
                    models.UserAnswer.assignment_id == models.UserAssignment.assignment_id,
                    models.UserAnswer.user_id == models.UserAssignment.user_id,
                    models.UserAnswer.wrong_question_id == wrong_question_id,
                )
            )
        )
    u = username.strip() if username is not None else ""
    if u:
        stmt = stmt.where(models.User.username.ilike(_username_ilike_pattern(u), escape="\\"))
    owner_id = _owned_student_filter(actor) if actor is not None else None
    if owner_id is not None:
        stmt = stmt.join(
            models.Assignment, models.Assignment.id == models.UserAssignment.assignment_id
        ).where(
            models.User.role == models.UserRole.student,
            models.User.created_by == owner_id,
            models.Assignment.created_by == owner_id,
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = int(db.scalar(count_stmt) or 0)

    rows = db.execute(
        stmt.order_by(models.UserAssignment.submitted_at.desc(), models.UserAssignment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = [
        schemas.LearnerPracticeRecordOut(
            id=row[0].id,
            assignment_id=row[0].assignment_id,
            user_id=row[0].user_id,
            username=row[1],
            display_name=normalize_display_name(row[2]),
            status=row[0].status,
            submitted_at=row[0].submitted_at,
            score=row[0].score,
            accuracy_rate=row[0].accuracy_rate,
            answered_questions=int(row[3] or 0),
            correct_questions=int(row[4] or 0),
        )
        for row in rows
    ]
    return total, items


def get_learner_practice_record_detail(
    db: Session, *, record_id: int, actor=None
) -> schemas.LearnerPracticeRecordDetailOut | None:
    ua = db.get(models.UserAssignment, record_id)
    if not ua:
        return None
    target = get_user_by_id(db, ua.user_id)
    assignment = get_assignment(db, ua.assignment_id)
    if actor is not None:
        if target is not None and not can_access_managed_user(actor, target):
            return None
        if not can_access_assignment(actor, assignment):
            return None
    return get_assignment_submission_detail(db, assignment_id=ua.assignment_id, user_id=ua.user_id)


def serialize_practice_record(record: models.PracticeRecord) -> schemas.PracticeRecordOut:
    stem = record.wrong_question.stem if record.wrong_question else ""
    return schemas.PracticeRecordOut(
        id=record.id,
        wrong_question_id=record.wrong_question_id,
        wrong_question_stem=stem,
        generated_question=record.generated_question,
        is_correct=record.is_correct,
        answered_at=record.answered_at,
        created_at=record.created_at,
    )


def get_wrong_question_accuracy_stats(
    db: Session,
    *,
    limit: int = 50,
    wrong_question_id: int | None = None,
    username: str | None = None,
    actor=None,
) -> list[schemas.WrongQuestionAccuracyOut]:
    correct_attempts_expr = func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0))
    total_attempts_expr = func.count(models.UserAnswer.id)
    accuracy_expr = correct_attempts_expr.cast(Float) / total_attempts_expr.cast(Float)

    stmt = (
        select(
            models.UserAnswer.wrong_question_id,
            models.WrongQuestion.stem,
            total_attempts_expr.label("total_attempts"),
            correct_attempts_expr.label("correct_attempts"),
        )
        .join(models.WrongQuestion, models.WrongQuestion.id == models.UserAnswer.wrong_question_id)
        .join(models.User, models.User.id == models.UserAnswer.user_id)
        .group_by(models.UserAnswer.wrong_question_id, models.WrongQuestion.stem)
        .order_by(accuracy_expr.asc(), total_attempts_expr.desc())
        .limit(limit)
    )
    if wrong_question_id:
        stmt = stmt.where(models.UserAnswer.wrong_question_id == wrong_question_id)
    if username is not None and (u := username.strip()):
        stmt = stmt.where(models.User.username.ilike(_username_ilike_pattern(u), escape="\\"))
    owner_id = _owned_student_filter(actor) if actor is not None else None
    if owner_id is not None:
        stmt = stmt.join(
            models.Assignment, models.Assignment.id == models.UserAnswer.assignment_id
        ).where(
            models.User.role == models.UserRole.student,
            models.User.created_by == owner_id,
            models.Assignment.created_by == owner_id,
        )

    rows = db.execute(stmt).all()
    stats: list[schemas.WrongQuestionAccuracyOut] = []
    for row in rows:
        total_attempts = int(row.total_attempts or 0)
        correct_attempts = int(row.correct_attempts or 0)
        accuracy_rate = round((correct_attempts / total_attempts), 4) if total_attempts else 0.0
        stats.append(
            schemas.WrongQuestionAccuracyOut(
                wrong_question_id=row.wrong_question_id,
                stem=row.stem,
                total_attempts=total_attempts,
                correct_attempts=correct_attempts,
                accuracy_rate=accuracy_rate,
            )
        )
    return stats


def enrich_accuracy_stats_for_ai(
    db: Session,
    stats: list[schemas.WrongQuestionAccuracyOut],
) -> list[dict]:
    """为短板分析补充题型、知识点名称。"""
    if not stats:
        return []
    ids = [item.wrong_question_id for item in stats]
    questions = list(
        db.scalars(
            select(models.WrongQuestion).where(models.WrongQuestion.id.in_(ids))
        ).all()
    )
    question_by_id = {q.id: q for q in questions}

    type_ids = {q.question_type_id for q in questions}
    types = (
        list(db.scalars(select(models.QuestionType).where(models.QuestionType.id.in_(type_ids))).all())
        if type_ids
        else []
    )
    type_name_by_id = {t.id: t.name for t in types}

    tag_ids: set[int] = set()
    for q in questions:
        for link in q.tags:
            tag_ids.add(link.knowledge_tag_id)
    tags = (
        list(db.scalars(select(models.KnowledgeTag).where(models.KnowledgeTag.id.in_(tag_ids))).all())
        if tag_ids
        else []
    )
    tag_name_by_id = {t.id: t.name for t in tags}

    enriched: list[dict] = []
    for item in stats:
        q = question_by_id.get(item.wrong_question_id)
        knowledge_names = []
        if q:
            knowledge_names = [
                tag_name_by_id.get(link.knowledge_tag_id, str(link.knowledge_tag_id))
                for link in q.tags
            ]
        enriched.append(
            {
                "wrong_question_id": item.wrong_question_id,
                "stem": item.stem,
                "total_attempts": item.total_attempts,
                "correct_attempts": item.correct_attempts,
                "accuracy_rate": item.accuracy_rate,
                "error_rate": round(1 - item.accuracy_rate, 4),
                "question_type_name": type_name_by_id.get(q.question_type_id) if q else None,
                "knowledge_tag_names": knowledge_names,
            }
        )
    return enriched


def create_learning_weakness_analysis(
    db: Session,
    *,
    username: str | None,
    wrong_question_id: int | None,
    limit_n: int,
    scope_note: str,
    source_items: list[dict],
    result: dict[str, Any],
    model: str,
    analyzed_at: datetime,
) -> models.LearningWeaknessAnalysis:
    record = models.LearningWeaknessAnalysis(
        username=username,
        wrong_question_id=wrong_question_id,
        limit_n=limit_n,
        scope_note=scope_note,
        analyzed_count=len(source_items),
        model=model,
        source_items=source_items,
        result=result,
        analyzed_at=analyzed_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def serialize_learning_weakness_analysis(
    record: models.LearningWeaknessAnalysis,
) -> schemas.LearningWeaknessAnalysisOut:
    payload = record.result if isinstance(record.result, dict) else {}
    weak_areas_raw = payload.get("weak_areas") or []
    weak_areas: list[schemas.LearningWeakAreaOut] = []
    if isinstance(weak_areas_raw, list):
        for item in weak_areas_raw:
            if not isinstance(item, dict):
                continue
            weak_areas.append(
                schemas.LearningWeakAreaOut(
                    name=str(item.get("name") or ""),
                    severity=str(item.get("severity") or "medium"),
                    evidence=str(item.get("evidence") or ""),
                    related_question_ids=[
                        int(qid)
                        for qid in (item.get("related_question_ids") or [])
                        if isinstance(qid, int) or (isinstance(qid, str) and str(qid).isdigit())
                    ],
                )
            )
    return schemas.LearningWeaknessAnalysisOut(
        id=record.id,
        overall_summary=str(payload.get("overall_summary") or ""),
        weak_areas=weak_areas,
        gap_fill_suggestions=[str(x) for x in (payload.get("gap_fill_suggestions") or []) if str(x).strip()],
        study_methods=[str(x) for x in (payload.get("study_methods") or []) if str(x).strip()],
        weekly_plan=[str(x) for x in (payload.get("weekly_plan") or []) if str(x).strip()],
        analyzed_count=record.analyzed_count,
        username=record.username,
        wrong_question_id=record.wrong_question_id,
        scope_note=record.scope_note,
        source_items=list(record.source_items or []),
        analyzed_at=record.analyzed_at,
        model=record.model or "",
    )


def list_learning_weakness_analyses(
    db: Session,
    *,
    page: int = 1,
    page_size: int = 20,
    username: str,
    actor=None,
) -> tuple[int, list[models.LearningWeaknessAnalysis]]:
    uname = username.strip()
    stmt = select(models.LearningWeaknessAnalysis).where(models.LearningWeaknessAnalysis.username == uname)
    if actor is not None and not _can_read_student_analysis(db, actor, uname):
        return 0, []
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0
    rows = list(
        db.scalars(
            stmt.order_by(models.LearningWeaknessAnalysis.analyzed_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return total, rows


def get_learning_weakness_analysis(
    db: Session, analysis_id: int
) -> models.LearningWeaknessAnalysis | None:
    return db.get(models.LearningWeaknessAnalysis, analysis_id)


def get_latest_learning_weakness_analysis(
    db: Session,
    *,
    username: str,
    actor=None,
) -> models.LearningWeaknessAnalysis | None:
    uname = username.strip()
    if not uname:
        return None
    if actor is not None and not _can_read_student_analysis(db, actor, uname):
        return None
    stmt = select(models.LearningWeaknessAnalysis).where(models.LearningWeaknessAnalysis.username == uname)
    return db.scalars(stmt.order_by(models.LearningWeaknessAnalysis.analyzed_at.desc()).limit(1)).first()


def _knowledge_lesson_result_payload(result: dict[str, Any]) -> dict[str, Any]:
    quiz = result.get("quiz") if isinstance(result.get("quiz"), dict) else {}
    examples_raw = result.get("examples") if isinstance(result.get("examples"), list) else []
    examples: list[dict[str, str]] = []
    for item in examples_raw:
        if not isinstance(item, dict):
            continue
        examples.append(
            {
                "sentence": str(item.get("sentence") or ""),
                "translation": str(item.get("translation") or ""),
                "analysis": str(item.get("analysis") or ""),
            }
        )
    return {
        "knowledge_point": str(result.get("knowledge_point") or ""),
        "explanation": str(result.get("explanation") or ""),
        "key_points": [str(x) for x in (result.get("key_points") or []) if str(x).strip()],
        "examples": examples,
        "quiz": {
            "stem": str(quiz.get("stem") or ""),
            "options": [str(x) for x in (quiz.get("options") or []) if str(x).strip()],
            "correct_answer": str(quiz.get("correct_answer") or "A"),
            "hint": str(quiz.get("hint") or ""),
        },
    }


def serialize_knowledge_lesson_analysis(
    record: models.KnowledgeLessonAnalysis,
) -> schemas.KnowledgeLessonOut:
    payload = _knowledge_lesson_result_payload(record.result if isinstance(record.result, dict) else {})
    quiz = payload["quiz"]
    return schemas.KnowledgeLessonOut(
        id=record.id,
        knowledge_point=payload["knowledge_point"] or record.knowledge_point,
        explanation=payload["explanation"],
        key_points=payload["key_points"],
        examples=[
            schemas.KnowledgeExampleOut(
                sentence=ex["sentence"],
                translation=ex["translation"],
                analysis=ex["analysis"],
            )
            for ex in payload["examples"]
        ],
        quiz=schemas.KnowledgeQuizOut(
            stem=quiz["stem"],
            options=quiz["options"],
            correct_answer=quiz["correct_answer"],
            hint=quiz["hint"],
        ),
        model=record.model or "",
        weakness_analysis_id=record.weakness_analysis_id,
        updated_at=record.updated_at,
    )


def get_knowledge_lesson_analysis(
    db: Session,
    *,
    knowledge_point: str,
    weakness_analysis_id: int | None = None,
) -> models.KnowledgeLessonAnalysis | None:
    name = knowledge_point.strip()
    if not name:
        return None
    stmt = select(models.KnowledgeLessonAnalysis).where(
        models.KnowledgeLessonAnalysis.knowledge_point == name
    )
    if weakness_analysis_id is not None:
        stmt = stmt.where(models.KnowledgeLessonAnalysis.weakness_analysis_id == weakness_analysis_id)
    else:
        stmt = stmt.where(models.KnowledgeLessonAnalysis.weakness_analysis_id.is_(None))
    return db.scalars(stmt.order_by(models.KnowledgeLessonAnalysis.updated_at.desc()).limit(1)).first()


def get_knowledge_lesson_analysis_by_id(
    db: Session, lesson_id: int
) -> models.KnowledgeLessonAnalysis | None:
    return db.get(models.KnowledgeLessonAnalysis, lesson_id)


def upsert_knowledge_lesson_analysis(
    db: Session,
    *,
    knowledge_point: str,
    weakness_analysis_id: int | None,
    evidence: str | None,
    overall_summary: str | None,
    result: dict[str, Any],
    model: str,
) -> models.KnowledgeLessonAnalysis:
    name = knowledge_point.strip()
    existing = get_knowledge_lesson_analysis(
        db, knowledge_point=name, weakness_analysis_id=weakness_analysis_id
    )
    now = datetime.utcnow()
    payload = _knowledge_lesson_result_payload({**result, "knowledge_point": name})
    if existing:
        existing.evidence = evidence
        existing.overall_summary = overall_summary
        existing.result = payload
        existing.model = model
        existing.updated_at = now
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    record = models.KnowledgeLessonAnalysis(
        knowledge_point=name,
        weakness_analysis_id=weakness_analysis_id,
        evidence=evidence,
        overall_summary=overall_summary,
        result=payload,
        model=model,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_knowledge_lesson_quiz(
    db: Session,
    record: models.KnowledgeLessonAnalysis,
    *,
    quiz: dict[str, Any],
) -> models.KnowledgeLessonAnalysis:
    payload = _knowledge_lesson_result_payload(record.result if isinstance(record.result, dict) else {})
    payload["quiz"] = {
        "stem": str(quiz.get("stem") or ""),
        "options": [str(x) for x in (quiz.get("options") or []) if str(x).strip()],
        "correct_answer": str(quiz.get("correct_answer") or "A"),
        "hint": str(quiz.get("hint") or ""),
    }
    record.result = payload
    record.updated_at = datetime.utcnow()
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_wrong_question_practice_summary(db: Session, wrong_question_id: int) -> tuple[int, int, float]:
    stmt = (
        select(
            func.count(models.PracticeRecord.id).label("total_attempts"),
            func.sum(case((models.PracticeRecord.is_correct.is_(True), 1), else_=0)).label("correct_attempts"),
        )
        .where(models.PracticeRecord.wrong_question_id == wrong_question_id)
    )
    row = db.execute(stmt).one()
    total_attempts = int(row.total_attempts or 0)
    correct_attempts = int(row.correct_attempts or 0)
    accuracy_rate = round((correct_attempts / total_attempts), 4) if total_attempts else 0.0
    return total_attempts, correct_attempts, accuracy_rate


def list_recent_practice_records_by_question(
    db: Session,
    wrong_question_id: int,
    limit: int = 10,
) -> list[models.PracticeRecord]:
    stmt = (
        select(models.PracticeRecord)
        .where(models.PracticeRecord.wrong_question_id == wrong_question_id)
        .order_by(models.PracticeRecord.answered_at.desc(), models.PracticeRecord.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def normalize_display_name(value: str | None) -> str | None:
    name = (value or "").strip()
    return name or None


def user_label(
    user: models.User | None = None,
    *,
    username: str | None = None,
    display_name: str | None = None,
) -> str:
    if user is not None:
        username = user.username
        display_name = getattr(user, "display_name", None)
    return normalize_display_name(display_name) or (username or "")


def get_user_by_username(db: Session, username: str) -> models.User | None:
    stmt = select(models.User).where(models.User.username == username)
    return db.scalar(stmt)


def get_user_by_id(db: Session, user_id: int) -> models.User | None:
    return db.get(models.User, user_id)


def list_managed_users(db: Session, actor) -> list[models.User]:
    stmt = select(models.User).order_by(models.User.created_at.desc())
    if not is_superadmin(actor.role):
        stmt = stmt.where(
            models.User.role == models.UserRole.student,
            models.User.created_by == actor.id,
        )
    return list(db.scalars(stmt).all())


def _owned_student_filter(actor):
    if is_superadmin(actor.role):
        return None
    return actor.id


def delete_user(db: Session, *, actor_id: int, target_id: int) -> None:
    target = get_user_by_id(db, target_id)
    if not target:
        raise ValueError("用户不存在")
    if target.id == actor_id:
        raise ValueError("不能删除当前登录账号")
    if target.username == settings.admin_username:
        raise ValueError("不能删除系统默认超管账号")

    actor = get_user_by_id(db, actor_id)
    if not actor or not can_delete_role(actor.role, target.role) or not can_access_managed_user(actor, target):
        raise PermissionError("无权删除该用户")

    if coerce_role(target.role) == models.UserRole.superadmin:
        remaining = int(
            db.scalar(
                select(func.count())
                .select_from(models.User)
                .where(models.User.id != target.id, models.User.role == models.UserRole.superadmin)
            )
            or 0
        )
        if remaining <= 0:
            raise ValueError("不能删除唯一的超管账号")

    db.query(models.UserAnswer).filter(models.UserAnswer.user_id == target.id).delete()
    db.query(models.UserAssignment).filter(models.UserAssignment.user_id == target.id).delete()
    db.query(models.Assignment).filter(models.Assignment.created_by == target.id).update(
        {models.Assignment.created_by: actor_id}
    )
    db.query(models.User).filter(models.User.created_by == target.id).update({models.User.created_by: None})
    db.delete(target)
    db.commit()


def set_user_active(db: Session, *, actor_id: int, target_id: int, is_active: bool) -> models.User:
    target = get_user_by_id(db, target_id)
    if not target:
        raise ValueError("用户不存在")
    if target.id == actor_id:
        raise ValueError("不能停用或启用当前登录账号")
    if not is_active and target.username == settings.admin_username:
        raise ValueError("不能停用系统默认超管账号")

    actor = get_user_by_id(db, actor_id)
    if not actor or not can_delete_role(actor.role, target.role) or not can_access_managed_user(actor, target):
        raise PermissionError("无权修改该用户状态")

    if not is_active and coerce_role(target.role) == models.UserRole.superadmin:
        remaining = int(
            db.scalar(
                select(func.count())
                .select_from(models.User)
                .where(
                    models.User.id != target.id,
                    models.User.role == models.UserRole.superadmin,
                    models.User.is_active.is_(True),
                )
            )
            or 0
        )
        if remaining <= 0:
            raise ValueError("不能停用唯一启用的超管账号")

    if target.is_active == is_active:
        return target

    target.is_active = is_active
    verb = "启用" if is_active else "停用"
    write_activity_log(
        db,
        actor=actor,
        action="user.activate" if is_active else "user.deactivate",
        resource_type="user",
        resource_id=target.id,
        summary=f"{actor.username} {verb}了用户 {target.username}",
        extra={"username": target.username, "is_active": is_active},
    )
    db.commit()
    db.refresh(target)
    return target


def create_assignment(
    db: Session,
    *,
    admin_user_id: int,
    payload: schemas.AssignmentCreateIn,
) -> models.Assignment:
    questions = list(
        db.scalars(
            select(models.WrongQuestion)
            .where(
                models.WrongQuestion.question_type_id == payload.question_type_id,
                models.WrongQuestion.deleted.is_(False),
            )
            .order_by(func.random())
            .limit(payload.question_count)
        ).all()
    )

    assignment = models.Assignment(
        title=payload.title,
        description=payload.description,
        created_by=admin_user_id,
    )
    db.add(assignment)
    db.flush()

    for idx, question in enumerate(questions, start=1):
        normalized_correct_answer = _normalize_answers_for_storage(question.options, question.correct_answer)
        snapshot = {
            "stem": question.stem,
            "options": question.options,
            "correct_answer": normalized_correct_answer,
            "question_type_id": question.question_type_id,
            "knowledge_tag_ids": [tag.knowledge_tag_id for tag in question.tags],
        }
        db.add(
            models.AssignmentQuestion(
                assignment_id=assignment.id,
                wrong_question_id=question.id,
                question_order=idx,
                snapshot=snapshot,
            )
        )

    db.commit()
    db.refresh(assignment)
    return assignment


def _assignment_question_count(db: Session, assignment_id: int) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(models.AssignmentQuestion).where(
                models.AssignmentQuestion.assignment_id == assignment_id
            )
        )
        or 0
    )


def _assignment_assigned_user_count(db: Session, assignment_id: int) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(models.UserAssignment).where(
                models.UserAssignment.assignment_id == assignment_id
            )
        )
        or 0
    )


def _assignment_assigned_usernames(db: Session, assignment_id: int) -> list[str]:
    return list(
        db.scalars(
            select(models.User.username)
            .join(models.UserAssignment, models.User.id == models.UserAssignment.user_id)
            .where(models.UserAssignment.assignment_id == assignment_id)
            .order_by(models.UserAssignment.id.asc())
        ).all()
    )


def serialize_assignment(db: Session, item: models.Assignment) -> schemas.AssignmentOut:
    return schemas.AssignmentOut(
        id=item.id,
        title=item.title,
        description=item.description,
        status=item.status,
        publish_at=item.publish_at,
        due_at=item.due_at,
        created_by=item.created_by,
        created_at=item.created_at,
        updated_at=item.updated_at,
        question_count=_assignment_question_count(db, item.id),
        assigned_user_count=_assignment_assigned_user_count(db, item.id),
        assigned_users=_assignment_assigned_usernames(db, item.id),
    )


def list_assignments(db: Session, actor=None) -> list[models.Assignment]:
    stmt = select(models.Assignment).order_by(models.Assignment.created_at.desc())
    if actor is not None and not is_superadmin(actor.role):
        stmt = stmt.where(models.Assignment.created_by == actor.id)
    return list(db.scalars(stmt).all())


def get_assignment(db: Session, assignment_id: int) -> models.Assignment | None:
    return db.get(models.Assignment, assignment_id)


def get_accessible_assignment(db: Session, assignment_id: int, actor) -> models.Assignment | None:
    item = get_assignment(db, assignment_id)
    if not can_access_assignment(actor, item):
        return None
    return item


def close_assignment(db: Session, assignment_id: int) -> models.Assignment | None:
    assignment = db.get(models.Assignment, assignment_id)
    if not assignment:
        return None
    assignment.status = models.AssignmentStatus.closed
    db.commit()
    db.refresh(assignment)
    return assignment


def delete_assignment(db: Session, assignment_id: int) -> bool:
    assignment = db.get(models.Assignment, assignment_id)
    if not assignment:
        return False
    db.query(models.UserAnswer).filter(models.UserAnswer.assignment_id == assignment_id).delete()
    db.query(models.UserAssignment).filter(models.UserAssignment.assignment_id == assignment_id).delete()
    db.query(models.AssignmentQuestion).filter(models.AssignmentQuestion.assignment_id == assignment_id).delete()
    db.delete(assignment)
    db.commit()
    return True


def serialize_assignment_detail(db: Session, item: models.Assignment) -> schemas.AssignmentDetailOut:
    questions = list(
        db.scalars(
            select(models.AssignmentQuestion)
            .where(models.AssignmentQuestion.assignment_id == item.id)
            .order_by(models.AssignmentQuestion.question_order.asc(), models.AssignmentQuestion.id.asc())
        ).all()
    )
    question_items: list[schemas.AssignmentQuestionOut] = []
    for aq in questions:
        snapshot = aq.snapshot or {}
        stem = snapshot.get("stem") or (aq.wrong_question.stem if aq.wrong_question else "")
        options = snapshot.get("options") or (aq.wrong_question.options if aq.wrong_question else [])
        correct_answer = snapshot.get("correct_answer") or (
            aq.wrong_question.correct_answer if aq.wrong_question else []
        )
        correct_answer = _normalize_answers_for_storage(options, correct_answer)
        question_type_id = snapshot.get("question_type_id") or (
            aq.wrong_question.question_type_id if aq.wrong_question else 0
        )
        knowledge_tag_ids = snapshot.get("knowledge_tag_ids") or (
            [tag.knowledge_tag_id for tag in aq.wrong_question.tags] if aq.wrong_question else []
        )
        question_items.append(
            schemas.AssignmentQuestionOut(
                wrong_question_id=aq.wrong_question_id,
                question_order=aq.question_order,
                stem=stem,
                options=options,
                correct_answer=correct_answer,
                question_type_id=question_type_id,
                knowledge_tag_ids=knowledge_tag_ids,
            )
        )

    base = serialize_assignment(db, item)
    return schemas.AssignmentDetailOut(**base.model_dump(), questions=question_items)


def assign_users_to_assignment(
    db: Session,
    *,
    assignment_id: int,
    user_ids: list[int],
    actor=None,
) -> int:
    assignment = db.get(models.Assignment, assignment_id)
    if assignment and assignment.status == models.AssignmentStatus.closed:
        raise ValueError("Assignment already closed")

    student_filters = [
        models.User.id.in_(user_ids),
        models.User.role == models.UserRole.student,
        models.User.is_active.is_(True),
    ]
    owner_id = _owned_student_filter(actor) if actor is not None else None
    if owner_id is not None:
        student_filters.append(models.User.created_by == owner_id)
    student_users = list(db.scalars(select(models.User).where(*student_filters)).all())
    valid_ids = {item.id for item in student_users}
    if len(valid_ids) != len(set(user_ids)):
        raise ValueError("Some user_ids are invalid students")

    existing_user_ids = set(
        db.scalars(
            select(models.UserAssignment.user_id).where(models.UserAssignment.assignment_id == assignment_id)
        ).all()
    )
    created = 0
    for user_id in user_ids:
        if user_id in existing_user_ids:
            continue
        db.add(models.UserAssignment(assignment_id=assignment_id, user_id=user_id))
        created += 1

    if assignment and assignment.status == models.AssignmentStatus.draft:
        assignment.status = models.AssignmentStatus.published
        assignment.publish_at = datetime.utcnow()
    db.commit()
    return created


def list_assignment_submissions(
    db: Session, assignment_id: int, actor=None
) -> list[schemas.AssignmentSubmissionItemOut]:
    stmt = (
        select(models.UserAssignment, models.User.username, models.User.display_name)
        .join(models.User, models.User.id == models.UserAssignment.user_id)
        .where(models.UserAssignment.assignment_id == assignment_id)
        .order_by(models.UserAssignment.id.asc())
    )
    owner_id = _owned_student_filter(actor) if actor is not None else None
    if owner_id is not None:
        stmt = stmt.where(
            models.User.role == models.UserRole.student,
            models.User.created_by == owner_id,
        )
    rows = db.execute(stmt).all()
    answer_stats_rows = db.execute(
        select(
            models.UserAnswer.user_id,
            func.count(models.UserAnswer.id),
            func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0)),
        )
        .where(models.UserAnswer.assignment_id == assignment_id)
        .group_by(models.UserAnswer.user_id)
    ).all()
    answer_stats = {
        int(user_id): (int(answered or 0), int(correct or 0))
        for user_id, answered, correct in answer_stats_rows
    }
    return [
        schemas.AssignmentSubmissionItemOut(
            user_id=row[0].user_id,
            username=row[1],
            display_name=normalize_display_name(row[2]),
            status=row[0].status,
            started_at=row[0].started_at,
            submitted_at=row[0].submitted_at,
            score=row[0].score,
            accuracy_rate=row[0].accuracy_rate,
            answered_questions=answer_stats.get(row[0].user_id, (0, 0))[0],
            correct_questions=answer_stats.get(row[0].user_id, (0, 0))[1],
        )
        for row in rows
    ]


def get_user_assignment(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
) -> models.UserAssignment | None:
    return db.scalar(
        select(models.UserAssignment).where(
            models.UserAssignment.assignment_id == assignment_id,
            models.UserAssignment.user_id == user_id,
        )
    )


def list_user_assignments(db: Session, user_id: int) -> list[schemas.LearnerAssignmentListItemOut]:
    rows = db.execute(
        select(models.UserAssignment, models.Assignment)
        .join(models.Assignment, models.Assignment.id == models.UserAssignment.assignment_id)
        .where(models.Assignment.status != models.AssignmentStatus.closed)
        .where(models.UserAssignment.user_id == user_id)
        .order_by(models.Assignment.created_at.desc())
    ).all()
    result: list[schemas.LearnerAssignmentListItemOut] = []
    for ua, assignment in rows:
        result.append(
            schemas.LearnerAssignmentListItemOut(
                assignment_id=assignment.id,
                title=assignment.title,
                status=ua.status,
                due_at=assignment.due_at,
                submitted_at=ua.submitted_at,
                score=ua.score,
                accuracy_rate=ua.accuracy_rate,
                question_count=_assignment_question_count(db, assignment.id),
            )
        )
    return result


def _is_flat_string_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0 and all(isinstance(item, str) for item in value)


def _is_grouped_string_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(
            isinstance(group, list) and group and all(isinstance(item, str) for item in group)
            for group in value
        )
    )


def _unwrap_answer_list(value: Any) -> list[Any]:
    current = value
    if isinstance(current, list) and len(current) == 1 and isinstance(current[0], list):
        current = current[0]
    return current if isinstance(current, list) else []


def _is_fill_slot_value(item: Any) -> bool:
    if item is None or isinstance(item, str):
        return True
    return isinstance(item, list) and len(item) > 0 and all(isinstance(part, str) for part in item)


def _learner_fill_slots(options: Any, correct_answer: Any) -> list[bool] | None:
    if _is_flat_string_list(options) or _is_grouped_string_list(options):
        return None
    answers = _unwrap_answer_list(correct_answer)
    if not answers or not all(_is_fill_slot_value(item) for item in answers):
        return None
    return [
        not (
            item is None
            or (isinstance(item, str) and not item.strip())
        )
        for item in answers
    ]


def _learner_multiple(options: Any, correct_answer: Any) -> bool:
    if not _is_flat_string_list(options):
        return False
    answers = _unwrap_answer_list(correct_answer)
    filled = [item for item in answers if item not in (None, "")]
    return len(filled) > 1


def get_learner_assignment_detail(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
) -> schemas.LearnerAssignmentDetailOut:
    ua = get_user_assignment(db, assignment_id=assignment_id, user_id=user_id)
    assignment = get_assignment(db, assignment_id)
    if not ua or not assignment:
        raise LookupError("任务不存在或未分配给你")
    if assignment.status == models.AssignmentStatus.closed:
        raise ValueError("任务已关闭")
    if ua.status in {models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded}:
        raise ValueError("任务已提交，无法再作答")

    detail = serialize_assignment_detail(db, assignment)
    saved_answers = {
        item.wrong_question_id: item.user_answer
        for item in list_user_answers(db, assignment_id=assignment_id, user_id=user_id)
    }
    type_ids = {q.question_type_id for q in detail.questions if q.question_type_id}
    type_names = {
        item.id: item.name
        for item in db.scalars(select(models.QuestionType).where(models.QuestionType.id.in_(type_ids))).all()
    } if type_ids else {}
    questions: list[schemas.LearnerQuestionOut] = []
    for q in detail.questions:
        questions.append(
            schemas.LearnerQuestionOut(
                wrong_question_id=q.wrong_question_id,
                question_order=q.question_order,
                stem=q.stem,
                options=q.options,
                question_type_id=q.question_type_id,
                question_type_name=type_names.get(q.question_type_id),
                knowledge_tag_ids=q.knowledge_tag_ids,
                user_answer=saved_answers.get(q.wrong_question_id),
                fill_slots=_learner_fill_slots(q.options, q.correct_answer),
                multiple=_learner_multiple(q.options, q.correct_answer),
            )
        )
    return schemas.LearnerAssignmentDetailOut(
        assignment_id=detail.id,
        title=detail.title,
        description=detail.description,
        status=ua.status,
        due_at=detail.due_at,
        submitted_at=ua.submitted_at,
        score=ua.score,
        accuracy_rate=ua.accuracy_rate,
        questions=questions,
    )


def _normalize_answer_item(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return [_normalize_answer_item(item) for item in value]
    return value


def _unwrap_singleton(value: Any) -> Any:
    current = value
    while isinstance(current, list) and len(current) == 1:
        current = current[0]
    return current


def _normalize_answer_list(values: list[Any]) -> list[Any]:
    return [_normalize_answer_item(_unwrap_singleton(item)) for item in values]


def _canonicalize_answer(values: list[Any], *, unordered: bool) -> list[Any]:
    normalized = _normalize_answer_list(values)
    if unordered:
        # Multi-select: order-insensitive comparison while keeping duplicate picks stable.
        return sorted(normalized, key=lambda item: str(item))
    return normalized


def _scalar_match(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, str) and isinstance(right, str):
        return left.strip().casefold() == right.strip().casefold()
    return left == right


def _slot_match(user_val: Any, std_val: Any) -> bool:
    user_n = _normalize_answer_item(_unwrap_singleton(user_val))
    std_n = _normalize_answer_item(_unwrap_singleton(std_val))
    if isinstance(std_n, list):
        if isinstance(user_n, list):
            return _canonicalize_answer(user_n, unordered=True) == _canonicalize_answer(std_n, unordered=True)
        return any(_scalar_match(user_n, alt) for alt in std_n)
    return _scalar_match(user_n, std_n)


def _score_answer(
    user_answer: list[Any] | None,
    standard_answer: list[Any] | None,
    *,
    options: Any,
) -> tuple[int, int, list[bool]]:
    """Return (correct_slots, total_slots, per-slot flags).

    Cloze / grammar fills score each blank. Grouped choice scores each sub-question.
    A plain single/multi choice still counts as one slot.
    """
    user = user_answer if isinstance(user_answer, list) else []
    standard = standard_answer if isinstance(standard_answer, list) else []
    if _is_grouped_string_list(options):
        total = len(options)
        flags = [
            _slot_match(user[idx] if idx < len(user) else None, standard[idx] if idx < len(standard) else None)
            for idx in range(total)
        ]
        return sum(1 for ok in flags if ok), total, flags
    if _is_flat_string_list(options):
        ok = _canonicalize_answer(user, unordered=True) == _canonicalize_answer(standard, unordered=True)
        return (1 if ok else 0), 1, [ok]
    comparable: list[tuple[Any, Any]] = []
    for idx, std_item in enumerate(_unwrap_answer_list(standard) or standard):
        if std_item is None or (isinstance(std_item, str) and not str(std_item).strip()):
            continue
        comparable.append((user[idx] if idx < len(user) else None, std_item))
    if not comparable:
        ok = _canonicalize_answer(user, unordered=False) == _canonicalize_answer(standard, unordered=False)
        return (1 if ok else 0), 1, [ok]
    flags = [_slot_match(u, s) for u, s in comparable]
    return sum(1 for ok in flags if ok), len(flags), flags


def _is_answer_correct(user_answer: list[Any], standard_answer: list[Any], *, options: Any) -> bool:
    correct, total, _ = _score_answer(user_answer, standard_answer, options=options)
    return total > 0 and correct == total


def save_user_answer(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
    wrong_question_id: int,
    user_answer: list[Any],
) -> models.UserAnswer:
    ua = get_user_assignment(db, assignment_id=assignment_id, user_id=user_id)
    if not ua:
        raise ValueError("Assignment not assigned to user")
    assignment = get_assignment(db, assignment_id)
    if not assignment:
        raise ValueError("Assignment not found")
    if assignment.status == models.AssignmentStatus.closed:
        raise ValueError("Assignment is closed")
    if ua.status in {models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded}:
        raise ValueError("Assignment already submitted")

    assignment_question = db.scalar(
        select(models.AssignmentQuestion).where(
            models.AssignmentQuestion.assignment_id == assignment_id,
            models.AssignmentQuestion.wrong_question_id == wrong_question_id,
        )
    )
    if not assignment_question:
        raise ValueError("Question not in assignment")
    snapshot = assignment_question.snapshot or {}
    standard_answer = snapshot.get("correct_answer")
    if standard_answer is None:
        standard_answer = assignment_question.wrong_question.correct_answer if assignment_question.wrong_question else []
    options = snapshot.get("options")
    if options is None and assignment_question.wrong_question:
        options = assignment_question.wrong_question.options
    normalized_standard_answer = _normalize_answers_for_storage(options, standard_answer)
    normalized_user_answer = _normalize_answers_for_storage(options, user_answer)
    is_correct = _is_answer_correct(normalized_user_answer, normalized_standard_answer, options=options)

    answer = db.scalar(
        select(models.UserAnswer).where(
            models.UserAnswer.assignment_id == assignment_id,
            models.UserAnswer.user_id == user_id,
            models.UserAnswer.wrong_question_id == wrong_question_id,
        )
    )
    now = datetime.utcnow()
    if answer:
        answer.user_answer = normalized_user_answer
        answer.standard_answer = normalized_standard_answer
        answer.is_correct = is_correct
        answer.answered_at = now
    else:
        answer = models.UserAnswer(
            assignment_id=assignment_id,
            user_id=user_id,
            wrong_question_id=wrong_question_id,
            user_answer=normalized_user_answer,
            standard_answer=normalized_standard_answer,
            is_correct=is_correct,
            answered_at=now,
        )
        db.add(answer)

    if ua.status == models.UserAssignmentStatus.assigned:
        ua.status = models.UserAssignmentStatus.in_progress
        ua.started_at = now

    db.commit()
    db.refresh(answer)
    return answer


def list_user_answers(db: Session, *, assignment_id: int, user_id: int) -> list[models.UserAnswer]:
    return list(
        db.scalars(
            select(models.UserAnswer)
            .where(
                models.UserAnswer.assignment_id == assignment_id,
                models.UserAnswer.user_id == user_id,
            )
            .order_by(models.UserAnswer.wrong_question_id.asc())
        ).all()
    )


def _assignment_stem_map(db: Session, assignment_id: int) -> dict[int, str]:
    rows = db.execute(
        select(models.AssignmentQuestion.wrong_question_id, models.AssignmentQuestion.snapshot, models.WrongQuestion.stem)
        .join(models.WrongQuestion, models.WrongQuestion.id == models.AssignmentQuestion.wrong_question_id, isouter=True)
        .where(models.AssignmentQuestion.assignment_id == assignment_id)
    ).all()
    result: dict[int, str] = {}
    for wrong_question_id, snapshot, stem in rows:
        snap_stem = snapshot.get("stem") if isinstance(snapshot, dict) else None
        result[int(wrong_question_id)] = str(snap_stem or stem or "")
    return result


def _assignment_question_meta(db: Session, assignment_id: int) -> dict[int, tuple[Any, Any]]:
    rows = db.execute(
        select(
            models.AssignmentQuestion.wrong_question_id,
            models.AssignmentQuestion.snapshot,
            models.WrongQuestion.options,
            models.WrongQuestion.correct_answer,
        )
        .join(
            models.WrongQuestion,
            models.WrongQuestion.id == models.AssignmentQuestion.wrong_question_id,
            isouter=True,
        )
        .where(models.AssignmentQuestion.assignment_id == assignment_id)
    ).all()
    result: dict[int, tuple[Any, Any]] = {}
    for wrong_question_id, snapshot, options, correct_answer in rows:
        snap = snapshot if isinstance(snapshot, dict) else {}
        result[int(wrong_question_id)] = (
            snap.get("options") or (options or []),
            snap.get("correct_answer") or (correct_answer or []),
        )
    return result


def _serialize_user_answer_out(
    answer: models.UserAnswer,
    stem_map: dict[int, str],
    meta: dict[int, tuple[Any, Any]] | None = None,
) -> schemas.UserAnswerOut:
    options, fallback_standard = (meta or {}).get(answer.wrong_question_id, (None, None))
    standard = answer.standard_answer if answer.standard_answer is not None else fallback_standard
    correct_slots, total_slots, flags = _score_answer(
        answer.user_answer, standard, options=options
    )
    return schemas.UserAnswerOut(
        id=answer.id,
        assignment_id=answer.assignment_id,
        user_id=answer.user_id,
        wrong_question_id=answer.wrong_question_id,
        wrong_question_stem=stem_map.get(answer.wrong_question_id),
        user_answer=answer.user_answer,
        standard_answer=answer.standard_answer,
        is_correct=answer.is_correct,
        correct_slots=correct_slots,
        total_slots=total_slots,
        slot_correct=flags,
        answered_at=answer.answered_at,
    )


def _grade_assignment_answers(
    *,
    questions: list[schemas.AssignmentQuestionOut],
    answers: list[models.UserAnswer],
) -> tuple[int, int, int, int]:
    by_qid = {item.wrong_question_id: item for item in answers}
    total_slots = 0
    correct_slots = 0
    correct_questions = 0
    for q in questions:
        answer = by_qid.get(q.wrong_question_id)
        standard = (answer.standard_answer if answer and answer.standard_answer is not None else q.correct_answer)
        user = answer.user_answer if answer else []
        got, total, _ = _score_answer(user, standard, options=q.options)
        total_slots += total
        correct_slots += got
        if total > 0 and got == total:
            correct_questions += 1
    return correct_slots, max(total_slots, 1), correct_questions, len(questions)


def submit_assignment(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
) -> schemas.SubmitAssignmentOut:
    ua = get_user_assignment(db, assignment_id=assignment_id, user_id=user_id)
    if not ua:
        raise ValueError("Assignment not assigned to user")
    assignment = get_assignment(db, assignment_id)
    if not assignment:
        raise ValueError("Assignment not found")
    if assignment.status == models.AssignmentStatus.closed:
        raise ValueError("Assignment is closed")
    if ua.status in {models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded}:
        answers = list_user_answers(db, assignment_id=assignment_id, user_id=user_id)
        stem_map = _assignment_stem_map(db, assignment_id)
        meta = _assignment_question_meta(db, assignment_id)
        detail = serialize_assignment_detail(db, assignment)
        correct_slots, total_slots, correct_questions, total_questions = _grade_assignment_answers(
            questions=detail.questions, answers=answers
        )
        score = round((correct_slots / total_slots) * 100, 2) if total_slots else 0.0
        accuracy = round((correct_slots / total_slots), 4) if total_slots else 0.0
        return schemas.SubmitAssignmentOut(
            assignment_id=assignment_id,
            user_id=user_id,
            total_questions=total_questions,
            answered_questions=len(answers),
            correct_questions=correct_questions,
            total_slots=total_slots,
            correct_slots=correct_slots,
            score=score,
            accuracy_rate=accuracy,
            answers=[_serialize_user_answer_out(item, stem_map, meta) for item in answers],
        )

    answers = list_user_answers(db, assignment_id=assignment_id, user_id=user_id)
    stem_map = _assignment_stem_map(db, assignment_id)
    meta = _assignment_question_meta(db, assignment_id)
    detail = serialize_assignment_detail(db, assignment)
    correct_slots, total_slots, correct_questions, total_questions = _grade_assignment_answers(
        questions=detail.questions, answers=answers
    )
    score = round((correct_slots / total_slots) * 100, 2) if total_slots else 0.0
    accuracy_rate = round((correct_slots / total_slots), 4) if total_slots else 0.0

    ua.status = models.UserAssignmentStatus.submitted
    ua.submitted_at = datetime.utcnow()
    ua.score = score
    ua.accuracy_rate = accuracy_rate
    db.commit()

    return schemas.SubmitAssignmentOut(
        assignment_id=assignment_id,
        user_id=user_id,
        total_questions=total_questions,
        answered_questions=len(answers),
        correct_questions=correct_questions,
        total_slots=total_slots,
        correct_slots=correct_slots,
        score=score,
        accuracy_rate=accuracy_rate,
        answers=[_serialize_user_answer_out(item, stem_map, meta) for item in answers],
    )


PORTRAIT_AXIS_CATEGORIES = [
    ("听力", "听力"),
    ("选择类", "选择"),
    ("语篇阅读", "阅读"),
    ("语言运用", "语言运用"),
    ("表达与改写", "表达"),
]
_MIN_AXIS_ATTEMPTS = 5
_MIN_STATUS_ATTEMPTS = 8
_MIN_KNOWLEDGE_ATTEMPTS = 3


def resolve_accessible_student(db: Session, actor, username: str) -> models.User:
    uname = username.strip()
    if not uname:
        raise ValueError("请指定学生")
    target = get_user_by_username(db, uname)
    if not target or coerce_role(target.role) != models.UserRole.student:
        raise LookupError("学生不存在")
    if not can_access_managed_user(actor, target):
        raise PermissionError("无权查看该学生")
    return target


def resolve_accessible_student_by_id(db: Session, actor, user_id: int) -> models.User:
    target = get_user_by_id(db, user_id)
    if not target or coerce_role(target.role) != models.UserRole.student:
        raise LookupError("学生不存在")
    if not can_access_managed_user(actor, target):
        raise PermissionError("无权查看该学生")
    return target


def _can_read_student_analysis(db: Session, actor, username: str) -> bool:
    uname = username.strip()
    if not uname:
        return False
    if is_superadmin(actor.role):
        return True
    if coerce_role(actor.role) == models.UserRole.student:
        return actor.username == uname
    owned_names = set(
        db.scalars(
            select(models.User.username).where(
                models.User.role == models.UserRole.student,
                models.User.created_by == actor.id,
            )
        ).all()
    )
    return uname in owned_names


def list_visible_students(db: Session, actor) -> list[models.User]:
    return [u for u in list_managed_users(db, actor) if coerce_role(u.role) == models.UserRole.student]


def _accuracy(correct: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(correct / total, 4)


def _portrait_status(attempts: int, accuracy: float | None, weakest: float | None) -> str:
    if attempts < _MIN_STATUS_ATTEMPTS:
        return "insufficient"
    rate = accuracy or 0.0
    if rate < 0.60:
        return "lagging"
    if rate < 0.75 or (weakest is not None and weakest < 0.50):
        return "watch"
    return "stable"


def _knowledge_action(accuracy: float) -> str:
    if accuracy < 0.45:
        return "布置相似题"
    if accuracy < 0.60:
        return "专项巩固"
    return "保持即可"


def _visible_student_ids(db: Session, actor) -> list[int]:
    return [u.id for u in list_visible_students(db, actor)]


def _answer_totals_by_user(db: Session, user_ids: list[int]) -> dict[int, tuple[int, int, datetime | None]]:
    if not user_ids:
        return {}
    stmt = (
        select(
            models.UserAnswer.user_id,
            func.count(models.UserAnswer.id).label("total"),
            func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0)).label("correct"),
            func.max(models.UserAnswer.answered_at).label("last_at"),
        )
        .where(models.UserAnswer.user_id.in_(user_ids))
        .group_by(models.UserAnswer.user_id)
    )
    out: dict[int, tuple[int, int, datetime | None]] = {}
    for row in db.execute(stmt).all():
        out[int(row.user_id)] = (int(row.total or 0), int(row.correct or 0), row.last_at)
    return out


def _knowledge_rows_by_user(
    db: Session, user_ids: list[int]
) -> dict[int, list[tuple[str, int, int]]]:
    if not user_ids:
        return {}
    stmt = (
        select(
            models.UserAnswer.user_id,
            models.KnowledgeTag.name,
            func.count(models.UserAnswer.id).label("total"),
            func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0)).label("correct"),
        )
        .join(models.WrongQuestion, models.WrongQuestion.id == models.UserAnswer.wrong_question_id)
        .join(
            models.WrongQuestionKnowledgeTag,
            models.WrongQuestionKnowledgeTag.wrong_question_id == models.WrongQuestion.id,
        )
        .join(models.KnowledgeTag, models.KnowledgeTag.id == models.WrongQuestionKnowledgeTag.knowledge_tag_id)
        .where(models.UserAnswer.user_id.in_(user_ids))
        .group_by(models.UserAnswer.user_id, models.KnowledgeTag.name)
    )
    grouped: dict[int, list[tuple[str, int, int]]] = {}
    for row in db.execute(stmt).all():
        grouped.setdefault(int(row.user_id), []).append(
            (str(row.name), int(row.total or 0), int(row.correct or 0))
        )
    return grouped


def _axis_rows_by_user(db: Session, user_ids: list[int]) -> dict[int, dict[str, tuple[int, int]]]:
    if not user_ids:
        return {}
    stmt = (
        select(
            models.UserAnswer.user_id,
            models.QuestionType.category,
            func.count(models.UserAnswer.id).label("total"),
            func.sum(case((models.UserAnswer.is_correct.is_(True), 1), else_=0)).label("correct"),
        )
        .join(models.WrongQuestion, models.WrongQuestion.id == models.UserAnswer.wrong_question_id)
        .join(models.QuestionType, models.QuestionType.id == models.WrongQuestion.question_type_id)
        .where(models.UserAnswer.user_id.in_(user_ids))
        .group_by(models.UserAnswer.user_id, models.QuestionType.category)
    )
    grouped: dict[int, dict[str, tuple[int, int]]] = {}
    for row in db.execute(stmt).all():
        grouped.setdefault(int(row.user_id), {})[str(row.category or "其他")] = (
            int(row.total or 0),
            int(row.correct or 0),
        )
    return grouped


def _class_axis_rates(axis_by_user: dict[int, dict[str, tuple[int, int]]]) -> dict[str, float | None]:
    totals: dict[str, list[int]] = {name: [0, 0] for name, _ in PORTRAIT_AXIS_CATEGORIES}
    for per_user in axis_by_user.values():
        for name, (total, correct) in per_user.items():
            if name in totals:
                totals[name][0] += total
                totals[name][1] += correct
    return {name: _accuracy(correct, total) for name, (total, correct) in totals.items()}


def _weak_tag_names(rows: list[tuple[str, int, int]], limit: int = 2) -> list[str]:
    scored: list[tuple[str, float, int]] = []
    for name, total, correct in rows:
        if total < _MIN_KNOWLEDGE_ATTEMPTS:
            continue
        rate = _accuracy(correct, total)
        if rate is None:
            continue
        scored.append((name, rate, total))
    scored.sort(key=lambda item: (item[1], -item[2]))
    return [name for name, _, _ in scored[:limit]]


def _weakest_rate(rows: list[tuple[str, int, int]]) -> float | None:
    rates: list[float] = []
    for _name, total, correct in rows:
        if total < _MIN_KNOWLEDGE_ATTEMPTS:
            continue
        rate = _accuracy(correct, total)
        if rate is not None:
            rates.append(rate)
    return min(rates) if rates else None


def list_student_roster(db: Session, actor) -> schemas.StudentRosterOut:
    students = list_visible_students(db, actor)
    ids = [u.id for u in students]
    totals = _answer_totals_by_user(db, ids)
    knowledge = _knowledge_rows_by_user(db, ids)
    items: list[schemas.StudentRosterItemOut] = []
    class_correct = 0
    class_total = 0
    watch = 0
    lag = 0
    insufficient = 0
    for user in students:
        total, correct, last_at = totals.get(user.id, (0, 0, None))
        accuracy = _accuracy(correct, total)
        status = _portrait_status(total, accuracy, _weakest_rate(knowledge.get(user.id, [])))
        if status == "watch":
            watch += 1
        elif status == "lagging":
            lag += 1
        elif status == "insufficient":
            insufficient += 1
        if total >= _MIN_STATUS_ATTEMPTS:
            class_total += total
            class_correct += correct
        items.append(
            schemas.StudentRosterItemOut(
                user_id=user.id,
                username=user.username,
                display_name=normalize_display_name(user.display_name),
                is_active=user.is_active,
                total_attempts=total,
                accuracy_rate=accuracy,
                last_answered_at=last_at,
                status=status,
                weak_tags=_weak_tag_names(knowledge.get(user.id, [])),
            )
        )
    items.sort(key=lambda item: (item.status != "lagging", item.status != "watch", user_label(username=item.username, display_name=item.display_name)))
    return schemas.StudentRosterOut(
        students=items,
        class_accuracy_rate=_accuracy(class_correct, class_total),
        watch_count=watch,
        lag_count=lag,
        insufficient_count=insufficient,
    )


def get_student_portrait(
    db: Session,
    *,
    student: models.User,
    actor,
    include_class_compare: bool,
) -> schemas.StudentPortraitOut:
    visible_ids = _visible_student_ids(db, actor)
    totals = _answer_totals_by_user(db, [student.id])
    total, correct, last_at = totals.get(student.id, (0, 0, None))
    accuracy = _accuracy(correct, total)
    knowledge_rows = _knowledge_rows_by_user(db, [student.id]).get(student.id, [])
    status = _portrait_status(total, accuracy, _weakest_rate(knowledge_rows))
    axis_by_user = _axis_rows_by_user(db, visible_ids if include_class_compare else [student.id])
    class_rates = _class_axis_rates(axis_by_user) if include_class_compare else {}
    student_axes = axis_by_user.get(student.id, {})
    axes: list[schemas.PortraitAxisOut] = []
    for category, label in PORTRAIT_AXIS_CATEGORIES:
        attempts, axis_correct = student_axes.get(category, (0, 0))
        sufficient = attempts >= _MIN_AXIS_ATTEMPTS
        axes.append(
            schemas.PortraitAxisOut(
                name=category,
                label=label,
                attempts=attempts,
                accuracy_rate=_accuracy(axis_correct, attempts) if sufficient else None,
                class_accuracy_rate=class_rates.get(category) if include_class_compare else None,
                sufficient=sufficient,
            )
        )
    knowledge_out: list[schemas.PortraitKnowledgeOut] = []
    scored: list[tuple[str, int, float]] = []
    for name, attempts, k_correct in knowledge_rows:
        if attempts < _MIN_KNOWLEDGE_ATTEMPTS:
            continue
        rate = _accuracy(k_correct, attempts)
        if rate is None:
            continue
        scored.append((name, attempts, rate))
    scored.sort(key=lambda item: (item[2], -item[1]))
    for name, attempts, rate in scored[:8]:
        knowledge_out.append(
            schemas.PortraitKnowledgeOut(
                name=name,
                attempts=attempts,
                accuracy_rate=rate,
                action=_knowledge_action(rate),
            )
        )
    latest = get_latest_learning_weakness_analysis(db, username=student.username, actor=actor)
    return schemas.StudentPortraitOut(
        user_id=student.id,
        username=student.username,
        display_name=normalize_display_name(student.display_name),
        is_active=student.is_active,
        total_attempts=total,
        accuracy_rate=accuracy,
        last_answered_at=last_at,
        status=status,
        axes=axes,
        knowledge=knowledge_out,
        latest_analysis=serialize_learning_weakness_analysis(latest) if latest else None,
        include_class_compare=include_class_compare,
    )


def get_assignment_submission_detail(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
) -> schemas.AssignmentSubmissionDetailOut | None:
    ua = get_user_assignment(db, assignment_id=assignment_id, user_id=user_id)
    user = get_user_by_id(db, user_id)
    if not ua or not user:
        return None
    answers = list_user_answers(db, assignment_id=assignment_id, user_id=user_id)
    stem_map = _assignment_stem_map(db, assignment_id)
    meta = _assignment_question_meta(db, assignment_id)
    return schemas.AssignmentSubmissionDetailOut(
        assignment_id=assignment_id,
        user_id=user_id,
        username=user.username,
        display_name=normalize_display_name(user.display_name),
        status=ua.status,
        started_at=ua.started_at,
        submitted_at=ua.submitted_at,
        score=ua.score,
        accuracy_rate=ua.accuracy_rate,
        answers=[_serialize_user_answer_out(item, stem_map, meta) for item in answers],
    )
