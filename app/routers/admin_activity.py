from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.deps import get_db, require
from app.permissions import Permission

router = APIRouter(prefix="/api/v1/admin", tags=["admin-activity"])


@router.get("/activity-logs", response_model=schemas.ActivityLogListOut)
def list_activity_logs(
    page: int = 1,
    page_size: int = 20,
    action: str | None = None,
    actor_username: str | None = None,
    db: Session = Depends(get_db),
    _actor=require(Permission.AUDIT_VIEW),
) -> schemas.ActivityLogListOut:
    total, items = crud.list_activity_logs(
        db,
        page=page,
        page_size=page_size,
        action=action,
        actor_username=actor_username,
    )
    return schemas.ActivityLogListOut(
        total=total,
        items=[crud.serialize_activity_log(item) for item in items],
    )


@router.get("/question-claims", response_model=schemas.QuestionClaimListOut)
def list_question_claims(
    page: int = 1,
    page_size: int = 20,
    status: models.ClaimRequestStatus | None = None,
    db: Session = Depends(get_db),
    _actor=require(Permission.AUDIT_VIEW),
) -> schemas.QuestionClaimListOut:
    total, items = crud.list_org_public_bank_requests(db, page=page, page_size=page_size, status=status)
    return schemas.QuestionClaimListOut(
        total=total,
        items=[crud.serialize_org_public_bank(db, item) for item in items],
    )


@router.post("/question-claims/{request_id}/approve", response_model=schemas.QuestionClaimOut)
def approve_question_claim(
    request_id: int,
    payload: schemas.QuestionClaimReviewIn,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.QuestionClaimOut:
    try:
        org = crud.review_org_public_bank(
            db, actor=actor, organization_id=request_id, approved=True, review_note=payload.review_note
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return crud.serialize_org_public_bank(db, org)


@router.post("/question-claims/{request_id}/reject", response_model=schemas.QuestionClaimOut)
def reject_question_claim(
    request_id: int,
    payload: schemas.QuestionClaimReviewIn,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.QuestionClaimOut:
    try:
        org = crud.review_org_public_bank(
            db, actor=actor, organization_id=request_id, approved=False, review_note=payload.review_note
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return crud.serialize_org_public_bank(db, org)


@router.post("/question-claims/{request_id}/revoke", response_model=schemas.QuestionClaimOut)
def revoke_question_claim(
    request_id: int,
    db: Session = Depends(get_db),
    actor=require(Permission.AUDIT_VIEW),
) -> schemas.QuestionClaimOut:
    try:
        org = crud.revoke_org_public_bank(db, actor=actor, organization_id=request_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return crud.serialize_org_public_bank(db, org)
