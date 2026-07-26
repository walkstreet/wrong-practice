from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import AdminOnly, get_db
from app.security import hash_password

router = APIRouter(prefix="/api/v1/admin", tags=["admin-users"], dependencies=[AdminOnly])


@router.get("/users", response_model=list[schemas.AdminUserOut])
def list_users(db: Session = Depends(get_db)) -> list[schemas.AdminUserOut]:
    items = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [
        schemas.AdminUserOut(
            id=item.id,
            username=item.username,
            role=item.role,
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
    admin_user=AdminOnly,
) -> schemas.AdminUserOut:
    if crud.get_user_by_username(db, payload.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = models.User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        created_by=admin_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.AdminUserOut(
        id=user.id,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_by=user.created_by,
        created_at=user.created_at,
    )
