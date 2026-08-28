from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db, require
from app.permissions import Permission, can_access_managed_user, coerce_role, creatable_roles, is_superadmin
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/v1/admin", tags=["admin-users"])


def _admin_user_out(item) -> schemas.AdminUserOut:
    return schemas.AdminUserOut(
        id=item.id,
        username=item.username,
        display_name=crud.normalize_display_name(getattr(item, "display_name", None)),
        role=coerce_role(item.role),
        is_active=item.is_active,
        created_by=item.created_by,
        created_at=item.created_at,
    )


@router.get("/users", response_model=list[schemas.AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    actor=require(Permission.USER_VIEW),
) -> list[schemas.AdminUserOut]:
    items = crud.list_managed_users(db, actor)
    return [_admin_user_out(item) for item in items]


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
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        created_by=actor.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _admin_user_out(user)


@router.patch("/users/{user_id}", response_model=schemas.AdminUserOut)
def update_user(
    user_id: int,
    payload: schemas.AdminUpdateUserIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.AdminUserOut:
    target = crud.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if not can_access_managed_user(actor, target):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if coerce_role(target.role) == models.UserRole.student and not payload.display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请填写学生姓名")
    target.display_name = payload.display_name
    db.add(target)
    db.commit()
    db.refresh(target)
    return _admin_user_out(target)


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


@router.post("/users/{user_id}/active", response_model=schemas.AdminUserOut)
def set_user_active(
    user_id: int,
    payload: schemas.AdminSetActiveIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.AdminUserOut:
    try:
        user = crud.set_user_active(db, actor_id=actor.id, target_id=user_id, is_active=payload.is_active)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _admin_user_out(user)


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: schemas.AdminResetPasswordIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_MANAGE),
) -> dict[str, str]:
    if not is_superadmin(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅超管可以重置密码")

    target = crud.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码至少 6 位")
    if verify_password(new_password, target.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与旧密码相同")

    target.password_hash = hash_password(new_password)
    crud.write_activity_log(
        db,
        actor=actor,
        action="user.password.reset",
        resource_type="user",
        resource_id=target.id,
        summary=f"{actor.username} 重置了用户 {target.username} 的密码",
        extra={"username": target.username},
    )
    db.commit()
    return {"status": "reset"}
