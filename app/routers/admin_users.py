from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db, require
from app.permissions import Permission, coerce_role, creatable_roles
from app.security import hash_password

router = APIRouter(prefix="/api/v1/admin", tags=["admin-users"])


@router.get("/users", response_model=list[schemas.AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    actor=require(Permission.USER_VIEW),
) -> list[schemas.AdminUserOut]:
    items = crud.list_managed_users(db, actor)
    return [
        schemas.AdminUserOut(
            id=item.id,
            username=item.username,
            role=coerce_role(item.role),
            is_active=item.is_active,
            created_by=item.created_by,
            created_at=item.created_at,
        )
        for item in items
    ]


@router.post("/users", response_model=schemas.AdminUserOut)
def create_user(
    payload: schemas.AdminCreateUserIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.AdminUserOut:
    allowed = creatable_roles(actor.role)
    if payload.role not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权创建该角色的用户")

    if crud.get_user_by_username(db, payload.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = models.User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        created_by=actor.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.AdminUserOut(
        id=user.id,
        username=user.username,
        role=coerce_role(user.role),
        is_active=user.is_active,
        created_by=user.created_by,
        created_at=user.created_at,
    )


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> dict[str, bool]:
    try:
        crud.delete_user(db, actor_id=actor.id, target_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"ok": True}
