from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import CurrentUser, get_db
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=schemas.LoginOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)) -> schemas.LoginOut:
    user = crud.get_user_by_username(db, payload.username)
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    token = create_access_token(user.id, user.username)
    return schemas.LoginOut(access_token=token)


@router.post("/refresh", response_model=schemas.LoginOut)
def refresh_token(user=CurrentUser) -> schemas.LoginOut:
    """登录态仍有效时续发 access token（滑动续期）。"""
    token = create_access_token(user.id, user.username)
    return schemas.LoginOut(access_token=token)


@router.get("/me", response_model=schemas.UserOut)
def me(user=CurrentUser) -> schemas.UserOut:
    return schemas.UserOut(id=user.id, username=user.username, role=user.role, is_active=user.is_active)


@router.post("/change-password", response_model=schemas.LoginOut)
def change_password(
    payload: schemas.ChangePasswordIn,
    db: Session = Depends(get_db),
    user=CurrentUser,
) -> schemas.LoginOut:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确")
    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码至少 6 位")
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与旧密码相同")

    user.password_hash = hash_password(new_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.username)
    return schemas.LoginOut(access_token=token)
