from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.permissions import Permission

router = APIRouter(prefix="/api/v1/admin", tags=["admin-students"])


def _student_or_404(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学生不存在")


@router.get("/students/roster", response_model=schemas.StudentRosterOut)
def get_student_roster(
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.StudentRosterOut:
    return crud.list_student_roster(db, actor)


@router.get("/students/{user_id}/portrait", response_model=schemas.StudentPortraitOut)
def get_student_portrait(
    user_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> schemas.StudentPortraitOut:
    try:
        student = crud.resolve_accessible_student_by_id(db, actor, user_id)
    except (ValueError, LookupError, PermissionError) as exc:
        raise _student_or_404(exc) from exc
    return crud.get_student_portrait(db, student=student, actor=actor, include_class_compare=True)
