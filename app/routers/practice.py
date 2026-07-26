from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import AdminOnly, get_db
from app.services import llm as llm_service

router = APIRouter(prefix="/api/v1", tags=["practice"], dependencies=[AdminOnly])


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
) -> schemas.LearnerPracticeRecordListOut:
    total, items = crud.list_learner_practice_records(
        db,
        page=page,
        page_size=page_size,
        wrong_question_id=wrong_question_id,
        username=username,
    )
    return schemas.LearnerPracticeRecordListOut(total=total, items=items)


@router.get("/practice-records/learner/{record_id}", response_model=schemas.LearnerPracticeRecordDetailOut)
def get_learner_practice_record_detail(
    record_id: int,
    db: Session = Depends(get_db),
) -> schemas.LearnerPracticeRecordDetailOut:
    item = crud.get_learner_practice_record_detail(db, record_id=record_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice record not found")
    return item


@router.get("/practice-stats/wrong-questions", response_model=list[schemas.WrongQuestionAccuracyOut])
def list_wrong_question_accuracy_stats(
    limit: int = Query(default=50, ge=1, le=200),
    wrong_question_id: int | None = None,
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
) -> list[schemas.WrongQuestionAccuracyOut]:
    return crud.get_wrong_question_accuracy_stats(
        db,
        limit=limit,
        wrong_question_id=wrong_question_id,
        username=username,
    )


@router.post(
    "/practice-stats/wrong-questions/ai-weakness-analysis",
    response_model=schemas.LearningWeaknessAnalysisOut,
)
async def analyze_wrong_question_weaknesses(
    limit: int = Query(default=50, ge=1, le=50),
    wrong_question_id: int | None = None,
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
) -> schemas.LearningWeaknessAnalysisOut:
    stats = crud.get_wrong_question_accuracy_stats(
        db,
        limit=limit,
        wrong_question_id=wrong_question_id,
        username=username,
    )
    if not stats:
        raise HTTPException(status_code=400, detail="暂无高错误率题目数据，请先产生练习作答")

    items = crud.enrich_accuracy_stats_for_ai(db, stats)
    scope_parts = [f"高错误率 Top {len(items)}"]
    uname = username.strip() if username else None
    if uname:
        scope_parts.append(f"用户={uname}")
    if wrong_question_id:
        scope_parts.append(f"错题ID={wrong_question_id}")
    scope_note = "；".join(scope_parts)

    try:
        result, model = await llm_service.analyze_learning_weaknesses(
            items=items,
            username=uname,
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
        username=uname,
        wrong_question_id=wrong_question_id,
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
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
) -> schemas.LearningWeaknessAnalysisListOut:
    total, rows = crud.list_learning_weakness_analyses(
        db, page=page, page_size=page_size, username=username
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
    wrong_question_id: int | None = None,
    username: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
) -> schemas.LearningWeaknessAnalysisOut:
    record = crud.get_latest_learning_weakness_analysis(
        db, username=username, wrong_question_id=wrong_question_id
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
) -> schemas.LearningWeaknessAnalysisOut:
    record = crud.get_learning_weakness_analysis(db, analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="短板分析记录不存在")
    return crud.serialize_learning_weakness_analysis(record)


@router.get("/practice-stats/knowledge-lessons", response_model=schemas.KnowledgeLessonOut)
def get_knowledge_lesson(
    knowledge_point: str = Query(..., min_length=1, max_length=128),
    weakness_analysis_id: int | None = None,
    db: Session = Depends(get_db),
) -> schemas.KnowledgeLessonOut:
    record = crud.get_knowledge_lesson_analysis(
        db, knowledge_point=knowledge_point, weakness_analysis_id=weakness_analysis_id
    )
    if not record:
        raise HTTPException(status_code=404, detail="暂无已保存的知识点分析")
    return crud.serialize_knowledge_lesson_analysis(record)


@router.post("/practice-stats/knowledge-lessons", response_model=schemas.KnowledgeLessonOut)
async def create_knowledge_lesson(
    payload: schemas.KnowledgeLessonIn,
    db: Session = Depends(get_db),
) -> schemas.KnowledgeLessonOut:
    if not payload.force:
        cached = crud.get_knowledge_lesson_analysis(
            db,
            knowledge_point=payload.knowledge_point,
            weakness_analysis_id=payload.weakness_analysis_id,
        )
        if cached:
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


@router.post("/practice-stats/knowledge-lessons/quiz", response_model=schemas.KnowledgeQuizOut)
async def regenerate_knowledge_lesson_quiz(
    payload: schemas.KnowledgeQuizRegenIn,
    db: Session = Depends(get_db),
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
        record = crud.get_knowledge_lesson_analysis_by_id(db, payload.lesson_id)
    if record is None:
        record = crud.get_knowledge_lesson_analysis(
            db,
            knowledge_point=payload.knowledge_point,
            weakness_analysis_id=payload.weakness_analysis_id,
        )
    if record is not None:
        crud.update_knowledge_lesson_quiz(db, record, quiz=quiz_payload)

    return schemas.KnowledgeQuizOut(
        stem=result.stem,
        options=result.options,
        correct_answer=result.correct_answer,
        hint=result.hint,
    )


@router.post("/practice-stats/knowledge-lessons/grade", response_model=schemas.KnowledgeGradeOut)
async def grade_knowledge_lesson(
    payload: schemas.KnowledgeGradeIn,
) -> schemas.KnowledgeGradeOut:
    try:
        result = await llm_service.grade_knowledge_point_quiz(
            knowledge_point=payload.knowledge_point,
            quiz_stem=payload.quiz_stem,
            options=payload.options,
            correct_answer=payload.correct_answer,
            user_answer=payload.user_answer,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"批改失败: {exc}") from exc

    return schemas.KnowledgeGradeOut(
        is_correct=result.is_correct,
        correct_answer=result.correct_answer,
        brief_explanation=result.brief_explanation,
        encouragement=result.encouragement,
        model=result.model,
    )
