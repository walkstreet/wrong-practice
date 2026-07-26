from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import AdminOnly, get_db

router = APIRouter(prefix="/api/v1/admin", tags=["admin-assignments"], dependencies=[AdminOnly])


@router.post("/assignments", response_model=schemas.AssignmentOut)
def create_assignment(
    payload: schemas.AssignmentCreateIn,
    db: Session = Depends(get_db),
    admin_user=AdminOnly,
) -> schemas.AssignmentOut:
    try:
        item = crud.create_assignment(db, admin_user_id=admin_user.id, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return crud.serialize_assignment(db, item)


@router.get("/assignments", response_model=list[schemas.AssignmentOut])
def list_assignments(db: Session = Depends(get_db)) -> list[schemas.AssignmentOut]:
    items = crud.list_assignments(db)
    return [crud.serialize_assignment(db, item) for item in items]


@router.get("/assignments/{assignment_id}", response_model=schemas.AssignmentDetailOut)
def get_assignment(assignment_id: int, db: Session = Depends(get_db)) -> schemas.AssignmentDetailOut:
    item = crud.get_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.serialize_assignment_detail(db, item)


@router.post("/assignments/{assignment_id}/close", response_model=schemas.AssignmentOut)
def close_assignment(assignment_id: int, db: Session = Depends(get_db)) -> schemas.AssignmentOut:
    item = crud.close_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.serialize_assignment(db, item)


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    ok = crud.delete_assignment(db, assignment_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return {"ok": True}


@router.post("/assignments/{assignment_id}/assign-users")
def assign_users(
    assignment_id: int,
    payload: schemas.AssignUsersIn,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    item = crud.get_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    try:
        created = crud.assign_users_to_assignment(db, assignment_id=assignment_id, user_ids=payload.user_ids)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"created": created}


@router.get("/assignments/{assignment_id}/submissions", response_model=list[schemas.AssignmentSubmissionItemOut])
def list_submissions(
    assignment_id: int,
    db: Session = Depends(get_db),
) -> list[schemas.AssignmentSubmissionItemOut]:
    item = crud.get_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return crud.list_assignment_submissions(db, assignment_id)


@router.get(
    "/assignments/{assignment_id}/submissions/{user_id}",
    response_model=schemas.AssignmentSubmissionDetailOut,
)
def get_submission_detail(
    assignment_id: int,
    user_id: int,
    db: Session = Depends(get_db),
) -> schemas.AssignmentSubmissionDetailOut:
    item = crud.get_assignment(db, assignment_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    detail = crud.get_assignment_submission_detail(db, assignment_id=assignment_id, user_id=user_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return detail
