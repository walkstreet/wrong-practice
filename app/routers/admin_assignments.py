from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db, require
from app.permissions import Permission, can_access_managed_user
from app.services import llm as llm_service
from app.services.question_analysis import schedule_question_analysis

router = APIRouter(prefix="/api/v1/admin", tags=["admin-assignments"])


def _draft_items_to_creates(items: list[schemas.AiExtractDraftItem]) -> list[schemas.WrongQuestionCreate]:
    selected = [item for item in items if item.selected]
    if not selected:
        return []

    payloads: list[schemas.WrongQuestionCreate] = []
    for idx, item in enumerate(selected, start=1):
        if not item.stem.strip():
            raise HTTPException(status_code=422, detail=f"第 {idx} 题题干不能为空")
        if item.question_type_id is None:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请选择题型")
        if not item.knowledge_tag_ids:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请至少选择一个知识点")
        if not item.correct_answer:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题请填写正确答案")
        try:
            payloads.append(
                schemas.WrongQuestionCreate(
                    stem=item.stem.strip(),
                    options=item.options,
                    correct_answer=item.correct_answer,
                    wrong_answer=[],
                    question_type_id=item.question_type_id,
                    knowledge_tag_ids=item.knowledge_tag_ids,
                    difficulty=item.difficulty,
                    source=(item.source or "").strip() or models.AI_QUESTION_SOURCE,
                    note=item.note,
                    ingest_source=models.IngestSource.ai,
                )
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"第 {idx} 题校验失败: {exc}") from exc
    return payloads


@router.get(
    "/assignments/question-pool",
    response_model=schemas.AssignmentQuestionPoolOut,
    dependencies=[require(Permission.ASSIGNMENT_REVIEW)],
)
def get_assignment_question_pool(
    question_type_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_REVIEW),
) -> schemas.AssignmentQuestionPoolOut:
    question_type = db.get(models.QuestionType, question_type_id)
    if not question_type or question_type.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="题型不存在")
    has_shared = crud.has_bank_view_access(db, actor)
    return schemas.AssignmentQuestionPoolOut(
        question_type_id=question_type.id,
        question_type_name=question_type.name,
        available=crud.count_active_questions_by_type(db, question_type.id, actor=actor),
        includes_shared_bank=has_shared,
    )


@router.post(
    "/assignments/generate-questions",
    response_model=schemas.AssignmentGenerateOut,
    dependencies=[require(Permission.ASSIGNMENT_MANAGE)],
)
async def generate_assignment_questions(
    payload: schemas.AssignmentGenerateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_MANAGE),
) -> schemas.AssignmentGenerateOut:
    question_type = db.get(models.QuestionType, payload.question_type_id)
    if not question_type or question_type.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="题型不存在")

    available = crud.count_active_questions_by_type(db, question_type.id, actor=actor)
    cap = llm_service.max_generate_count_for_type(question_type.name)
    wanted = min(payload.count, cap)
    examples = crud.sample_question_briefs_by_type(db, question_type.id, limit=4, actor=actor)
    knowledge_tags = crud.list_knowledge_tag_catalog(db)

    try:
        items, model, warnings = await llm_service.generate_practice_questions(
            question_type_id=question_type.id,
            question_type_name=question_type.name,
            question_type_description=question_type.description,
            count=wanted,
            knowledge_tags=knowledge_tags,
            example_questions=examples,
            assignment_title=payload.title,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI 出题失败: {exc}") from exc

    if wanted < payload.count:
        warnings = [
            *warnings,
            f"该题型单次最多生成 {cap} 题，已按 {wanted} 题出题",
        ]

    safe_items: list[schemas.AiExtractDraftItem] = []
    for item in items:
        try:
            safe_items.append(schemas.AiExtractDraftItem.model_validate(item))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"出题结果字段校验失败: {exc}",
            ) from exc

    return schemas.AssignmentGenerateOut(
        items=safe_items,
        available_in_bank=available,
        requested_count=payload.count,
        generated_count=len(safe_items),
        model=model,
        warnings=warnings,
    )


@router.post("/assignments", response_model=schemas.AssignmentOut, dependencies=[require(Permission.ASSIGNMENT_MANAGE)])
def create_assignment(
    payload: schemas.AssignmentCreateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_MANAGE),
) -> schemas.AssignmentOut:
    try:
        ai_creates = _draft_items_to_creates(payload.ai_items)
        item, imported_ai_ids = crud.create_assignment(
            db, admin_user_id=actor.id, payload=payload, ai_creates=ai_creates or None, actor=actor
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    imported_ai_count = len(imported_ai_ids)
    if imported_ai_count:
        crud.write_activity_log(
            db,
            actor=actor,
            action="question.create",
            resource_type="assignment",
            resource_id=item.id,
            summary=f"{actor.username} 确认入库 {imported_ai_count} 道 AI 出题并创建任务「{item.title}」",
            extra={"imported_ai_count": imported_ai_count, "assignment_id": item.id},
            commit=True,
        )
        schedule_question_analysis(background_tasks, imported_ai_ids)
    return crud.serialize_assignment(db, item)


@router.get("/assignments", response_model=list[schemas.AssignmentOut])
def list_assignments(
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_REVIEW),
) -> list[schemas.AssignmentOut]:
    items = crud.list_assignments(db, actor=actor)
    return [crud.serialize_assignment(db, item) for item in items]


@router.get("/assignments/{assignment_id}", response_model=schemas.AssignmentDetailOut)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_REVIEW),
) -> schemas.AssignmentDetailOut:
    item = crud.get_accessible_assignment(db, assignment_id, actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.serialize_assignment_detail(db, item)


@router.post("/assignments/{assignment_id}/close", response_model=schemas.AssignmentOut)
def close_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_MANAGE),
) -> schemas.AssignmentOut:
    if not crud.get_accessible_assignment(db, assignment_id, actor):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    item = crud.close_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.serialize_assignment(db, item)


@router.delete("/assignments/{assignment_id}")
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_MANAGE),
) -> dict[str, bool]:
    if not crud.get_accessible_assignment(db, assignment_id, actor):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    ok = crud.delete_assignment(db, assignment_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return {"ok": True}


@router.post("/assignments/{assignment_id}/assign-users")
def assign_users(
    assignment_id: int,
    payload: schemas.AssignUsersIn,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_MANAGE),
) -> dict[str, int]:
    item = crud.get_accessible_assignment(db, assignment_id, actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    try:
        created = crud.assign_users_to_assignment(
            db, assignment_id=assignment_id, user_ids=payload.user_ids, actor=actor
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"created": created}


@router.get("/assignments/{assignment_id}/submissions", response_model=list[schemas.AssignmentSubmissionItemOut])
def list_submissions(
    assignment_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_REVIEW),
) -> list[schemas.AssignmentSubmissionItemOut]:
    item = crud.get_accessible_assignment(db, assignment_id, actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.list_assignment_submissions(db, assignment_id, actor=actor)


@router.get(
    "/assignments/{assignment_id}/submissions/{user_id}",
    response_model=schemas.AssignmentSubmissionDetailOut,
)
def get_submission_detail(
    assignment_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.ASSIGNMENT_REVIEW),
) -> schemas.AssignmentSubmissionDetailOut:
    item = crud.get_accessible_assignment(db, assignment_id, actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    target = crud.get_user_by_id(db, user_id)
    if not target or not can_access_managed_user(actor, target):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    detail = crud.get_assignment_submission_detail(db, assignment_id=assignment_id, user_id=user_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return detail
