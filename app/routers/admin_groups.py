from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.permissions import Permission

router = APIRouter(prefix="/api/v1/admin", tags=["admin-groups"])


def _group_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="编组操作失败")


@router.get("/student-groups", response_model=list[schemas.StudentGroupOut])
def list_student_groups(
    teacher_id: int | None = None,
    db: Session = Depends(get_db),
    actor=require(Permission.PRACTICE_VIEW),
) -> list[schemas.StudentGroupOut]:
    return crud.list_student_groups(db, actor, teacher_id=teacher_id)


@router.post("/student-groups", response_model=schemas.StudentGroupOut)
def create_student_group(
    payload: schemas.StudentGroupCreateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.StudentGroupOut:
    try:
        return crud.create_student_group(
            db,
            actor=actor,
            name=payload.name,
            teacher_id=payload.teacher_id,
            member_ids=payload.member_ids,
        )
    except (ValueError, LookupError, PermissionError) as exc:
        raise _group_http_error(exc) from exc


@router.patch("/student-groups/{group_id}", response_model=schemas.StudentGroupOut)
def update_student_group(
    group_id: int,
    payload: schemas.StudentGroupUpdateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.StudentGroupOut:
    try:
        return crud.update_student_group(db, actor=actor, group_id=group_id, name=payload.name)
    except (ValueError, LookupError, PermissionError) as exc:
        raise _group_http_error(exc) from exc


@router.put("/student-groups/{group_id}/members", response_model=schemas.StudentGroupOut)
def set_student_group_members(
    group_id: int,
    payload: schemas.StudentGroupMembersIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.StudentGroupOut:
    try:
        return crud.set_student_group_members(
            db, actor=actor, group_id=group_id, member_ids=payload.member_ids
        )
    except (ValueError, LookupError, PermissionError) as exc:
        raise _group_http_error(exc) from exc


@router.delete("/student-groups/{group_id}")
def delete_student_group(
    group_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> dict[str, bool]:
    try:
        crud.delete_student_group(db, actor=actor, group_id=group_id)
    except (ValueError, LookupError, PermissionError) as exc:
        raise _group_http_error(exc) from exc
    return {"ok": True}
