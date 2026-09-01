from datetime import datetime
import re
from typing import Any

from sqlalchemy import Float, case, delete, exists, func, or_, select, union_all
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.permissions import (
    can_access_assignment,
    can_access_managed_user,
    can_access_student_group,
    can_delete_role,
    coerce_role,
    is_org_admin,
    is_org_staff,
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


def _organization_id_for_creator(db: Session, created_by: int | None) -> int | None:
    if not created_by:
        return None
    creator = get_user_by_id(db, created_by)
    return getattr(creator, "organization_id", None) if creator else None


def create_wrong_question(
    db: Session,
    payload: schemas.WrongQuestionCreate | schemas.WrongQuestionBase,
    *,
    created_by: int | None = None,
) -> models.WrongQuestion:
    normalized_correct_answer = _normalize_answers_for_storage(payload.options, payload.correct_answer)
    normalized_wrong_answer = _normalize_answers_for_storage(payload.options, payload.wrong_answer or [])
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
        organization_id=_organization_id_for_creator(db, created_by),
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


def _insert_wrong_questions(
    db: Session,
    items: list[schemas.WrongQuestionCreate],
    *,
    created_by: int | None = None,
) -> list[models.WrongQuestion]:
    created: list[models.WrongQuestion] = []
    for payload in items:
        normalized_correct_answer = _normalize_answers_for_storage(payload.options, payload.correct_answer)
        normalized_wrong_answer = _normalize_answers_for_storage(payload.options, payload.wrong_answer or [])
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
            organization_id=_organization_id_for_creator(db, created_by),
        )
        db.add(question)
        db.flush()

        for tag_id in payload.knowledge_tag_ids:
            question.tags.append(
                models.WrongQuestionKnowledgeTag(
                    wrong_question_id=question.id,
                    knowledge_tag_id=tag_id,
                )
            )
        created.append(question)
    return created


def create_wrong_questions_batch(
    db: Session,
    items: list[schemas.WrongQuestionCreate],
    *,
    created_by: int | None = None,
    commit: bool = True,
) -> list[models.WrongQuestion]:
    created = _insert_wrong_questions(db, items, created_by=created_by)
    if commit:
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
    "org.public_bank.request": "申请平台公共库",
    "org.public_bank.approve": "批准平台公共库",
    "org.public_bank.reject": "驳回平台公共库",
    "org.public_bank.revoke": "撤回平台公共库",
    "question.public.publish": "发布到公共库",
    "question.public.unpublish": "取消公共库发布",
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
        organization_id=getattr(question, "organization_id", None),
        is_public=bool(getattr(question, "is_public", False)),
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


def _owner_scope_filters(actor, *, owner_only: bool = False, exclude_own: bool = False):
    """题目归属过滤。超管默认不限制。"""
    if actor is None or is_superadmin(actor.role):
        return []
    if owner_only:
        return [models.WrongQuestion.created_by == actor.id]
    if exclude_own:
        org_id = getattr(actor, "organization_id", None)
        if org_id:
            return [models.WrongQuestion.organization_id == org_id]
        return [
            or_(
                models.WrongQuestion.created_by.is_(None),
                models.WrongQuestion.created_by != actor.id,
            )
        ]
    return []


def question_bank_scope_filters(db: Session, actor, scope: str | None) -> list:
    resolved = scope or "mine"
    if actor is None:
        return [models.WrongQuestion.id.is_(None)]
    if is_superadmin(actor.role):
        if resolved == "mine":
            return [models.WrongQuestion.created_by == actor.id]
        if resolved == "public":
            return [models.WrongQuestion.is_public.is_(True)]
        return []
    if resolved == "mine":
        return [models.WrongQuestion.created_by == actor.id]
    if resolved == "org":
        org_id = getattr(actor, "organization_id", None)
        if not org_id:
            return [models.WrongQuestion.id.is_(None)]
        return [models.WrongQuestion.organization_id == org_id]
    if resolved == "public":
        if not org_has_public_bank_access(db, actor):
            return [models.WrongQuestion.id.is_(None)]
        return [models.WrongQuestion.is_public.is_(True)]
    return [models.WrongQuestion.created_by == actor.id]


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
    exclude_own: bool = False,
    bank_scope: str | None = None,
) -> tuple[int, list[models.WrongQuestion]]:
    stmt = select(models.WrongQuestion).where(models.WrongQuestion.deleted.is_(deleted))
    if bank_scope:
        for clause in question_bank_scope_filters(db, actor, bank_scope):
            stmt = stmt.where(clause)
    else:
        restrict_owner = owner_only
        if restrict_owner is None:
            restrict_owner = actor is not None and not is_superadmin(actor.role)
        for clause in _owner_scope_filters(actor, owner_only=bool(restrict_owner), exclude_own=exclude_own):
            stmt = stmt.where(clause)

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
    """清空回收站：彻底删除已软删错题。机构管理员清本机构，教师只清自己的。"""
    stmt = select(models.WrongQuestion.id).where(models.WrongQuestion.deleted.is_(True))
    if actor is not None and not is_superadmin(actor.role):
        if is_org_admin(actor.role) and getattr(actor, "organization_id", None):
            stmt = stmt.where(models.WrongQuestion.organization_id == actor.organization_id)
        else:
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


def org_has_public_bank_access(db: Session, actor) -> bool:
    if actor is None:
        return False
    if is_superadmin(actor.role):
        return True
    org_id = getattr(actor, "organization_id", None)
    if not org_id:
        return False
    org = get_organization(db, org_id)
    return bool(org and org.public_bank_status == models.ClaimRequestStatus.approved)


def has_bank_view_access(db: Session, actor) -> bool:
    return org_has_public_bank_access(db, actor)


