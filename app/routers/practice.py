from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.permissions import Permission, can_access_managed_user, is_superadmin
from app.services import llm as llm_service

router = APIRouter(prefix="/api/v1", tags=["practice"], dependencies=[require(Permission.PRACTICE_VIEW)])


def _require_student(db: Session, actor, username: str | None):
    try:
        return crud.resolve_accessible_student(db, actor, username or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学生不存在") from exc


def _assert_lesson_access(db: Session, actor, record) -> None:
    if is_superadmin(actor.role):
        return
    if not record.weakness_analysis_id:
        raise HTTPException(status_code=404, detail="知识点分析不存在")
    analysis = crud.get_learning_weakness_analysis(db, record.weakness_analysis_id)
    if not analysis or not analysis.username:
        raise HTTPException(status_code=404, detail="知识点分析不存在")
    target = crud.get_user_by_username(db, analysis.username)
    if not target or not can_access_managed_user(actor, target):
        raise HTTPException(status_code=404, detail="知识点分析不存在")


def _require_teacher_lesson(db: Session, actor, lesson_id: int):
    record = crud.get_knowledge_lesson_analysis_by_id(db, lesson_id)
    if not record:
        raise HTTPException(status_code=404, detail="知识点分析不存在")
    _assert_lesson_access(db, actor, record)
    return record


@router.get("/practice-records", response_model=schemas.PracticeRecordListOut)
def list_practice_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    wrong_question_id: int | None = None,
    db: Session = Depends(get_db),
) -> schemas.PracticeRecordListOut:
    total, items = crud.list_practice_records(
        db,
        page=page,
        page_size=page_size,
        wrong_question_id=wrong_question_id,
    )
    return schemas.PracticeRecordListOut(
        total=total,
        items=[crud.serialize_practice_record(item) for item in items],
    )


@router.get("/practice-records/learner", response_model=schemas.LearnerPracticeRecordListOut)
def list_learner_practice_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    wrong_question_id: int | None = None,
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearnerPracticeRecordListOut:
    total, items = crud.list_learner_practice_records(
        db,
        page=page,
        page_size=page_size,
        wrong_question_id=wrong_question_id,
        username=username,
        actor=actor,
    )
    return schemas.LearnerPracticeRecordListOut(total=total, items=items)


