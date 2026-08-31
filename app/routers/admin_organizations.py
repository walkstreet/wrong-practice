from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.deps import get_db, require
from app.permissions import Permission, is_superadmin
from app.security import hash_password

router = APIRouter(prefix="/api/v1/admin/organizations", tags=["admin-organizations"])


def _require_superadmin(actor):
    if not is_superadmin(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅超管可以管理机构")
    return actor


def _org_out(item) -> schemas.OrganizationOut:
    return schemas.OrganizationOut(
        id=item.id,
        name=item.name,
        created_at=item.created_at,
        public_bank_status=item.public_bank_status,
        public_bank_reason=item.public_bank_reason,
        public_bank_review_note=item.public_bank_review_note,
        public_bank_requested_at=item.public_bank_requested_at,
        public_bank_reviewed_at=item.public_bank_reviewed_at,
    )


@router.get("", response_model=list[schemas.OrganizationOut])
def list_organizations(
    db: Session = Depends(get_db),
    actor=require(Permission.USER_VIEW),
) -> list[schemas.OrganizationOut]:
    _require_superadmin(actor)
    return [_org_out(item) for item in crud.list_organizations(db)]


@router.post("", response_model=schemas.OrganizationOut)
def create_organization(
    payload: schemas.OrganizationCreateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.OrganizationOut:
    _require_superadmin(actor)
    try:
        org, _admin = crud.create_organization_with_admin(
            db,
            actor=actor,
            name=payload.name,
            admin_username=payload.admin_username,
            admin_password_hash=hash_password(payload.admin_password),
            admin_display_name=payload.admin_display_name,
            admin_is_active=payload.admin_is_active,
        )
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_409_CONFLICT if "already exists" in detail else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail="用户名已存在" if code == 409 else detail) from exc
    return _org_out(org)


@router.patch("/{organization_id}", response_model=schemas.OrganizationOut)
def update_organization(
    organization_id: int,
    payload: schemas.OrganizationUpdateIn,
    db: Session = Depends(get_db),
    actor=require(Permission.USER_CREATE),
) -> schemas.OrganizationOut:
    _require_superadmin(actor)
    try:
        org = crud.update_organization_name(db, organization_id, payload.name)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _org_out(org)


@router.post("/{organization_id}/public-bank/approve", response_model=schemas.OrganizationOut)
def approve_org_public_bank(
    organization_id: int,
    payload: schemas.PublicBankReviewIn,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.OrganizationOut:
    _require_superadmin(actor)
    try:
        org = crud.review_org_public_bank(
            db, actor=actor, organization_id=organization_id, approved=True, review_note=payload.review_note
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _org_out(org)


@router.post("/{organization_id}/public-bank/reject", response_model=schemas.OrganizationOut)
def reject_org_public_bank(
    organization_id: int,
    payload: schemas.PublicBankReviewIn,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.OrganizationOut:
    _require_superadmin(actor)
    try:
        org = crud.review_org_public_bank(
            db, actor=actor, organization_id=organization_id, approved=False, review_note=payload.review_note
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _org_out(org)


@router.post("/{organization_id}/public-bank/revoke", response_model=schemas.OrganizationOut)
def revoke_org_public_bank(
    organization_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.OrganizationOut:
    _require_superadmin(actor)
    try:
        org = crud.revoke_org_public_bank(db, actor=actor, organization_id=organization_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _org_out(org)