def assignment_draw_filters(db: Session, actor, sources: list[str] | None = None) -> list:
    if actor is None:
        return []
    selected = sources or ["mine"]
    if is_superadmin(actor.role) and "org" in selected:
        return []
    parts = []
    if "mine" in selected:
        parts.append(models.WrongQuestion.created_by == actor.id)
    if "org" in selected and getattr(actor, "organization_id", None):
        parts.append(models.WrongQuestion.organization_id == actor.organization_id)
    if "public" in selected and org_has_public_bank_access(db, actor):
        parts.append(models.WrongQuestion.is_public.is_(True))
    if not parts:
        return [models.WrongQuestion.id.is_(None)]
    return [or_(*parts)]


def bank_access_for_user(db: Session, actor) -> dict:
    if is_superadmin(actor.role):
        return {"can_view_question_bank": True, "bank_request_status": None}
    org_id = getattr(actor, "organization_id", None)
    org = get_organization(db, org_id) if org_id else None
    status = org.public_bank_status if org else None
    return {
        "can_view_question_bank": status == models.ClaimRequestStatus.approved,
        "bank_request_status": models.ClaimRequestStatus(status) if status else None,
    }


def serialize_org_public_bank(db: Session, org: models.Organization) -> schemas.QuestionClaimOut:
    reviewer_ids = {org.public_bank_reviewer_id} if org.public_bank_reviewer_id else set()
    names = _usernames_by_ids(db, reviewer_ids)
    status = org.public_bank_status or models.ClaimRequestStatus.pending
    return schemas.QuestionClaimOut(
        id=org.id,
        requester_id=org.created_by or 0,
        requester_username=org.name,
        status=models.ClaimRequestStatus(status),
        reason=org.public_bank_reason,
        reviewer_id=org.public_bank_reviewer_id,
        reviewer_username=names.get(org.public_bank_reviewer_id) if org.public_bank_reviewer_id else None,
        review_note=org.public_bank_review_note,
        created_at=org.public_bank_requested_at or org.created_at,
        reviewed_at=org.public_bank_reviewed_at,
    )


