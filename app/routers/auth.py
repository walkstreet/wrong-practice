from io import BytesIO
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import CurrentUser, get_db
from app.permissions import serialize_user
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

AVATAR_DIR = Path(__file__).resolve().parents[2] / "uploads" / "avatars"
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_MAX_EDGE = 512
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_AVATAR_FORMATS = {"JPEG", "PNG", "WEBP"}


def _user_out(db: Session, user) -> schemas.UserOut:
    return schemas.UserOut(**serialize_user(user), **crud.bank_access_for_user(db, user))


def _unlink_avatar(avatar_url: str | None) -> None:
    if not avatar_url:
        return
    name = Path(avatar_url.split("?", 1)[0]).name
    if not name or name in {".", ".."}:
        return
    path = (AVATAR_DIR / name).resolve()
    if path.is_file() and path.parent == AVATAR_DIR.resolve():
        path.unlink(missing_ok=True)


def _prepare_avatar_jpeg(raw: bytes) -> bytes:
    try:
        image = Image.open(BytesIO(raw))
        image.load()
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=422, detail="无法识别的图片文件") from exc
    except OSError as exc:
        raise HTTPException(status_code=422, detail="图片已损坏") from exc

    fmt = (image.format or "").upper()
    if fmt not in ALLOWED_AVATAR_FORMATS:
        raise HTTPException(status_code=422, detail="仅支持 JPG / PNG / WebP")

    image.thumbnail((AVATAR_MAX_EDGE, AVATAR_MAX_EDGE), Image.Resampling.LANCZOS)
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    out = BytesIO()
    image.save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()


ACCOUNT_DISABLED_DETAIL = "账号已停用，无法登录"


@router.post("/login", response_model=schemas.LoginOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)) -> schemas.LoginOut:
    user = crud.get_user_by_username(db, payload.username)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_DISABLED_DETAIL)
    token = create_access_token(user.id, user.username)
    return schemas.LoginOut(access_token=token)


@router.post("/refresh", response_model=schemas.LoginOut)
def refresh_token(user=CurrentUser) -> schemas.LoginOut:
    """登录态仍有效时续发 access token（滑动续期）。"""
    token = create_access_token(user.id, user.username)
    return schemas.LoginOut(access_token=token)


@router.get("/me", response_model=schemas.UserOut)
def me(user=CurrentUser, db: Session = Depends(get_db)) -> schemas.UserOut:
    return _user_out(db, user)


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


@router.post("/avatar", response_model=schemas.UserOut)
async def upload_avatar(
    file: UploadFile = File(..., description="头像图片"),
    db: Session = Depends(get_db),
    user=CurrentUser,
) -> schemas.UserOut:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=422, detail="仅支持 JPG / PNG / WebP")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="图片为空")
    if len(raw) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=422, detail="图片不能超过 2MB")

    jpeg = _prepare_avatar_jpeg(raw)
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{user.id}_{uuid.uuid4().hex[:8]}.jpg"
    (AVATAR_DIR / filename).write_bytes(jpeg)

    old_url = user.avatar_url
    user.avatar_url = f"/uploads/avatars/{filename}"
    db.add(user)
    db.commit()
    db.refresh(user)
    _unlink_avatar(old_url)
    return _user_out(db, user)


@router.delete("/avatar", response_model=schemas.UserOut)
def delete_avatar(
    db: Session = Depends(get_db),
    user=CurrentUser,
) -> schemas.UserOut:
    old_url = user.avatar_url
    if old_url:
        user.avatar_url = None
        db.add(user)
        db.commit()
        db.refresh(user)
        _unlink_avatar(old_url)
    return _user_out(db, user)