@router.get("/practice-records/learner/{record_id}", response_model=schemas.LearnerPracticeRecordDetailOut)
def get_learner_practice_record_detail(
    record_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearnerPracticeRecordDetailOut:
    item = crud.get_learner_practice_record_detail(db, record_id=record_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice record not found")
    return item


@router.get("/practice-stats/wrong-questions", response_model=list[schemas.WrongQuestionAccuracyOut])
def list_wrong_question_accuracy_stats(
    limit: int = Query(default=50, ge=1, le=200),
    wrong_question_id: int | None = None,
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> list[schemas.WrongQuestionAccuracyOut]:
    return crud.get_wrong_question_accuracy_stats(
        db,
        limit=limit,
        wrong_question_id=wrong_question_id,
        username=username,
        actor=actor,
    )


@router.post(
    "/practice-stats/wrong-questions/ai-weakness-analysis",
    response_model=schemas.LearningWeaknessAnalysisOut,
)
async def analyze_wrong_question_weaknesses(
    limit: int = Query(default=50, ge=1, le=50),
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearningWeaknessAnalysisOut:
    student = _require_student(db, actor, username)
    stats = crud.get_wrong_question_accuracy_stats(
        db,
        limit=limit,
        username=student.username,
        actor=actor,
    )
    if not stats:
        raise HTTPException(status_code=400, detail="该学生暂无高错误率题目数据，请先产生练习作答")

    items = crud.enrich_accuracy_stats_for_ai(db, stats)
    scope_note = f"学生 {crud.user_label(student)} · 高错误率 Top {len(items)}"

    try:
        result, model = await llm_service.analyze_learning_weaknesses(
            items=items,
            username=crud.user_label(student),
            scope_note=scope_note,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 分析失败: {exc}") from exc

    analyzed_at = datetime.utcnow()
    result_payload = {
        "overall_summary": result.overall_summary,
        "weak_areas": [area.model_dump() for area in result.weak_areas],
        "gap_fill_suggestions": result.gap_fill_suggestions,
        "study_methods": result.study_methods,
        "weekly_plan": result.weekly_plan,
    }
    record = crud.create_learning_weakness_analysis(
        db,
        username=student.username,
        wrong_question_id=None,
        limit_n=limit,
        scope_note=scope_note,
        source_items=items,
        result=result_payload,
        model=model,
        analyzed_at=analyzed_at,
    )
    return crud.serialize_learning_weakness_analysis(record)


@router.get(
    "/practice-stats/weakness-analyses",
    response_model=schemas.LearningWeaknessAnalysisListOut,
)
def list_weakness_analyses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearningWeaknessAnalysisListOut:
    student = _require_student(db, actor, username)
    total, rows = crud.list_learning_weakness_analyses(
        db, page=page, page_size=page_size, username=student.username, actor=actor
    )
    items: list[schemas.LearningWeaknessAnalysisListItemOut] = []
    for row in rows:
        summary = ""
        if isinstance(row.result, dict):
            summary = str(row.result.get("overall_summary") or "")
        items.append(
            schemas.LearningWeaknessAnalysisListItemOut(
                id=row.id,
                username=row.username,
                wrong_question_id=row.wrong_question_id,
                scope_note=row.scope_note,
                analyzed_count=row.analyzed_count,
                overall_summary=summary,
                model=row.model,
                analyzed_at=row.analyzed_at,
            )
        )
    return schemas.LearningWeaknessAnalysisListOut(total=total, items=items)


@router.get(
    "/practice-stats/weakness-analyses/latest",
    response_model=schemas.LearningWeaknessAnalysisOut,
)
def get_latest_weakness_analysis(
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearningWeaknessAnalysisOut:
    student = _require_student(db, actor, username)
    record = crud.get_latest_learning_weakness_analysis(
        db, username=student.username, actor=actor
    )
    if not record:
        raise HTTPException(status_code=404, detail="暂无已保存的短板分析")
    return crud.serialize_learning_weakness_analysis(record)


@router.get(
    "/practice-stats/weakness-analyses/{analysis_id}",
    response_model=schemas.LearningWeaknessAnalysisOut,
)
def get_weakness_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.LearningWeaknessAnalysisOut:
    record = crud.get_learning_weakness_analysis(db, analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="短板分析记录不存在")
    if not record.username:
        raise HTTPException(status_code=404, detail="短板分析记录不存在")
    if not is_superadmin(actor.role):
        target = crud.get_user_by_username(db, record.username)
        if not target or not can_access_managed_user(actor, target):
            raise HTTPException(status_code=404, detail="短板分析记录不存在")
    return crud.serialize_learning_weakness_analysis(record)


@router.get("/practice-stats/knowledge-lessons", response_model=schemas.KnowledgeLessonOut)
def get_knowledge_lesson(
    knowledge_point: str = Query(..., min_length=1, max_length=128),
    weakness_analysis_id: int | None = None,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.KnowledgeLessonOut:
    record = crud.get_knowledge_lesson_analysis(
        db, knowledge_point=knowledge_point, weakness_analysis_id=weakness_analysis_id
    )
    if not record:
        raise HTTPException(status_code=404, detail="暂无已保存的知识点分析")
    _assert_lesson_access(db, actor, record)
    return crud.serialize_knowledge_lesson_analysis(record)


@router.post("/practice-stats/knowledge-lessons", response_model=schemas.KnowledgeLessonOut)
async def create_knowledge_lesson(
    payload: schemas.KnowledgeLessonIn,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.KnowledgeLessonOut:
    if payload.weakness_analysis_id:
        analysis = crud.get_learning_weakness_analysis(db, payload.weakness_analysis_id)
        if not analysis:
            raise HTTPException(status_code=404, detail="短板分析不存在")
        if analysis.username:
            _require_student(db, actor, analysis.username)

    if not payload.force:
        cached = crud.get_knowledge_lesson_analysis(
            db,
            knowledge_point=payload.knowledge_point,
            weakness_analysis_id=payload.weakness_analysis_id,
        )
        if cached:
            _assert_lesson_access(db, actor, cached)
            return crud.serialize_knowledge_lesson_analysis(cached)

    try:
        result = await llm_service.analyze_knowledge_point_lesson(
            knowledge_point=payload.knowledge_point,
            evidence=payload.evidence,
            overall_summary=payload.overall_summary,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"知识点分析失败: {exc}") from exc

    result_payload = {
        "knowledge_point": result.knowledge_point,
        "explanation": result.explanation,
        "key_points": result.key_points,
        "examples": [ex.model_dump() for ex in result.examples],
        "quiz": result.quiz.model_dump(),
    }
    record = crud.upsert_knowledge_lesson_analysis(
        db,
        knowledge_point=result.knowledge_point or payload.knowledge_point,
        weakness_analysis_id=payload.weakness_analysis_id,
        evidence=payload.evidence,
        overall_summary=payload.overall_summary,
        result=result_payload,
        model=result.model,
    )
    return crud.serialize_knowledge_lesson_analysis(record)


@router.patch("/practice-stats/knowledge-lessons/{lesson_id}", response_model=schemas.KnowledgeLessonOut)
def update_knowledge_lesson(
    lesson_id: int,
    payload: schemas.KnowledgeLessonUpdateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.KnowledgeLessonOut:
    record = _require_teacher_lesson(db, actor, lesson_id)
    examples = None
    if payload.examples is not None:
        examples = [item.model_dump() for item in payload.examples]
    record = crud.update_knowledge_lesson_draft(
        db,
        record,
        student_message=payload.student_message,
        explanation=payload.explanation,
        key_points=payload.key_points,
        examples=examples,
    )
    return crud.serialize_knowledge_lesson_analysis(record)


@router.post("/practice-stats/knowledge-lessons/{lesson_id}/send", response_model=schemas.KnowledgeLessonOut)
def send_knowledge_lesson(
    lesson_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.KnowledgeLessonOut:
    record = _require_teacher_lesson(db, actor, lesson_id)
    if not record.weakness_analysis_id:
        raise HTTPException(status_code=400, detail="缺少对应学生，无法发送")
    try:
        record = crud.publish_knowledge_lesson(db, record, sent_by=actor.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return crud.serialize_knowledge_lesson_analysis(record)


@router.post("/practice-stats/knowledge-lessons/quiz", response_model=schemas.KnowledgeQuizOut)
async def regenerate_knowledge_lesson_quiz(
    payload: schemas.KnowledgeQuizRegenIn,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.KnowledgeQuizOut:
    try:
        result = await llm_service.generate_knowledge_point_quiz(
            knowledge_point=payload.knowledge_point,
            evidence=payload.evidence,
            avoid_stems=payload.avoid_stems,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"换题失败: {exc}") from exc

    quiz_payload = {
        "stem": result.stem,
        "options": result.options,
        "correct_answer": result.correct_answer,
        "hint": result.hint,
    }
    record = None
    if payload.lesson_id is not None:
        record = _require_teacher_lesson(db, actor, payload.lesson_id)
    if record is None:
        record = crud.get_knowledge_lesson_analysis(
            db,
            knowledge_point=payload.knowledge_point,
            weakness_analysis_id=payload.weakness_analysis_id,
        )
        if record is not None:
            _assert_lesson_access(db, actor, record)
    if record is not None:
        crud.update_knowledge_lesson_quiz(db, record, quiz=quiz_payload)

    return schemas.KnowledgeQuizOut(
        stem=result.stem,
        options=result.options,
        correct_answer=result.correct_answer,
        hint=result.hint,
    )
