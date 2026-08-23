from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.permissions import Permission

router = APIRouter(prefix="/api/v1/me", tags=["me-assignments"], dependencies=[require(Permission.ASSIGNMENT_TAKE)])


@router.get("/assignments", response_model=list[schemas.LearnerAssignmentListItemOut])
def list_my_assignments(db: Session = Depends(get_db), user=require(Permission.ASSIGNMENT_TAKE)) -> list[schemas.LearnerAssignmentListItemOut]:
    return crud.list_user_assignments(db, user_id=user.id)


@router.get("/assignments/{assignment_id}", response_model=schemas.LearnerAssignmentDetailOut)
def get_my_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user=require(Permission.ASSIGNMENT_TAKE),
) -> schemas.LearnerAssignmentDetailOut:
    detail = crud.get_learner_assignment_detail(db, assignment_id=assignment_id, user_id=user.id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return detail


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
