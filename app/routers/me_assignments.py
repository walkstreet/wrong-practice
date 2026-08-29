from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.models import UserRole
from app.permissions import Permission, coerce_role
from app.services import llm as llm_service

router = APIRouter(prefix="/api/v1/me", tags=["me-assignments"], dependencies=[require(Permission.ASSIGNMENT_TAKE)])


@router.get("/portrait", response_model=schemas.StudentPortraitOut)
def get_my_portrait(
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.StudentPortraitOut:
    if coerce_role(user.role) != UserRole.student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅学生可查看自己的短板")
    return crud.get_student_portrait(db, student=user, actor=user, include_class_compare=False)


@router.get("/knowledge-lessons", response_model=list[schemas.KnowledgeLessonStudentOut])
def list_my_knowledge_lessons(
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> list[schemas.KnowledgeLessonStudentOut]:
    if coerce_role(user.role) != UserRole.student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅学生可查看老师发送的讲解")
    items: list[schemas.KnowledgeLessonStudentOut] = []
    for record in crud.list_sent_knowledge_lessons_for_student(db, username=user.username):
        item = crud.serialize_knowledge_lesson_for_student(record)
        if item:
            items.append(item)
    return items


@router.post("/knowledge-lessons/{lesson_id}/grade", response_model=schemas.KnowledgeGradeOut)
async def grade_my_knowledge_lesson(
    lesson_id: int,
    payload: schemas.KnowledgeStudentGradeIn,
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.KnowledgeGradeOut:
    if coerce_role(user.role) != UserRole.student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅学生可作答")
    record = crud.get_published_knowledge_lesson_for_student(
        db, lesson_id=lesson_id, username=user.username
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="还没有老师发给你的这道练习")
    quiz = crud.get_published_lesson_quiz(record)
    try:
        result = await llm_service.grade_knowledge_point_quiz(
            knowledge_point=quiz["knowledge_point"],
            quiz_stem=quiz["stem"],
            options=quiz["options"],
            correct_answer=quiz["correct_answer"],
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


@router.get("/assignments", response_model=list[schemas.LearnerAssignmentListItemOut])
def list_my_assignments(db: Session = Depends(get_db), user=require(Permission.ASSIGNMENT_TAKE)) -> list[schemas.LearnerAssignmentListItemOut]:
    return crud.list_user_assignments(db, user_id=user.id)


@router.get("/assignments/{assignment_id}", response_model=schemas.LearnerAssignmentDetailOut)
def get_my_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.LearnerAssignmentDetailOut:
    try:
        return crud.get_learner_assignment_detail(db, assignment_id=assignment_id, user_id=user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/assignments/{assignment_id}/answers", response_model=schemas.UserAnswerOut)
def save_answer(
    assignment_id: int,
    payload: schemas.SaveAnswerIn,
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.UserAnswerOut:
    try:
        answer = crud.save_user_answer(
            db,
            assignment_id=assignment_id,
            user_id=user.id,
            wrong_question_id=payload.wrong_question_id,
            user_answer=payload.user_answer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return schemas.UserAnswerOut.model_validate(answer)


@router.post("/assignments/{assignment_id}/submit", response_model=schemas.SubmitAssignmentOut)
def submit_my_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.SubmitAssignmentOut:
    try:
        return crud.submit_assignment(db, assignment_id=assignment_id, user_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