def list_org_public_bank_requests(
    db: Session,
    *,
    page: int,
    page_size: int,
    status: models.ClaimRequestStatus | None = None,
) -> tuple[int, list[models.Organization]]:
    stmt = select(models.Organization).where(models.Organization.public_bank_status.is_not(None))
    if status:
        stmt = stmt.where(models.Organization.public_bank_status == status)
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0
    items = list(
        db.scalars(
            stmt.order_by(
                models.Organization.public_bank_requested_at.desc().nulls_last(),
                models.Organization.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return total, items


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
        summary=f"{actor.username} 申请查看共享题库",
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
            summary=f"{reviewer.username} 批准 {requester_name} 查看共享题库",
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
        updates["wrong_answer"] = _normalize_answers_for_storage(next_options, updates["wrong_answer"] or [])
    elif "options" in updates:
        updates["wrong_answer"] = _normalize_answers_for_storage(next_options, question.wrong_answer or [])

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
            models.User.teacher_id == owner_id,
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
            models.User.teacher_id == owner_id,
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


def _draft_publish_payload(record: models.KnowledgeLessonAnalysis) -> dict[str, Any]:
    payload = _knowledge_lesson_result_payload(record.result if isinstance(record.result, dict) else {})
    payload["student_message"] = (record.student_message or "").strip()
    return payload


def _normalize_published_payload(raw: dict[str, Any] | None) -> dict[str, Any]:
    payload = _knowledge_lesson_result_payload(raw if isinstance(raw, dict) else {})
    payload["student_message"] = str((raw or {}).get("student_message") or "").strip()
    return payload


def _has_unpublished_changes(record: models.KnowledgeLessonAnalysis) -> bool:
    if record.status != "sent" or not isinstance(record.published_result, dict):
        return False
    return _draft_publish_payload(record) != _normalize_published_payload(record.published_result)


def _examples_out(examples: list[dict[str, str]]) -> list[schemas.KnowledgeExampleOut]:
    return [
        schemas.KnowledgeExampleOut(
            sentence=ex["sentence"],
            translation=ex["translation"],
            analysis=ex["analysis"],
        )
        for ex in examples
    ]


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
        examples=_examples_out(payload["examples"]),
        quiz=schemas.KnowledgeQuizOut(
            stem=quiz["stem"],
            options=quiz["options"],
            correct_answer=quiz["correct_answer"],
            hint=quiz["hint"],
        ),
        student_message=(record.student_message or "").strip(),
        status=record.status or "draft",
        sent_at=record.sent_at,
        has_unpublished_changes=_has_unpublished_changes(record),
        model=record.model or "",
        weakness_analysis_id=record.weakness_analysis_id,
        updated_at=record.updated_at,
    )


def serialize_knowledge_lesson_for_student(
    record: models.KnowledgeLessonAnalysis,
) -> schemas.KnowledgeLessonStudentOut | None:
    published = _normalize_published_payload(record.published_result if isinstance(record.published_result, dict) else None)
    quiz = published["quiz"]
    if record.status != "sent" or not quiz.get("stem"):
        return None
    return schemas.KnowledgeLessonStudentOut(
        id=record.id,
        knowledge_point=published["knowledge_point"] or record.knowledge_point,
        student_message=published["student_message"],
        explanation=published["explanation"],
        key_points=published["key_points"],
        examples=_examples_out(published["examples"]),
        quiz=schemas.KnowledgeStudentQuizOut(
            stem=quiz["stem"],
            options=quiz["options"],
            hint=quiz["hint"],
        ),
        sent_at=record.sent_at,
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


def update_knowledge_lesson_draft(
    db: Session,
    record: models.KnowledgeLessonAnalysis,
    *,
    student_message: str | None = None,
    explanation: str | None = None,
    key_points: list[str] | None = None,
    examples: list[dict[str, Any]] | None = None,
) -> models.KnowledgeLessonAnalysis:
    payload = _knowledge_lesson_result_payload(record.result if isinstance(record.result, dict) else {})
    if explanation is not None:
        payload["explanation"] = explanation.strip()
    if key_points is not None:
        payload["key_points"] = [str(x).strip() for x in key_points if str(x).strip()]
    if examples is not None:
        payload["examples"] = examples
        payload = _knowledge_lesson_result_payload(payload)
    if student_message is not None:
        record.student_message = student_message.strip() or None
    record.result = payload
    record.updated_at = datetime.utcnow()
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def publish_knowledge_lesson(
    db: Session,
    record: models.KnowledgeLessonAnalysis,
    *,
    sent_by: int,
) -> models.KnowledgeLessonAnalysis:
    payload = _draft_publish_payload(record)
    if not payload["explanation"].strip():
        raise ValueError("请先写好给学生的讲解")
    if not payload["quiz"].get("stem"):
        raise ValueError("请先确认学生小测")
    record.published_result = payload
    record.status = "sent"
    record.sent_at = datetime.utcnow()
    record.sent_by = sent_by
    record.updated_at = record.sent_at
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_sent_knowledge_lessons_for_student(
    db: Session,
    *,
    username: str,
) -> list[models.KnowledgeLessonAnalysis]:
    uname = username.strip()
    if not uname:
        return []
    stmt = (
        select(models.KnowledgeLessonAnalysis)
        .join(
            models.LearningWeaknessAnalysis,
            models.KnowledgeLessonAnalysis.weakness_analysis_id == models.LearningWeaknessAnalysis.id,
        )
        .where(
            models.LearningWeaknessAnalysis.username == uname,
            models.KnowledgeLessonAnalysis.status == "sent",
            models.KnowledgeLessonAnalysis.published_result.isnot(None),
        )
        .order_by(models.KnowledgeLessonAnalysis.sent_at.desc(), models.KnowledgeLessonAnalysis.id.desc())
    )
    return list(db.scalars(stmt).all())


def get_published_lesson_quiz(
    record: models.KnowledgeLessonAnalysis,
) -> dict[str, Any]:
    published = _normalize_published_payload(
        record.published_result if isinstance(record.published_result, dict) else None
    )
    quiz = published["quiz"]
    return {
        "knowledge_point": published["knowledge_point"] or record.knowledge_point,
        "stem": quiz["stem"],
        "options": quiz["options"],
        "correct_answer": quiz["correct_answer"],
        "hint": quiz["hint"],
    }


def get_published_knowledge_lesson_for_student(
    db: Session,
    *,
    lesson_id: int,
    username: str,
) -> models.KnowledgeLessonAnalysis | None:
    record = get_knowledge_lesson_analysis_by_id(db, lesson_id)
    if record is None or record.status != "sent" or not isinstance(record.published_result, dict):
        return None
    if not record.weakness_analysis_id:
        return None
    analysis = get_learning_weakness_analysis(db, record.weakness_analysis_id)
    if not analysis or (analysis.username or "") != username:
        return None
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
    if is_superadmin(actor.role):
        return list(db.scalars(stmt).all())
    if is_org_admin(actor.role) and actor.organization_id:
        stmt = stmt.where(models.User.organization_id == actor.organization_id)
        return list(db.scalars(stmt).all())
    stmt = stmt.where(
        models.User.role == models.UserRole.student,
        models.User.teacher_id == actor.id,
    )
    return list(db.scalars(stmt).all())


def get_organization(db: Session, organization_id: int) -> models.Organization | None:
    return db.get(models.Organization, organization_id)


def list_organizations(db: Session) -> list[models.Organization]:
    stmt = select(models.Organization).order_by(models.Organization.created_at.desc())
    return list(db.scalars(stmt).all())


def organization_names_by_ids(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    stmt = select(models.Organization.id, models.Organization.name).where(models.Organization.id.in_(ids))
    return {int(row.id): str(row.name) for row in db.execute(stmt).all()}


def resolve_organization_for_new_user(
    db: Session,
    actor,
    *,
    role: models.UserRole,
    organization_id: int | None,
) -> int | None:
    resolved = coerce_role(role)
    if resolved == models.UserRole.superadmin:
        return None
    if is_superadmin(actor.role):
        if not organization_id:
            raise ValueError("请选择机构")
        if not get_organization(db, organization_id):
            raise ValueError("机构不存在")
        return organization_id
    org_id = getattr(actor, "organization_id", None)
    if not org_id:
        raise ValueError("当前账号未加入机构")
    return org_id


def count_org_admins(
    db: Session,
    organization_id: int,
    *,
    exclude_user_id: int | None = None,
    active_only: bool = False,
) -> int:
    stmt = (
        select(func.count())
        .select_from(models.User)
        .where(
            models.User.organization_id == organization_id,
            models.User.role == models.UserRole.org_admin,
        )
    )
    if exclude_user_id is not None:
        stmt = stmt.where(models.User.id != exclude_user_id)
    if active_only:
        stmt = stmt.where(models.User.is_active.is_(True))
    return int(db.scalar(stmt) or 0)


def _ensure_not_last_org_admin(db: Session, target, *, verb: str) -> None:
    if coerce_role(target.role) != models.UserRole.org_admin or not target.organization_id:
        return
    if count_org_admins(db, target.organization_id, exclude_user_id=target.id) <= 0:
        raise ValueError(f"不能{verb}机构内唯一的机构管理员")


def _ensure_not_last_active_org_admin(db: Session, target) -> None:
    if coerce_role(target.role) != models.UserRole.org_admin or not target.organization_id:
        return
    remaining = count_org_admins(
        db,
        target.organization_id,
        exclude_user_id=target.id,
        active_only=True,
    )
    if remaining <= 0:
        raise ValueError("不能停用机构内唯一启用的机构管理员")


def create_organization_with_admin(
    db: Session,
    *,
    actor,
    name: str,
    admin_username: str,
    admin_password_hash: str,
    admin_display_name: str | None,
    admin_is_active: bool = True,
) -> tuple[models.Organization, models.User]:
    if get_user_by_username(db, admin_username):
        raise ValueError("Username already exists")
    org = models.Organization(name=name.strip(), created_by=actor.id)
    db.add(org)
    db.flush()
    admin = models.User(
        username=admin_username,
        display_name=normalize_display_name(admin_display_name),
        password_hash=admin_password_hash,
        role=models.UserRole.org_admin,
        is_active=admin_is_active,
        organization_id=org.id,
        created_by=actor.id,
    )
    db.add(admin)
    db.commit()
    db.refresh(org)
    db.refresh(admin)
    return org, admin


def update_organization_name(db: Session, organization_id: int, name: str) -> models.Organization:
    org = get_organization(db, organization_id)
    if not org:
        raise LookupError("机构不存在")
    org.name = name.strip()
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def request_org_public_bank(db: Session, actor, reason: str | None) -> models.Organization:
    if not is_org_admin(actor.role):
        raise PermissionError("仅机构管理员可以申请平台公共库")
    org_id = getattr(actor, "organization_id", None)
    org = get_organization(db, org_id) if org_id else None
    if not org:
        raise ValueError("当前账号未加入机构")
    if org.public_bank_status == models.ClaimRequestStatus.approved:
        raise ValueError("已开通平台公共库，无需再次申请")
    if org.public_bank_status == models.ClaimRequestStatus.pending:
        raise ValueError("申请审批中")
    org.public_bank_status = models.ClaimRequestStatus.pending
    org.public_bank_reason = (reason or "").strip() or None
    org.public_bank_requested_at = datetime.utcnow()
    org.public_bank_reviewed_at = None
    org.public_bank_reviewer_id = None
    org.public_bank_review_note = None
    write_activity_log(
        db,
        actor=actor,
        action="org.public_bank.request",
        resource_type="organization",
        resource_id=org.id,
        summary=f"{actor.username} 申请开通机构「{org.name}」的平台公共库",
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def review_org_public_bank(
    db: Session, *, actor, organization_id: int, approved: bool, review_note: str | None
) -> models.Organization:
    org = get_organization(db, organization_id)
    if not org:
        raise LookupError("机构不存在")
    if org.public_bank_status != models.ClaimRequestStatus.pending:
        raise ValueError("当前没有待审批的申请")
    org.public_bank_status = models.ClaimRequestStatus.approved if approved else models.ClaimRequestStatus.rejected
    org.public_bank_review_note = (review_note or "").strip() or None
    org.public_bank_reviewed_at = datetime.utcnow()
    org.public_bank_reviewer_id = actor.id
    action = "org.public_bank.approve" if approved else "org.public_bank.reject"
    verb = "批准" if approved else "驳回"
    write_activity_log(
        db,
        actor=actor,
        action=action,
        resource_type="organization",
        resource_id=org.id,
        summary=f"{actor.username} {verb}机构「{org.name}」的平台公共库申请",
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def revoke_org_public_bank(db: Session, *, actor, organization_id: int) -> models.Organization:
    org = get_organization(db, organization_id)
    if not org:
        raise LookupError("机构不存在")
    if org.public_bank_status != models.ClaimRequestStatus.approved:
        raise ValueError("当前未开通平台公共库")
    org.public_bank_status = models.ClaimRequestStatus.rejected
    org.public_bank_reviewed_at = datetime.utcnow()
    org.public_bank_reviewer_id = actor.id
    org.public_bank_review_note = "已撤回平台公共库开通"
    write_activity_log(
        db,
        actor=actor,
        action="org.public_bank.revoke",
        resource_type="organization",
        resource_id=org.id,
        summary=f"{actor.username} 撤回机构「{org.name}」的平台公共库开通",
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def set_question_public(db: Session, *, actor, question_id: int, is_public: bool) -> models.WrongQuestion:
    if not is_superadmin(actor.role):
        raise PermissionError("仅超管可以发布平台公共库题目")
    question = get_wrong_question(db, question_id)
    if not question or question.deleted:
        raise LookupError("题目不存在")
    question.is_public = is_public
    write_activity_log(
        db,
        actor=actor,
        action="question.public.publish" if is_public else "question.public.unpublish",
        resource_type="wrong_question",
        resource_id=question.id,
        summary=f"{actor.username} {'发布' if is_public else '取消发布'}题目 #{question.id}「{_stem_snippet(question.stem)}」到平台公共库",
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def _owned_student_filter(actor):
    if actor is None or is_superadmin(actor.role):
        return None
    return actor.id


def _student_affiliation_filters(actor) -> list:
    if actor is None or is_superadmin(actor.role):
        return []
    if is_org_admin(actor.role) and actor.organization_id:
        return [models.User.organization_id == actor.organization_id]
    return [models.User.teacher_id == actor.id]


def resolve_teacher_for_new_student(
    db: Session,
    actor,
    *,
    teacher_id: int | None,
) -> int | None:
    if teacher_id is None:
        return actor.id if is_org_staff(actor.role) else None
    staff = get_user_by_id(db, teacher_id)
    if not staff or not is_org_staff(staff.role) or not staff.is_active:
        raise ValueError("所属老师必须是本机构启用的教师或机构管理员")
    org_id = getattr(actor, "organization_id", None)
    if org_id and staff.organization_id != org_id:
        raise ValueError("所属老师必须属于本机构")
    if is_org_staff(actor.role) and not is_org_admin(actor.role) and teacher_id != actor.id:
        raise ValueError("教师只能把学生挂在自己名下")
    return teacher_id


def count_students_of_teacher(db: Session, teacher_id: int) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(models.User)
            .where(
                models.User.role == models.UserRole.student,
                models.User.teacher_id == teacher_id,
            )
        )
        or 0
    )


def reassign_student_teacher(db: Session, *, actor, student_id: int, teacher_id: int) -> models.User:
    if not is_org_admin(actor.role):
        raise PermissionError("仅机构管理员可以调整所属老师")
    student = get_user_by_id(db, student_id)
    if not student or coerce_role(student.role) != models.UserRole.student:
        raise LookupError("学生不存在")
    if not can_access_managed_user(actor, student):
        raise PermissionError("无权调整该学生")
    staff = get_user_by_id(db, teacher_id)
    if not staff or not is_org_staff(staff.role) or not staff.is_active:
        raise ValueError("只能改挂到本机构启用的教师或机构管理员")
    if staff.organization_id != student.organization_id:
        raise ValueError("只能改挂到本机构的老师")
    old_teacher_id = student.teacher_id
    if old_teacher_id and old_teacher_id != teacher_id:
        remove_student_from_teacher_groups(db, student_id=student.id, teacher_id=old_teacher_id)
    student.teacher_id = teacher_id
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


def remove_student_from_teacher_groups(db: Session, *, student_id: int, teacher_id: int) -> None:
    group_ids = list(
        db.scalars(select(models.StudentGroup.id).where(models.StudentGroup.teacher_id == teacher_id)).all()
    )
    if not group_ids:
        return
    db.execute(
        delete(models.StudentGroupMember).where(
            models.StudentGroupMember.user_id == student_id,
            models.StudentGroupMember.group_id.in_(group_ids),
        )
    )


def _student_group_visibility_filters(actor) -> list:
    if actor is None or is_superadmin(actor.role):
        return []
    if is_org_admin(actor.role) and actor.organization_id:
        return [models.StudentGroup.organization_id == actor.organization_id]
    return [models.StudentGroup.teacher_id == actor.id]


def _group_name_taken(db: Session, *, teacher_id: int, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(models.StudentGroup.id).where(
        models.StudentGroup.teacher_id == teacher_id,
        models.StudentGroup.name == name,
    )
    if exclude_id is not None:
        stmt = stmt.where(models.StudentGroup.id != exclude_id)
    return db.scalar(stmt) is not None


def resolve_group_teacher(db: Session, actor, teacher_id: int | None) -> models.User:
    if is_org_staff(actor.role) and not is_org_admin(actor.role):
        if teacher_id is not None and teacher_id != actor.id:
            raise ValueError("只能给自己的学生编组")
        return actor
    if teacher_id is None:
        raise ValueError("请选择所属老师")
    staff = get_user_by_id(db, teacher_id)
    if not staff or not is_org_staff(staff.role) or not staff.is_active:
        raise ValueError("所属老师必须是启用的教师或机构管理员")
    if is_org_admin(actor.role) and staff.organization_id != actor.organization_id:
        raise ValueError("只能选择本机构老师")
    return staff


def get_accessible_student_group(db: Session, actor, group_id: int) -> models.StudentGroup | None:
    group = db.get(models.StudentGroup, group_id)
    if not group or not can_access_student_group(actor, group):
        return None
    return group


def _member_rows_by_group(db: Session, group_ids: list[int]) -> dict[int, list[models.User]]:
    if not group_ids:
        return {}
    rows = db.execute(
        select(models.StudentGroupMember.group_id, models.User)
        .join(models.User, models.User.id == models.StudentGroupMember.user_id)
        .where(models.StudentGroupMember.group_id.in_(group_ids))
        .order_by(models.User.id.asc())
    ).all()
    out: dict[int, list[models.User]] = {gid: [] for gid in group_ids}
    for group_id, user in rows:
        out.setdefault(int(group_id), []).append(user)
    return out


def serialize_student_group(
    db: Session,
    group: models.StudentGroup,
    *,
    members: list[models.User] | None = None,
    teacher_name: str | None = None,
    organization_name: str | None = None,
) -> schemas.StudentGroupOut:
    if members is None:
        members = _member_rows_by_group(db, [group.id]).get(group.id, [])
    if teacher_name is None:
        teacher = get_user_by_id(db, group.teacher_id)
        teacher_name = (normalize_display_name(teacher.display_name) or teacher.username) if teacher else None
    if organization_name is None and group.organization_id:
        organization_name = organization_names_by_ids(db, {group.organization_id}).get(group.organization_id)
    return schemas.StudentGroupOut(
        id=group.id,
        name=group.name,
        teacher_id=group.teacher_id,
        teacher_name=teacher_name,
        organization_id=group.organization_id,
        organization_name=organization_name,
        member_count=len(members),
        member_ids=[user.id for user in members],
        members=[
            schemas.StudentGroupMemberOut(
                user_id=user.id,
                username=user.username,
                display_name=normalize_display_name(user.display_name),
            )
            for user in members
        ],
        created_at=group.created_at,
    )


def list_student_groups(db: Session, actor, teacher_id: int | None = None) -> list[schemas.StudentGroupOut]:
    stmt = select(models.StudentGroup)
    filters = _student_group_visibility_filters(actor)
    if filters:
        stmt = stmt.where(*filters)
    if teacher_id is not None:
        stmt = stmt.where(models.StudentGroup.teacher_id == teacher_id)
    groups = list(db.scalars(stmt.order_by(models.StudentGroup.created_at.desc())).all())
    if not groups:
        return []
    members_by_group = _member_rows_by_group(db, [g.id for g in groups])
    teacher_ids = {g.teacher_id for g in groups}
    org_ids = {g.organization_id for g in groups if g.organization_id}
    teachers = list(db.scalars(select(models.User).where(models.User.id.in_(teacher_ids))).all())
    teacher_names = {u.id: normalize_display_name(u.display_name) or u.username for u in teachers}
    org_names = organization_names_by_ids(db, org_ids)
    return [
        serialize_student_group(
            db,
            group,
            members=members_by_group.get(group.id, []),
            teacher_name=teacher_names.get(group.teacher_id),
            organization_name=org_names.get(group.organization_id) if group.organization_id else None,
        )
        for group in groups
    ]


def _eligible_group_students(db: Session, *, teacher_id: int, member_ids: list[int]) -> list[models.User]:
    unique_ids = list(dict.fromkeys(member_ids))
    if not unique_ids:
        return []
    students = list(
        db.scalars(
            select(models.User).where(
                models.User.id.in_(unique_ids),
                models.User.role == models.UserRole.student,
                models.User.is_active.is_(True),
                models.User.teacher_id == teacher_id,
            )
        ).all()
    )
    if len(students) != len(unique_ids):
        raise ValueError("只能把该老师名下启用中的学生加入编组")
    by_id = {user.id: user for user in students}
    return [by_id[uid] for uid in unique_ids]


def replace_group_members(db: Session, group: models.StudentGroup, member_ids: list[int]) -> list[models.User]:
    students = _eligible_group_students(db, teacher_id=group.teacher_id, member_ids=member_ids)
    db.execute(delete(models.StudentGroupMember).where(models.StudentGroupMember.group_id == group.id))
    for student in students:
        db.add(models.StudentGroupMember(group_id=group.id, user_id=student.id))
    return students


def create_student_group(
    db: Session,
    *,
    actor,
    name: str,
    teacher_id: int | None,
    member_ids: list[int],
) -> schemas.StudentGroupOut:
    teacher = resolve_group_teacher(db, actor, teacher_id)
    if _group_name_taken(db, teacher_id=teacher.id, name=name):
        raise ValueError("该老师已有同名编组")
    group = models.StudentGroup(
        name=name,
        teacher_id=teacher.id,
        organization_id=teacher.organization_id,
    )
    db.add(group)
    db.flush()
    members = replace_group_members(db, group, member_ids)
    db.commit()
    db.refresh(group)
    return serialize_student_group(db, group, members=members)


def update_student_group(db: Session, *, actor, group_id: int, name: str) -> schemas.StudentGroupOut:
    group = get_accessible_student_group(db, actor, group_id)
    if not group:
        raise LookupError("编组不存在")
    if _group_name_taken(db, teacher_id=group.teacher_id, name=name, exclude_id=group.id):
        raise ValueError("该老师已有同名编组")
    group.name = name
    db.add(group)
    db.commit()
    db.refresh(group)
    return serialize_student_group(db, group)


def set_student_group_members(
    db: Session, *, actor, group_id: int, member_ids: list[int]
) -> schemas.StudentGroupOut:
    group = get_accessible_student_group(db, actor, group_id)
    if not group:
        raise LookupError("编组不存在")
    members = replace_group_members(db, group, member_ids)
    db.commit()
    db.refresh(group)
    return serialize_student_group(db, group, members=members)


def delete_student_group(db: Session, *, actor, group_id: int) -> None:
    group = get_accessible_student_group(db, actor, group_id)
    if not group:
        raise LookupError("编组不存在")
    db.execute(delete(models.StudentGroupMember).where(models.StudentGroupMember.group_id == group.id))
    db.delete(group)
    db.commit()


def active_member_ids_for_groups(db: Session, groups: list[models.StudentGroup]) -> set[int]:
    if not groups:
        return set()
    group_ids = [group.id for group in groups]
    teacher_by_group = {group.id: group.teacher_id for group in groups}
    rows = db.execute(
        select(
            models.StudentGroupMember.group_id,
            models.User.id,
            models.User.is_active,
            models.User.role,
            models.User.teacher_id,
        )
        .join(models.User, models.User.id == models.StudentGroupMember.user_id)
        .where(models.StudentGroupMember.group_id.in_(group_ids))
    ).all()
    out: set[int] = set()
    for group_id, user_id, is_active, role, teacher_id in rows:
        if not is_active or coerce_role(role) != models.UserRole.student:
            continue
        if teacher_id != teacher_by_group.get(int(group_id)):
            continue
        out.add(int(user_id))
    return out


def resolve_assignment_student_ids(
    db: Session,
    actor,
    *,
    user_ids: list[int],
    group_ids: list[int],
) -> list[int]:
    resolved = set(user_ids)
    unique_group_ids = list(dict.fromkeys(group_ids))
    if unique_group_ids:
        groups = list(db.scalars(select(models.StudentGroup).where(models.StudentGroup.id.in_(unique_group_ids))).all())
        if len(groups) != len(unique_group_ids) or any(
            not can_access_student_group(actor, group) for group in groups
        ):
            raise ValueError("部分编组不存在或无权使用")
        resolved.update(active_member_ids_for_groups(db, groups))
    if not resolved:
        raise ValueError("组内没有可分配学生")
    return list(resolved)


def _error_rate(accuracy: float | None) -> float | None:
    if accuracy is None:
        return None
    return round(1 - accuracy, 4)


def _groups_by_student(db: Session, student_ids: list[int]) -> dict[int, list[models.StudentGroup]]:
    if not student_ids:
        return {}
    rows = db.execute(
        select(models.StudentGroupMember.user_id, models.StudentGroup)
        .join(models.StudentGroup, models.StudentGroup.id == models.StudentGroupMember.group_id)
        .where(models.StudentGroupMember.user_id.in_(student_ids))
        .order_by(models.StudentGroup.created_at.asc())
    ).all()
    out: dict[int, list[models.StudentGroup]] = {}
    for user_id, group in rows:
        out.setdefault(int(user_id), []).append(group)
    return out


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

    _ensure_not_last_org_admin(db, target, verb="删除")
    if is_org_staff(target.role) and count_students_of_teacher(db, target.id) > 0:
        raise ValueError("请先把名下学生改挂到其他老师再删除")

    if coerce_role(target.role) == models.UserRole.student:
        db.execute(delete(models.StudentGroupMember).where(models.StudentGroupMember.user_id == target.id))
    elif is_org_staff(target.role):
        group_ids = list(
            db.scalars(select(models.StudentGroup.id).where(models.StudentGroup.teacher_id == target.id)).all()
        )
        if group_ids:
            db.execute(delete(models.StudentGroupMember).where(models.StudentGroupMember.group_id.in_(group_ids)))
            db.execute(delete(models.StudentGroup).where(models.StudentGroup.id.in_(group_ids)))

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

    if not is_active:
        _ensure_not_last_active_org_admin(db, target)

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


def count_active_questions_by_type(
    db: Session, question_type_id: int, *, actor=None, sources: list[str] | None = None
) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(models.WrongQuestion).where(
                models.WrongQuestion.question_type_id == question_type_id,
                models.WrongQuestion.deleted.is_(False),
                *assignment_draw_filters(db, actor, sources),
            )
        )
        or 0
    )


def sample_question_briefs_by_type(
    db: Session,
    question_type_id: int,
    *,
    limit: int = 4,
    actor=None,
    sources: list[str] | None = None,
) -> list[dict[str, Any]]:
    questions = list(
        db.scalars(
            select(models.WrongQuestion)
            .where(
                models.WrongQuestion.question_type_id == question_type_id,
                models.WrongQuestion.deleted.is_(False),
                *assignment_draw_filters(db, actor, sources),
            )
            .order_by(func.random())
            .limit(limit)
        ).all()
    )
    briefs: list[dict[str, Any]] = []
    for question in questions:
        briefs.append(
            {
                "stem": question.stem,
                "options": question.options,
                "correct_answer": question.correct_answer,
                "difficulty": question.difficulty,
            }
        )
    return briefs


def list_knowledge_tag_catalog(db: Session) -> list[dict[str, Any]]:
    all_tags = list(db.query(models.KnowledgeTag).filter(models.KnowledgeTag.status == "active").all())
    tag_by_id = {t.id: t for t in all_tags}

    def tag_path_name(tag: models.KnowledgeTag) -> str:
        parts: list[str] = []
        current: models.KnowledgeTag | None = tag
        guard: set[int] = set()
        while current is not None and current.id not in guard:
            guard.add(current.id)
            parts.append(current.name)
            if current.parent_id is None:
                break
            current = tag_by_id.get(current.parent_id)
        parts.reverse()
        return " / ".join(parts)

    catalog = [{"id": t.id, "name": tag_path_name(t)} for t in all_tags]
    catalog.sort(key=lambda item: str(item["name"]))
    return catalog


def create_assignment(
    db: Session,
    *,
    admin_user_id: int,
    payload: schemas.AssignmentCreateIn,
    ai_creates: list[schemas.WrongQuestionCreate] | None = None,
    actor=None,
) -> tuple[models.Assignment, list[int]]:
    extra_questions: list[models.WrongQuestion] = []
    if ai_creates:
        extra_questions = _insert_wrong_questions(db, ai_creates, created_by=admin_user_id)

    exclude_ids = {question.id for question in extra_questions}
    bank_needed = max(0, payload.question_count - len(extra_questions))
    bank_filters = [
        models.WrongQuestion.question_type_id == payload.question_type_id,
        models.WrongQuestion.deleted.is_(False),
        *assignment_draw_filters(db, actor, getattr(payload, "sources", None)),
    ]
    if exclude_ids:
        bank_filters.append(models.WrongQuestion.id.notin_(exclude_ids))
    bank_questions = list(
        db.scalars(
            select(models.WrongQuestion)
            .where(*bank_filters)
            .order_by(func.random())
            .limit(bank_needed)
        ).all()
    ) if bank_needed else []

    questions = bank_questions + extra_questions

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
    return assignment, [question.id for question in extra_questions]


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
    if actor is None or is_superadmin(actor.role):
        return list(db.scalars(stmt).all())
    if is_org_admin(actor.role) and actor.organization_id:
        staff_ids = select(models.User.id).where(models.User.organization_id == actor.organization_id)
        stmt = stmt.where(models.Assignment.created_by.in_(staff_ids))
        return list(db.scalars(stmt).all())
    my_student_ids = select(models.User.id).where(
        models.User.role == models.UserRole.student,
        models.User.teacher_id == actor.id,
    )
    assigned_ids = select(models.UserAssignment.assignment_id).where(
        models.UserAssignment.user_id.in_(my_student_ids)
    )
    stmt = stmt.where(
        or_(
            models.Assignment.created_by == actor.id,
            models.Assignment.id.in_(assigned_ids),
        )
    )
    return list(db.scalars(stmt).all())


def get_assignment(db: Session, assignment_id: int) -> models.Assignment | None:
    return db.get(models.Assignment, assignment_id)


def get_accessible_assignment(db: Session, assignment_id: int, actor) -> models.Assignment | None:
    item = get_assignment(db, assignment_id)
    if not can_access_assignment(actor, item):
        return None
    return item


def get_viewable_assignment(db: Session, assignment_id: int, actor) -> models.Assignment | None:
    item = get_assignment(db, assignment_id)
    if item is None:
        return None
    if can_access_assignment(actor, item):
        return item
    visible_ids = {row.id for row in list_assignments(db, actor)}
    return item if item.id in visible_ids else None


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
    group_ids: list[int] | None = None,
    actor=None,
) -> int:
    assignment = db.get(models.Assignment, assignment_id)
    if assignment and assignment.status == models.AssignmentStatus.closed:
        raise ValueError("任务已关闭，无法继续分配")

    resolved_ids = resolve_assignment_student_ids(
        db, actor, user_ids=user_ids, group_ids=group_ids or []
    )

    student_filters = [
        models.User.id.in_(resolved_ids),
        models.User.role == models.UserRole.student,
        models.User.is_active.is_(True),
        *_student_affiliation_filters(actor),
    ]
    student_users = list(db.scalars(select(models.User).where(*student_filters)).all())
    valid_ids = {item.id for item in student_users}
    if len(valid_ids) != len(set(resolved_ids)):
        raise ValueError("部分学生不存在、已停用，或不在你的管辖范围")

    existing_user_ids = set(
        db.scalars(
            select(models.UserAssignment.user_id).where(models.UserAssignment.assignment_id == assignment_id)
        ).all()
    )
    created = 0
    for user_id in resolved_ids:
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
    for clause in _student_affiliation_filters(actor):
        stmt = stmt.where(clause)
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
        .where(models.UserAssignment.user_id == user_id)
        .where(
            or_(
                models.Assignment.status != models.AssignmentStatus.closed,
                models.UserAssignment.status.in_(
                    [models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded]
                ),
            )
        )
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


def get_learner_assignment_review(
    db: Session,
    *,
    assignment_id: int,
    user_id: int,
) -> schemas.LearnerAssignmentReviewOut:
    ua = get_user_assignment(db, assignment_id=assignment_id, user_id=user_id)
    assignment = get_assignment(db, assignment_id)
    if not ua or not assignment:
        raise LookupError("任务不存在或未分配给你")
    if ua.status not in {models.UserAssignmentStatus.submitted, models.UserAssignmentStatus.graded}:
        raise ValueError("任务尚未交卷，无法查看解析")

    detail = serialize_assignment_detail(db, assignment)
    answers = list_user_answers(db, assignment_id=assignment_id, user_id=user_id)
    by_qid = {item.wrong_question_id: item for item in answers}
    type_ids = {q.question_type_id for q in detail.questions if q.question_type_id}
    type_names = {
        item.id: item.name
        for item in db.scalars(select(models.QuestionType).where(models.QuestionType.id.in_(type_ids))).all()
    } if type_ids else {}
    question_ids = [q.wrong_question_id for q in detail.questions]
    analysis_map: dict[int, dict[str, Any] | None] = {}
    if question_ids:
        analysis_map = {
            int(qid): analysis
            for qid, analysis in db.execute(
                select(models.WrongQuestion.id, models.WrongQuestion.ai_analysis).where(
                    models.WrongQuestion.id.in_(question_ids)
                )
            ).all()
        }

    questions: list[schemas.LearnerReviewQuestionOut] = []
    for q in detail.questions:
        answer = by_qid.get(q.wrong_question_id)
        user_answer = answer.user_answer if answer else None
        standard = (
            answer.standard_answer
            if answer and answer.standard_answer is not None
            else q.correct_answer
        )
        correct_slots, total_slots, flags = _score_answer(user_answer, standard, options=q.options)
        questions.append(
            schemas.LearnerReviewQuestionOut(
                wrong_question_id=q.wrong_question_id,
                question_order=q.question_order,
                stem=q.stem,
                options=q.options,
                question_type_id=q.question_type_id,
                question_type_name=type_names.get(q.question_type_id),
                knowledge_tag_ids=q.knowledge_tag_ids,
                fill_slots=_learner_fill_slots(q.options, q.correct_answer),
                multiple=_learner_multiple(q.options, q.correct_answer),
                user_answer=user_answer,
                standard_answer=standard,
                is_correct=None if answer is None else answer.is_correct,
                correct_slots=correct_slots,
                total_slots=total_slots,
                slot_correct=flags,
                ai_analysis=analysis_map.get(q.wrong_question_id),
            )
        )

    correct_slots, total_slots, correct_questions, total_questions = _grade_assignment_answers(
        questions=detail.questions, answers=answers
    )
    score = ua.score if ua.score is not None else round((correct_slots / total_slots) * 100, 2) if total_slots else 0.0
    accuracy = (
        ua.accuracy_rate
        if ua.accuracy_rate is not None
        else round((correct_slots / total_slots), 4) if total_slots else 0.0
    )
    return schemas.LearnerAssignmentReviewOut(
        assignment_id=detail.id,
        title=detail.title,
        description=detail.description,
        status=ua.status,
        due_at=detail.due_at,
        submitted_at=ua.submitted_at,
        score=score,
        accuracy_rate=accuracy,
        total_questions=total_questions,
        answered_questions=len(answers),
        correct_questions=correct_questions,
        total_slots=total_slots,
        correct_slots=correct_slots,
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
                *_student_affiliation_filters(actor),
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
    groups_by_student = _groups_by_student(db, ids)
    teacher_ids = {u.teacher_id for u in students if u.teacher_id}
    org_ids = {u.organization_id for u in students if u.organization_id}
    teacher_names = {}
    if teacher_ids:
        teachers = list(db.scalars(select(models.User).where(models.User.id.in_(teacher_ids))).all())
        teacher_names = {u.id: normalize_display_name(u.display_name) or u.username for u in teachers}
    org_names = organization_names_by_ids(db, org_ids)
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
        student_groups = groups_by_student.get(user.id, [])
        items.append(
            schemas.StudentRosterItemOut(
                user_id=user.id,
                username=user.username,
                display_name=normalize_display_name(user.display_name),
                is_active=user.is_active,
                total_attempts=total,
                accuracy_rate=accuracy,
                error_rate=_error_rate(accuracy),
                last_answered_at=last_at,
                status=status,
                weak_tags=_weak_tag_names(knowledge.get(user.id, [])),
                group_ids=[g.id for g in student_groups],
                group_names=[g.name for g in student_groups],
                teacher_id=user.teacher_id,
                teacher_name=teacher_names.get(user.teacher_id) if user.teacher_id else None,
                organization_id=user.organization_id,
                organization_name=org_names.get(user.organization_id) if user.organization_id else None,
            )
        )
    items.sort(key=lambda item: (item.status != "lagging", item.status != "watch", user_label(username=item.username, display_name=item.display_name)))
    class_accuracy = _accuracy(class_correct, class_total)
    return schemas.StudentRosterOut(
        students=items,
        class_accuracy_rate=class_accuracy,
        class_error_rate=_error_rate(class_accuracy),
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
